"""UI から見たサーフェスの状態。

WebSocket 接続・マニフェスト・表示値をひとまとめにし、NiceGUI のページからは
ここだけを見ればよいようにする。ページは複数開かれうるので、状態は
プロセス内に 1 つだけ持ち、各ページは revision を見て差分を取り込む。
"""

from __future__ import annotations

import logging
import socket
import time
from collections import deque
from dataclasses import dataclass, replace
from typing import Any, Callable, Iterable, Literal, Mapping, Sequence

from .config import AppConfig, UnityTarget
from .apply_set import build_apply_set, find_unsupported_scope_entries, resolve_apply_scope
from .entry_rules import button_values, is_apply_trigger, is_display_only
from .manifest import Manifest, ManifestEntry, ManifestError, parse_manifest
from .protocol import (
    OSC_BATCH_MAX_MESSAGES,
    DecodedFrame,
    HelloFrame,
    LinkFrame,
    ManifestFrame,
    NoticeFrame,
    OscFrame,
)
from .surface_link import LinkOptions, LinkStatus, SurfaceLink
from .value_store import (
    DEFAULT_HOLD_TIMEOUT_S,
    DEFAULT_MIN_SEND_INTERVAL_S,
    INPUT_HOLD_TIMEOUT_S,
    ValueStore,
)

logger = logging.getLogger(__name__)

APPLY_ECHO_TIMEOUT_S = 2.0
APPLY_LATE_ECHO_WINDOW_S = 10.0


@dataclass(frozen=True)
class Notice:
    seq: int
    level: Literal["info", "warn", "error"]
    message: str


@dataclass
class PendingApply:
    trigger: ManifestEntry
    deadline: float
    value_count: int


def _resolve_host_addresses(host: str) -> frozenset[str]:
    """設定上のホスト名を数値アドレスの集合へ解決する。失敗時は空集合(文字列比較のみ)。"""
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return frozenset()
    return frozenset(str(info[4][0]) for info in infos)


@dataclass(frozen=True)
class ManifestStatus:
    detail: str
    error: str | None = None
    project_id: str | None = None
    entry_count: int = 0
    last_rejection: str | None = None

@dataclass(frozen=True)
class UnityLinkStatus:
    reachability: str = "unknown"
    last_rtt_ms: float | None = None
    consecutive_losses: int = 0
    last_pong_seq: int | None = None


class SurfaceState:
    def __init__(
        self,
        config: AppConfig,
        clock: Callable[[], float] = time.monotonic,
        min_send_interval_s: float = DEFAULT_MIN_SEND_INTERVAL_S,
        link_factory: Callable[..., SurfaceLink] | None = None,
    ) -> None:
        self._config = config
        self._clock = clock
        self.values = ValueStore(min_send_interval_s=min_send_interval_s)

        self._manifest: Manifest | None = None
        self._entry_index: dict[str, ManifestEntry] = {}
        self._manifest_revision = 0
        self._adoption: tuple[int, str] | None = None
        self._manifest_status = ManifestStatus(detail="待機中")
        self._link_status = LinkStatus(connected=False, detail="未接続")
        self._unity_link_status = UnityLinkStatus()
        self._last_rejection: dict[str, Any] | None = None
        self._hello: HelloFrame | None = None
        # unity.host がホスト名(localhost / LAN DNS 名)のとき、UDP の送信元は数値
        # アドレスで届くため、名前解決した集合を突き合わせに使う(host 単位でキャッシュ)
        self._resolved_unity_host: str | None = None
        self._resolved_unity_addrs: frozenset[str] = frozenset()
        self._pending_applies: dict[str, PendingApply] = {}
        self._recent_failed_applies: dict[str, float] = {}
        self._notices: deque[Notice] = deque(maxlen=50)
        self._notice_seq = 0

        build_link = link_factory or SurfaceLink
        self.link = build_link(
            LinkOptions(url=config.websocket_url),
            self._on_frame,
            self._on_link_status,
        )

    # --- 参照 -------------------------------------------------------------

    @property
    def config(self) -> AppConfig:
        return self._config

    @property
    def manifest(self) -> Manifest | None:
        return self._manifest

    @property
    def manifest_revision(self) -> int:
        return self._manifest_revision

    @property
    def manifest_status(self) -> ManifestStatus:
        return self._manifest_status

    @property
    def link_status(self) -> LinkStatus:
        return self._link_status

    @property
    def unity_link_status(self) -> UnityLinkStatus:
        return self._unity_link_status

    @property
    def last_rejection(self) -> dict[str, Any] | None:
        return self._last_rejection

    @property
    def hello(self) -> HelloFrame | None:
        return self._hello

    @property
    def pending_applies(self) -> Mapping[str, PendingApply]:
        return dict(self._pending_applies)

    def notices_since(self, cursor: int) -> tuple[Notice, ...]:
        return tuple(notice for notice in self._notices if notice.seq > cursor)

    # --- UI からの操作 ----------------------------------------------------

    def begin_hold(self, address: str) -> None:
        entry = self.entry_for(address)
        timeout_s = INPUT_HOLD_TIMEOUT_S if entry is not None and entry.widget == "input" else DEFAULT_HOLD_TIMEOUT_S
        self.values.channel(address).begin_hold(self._clock(), timeout_s)

    def end_hold(self, entry: ManifestEntry) -> None:
        values = self.values.channel(entry.address).end_hold(self._clock())

        if values is not None:
            self._send(entry, values)

    def release_holds(self, addresses: Iterable[str]) -> None:
        """切断したクライアントが開始したホールドを期限に関係なく解放する。"""
        for address, values in self.values.release_holds(addresses, self._clock()):
            if values is None:
                continue
            entry = self.entry_for(address)
            if entry is not None:
                self._send(entry, values)

    def set_local(self, entry: ManifestEntry, values: Sequence[Any]) -> None:
        """UI 操作による値変更。間引きに掛かった分は tick() が後から送る。"""
        to_send = self.values.channel(entry.address).on_local(tuple(values), self._clock())

        if to_send is not None:
            self._send(entry, to_send)

    def set_discrete(self, entry: ManifestEntry, values: Sequence[Any]) -> None:
        """ボタン・トグルの操作。取りこぼすと状態が食い違うため間引かない。"""
        to_send = self.values.channel(entry.address).on_local_immediate(tuple(values), self._clock())
        self._send(entry, to_send)

    def set_draft(self, entry: ManifestEntry, raw: Any) -> None:
        self.values.set_draft(entry.address, raw)

    def press_trigger(self, entry: ManifestEntry) -> None:
        """Press a button, optionally sending its apply scope as one batch."""
        if not is_apply_trigger(entry):
            on_value, _ = button_values(entry)
            self.set_discrete(entry, (on_value,))
            return

        manifest = self._manifest
        unsupported = () if manifest is None else find_unsupported_scope_entries(manifest, entry)
        if unsupported:
            # Unity 側の適用範囲は UI で変えられないため、X だけが適用される押下自体を止める
            addresses = ", ".join(item.address for item in unsupported)
            logger.error(
                "適用トリガ %s: 適用範囲に staged な xy エントリ(%s)が含まれるため送信しません",
                entry.address,
                addresses,
            )
            self._add_notice(
                "error",
                f"{entry.label}: 適用範囲に xy エントリ({addresses})が含まれるため送信しません"
                "(Unity のステージングは xy の最初の引数しか記録しません。マニフェストの staged / appliesTo を見直してください)",
            )
            return

        targets = () if manifest is None else resolve_apply_scope(manifest, entry)
        if not targets:
            logger.warning("適用トリガ %s に適用対象がありません", entry.address)
            self._add_notice("warn", f"{entry.label}: 適用対象がありません")
            on_value, _ = button_values(entry)
            self.set_discrete(entry, (on_value,))
            return

        plan = build_apply_set(entry, targets, self.values)
        if plan.skipped:
            logger.warning(
                "適用トリガ %s: %d 件を送信対象から除外しました: %s",
                entry.address,
                len(plan.skipped),
                ", ".join(
                    f"{item.address} ({item.reason}{': ' + item.detail if item.detail else ''})"
                    for item in plan.skipped
                ),
            )
            self._add_notice(
                "warn",
                f"{entry.label}: {len(plan.skipped)} 件を送信対象から除外しました(ログ確認)",
            )

        if len(plan.messages) > OSC_BATCH_MAX_MESSAGES:
            # エンコーダに渡す前に上限を弾く(渡すと ProtocolError でハンドラごと落ちる)
            logger.error(
                "適用トリガ %s: セットが %d 件で上限 %d 件を超えています",
                entry.address,
                len(plan.messages),
                OSC_BATCH_MAX_MESSAGES,
            )
            self._add_notice(
                "error",
                f"{entry.label}: 適用セットが {len(plan.messages)} 件で上限 {OSC_BATCH_MAX_MESSAGES} 件を超えているため送信しません",
            )
            return

        # The trigger channel is updated immediately, while scoped values bypass
        # ValueStore throttling and are transported in the single batch.
        on_value, _ = button_values(entry)
        self.values.channel(entry.address).on_local_immediate((on_value,), self._clock())
        if not self.link.send_osc_batch(plan.messages):
            self._add_notice("error", f"ブリッジ未接続のため {entry.label} を適用できません")
            return

        self._pending_applies[entry.address] = PendingApply(
            trigger=entry,
            deadline=self._clock() + APPLY_ECHO_TIMEOUT_S,
            value_count=plan.value_count,
        )

    def tick(self) -> None:
        """保留値の送信と、全チャネルの期限切れホールド解除を行う。"""
        now = self._clock()

        for address, values in self.values.release_all_holds(now):
            if values is None:
                continue
            entry = self.entry_for(address)
            if entry is not None:
                self._send(entry, values)

        for address, values in self.values.flush_due(now):
            entry = self.entry_for(address)

            if entry is not None:
                self._send(entry, values)

        for address, pending in tuple(self._pending_applies.items()):
            if now < pending.deadline:
                continue
            del self._pending_applies[address]
            self._recent_failed_applies[address] = now + APPLY_LATE_ECHO_WINDOW_S
            self._add_notice(
                "error",
                f"{pending.trigger.label} の適用を 2 秒以内に確認できませんでした(Unity からの応答なし。画面の値と Unity の値が一致しているか確認してください)",
            )

        for address, expiry in tuple(self._recent_failed_applies.items()):
            if now >= expiry:
                del self._recent_failed_applies[address]

    def entry_for(self, address: str) -> ManifestEntry | None:
        return self._entry_index.get(address)

    # --- リンクからの受信 -------------------------------------------------

    def _on_link_status(self, status: LinkStatus) -> None:
        self._link_status = status

        if not status.connected:
            # 送信途中の状態を捨てる。再接続後の値は Unity のエコーバックで復元する。
            self.values.reset_send_state()
            for pending in tuple(self._pending_applies.values()):
                self._add_notice(
                    "error",
                    f"ブリッジ未接続のため {pending.trigger.label} を適用できません",
                )
            self._pending_applies.clear()

    def _on_frame(self, frame: DecodedFrame) -> None:
        """接続層から届く全フレームの入口。種別の分岐はここだけで行う。"""
        if isinstance(frame, HelloFrame):
            self._on_hello(frame)
            return

        if isinstance(frame, LinkFrame):
            self._on_link(frame)
            return

        if isinstance(frame, ManifestFrame):
            self._on_manifest(frame.manifest, frame.adoption)
            return

        if isinstance(frame, NoticeFrame):
            # batch-rejected は Surface Core が error で、invalid-frame(スキーマ違反)は
            # ui-hub が warn で返す。どちらもセットが Unity に届いていないので level に
            # 関係なく pending を失敗にする(UI が送るフレームは自前で組み立てており、
            # 待機中の invalid-frame はそのセットに対する応答とみなせる)
            if frame.code in {"batch-rejected", "invalid-frame"}:
                pending = tuple(self._pending_applies.values())
                self._pending_applies.clear()
                for item in pending:
                    self._add_notice(
                        "error",
                        f"{item.trigger.label} の適用をブリッジが拒否しました: {frame.detail}",
                    )
            return

        if not isinstance(frame, OscFrame):
            return

        if frame.address.startswith("/sys/"):
            return

        if not frame.args:
            return

        # 値の確定は Unity のエコーバックのみ(絶対規律)。oscUi 有効時は OSC ネイティブ
        # UI の操作値も from つきの osc フレームとして届くため、送信元ホストが Unity で
        # ないものは表示キャッシュへ入れない。hello 前(unity 未取得)も確定させない
        if frame.source is None or not self._is_unity_source(frame.source.host):
            return

        values = tuple(arg.value for arg in frame.args)
        self.values.on_echo(frame.address, values)

        if frame.address in self._pending_applies and any(value != 0 for value in values):
            del self._pending_applies[frame.address]
        elif frame.address in self._recent_failed_applies and any(value != 0 for value in values):
            del self._recent_failed_applies[frame.address]
            entry = self.entry_for(frame.address)
            label = entry.label if entry is not None else frame.address
            self._add_notice("info", f"{label} の適用が遅れて確認されました")

    def _add_notice(self, level: Literal["info", "warn", "error"], message: str) -> None:
        self._notice_seq += 1
        self._notices.append(Notice(self._notice_seq, level, message))

    def _is_unity_source(self, host: str) -> bool:
        unity = self._config.unity
        if unity is None:
            return False
        if host == unity.host:
            return True
        if self._resolved_unity_host != unity.host:
            self._resolved_unity_host = unity.host
            self._resolved_unity_addrs = _resolve_host_addresses(unity.host)
        return host in self._resolved_unity_addrs

    def _on_manifest(self, payload: Any, adoption: Mapping[str, Any] | None = None) -> None:
        adoption_key: tuple[int, str] | None = None
        if adoption is not None:
            seq = adoption.get("seq")
            at = adoption.get("at")
            if isinstance(seq, int) and not isinstance(seq, bool) and isinstance(at, str):
                adoption_key = (seq, at)
                if adoption_key == self._adoption:
                    return

        try:
            manifest = parse_manifest(payload)
        except ManifestError as error:
            logger.error("マニフェストを採用できません: %s", error)
            self._manifest_status = ManifestStatus(detail="不正", error=str(error))
            return

        expected = None

        if expected is not None and manifest.project_id != expected:
            detail = f'projectId 不一致 (期待 "{expected}" / 受信 "{manifest.project_id}")'
            logger.error("%s", detail)
            self._manifest_status = ManifestStatus(detail="誤接続の疑い", error=detail)
            return

        if adoption_key is None and self._manifest is not None and manifest == self._manifest:
            return

        same_manifest = self._manifest is not None and manifest == self._manifest
        self._manifest = manifest
        self._entry_index = {entry.address: entry for entry in manifest.entries}
        if adoption_key is not None:
            self._adoption = adoption_key

        # 内容が変わったときだけ再描画(manifest_revision)を起こす。再描画で編集中の
        # コントロールは破棄されるため、ホールドは送信せずに打ち切り(保留中の間引き値も
        # 下書きも破棄)、見えなくなった値が後の適用セットに乗らないようにする。
        # 再同期で OSC を送らない規律(Req 5.3)のため release_holds は使わない
        if not same_manifest:
            self._manifest_revision += 1
            cancelled = self.values.cancel_all_holds()
            if cancelled:
                logger.info("manifest changed: cancelled %d hold(s) without sending: %s", len(cancelled), ", ".join(cancelled))

        if adoption_key is not None:
            # 新たな採用では内容の異同に関係なく、ホールド中でないチャネルを default へ
            # 強制再同期する(Unity 再起動後の現在値へ戻す。OSC は送らない)
            skipped = self.values.seed_defaults(manifest.entries, force=True)
            logger.info(
                "manifest adoption resync seq=%d changed=%s skipped=%d",
                adoption_key[0],
                not same_manifest,
                len(skipped),
            )
        else:
            self.values.seed_defaults(manifest.entries)
        self._manifest_status = ManifestStatus(
            detail="採用済み",
            project_id=manifest.project_id,
            entry_count=len(manifest.entries),
        )

    def _on_hello(self, frame: HelloFrame) -> None:
        self._hello = frame
        unity = frame.unity or {}
        if isinstance(unity.get("host"), str) and isinstance(unity.get("sendPort"), int):
            receive_port = unity.get("receivePort", unity["sendPort"])
            if not isinstance(receive_port, int):
                return
            self._config = replace(self._config, unity=UnityTarget(unity["host"], unity["sendPort"], receive_port))
        heartbeat = frame.heartbeat or {}
        interval_ms = heartbeat.get("intervalMs", frame.ping_interval_ms)
        if isinstance(interval_ms, (int, float)) and interval_ms > 0:
            self.link.update_heartbeat(float(interval_ms) / 1000)

    def _on_link(self, frame: LinkFrame) -> None:
        unity = frame.unity or {}
        self._unity_link_status = UnityLinkStatus(
            reachability=str(unity.get("reachability", "unknown")),
            last_rtt_ms=unity.get("lastRttMs"),
            consecutive_losses=int(unity.get("consecutiveLosses", 0)),
            last_pong_seq=unity.get("lastPongSeq"),
        )
        self._last_rejection = frame.last_rejection
        rejection = frame.last_rejection
        rejection_text = None
        if rejection is not None:
            reason = rejection.get("reason", "不明")
            detail = rejection.get("detail", "")
            rejection_text = f"{reason}: {detail}" if detail else str(reason)

        manifest = frame.manifest or {}
        if manifest.get("state") == "accepted":
            project_id = manifest.get("projectId")
            entry_count = manifest.get("entryCount", 0)
            if isinstance(project_id, str) and isinstance(entry_count, int):
                self._manifest_status = replace(
                    self._manifest_status,
                    detail="採用済み",
                    project_id=project_id,
                    entry_count=entry_count,
                    last_rejection=rejection_text,
                )
        elif manifest.get("state") == "none" and self._manifest is None:
            self._manifest_status = replace(
                self._manifest_status,
                detail="待機中",
                last_rejection=rejection_text,
            )
        else:
            self._manifest_status = replace(
                self._manifest_status,
                last_rejection=rejection_text,
            )

    # --- 送信 -------------------------------------------------------------

    def _send(self, entry: ManifestEntry, values: tuple[Any, ...]) -> None:
        if is_display_only(entry):
            return

        type_tags = entry.type_tag * len(values)
        self.link.send_osc(
            entry.address,
            [
                {"type": type_tag, "value": value}
                for type_tag, value in zip(type_tags, values, strict=True)
            ],
        )
