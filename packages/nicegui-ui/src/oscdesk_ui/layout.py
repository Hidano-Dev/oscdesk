"""画面層(行・列・折りたたみグループ・タブ・幅)の描画。

配置はここだけが決め、部品(widgets.py)は与えられた枠(w-full)に収まるだけにする。
こうしないと部品ごとに横幅を持ち、横並びのたびに部品側を直すことになる。
ウィジェットの生成と値の束縛は呼び出し側のコールバックに任せる(このモジュールは配置だけ)。
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

from nicegui import ui

from .surface_model import (
    ActionNode,
    ActionSpec,
    ColumnNode,
    ControlNode,
    ControlSpec,
    GroupNode,
    LayoutNode,
    RecordNode,
    RowNode,
    ScreenModel,
    TabsNode,
)

GRID_COLUMNS = 12
# これより狭くなる項目は折り返して次の行へ送る。スマホ幅(360px 前後)でも横スクロールを出さない
MIN_ITEM_WIDTH_PX = 160
# アプリ全体のタブ(extra_tabs)の Quasar のタブ名の接頭辞。定義の画面 id(英字で始まる英数字・_・-)は「:」を含められないので衝突しない
EXTRA_TAB_NAME_PREFIX = "__extra:"


def extra_tab_name(index: int) -> str:
    """アプリ全体のタブ(extra_tabs の index 番目)の Quasar のタブ名。"""
    return f"{EXTRA_TAB_NAME_PREFIX}{index}"


def item_style(width: int | None) -> str:
    """行の子 1 件の flex 指定。数値幅は残り幅を比で分け合い、下限を割ると折り返す。"""
    if width is None:
        return f"flex:1 1 {MIN_ITEM_WIDTH_PX}px;min-width:min(100%,{MIN_ITEM_WIDTH_PX}px)"
    return f"flex:{width} 1 0;min-width:min(100%,{MIN_ITEM_WIDTH_PX}px)"


@dataclass(frozen=True)
class _Builders:
    control: Callable[[ControlSpec], None]
    action: Callable[[ActionSpec], None]
    record: Callable[[RecordNode], None]


def render_screens(
    screens: tuple[ScreenModel, ...],
    build_control: Callable[[ControlSpec], None],
    build_action: Callable[[ActionSpec], None],
    build_record: Callable[[RecordNode], None] = lambda _node: None,
    *,
    extra_tabs: Sequence[tuple[str, Callable[[], None]]] = (),
    on_tab_change: Callable[[str | None], None] | None = None,
) -> None:
    """画面が 1 つで追加のタブが無ければそのまま、それ以外はタブで切り替える。

    extra_tabs は定義の画面とは別の、アプリ全体のタブ(ラベルと中身を描く関数。例: 宛先 D-078、OSC パッド D-080)。
    定義の画面の後ろに同じタブの並びで出し、これがあれば画面が 1 つ(または 0)でもタブにする。
    on_tab_change は選ばれたタブの名前を受ける。描いた直後にも最初のタブの名前で 1 回呼ぶ(作り直しでタブが先頭へ
    戻ったことを呼び手が知れるように)。タブを作らない構成では None で 1 回呼ぶ。
    """
    builders = _Builders(build_control, build_action, build_record)
    if len(screens) == 1 and not extra_tabs:
        _render_nodes(screens[0].layout, builders, in_row=False)
        if on_tab_change is not None:
            on_tab_change(None)
        return
    if not screens and not extra_tabs:
        if on_tab_change is not None:
            on_tab_change(None)
        return
    # Quasar はタブを name で区別するので、ラベル(表示専用)を name にすると同じラベルのタブ(画面「宛先」と宛先タブ等)が
    # 同じタブとして選ばれてしまう。画面は定義の id、追加のタブは id に現れない「:」を含む予約名にして、どちらとも重ならないようにする
    with ui.tabs().classes("w-full") as tabs:
        headers = [ui.tab(screen.id, label=screen.label) for screen in screens]
        extra_headers = [
            ui.tab(extra_tab_name(index), label=label) for index, (label, _build) in enumerate(extra_tabs)
        ]
    first = (headers or extra_headers)[0]

    def changed(event: Any) -> None:
        if on_tab_change is not None:
            on_tab_change(_tab_name(event.value))

    with ui.tab_panels(tabs, value=first, on_change=changed).classes("w-full"):
        for header, screen in zip(headers, screens):
            with ui.tab_panel(header).classes("q-pa-none"):
                _render_nodes(screen.layout, builders, in_row=False)
        for header, (_label, build) in zip(extra_headers, extra_tabs):
            with ui.tab_panel(header).classes("q-pa-none"):
                build()
    if on_tab_change is not None:
        on_tab_change(_tab_name(first))


def _tab_name(value: Any) -> str | None:
    # タブの値は ui.tab の要素(コードから選んだとき)か、その名前の文字列(ブラウザで選んだとき)
    if value is None or isinstance(value, str):
        return value
    name = getattr(value, "props", {}).get("name")
    return name if isinstance(name, str) else None


def render_nodes(
    nodes: tuple[LayoutNode, ...],
    build_control: Callable[[ControlSpec], None],
    build_action: Callable[[ActionSpec], None],
    *,
    in_row: bool,
    build_record: Callable[[RecordNode], None] = lambda _node: None,
) -> None:
    _render_nodes(nodes, _Builders(build_control, build_action, build_record), in_row=in_row)


def _render_nodes(nodes: tuple[LayoutNode, ...], builders: _Builders, *, in_row: bool) -> None:
    for node in nodes:
        # 行の中では子ごとに幅指定の枠で包む。それ以外は縦に積むだけ
        if in_row:
            with ui.element("div").style(item_style(node.width)):
                _render_node(node, builders)
        else:
            _render_node(node, builders)


def _render_node(node: LayoutNode, builders: _Builders) -> None:
    if isinstance(node, ControlNode):
        builders.control(node.spec)
    elif isinstance(node, ActionNode):
        builders.action(node.action)
    elif isinstance(node, RecordNode):
        builders.record(node)
    elif isinstance(node, RowNode):
        with ui.element("div").classes("w-full").style("display:flex;flex-wrap:wrap;gap:8px;align-items:stretch"):
            _render_nodes(node.children, builders, in_row=True)
    elif isinstance(node, ColumnNode):
        with ui.column().classes("w-full items-stretch").style("gap:8px"):
            _render_nodes(node.children, builders, in_row=False)
    elif isinstance(node, GroupNode):
        with ui.expansion(node.label, value=not node.collapsed).classes("w-full").props("dense header-class=text-weight-medium"):
            with ui.column().classes("w-full items-stretch").style("gap:8px"):
                _render_nodes(node.children, builders, in_row=False)
    elif isinstance(node, TabsNode):
        with ui.tabs().classes("w-full") as tabs:
            headers = [ui.tab(tab.label) for tab in node.tabs]
        with ui.tab_panels(tabs, value=headers[0]).classes("w-full"):
            for header, tab in zip(headers, node.tabs):
                with ui.tab_panel(header).classes("q-pa-none"):
                    with ui.column().classes("w-full items-stretch").style("gap:8px"):
                        _render_nodes(tab.children, builders, in_row=False)
