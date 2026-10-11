from __future__ import annotations

from typing import Any

from nicegui import ui
from nicegui.testing import user_simulation

from oscdesk_ui.config import AppConfig, UnityTarget
from oscdesk_ui.layout import MIN_ITEM_WIDTH_PX, item_style
from oscdesk_ui.page import SurfacePage
from oscdesk_ui.state import SurfaceState
from oscdesk_ui.surface_model import ColumnNode, ControlNode, GroupNode, RowNode, TabsNode, parse_surface

from .surface_fixtures import control, definition, param, surface_frame

PARAMS = [param(name, f"/{name}", "bool", name.upper()) for name in ("a", "b", "c", "d")]

LAYOUT = [
    {"kind": "row", "children": [control("a", width=8), control("b", width=4)]},
    {"kind": "group", "label": "G", "collapsed": True, "width": 6, "children": [control("c")]},
    {"kind": "tabs", "tabs": [{"label": "T1", "children": [control("d")]}, {"label": "T2", "children": []}]},
    {"kind": "column", "children": []},
]


class FakeLink:
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        pass

    def request_surface(self) -> None:
        pass


def test_parse_surface_keeps_layout_tree_and_widths() -> None:
    screen = parse_surface(definition(PARAMS, LAYOUT)).screens[0]

    row, group, tabs, column = screen.layout
    assert isinstance(row, RowNode) and [c.width for c in row.children if isinstance(c, ControlNode)] == [8, 4]
    assert isinstance(group, GroupNode) and group.collapsed is True and group.width == 6
    assert isinstance(tabs, TabsNode) and [t.label for t in tabs.tabs] == ["T1", "T2"]
    assert isinstance(column, ColumnNode) and column.children == ()
    # 平らな部品の並びは従来どおり出現順
    assert [spec.param_id for spec in screen.controls] == ["a", "b", "c", "d"]


def test_auto_and_missing_width_are_none_and_group_defaults_open() -> None:
    layout = [
        {"kind": "group", "label": "G", "children": [control("a", width="auto")]},
    ]
    group = parse_surface(definition(PARAMS, layout)).screens[0].layout[0]

    assert isinstance(group, GroupNode) and group.collapsed is False
    assert isinstance(group.children[0], ControlNode) and group.children[0].width is None


def test_item_style_wraps_below_minimum_width() -> None:
    assert f"{MIN_ITEM_WIDTH_PX}px" in item_style(None)
    assert item_style(8).startswith("flex:8 1 0")


async def test_layout_renders_groups_tabs_and_controls() -> None:
    state = SurfaceState(AppConfig(unity=UnityTarget("127.0.0.1", 7090, 7091)), link_factory=FakeLink)
    state._on_frame(surface_frame(definition(PARAMS, LAYOUT)))
    page = SurfacePage(state)

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")

        labels = {element.props.get("label") for element in user.find(kind=ui.switch).elements}
        assert {"A", "B", "C", "D"} <= {e.text for e in user.find(kind=ui.switch).elements} | labels
        assert len(user.find(kind=ui.expansion).elements) == 1
        assert {e.props["label"] for e in user.find(kind=ui.tab).elements} == {"T1", "T2"}


async def test_multiple_screens_become_top_level_tabs() -> None:
    defn = definition(PARAMS[:2])
    defn["screens"].append({"id": "second", "label": "Second", "children": [control("b")]})
    state = SurfaceState(AppConfig(unity=UnityTarget("127.0.0.1", 7090, 7091)), link_factory=FakeLink)
    state._on_frame(surface_frame(defn))
    page = SurfacePage(state)

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")

        assert {e.props["label"] for e in user.find(kind=ui.tab).elements} == {"Main", "Second"}
