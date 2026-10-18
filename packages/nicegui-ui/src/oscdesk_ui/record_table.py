"""レコード表(D-064)。行 = キー、列 = フィールド。

行はキーの一覧(runtimeOptions の keys)と保持値(desired)から来るので、画面を作り直さずに
行の増減と並べ替えだけを行う(操作中の欄を壊さない)。欄の部品は通常のパラメータと同じ
WidgetFactory で作り、値の調停は SurfaceState の行単位の表示キャッシュに任せる。
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Any

from nicegui import ui

from .entry_rules import trigger_value
from .notify_history import notify
from .state import SurfaceState
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
    applying: bool = False


@dataclass
class _Row:
    key: str
    element: Any
    mark: Any
    # (フィールドの添字, 部品)。trigger レコードの欄は固定値の表示だけなので持たない
    cells: list[tuple[int, WidgetBinding]] = field(default_factory=list)


class RecordTable:
    """1 つの record ノードの表。ページの 20Hz 同期(D-021)から sync() を呼んでもらう。"""

    def __init__(self, node: RecordNode, state: SurfaceState) -> None:
        self.node = node
        self._state = state
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
                        ui.label(record.key_label)
                        for column in self.node.columns:
                            ui.label(column.spec.label)
                        if self._has_actions:
                            ui.label("")
                    self._build_bulk_row()
                    self._body = ui.column().classes("w-full").style("gap:0")
                    self._build_add_row()
                self._build_table_actions()
            empty_text = EMPTY_UI_KEYS_TEXT if record.keys_source == "ui" else EMPTY_TEXT
            self._empty = ui.label(empty_text).classes("text-caption text-grey-7")

    def _build_add_row(self) -> None:
        """表の下の行の追加(D-075)。キーを入力して足す。上限に達した表では閉じる(sync で切り替える)。"""
        if not self.node.edit_rows:
            return
        record = self.node.record
        with ui.row().classes("w-full no-wrap items-center").style("gap:6px;padding-top:6px"):
            self._add_input = ui.input(placeholder=f"追加する{record.key_label}").props("dense hide-bottom-space").classes("col")
            self._add_button = ui.button("追加", icon="add", on_click=lambda _e=None: self._add()).props("dense no-caps unelevated")
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

    def _build_remove_button(self, key: str) -> None:
        """行の左の ×(D-075)。押すと確認のメニューを開き、その項目で消す(ブラウザのダイアログは使わない)。"""
        record = self.node.record
        # ツールチップは付けない(開いたメニューの項目の上に重なって押しにくくなる)
        with ui.button(icon="close").props("flat dense round size=sm color=grey-7 aria-label=この行を削除"):
            with ui.menu():
                ui.menu_item(f"「{key}」を削除", on_click=lambda _e=None: self._remove(key))
                if record.keys_source != "ui":
                    # Unity の一覧から行ができる表では、消せるのは保持値だけ。一覧にある間は行が残り既定値に戻る
                    ui.label("Unity の一覧にある名前は、行が残り既定値に戻ります").classes("text-caption text-grey-7 q-px-md q-pb-sm")

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
                    on_click=lambda _e=None, a=action: state.press_action(a),
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
                                ui.button(action.label, on_click=lambda _e=None, a=action: state.press_action(a)).props(
                                    "dense no-caps"
                                ).classes("col")
            if self._has_actions:
                ui.label("")

    def _build_toggle(self, toggle: ColumnToggle, field_index: int) -> None:
        """一括トグル(D-073): 共通のラベルとその直下のスイッチ 1 つ。

        表示は全行がオンならオン、全行がオフならオフ、混在なら不定。操作はオンで on、オフで off のアクションを送る。
        """
        state = self._state
        ui.label(toggle.label).classes("text-caption text-grey-8")
        view = _ToggleView(toggle=toggle, field_index=field_index, switch=ui.switch(value=False).props("dense"))

        def on_change(event: Any) -> None:
            # 行の値から表示を引き直したとき(apply)は送らない。不定(None)へはユーザー操作では移らない
            if view.applying or event.value is None:
                return
            state.press_action(toggle.on if event.value else toggle.off)

        view.switch.on_value_change(on_change)
        self._toggles.append(view)

    def _build_row(self, key: str) -> _Row:
        record = self.node.record
        state = self._state

        def index_of(entry: ControlSpec) -> int:
            return record.field_index(entry.param_id)

        def hold_begin(entry: ControlSpec) -> None:
            self._held.add(key)
            state.begin_record_hold(record, key, entry.widget)

        def hold_end(_entry: ControlSpec) -> None:
            self._held.discard(key)
            state.end_record_hold(record, key)

        factory = WidgetFactory(
            on_local=lambda entry, values: state.set_record_field(record, key, index_of(entry), values[0], discrete=False),
            on_discrete=lambda entry, values: state.set_record_field(record, key, index_of(entry), values[0], discrete=True),
            on_trigger_press=lambda _entry: None,
            on_draft=lambda _entry, _raw: None,
            on_hold_begin=hold_begin,
            on_hold_end=hold_end,
            options_for=lambda entry: state.field_options_for(record.record_id, entry),
        )

        with self._body:
            # 欄はカードを外して dense にそろえ、行を低く保つ(D-072。D-070 の「行の高さに伸ばす」を置き換え)
            with ui.element("div").style(f"{self._row_style};{ROW_DIVIDER_STYLE}") as element:
                with ui.row().classes("no-wrap items-center").style("gap:2px;align-self:center"):
                    if self.node.edit_rows:
                        self._build_remove_button(key)
                    with ui.column().style("gap:0"):
                        ui.label(key).classes("text-body2 text-weight-medium break-all")
                        mark = ui.label(NOT_IN_LIST_SUFFIX).classes("text-caption text-warning")
                        mark.set_visibility(False)
                row = _Row(key=key, element=element, mark=mark)
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
                            ui.button("送信", on_click=lambda _e=None: state.press_record_trigger(record, key)).props(
                                "dense no-caps"
                            )
                        for action in self.node.row_actions:
                            # pointerdown でなく click: なぞっただけで送らない(通常のアクションと同じ)
                            ui.button(action.label, on_click=lambda _e=None, a=action: state.press_action(a, key)).props(
                                "dense no-caps"
                            )
        return row

    # --- 同期 -------------------------------------------------------------

    def sync(self) -> None:
        state = self._state
        if self._rows_revision != state.record_rows_revision:
            self._rows_revision = state.record_rows_revision
            self._sync_rows()

        options_changed = self._options_revision != state.runtime_options_revision
        self._options_revision = state.runtime_options_revision
        record = self.node.record
        for row in self._rows.values():
            if any(binding.is_editing for _index, binding in row.cells):
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
        self._sync_toggles()
        if self._add_button is not None:
            # 上限(UI で管理するキーの max)に達したら追加を閉じる。消せばまた開く
            full = self._state.record_key_limit_reached(record)
            if full == self._add_button.enabled:
                self._add_button.set_enabled(not full)
                self._add_input.set_enabled(not full)

    def _sync_toggles(self) -> None:
        """一括トグル(D-073)の表示を、表示中の行の値から引き直す。全行オン → オン、全行オフ → オフ、混在 → 不定。"""
        if not self._toggles:
            return
        record = self.node.record
        channels = [self._state.record_channel(record, key) for key in self._order]
        for view in self._toggles:
            states = {
                None if channel is None or channel.values is None else _is_on(channel.values[view.field_index])
                for channel in channels
            }
            # 値の無い行はオンとは言えないのでオフとして数える(行が無ければオフ)
            states = {False if state is None else state for state in states} or {False}
            shown = states.pop() if len(states) == 1 else None
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
            removed.element.delete()
        for row in rows:
            if row.key not in self._rows:
                self._rows[row.key] = self._build_row(row.key)
            self._rows[row.key].mark.set_visibility(row.marked)
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
