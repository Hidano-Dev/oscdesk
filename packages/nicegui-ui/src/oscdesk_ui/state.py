"""UI から見たサーフェスの状態。

WebSocket 接続・サーフェス定義・表示値をひとまとめにし、NiceGUI のページからは
ここだけを見ればよいようにする。ページは複数開かれうるので、状態は
プロセス内に 1 つだけ持ち、各ページは revision を見て差分を取り込む。
"""

from __future__ import annotations

import logging
import struct
import time
import uuid
from collections import deque
from dataclasses import dataclass, replace
from typing import Any, Callable, Iterable, Literal, Sequence

from .config import AppConfig, UnityTarget
from .delivery_lights import DeliveryLights
from .entry_rules import trigger_value
from .osc_pad import PadCache
from .protocol import (
    OSC_BATCH_MAX_MESSAGES,
    BatchParam,
    BatchRow,
    BlueprintStatusFrame,
    CatalogFrame,
    DecodedFrame,
    DesiredFrame,
    EchoFrame,
    DeliveryFrame,
    DestinationsFrame,
    HelloFrame,
    LinkFrame,
    LockEntry,
    LocksFrame,
    NetworkSettingsFrame,
    NoticeFrame,
    PadFrame,
    PadListFrame,
    PendingOptionList,
    DesiredStatusFrame,
    ProjectFrame,
    ProjectInspectionFrame,
    ProjectSummary,
    SurfaceEditedFrame,
    RuntimeOptionsFrame,
    SentLogFrame,
    SurfaceFrame,
    SurfaceListFrame,
    lock_ref,
)
from .sent_log import SentLogCache
from .surface_definition import join_bindings
from .surface_link import LinkOptions, LinkStatus, SurfaceLink
from .surface_model import ActionSpec, ControlSpec, RecordSpec, SurfaceModel, json_value, parse_surface, resolve_record_action_steps
from .value_store import (
    DEFAULT_HOLD_TIMEOUT_S,
    DEFAULT_MIN_SEND_INTERVAL_S,
    INPUT_HOLD_TIMEOUT_S,
    ValueStore,
)

logger = logging.getLogger(__name__)

# 操作中のロック(HID-378)の延長の間隔。期限(2 秒)より十分短くし、1 回取りこぼしても切れないようにする。
# 部品(page)と Record の行(record_table)の両方が使う
LOCK_RENEW_INTERVAL_S = 0.5


def describe_network_rejection(detail: str) -> str:
    """network-settings-rejected の理由(D-113)を画面向けの文にする。知らない理由はそのまま見せる。"""
    reason, _, value = detail.partition(": ")
    messages = {
        "would-lock-out": "この変更をすると、操作しているブラウザ({value})が接続できなくなります",
        "invalid-target-interface": "{value} はこの PC のアドレスではありません",
        "invalid-target-range": "ターゲットがいる範囲「{value}」は IPv4 の CIDR(例 192.168.1.0/24)ではありません",
        "invalid-allowed-browser": "接続してよい範囲「{value}」は CIDR かアドレスではありません",
        "rebind-failed": "ターゲット向けのネットワークで待ち受けられませんでした({value})",
        "stale-revision": "ほかのブラウザが先に設定を変えました。今の設定を確かめてから、もう一度保存してください",
        "not-allowed": "このブラウザ({value})は接続してよい範囲の外です",
    }
    template = messages.get(reason)
    return detail if template is None else template.format(value=value)

# まとめ送り(アクション)のエコー待ち。LAN 内の往復に十分で、押した直後の失敗に気づける長さ
ACTION_ECHO_TIMEOUT_S = 2.0
# 受け取られていないプロジェクトの書き出し(D-090)を何件まで置いておくか
_MAX_PENDING_PROJECT_EXPORTS = 4
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


# エコー待ちの照合単位。パラメータはパラメータ id、レコードは (レコード id, キー)(D-064・HID-389)
EchoTarget = str | tuple[str, str]


@dataclass
class _ActionBatch:
    """1 回のアクション押下で送った内容と、まだエコーが届いていない対象。"""

    label: str
    total: int
    deadline: float
    # 照合単位 -> (期待する値, 値を問わず届けば確認とするか)。後続の押下が同じ対象を送ったら外す。
    # レコードの期待値はキーを除いたフィールドの値
    waiting: dict[EchoTarget, tuple[tuple[Any, ...], bool]]


def row_channel_key(record_id: str, key: str) -> str:
    """レコードの 1 行の表示キャッシュのキー。レコード id は NUL を含まず、行のキーも NUL を送れないので区切りに使えば衝突しない。"""
    return f"{record_id}\x00{key}"


@dataclass(frozen=True)
class RecordRow:
    """レコード表の 1 行。marked は「一覧に無い」の印(一覧が届いていて、そこに無いキー。D-064)。

    key は行を指す識別子(UI で管理する行では ID。D-087)で、name は表示する名前(それ以外の行では key と同じ)。
    """

    key: str
    listed: bool
    marked: bool
    name: str = ""

    @property
    def label(self) -> str:
        return self.name or self.key


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
        # 採用中の定義の結び付け(D-117)。OSC のアダプタがあるときだけ osc を持ち、編集モードのアドレスの欄にだけ使う
        self._bindings: dict[str, Any] = {}
        self._selectors: tuple[tuple[str, tuple[str, ...]], ...] = ()
        # パラメータ id → 部品の情報
        self._entry_index: dict[str, ControlSpec] = {}
        # 今の画面の全部品(既定の部品と画面に置いた部品)。古い画面の部品からの送信を見分ける
        # 今の画面の部品(同一性で照合する。id(spec) → spec。値が等しいだけの旧画面の部品を通さないため)
        self._current_specs: dict[int, ControlSpec] = {}
        self._surface_revision = 0
        self._surface_status = SurfaceStatus(detail="待機中")
        self._surface_names: tuple[str, ...] = ()
        self._active_surface: str | None = None
        self._link_status = LinkStatus(connected=False, detail="未接続")
        self._unity_link_status = UnityLinkStatus()
        self._unity_targets: tuple[UnityTargetLinkStatus, ...] = ()
        self._hello: HelloFrame | None = None
        # 操作中のロック(HID-378)。ブリッジが配る全量の表示キャッシュと、部品(アドレス)ごとの操作中のページ(holder)。
        # このプロセスは複数のブラウザのページを 1 本の接続にまとめるので、送る値には操作したページの holder を付ける
        self._locks: tuple[LockEntry, ...] = ()
        self.locks_revision = 0
        self._operators: dict[str, str] = {}
        # Record の行(row_channel_key)ごとの操作中のページ(HID-390)。行の送信(setRow)に付ける
        self._row_operators: dict[str, str] = {}
        # 設計図(D-104・HID-386)。PC ごとの全量と、採用中の画面との突き合わせ。どちらもブリッジが配るものの表示キャッシュ
        self._catalog_pcs: tuple[dict[str, Any], ...] = ()
        self._blueprint_pc: dict[str, str] | None = None
        self._absent_params: frozenset[str] = frozenset()
        self.catalog_revision = 0
        # 設計図が送り元と一致していない PC(送信元ホスト)。送信先パネルがそのブロックの枠を赤く示す(D-118)
        self._catalog_mismatched: frozenset[str] = frozenset()
        # ブリッジが組み立てたパラメータ id → 選択肢(D-055)。表示キャッシュで、受けるたびに丸ごと置き換える
        self._runtime_choices: dict[str, tuple[str, ...]] = {}
        self._runtime_options_revision = 0
        # レコード(D-064)。行の表示キャッシュは row_channel_key ごとの ValueChannel(値 = フィールドを宣言順に)。
        # パラメータの ValueStore と分けるのは、tick の送信でパラメータ id から部品を引く経路と混ざらないため
        self.record_values = ValueStore(min_send_interval_s=min_send_interval_s)
        # レコード id → レコード
        self._record_index: dict[str, RecordSpec] = {}
        # ブリッジが組み立てたキーの一覧(レコード id → キー)と、レコードのフィールドの選択肢。受けるたびに丸ごと置き換える
        self._runtime_keys: dict[str, tuple[str, ...]] = {}
        # UI で管理する行(D-087)の Name(レコード id → 行の ID → Name)。行を指す状態は ID で持ち、Name は表示と送信にだけ使う
        self._runtime_key_names: dict[str, dict[str, str]] = {}
        self._runtime_field_choices: dict[tuple[str, str], tuple[str, ...]] = {}
        # どこかの宛先から一覧が届いている一覧の id。keys は未着でも [] で届くので、印の判定はこちらで行う
        self._arrived_lists: frozenset[str] = frozenset()
        # 届いたが反映していない一覧(D-088)。反映済みの一覧はブリッジが持ち、ここは表示キャッシュ
        self._pending_options: tuple[PendingOptionList, ...] = ()
        self._pending_options_revision = 0
        # 保持値(desired)を持つキーを、desired に現れた順に(レコード id → キーの順序つき集合)
        self._desired_keys: dict[str, dict[str, None]] = {}
        # 行のホールド中にこのプロセスで編集したフィールドの添字(row_channel_key → 添字)。ホールド中に届いた
        # エコー・保持値は、これ以外の欄にだけ映す。映さないと、入力欄にフォーカスしている間に他の操作者や
        # Unity が変えた欄を、確定のときに古い値で送り返してしまう(1 行 = 1 メッセージのため)
        self._record_edits: dict[str, set[int]] = {}
        self._record_rows_revision = 0
        self._notices: deque[Notice] = deque(maxlen=50)
        # ブリッジが Unity へ送った OSC の記録(D-067)。切断しても残し、再接続の full で置き換わる
        self.sent_log = SentLogCache()
        # 宛先タブ(D-078)。ブリッジが持つ選択と走査の結果の表示キャッシュで、届くたびに丸ごと置き換える
        self._destinations: DestinationsFrame | None = None
        self._destinations_revision = 0
        # 送り先の PC の点灯(到達のイベント。D-116)。ブリッジが配る delivery を、ホストごとの色に畳む
        self.delivery_lights = DeliveryLights()
        # ブリッジが宛先の選択を断った回数(宛先タブが未確定の選択を捨てる合図)
        self._destinations_rejections = 0
        # ブリッジが端末の名前を断った回数(名前のダイアログが確認待ちをやめる合図。D-092)
        self._destination_alias_rejections = 0
        self._action_batches: list[_ActionBatch] = []
        self._notice_seq = 0
        # OSC パッド(D-080)。サーフェス定義とは独立に採用・切り替わる表示キャッシュ
        self.pad = PadCache()
        # プロジェクトファイル(D-090)。書き出しの応答は要求の印ごとに置き、要求したページが受け取る
        # (UI のプロセスはブリッジへの接続を 1 本だけ持ち、複数のページの要求が同じ接続に乗るため)
        # 値は届いた project の中身、または断られた・届かなかった理由の文字列(ページは保留を消して終える)
        self._project_exports: dict[str, dict[str, Any] | str] = {}
        # 応答待ちの要求(送った順)。ブリッジは 1 本の接続の上りを順に処理して同期的に答えるので、
        # 印を持たない拒否の notice(project-export-rejected)は、最も古い応答待ちの要求への答えとみなせる
        self._project_requests_in_flight: deque[str] = deque()
        self._project_request_seq = 0
        # 読み込む前の検査(D-122)の答え。要求の印ごとに置き、要求したページが受け取る。値は要約(通った)か、
        # 断られた・届かなかった理由の文字列。答えは必ず印を持つので、応答待ちは切断で「届かなかった」にするためだけに持つ
        self._project_inspections: dict[str, ProjectSummary | str] = {}
        self._project_inspections_in_flight: set[str] = set()
        # 編集命令(D-123)の答え。要求の印ごとに置き、送った編集モードの作業コピーが受け取る。値は編集後の作業コピー(dict)か、
        # 断られた・届かなかった理由の文字列
        self._surface_edits: dict[str, dict[str, Any] | str] = {}
        self._surface_edits_in_flight: set[str] = set()
        self._surface_edit_seq = 0
        # 保持値をまだ Unity へ送っていないか(取り込んだ時刻)。切断しても最後に知った状態を残す
        # (未送信を見落とさない側に倒す。再接続の surfaceRequest で desiredStatus が届き直す)
        self._desired_unsent_since: str | None = None
        # ネットワークの設定(D-113)。ブリッジが持つ設定の表示キャッシュで、許可リストは UI の HTTP の判定にも使う。
        # 切断しても最後に届いたものを残す(切れている間に許可リストが素通しにも締め出しにもならないように)
        self._network_settings: NetworkSettingsFrame | None = None
        self._network_settings_revision = 0
        # ブリッジがネットワークの設定の変更を断った回数(ネットワークのタブが確認待ちをやめる合図)
        self._network_settings_rejections = 0

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
        """採用中の定義の本体(検証済みの生の dict。結び付けを含まない)。呼び出し側は変更しないこと。"""
        return self._definition

    @property
    def bindings(self) -> dict[str, Any]:
        """採用中の定義の結び付け(D-117)。ブリッジが OSC のアダプタを持つときだけ osc を持つ。"""
        return self._bindings

    @property
    def editable_definition(self) -> dict[str, Any] | None:
        """編集の出発点(本体に結び付けを添えたもの)。編集モードはこれを複製して変える(呼び出し側は変更しないこと)。"""
        if self._definition is None:
            return None
        return join_bindings(self._definition, self._bindings)

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
        """検証済みの定義の保存を求める。採用の結果は surface フレームで戻る(値の確定と同じく Unity/ブリッジが正)。

        definition に bindings が入っていれば(編集した定義)本体と結び付けに分けて 1 フレームで送る(D-117)。
        """
        body = {key: value for key, value in definition.items() if key != "bindings"}
        bindings = definition.get("bindings")
        return self.link.save_surface(name, body, bindings=bindings if isinstance(bindings, dict) else None, activate=activate)

    # --- OSC パッド(D-080) ------------------------------------------------

    def press_pad(self, button_id: str, version: str) -> bool:
        """採用中のパッドのボタンを押す。保持値にも表示値にも触れない(きっかけを撃つだけ)。送れなければ False。

        version は押した画面が描いたパッドの版(pad フレームの version)。描いた後に上書き保存されたり
        ブリッジが再起動したりしていればブリッジが断る(同じ id の別のボタンを撃たない)。
        """
        if self.pad.name is None or not version:
            return False
        return self.link.press_pad(self.pad.name, version, button_id)

    def save_pad(self, name: str, pad: dict[str, Any]) -> bool:
        """保存と採用を求める。結果は pad フレームで戻る(UI は保存成功を自分で確定しない)。"""
        return self.link.save_pad(name, pad)

    def load_pad(self, name: str) -> bool:
        return self.link.load_pad(name)

    # --- プロジェクトファイル(D-090) -------------------------------------

    def request_project_export(self) -> str | None:
        """書き出しを求め、応答を受け取るための印を返す。未接続なら None。"""
        self._project_request_seq += 1
        request_id = f"export-{self._project_request_seq}-{uuid.uuid4().hex[:12]}"
        if not self.link.export_project(request_id):
            return None
        self._project_requests_in_flight.append(request_id)
        return request_id

    def take_project_export(self, request_id: str) -> dict[str, Any] | str | None:
        """書き出しの結果を受け取る(1 回だけ)。届いた中身(dict)、断られた・届かなかった理由(str)、まだなら None。

        理由の通知は state が別に出しているので、ページは保留を消すだけでよい。
        """
        return self._project_exports.pop(request_id, None)

    def _settle_project_export(self, request_id: str, result: dict[str, Any] | str) -> None:
        if request_id in self._project_requests_in_flight:
            self._project_requests_in_flight.remove(request_id)
        self._project_exports[request_id] = result
        # 受け取らずに消えたページの分を溜め込まない(1 件は最大 12 MiB)
        while len(self._project_exports) > _MAX_PENDING_PROJECT_EXPORTS:
            self._project_exports.pop(next(iter(self._project_exports)))

    def request_surface_edit(self, draft: dict[str, Any] | None, edit: dict[str, Any]) -> str | None:
        """編集命令を送り(D-123)、答えを受け取るための印を返す。未接続なら None。規則と検証はブリッジ。"""
        self._surface_edit_seq += 1
        request_id = f"edit-{self._surface_edit_seq}-{uuid.uuid4().hex[:12]}"
        if not self.link.edit_surface(request_id, draft, edit):
            return None
        self._surface_edits_in_flight.add(request_id)
        return request_id

    def take_surface_edit(self, request_id: str) -> dict[str, Any] | str | None:
        """編集命令の答えを受け取る(1 回だけ)。編集後の作業コピー、断られた理由、切断なら "disconnected"、まだなら None。"""
        return self._surface_edits.pop(request_id, None)

    def cancel_surface_edit(self, request_id: str) -> None:
        """待つのをやめた命令を忘れる。後から答えが届いても溜めない。"""
        self._surface_edits_in_flight.discard(request_id)
        self._surface_edits.pop(request_id, None)

    def _settle_surface_edit(self, request_id: str, result: dict[str, Any] | str) -> None:
        if request_id not in self._surface_edits_in_flight:
            return
        self._surface_edits_in_flight.discard(request_id)
        self._surface_edits[request_id] = result
        # 受け取らずに消えたページ(閉じたタブ)の分を溜め込まない(1 件は定義の全体)
        while len(self._surface_edits) > _MAX_PENDING_PROJECT_EXPORTS:
            self._surface_edits.pop(next(iter(self._surface_edits)))

    def request_project_inspection(self, project: dict[str, Any]) -> str | None:
        """読み込む前の検査を求め(D-122)、答えを受け取るための印を返す。未接続なら None。

        取り込めるかの判定と確認のダイアログに出す要約はブリッジが作る(UI は判定の写しを持たない)。
        """
        self._project_request_seq += 1
        request_id = f"inspect-{self._project_request_seq}-{uuid.uuid4().hex[:12]}"
        if not self.link.inspect_project(request_id, project):
            return None
        self._project_inspections_in_flight.add(request_id)
        return request_id

    def take_project_inspection(self, request_id: str) -> ProjectSummary | str | None:
        """検査の答えを受け取る(1 回だけ)。通れば要約、断られれば理由(str)、切断で失われれば "disconnected"、まだなら None。"""
        return self._project_inspections.pop(request_id, None)

    def cancel_project_inspection(self, request_id: str) -> None:
        """待つのをやめた検査(ページの期限切れ)を忘れる。後から答えが届いても溜めない。"""
        self._project_inspections_in_flight.discard(request_id)
        self._project_inspections.pop(request_id, None)

    def _settle_project_inspection(self, request_id: str, result: ProjectSummary | str) -> None:
        # 問い合わせていない印の答えは受け取らない(受け取り手がおらず溜まるだけ)
        if request_id not in self._project_inspections_in_flight:
            return
        self._project_inspections_in_flight.discard(request_id)
        self._project_inspections[request_id] = result
        while len(self._project_inspections) > _MAX_PENDING_PROJECT_EXPORTS:
            self._project_inspections.pop(next(iter(self._project_inspections)))

    def import_project(self, project: dict[str, Any]) -> bool:
        """取り込みを求める。結果は surface・pad・desired と notice で戻る(画面は先に変えない)。未接続なら False。"""
        return self.link.import_project(project)

    @property
    def desired_unsent_since(self) -> str | None:
        """取り込んだプロジェクトの保持値をまだ Unity へ送っていなければ、取り込んだ時刻(ISO 8601)。"""
        return self._desired_unsent_since

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
        """レコードのフィールドの候補と、一覧が届いているか(D-056)。

        ブリッジは一覧が未着でも fieldChoices を(静的な options だけで)送るので、届いたかどうかは
        行の印と同じく lists で見る。fieldChoices の有無で判定すると、起動直後に保持値の全行へ「一覧に無い」が付く。
        """
        choices = self._runtime_field_choices.get((record_id, entry.param_id))
        if choices is None:
            return entry.options or (), False
        return choices, entry.options_from in self._arrived_lists

    def record_rows(self, record: RecordSpec) -> tuple[RecordRow, ...]:
        """行の順: キーの一覧の和集合の順 → 一覧に無いが保持値を持つキーを desired に現れた順。

        一覧が一度も届いていない間は「一覧に無い」と言えないので印を付けない(D-056 と同じ)。
        """
        listed = self._runtime_keys.get(record.record_id, ())
        arrived = record.keys_from in self._arrived_lists
        names = self._runtime_key_names.get(record.record_id, {})
        rows: dict[str, RecordRow] = {}
        for key in listed:
            rows.setdefault(key, RecordRow(key, listed=True, marked=False, name=names.get(key, key)))
        for key in self._desired_keys.get(record.record_id, {}):
            if key not in rows:
                rows[key] = RecordRow(key, listed=False, marked=arrived, name=names.get(key, key))
        return tuple(rows.values())

    def record_row_name(self, record: RecordSpec, key: str) -> str | None:
        """行の Name。UI で管理する行(D-087)で一覧に無い ID は None(Name の分からない行は Unity へ送れない)。"""
        if not record.has_row_ids:
            return key
        return self._runtime_key_names.get(record.record_id, {}).get(key)

    def record_values_of(self, record: RecordSpec, key: str) -> tuple[Any, ...] | None:
        return self.record_values.values_of(row_channel_key(record.record_id, key))

    def record_channel(self, record: RecordSpec, key: str) -> Any:
        """行の ValueChannel(無ければ None)。ページが改訂を見て表示を更新するために使う。"""
        return self.record_values.get(row_channel_key(record.record_id, key))

    def action_row_keys(self, action: ActionSpec) -> tuple[str, ...]:
        """scope "all" のアクションが対象にする行(表示中の全行を表示順に)。レコードが複数なら出現順の和集合。"""
        keys: dict[str, None] = {}
        for record in action.records:
            for row in self.record_rows(record):
                keys.setdefault(row.key, None)
        return tuple(keys)

    def request_runtime_options_refresh(self, list_id: str | None = None) -> bool:
        """「一覧を更新」。全宛先へ一覧の要求を送らせる。未接続なら False。

        list_id(一覧の id)を渡すと、その一覧の要求だけを送らせる(一覧の近くの Sync。D-077)。
        """
        return self.link.request_runtime_options_refresh(list_id)

    @property
    def pending_options(self) -> tuple[PendingOptionList, ...]:
        """届いたが反映していない一覧(D-088)。出所(宛先・ホスト)ごとで、ブリッジの並びのまま。"""
        return self._pending_options

    @property
    def pending_options_revision(self) -> int:
        """反映待ちの一覧が変わるたびに増える。ページはこれを見て「新しい一覧があります」を描き直す。"""
        return self._pending_options_revision

    def apply_runtime_options(self, list_id: str | None = None) -> bool:
        """届いた一覧を反映させる(D-088)。list_id(一覧の id)を省くと全一覧。未接続なら False。

        反映はブリッジが行い、全 UI へ runtimeOptions で配る(ここでは表示を先に変えない)。
        """
        return self.link.apply_runtime_options(list_id)

    def request_resend(self, target: str | None = None) -> None:
        """保持値を宛先へ送り直させる(クラッシュ・再起動した台を追いつかせる。D-046)。"""
        self.link.request_resend(target)

    def request_reconcile(self, target: str) -> None:
        """その宛先の PC を生成の記録に合わせさせる(欠けているものを生成し、余分なものを消し、保持値を送り直す。HID-385)。"""
        self.link.request_reconcile(target)

    def record_key_limit_reached(self, record: RecordSpec) -> bool:
        """UI で管理するキーの一覧が上限に達しているか(D-075)。達していれば追加の口を閉じる。"""
        return record.keys_max is not None and len(self.record_rows(record)) >= record.keys_max

    def add_record_key(self, record: RecordSpec, key: str) -> str | None:
        """通常の画面からの行の追加(D-075)。送れなかった理由を返す(送れたら None)。

        行はブリッジが作って desired(と UI で管理するキーなら runtimeOptions)で配るので、ここでは行を作らない。
        前後の空白は打ち間違いとみなして落とす(見た目で区別できないキーを作らないため)。
        """
        name = key.strip()
        if not name:
            return "名前を入力してください"
        if any(row.label == name for row in self.record_rows(record)):
            return f"「{name}」は既にあります"
        if self.record_key_limit_reached(record):
            return f"上限の {record.keys_max} 件に達しています"
        if not self.link.add_record_key(record.record_id, name):
            return "ブリッジに未接続のため追加できません"
        return None

    def remove_record_key(self, record: RecordSpec, key: str) -> str | None:
        """通常の画面からの行の削除(D-075)。同じキーの集合を共有する全レコードの行の保持値が消える。"""
        if not self.link.remove_record_key(record.record_id, key):
            return "ブリッジに未接続のため削除できません"
        return None

    def rename_record_key(self, record: RecordSpec, key: str, name: str) -> str | None:
        """UI で管理する行の Name の変更(D-087)。送れなかった理由を返す(送れたら、または変わらないなら None)。

        行は ID(key)で指すので、値・ホールド・表示キャッシュは付け替えない。Name の表示はブリッジの
        runtimeOptions で揃う(断られたら notice が届き、表示は元の Name のまま)。
        """
        if not record.has_row_ids:
            return "この表の行の名前は変更できません"
        new_name = name.strip()
        if not new_name:
            return "名前を入力してください"
        if self.record_row_name(record, key) == new_name:
            return None
        if any(row.label == new_name and row.key != key for row in self.record_rows(record)):
            return f"「{new_name}」は既にあります"
        if not self.link.rename_record_key(record.record_id, key, new_name):
            return "ブリッジに未接続のため名前を変更できません"
        return None

    @property
    def destinations(self) -> DestinationsFrame | None:
        """宛先タブ(D-078)の最新の全量。ブリッジから届くまでは None。"""
        return self._destinations

    @property
    def destinations_revision(self) -> int:
        """destinations が届くたびに増える(宛先タブはこれを見て一覧を作り直す)。"""
        return self._destinations_revision

    @property
    def destinations_rejections(self) -> int:
        """ブリッジが宛先の選択を断った(destinations-rejected)回数。"""
        return self._destinations_rejections

    def request_destinations_scan(self) -> bool:
        """宛先タブの「更新」。ブリッジに LAN を走査させる。未接続なら False。"""
        return self.link.request_destinations_scan()

    def select_destinations(self, all_devices: bool, networks: Sequence[str], hosts: Sequence[str]) -> bool:
        """宛先の選択をブリッジへ送る(D-078 / D-085)。結果は destinations で戻ってくるので、ここでは表示を変えない。"""
        return self.link.select_destinations(all_devices, networks, hosts)

    def reset_destinations(self) -> bool:
        """保存した選択を消して設定ファイルの宛先へ戻させる。未接続なら False。"""
        return self.link.reset_destinations()

    @property
    def destination_alias_rejections(self) -> int:
        """ブリッジが端末の名前を断った(destination-alias-rejected)回数(D-092)。"""
        return self._destination_alias_rejections

    def set_destination_alias(self, host: str, alias: str | None) -> bool:
        """端末の別名をブリッジへ送る(D-092)。結果は destinations で戻ってくるので、ここでは表示を変えない。"""
        return self.link.set_destination_alias(host, alias)

    @property
    def network_settings(self) -> NetworkSettingsFrame | None:
        """ネットワークの設定(D-113)の最新の全量。ブリッジから届くまでは None。"""
        return self._network_settings

    @property
    def network_settings_revision(self) -> int:
        """networkSettings が届くたびに増える。"""
        return self._network_settings_revision

    @property
    def network_settings_rejections(self) -> int:
        """ブリッジがネットワークの設定の変更を断った(network-settings-rejected)回数。"""
        return self._network_settings_rejections

    @property
    def allowed_browsers(self) -> tuple[str, ...] | None:
        """接続してよいブラウザの範囲(D-113)。まだ届いていなければ None(UI の HTTP は localhost だけを通す)。"""
        return None if self._network_settings is None else self._network_settings.allowed_browsers

    def set_network_settings(
        self,
        target_interface: str | None,
        target_ranges: Sequence[str],
        allowed_browsers: Sequence[str],
        browser: str | None,
        *,
        revision: int | None = None,
    ) -> bool:
        """ネットワークの設定をブリッジへ送る。browser は操作したブラウザのアドレス(締め出しの判定に使う)。

        revision は編集を始めた時点の設定の版(省くと今届いている版)。ブリッジは今の版と違えば断るので、同じ接続に先に
        積まれた別のページの変更(許可の取り消しなど)や、編集中にほかのブラウザが保存した設定を、古い入力で上書きしない。
        未接続・設定が届く前なら False。
        """
        if self._network_settings is None:
            return False
        return self.link.set_network_settings(
            target_interface, target_ranges, allowed_browsers, browser,
            revision=self._network_settings.revision if revision is None else revision,
        )

    @property
    def hello(self) -> HelloFrame | None:
        return self._hello

    def notices_since(self, cursor: int) -> tuple[Notice, ...]:
        return tuple(notice for notice in self._notices if notice.seq > cursor)

    # --- UI からの操作 ----------------------------------------------------

    def begin_hold(self, param_id: str, widget: str | None = None) -> None:
        """widget は配置された部品の種類。省くとパラメータの既定の部品で判断する。"""
        if widget is None:
            entry = self.entry_for(param_id)
            widget = entry.widget if entry is not None else None
        timeout_s = INPUT_HOLD_TIMEOUT_S if widget == "input" else DEFAULT_HOLD_TIMEOUT_S
        self.values.channel(param_id).begin_hold(self._clock(), timeout_s)

    def end_hold(self, entry: ControlSpec) -> None:
        values = self.values.channel(entry.param_id).end_hold(self._clock())

        if values is not None:
            self._send(entry, values)

    def release_holds(self, param_ids: Iterable[str]) -> None:
        """切断したクライアントが開始したホールドを期限に関係なく解放する。"""
        for param_id, values in self.values.release_holds(param_ids, self._clock()):
            if values is None:
                continue
            entry = self.entry_for(param_id)
            if entry is not None:
                self._send(entry, values)

    def set_local(self, entry: ControlSpec, values: Sequence[Any]) -> None:
        """UI 操作による値変更。間引きに掛かった分は tick() が後から送る。"""
        if not entry.standalone:
            # 送らない値にはエコーが返らない。離したときに編集前の値へ戻らないよう、その場で確定する
            self.values.channel(entry.param_id).on_local_immediate(tuple(values), self._clock())
            return
        to_send = self.values.channel(entry.param_id).on_local(tuple(values), self._clock())

        if to_send is not None:
            self._send(entry, to_send)

    def set_discrete(self, entry: ControlSpec, values: Sequence[Any]) -> None:
        """トグル・選択・入力確定の操作。取りこぼすと状態が食い違うため間引かない。"""
        to_send = self.values.channel(entry.param_id).on_local_immediate(tuple(values), self._clock())
        self._send(entry, to_send)

    def set_draft(self, entry: ControlSpec, raw: Any) -> None:
        self.values.set_draft(entry.param_id, raw)

    def press_trigger(self, entry: ControlSpec) -> None:
        """トリガの押下。定義の value を 1 回だけ送る(値は保持・表示しない。D-043)。"""
        if entry.is_composite:
            # 組み合わせの型の trigger はフィールドの value を並べた組(D-121)
            self._send(entry, tuple(trigger_value(field) for field in entry.fields))
            return
        self._send(entry, (trigger_value(entry),))

    # --- レコードの操作(D-064) ---------------------------------------------

    def begin_record_hold(self, record: RecordSpec, key: str, widget: str | None = None) -> None:
        """行のどれかの欄の操作開始。保護は行単位(1 行 = 1 メッセージなので、欄ごとに分けても送る値は行全体)。"""
        timeout_s = INPUT_HOLD_TIMEOUT_S if widget == "input" else DEFAULT_HOLD_TIMEOUT_S
        channel_key = row_channel_key(record.record_id, key)
        channel = self.record_values.channel(channel_key)
        if not channel.holding:
            # 新しいホールド。前のホールドで編集した欄の記録は持ち越さない
            self._record_edits.pop(channel_key, None)
        channel.begin_hold(self._clock(), timeout_s)

    def end_record_hold(self, record: RecordSpec, key: str) -> None:
        values = self.record_values.channel(row_channel_key(record.record_id, key)).end_hold(self._clock())
        if values is not None:
            self._send_record_row(record, key, values)

    def release_record_holds(self, rows: Iterable[tuple[RecordSpec, str]]) -> None:
        """切断したクライアントが開始した行のホールドを期限に関係なく解放する。"""
        by_channel = {row_channel_key(record.record_id, key): (record, key) for record, key in rows}
        for channel_key, values in self.record_values.release_holds(by_channel, self._clock()):
            if values is not None:
                record, key = by_channel[channel_key]
                self._send_record_row(record, key, values)

    def set_record_field(self, record: RecordSpec, key: str, index: int, value: Any, *, discrete: bool) -> None:
        """欄の編集。行の全フィールド(他は表示キャッシュの値)を 1 メッセージで送る(D-061)。

        discrete はトグル・選択・入力確定(間引かない)。連続操作(スライダー)は間引き、tick() が後から送る。
        """
        channel_key = row_channel_key(record.record_id, key)
        channel = self.record_values.channel(channel_key)
        if channel.holding:
            self._record_edits.setdefault(channel_key, set()).add(index)
        else:
            self._record_edits.pop(channel_key, None)
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
        """trigger レコードの行の送信ボタン。行のキーと各フィールドの value を 1 回だけ送る。"""
        self._send_record_row(record, key, tuple(trigger_value(field) for field in record.fields))

    def press_action(self, action: ActionSpec, key: str | None = None, *, holder: str | None = None) -> None:
        """アクション(HID-166)の押下。対象の値を定義順に並べ、1 つのまとめ送り(batch。HID-389)で送る。

        state は UI が持つ現在値、trigger は定義の value、step の固定値があればそれを送る。
        値がまだ無い state は送れないので外して警告する(黙って欠けると Unity 側が半端な状態になる)。
        送ったあとはエコーが揃うまで待ち、揃わなければ警告する(再送はしない)。
        scope を持つアクション(D-061)は、row なら key の行、all なら表示中の全行について展開する。
        holder は押したページ(HID-392)。自分のページが操作中(ロック中)の部品を含むまとめ送りを、ブリッジが
        自分のロックで断らないように付ける
        """
        if action.scope is not None:
            self._press_record_action(action, key, holder)
            return

        items: list[BatchParam | BatchRow] = []
        missing: list[EchoTarget] = []
        waiting: dict[EchoTarget, tuple[tuple[Any, ...], bool]] = {}

        for target in action.targets:
            spec = target.spec
            if spec.kind == "trigger":
                # trigger は値を省き、ブリッジが定義の value を送る(エコーは値を問わず到着で確かめる)
                items.append(BatchParam(spec.param_id, has_value=False))
                waiting[spec.param_id] = ((trigger_value(spec),), True)
                continue
            if target.has_fixed_value:
                value: Any = _json_value(spec, target.fixed_value)
                expected: tuple[Any, ...] = (value,)
            else:
                current = self.values.values_of(spec.param_id)
                if not current:
                    missing.append(spec.param_id)
                    continue
                try:
                    value = spec.wire_value(current)
                except ValueError:
                    missing.append(spec.param_id)
                    continue
                # エコーと突き合わせるのは表示キャッシュの組(組み合わせの型はフィールドの値の組。D-121)
                expected = tuple(current) if spec.is_composite else (value,)
            items.append(BatchParam(spec.param_id, value))
            waiting[spec.param_id] = (expected, False)

        self._send_action_batch(action.label, items, waiting, missing, holder)

    def _press_record_action(self, action: ActionSpec, key: str | None, holder: str | None) -> None:
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

        items: list[BatchParam | BatchRow] = []
        missing: list[EchoTarget] = []
        waiting: dict[EchoTarget, tuple[tuple[Any, ...], bool]] = {}
        for target in targets:
            record = target.record
            if record.kind == "trigger":
                values: tuple[Any, ...] = tuple(trigger_value(field) for field in record.fields)
            else:
                current = self.record_values_of(record, target.key)
                if current is None:
                    missing.append((record.record_id, target.key))
                    continue
                row = list(current)
                for index, fixed in target.fixed:
                    row[index] = fixed
                values = tuple(_json_value(field, value) for field, value in zip(record.fields, row))
            # 一覧から消えた ID の行(別の画面で消した直後など)はブリッジが Name を付けられず断るので送らない
            if self.record_row_name(record, target.key) is None:
                missing.append((record.record_id, target.key))
                continue
            items.append(BatchRow(record.record_id, target.key, _row_payload(record, values)))
            waiting[(record.record_id, target.key)] = (values, record.kind == "trigger")

        self._send_action_batch(action.label, items, waiting, missing, holder)

    def _target_text(self, target: EchoTarget) -> str:
        """通知に出す対象。UI で管理する行(D-087)は ID でなく Name で示す(ID は操作者に意味が無い)。"""
        if isinstance(target, tuple):
            record = self._record_index.get(target[0])
            name = self.record_row_name(record, target[1]) if record is not None else None
            label = record.label if record is not None else target[0]
            return f"{label} [{name or target[1]}]"
        entry = self._entry_index.get(target)
        return entry.label if entry is not None else target

    def _send_action_batch(
        self,
        label: str,
        items: list[BatchParam | BatchRow],
        waiting: dict[EchoTarget, tuple[tuple[Any, ...], bool]],
        missing: list[EchoTarget],
        holder: str | None = None,
    ) -> None:
        if missing:
            shown = ", ".join(self._target_text(item) for item in missing[:3]) + (" ほか" if len(missing) > 3 else "")
            self._add_notice("warn", f"「{label}」: 値が未設定の {len(missing)} 件は送りませんでした ({shown})")
        if not items:
            if not missing:
                self._add_notice("warn", f"「{label}」: 送る対象がありません")
            return
        if len(items) > OSC_BATCH_MAX_MESSAGES:
            self._add_notice("error", f"「{label}」: {len(items)} 件は一度に送れる上限を超えています")
            return
        # 1 データグラムの大きさの上限(60 KiB)はブリッジが通信の形にしてから判定し、超えれば batch-rejected で理由が届く
        # (UI は通信の形を知らない。HID-389)
        if not self.link.send_batch(items, holder=holder, revision=self._current_revision()):
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
                shown = ", ".join(self._target_text(item) for item in missing[:3]) + (" ほか" if len(missing) > 3 else "")
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

        for param_id, values in self.values.release_all_holds(now):
            if values is None:
                continue
            entry = self.entry_for(param_id)
            if entry is not None:
                self._send(entry, values)

        for param_id, values in self.values.flush_due(now):
            entry = self.entry_for(param_id)

            if entry is not None:
                self._send(entry, values)

        released = [(key, values) for key, values in self.record_values.release_all_holds(now) if values is not None]
        for channel_key, values in [*released, *self.record_values.flush_due(now)]:
            record_id, _, key = channel_key.partition("\x00")
            record = self._record_index.get(record_id)
            if record is not None:
                self._send_record_row(record, key, values)

    def entry_for(self, param_id: str) -> ControlSpec | None:
        return self._entry_index.get(param_id)

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

        if not status.connected and self._pending_options:
            self._pending_options = ()
            self._pending_options_revision += 1

        if not status.connected:
            # 照合の結果はブリッジが持つもの。切断中に古い食い違いを今のものとして見せない(再接続で catalog が全量で届く)
            self._catalog_mismatched = frozenset()
            # 切断で失われた書き出しの応答は、要求したページに「届かなかった」と知らせて保留を終えさせる
            for request_id in list(self._project_requests_in_flight):
                self._settle_project_export(request_id, "disconnected")
            for request_id in list(self._project_inspections_in_flight):
                self._settle_project_inspection(request_id, "disconnected")
            for request_id in list(self._surface_edits_in_flight):
                self._settle_surface_edit(request_id, "disconnected")
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

        if isinstance(frame, LocksFrame):
            self._on_locks(frame)
            return

        if isinstance(frame, CatalogFrame):
            self._catalog_pcs = frame.pcs
            self.catalog_revision += 1
            # 到達の点灯(delivery_lights)には混ぜない(D-118)。混ぜると赤が送信の失敗か照合の不一致か区別できず、
            # 赤の点灯中はその PC の本物の緑・黄が規則で捨てられる
            self._catalog_mismatched = frozenset(str(pc["host"]) for pc in frame.pcs if pc.get("verified") is False)
            return

        if isinstance(frame, BlueprintStatusFrame):
            self._blueprint_pc = frame.pc
            self._absent_params = frozenset(frame.absent)
            self.catalog_revision += 1
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

        if isinstance(frame, EchoFrame):
            self._on_echo(frame)
            return

        if isinstance(frame, RuntimeOptionsFrame):
            self._on_runtime_options(frame)
            return

        if isinstance(frame, SentLogFrame):
            self.sent_log.apply(frame)
            return

        if isinstance(frame, DeliveryFrame):
            for event in frame.events:
                self.delivery_lights.record(event)
            return

        if isinstance(frame, DestinationsFrame):
            self._on_destinations(frame)
        if isinstance(frame, PadFrame):
            if frame.pad is not None:
                self.pad.apply_pad(frame.name, frame.version, frame.pad)
            return

        if isinstance(frame, PadListFrame):
            self.pad.apply_list(frame.names, frame.active)
            return

        if isinstance(frame, ProjectFrame):
            if frame.project is not None:
                self._settle_project_export(frame.request_id, frame.project)
            return

        if isinstance(frame, SurfaceEditedFrame):
            self._settle_surface_edit(frame.request_id, frame.definition if frame.definition is not None else (frame.detail or ""))
            return

        if isinstance(frame, ProjectInspectionFrame):
            if frame.summary is not None:
                self._settle_project_inspection(frame.request_id, frame.summary)
            else:
                self._settle_project_inspection(frame.request_id, frame.detail or "")
            return

        if isinstance(frame, DesiredStatusFrame):
            self._desired_unsent_since = frame.since if frame.unsent else None
            return

        if isinstance(frame, NetworkSettingsFrame):
            self._network_settings = frame
            self._network_settings_revision += 1
            return

        if isinstance(frame, NoticeFrame):
            if frame.code == "surface-rejected":
                self._add_notice("error", f"定義を採用できません: {frame.detail}")
            elif frame.code == "batch-rejected":
                self._on_batch_rejected(frame.detail)
            elif frame.code == "destinations-rejected":
                self._destinations_rejections += 1
                self._add_notice("error", f"宛先を変更できません: {frame.detail}")
            elif frame.code == "destinations-scan-failed":
                self._add_notice("warn", f"ネットワークの走査に失敗しました: {frame.detail}")
            elif frame.code == "destinations-save-failed":
                self._add_notice("error", f"宛先の選択を保存できませんでした: {frame.detail}")
            elif frame.code == "network-settings-rejected":
                self._network_settings_rejections += 1
                self._add_notice("error", f"ネットワークの設定を変更できません: {describe_network_rejection(frame.detail)}")
            elif frame.code == "network-settings-save-failed":
                self._add_notice("error", f"ネットワークの設定を保存できませんでした(ブリッジを止めるまで効きます): {frame.detail}")
            elif frame.code == "destination-alias-rejected":
                self._destination_alias_rejections += 1
                self._add_notice("error", f"端末の名前を変更できません: {frame.detail}")
            elif frame.code == "destination-aliases-save-failed":
                self._add_notice("error", f"端末の名前を保存できませんでした: {frame.detail}")
            elif frame.code == "runtime-options-refresh-rejected" and frame.detail == "unsent-project":
                # 取り込んだプロジェクトをまだ Unity へ送っていない間は、一覧の要求も送らない(D-090)
                self._add_notice("warn", "読み込んだプロジェクトをまだ Unity へ送っていないため、一覧を要求しませんでした。「Unity へ送る」の後に要求します")
            elif frame.code == "runtime-options-refresh-rejected":
                # Sync(D-077)を押した直後に定義が差し替わり、その要求が定義から消えたときに届く
                self._add_notice("error", f"一覧を取り直せません(採用中の定義に無い要求です): {frame.detail}")
            elif frame.code == "runtime-options-apply-rejected":
                # 反映を押した直後に定義が差し替わり、その一覧が定義から消えたときに届く(D-088)
                self._add_notice("error", f"一覧を反映できません(採用中の定義に無い一覧です): {frame.detail}")
            elif frame.code in ("set-rejected", "row-rejected", "locked"):
                # ブリッジが値の変更を断った(ロック中・型の不一致・旧画面など。HID-373 / HID-378)。表示キャッシュには
                # 断られた値が残っているので、保持値を取り直して表示をブリッジの値へ戻す(UI は表示キャッシュにすぎない)
                self._add_notice("warn", f"値を送れませんでした: {frame.detail}")
                self.link.request_surface()
            elif frame.code == "lock-rejected":
                self._add_notice("warn", f"ほかのブラウザが操作中です: {frame.detail}")
            elif frame.code == "pad-rejected":
                self._add_notice("error", f"パッドを採用できません: {frame.detail}")
            elif frame.code == "pad-press-rejected":
                self._add_notice("error", f"パッドのボタンを送れませんでした: {frame.detail}")
            elif frame.code == "project-export-rejected":
                self._add_notice("error", f"プロジェクトを書き出せません: {frame.detail}")
                if self._project_requests_in_flight:
                    self._settle_project_export(self._project_requests_in_flight[0], frame.detail)
            elif frame.code == "project-import-rejected":
                self._add_notice("error", f"プロジェクトを読み込めません: {frame.detail}")
            elif frame.code == "project-imported":
                # desiredStatus は採用の中で notice より先に届く。パッドだけのプロジェクトでは保持値に触れないので、
                # 未送信の値が無ければ「まだ送っていません」とは言わない
                suffix = "。保持値はまだ Unity へ送っていません" if self._desired_unsent_since is not None else ""
                self._add_notice("info", f"プロジェクトを読み込みました({frame.detail}){suffix}")
            elif frame.code == "spawned":
                # 生成の名前はブリッジが振る(HID-385)。消すときに使う名前なので知らせる
                self._add_notice("info", f"「{frame.detail}」を生成しました")
            elif frame.code == "reconciled":
                self._add_notice("info", f"生成の記録に合わせました({frame.detail})")
            elif frame.code == "reconcile-rejected":
                self._add_notice("error", f"記録に合わせられません: {frame.detail}")
            return

        # 生の OSC(osc.message)は OSC 専用の表示のためのもので、値の表示・まとめ送りの確認はエコー(echo)で行う(HID-389)

    def _on_echo(self, frame: EchoFrame) -> None:
        """主系のターゲットのエコー(HID-389)を、届いた確認として表示へ反映する。保持値は変えない(D-045)。

        出所の判定(主系のターゲットか・OSC ネイティブ UI の端末でないか)はブリッジが済ませている。
        """
        for row in frame.rows:
            record = self._record_index.get(row.record)
            # 空のキーは行として扱わない。行は作らない(行はキーの一覧と保持値から来る。D-064)
            if record is None or not row.key:
                continue
            fields = record.row_values(row.values)
            if fields is None:
                continue
            self._confirm_action_echo((record.record_id, row.key), fields)
            if record.kind == "state":
                self._apply_record_values(record, row.key, fields)
        for item in frame.values:
            # 現在の定義に無いパラメータ(計画外・未採用)は表示にもキャッシュにも入れない
            if item.param not in self._entry_index:
                continue
            # 組み合わせの型(D-121)はフィールドの値の組。読めない値は値の無い応答と同じに扱う
            echoed = (self._entry_index[item.param].values_from_wire(item.value) or ()) if item.has_value else ()
            # 値の読めない応答でも、トリガーの到着確認には使える
            self._confirm_action_echo(item.param, echoed)
            if echoed:
                self.values.on_echo(item.param, echoed)

    def _add_notice(self, level: Literal["info", "warn", "error"], message: str) -> None:
        self._notice_seq += 1
        self._notices.append(Notice(self._notice_seq, level, message))

    def _on_surface(self, frame: SurfaceFrame) -> None:
        definition = frame.definition
        if definition is None:
            return
        bindings = frame.bindings or {}
        try:
            # 取り直せる一覧 = 要求を持つ一覧。要求は通信の結び付けにだけあるので、OSC のアダプタの結び付けから引く
            osc = bindings.get("osc") or {}
            syncable = frozenset(binding["id"] for binding in osc.get("lists", []) if "request" in binding)
            surface = parse_surface(definition, selectors=dict(frame.selectors), syncable_lists=syncable)
        except Exception as error:  # noqa: BLE001 - 判定はブリッジだけが行う(D-122)ので、組み立てられない形はここで受け止める
            # ブリッジが採用した定義を UI が描けない(UI の読み方が古いなど)。直前の画面を保ち、黙って捨てずに知らせる
            logger.error("サーフェス定義を取り込めません: %r", error)
            self._surface_status = replace(self._surface_status, detail="不正")
            self._add_notice("error", f"定義「{frame.name}」を画面にできません: {error!r}")
            return

        changed = (
            definition != self._definition
            or bindings != self._bindings
            or frame.selectors != self._selectors
            or frame.name != self._surface_status.name
        )
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
        self._bindings = dict(bindings)
        self._selectors = frame.selectors
        self._surface = surface
        # 古い定義への押下は、エコーが捨てられて「確認できません」と誤報になるので待たない
        self._action_batches = []
        self._entry_index = {spec.param_id: spec for spec in surface.parameters}
        self._current_specs = {
            id(spec): spec for spec in [*surface.parameters, *(spec for screen in surface.screens for spec in screen.controls)]
        }
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
        self._record_index = {} if surface is None else {record.record_id: record for record in surface.records}
        self._desired_keys = {}
        self._record_edits = {}
        # 行のチャンネルを作り直したので、進行中の操作も無い。前の定義の行の操作者は持ち越さない
        self._row_operators = {}
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
        self._bindings = {}
        self._selectors = ()
        self._surface = None
        self._entry_index = {}
        self._current_specs = {}
        self._reset_records(None)
        self._surface_status = SurfaceStatus(detail="待機中")
        self._surface_revision += 1

    def _on_desired(self, frame: DesiredFrame) -> None:
        """ブリッジが保持する狙いの値(D-045)を表示キャッシュへ取り込む。OSC は送らない。"""
        values: dict[str, tuple[Any, ...]] = {}
        # レコードの保持値は行ごとに 1 エントリ(レコード id・行のキー・フィールド id ごとの値。D-061・HID-389)
        record_rows: dict[str, dict[str, tuple[Any, ...]]] = {}
        for row in frame.rows:
            record = self._record_index.get(row.record)
            # 空文字のキーはブリッジが保持も生成もしない(一覧からも除く)ので、行にしない
            if record is None or record.kind != "state" or not row.key:
                continue
            fields = record.row_values(row.values)
            if fields is not None:
                record_rows.setdefault(record.record_id, {})[row.key] = fields
        for item in frame.values:
            if item.param not in self._entry_index or not item.has_value:
                continue
            decoded = self._entry_index[item.param].values_from_wire(item.value)
            if decoded is not None:
                values[item.param] = decoded

        self._on_desired_records(record_rows, full=frame.full)

        if frame.full:
            # standalone:false はブリッジが保持しない UI だけの値なので、全量で消さない(まとめ送りの材料)
            state_params = [
                spec.param_id for spec in self._entry_index.values() if spec.kind == "state" and spec.standalone
            ]
            self.values.replace_all(state_params, values)
            return

        for param_id, param_values in values.items():
            self.values.on_echo(param_id, param_values)

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
                    [row_channel_key(record.record_id, key) for key in dropped],
                    {},
                )
                for key in dropped:
                    del known[key]
                changed = changed or bool(dropped)
            for key, values in incoming.items():
                if key not in known:
                    known[key] = None
                    changed = True
                self._apply_record_values(record, key, values)
        if changed:
            self._record_rows_revision += 1
            self._seed_record_rows()

    def _apply_record_values(self, record: RecordSpec, key: str, values: tuple[Any, ...]) -> None:
        """行の確定値(エコー・保持値)を取り込む。ホールド中は、この行で編集した欄だけ手元の値を残して映す。"""
        channel_key = row_channel_key(record.record_id, key)
        channel = self.record_values.channel(channel_key)
        channel.on_echo(values)
        if channel.holding and channel.values is not None:
            edited = self._record_edits.get(channel_key, set())
            channel.show_during_hold(
                tuple(channel.values[index] if index in edited else value for index, value in enumerate(values))
            )

    def _on_runtime_options(self, frame: RuntimeOptionsFrame) -> None:
        # 反映待ちだけが変わったフレーム(届いた一覧の変化。D-088)では、候補と行の改訂を進めない
        if frame.pending != self._pending_options:
            self._pending_options = frame.pending
            self._pending_options_revision += 1
        choices = dict(frame.choices)
        keys = {record_id: tuple(dict.fromkeys(key for key in names if key)) for record_id, names in frame.keys}
        key_names = {record_id: dict(pairs) for record_id, pairs in frame.key_names}
        field_choices = {(record_id, field_id): options for record_id, field_id, options in frame.field_choices}
        arrived = frozenset(item.list_id for item in frame.lists if item.targets)
        if (choices, keys, key_names, field_choices, arrived) == (
            self._runtime_choices,
            self._runtime_keys,
            self._runtime_key_names,
            self._runtime_field_choices,
            self._arrived_lists,
        ):
            return
        # 改名(D-087)は行の集合を変えないが、行の表示(キーの列の Name)を描き直すために行の改訂として扱う
        rows_changed = keys != self._runtime_keys or key_names != self._runtime_key_names or arrived != self._arrived_lists
        self._runtime_choices = choices
        self._runtime_keys = keys
        self._runtime_key_names = key_names
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
                channel = self.record_values.channel(row_channel_key(record.record_id, row.key))
                if channel.values is None and not channel.holding:
                    channel.on_echo(record.initial_values())

    # --- 設計図(D-104・HID-386) ---------------------------------------------

    @property
    def catalog_pcs(self) -> tuple[dict[str, Any], ...]:
        """ブリッジが持つ PC ごとの設計図(host・name・receivedAt・verified・items)。"""
        return self._catalog_pcs

    @property
    def catalog_mismatched_hosts(self) -> frozenset[str]:
        """設計図が送り元と一致していない PC の送信元ホスト(verified が false。要約値の食い違いと、大きすぎて受け取れなかったときの
        両方。catalog はこの 2 つを区別しない)。一致・未照合に戻るか、切断すると外れる(D-118)。"""
        return self._catalog_mismatched

    @property
    def blueprint_pc(self) -> dict[str, str] | None:
        """採用中の画面を作った設計図の PC。設計図から作った画面でなければ None。"""
        return self._blueprint_pc

    def is_absent(self, entry: ControlSpec) -> bool:
        """設計図から作った画面で、その PC の設計図に無いパラメータか(「この PC には無い」として薄く出す)。"""
        return entry.param_id in self._absent_params

    # --- 操作中のロック(HID-378) ---------------------------------------------

    def note_operator(self, entry: ControlSpec, holder: str) -> bool:
        """このページが部品を操作する。以後この部品の値の送信(間引いた後の送信を含む)に holder を付ける。

        ほかのページがロック中(locks で届いている)なら操作させずに False を返す(値を共有の表示に書き込ませない。
        書き込ませると、その値がロックの持ち主の値として送られてしまう)。

        値のチャンネルはこのプロセスの全ページで 1 つなので、操作者は「進行中の操作」の持ち主として扱う(HID-392・D-111)。
        - 進行中の操作(ホールド中か、間引きで保留した未送信の値がある)がほかのページのものなら断る。locks が届く前の
          すき間でも、別のページの値をチャンネルに書かせない(書くと、その値が持ち主の holder で送られ、ブリッジが通す)。
          保留した値は操作したページの holder のまま送られる(送るまで操作者が替わらない)
        - 進行中の操作が無ければ、このページが新しい操作の持ち主になる。前に操作したページの holder を残すと、
          ロックはこのページ・set は前のページの holder になり、ブリッジに断られる
        """
        if self.lock_label(entry, holder) is not None:
            return False
        current = self._operators.get(entry.param_id)
        channel = self.values.get(entry.param_id)
        busy = channel is not None and (channel.holding or channel.has_pending)
        if busy and current is not None and current != holder:
            return False
        self._operators[entry.param_id] = holder
        return True

    def lock_label(self, entry: ControlSpec, holder: str) -> str | None:
        """ほかのブラウザのページが操作中なら、その持ち主の表示名。空いているか自分のページなら None。"""
        return self._lock_label_of(lock_ref(entry.param_id), holder)

    def acquire_lock(self, entry: ControlSpec, holder: str, label: str) -> None:
        """操作の開始と延長。操作が続く間は呼び直して期限(LOCK_LEASE_S)を延ばす。操作者は変えない(値の操作が決める)。"""
        self.link.send_lock(lock_ref(entry.param_id), holder, label)

    def release_lock(self, entry: ControlSpec, holder: str) -> None:
        self.link.send_unlock(lock_ref(entry.param_id), holder)

    def note_record_operator(self, record: RecordSpec, key: str, holder: str) -> bool:
        """このページが Record の行を操作する(HID-390)。規則は部品の note_operator と同じで、単位が行になる。

        行の値のチャンネルもこのプロセスの全ページで 1 つなので、進行中の操作(ホールド中か保留した未送信の値)が
        ほかのページのものなら断る。断らないと、そのページの値が持ち主の holder で送られてブリッジに通される
        """
        if self.record_lock_label(record, key, holder) is not None:
            return False
        channel_key = row_channel_key(record.record_id, key)
        current = self._row_operators.get(channel_key)
        channel = self.record_values.get(channel_key)
        busy = channel is not None and (channel.holding or channel.has_pending)
        if busy and current is not None and current != holder:
            return False
        self._row_operators[channel_key] = holder
        return True

    def record_lock_label(self, record: RecordSpec, key: str, holder: str) -> str | None:
        """ほかのブラウザのページが行を操作中なら、その持ち主の表示名。空いているか自分のページなら None。"""
        return self._lock_label_of(lock_ref(record=record.record_id, key=key), holder)

    def acquire_record_lock(self, record: RecordSpec, key: str, holder: str, label: str) -> None:
        """行の操作の開始と延長(HID-390)。ロックの単位は行(D-111。1 行 = 1 メッセージ)。"""
        self.link.send_lock(lock_ref(record=record.record_id, key=key), holder, label)

    def release_record_lock(self, record: RecordSpec, key: str, holder: str) -> None:
        self.link.send_unlock(lock_ref(record=record.record_id, key=key), holder)

    def _lock_label_of(self, ref: tuple[str, ...], holder: str) -> str | None:
        own_client = self._hello.client_id if self._hello is not None else None
        for lock in self._locks:
            if lock.ref == ref and not (lock.client_id == own_client and lock.holder == holder):
                return lock.label
        return None

    def _on_locks(self, frame: LocksFrame) -> None:
        if frame.locks != self._locks:
            self._locks = frame.locks
            self.locks_revision += 1

    @property
    def has_osc_adapter(self) -> bool:
        """ブリッジが OSC のアダプタを持つか(HID-373)。hello を受けるまでは持つとみなす(画面が一瞬欠けないように)。"""
        return self._hello is None or "osc" in self._hello.adapters

    def _on_hello(self, frame: HelloFrame) -> None:
        if self.has_osc_adapter != ("osc" in frame.adapters):
            # OSC パッドのタブの有無は画面の作り直しで決まるので、OSC のアダプタの有無が変わったら作り直させる
            self._surface_revision += 1
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

    def _on_destinations(self, frame: DestinationsFrame) -> None:
        self._destinations = frame
        self._destinations_revision += 1
        # 宛先を変えても hello は届き直さないので、エコーの出所の判定に使う主系はここで追従させる
        primary = next((target for target in frame.targets if target.primary), None)
        if primary is not None:
            self._config = replace(self._config, unity=UnityTarget(primary.host, primary.send_port, primary.send_port))

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
        name = self.record_row_name(record, key)
        if name is None:
            # 一覧から消えた ID の行(別の画面で消した直後など)。Name が無いと Unity が行を名前で扱えないので送らない
            logger.info("record row %s of %s is not listed; not sending", key, record.record_id)
            return
        # レコード id・行のキー・フィールド id ごとの JSON の値で送る(HID-389)。アドレス・型・Name はブリッジが決める
        current = self._record_index.get(record.record_id)
        if current is not record:
            logger.info("record %s belongs to a replaced surface; not sending", record.record_id)
            return
        # 操作したページの holder を付ける(HID-390)。付けないと、自分で取った行のロックに自分の送信が断られる
        self.link.send_set_row(
            record.record_id,
            key,
            _row_payload(record, tuple(_json_value(field, value) for field, value in zip(record.fields, values, strict=True))),
            holder=self._row_operators.get(row_channel_key(record.record_id, key)),
            revision=self._current_revision(),
        )

    def _current_revision(self) -> int | None:
        """操作した画面が描いた定義の版(surface の revision)。ブリッジは採用中の版と違えば断る。"""
        revision = self._surface_status.revision
        return revision if isinstance(revision, int) and revision > 0 else None

    def _send(self, entry: ControlSpec, values: tuple[Any, ...]) -> None:
        # 単独で送らない定義(standalone: false)は、まとめ送り(HID-166)の対象としてのみ
        # 送る。ここで送るとブリッジの保持対象外の値が Unity にだけ届いてしまう
        if not entry.standalone:
            return

        # パラメータ ID と JSON の値で送る(HID-373)。アドレスと型タグへの直し方はブリッジが定義から決めるので、
        # UI は OSC の語を持たない。パラメータは 1 つの値(組み合わせの型はフィールド id → 値のオブジェクト。D-121)を持つ
        try:
            wire_value = entry.wire_value(values)
        except ValueError as error:
            logger.warning("parameter %s: %s; not sending", entry.param_id, error)
            return
        # 操作したページの holder を付ける(HID-378)。ロック中の部品は持ち主のページからの変更だけをブリッジが通す
        # 作り直し前の画面の部品(今の定義に無いもの)からは送らない。同じ id が新しい定義で別のアドレスを指すことがある
        # 作り直した画面に同じ部品が無ければ、古い画面の部品とみなして送らない。同じ id でも制約・表示が変わっていれば
        # 別のものを指しうる(新しい定義で別のアドレスに結び付いたときはブリッジも set の revision で断る)
        # 等しさでなく同一性で照合する。結び付けだけを変えた定義では、旧画面と新画面の部品が等値になるが、旧画面の操作に
        # 今の revision を付けて送ると、ブリッジの stale-surface 判定も通って新しいアドレスへ送られてしまう(PR #111 の指摘)
        if self._current_specs.get(id(entry)) is not entry:
            logger.info("parameter %s belongs to a replaced surface; not sending", entry.param_id)
            return
        self.link.send_set(
            entry.param_id,
            wire_value,
            holder=self._operators.get(entry.param_id),
            revision=self._current_revision(),
        )



def _row_payload(record: RecordSpec, values: Sequence[Any]) -> dict[str, Any]:
    """行の値をフィールド id → JSON の値にする(setRow・batch の行。HID-389)。"""
    return {field.param_id: value for field, value in zip(record.fields, values, strict=True)}


def _json_value(spec: ControlSpec, value: Any) -> Any:
    """set フレームの値(HID-373)。型どおりの JSON の値に揃える(bool は true/false のまま。0/1 への直しはブリッジ)。"""
    return json_value(spec, value)


