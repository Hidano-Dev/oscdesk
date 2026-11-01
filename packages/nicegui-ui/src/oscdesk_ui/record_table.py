"""レコード表(D-064)。行 = キー、列 = フィールド。

行はキーの一覧(runtimeOptions の keys)と保持値(desired)から来るので、画面を作り直さずに
行の増減と並べ替えだけを行う(操作中の欄を壊さない)。欄の部品は通常のパラメータと同じ
WidgetFactory で作り、値の調停は SurfaceState の行単位の表示キャッシュに任せる。
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from typing import Any

from nicegui import ui

from .entry_rules import trigger_value
from .list_sync import build_sync_button
from .notify_history import notify
from .state import LOCK_RENEW_INTERVAL_S, SurfaceState
from .surface_model import ColumnToggle, ControlSpec, RecordNode
from .widgets import NOT_IN_LIST_SUFFIX, WidgetBinding, WidgetFactory, format_values

# 列の幅(D-076)。欄を dense の枠なしにした(D-072)ので詰められる。広げすぎると、表の右に縦長ボタン(D-074)を
# 置いたときに通常の画面幅でも表が横スクロールし、行のボタンが隠れる。
# キーの列は名前と行の削除の × を 1 段で収めたいので広めに取り、余りも多めに配る。
# スイッチの列は部品の幅が決まっているので固定の幅に詰める(一括トグルの共通ラベルも収まる幅)
KEY_COLUMN_MIN_PX = 160
FIELD_COLUMN_MIN_PX = 80
SWITCH_COLUMN_PX = 64
ACTIONS_COLUMN_MIN_PX = 64
# 表の右の縦長ボタン(D-074)の幅。ラベルが 1〜2 語で収まる程度
TABLE_ACTION_MIN_PX = 80
EMPTY_TEXT = "行がありません(Unity のキーの一覧待ち)"
EMPTY_UI_KEYS_TEXT = "行がありません(下の欄から追加してください)"
# 一括トグルの行の値が混在しているときの注記(D-094)。スイッチの列の幅(SWITCH_COLUMN_PX)に収まる長さにする
PARTIAL_TEXT = "一部オン"
# 欄の箱。部品は欄の縦中央に置く(D-072)
CELL_STYLE = "display:flex;flex-direction:column;justify-content:center"
# 部品を包むカードを表の中では枠も影も余白も無い透明な箱にする(D-072)。行の区切りは行の下罫線で示す
FLAT_CARD_STYLE = "background:transparent;box-shadow:none;border:none;border-radius:0;padding:0;width:100%"
ROW_DIVIDER_STYLE = "border-bottom:1px solid rgba(0,0,0,0.08);padding:2px 0"


@dataclass
class _ToggleView:
    toggle: ColumnToggle
    field_index: int
    switch: Any
    # 行の値が混在しているときだけ出す注記(スイッチ自体はオフで見せる。D-094)
    partial: Any
    applying: bool = False


@dataclass
class _Row:
    # 行を指す識別子(UI で管理する行では ID。D-087)。name は表示中の名前
    key: str
    element: Any
    mark: Any
    name: str = ""
    # キーの列の部品。Name を編集できる行では入力欄、それ以外はラベル
    name_view: Any = None
    name_editable: bool = False
    # 行の削除のメニューの項目(editRows の表だけ)
    remove_item: Any = None
    # (フィールドの添字, 部品)。trigger レコードの欄は固定値の表示だけなので持たない
    cells: list[tuple[int, WidgetBinding]] = field(default_factory=list)
    # ほかのブラウザが行を操作中のときの「操作中: 持ち主」(HID-390)。ロックは行単位なので、欄ごとでなく行に 1 つ出す
    lock_badge: Any = None
    # 行の送信ボタン・行のアクション。ロック中は無効にする(押してもブリッジが断る)
    buttons: list[Any] = field(default_factory=list)
    locked_by: str | None = None


class RecordTable:
    """1 つの record ノードの表。ページの 20Hz 同期(D-021)から sync() を呼んでもらう。"""

    def __init__(
        self,
        node: RecordNode,
        state: SurfaceState,
        holder: str | None = None,
        *,
        holder_label: str = "ブラウザ",
        permitted: Callable[[], bool] = lambda: True,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.node = node
        self._state = state
        # 表のアクションを押したページ(HID-392)。まとめ送りに付け、このページが操作中の部品を含んでも断られないようにする。
        # 行のロック(HID-390)の持ち主もこのページ。None(ページの外で作った表)ならロックを取らない
        self._holder = holder
        self._holder_label = holder_label
        # 許可リストの外になったページ(D-113)には操作もロックの取得もさせない
        self._permitted = permitted
        self._clock = clock
        # このページが行のロックを最後に送った時刻(行のキー → 時刻)。延長の間隔を空けるのと、外す対象を覚えるのに使う
        self._lock_sent_at: dict[str, float] = {}
        self._locks_revision = -1
        self._rows: dict[str, _Row] = {}
        self._order: list[str] = []
        self._rows_revision = -1
        self._options_revision = -1
        # このページで操作中(ホールド中)の行のキー。切断時に解放する
        self._held: set[str] = set()
        # 列の一括操作(列のアクション D-066・一括トグル D-073)の行。見出しの直下に置く(D-076)。無い表では作らない
        self._bulk_row: Any = None
        self._toggles: list[_ToggleView] = []
        self._table_action_buttons: list[Any] = []
        # 行の追加の欄(D-075)。editRows でない表では作らない
        self._add_input: Any = None
        self._add_button: Any = None
        record = node.record
        self._has_actions = record.kind == "trigger" or bool(node.row_actions)
        columns = [f"minmax({KEY_COLUMN_MIN_PX}px,2fr)"]
        min_width = KEY_COLUMN_MIN_PX
        for column in node.columns:
            if column.spec.widget == "switch":
                columns.append(f"{SWITCH_COLUMN_PX}px")
                min_width += SWITCH_COLUMN_PX
            else:
                columns.append(f"minmax({FIELD_COLUMN_MIN_PX}px,2fr)")
                min_width += FIELD_COLUMN_MIN_PX
        if self._has_actions:
            columns.append("auto")
            min_width += ACTIONS_COLUMN_MIN_PX
        # 狭い画面では表の中だけを横スクロールさせ、ページ全体には横スクロールを出さない(D-048 と同じ配慮)
        self._row_style = (
            f"display:grid;grid-template-columns:{' '.join(columns)};gap:6px;align-items:center;min-width:{min_width}px"
        )

    @property
    def held_rows(self) -> list[tuple[Any, str]]:
        return [(self.node.record, key) for key in self._held]

    # --- 行のロック(HID-390) ----------------------------------------------

    def _may_operate(self, key: str) -> bool:
        """このページが行を操作してよいか。ほかのページがロック中・進行中の行は断る(state.note_record_operator)。"""
        if not self._permitted():
            return False
        if self._holder is None:
            return True
        return self._state.note_record_operator(self.node.record, key, self._holder)

    def _send_lock(self, key: str) -> None:
        """行のロックを取る・延長する。延長は間隔(LOCK_RENEW_INTERVAL_S)ごとだけ送る。"""
        if self._holder is None:
            return
        now = self._clock()
        if now - self._lock_sent_at.get(key, float("-inf")) < LOCK_RENEW_INTERVAL_S:
            return
        self._lock_sent_at[key] = now
        self._state.acquire_record_lock(self.node.record, key, self._holder, self._holder_label)

    def _release_lock(self, key: str) -> None:
        if self._holder is None or self._lock_sent_at.pop(key, None) is None:
            return
        self._state.release_record_lock(self.node.record, key, self._holder)

    def release_locks(self) -> None:
        """このページが持つ行のロックをすべて外す(画面の作り直し・切断)。"""
        for key in list(self._lock_sent_at):
            self._release_lock(key)

    def _renew_locks(self) -> None:
        """押したまま動かさないスライダーなど、新しい操作が来ない間も行のロックを延長する。

        ホールドが期限で切れた行(pointerup が届かなかった等)は延長をやめて外す。延長し続けると、
        操作が終わった行をほかのブラウザが二度と操作できなくなる
        """
        for key in list(self._held):
            channel = self._state.record_channel(self.node.record, key)
            if channel is None or not channel.holding:
                self._held.discard(key)
                self._release_lock(key)
                continue
            self._send_lock(key)

    def _sync_locks(self) -> None:
        """ほかのブラウザが操作中の行は欄とボタンを無効にして「操作中: 持ち主」を出す。"""
        if self._locks_revision == self._state.locks_revision:
            return
        self._locks_revision = self._state.locks_revision
        record = self.node.record
        for row in self._rows.values():
            label = None if self._holder is None else self._state.record_lock_label(record, row.key, self._holder)
            if label == row.locked_by:
                continue
            row.locked_by = label
            for _index, binding in row.cells:
                if binding.set_locked is not None:
                    binding.set_locked(label)
            for button in row.buttons:
                button.set_enabled(label is None)
            if row.lock_badge is not None:
                row.lock_badge.set_text("" if label is None else f"操作中: {label}")
                row.lock_badge.set_visibility(label is not None)

    def _restore_row(self, key: str) -> None:
        """断った操作の表示を共有の値へ戻す(部品の _restore_shared と同じ理由。値はチャンネルへ書いていない)。"""
        row = self._rows.get(key)
        if row is None:
            return
        channel = self._state.record_channel(self.node.record, key)
        for index, binding in row.cells:
            binding.apply(None if channel is None or channel.values is None else (channel.values[index],))
            binding.request_reapply()

    # --- 描画 -------------------------------------------------------------

    def build(self) -> None:
        record = self.node.record
        with ui.card().classes("w-full q-pa-sm"):
            ui.label(self.node.label).classes("text-subtitle2")
            # 表の右に表全体のアクション(D-074)を置くため、表と縦長ボタンを横に並べる。表だけが横スクロールする
            with ui.row().classes("w-full no-wrap items-stretch").style("gap:8px"):
                # overflow-x:auto だけだと縦も auto になり、スイッチの切り替えの描画中に縦スクロールバーが一瞬出る
                with ui.element("div").style("overflow-x:auto;overflow-y:hidden;flex:1 1 auto;min-width:0"):
                    with ui.element("div").style(self._row_style).classes("text-caption text-grey-7"):
                        # 一覧の要求を持つ列は、見出しの横にその一覧だけを取り直す Sync を置く(D-077)
                        self._build_header(record.key_label, record.keys_sync)
                        for column in self.node.columns:
                            self._build_header(column.spec.label, column.spec.sync_request)
                        if self._has_actions:
                            ui.label("")
                    self._build_bulk_row()
                    self._body = ui.column().classes("w-full").style("gap:0")
                    self._build_add_row()
                self._build_table_actions()
            empty_text = EMPTY_UI_KEYS_TEXT if record.keys_source == "ui" else EMPTY_TEXT
            self._empty = ui.label(empty_text).classes("text-caption text-grey-7")

    def _build_header(self, label: str, sync_request: str | None) -> None:
        if sync_request is None:
            ui.label(label)
            return
        with ui.row().classes("items-center no-wrap").style("gap:2px"):
            ui.label(label)
            build_sync_button(self._state, sync_request)

    def _build_add_row(self) -> None:
        """表の下の行の追加(D-075)。キーを入力して足す。上限に達した表では閉じる(sync で切り替える)。"""
        if not self.node.edit_rows:
            return
        record = self.node.record
        # 入力欄と追加ボタンは同じ幅・同じ高さで横に並べる(ボタンが小さいと押しにくい)
        with ui.row().classes("w-full no-wrap items-stretch").style("gap:6px;padding-top:6px"):
            self._add_input = ui.input(placeholder=f"追加する{record.key_label}").props("dense outlined hide-bottom-space").classes("col")
            # flex はボタンの左右の余白を等分の外に足すので、余白を消して入力欄と同じ幅にする(文字は中央寄せのまま)
            self._add_button = ui.button("追加", icon="add", on_click=lambda _e=None: self._add()).props(
                "no-caps unelevated"
            ).classes("col").style("padding-left:0;padding-right:0")
        self._add_input.on("keydown.enter", lambda _e=None: self._add())

    def _add(self) -> None:
        if self._add_input is None or self._add_button is None or not self._add_button.enabled:
            return
        error = self._state.add_record_key(self.node.record, str(self._add_input.value or ""))
        if error is not None:
            notify(error, type="warning")
            return
        # 行はブリッジから desired で届いた時点で表に出る。入力欄は次の名前のために空ける
        self._add_input.value = ""

    def _remove(self, key: str) -> None:
        error = self._state.remove_record_key(self.node.record, key)
        if error is not None:
            notify(error, type="warning")

    def _rename(self, row: _Row) -> None:
        """Name の欄の確定(Enter・フォーカスを外したとき。D-087)。

        送れたら欄を一旦いまの Name に戻す。表示はブリッジの runtimeOptions で新しい Name に揃う。
        戻さないと、ブリッジが断った(別の画面が同じ Name を先に付けた等)とき、通らなかった Name が欄に残り続ける。
        """
        value = str(row.name_view.value or "")
        if value.strip() == row.name:
            row.name_view.value = row.name
            return
        error = self._state.rename_record_key(self.node.record, row.key, value)
        if error is not None:
            notify(error, type="warning")
        row.name_view.value = row.name

    def _build_remove_button(self, key: str, name: str) -> Any:
        """行の左の ×(D-075)。押すと確認のメニューを開き、その項目で消す(ブラウザのダイアログは使わない)。

        戻り値はメニューの項目の文言の要素(改名で文言を替えるため。消すのは ID で指した同じ行。D-087)。
        ui.menu_item は文言を子の ItemSection に持つので、その要素を返す。
        """
        record = self.node.record
        # ツールチップは付けない(開いたメニューの項目の上に重なって押しにくくなる)
        with ui.button(icon="close").props("flat dense round size=sm color=grey-7 aria-label=この行を削除"):
            with ui.menu():
                item = ui.menu_item(_remove_text(name), on_click=lambda _e=None: self._remove(key))
                if record.keys_source != "ui":
                    # Unity の一覧から行ができる表では、消せるのは保持値だけ。一覧にある間は行が残り既定値に戻る
                    ui.label("Unity の一覧にある名前は、行が残り既定値に戻ります").classes("text-caption text-grey-7 q-px-md q-pb-sm")
        return item.default_slot.children[0]

    def _build_table_actions(self) -> None:
        """表全体のアクション(D-074)を、表の右側に表の高さいっぱいの縦長ボタンで並べる。

        行の並びの横に置き、全行を束ねて送ることを形で示す。表の外の横長の action ノードと違い、
        どの表の全行が対象なのかが位置で分かる。
        """
        if not self.node.table_actions:
            return
        state = self._state
        with ui.row().classes("no-wrap items-stretch").style("gap:4px"):
            for action in self.node.table_actions:
                # pointerdown でなく click: なぞっただけで全行へ送らない(通常のアクションと同じ)
                button = ui.button(
                    action.label,
                    icon="keyboard_double_arrow_right",
                    on_click=lambda _e=None, a=action: state.press_action(a, holder=self._holder),
                )
                button.props("stack no-caps unelevated").style(f"min-width:{TABLE_ACTION_MIN_PX}px")
                self._table_action_buttons.append(button)

    def _build_bulk_row(self) -> None:
        """列のアクション(D-066)と一括トグル(D-073)を、表の見出しの直下で各列の下に並べる行(D-076)。

        行と同じ格子に載せて列と揃える。行の並びの上に置くのは、行が増えても位置が動かず、
        列の見出しと一括操作が一緒に見えるため。表全体の確定(D-074)とは役割の階層が違うので、置き場所で区別する。
        """
        if not any(column.actions or column.toggle for column in self.node.columns):
            return
        state = self._state
        with ui.element("div").style(f"{self._row_style};{ROW_DIVIDER_STYLE};padding:2px 0 4px") as self._bulk_row:
            ui.label("")
            for column in self.node.columns:
                if not column.actions and column.toggle is None:
                    ui.label("")
                    continue
                with ui.column().classes("w-full").style("gap:2px"):
                    if column.toggle is not None:
                        self._build_toggle(column.toggle, column.field_index)
                    if column.actions:
                        with ui.row().classes("w-full no-wrap").style("gap:4px"):
                            for action in column.actions:
                                # pointerdown でなく click: なぞっただけで全行へ送らない(通常のアクションと同じ)
                                ui.button(action.label, on_click=lambda _e=None, a=action: state.press_action(a, holder=self._holder)).props(
                                    "dense no-caps"
                                ).classes("col")
            if self._has_actions:
                ui.label("")

    def _build_toggle(self, toggle: ColumnToggle, field_index: int) -> None:
        """一括トグル(D-073): 共通のラベルとその直下のスイッチ 1 つ。

        表示は全行がオンならオン、それ以外(全行オフ・混在)はオフで、混在のときは下に注記を出す(D-094)。
        操作はオンで on、オフで off のアクションを送る(混在から切り替えると全行がオンになる)。
        """
        state = self._state
        ui.label(toggle.label).classes("text-caption text-grey-8")
        switch = ui.switch(value=False).props("dense")
        partial = ui.label(PARTIAL_TEXT).classes("text-caption text-grey-7")
        partial.set_visibility(False)
        view = _ToggleView(toggle=toggle, field_index=field_index, switch=switch, partial=partial)

        def on_change(event: Any) -> None:
            # 行の値から表示を引き直したとき(apply)は送らない
            if view.applying or event.value is None:
                return
            state.press_action(toggle.on if event.value else toggle.off, holder=self._holder)

        view.switch.on_value_change(on_change)
        self._toggles.append(view)

    def _build_row(self, key: str, name: str) -> _Row:
        record = self.node.record
        state = self._state

        def index_of(entry: ControlSpec) -> int:
            return record.field_index(entry.param_id)

        def hold_begin(entry: ControlSpec) -> None:
            # ほかのページが操作中の行ではホールドもロックの取得もしない(このページの操作は始まらない。HID-390)
            if not self._may_operate(key):
                return
            self._held.add(key)
            state.begin_record_hold(record, key, entry.widget)
            # 操作の開始で行のロックを取る。続く操作での延長は間隔ごとだけ送る
            self._send_lock(key)

        def hold_end(_entry: ControlSpec) -> None:
            # このページが始めたホールドだけを終える。断られたページの pointerup・blur で、ほかのページの操作を終わらせない
            if key not in self._held:
                return
            self._held.discard(key)
            state.end_record_hold(record, key)
            self._release_lock(key)

        def edit(entry: ControlSpec, values: tuple[Any, ...], *, discrete: bool) -> None:
            if not self._may_operate(key):
                self._restore_row(key)
                return
            state.set_record_field(record, key, index_of(entry), values[0], discrete=discrete)

        def press_trigger() -> None:
            if self._may_operate(key):
                state.press_record_trigger(record, key)

        factory = WidgetFactory(
            on_local=lambda entry, values: edit(entry, values, discrete=False),
            on_discrete=lambda entry, values: edit(entry, values, discrete=True),
            on_trigger_press=lambda _entry: None,
            on_draft=lambda _entry, _raw: None,
            on_hold_begin=hold_begin,
            on_hold_end=hold_end,
            options_for=lambda entry: state.field_options_for(record.record_id, entry),
            lock_badges=False,
        )

        with self._body:
            # 欄はカードを外して dense にそろえ、行を低く保つ(D-072。D-070 の「行の高さに伸ばす」を置き換え)
            with ui.element("div").style(f"{self._row_style};{ROW_DIVIDER_STYLE}") as element:
                # UI で管理する行(D-087)は Name を後から変えられる。行は ID で指すので、改名しても値はそのまま
                name_editable = self.node.edit_rows and record.has_row_ids
                with ui.row().classes("no-wrap items-center").style("gap:2px;align-self:center;width:100%"):
                    remove_item = self._build_remove_button(key, name) if self.node.edit_rows else None
                    with ui.column().classes("col").style("gap:0"):
                        if name_editable:
                            name_view = ui.input(value=name).props(
                                f"dense hide-bottom-space borderless aria-label={record.key_label}"
                            ).classes("text-body2 text-weight-medium w-full")
                        else:
                            name_view = ui.label(name).classes("text-body2 text-weight-medium break-all")
                        mark = ui.label(NOT_IN_LIST_SUFFIX).classes("text-caption text-warning")
                        mark.set_visibility(False)
                        lock_badge = ui.label("").classes("text-caption text-warning")
                        lock_badge.set_visibility(False)
                row = _Row(
                    key=key,
                    element=element,
                    mark=mark,
                    name=name,
                    name_view=name_view,
                    name_editable=name_editable,
                    remove_item=remove_item,
                    lock_badge=lock_badge,
                )
                if name_editable:
                    name_view.on("keydown.enter", lambda _e=None: self._rename(row))
                    name_view.on("blur", lambda _e=None: self._rename(row))
                for column in self.node.columns:
                    with ui.element("div").style(CELL_STYLE) as cell:
                        if record.kind == "trigger":
                            # trigger のフィールドは固定値(定義の value)。表示だけで編集しない
                            ui.label(format_values((trigger_value(column.spec),))).classes("text-body2")
                            continue
                        # 列の見出しが表示名を持つので、欄ごとの表示名は出さない
                        row.cells.append((column.field_index, factory.build(replace(column.spec, label=""))))
                    _fit_cell_to_row(cell)
                if self._has_actions:
                    with ui.row().classes("items-center no-wrap").style("gap:4px"):
                        if record.kind == "trigger":
                            row.buttons.append(
                                ui.button("送信", on_click=lambda _e=None: press_trigger()).props("dense no-caps")
                            )
                        for action in self.node.row_actions:
                            # pointerdown でなく click: なぞっただけで送らない(通常のアクションと同じ)
                            row.buttons.append(
                                ui.button(
                                    action.label, on_click=lambda _e=None, a=action: state.press_action(a, key, holder=self._holder)
                                ).props("dense no-caps")
                            )
        return row

    # --- 同期 -------------------------------------------------------------

    def sync(self) -> None:
        state = self._state
        if self._rows_revision != state.record_rows_revision:
            self._rows_revision = state.record_rows_revision
            self._sync_rows()
            # 足した行にもロックの表示を当てる
            self._locks_revision = -1

        options_changed = self._options_revision != state.runtime_options_revision
        self._options_revision = state.runtime_options_revision
        record = self.node.record
        for row in self._rows.values():
            # このページが始めたホールドだけを延長する。断られたページの入力欄もフォーカス中は is_editing になるが、
            # その延長でほかのページのホールドを伸ばさない
            if row.key in self._held and any(binding.is_editing for _index, binding in row.cells):
                # フォーカス中の入力欄がある行はホールドを延長し続ける(page の通常の欄と同じ)
                state.begin_record_hold(record, row.key, "input")
            channel = state.record_channel(record, row.key)
            for index, binding in row.cells:
                if options_changed and binding.set_options is not None:
                    binding.set_options(*state.field_options_for(record.record_id, binding.entry))
                # 編集中の入力欄は書き換えない(同じ行の別の欄の操作で行の値が変わっても、打ちかけの内容を残す)
                if channel is None or binding.is_editing or channel.revision == binding.revision:
                    continue
                binding.revision = channel.revision
                binding.apply(None if channel.values is None else (channel.values[index],))
        self._renew_locks()
        self._sync_locks()
        self._sync_toggles()
        if self._add_button is not None:
            # 上限(UI で管理するキーの max)に達したら追加を閉じる。消せばまた開く
            full = self._state.record_key_limit_reached(record)
            if full == self._add_button.enabled:
                self._add_button.set_enabled(not full)
                self._add_input.set_enabled(not full)

    def _sync_toggles(self) -> None:
        """一括トグルの表示を、表示中の行の値から引き直す。全行オン → オン、それ以外 → オフ(混在は注記つき。D-094)。

        混在を不定(つまみが中央)で見せると、押したときにどちらへ倒れるか分からない。オフで見せれば、押すと全行がオンになる
        """
        if not self._toggles:
            return
        record = self.node.record
        channels = [self._state.record_channel(record, key) for key in self._order]
        for view in self._toggles:
            # 値の無い行はオンとは言えないのでオフとして数える(行が無ければオフ)
            states = {
                channel is not None and channel.values is not None and _is_on(channel.values[view.field_index])
                for channel in channels
            } or {False}
            shown = states == {True}
            mixed = len(states) > 1
            if view.partial.visible != mixed:
                view.partial.set_visibility(mixed)
            if view.switch.value == shown:
                continue
            view.applying = True
            try:
                view.switch.value = shown
            finally:
                view.applying = False

    def _sync_rows(self) -> None:
        """行の増減と並べ替えだけを行う。残る行の要素はそのまま(操作中の欄を壊さない)。"""
        rows = self._state.record_rows(self.node.record)
        wanted = [row.key for row in rows]
        # 行が数百〜千あっても、行の版が変わるたびに 2 乗の比較にならないよう所属の判定は集合で行う
        wanted_set = set(wanted)
        for key in [key for key in self._rows if key not in wanted_set]:
            removed = self._rows.pop(key)
            if key in self._held:
                self._held.discard(key)
                self._state.end_record_hold(self.node.record, key)
            self._release_lock(key)
            removed.element.delete()
        for row in rows:
            if row.key not in self._rows:
                self._rows[row.key] = self._build_row(row.key, row.label)
            shown = self._rows[row.key]
            shown.mark.set_visibility(row.marked)
            if shown.name != row.label:
                # 改名(D-087)は行を作り直さず、キーの列の表示だけを替える(同じ行の操作中の欄を壊さない)
                shown.name = row.label
                if shown.name_editable:
                    shown.name_view.value = row.label
                else:
                    shown.name_view.set_text(row.label)
                if shown.remove_item is not None:
                    shown.remove_item.set_text(_remove_text(row.label))
        previous = set(self._order)
        current = [key for key in self._order if key in self._rows] + [key for key in wanted if key not in previous]
        if current != wanted:
            for index, key in enumerate(wanted):
                self._rows[key].element.move(target_container=self._body, target_index=index)
        self._order = wanted
        self._empty.set_visibility(not wanted)

    def row_keys(self) -> list[str]:
        """表示中の行のキー(表示順)。テストと診断用。"""
        return list(self._order)


def _remove_text(name: str) -> str:
    return f"「{name}」を削除"


def _is_on(value: Any) -> bool:
    # bool のフィールドの値はワイヤの規則で 0 / 1(D-017)。真偽値で持っていても同じに扱う
    return isinstance(value, (bool, int, float)) and value != 0


def _fit_cell_to_row(cell: Any) -> None:
    """欄の部品を表の行に合わせる(D-072)。

    部品は通常のパラメータと同じ WidgetFactory で作るので、表の中だけの見た目はここで上書きする。
    包むカードは枠・影・余白の無い透明な箱にし、入力欄・選択・スイッチは dense にして、
    行を 1 段の低い高さ(入力欄の dense の高さ)にそろえる。入力欄と選択の下の余白(エラー文の場所)も
    普段は詰め、エラーのときだけ広がるようにする。
    """
    for element in cell.descendants():
        if isinstance(element, (ui.input, ui.select)):
            element.props("dense hide-bottom-space")
        elif isinstance(element, ui.switch):
            element.props("dense")
        elif isinstance(element, ui.card):
            element.props("flat").style(FLAT_CARD_STYLE)
