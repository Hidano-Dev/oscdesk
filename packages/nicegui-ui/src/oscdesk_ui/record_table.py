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
from .state import SurfaceState
from .surface_model import ControlSpec, RecordNode
from .widgets import NOT_IN_LIST_SUFFIX, WidgetBinding, WidgetFactory, format_values

KEY_COLUMN_MIN_PX = 120
FIELD_COLUMN_MIN_PX = 140
ACTIONS_COLUMN_MIN_PX = 120
EMPTY_TEXT = "行がありません(Unity のキーの一覧待ち)"


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
        record = node.record
        self._has_actions = record.kind == "trigger" or bool(node.row_actions)
        columns = [f"minmax({KEY_COLUMN_MIN_PX}px,1fr)"] + [f"minmax({FIELD_COLUMN_MIN_PX}px,2fr)"] * len(node.columns)
        min_width = KEY_COLUMN_MIN_PX + FIELD_COLUMN_MIN_PX * len(node.columns)
        if self._has_actions:
            columns.append("auto")
            min_width += ACTIONS_COLUMN_MIN_PX
        # 狭い画面では表の中だけを横スクロールさせ、ページ全体には横スクロールを出さない(D-048 と同じ配慮)
        self._row_style = (
            f"display:grid;grid-template-columns:{' '.join(columns)};gap:8px;align-items:center;min-width:{min_width}px"
        )

    @property
    def held_rows(self) -> list[tuple[Any, str]]:
        return [(self.node.record, key) for key in self._held]

    # --- 描画 -------------------------------------------------------------

    def build(self) -> None:
        record = self.node.record
        with ui.card().classes("w-full q-pa-sm"):
            ui.label(self.node.label).classes("text-subtitle2")
            with ui.element("div").classes("w-full").style("overflow-x:auto"):
                with ui.element("div").style(self._row_style).classes("text-caption text-grey-7"):
                    ui.label(record.key_label)
                    for column in self.node.columns:
                        ui.label(column.spec.label)
                    if self._has_actions:
                        ui.label("")
                self._body = ui.column().classes("w-full").style("gap:4px")
            self._empty = ui.label(EMPTY_TEXT).classes("text-caption text-grey-7")

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
            with ui.element("div").style(self._row_style) as element:
                with ui.column().style("gap:0"):
                    ui.label(key).classes("text-body2 text-weight-medium break-all")
                    mark = ui.label(NOT_IN_LIST_SUFFIX).classes("text-caption text-warning")
                    mark.set_visibility(False)
                row = _Row(key=key, element=element, mark=mark)
                for column in self.node.columns:
                    with ui.element("div"):
                        if record.kind == "trigger":
                            # trigger のフィールドは固定値(定義の value)。表示だけで編集しない
                            ui.label(format_values((trigger_value(column.spec),))).classes("text-body2")
                            continue
                        # 列の見出しが表示名を持つので、欄ごとの表示名は出さない
                        row.cells.append((column.field_index, factory.build(replace(column.spec, label=""))))
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
