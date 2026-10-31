"""NiceGUI のページ組み立て。

ページは複数同時に開かれうる。状態(接続・定義・値)はプロセスに 1 つで、
各ページはタイマーで revision を見て差分だけを取り込む。バックグラウンドタスクから
他クライアントの要素を直接触らずに済み、高頻度のエコーバックも自然に間引ける。
"""

from __future__ import annotations

from typing import Any

from nicegui import ui

from .destinations_panel import DestinationsPanel
from .editor_panel import EditorPanel
from .inspector_area import InspectorArea
from .layout import extra_tab_name, render_screens
from .list_sync import REFRESH_SENT_MESSAGE, build_sync_button
from .log_drawer import LogDrawer
from .network_access import is_browser_allowed
from .network_panel import NetworkPanel
from .notify_history import history_for, notify
from .osc_pad_panel import OscPadPanel
from .pending_options import PendingOptionsPanel
from .project_panel import ProjectPanel
from .record_table import RecordTable
from .surface_editor import EditSession, new_definition
from .surface_model import ActionSpec, ControlSpec, RecordNode
from .state import SurfaceState
from .widgets import WidgetBinding, WidgetFactory

SYNC_INTERVAL_S = 0.05

# 本体と右側の宛先パネル(D-086)。広い画面ではパネルを右に固定幅で置き、本体をスクロールしても見え続けるよう sticky にする。
# Quasar のドロワーにしないのは、右のドロワーは送信ログ(LogDrawer)が使っていて、レイアウトに右は 1 つしか置けないため。
# 本体の置き場が狭いとき(960px 未満)は本体の上へ回し、高さを抑えて中だけスクロールさせる(下に置くと本番中に探しに行けない)。
# 判定はビューポートの幅でなく置き場の幅(コンテナクエリ)で行う。送信ログのドロワー(幅 640px)を開くと置き場だけが縮み、
# ビューポートで判定すると横並びのまま本体の幅がほぼ無くなって部品が潰れるため。
# 位置の指定は Tailwind の応答クラスでなく素の CSS にする(NiceGUI の版で Tailwind の版が変わっても効くように)。
# sticky の上端はヘッダーの実際の高さ(HEADER_HEIGHT_JS が測る)。バッジが折り返してヘッダーが高くなっても、パネルの上端が隠れないように
# NiceGUI のページ本体(.nicegui-content)の上下の余白は消す。残すとパネルの高さ(画面 - ヘッダー)に余白が足されてページが
# 少しだけ縦にはみ出し、パネルを最後までスクロールした後のホイールでページ全体がずれる(本体は自前の q-pa-md で余白を持つ)。
# 同じ理由で、パネルの中のスクロールはページへ連鎖させない(overscroll-behavior)
# パネルの幅は左端のつまみ(.oscdesk-aside-handle)のドラッグで変える(ASIDE_RESIZE_JS。幅は --oscdesk-aside-width)。
# 覚えた幅は広い画面で決めたものかもしれないので、本体が 360px(+つまみ 7px)残るよう CSS の max-width でも常に抑える
# (抑えないと、狭いウィンドウで開き直したときや窓を縮めたときにパネルがはみ出して本体が潰れる)。
# 本体の上へ回した配置では横に並ばないので、この抑えを外す(残すと幅が 100% - 367px になり、スマホ幅でパネルが細い帯に潰れる)
# この領域は送信先パネルと Inspector の共用(D-091)。幅のつまみも共用する。2 つの面は同じ升目に重ね、領域でなく
# 面ごとにスクロールさせる(inspector_area.py の説明)。そのため領域の高さは中身に依らず固定にする。狭い画面では
# 領域が格子の上にあるので、面の差し替えで高さが変わると格子が指の下で上下に動く。狭い画面で Inspector を出している
# 間は、本体の上へ貼り付けて(sticky)格子をスクロールしても設定が見えるようにする(貼り付けないと、下のボタンを
# 選ぶと Inspector が画面の外の上に出て、選んだ結果が見えない)。sticky は流れの中の位置を変えないので格子は動かない。
# 貼り付けると下の部品に重なるので背景を塗る
BODY_CSS = """
.nicegui-content:has(> .oscdesk-frame) { padding: 0; }
.oscdesk-frame { container-type: inline-size; container-name: oscdesk-frame; width: 100%; }
.oscdesk-body { display: flex; flex-direction: row; align-items: flex-start; width: 100%; }
.oscdesk-main { flex: 1 1 auto; min-width: 0; max-width: 900px; margin: 0 auto; }
.oscdesk-aside {
  flex: 0 0 var(--oscdesk-aside-width, 360px); width: var(--oscdesk-aside-width, 360px); position: sticky;
  max-width: calc(100% - 367px);
  top: var(--oscdesk-header-height, 64px); height: calc(100vh - var(--oscdesk-header-height, 64px));
  display: grid; grid-template-rows: minmax(0, 1fr); grid-template-columns: minmax(0, 1fr); overflow: hidden;
}
.oscdesk-aside-view { grid-area: 1 / 1; min-width: 0; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.oscdesk-aside-view.oscdesk-aside-view-hidden { visibility: hidden; pointer-events: none; }
.oscdesk-inspector-view { display: flex; flex-direction: column; overflow: hidden; }
.oscdesk-inspector-head { flex: none; }
.oscdesk-inspector-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.oscdesk-aside-handle {
  flex: 0 0 7px; align-self: flex-start; position: sticky; top: var(--oscdesk-header-height, 64px);
  height: calc(100vh - var(--oscdesk-header-height, 64px)); cursor: col-resize; touch-action: none;
  border-left: 1px solid rgba(0, 0, 0, 0.12);
}
.oscdesk-aside-handle:hover, .oscdesk-aside-handle.dragging { background: rgba(25, 118, 210, 0.25); }
@container oscdesk-frame (max-width: 959.98px) {
  .oscdesk-body { flex-direction: column; align-items: stretch; }
  .oscdesk-main { width: 100%; }
  .oscdesk-aside-handle { display: none; }
  .oscdesk-aside {
    order: -1; flex: none; width: 100%; max-width: none; position: static; height: 40vh;
    border-bottom: 1px solid rgba(0, 0, 0, 0.12);
  }
  .oscdesk-aside.oscdesk-aside-inspecting {
    position: sticky; top: var(--oscdesk-header-height, 64px); z-index: 2; background: #fff;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);
  }
}
"""

# パネルの幅のドラッグ。つまみは Vue の描画後にできるので、document で受けて委譲する。幅は本体が潰れない範囲に収め、
# このブラウザにだけ覚える(端末ごとの画面の広さに合わせる好みで、他の端末と共有するものではない)。保存領域が
# 使えないブラウザ(プライベートウィンドウなど)では覚えないだけで、ドラッグはできる
ASIDE_RESIZE_JS = """
<script>
(() => {
  const KEY = 'oscdesk.asideWidth', MIN = 260, MAIN_MIN = 360;
  const root = document.documentElement;
  const apply = (px) => root.style.setProperty('--oscdesk-aside-width', Math.round(px) + 'px');
  try { const saved = parseFloat(localStorage.getItem(KEY)); if (saved >= MIN) apply(saved); } catch (e) {}
  document.addEventListener('pointerdown', (down) => {
    const handle = down.target.closest && down.target.closest('.oscdesk-aside-handle');
    if (!handle || down.button !== 0) return;
    down.preventDefault();
    const frame = handle.parentElement.getBoundingClientRect();
    const max = Math.max(MIN, frame.width - MAIN_MIN);
    let width = null;
    handle.setPointerCapture(down.pointerId);
    handle.classList.add('dragging');
    const move = (e) => { width = Math.min(max, Math.max(MIN, frame.right - e.clientX)); apply(width); };
    const up = () => {
      handle.classList.remove('dragging');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      if (width !== null) { try { localStorage.setItem(KEY, String(Math.round(width))); } catch (e) {} }
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
})();
</script>
"""

# ヘッダーの高さを測って --oscdesk-header-height に入れる。ヘッダーは Vue の描画後にできるので、見つかるまで待ってから
# 大きさの変化を見張る(バッジの文字は接続・定義の状態で変わり、折り返すと高さが変わる)
HEADER_HEIGHT_JS = """
<script>
(() => {
  const apply = (header) => document.documentElement.style.setProperty('--oscdesk-header-height', header.offsetHeight + 'px');
  const watch = () => {
    const header = document.querySelector('.q-header');
    if (!header) { requestAnimationFrame(watch); return; }
    apply(header);
    new ResizeObserver(() => apply(header)).observe(header, { box: 'border-box' });
  };
  watch();
})();
</script>
"""


class SurfacePage:
    def __init__(self, state: SurfaceState) -> None:
        self._state = state
        self._bindings: list[WidgetBinding] = []
        # レコード表(D-064)。行の増減と値の反映は表ごとの sync が行う
        self._record_tables: list[RecordTable] = []
        self._surface_revision = -1
        self._held_addresses: set[str] = set()
        self._notice_cursor = 0
        self._runtime_options_revision = -1
        # 編集モード(HID-165)。本番モードでは None
        self._editor: EditorPanel | None = None
        self._editor_key: tuple = ()
        # 宛先パネル(D-078 / D-086)。画面の作り直しの外(右側)に置き、ページに 1 つ持ち続ける
        # (作り直すと、応答待ちの未確定の選択が定義の再配信で消え、続けたチェックが先の変更を上書きするため)
        self._destinations_panel = DestinationsPanel(state)
        # アプリ全体の Inspector の領域(D-091)。右側の領域を宛先パネルと共用し、部品の設定を編集する間だけ借りる
        self._inspector_area = InspectorArea()
        # OSC パッドのタブ(D-080)。編集中の作業コピーを画面の作り直しで失わないよう、ページに 1 つ持ち続ける
        self._pad_panel = OscPadPanel(state, self._inspector_area)
        # 「新しい一覧があります」(D-088)。反映待ちは定義の再配信と無関係に変わるので、画面の作り直しの外に置く
        self._pending_options_panel = PendingOptionsPanel(state)
        # プロジェクトファイル(D-090)。書き出しの待ちと未送信の表示を画面の作り直しで失わないよう、外に置く
        self._project_panel = ProjectPanel(state, editing=lambda: bool(self._edit_switch.value))
        # ネットワークのタブ(D-104)。入力中の値を画面の作り直しで失わないよう、ページに 1 つ持ち続ける
        self._network_panel = NetworkPanel(state)
        # このページのブラウザのアドレスと、許可リストを最後に確かめた revision(範囲の外になったら読み込み直させる)
        self._browser_address = ""
        self._network_revision = -1
        self._evicted = False
        self._client: Any = None

        self._factory = WidgetFactory(
            on_local=self._on_local,
            on_discrete=self._on_discrete,
            on_trigger_press=self._on_trigger_press,
            on_draft=self._on_draft,
            on_hold_begin=self._on_hold_begin,
            on_hold_end=self._on_hold_end,
            on_action_press=self._on_action_press,
            options_for=self._state.options_for,
            # 一覧の要求を持つ select の横に、その一覧だけを取り直す Sync を置く(D-077)
            build_sync=lambda request: build_sync_button(self._state, request),
        )

    def build(self) -> None:
        ui.context.client.on_disconnect(self._on_disconnect)
        # 履歴の読み手はページの破棄で外す。on_disconnect は再接続猶予中の一時切断でも呼ばれ、
        # そこで外すと保存要求の応答が履歴から消えて再接続後も dirty が残る
        # on_delete は NiceGUI 3.0 で加わった API。許容範囲の 2.x では AttributeError でページが組めなくなるので、
        # 無ければ従来の on_disconnect へ落とす(2.x では一時切断でも外れるが、起動不能よりよい)
        client = ui.context.client
        getattr(client, "on_delete", client.on_disconnect)(self._pad_panel.release)
        self._client = client
        self._browser_address = _client_address(client)
        self._network_panel.set_browser(self._browser_address)
        ui.page_title("OSCDesk")

        # 送信ログと通知履歴(D-067)。通知履歴はこのページ(クライアント)のもの
        self._log_drawer = LogDrawer(self._state.sent_log, history_for(ui.context.client))
        self._log_drawer.build()

        with ui.header().classes("items-center justify-between q-px-md q-py-sm"):
            ui.label("OSCDesk").classes("text-h6")
            with ui.row().classes("items-center q-gutter-x-md"):
                self._link_badge = ui.badge("ブリッジ: -").props("color=grey-7")
                self._unity_badge = ui.badge("Unity: -").props("color=grey-7")
                self._surface_badge = ui.badge("定義: -").props("color=grey-7")
                ui.button("ログ", icon="receipt_long", on_click=self._log_drawer.toggle).props(
                    "flat dense no-caps color=white"
                )

        ui.add_css(BODY_CSS)
        ui.add_body_html(HEADER_HEIGHT_JS)
        ui.add_body_html(ASIDE_RESIZE_JS)
        with ui.element("div").classes("oscdesk-frame"), ui.element("div").classes("oscdesk-body"):
            self._build_main()
            ui.element("div").classes("oscdesk-aside-handle").props('role=separator aria-label="送信先・Inspector の幅を変える"')
            # 既定は宛先パネル。OSC パッドのボタンの設定を編集する間は Inspector がこの場所を借りる(D-091)
            aside = ui.element("aside").classes("oscdesk-aside")
            self._inspector_area.build(aside, self._destinations_panel.build)

        ui.timer(SYNC_INTERVAL_S, self.sync)

    def _build_main(self) -> None:
        with ui.column().classes("oscdesk-main q-pa-md items-stretch"):
            with ui.card().classes("w-full q-pa-sm"):
                with ui.row().classes("w-full items-center justify-between no-wrap"):
                    self._surface_label = ui.label("-").classes("text-caption")
                    ui.button("再取得", on_click=self._state.link.request_surface).props(
                        "flat dense no-caps"
                    ).classes("whitespace-nowrap")

                self._link_label = ui.label("-").classes("text-caption text-grey-7 break-all")
                self._target_label = ui.label("-").classes("text-caption text-grey-7")
                # 宛先ごとの再送(D-046)は「再送」タブに置く(D-094)。中身はタブを作るたびに作り直す
                self._targets_key: tuple | None = None
                self._targets_list: Any = None
                self._error_label = ui.label("").classes("text-caption text-negative")

            self._project_panel.build()

            # 認証が無いため鍵ではなく誤操作防止の切り替え。本番モードでは配置を変えられない
            # 当たり判定はトグル本体だけに絞る(HID-255)。q-toggle に label を渡すと文字まで
            # クリック対象になり、さらに items-stretch の列で横幅いっぱいに伸びて行全体が
            # 押せてしまう。ラベルは押せない ui.label に分け、行も伸ばさない
            with ui.row().classes("self-start items-center no-wrap gap-1"):
                self._edit_switch = ui.switch(on_change=self._on_edit_mode).props(
                    'aria-label="編集モード"'
                )
                ui.label("編集モード").classes("select-none")
            self._editor_slot = ui.column().classes("w-full items-stretch")

            # optionsFrom を持つ欄があるときだけ中身を作る(HID-206)
            self._options_row = ui.row().classes("w-full items-center")
            self._pending_options_panel.build()
            self._container = ui.column().classes("w-full items-stretch")

    # --- 定期同期 ---------------------------------------------------------

    def sync(self) -> None:
        # 範囲の外になったページ(D-104)は要素を外したので、以後は何もしない
        if self._evicted or self._enforce_allowed_browsers():
            return
        self._state.tick()
        self._show_notices()
        self._sync_status()

        if self._surface_revision != self._state.surface_revision:
            self._rebuild()

        self._sync_editor()
        self._sync_runtime_options()
        self._pending_options_panel.sync()
        self._project_panel.sync()

        for binding in self._bindings:
            if binding.is_editing:
                # フォーカス中の input はキー入力がなくてもホールドを延長する。
                # 期限切れ(INPUT_HOLD_TIMEOUT_S)は、このタイマーが止まった
                # (ページが消えた)あとの保険としてだけ働く。
                self._on_hold_begin(binding.entry)

            channel = self._state.values.get(binding.entry.address)

            if channel is None or channel.revision == binding.revision:
                continue

            binding.revision = channel.revision
            binding.apply(channel.values)

        for table in self._record_tables:
            table.sync()

        self._destinations_panel.sync()
        self._network_panel.sync()

        # OSC パッド(D-080)もこのタイマーで同期する(パネルが自前のタイマーを持つと、作り直しのたびに増える)
        self._pad_panel.sync()
        self._log_drawer.sync()

    def _enforce_allowed_browsers(self) -> bool:
        """許可リスト(D-104)が変わってこのブラウザが範囲の外になったら、読み込み直させる。

        新しい要求は UI の HTTP のミドルウェアが断るが、開いたままのページは socket.io の接続が残って操作できてしまう。
        読み込み直させれば、ミドルウェアが断る画面になる。許可リストがまだ届いていない間は何もしない
        (届く前の判定はミドルウェアが受け持ち、ここで追い出すと起動直後に開いたページが読み込みを繰り返す)
        """
        revision = self._state.network_settings_revision
        if revision == self._network_revision:
            return False
        self._network_revision = revision
        allowed = self._state.allowed_browsers
        if allowed is None or not self._browser_address:
            return False
        if is_browser_allowed(self._browser_address, allowed):
            return False
        self._evict()
        return True

    def _permitted(self) -> bool:
        """操作を受けてよいか。同期のタイマーを待たずに、操作のたびに許可リスト(D-104)を確かめ直す。"""
        if self._evicted:
            return False
        return not self._enforce_allowed_browsers()

    def _evict(self) -> None:
        """範囲の外になったページをサーバー側で止める(D-104)。

        読み込み直しの指示はブラウザが従わなければ効かない。従わない端末が開いたままの socket.io から操作を続け
        (許可リストを自分を含むように戻すことも含む)られないよう、ページの要素(イベントの受け手とこの同期のタイマー)を
        すべて外す。NiceGUI は受け手の無いイベントを捨てるので、以後このページからの操作は何も起こさない。
        保持していたホールドは切断と同じく解放する
        """
        self._evicted = True
        client = self._client
        if client is None:
            return
        with client:
            ui.navigate.reload()
        self._on_disconnect()
        self._bindings = []
        self._record_tables = []
        client.remove_all_elements()

    def _sync_runtime_options(self) -> None:
        """Unity の一覧が変わったら、選択欄の候補だけを差し替える。画面は作り直さず、値も送らない。"""
        revision = self._state.runtime_options_revision
        if revision == self._runtime_options_revision:
            return
        self._runtime_options_revision = revision
        for binding in self._bindings:
            if binding.set_options is None:
                continue
            binding.set_options(*self._state.options_for(binding.entry))

    def _refresh_runtime_options(self) -> None:
        if self._state.request_runtime_options_refresh():
            notify(REFRESH_SENT_MESSAGE, type="info")
        else:
            notify("ブリッジに接続していないため要求できませんでした", type="warning")

    # --- 編集モード -------------------------------------------------------

    def _on_edit_mode(self, event: Any) -> None:
        if event.value:
            self._open_editor()
            return
        if self._editor is not None and self._editor.session.dirty:
            self._confirm_discard()
            return
        self._close_editor()

    def _open_editor(self) -> None:
        state = self._state
        definition = state.definition if state.definition is not None else new_definition()
        session = EditSession(definition, state.surface_revision, state.active_surface)
        self._editor_slot.clear()
        with self._editor_slot:
            self._editor = EditorPanel(
                session,
                save=lambda name, draft: state.save_surface(name, draft),
                load=state.load_surface,
                current_revision=lambda: state.surface_revision,
                saved_names=lambda: state.surface_names,
                active_name=lambda: state.active_surface,
            )
            self._editor.build()
        self._editor_key = (state.surface_names, state.surface_revision)

    def _close_editor(self) -> None:
        self._editor = None
        self._editor_slot.clear()

    def _confirm_discard(self) -> None:
        with ui.dialog() as dialog, ui.card():
            ui.label("保存していない変更があります。破棄して本番モードへ戻りますか?")
            with ui.row().classes("w-full justify-end"):

                def keep() -> None:
                    dialog.close()
                    self._edit_switch.value = True

                def discard() -> None:
                    dialog.close()
                    self._close_editor()

                ui.button("編集を続ける", on_click=keep).props("flat no-caps")
                ui.button("破棄する", on_click=discard).props("no-caps color=negative")
        dialog.open()

    def _sync_editor(self) -> None:
        editor = self._editor
        if editor is None:
            return
        state = self._state
        # 自分の保存が採用されて作業コピーと一致したら、それを新しい出発点にする(競合扱いにしない)
        if editor.session.dirty and state.definition == editor.session.draft:
            editor.session.mark_saved(state.surface_revision, state.active_surface)
        # 未編集なら、他の端末の保存や読み込みを作業コピーへそのまま追従させる
        # 内容が同一でも出発点(revision・保存名)は必ず合わせる。合わせないと保存名が古い定義を指したままになり、
        # 次の保存で別の定義を上書きしたり、偽の競合警告が出たりする
        if not editor.session.dirty and state.definition is not None:
            if state.definition == editor.session.draft or editor.session.replace(state.definition) is None:
                previous_name = editor.session.base_name
                editor.session.mark_saved(state.surface_revision, state.active_surface)
                if previous_name != state.active_surface:
                    editor.set_save_name(state.active_surface or "")
        key = (state.surface_names, state.surface_revision)
        if key != self._editor_key:
            self._editor_key = key
            editor.refresh()

    def _show_notices(self) -> None:
        for notice in self._state.notices_since(self._notice_cursor):
            self._notice_cursor = notice.seq
            notification_type = {
                "error": "negative",
                "warn": "warning",
                "info": "info",
            }[notice.level]
            notify(notice.message, type=notification_type)

    def _sync_status(self) -> None:
        link = self._state.link_status
        surface = self._state.surface_status
        config = self._state.config

        bridge_detail = f"ブリッジ: {link.detail}"
        if self._link_badge.text != bridge_detail:
            self._link_badge.text = bridge_detail
            self._link_badge.props(f"color={'positive' if link.connected else 'warning'}")

        reachability = self._state.unity_link_status
        rtt = "-" if reachability.last_rtt_ms is None else f"{reachability.last_rtt_ms:g} ms"
        if reachability.reachability == "lost":
            unity_detail = f"Unity 未接続 (RTT {rtt}, 連続喪失 {reachability.consecutive_losses} 回)"
            unity_color = "negative"
        elif reachability.reachability == "reachable":
            unity_detail = f"Unity 接続中 ({rtt}, 連続喪失 {reachability.consecutive_losses} 回)"
            unity_color = "positive"
        else:
            unity_detail = "Unity 未確認"
            unity_color = "grey-7"
        self._unity_badge.text = unity_detail
        self._unity_badge.props(f"color={unity_color}")

        self._link_label.text = f"ブリッジ: {config.websocket_url}"

        surface_detail = f"定義: {surface.detail}"
        if surface.name is not None:
            surface_detail += f" — {surface.name} ({surface.parameter_count} 件, rev {surface.revision})"
        saved = self._state.surface_names
        if saved:
            surface_detail_long = f"{surface_detail} / 保存済み: {', '.join(saved)}"
        else:
            surface_detail_long = surface_detail
        self._surface_label.text = surface_detail_long
        self._surface_badge.text = surface_detail
        self._surface_badge.props(f"color={'positive' if surface.name is not None else 'grey-7'}")

        # hello フレーム受信前は unity が None(ブリッジ未接続・再接続中の新規ページ)
        unity_target = "未取得 (hello 待ち)" if config.unity is None else config.unity.target
        self._target_label.text = f"Unity 宛先: {unity_target}"
        self._sync_targets()
        self._error_label.text = link.last_error or ""

    def _sync_targets(self) -> None:
        # 宛先ごとの再送(D-046)を「再送」タブに 1 台 1 行で並べる(D-094)。ステータスの欄に横一列で並べると、
        # ブロードキャストへ答えた台が増えたときに折り返しが崩れて押し分けにくい
        if self._targets_list is None:
            return
        targets = self._state.unity_targets
        key = tuple((t.name, t.primary, t.reachability) for t in targets)
        if key == self._targets_key:
            return
        self._targets_key = key
        self._targets_list.clear()
        colors = {"reachable": "positive", "lost": "negative"}
        labels = {"reachable": "接続中", "lost": "未接続"}
        with self._targets_list:
            if not targets:
                ui.label("宛先がまだありません(ブリッジの接続待ち)").classes("text-grey-7")
                return
            ui.button("全台へ再送", on_click=lambda _event=None: self._state.request_resend()).props("no-caps")
            for target in targets:
                role = "主系" if target.primary else "副系"
                state = labels.get(target.reachability, "未確認")
                with ui.row().classes("w-full items-center no-wrap q-py-xs").style(
                    "gap:8px;border-bottom:1px solid rgba(0,0,0,0.08)"
                ):
                    ui.button(
                        "再送",
                        on_click=lambda _event=None, name=target.name: self._state.request_resend(name),
                    ).props("dense no-caps outline")
                    ui.label(target.name).classes("col text-body2 break-all")
                    ui.badge(f"{role} / {state}").props(f"color={colors.get(target.reachability, 'grey-7')}")

    def _build_resend_tab(self) -> None:
        ui.label("Unity へ保持値を送り直します。宛先ごとに押すか、全台へまとめて送ります").classes(
            "text-caption text-grey-7 q-mb-sm"
        )
        self._targets_list = ui.column().classes("w-full items-stretch").style("gap:0")
        # 作り直したタブは空なので、次の同期で必ず描く
        self._targets_key = None
        self._sync_targets()

    def _rebuild(self) -> None:
        self._surface_revision = self._state.surface_revision
        self._bindings = []
        # 作り直しで消える表の操作中の行は、送らずに捨てる(state 側も定義の変更で行のホールドを打ち切っている)
        self._record_tables = []
        self._container.clear()
        self._options_row.clear()
        surface = self._state.surface

        # アプリ全体のタブ(定義に依存しない)は、定義の有無にかかわらず画面タブの後ろに並べる

        def build_control(spec: ControlSpec) -> None:
            self._bindings.append(self._factory.build(spec))

        with self._container:
            if surface is None:
                ui.label("定義待ち。ブリッジからの surface フレームを待っています。").classes("text-grey-7")
                self._render_extra_tabs_only()
                return

            if not surface.screens or not any(screen.layout for screen in surface.screens):
                ui.label("定義に画面または部品がありません。").classes("text-grey-7")
                self._render_extra_tabs_only()
                return

            # 配置は layout.py が決め、部品は与えられた枠に収まるだけ(HID-163)
            render_screens(
                surface.screens,
                build_control,
                self._factory.build_action,
                self._build_record,
                extra_tabs=self._extra_tabs(),
                on_tab_change=self._on_tab_change,
            )

        # 画面の作り直しで候補は組み直し済み(factory が現在の選択肢を使う)
        self._runtime_options_revision = self._state.runtime_options_revision
        # レコード表の行は Unity のキーの一覧から来るので、表があれば一覧の取り直しを出す
        if self._record_tables or any(binding.set_options is not None for binding in self._bindings):
            with self._options_row:
                ui.button("一覧を更新", on_click=self._refresh_runtime_options).props("flat dense no-caps")
                ui.label("Unity が持つ選択肢を取り直します").classes("text-caption text-grey-7")

    def _extra_tabs(self) -> list[tuple[str, Any]]:
        """定義の画面の後ろに並べる、アプリ全体のタブ(OSC パッド D-080、再送 D-094、ネットワーク D-104)。宛先はタブでなく右側のパネル(D-086)。"""
        return [("OSC パッド", self._build_pad_tab), ("再送", self._build_resend_tab), ("ネットワーク", self._network_panel.build)]

    def _render_extra_tabs_only(self) -> None:
        # 定義が無くてもパッドは使える(サーフェス定義とは独立。D-080)
        render_screens(
            (), lambda _spec: None, lambda _action: None, extra_tabs=self._extra_tabs(), on_tab_change=self._on_tab_change
        )

    def _build_pad_tab(self) -> None:
        self._pad_panel.build()

    def _on_tab_change(self, name: str | None) -> None:
        # パッドのタブを外れている間は、パッドの Inspector を出さない(送信先パネルへ戻す。D-091)
        self._pad_panel.set_active(name is not None and name == self._pad_tab_name())

    def _pad_tab_name(self) -> str | None:
        # タブ名は _extra_tabs の並びの位置で決まるので、位置を決め打ちせず並びから引く(タブを足したときにずれない)
        for index, (_label, build) in enumerate(self._extra_tabs()):
            if build == self._build_pad_tab:
                return extra_tab_name(index)
        return None

    def _build_record(self, node: RecordNode) -> None:
        table = RecordTable(node, self._state)
        table.build()
        self._record_tables.append(table)

    # --- UI からの操作 ----------------------------------------------------

    def _on_local(self, entry: ControlSpec, values: tuple[Any, ...]) -> None:
        if not self._permitted():
            return
        self._state.set_local(entry, values)

    def _on_discrete(self, entry: ControlSpec, values: tuple[Any, ...]) -> None:
        if not self._permitted():
            return
        self._state.set_discrete(entry, values)

    def _on_trigger_press(self, entry: ControlSpec) -> None:
        if not self._permitted():
            return
        self._state.press_trigger(entry)

    def _on_action_press(self, action: ActionSpec) -> None:
        if not self._permitted():
            return
        self._state.press_action(action)

    def _on_draft(self, entry: ControlSpec, raw: Any) -> None:
        if not self._permitted():
            return
        self._state.set_draft(entry, raw)

    def _on_hold_begin(self, entry: ControlSpec) -> None:
        self._held_addresses.add(entry.address)
        self._state.begin_hold(entry.address, entry.widget)

    def _on_hold_end(self, entry: ControlSpec) -> None:
        self._held_addresses.discard(entry.address)
        self._state.end_hold(entry)

    def _on_disconnect(self) -> None:
        """クライアント切断時に、このページが開始したホールドを解放する。"""
        self._state.release_holds(self._held_addresses)
        self._held_addresses.clear()
        for table in self._record_tables:
            self._state.release_record_holds(table.held_rows)


def _client_address(client: Any) -> str:
    """ページのブラウザのアドレス。分からない(テストの模擬ブラウザなど)なら空。"""
    try:
        return str(client.ip or "")
    except AttributeError:
        return ""
