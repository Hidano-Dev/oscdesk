"""画面層(行・列・折りたたみグループ・タブ・幅)の描画。

配置はここだけが決め、部品(widgets.py)は与えられた枠(w-full)に収まるだけにする。
こうしないと部品ごとに横幅を持ち、横並びのたびに部品側を直すことになる。
ウィジェットの生成と値の束縛は呼び出し側のコールバックに任せる(このモジュールは配置だけ)。
"""

from __future__ import annotations

from collections.abc import Callable

from nicegui import ui

from .surface_model import (
    ColumnNode,
    ControlNode,
    ControlSpec,
    GroupNode,
    LayoutNode,
    RowNode,
    ScreenModel,
    TabsNode,
)

GRID_COLUMNS = 12
# これより狭くなる項目は折り返して次の行へ送る。スマホ幅(360px 前後)でも横スクロールを出さない
MIN_ITEM_WIDTH_PX = 160


def item_style(width: int | None) -> str:
    """行の子 1 件の flex 指定。数値幅は残り幅を比で分け合い、下限を割ると折り返す。"""
    if width is None:
        return f"flex:1 1 {MIN_ITEM_WIDTH_PX}px;min-width:min(100%,{MIN_ITEM_WIDTH_PX}px)"
    return f"flex:{width} 1 0;min-width:min(100%,{MIN_ITEM_WIDTH_PX}px)"


def render_screens(screens: tuple[ScreenModel, ...], build_control: Callable[[ControlSpec], None]) -> None:
    """画面が 1 つならそのまま、複数ならタブで切り替える。"""
    if len(screens) == 1:
        render_nodes(screens[0].layout, build_control, in_row=False)
        return
    with ui.tabs().classes("w-full") as tabs:
        headers = [ui.tab(screen.label) for screen in screens]
    with ui.tab_panels(tabs, value=headers[0]).classes("w-full"):
        for header, screen in zip(headers, screens):
            with ui.tab_panel(header).classes("q-pa-none"):
                render_nodes(screen.layout, build_control, in_row=False)


def render_nodes(nodes: tuple[LayoutNode, ...], build_control: Callable[[ControlSpec], None], *, in_row: bool) -> None:
    for node in nodes:
        # 行の中では子ごとに幅指定の枠で包む。それ以外は縦に積むだけ
        if in_row:
            with ui.element("div").style(item_style(node.width)):
                _render_node(node, build_control)
        else:
            _render_node(node, build_control)


def _render_node(node: LayoutNode, build_control: Callable[[ControlSpec], None]) -> None:
    if isinstance(node, ControlNode):
        build_control(node.spec)
    elif isinstance(node, RowNode):
        with ui.element("div").classes("w-full").style("display:flex;flex-wrap:wrap;gap:8px;align-items:stretch"):
            render_nodes(node.children, build_control, in_row=True)
    elif isinstance(node, ColumnNode):
        with ui.column().classes("w-full items-stretch").style("gap:8px"):
            render_nodes(node.children, build_control, in_row=False)
    elif isinstance(node, GroupNode):
        with ui.expansion(node.label, value=not node.collapsed).classes("w-full").props("dense header-class=text-weight-medium"):
            with ui.column().classes("w-full items-stretch").style("gap:8px"):
                render_nodes(node.children, build_control, in_row=False)
    elif isinstance(node, TabsNode):
        with ui.tabs().classes("w-full") as tabs:
            headers = [ui.tab(tab.label) for tab in node.tabs]
        with ui.tab_panels(tabs, value=headers[0]).classes("w-full"):
            for header, tab in zip(headers, node.tabs):
                with ui.tab_panel(header).classes("q-pa-none"):
                    with ui.column().classes("w-full items-stretch").style("gap:8px"):
                        render_nodes(tab.children, build_control, in_row=False)
