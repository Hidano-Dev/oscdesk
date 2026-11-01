from __future__ import annotations

from typing import Any

from nicegui import ui
from nicegui.testing import UserInteraction, user_simulation

from oscdesk_ui.config import AppConfig, UnityTarget
from oscdesk_ui.layout import MIN_ITEM_WIDTH_PX, extra_tab_name, item_style, render_screens
from oscdesk_ui.page import SurfacePage
from oscdesk_ui.state import SurfaceState, UnityTargetLinkStatus
from oscdesk_ui.surface_model import ColumnNode, ControlNode, GroupNode, RowNode, TabsNode

from .surface_fixtures import model_of, control, definition, param, surface_frame

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


def test_the_view_keeps_layout_tree_and_widths() -> None:
    screen = model_of(definition(PARAMS, LAYOUT)).screens[0]

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
    group = model_of(definition(PARAMS, layout)).screens[0].layout[0]

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
        # 画面が 1 つでも、アプリ全体のタブ(OSC パッド D-080・再送 D-094)と並べるため最上位がタブになる。宛先はタブでなく右側のパネル(D-086)
        assert {e.props["label"] for e in user.find(kind=ui.tab).elements} == {"Main", "OSC パッド", "設計図", "再送", "ネットワーク", "T1", "T2"}


async def test_multiple_screens_become_top_level_tabs() -> None:
    defn = definition(PARAMS[:2])
    defn["screens"].append({"id": "second", "label": "Second", "children": [control("b")]})
    state = SurfaceState(AppConfig(unity=UnityTarget("127.0.0.1", 7090, 7091)), link_factory=FakeLink)
    state._on_frame(surface_frame(defn))
    page = SurfacePage(state)

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")

        tabs = sorted(user.find(kind=ui.tab).elements, key=lambda element: element.id)
        # 定義の画面 → OSC パッド → 設計図(HID-386) → 再送 → ネットワーク(D-113)の順(要素は作った順に id が増える)
        assert [e.props["label"] for e in tabs] == ["Main", "Second", "OSC パッド", "設計図", "再送", "ネットワーク"]


async def test_extra_tabs_are_shown_even_without_a_definition() -> None:
    state = SurfaceState(AppConfig(unity=UnityTarget("127.0.0.1", 7090, 7091)), link_factory=FakeLink)
    page = SurfacePage(state)

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")

        await user.should_see("定義待ち")
        tabs = sorted(user.find(kind=ui.tab).elements, key=lambda element: element.id)
        assert [e.props["label"] for e in tabs] == ["OSC パッド", "設計図", "再送", "ネットワーク"]
        # 宛先パネルは定義の有無にかかわらずタブの外に出ている(D-086)
        await user.should_see("ブリッジから宛先の情報を待っています。")
        await user.should_see("パッドがありません")


async def test_resend_tab_lists_one_target_per_row() -> None:
    # 宛先ごとの再送(D-046)はステータスの欄でなく「再送」タブに、1 台 1 行で並べる(D-094)
    state = SurfaceState(AppConfig(unity=UnityTarget("127.0.0.1", 7090, 7091)), link_factory=FakeLink)
    state._on_frame(surface_frame(definition(PARAMS[:1])))
    page = SurfacePage(state)
    resent: list[str | None] = []
    state.request_resend = lambda target=None: resent.append(target)  # type: ignore[method-assign]
    reconciled: list[str] = []
    state.request_reconcile = lambda target: reconciled.append(target)  # type: ignore[method-assign]

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        state._unity_targets = (
            UnityTargetLinkStatus("main", True, "reachable"),
            UnityTargetLinkStatus("backup", False, "lost"),
        )
        page.sync()
        rows = [element for element in page._targets_list.default_slot.children if isinstance(element, ui.row)]
        assert [[e.text for e in row.default_slot.children] for row in rows] == [
            ["再送", "記録に合わせる", "main", "主系 / 接続中"],
            ["再送", "記録に合わせる", "backup", "副系 / 未接続"],
        ]
        UserInteraction(user, {rows[1].default_slot.children[0]}, "再送").click()
        UserInteraction(user, {e for e in user.find(kind=ui.button).elements if e.text == "全台へ再送"}, "全台へ再送").click()
        assert resent == ["backup", None]
        # 宛先ごとの「記録に合わせる」(HID-385)はその宛先だけを合わせる
        UserInteraction(user, {rows[1].default_slot.children[1]}, "記録に合わせる").click()
        assert reconciled == ["backup"]


async def test_render_screens_places_extra_tabs_after_the_screens() -> None:
    built: list[str] = []
    screens = model_of(definition(PARAMS[:1])).screens

    def root() -> None:
        render_screens(screens, lambda _spec: None, lambda _action: None, extra_tabs=[("Extra", lambda: built.append("extra"))])

    async with user_simulation(root=root) as user:
        await user.open("/")
        (tabs,) = user.find(kind=ui.tabs).elements
        assert [tab.props["label"] for tab in tabs] == ["Main", "Extra"]
        # Quasar のタブ名は画面 id と予約名(ラベルと重ならない)
        assert [tab.props["name"] for tab in tabs] == ["main", "__extra:0"]
        assert built == ["extra"]


async def test_render_screens_reports_the_first_tab_and_later_changes() -> None:
    seen: list[str | None] = []
    screens = model_of(definition(PARAMS[:1])).screens

    def root() -> None:
        extra = [("Extra", lambda: seen.append("built"))]
        render_screens(screens, lambda _spec: None, lambda _action: None, extra_tabs=extra, on_tab_change=seen.append)

    async with user_simulation(root=root) as user:
        await user.open("/")
        # 中身を描く前に最初のタブを知らせる(見えないタブの中身が、見える前提で余計なものを描かないように)
        assert seen == ["main", "built"]
        seen.clear()
        (panels,) = user.find(kind=ui.tab_panels).elements
        panels.value = extra_tab_name(0)
        assert seen == ["__extra:0"]
