"""UI から見たサーフェスの状態。

WebSocket 接続・サーフェス定義・表示値をひとまとめにし、NiceGUI のページからは
ここだけを見ればよいようにする。ページは複数開かれうるので、状態は
プロセス内に 1 つだけ持ち、各ページは revision を見て差分を取り込む。
"""

from __future__ import annotations

import logging
import socket
import struct
import time
from collections import deque
from dataclasses import dataclass, replace
from typing import Any, Callable, Iterable, Literal, Sequence

from .config import AppConfig, UnityTarget
from .entry_rules import trigger_value
from .protocol import (
    OSC_BATCH_MAX_MESSAGES,
    DecodedFrame,
    DesiredFrame,
    HelloFrame,
    LinkFrame,
    NoticeFrame,
    OscFrame,
    OscMessage,
    RuntimeOptionsFrame,
    WireArg,
    SurfaceFrame,
    SurfaceListFrame,
    osc_bundle_size,
)
from .surface_definition import OSC_BATCH_PRACTICAL_LIMIT_BYTES
from .surface_link import LinkOptions, LinkStatus, SurfaceLink
from .surface_model import ActionSpec, ControlSpec, RecordSpec, SurfaceModel, parse_surface, resolve_record_action_steps
from .value_store import (
    DEFAULT_HOLD_TIMEOUT_S,
    DEFAULT_MIN_SEND_INTERVAL_S,
    INPUT_HOLD_TIMEOUT_S,
    ValueStore,
)

logger = logging.getLogger(__name__)

# まとめ送り(アクション)のエコー待ち。LAN 内の往復に十分で、押した直後の失敗に気づける長さ
ACTION_ECHO_TIMEOUT_S = 2.0
# Unity は float32 で受けて返すので、期待値も float32 へ丸めてから比べる。
# 丸めの揺れ(往復での 1〜2 ULP)だけを許し、値の大きさに比例して緩む相対許容差は使わない
_FLOAT32_MAX_ULP = 2
# 0 付近は ULP が極小で、表示の丸め(0 → 1e-5 など)まで落とすため、絶対許容差だけ残す
_FLOAT_TOLERANCE = 1e-4


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


# エコー待ちの照合単位。パラメータはアドレス、レコードは (アドレス, キー)(D-064)
EchoTarget = str | tuple[str, str]


@dataclass
class _ActionBatch:
    """1 回のアクション押下で送った内容と、まだエコーが届いていないアドレス。"""

    label: str
    total: int
    deadline: float
    # 照合単位 -> (期待する値, 値を問わず届けば確認とするか)。後続の押下が同じ対象を送ったら外す。
    # レコードの期待値はキーを除いたフィールドの値
    waiting: dict[EchoTarget, tuple[tuple[Any, ...], bool]]


def _target_text(target: EchoTarget) -> str:
    if isinstance(target, tuple):
        return f"{target[0]} [{target[1]}]"
    return target


def row_channel_key(address: str, key: str) -> str:
    """レコードの 1 行の表示キャッシュのキー。OSC の文字列は NUL を含められないので区切りに使えば衝突しない。"""
    return f"{address}\x00{key}"


@dataclass(frozen=True)
class RecordRow:
    """レコード表の 1 行。marked は「一覧に無い」の印(一覧が届いていて、そこに無いキー。D-064)。"""

    key: str
    listed: bool
    marked: bool


def _same_values(expected: tuple[Any, ...], actual: tuple[Any, ...]) -> bool:
    if len(expected) != len(actual):
        return False
    for want, got in zip(expected, actual):
        # どちらかが文字列なら厳密比較のみ。数値タグのエコーを float() に通すと、
        # "auto" で ValueError、"1" が数値 1 で誤って確認される
        if isinstance(want, str) or isinstance(got, str):
            if want != got:
                return False
        # 整数同士は厳密比較(int32 は 2^24 超で float32 に丸めると別の値が同じになる)
        elif isinstance(want, int) and isinstance(got, int):
            if want != got:
                return False
        elif not _same_float32(float(want), float(got)):
            return False
    return True


def _float32_order(value: float) -> int | None:
    """float32 を、大小順と整数の大小順が一致する整数へ写す(隣り合う float32 は 1 違う)。"""
    try:
        bits = struct.unpack("<i", struct.pack("<f", value))[0]
    except OverflowError:
        return None
    return bits if bits >= 0 else -0x80000000 - bits


def _same_float32(want: float, got: float) -> bool:
    want_order = _float32_order(want)
    got_order = _float32_order(got)
    if want_order is None or got_order is None:
        return want == got
    if abs(want - got) <= _FLOAT_TOLERANCE:
        return True
    return abs(want_order - got_order) <= _FLOAT32_MAX_ULP


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
        self._min_send_interval_s = min_send_interval_s
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
        self._hello: HelloFrame | None = None
        # unity.host がホスト名(localhost / LAN DNS 名)のとき、UDP の送信元は数値
        # アドレスで届くため、名前解決した集合を突き合わせに使う(host 単位でキャッシュ)
        self._resolved_unity_host: str | None = None
        self._resolved_unity_addrs: frozenset[str] = frozenset()
        # ブリッジが組み立てたパラメータ id → 選択肢(D-055)。表示キャッシュで、受けるたびに丸ごと置き換える
        self._runtime_choices: dict[str, tuple[str, ...]] = {}
        self._runtime_options_revision = 0
        # レコード(D-064)。行の表示キャッシュは row_channel_key ごとの ValueChannel(値 = フィールドを宣言順に)。
        # パラメータの ValueStore と分けるのは、tick の送信でアドレスからパラメータを引く経路と混ざらないため
        self.record_values = ValueStore(min_send_interval_s=min_send_interval_s)
        self._record_index: dict[str, RecordSpec] = {}
        # ブリッジが組み立てたキーの一覧(レコード id → キー)と、レコードのフィールドの選択肢。受けるたびに丸ごと置き換える
        self._runtime_keys: dict[str, tuple[str, ...]] = {}
        self._runtime_field_choices: dict[tuple[str, str], tuple[str, ...]] = {}
        # どこかの宛先から一覧が届いている一覧のアドレス。keys は未着でも [] で届くので、印の判定はこちらで行う
        self._arrived_lists: frozenset[str] = frozenset()
        # 保持値(desired)を持つキーを、desired に現れた順に(レコード id → キーの順序つき集合)
        self._desired_keys: dict[str, dict[str, None]] = {}
        self._record_rows_revision = 0
        self._notices: deque[Notice] = deque(maxlen=50)
        self._action_batches: list[_ActionBatch] = []
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
    def definition(self) -> dict[str, Any] | None:
        """採用中の定義(検証済みの生の dict)。編集の出発点であり、呼び出し側は変更しないこと。"""
        return self._definition

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

    def load_surface(self, name: str) -> None:
        self.link.load_surface(name)

    def save_surface(self, name: str, definition: dict[str, Any], *, activate: bool = True) -> bool:
        """検証済みの定義の保存を求める。採用の結果は surface フレームで戻る(値の確定と同じく Unity/ブリッジが正)。"""
        return self.link.save_surface(name, definition, activate=activate)

    @property
    def runtime_options_revision(self) -> int:
        """Unity の一覧が変わるたびに増える。ページはこれを見て選択欄の候補だけを差し替える。"""
        return self._runtime_options_revision

    def runtime_choices(self, param_id: str) -> tuple[str, ...] | None:
        """パラメータの選択肢(静的な options を先頭に含む)。一覧が未着なら None。"""
        return self._runtime_choices.get(param_id)

    def options_for(self, entry: ControlSpec) -> tuple[tuple[str, ...], bool]:
        """欄の候補と、Unity の一覧が届いているか。届くまでは静的な options だけ(候補の規則はここ 1 か所)。"""
        choices = self._runtime_choices.get(entry.param_id)
        if choices is None:
            return entry.options or (), False
        return choices, True

    # --- レコード(D-064) ---------------------------------------------------

    @property
    def record_rows_revision(self) -> int:
        """レコード表の行(キーの一覧・保持値を持つキー・一覧の到着)が変わるたびに増える。ページは行の増減だけを行う。"""
        return self._record_rows_revision

    def field_options_for(self, record_id: str, entry: ControlSpec) -> tuple[tuple[str, ...], bool]:
        """レコードのフィールドの候補と、一覧が届いているか(パラメータの options_for と同じ規則。D-056)。"""
        choices = self._runtime_field_choices.get((record_id, entry.param_id))
        if choices is None:
            return entry.options or (), False
        return choices, True

    def record_rows(self, record: RecordSpec) -> tuple[RecordRow, ...]:
        """行の順: キーの一覧の和集合の順 → 一覧に無いが保持値を持つキーを desired に現れた順。

        一覧が一度も届いていない間は「一覧に無い」と言えないので印を付けない(D-056 と同じ)。
        """
        listed = self._runtime_keys.get(record.record_id, ())
        arrived = record.keys_from_address in self._arrived_lists
        rows: dict[str, RecordRow] = {}
        for key in listed:
            rows.setdefault(key, RecordRow(key, listed=True, marked=False))
        for key in self._desired_keys.get(record.record_id, {}):
            if key not in rows:
                rows[key] = RecordRow(key, listed=False, marked=arrived)
        return tuple(rows.values())

    def record_values_of(self, record: RecordSpec, key: str) -> tuple[Any, ...] | None:
        return self.record_values.values_of(row_channel_key(record.address, key))

    def record_channel(self, record: RecordSpec, key: str) -> Any:
        """行の ValueChannel(無ければ None)。ページが改訂を見て表示を更新するために使う。"""
        return self.record_values.get(row_channel_key(record.address, key))

    def action_row_keys(self, action: ActionSpec) -> tuple[str, ...]:
        """scope "all" のアクションが対象にする行(表示中の全行を表示順に)。レコードが複数なら出現順の和集合。"""
        keys: dict[str, None] = {}
        for record in action.records:
            for row in self.record_rows(record):
                keys.setdefault(row.key, None)
        return tuple(keys)

    def request_runtime_options_refresh(self) -> bool:
        """「一覧を更新」。全宛先へ一覧の要求を送らせる。未接続なら False。"""
        return self.link.request_runtime_options_refresh()

    def request_resend(self, target: str | None = None) -> None:
        """保持値を宛先へ送り直させる(クラッシュ・再起動した台を追いつかせる。D-046)。"""
        self.link.request_resend(target)

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
        if not entry.standalone:
            # 送らない値にはエコーが返らない。離したときに編集前の値へ戻らないよう、その場で確定する
            self.values.channel(entry.address).on_local_immediate(tuple(values), self._clock())
            return
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

    # --- レコードの操作(D-064) ---------------------------------------------

    def begin_record_hold(self, record: RecordSpec, key: str, widget: str | None = None) -> None:
        """行のどれかの欄の操作開始。保護は行単位(1 行 = 1 メッセージなので、欄ごとに分けても送る値は行全体)。"""
        timeout_s = INPUT_HOLD_TIMEOUT_S if widget == "input" else DEFAULT_HOLD_TIMEOUT_S
        self.record_values.channel(row_channel_key(record.address, key)).begin_hold(self._clock(), timeout_s)

    def end_record_hold(self, record: RecordSpec, key: str) -> None:
        values = self.record_values.channel(row_channel_key(record.address, key)).end_hold(self._clock())
        if values is not None:
            self._send_record_row(record, key, values)

    def release_record_holds(self, rows: Iterable[tuple[RecordSpec, str]]) -> None:
        """切断したクライアントが開始した行のホールドを期限に関係なく解放する。"""
        by_channel = {row_channel_key(record.address, key): (record, key) for record, key in rows}
        for channel_key, values in self.record_values.release_holds(by_channel, self._clock()):
            if values is not None:
                record, key = by_channel[channel_key]
                self._send_record_row(record, key, values)

    def set_record_field(self, record: RecordSpec, key: str, index: int, value: Any, *, discrete: bool) -> None:
        """欄の編集。行の全フィールド(他は表示キャッシュの値)を 1 メッセージで送る(D-061)。

        discrete はトグル・選択・入力確定(間引かない)。連続操作(スライダー)は間引き、tick() が後から送る。
        """
        channel = self.record_values.channel(row_channel_key(record.address, key))
        current = list(channel.values if channel.values is not None else record.initial_values())
        current[index] = value
        row = tuple(current)
        if discrete:
            self._send_record_row(record, key, channel.on_local_immediate(row, self._clock()))
            return
        to_send = channel.on_local(row, self._clock())
        if to_send is not None:
            self._send_record_row(record, key, to_send)

    def press_record_trigger(self, record: RecordSpec, key: str) -> None:
        """trigger レコードの行の送信ボタン。`[s:key, 各フィールドの value]` を 1 回だけ送る。"""
        self._send_record_row(record, key, tuple(trigger_value(field) for field in record.fields))

    def press_action(self, action: ActionSpec, key: str | None = None) -> None:
        """アクション(HID-166)の押下。対象の値を定義順に並べ、1 つの oscBatch で送る。

        state は UI が持つ現在値、trigger は定義の value、step の固定値があればそれを送る。
        値がまだ無い state は送れないので外して警告する(黙って欠けると Unity 側が半端な状態になる)。
        送ったあとはエコーが揃うまで待ち、揃わなければ警告する(再送はしない)。
        scope を持つアクション(D-061)は、row なら key の行、all なら表示中の全行について展開する。
        """
        if action.scope is not None:
            self._press_record_action(action, key)
            return

        messages: list[OscMessage] = []
        missing: list[EchoTarget] = []
        waiting: dict[EchoTarget, tuple[tuple[Any, ...], bool]] = {}

        for target in action.targets:
            spec = target.spec
            if spec.kind == "trigger":
                values: tuple[Any, ...] | None = (trigger_value(spec),)
            elif target.has_fixed_value:
                values = (_wire_value(spec, target.fixed_value),)
            else:
                current = self.values.values_of(spec.address)
                values = None if not current else tuple(_wire_value(spec, value) for value in current)
            if values is None:
                missing.append(spec.address)
                continue

            type_tag = spec.type_tag
            messages.append(
                OscMessage(spec.address, tuple(WireArg(type=type_tag, value=value) for value in values))
            )
            waiting[spec.address] = (values, spec.kind == "trigger")

        self._send_action_batch(action.label, messages, waiting, missing)

    def _press_record_action(self, action: ActionSpec, key: str | None) -> None:
        if action.scope == "row":
            if key is None:
                self._add_notice("warn", f"「{action.label}」: 行の指定がありません")
                return
            keys: tuple[str, ...] = (key,)
        else:
            keys = self.action_row_keys(action)
        targets = resolve_record_action_steps(action, keys)
        if len(targets) > OSC_BATCH_MAX_MESSAGES:
            # 展開を上限 + 1 件で打ち切っているので、件数は「上限を超える」としか言えない
            self._add_notice(
                "error", f"「{action.label}」: {len(keys)} 行分は一度に送れる上限({OSC_BATCH_MAX_MESSAGES} 件)を超えています"
            )
            return

        messages: list[OscMessage] = []
        missing: list[EchoTarget] = []
        waiting: dict[EchoTarget, tuple[tuple[Any, ...], bool]] = {}
        for target in targets:
            record = target.record
            if record.kind == "trigger":
                values: tuple[Any, ...] = tuple(trigger_value(field) for field in record.fields)
            else:
                current = self.record_values_of(record, target.key)
                if current is None:
                    missing.append((record.address, target.key))
                    continue
                row = list(current)
                for index, fixed in target.fixed:
                    row[index] = fixed
                values = tuple(_wire_value(field, value) for field, value in zip(record.fields, row))
            messages.append(OscMessage(record.address, _record_wire_args(record, target.key, values)))
            waiting[(record.address, target.key)] = (values, record.kind == "trigger")

        self._send_action_batch(action.label, messages, waiting, missing)

    def _send_action_batch(
        self,
        label: str,
        messages: list[OscMessage],
        waiting: dict[EchoTarget, tuple[tuple[Any, ...], bool]],
        missing: list[EchoTarget],
    ) -> None:
        if missing:
            shown = ", ".join(_target_text(item) for item in missing[:3]) + (" ほか" if len(missing) > 3 else "")
            self._add_notice("warn", f"「{label}」: 値が未設定の {len(missing)} 件は送りませんでした ({shown})")
        if not messages:
            if not missing:
                self._add_notice("warn", f"「{label}」: 送る対象がありません")
            return
        if len(messages) > OSC_BATCH_MAX_MESSAGES:
            self._add_notice("error", f"「{label}」: {len(messages)} 件は一度に送れる上限を超えています")
            return
        size = osc_bundle_size(messages)
        if size > OSC_BATCH_PRACTICAL_LIMIT_BYTES:
            # ブリッジも同じ上限で拒否するが、全行のように件数が実行時に決まるものは送る前に止めて理由を出す
            self._add_notice(
                "error",
                f"「{label}」: {len(messages)} 件 ({size} バイト) は 1 データグラムの上限({OSC_BATCH_PRACTICAL_LIMIT_BYTES} バイト)を超えています",
            )
            return
        if not self.link.send_osc_batch(messages):
            self._add_notice("error", f"「{label}」: ブリッジに接続していないため送れませんでした")
            return

        # 後続の押下が同じ対象を送り直したら、古い待ちはそちらへ引き継ぐ(二重に警告しない)
        for batch in self._action_batches:
            for target in waiting:
                batch.waiting.pop(target, None)
        # 待ちを全部引き継がれた古い押下は、確認できたわけではないので成功も警告も出さず捨てる
        self._action_batches = [batch for batch in self._action_batches if batch.waiting]
        self._action_batches.append(
            _ActionBatch(
                label=label,
                total=len(waiting),
                deadline=self._clock() + ACTION_ECHO_TIMEOUT_S,
                waiting=waiting,
            )
        )

    def _confirm_action_echo(self, target: EchoTarget, values: tuple[Any, ...]) -> None:
        for batch in self._action_batches:
            expectation = batch.waiting.get(target)
            if expectation is None:
                continue
            expected, any_value = expectation
            if any_value or _same_values(expected, values):
                del batch.waiting[target]
        self._finish_action_batches(expired_only=False)

    def _on_batch_rejected(self, detail: str) -> None:
        # ブリッジは拒否したバッチを一つも送らない。フレームは送信順に届くので、拒否されたのは
        # 直近のアクションとみなし、エコー待ちを残さず理由をそのまま伝える(残すと「確認できませんでした」になる)
        if not self._action_batches:
            self._add_notice("error", f"一括送信がブリッジに拒否されました: {detail}")
            return
        batch = self._action_batches.pop()
        self._add_notice("error", f"「{batch.label}」を送れませんでした: {detail}")

    def _expire_action_batches(self) -> None:
        self._finish_action_batches(expired_only=True)

    def _finish_action_batches(self, *, expired_only: bool) -> None:
        now = self._clock()
        remaining: list[_ActionBatch] = []
        for batch in self._action_batches:
            if not batch.waiting:
                if not expired_only or now >= batch.deadline:
                    self._add_notice("info", f"「{batch.label}」を送信しました({batch.total} 件を確認)")
                    continue
            elif now >= batch.deadline:
                missing = list(batch.waiting)
                shown = ", ".join(_target_text(item) for item in missing[:3]) + (" ほか" if len(missing) > 3 else "")
                self._add_notice(
                    "error",
                    f"「{batch.label}」: {len(missing)} / {batch.total} 件のエコーを確認できませんでした ({shown})",
                )
                continue
            remaining.append(batch)
        self._action_batches = remaining

    def tick(self) -> None:
        """保留値の送信と、全チャネルの期限切れホールド解除を行う。"""
        now = self._clock()
        self._expire_action_batches()

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

        released = [(key, values) for key, values in self.record_values.release_all_holds(now) if values is not None]
        for channel_key, values in [*released, *self.record_values.flush_due(now)]:
            address, _, key = channel_key.partition("\x00")
            record = self._record_index.get(address)
            if record is not None:
                self._send_record_row(record, key, values)

    def entry_for(self, address: str) -> ControlSpec | None:
        return self._entry_index.get(address)

    # --- リンクからの受信 -------------------------------------------------

    def _on_link_status(self, status: LinkStatus) -> None:
        self._link_status = status

        if not status.connected and (
            self._runtime_choices or self._runtime_keys or self._runtime_field_choices or self._arrived_lists
        ):
            # 古い一覧を現在のものとして見せない。再接続の surfaceRequest で runtimeOptions が全量で届く(D-055)
            self._runtime_choices = {}
            self._runtime_keys = {}
            self._runtime_field_choices = {}
            self._arrived_lists = frozenset()
            self._runtime_options_revision += 1
            self._record_rows_revision += 1

        if not status.connected:
            # 送信途中の状態を捨てる。再接続後の値はブリッジの desired で復元する。
            self.values.reset_send_state()
            self.record_values.reset_send_state()
            # 切断中はエコーが届かないので、待ちを残して「確認できません」と誤報しない
            self._action_batches = []

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
            if frame.active is None and self._surface is not None:
                self._clear_surface()
            return

        if isinstance(frame, DesiredFrame):
            self._on_desired(frame)
            return

        if isinstance(frame, RuntimeOptionsFrame):
            self._on_runtime_options(frame)
            return

        if isinstance(frame, NoticeFrame):
            if frame.code == "surface-rejected":
                self._add_notice("error", f"定義を採用できません: {frame.detail}")
            elif frame.code == "batch-rejected":
                self._on_batch_rejected(frame.detail)
            return

        if not isinstance(frame, OscFrame):
            return

        if frame.address.startswith("/sys/"):
            return

        # Unity のエコーは届いた確認として表示へ反映する。oscUi 有効時は OSC ネイティブ
        # UI の操作値も from つきの osc フレームとして届くため、送信元ホストが Unity で
        # ないものは表示キャッシュへ入れない。hello 前(unity 未取得)も確定させない
        if frame.source is None or not self._is_unity_source(frame.source.host):
            return

        record = self._record_index.get(frame.address)
        if record is not None:
            # レコードのエコーは先頭の s のキーで行へ振り分ける。形の合わないもの(キーなし・フィールドの数や型違い)は捨てる。
            # 行は作らない(行はキーの一覧と保持値から来る。D-064)
            key = record.key_of(frame.args)
            if key is None:
                return
            fields = tuple(arg.value for arg in frame.args[1:])
            self._confirm_action_echo((frame.address, key), fields)
            if record.kind == "state":
                self.record_values.on_echo(row_channel_key(record.address, key), fields)
            return

        # 現在の定義に無いアドレス(計画外・未採用)は表示にもキャッシュにも入れない
        if frame.address not in self._entry_index:
            return

        echoed = tuple(arg.value for arg in frame.args)
        # 引数なしの応答でも、トリガーの到着確認には使える
        self._confirm_action_echo(frame.address, echoed)
        if echoed:
            self.values.on_echo(frame.address, echoed)

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
        # 古い定義への押下は、エコーが捨てられて「確認できません」と誤報になるので待たない
        self._action_batches = []
        self._entry_index = {spec.address: spec for spec in surface.parameters}
        self._surface_revision += 1

        # 再描画で編集中のコントロールは破棄されるため、ホールドは送信せずに打ち切り
        # (保留中の間引き値も下書きも破棄)、見えなくなった値が後から送られないようにする
        cancelled = self.values.cancel_all_holds()
        if cancelled:
            logger.info("surface changed: cancelled %d hold(s) without sending: %s", len(cancelled), ", ".join(cancelled))

        # 続く desired(full) が届くまでの表示として default を入れる。OSC は送らない
        self.values.seed_defaults([spec for spec in surface.parameters if spec.kind == "state"])
        self._reset_records(surface)

    def _reset_records(self, surface: SurfaceModel | None) -> None:
        """定義が替わったら行の表示キャッシュを捨てる。行と値は続く desired(full) と runtimeOptions で揃い直す。

        キーの一覧(runtimeOptions)はレコード id で引くので残す。ブリッジは採用のたびに全量を送り直す(D-055)。
        """
        self.record_values.cancel_all_holds()
        self.record_values = ValueStore(min_send_interval_s=self._min_send_interval_s)
        self._record_index = {} if surface is None else {record.address: record for record in surface.records}
        self._desired_keys = {}
        self._record_rows_revision += 1
        self._seed_record_rows()

    def _clear_surface(self) -> None:
        """採用中の定義が無くなったとき、古いコントロールを残さない。

        ブリッジ再起動後に有効な既定サーフェスが無いと surfaceList(active: null) だけが届く。
        ここで消さないと旧コントロールが残り、旧アドレスへ OSC を送り続けられる。
        """
        self.values.cancel_all_holds()
        self._action_batches = []
        self._definition = None
        self._surface = None
        self._entry_index = {}
        self._reset_records(None)
        self._surface_status = SurfaceStatus(detail="待機中")
        self._surface_revision += 1

    def _on_desired(self, frame: DesiredFrame) -> None:
        """ブリッジが保持する狙いの値(D-045)を表示キャッシュへ取り込む。OSC は送らない。"""
        values: dict[str, tuple[Any, ...]] = {}
        # レコードの保持値はキーごとに 1 エントリ(address = レコードの address、args[0] がキー。D-061)
        record_rows: dict[str, dict[str, tuple[Any, ...]]] = {}
        for item in frame.values:
            record = self._record_index.get(item.address)
            if record is not None:
                key = record.key_of(item.args) if record.kind == "state" else None
                if key is not None:
                    record_rows.setdefault(record.record_id, {})[key] = tuple(arg.value for arg in item.args[1:])
                continue
            if item.address not in self._entry_index:
                continue
            if any(arg.type == "b" for arg in item.args) or not item.args:
                continue
            values[item.address] = tuple(arg.value for arg in item.args)

        self._on_desired_records(record_rows, full=frame.full)

        if frame.full:
            # standalone:false はブリッジが保持しない UI だけの値なので、全量で消さない(まとめ送りの材料)
            state_addresses = [
                spec.address for spec in self._entry_index.values() if spec.kind == "state" and spec.standalone
            ]
            self.values.replace_all(state_addresses, values)
            return

        for address, arg_values in values.items():
            self.values.on_echo(address, arg_values)

    def _on_desired_records(self, rows: dict[str, dict[str, tuple[Any, ...]]], *, full: bool) -> None:
        """レコードの保持値を行の表示キャッシュへ取り込む。full は全キーの全量、差分は変わったキーだけ。"""
        changed = False
        for record in self._record_index.values():
            if record.kind != "state":
                continue
            incoming = rows.get(record.record_id, {})
            known = self._desired_keys.setdefault(record.record_id, {})
            if full:
                # 保持値から消えたキーは行の表示値も消す(一覧にあれば default で埋め直す)
                dropped = [key for key in known if key not in incoming]
                self.record_values.replace_all(
                    [row_channel_key(record.address, key) for key in dropped],
                    {},
                )
                for key in dropped:
                    del known[key]
                changed = changed or bool(dropped)
            for key, values in incoming.items():
                if key not in known:
                    known[key] = None
                    changed = True
                self.record_values.on_echo(row_channel_key(record.address, key), values)
        if changed:
            self._record_rows_revision += 1
            self._seed_record_rows()

    def _on_runtime_options(self, frame: RuntimeOptionsFrame) -> None:
        choices = dict(frame.choices)
        keys = {record_id: tuple(dict.fromkeys(key for key in names if key)) for record_id, names in frame.keys}
        field_choices = {(record_id, field_id): options for record_id, field_id, options in frame.field_choices}
        arrived = frozenset(item.address for item in frame.lists if item.targets)
        if (choices, keys, field_choices, arrived) == (
            self._runtime_choices,
            self._runtime_keys,
            self._runtime_field_choices,
            self._arrived_lists,
        ):
            return
        rows_changed = keys != self._runtime_keys or arrived != self._arrived_lists
        self._runtime_choices = choices
        self._runtime_keys = keys
        self._runtime_field_choices = field_choices
        self._arrived_lists = arrived
        self._runtime_options_revision += 1
        if rows_changed:
            self._record_rows_revision += 1
            self._seed_record_rows()

    def _seed_record_rows(self) -> None:
        """値の無い行(一覧に現れたが保持値がまだ届いていないキー)へ、新しい行の値(default)を表示用に入れる。

        ブリッジも同じ default で行を作って desired を配る(D-061)ので、届くまでの表示として食い違わない。OSC は送らない。
        """
        for record in self._record_index.values():
            if record.kind != "state":
                continue
            for row in self.record_rows(record):
                channel = self.record_values.channel(row_channel_key(record.address, row.key))
                if channel.values is None and not channel.holding:
                    channel.on_echo(record.initial_values())

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

    # --- 送信 -------------------------------------------------------------

    def _send_record_row(self, record: RecordSpec, key: str, values: tuple[Any, ...]) -> None:
        self.link.send_osc(
            record.address,
            [{"type": arg.type, "value": arg.value} for arg in _record_wire_args(record, key, values)],
        )

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


def _record_wire_args(record: RecordSpec, key: str, values: Sequence[Any]) -> tuple[WireArg, ...]:
    """1 行分の OSC 引数 `[s:key, フィールドを宣言順に]`(TS の recordArgs と同じ。bool は 0/1 の i)。"""
    return (
        WireArg(type="s", value=key),
        *(WireArg(type=field.type_tag, value=_wire_value(field, value)) for field, value in zip(record.fields, values, strict=True)),
    )


def _wire_value(spec: ControlSpec, value: Any) -> Any:
    """OSC に載せる型へ揃える(bool は 0/1 の int、f は float、i は int)。"""
    if spec.type == "bool":
        return 1 if value else 0
    if spec.type == "f":
        return float(value)
    if spec.type == "i":
        return int(value)
    return value
