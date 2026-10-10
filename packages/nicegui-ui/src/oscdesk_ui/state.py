"""UI から見たサーフェスの状態。

WebSocket 接続・サーフェス定義・表示値をひとまとめにし、NiceGUI のページからは
ここだけを見ればよいようにする。ページは複数開かれうるので、状態は
プロセス内に 1 つだけ持ち、各ページは revision を見て差分を取り込む。
"""

from __future__ import annotations

import logging
import socket
import time
from collections import deque
from dataclasses import dataclass, replace
from typing import Any, Callable, Iterable, Literal, Sequence

from .config import AppConfig, UnityTarget
from .entry_rules import trigger_value
from .protocol import (
    DecodedFrame,
    DesiredFrame,
    HelloFrame,
    LinkFrame,
    NoticeFrame,
    OscFrame,
    SurfaceFrame,
    SurfaceListFrame,
)
from .surface_link import LinkOptions, LinkStatus, SurfaceLink
from .surface_model import ControlSpec, SurfaceModel, parse_surface
from .value_store import (
    DEFAULT_HOLD_TIMEOUT_S,
    DEFAULT_MIN_SEND_INTERVAL_S,
    INPUT_HOLD_TIMEOUT_S,
    ValueStore,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Notice:
    seq: int
    level: Literal["info", "warn", "error"]
    message: str


def _resolve_host_addresses(host: str) -> frozenset[str]:
    """設定上のホスト名を数値アドレスの集合へ解決する。失敗時は空集合(文字列比較のみ)。"""
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return frozenset()
    return frozenset(str(info[4][0]) for info in infos)


@dataclass(frozen=True)
class SurfaceStatus:
    detail: str
    name: str | None = None
    revision: int | None = None
    parameter_count: int = 0


@dataclass(frozen=True)
class UnityLinkStatus:
    reachability: str = "unknown"
    last_rtt_ms: float | None = None
    consecutive_losses: int = 0
    last_pong_seq: int | None = None


@dataclass(frozen=True)
class UnityTargetLinkStatus:
    name: str
    primary: bool
    reachability: str = "unknown"
    last_rtt_ms: float | None = None
    consecutive_losses: int = 0


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

        self._surface: SurfaceModel | None = None
        self._definition: dict[str, Any] | None = None
        self._entry_index: dict[str, ControlSpec] = {}
        self._surface_revision = 0
        self._surface_status = SurfaceStatus(detail="待機中")
        self._surface_names: tuple[str, ...] = ()
        self._active_surface: str | None = None
        self._link_status = LinkStatus(connected=False, detail="未接続")
        self._unity_link_status = UnityLinkStatus()
        self._unity_targets: tuple[UnityTargetLinkStatus, ...] = ()
        self._last_rejection: dict[str, Any] | None = None
        self._hello: HelloFrame | None = None
        # unity.host がホスト名(localhost / LAN DNS 名)のとき、UDP の送信元は数値
        # アドレスで届くため、名前解決した集合を突き合わせに使う(host 単位でキャッシュ)
        self._resolved_unity_host: str | None = None
        self._resolved_unity_addrs: frozenset[str] = frozenset()
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
    def surface(self) -> SurfaceModel | None:
        return self._surface

    @property
    def surface_revision(self) -> int:
        """画面の作り直しが必要になるたびに増える。ページはこれを見て再構築する。"""
        return self._surface_revision

    @property
    def surface_status(self) -> SurfaceStatus:
        return self._surface_status

    @property
    def surface_names(self) -> tuple[str, ...]:
        return self._surface_names

    @property
    def active_surface(self) -> str | None:
        return self._active_surface

    @property
    def link_status(self) -> LinkStatus:
        return self._link_status

    @property
    def unity_link_status(self) -> UnityLinkStatus:
        return self._unity_link_status

    @property
    def unity_targets(self) -> tuple[UnityTargetLinkStatus, ...]:
        """冗長構成の宛先ごとの到達性(主系が先頭)。link フレーム受信前は空。"""
        return self._unity_targets

    def request_resend(self, target: str | None = None) -> None:
        """保持値を宛先へ送り直させる(クラッシュ・再起動した台を追いつかせる。D-046)。"""
        self.link.request_resend(target)

    @property
    def last_rejection(self) -> dict[str, Any] | None:
        return self._last_rejection

    @property
    def hello(self) -> HelloFrame | None:
        return self._hello

    def notices_since(self, cursor: int) -> tuple[Notice, ...]:
        return tuple(notice for notice in self._notices if notice.seq > cursor)

    # --- UI からの操作 ----------------------------------------------------

    def begin_hold(self, address: str, widget: str | None = None) -> None:
        """widget は配置された部品の種類。省くとパラメータの既定の部品で判断する。"""
        if widget is None:
            entry = self.entry_for(address)
            widget = entry.widget if entry is not None else None
        timeout_s = INPUT_HOLD_TIMEOUT_S if widget == "input" else DEFAULT_HOLD_TIMEOUT_S
        self.values.channel(address).begin_hold(self._clock(), timeout_s)

    def end_hold(self, entry: ControlSpec) -> None:
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

    def set_local(self, entry: ControlSpec, values: Sequence[Any]) -> None:
        """UI 操作による値変更。間引きに掛かった分は tick() が後から送る。"""
        to_send = self.values.channel(entry.address).on_local(tuple(values), self._clock())

        if to_send is not None:
            self._send(entry, to_send)

    def set_discrete(self, entry: ControlSpec, values: Sequence[Any]) -> None:
        """トグル・選択・入力確定の操作。取りこぼすと状態が食い違うため間引かない。"""
        to_send = self.values.channel(entry.address).on_local_immediate(tuple(values), self._clock())
        self._send(entry, to_send)

    def set_draft(self, entry: ControlSpec, raw: Any) -> None:
        self.values.set_draft(entry.address, raw)

    def press_trigger(self, entry: ControlSpec) -> None:
        """トリガの押下。定義の value を 1 回だけ送る(値は保持・表示しない。D-043)。"""
        self._send(entry, (trigger_value(entry),))

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

    def entry_for(self, address: str) -> ControlSpec | None:
        return self._entry_index.get(address)

    # --- リンクからの受信 -------------------------------------------------

    def _on_link_status(self, status: LinkStatus) -> None:
        self._link_status = status

        if not status.connected:
            # 送信途中の状態を捨てる。再接続後の値はブリッジの desired で復元する。
            self.values.reset_send_state()

    def _on_frame(self, frame: DecodedFrame) -> None:
        """接続層から届く全フレームの入口。種別の分岐はここだけで行う。"""
        if isinstance(frame, HelloFrame):
            self._on_hello(frame)
            return

        if isinstance(frame, LinkFrame):
            self._on_link(frame)
            return

        if isinstance(frame, SurfaceFrame):
            self._on_surface(frame)
            return

        if isinstance(frame, SurfaceListFrame):
            self._surface_names = frame.names
            self._active_surface = frame.active
            return

        if isinstance(frame, DesiredFrame):
            self._on_desired(frame)
            return

        if isinstance(frame, NoticeFrame):
            if frame.code == "surface-rejected":
                self._add_notice("error", f"定義を採用できません: {frame.detail}")
            return

        if not isinstance(frame, OscFrame):
            return

        if frame.address.startswith("/sys/"):
            return

        if not frame.args:
            return

        # Unity のエコーは届いた確認として表示へ反映する。oscUi 有効時は OSC ネイティブ
        # UI の操作値も from つきの osc フレームとして届くため、送信元ホストが Unity で
        # ないものは表示キャッシュへ入れない。hello 前(unity 未取得)も確定させない
        if frame.source is None or not self._is_unity_source(frame.source.host):
            return

        # 現在の定義に無いアドレス(計画外・未採用)は表示にもキャッシュにも入れない
        if frame.address not in self._entry_index:
            return

        self.values.on_echo(frame.address, tuple(arg.value for arg in frame.args))

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

    def _on_surface(self, frame: SurfaceFrame) -> None:
        definition = frame.definition
        if definition is None:
            return

        try:
            surface = parse_surface(definition)
        except (KeyError, TypeError) as error:
            # デコーダが検証済みのため通常は起きない。起きたら直前の画面を維持する
            logger.error("サーフェス定義を取り込めません: %r", error)
            self._surface_status = replace(self._surface_status, detail="不正")
            return

        changed = definition != self._definition or frame.name != self._surface_status.name
        self._surface_status = SurfaceStatus(
            detail="採用済み",
            name=frame.name,
            revision=frame.revision,
            parameter_count=len(surface.parameters),
        )
        if not changed:
            # 同じ内容の再配信(ブリッジは再採用のたびに revision を増やす)では画面を作り直さない
            return

        self._definition = definition
        self._surface = surface
        self._entry_index = {spec.address: spec for spec in surface.parameters}
        self._surface_revision += 1

        # 再描画で編集中のコントロールは破棄されるため、ホールドは送信せずに打ち切り
        # (保留中の間引き値も下書きも破棄)、見えなくなった値が後から送られないようにする
        cancelled = self.values.cancel_all_holds()
        if cancelled:
            logger.info("surface changed: cancelled %d hold(s) without sending: %s", len(cancelled), ", ".join(cancelled))

        # 続く desired(full) が届くまでの表示として default を入れる。OSC は送らない
        self.values.seed_defaults([spec for spec in surface.parameters if spec.kind == "state"])

    def _on_desired(self, frame: DesiredFrame) -> None:
        """ブリッジが保持する狙いの値(D-045)を表示キャッシュへ取り込む。OSC は送らない。"""
        values: dict[str, tuple[Any, ...]] = {}
        for item in frame.values:
            if item.address not in self._entry_index:
                continue
            if any(arg.type == "b" for arg in item.args) or not item.args:
                continue
            values[item.address] = tuple(arg.value for arg in item.args)

        if frame.full:
            state_addresses = [spec.address for spec in self._entry_index.values() if spec.kind == "state"]
            self.values.replace_all(state_addresses, values)
            return

        for address, arg_values in values.items():
            self.values.on_echo(address, arg_values)

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
        self._unity_targets = tuple(
            UnityTargetLinkStatus(
                name=str(item.get("name", "")),
                primary=bool(item.get("primary", False)),
                reachability=str(item.get("reachability", "unknown")),
                last_rtt_ms=item.get("lastRttMs"),
                consecutive_losses=int(item.get("consecutiveLosses", 0)),
            )
            for item in frame.targets
        )
        self._last_rejection = frame.last_rejection

    # --- 送信 -------------------------------------------------------------

    def _send(self, entry: ControlSpec, values: tuple[Any, ...]) -> None:
        # 単独で送らない定義(standalone: false)は、まとめ送り(HID-166)の対象としてのみ
        # 送る。ここで送るとブリッジの保持対象外の値が Unity にだけ届いてしまう
        if not entry.standalone:
            return

        type_tags = entry.type_tag * len(values)
        self.link.send_osc(
            entry.address,
            [
                {"type": type_tag, "value": value}
                for type_tag, value in zip(type_tags, values, strict=True)
            ],
        )
