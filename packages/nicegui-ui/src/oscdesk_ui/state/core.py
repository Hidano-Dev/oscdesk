"""UI から見たサーフェスの状態。

WebSocket 接続・サーフェス定義・表示値をひとまとめにし、NiceGUI のページからは
ここだけを見ればよいようにする。ページは複数開かれうるので、状態は
プロセス内に 1 つだけ持ち、各ページは revision を見て差分を取り込む。

状態(属性)はすべてここの SurfaceState.__init__ が持ち、領域ごとの振る舞いは同じパッケージの
mixin(surface・values・records・actions・requests・network・locks・catalog)に分けている(HID-440)。
受信したフレームの種類の分岐は _on_frame の 1 か所だけで行う。
"""

from __future__ import annotations

import time
from collections import deque
from dataclasses import replace
from typing import Any, Callable, Literal

from ..config import AppConfig, UnityTarget
from ..delivery_lights import DeliveryLights
from ..osc_pad import PadCache
from ..protocol import (
    BlueprintStatusFrame,
    CatalogFrame,
    DecodedFrame,
    DesiredFrame,
    DesiredStatusFrame,
    DeliveryFrame,
    DestinationsFrame,
    EchoFrame,
    HelloFrame,
    LinkFrame,
    LockEntry,
    LocksFrame,
    NetworkSettingsFrame,
    NoticeFrame,
    PadEditedFrame,
    PadFrame,
    PadListFrame,
    PendingOptionList,
    ProjectFrame,
    ProjectInspectionFrame,
    ProjectSummary,
    RuntimeOptionsFrame,
    SentLogFrame,
    SurfaceEditedFrame,
    SurfaceFrame,
    SurfaceListFrame,
)
from ..sent_log import SentLogCache
from ..surface_link import LinkOptions, LinkStatus, SurfaceLink
from ..surface_model import ControlSpec, RecordSpec, SurfaceModel
from ..value_store import DEFAULT_MIN_SEND_INTERVAL_S, ValueStore
from .actions import ActionsMixin
from .catalog import CatalogMixin
from .locks import LocksMixin
from .models import Notice, SurfaceStatus, UnityLinkStatus, UnityTargetLinkStatus, _ActionBatch
from .network import NetworkMixin, describe_network_rejection
from .records import RecordsMixin
from .requests import RequestsMixin
from .surface import SurfaceMixin
from .values import ValuesMixin


class SurfaceState(
    SurfaceMixin, ValuesMixin, RecordsMixin, ActionsMixin, RequestsMixin, NetworkMixin, LocksMixin, CatalogMixin,
):
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
        # ブリッジが配った部品の木(D-124)。同じ内容の再配信で画面を作り直さないための比較に使う
        self._view: dict[str, Any] | None = None
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
        # パッドの編集命令(D-126)の答え。サーフェス定義の編集命令と同じ扱いで、値は編集後の作業コピーか理由の文字列
        self._pad_edits: dict[str, dict[str, Any] | str] = {}
        self._pad_edits_in_flight: set[str] = set()
        self._pad_edit_seq = 0
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
    def link_status(self) -> LinkStatus:
        return self._link_status

    @property
    def unity_link_status(self) -> UnityLinkStatus:
        return self._unity_link_status

    @property
    def unity_targets(self) -> tuple[UnityTargetLinkStatus, ...]:
        """冗長構成の宛先ごとの到達性(主系が先頭)。link フレーム受信前は空。"""
        return self._unity_targets

    @property
    def hello(self) -> HelloFrame | None:
        return self._hello

    def notices_since(self, cursor: int) -> tuple[Notice, ...]:
        return tuple(notice for notice in self._notices if notice.seq > cursor)

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
            for request_id in list(self._pad_edits_in_flight):
                self._settle_pad_edit(request_id, "disconnected")
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
            # 1 フレームは変わった PC だけ(D-131)。host が同じ PC を置き換え、hosts に無い PC を捨て、hosts の順に並べる
            held = {str(pc["host"]): pc for pc in self._catalog_pcs}
            held.update((str(pc["host"]), pc) for pc in frame.pcs)
            self._catalog_pcs = tuple(held[host] for host in dict.fromkeys(frame.hosts) if host in held)
            self.catalog_revision += 1
            # 到達の点灯(delivery_lights)には混ぜない(D-118)。混ぜると赤が送信の失敗か照合の不一致か区別できず、
            # 赤の点灯中はその PC の本物の緑・黄が規則で捨てられる
            self._catalog_mismatched = frozenset(str(pc["host"]) for pc in self._catalog_pcs if pc.get("verified") is False)
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

        if isinstance(frame, PadEditedFrame):
            self._settle_pad_edit(frame.request_id, frame.pad if frame.pad is not None else (frame.detail or ""))
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

    def _add_notice(self, level: Literal["info", "warn", "error"], message: str) -> None:
        self._notice_seq += 1
        self._notices.append(Notice(self._notice_seq, level, message))

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
