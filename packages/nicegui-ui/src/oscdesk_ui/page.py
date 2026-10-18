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
from .layout import render_screens
from .list_sync import build_sync_button
from .log_drawer import LogDrawer
from .notify_history import history_for, notify
from .osc_pad_panel import OscPadPanel
from .record_table import RecordTable
from .surface_editor import EditSession, new_definition
from .surface_model import ActionSpec, ControlSpec, RecordNode
from .state import SurfaceState
from .widgets import WidgetBinding, WidgetFactory

SYNC_INTERVAL_S = 0.05


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
        # 宛先タブ(D-078)。OSC パッドと同じくページに 1 つ持ち続け、画面の作り直しでは描き直すだけにする
        # (作り直すと、応答待ちの未確定の選択が定義の再配信で消え、続けたチェックが先の変更を上書きするため)
        self._destinations_panel = DestinationsPanel(state)
        # OSC パッドのタブ(D-080)。編集中の作業コピーを画面の作り直しで失わないよう、ページに 1 つ持ち続ける
        self._pad_panel = OscPadPanel(state)

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

        with ui.column().classes("w-full q-pa-md items-stretch").style("max-width:900px;margin:0 auto"):
            with ui.card().classes("w-full q-pa-sm"):
                with ui.row().classes("w-full items-center justify-between no-wrap"):
                    self._surface_label = ui.label("-").classes("text-caption")
                    ui.button("再取得", on_click=self._state.link.request_surface).props(
                        "flat dense no-caps"
                    ).classes("whitespace-nowrap")

                self._link_label = ui.label("-").classes("text-caption text-grey-7 break-all")
                self._target_label = ui.label("-").classes("text-caption text-grey-7")
                # 冗長構成(宛先が 2 台以上)のときだけ中身を作る(D-046)
                self._targets_key: tuple = ()
                self._targets_row = ui.row().classes("w-full items-center q-gutter-x-sm")
                self._error_label = ui.label("").classes("text-caption text-negative")

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
            self._container = ui.column().classes("w-full items-stretch")

        ui.timer(SYNC_INTERVAL_S, self.sync)

    # --- 定期同期 ---------------------------------------------------------

    def sync(self) -> None:
        self._state.tick()
        self._show_notices()
        self._sync_status()

        if self._surface_revision != self._state.surface_revision:
            self._rebuild()

        self._sync_editor()
        self._sync_runtime_options()

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

        # OSC パッド(D-080)もこのタイマーで同期する(パネルが自前のタイマーを持つと、作り直しのたびに増える)
        self._pad_panel.sync()
        self._log_drawer.sync()

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
            notify("Unity に一覧を要求しました", type="info")
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
        targets = self._state.unity_targets if len(self._state.unity_targets) > 1 else ()
        key = tuple((t.name, t.primary, t.reachability) for t in targets)
        if key == self._targets_key:
            return
        self._targets_key = key
        self._targets_row.clear()
        colors = {"reachable": "positive", "lost": "negative"}
        labels = {"reachable": "接続中", "lost": "未接続"}
        with self._targets_row:
            for target in targets:
                role = "主系" if target.primary else "副系"
                state = labels.get(target.reachability, "未確認")
                ui.badge(f"{target.name} ({role}): {state}").props(f"color={colors.get(target.reachability, 'grey-7')}")
                ui.button(
                    "再送",
                    on_click=lambda _event=None, name=target.name: self._state.request_resend(name),
                ).props("flat dense no-caps")
            ui.button("全台へ再送", on_click=lambda _event=None: self._state.request_resend()).props(
                "flat dense no-caps"
            )

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
            )

        # 画面の作り直しで候補は組み直し済み(factory が現在の選択肢を使う)
        self._runtime_options_revision = self._state.runtime_options_revision
        # レコード表の行は Unity のキーの一覧から来るので、表があれば一覧の取り直しを出す
        if self._record_tables or any(binding.set_options is not None for binding in self._bindings):
            with self._options_row:
                ui.button("一覧を更新", on_click=self._refresh_runtime_options).props("flat dense no-caps")
                ui.label("Unity が持つ選択肢を取り直します").classes("text-caption text-grey-7")

    def _build_destinations_tab(self) -> None:
        self._destinations_panel.build()

    def _extra_tabs(self) -> list[tuple[str, Any]]:
        """定義の画面の後ろに並べる、アプリ全体のタブ(宛先 D-078 → OSC パッド D-080 の順)。"""
        return [("宛先", self._build_destinations_tab), ("OSC パッド", self._build_pad_tab)]

    def _render_extra_tabs_only(self) -> None:
        # 定義が無くても宛先とパッドは使える(どちらもサーフェス定義とは独立。D-078 / D-080)
        render_screens((), lambda _spec: None, lambda _action: None, extra_tabs=self._extra_tabs())

    def _build_pad_tab(self) -> None:
        self._pad_panel.build()

    def _build_record(self, node: RecordNode) -> None:
        table = RecordTable(node, self._state)
        table.build()
        self._record_tables.append(table)

    # --- UI からの操作 ----------------------------------------------------

    def _on_local(self, entry: ControlSpec, values: tuple[Any, ...]) -> None:
        self._state.set_local(entry, values)

    def _on_discrete(self, entry: ControlSpec, values: tuple[Any, ...]) -> None:
        self._state.set_discrete(entry, values)

    def _on_trigger_press(self, entry: ControlSpec) -> None:
        self._state.press_trigger(entry)

    def _on_action_press(self, action: ActionSpec) -> None:
        self._state.press_action(action)

    def _on_draft(self, entry: ControlSpec, raw: Any) -> None:
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
        self._pad_panel.release()
        for table in self._record_tables:
            self._state.release_record_holds(table.held_rows)
