from __future__ import annotations

from typing import Any

from nicegui import ui
from nicegui.testing import user_simulation

from oscdesk_ui.config import AppConfig, UnityTarget
from oscdesk_ui.page import SurfacePage
from oscdesk_ui.protocol import RuntimeOptionsFrame, decode_frame
from oscdesk_ui.state import SurfaceState
from oscdesk_ui.widgets import select_view

from .surface_fixtures import definition, echo_frame, param, surface_frame


class FakeLink:
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self.sent: list[tuple[str, list[Any]]] = []
        self.connected = True
        self.refreshes = 0

    def send_osc(self, address: str, args: list[Any]) -> None:
        self.sent.append((address, args))

    def request_surface(self) -> None:
        pass

    def request_runtime_options_refresh(self) -> bool:
        if not self.connected:
            return False
        self.refreshes += 1
        return True


DEFINITION = definition(
    [
        param(
            "segment", "/member/1/segment", "s", "Segment",
            options=["(none)"], default="(none)", optionsFrom={"address": "/mb/segments", "request": "/mb/segments/get"},
        )
    ]
)


def runtime_frame(options: list[str]) -> RuntimeOptionsFrame:
    frame = decode_frame(
        '{"v":1,"type":"runtimeOptions","lists":[],"choices":[{"param":"segment","options":%s}]}'
        % str(options).replace("'", '"')
    )
    assert isinstance(frame, RuntimeOptionsFrame)
    return frame


def build() -> tuple[SurfaceState, FakeLink, SurfacePage]:
    state = SurfaceState(AppConfig(unity=UnityTarget("127.0.0.1", 7090, 7091)), link_factory=FakeLink)
    state._on_frame(surface_frame(DEFINITION))
    return state, state.link, SurfacePage(state)  # type: ignore[return-value]


def test_select_view_marks_a_value_missing_from_the_unity_list() -> None:
    assert select_view("Intro", ["(none)", "Intro"], from_runtime=True) == select_view("Intro", ["Intro"], from_runtime=False)
    view = select_view("Gone", ["(none)", "Intro"], from_runtime=True)
    assert (view.selected, view.display) == (None, "Gone(一覧に無い)")
    # 静的な options の欄は従来どおり値だけを見せる
    assert select_view("Gone", ["A"], from_runtime=False).display == "Gone"
    assert select_view(None, ["A"], from_runtime=True) == select_view(None, [], from_runtime=False)


def test_state_replaces_choices_wholesale_and_bumps_revision_only_on_change() -> None:
    state, _link, _page = build()
    assert state.runtime_choices("segment") is None
    state._on_frame(runtime_frame(["(none)", "Intro"]))
    assert state.runtime_choices("segment") == ("(none)", "Intro")
    revision = state.runtime_options_revision
    state._on_frame(runtime_frame(["(none)", "Intro"]))
    assert state.runtime_options_revision == revision
    state._on_frame(runtime_frame(["(none)"]))
    assert state.runtime_choices("segment") == ("(none)",)
    assert state.runtime_options_revision == revision + 1


def test_refresh_request_reports_whether_it_was_sent() -> None:
    state, link, _page = build()
    assert state.request_runtime_options_refresh() is True
    link.connected = False
    assert state.request_runtime_options_refresh() is False
    assert link.refreshes == 1


async def test_select_shows_static_options_until_the_list_arrives_then_the_union() -> None:
    state, link, page = build()
    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        select = next(iter(user.find(kind=ui.select).elements))
        assert list(select.options) == ["(none)"]

        state._on_frame(runtime_frame(["(none)", "Intro", "Song A"]))
        page.sync()
        assert list(select.options) == ["(none)", "Intro", "Song A"]
        # 候補の差し替えは値を送らない
        assert link.sent == []


async def test_current_value_missing_from_the_list_stays_visible_and_is_not_dropped() -> None:
    state, link, page = build()
    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        select = next(iter(user.find(kind=ui.select).elements))
        state._on_frame(runtime_frame(["(none)", "Intro"]))
        page.sync()
        state._on_frame(echo_frame("/member/1/segment", ("s", "Intro")))
        page.sync()
        assert select.value == "Intro"

        # 一覧から Intro が消えても保持値は残り、「一覧に無い」と分かる形で表示する
        state._on_frame(runtime_frame(["(none)", "Song A"]))
        page.sync()
        assert select.value is None
        assert select.props["display-value"] == "Intro(一覧に無い)"
        assert state.values.values_of("/member/1/segment") == ("Intro",)
        assert link.sent == []

        # 戻ってきたら通常の選択表示に戻る
        state._on_frame(runtime_frame(["(none)", "Intro"]))
        page.sync()
        assert select.value == "Intro"
        assert "display-value" not in select.props


async def test_refresh_button_exists_only_with_options_from_and_requests_the_lists() -> None:
    state, link, page = build()
    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        await user.should_see("一覧を更新")
        user.find("一覧を更新").click()
        assert link.refreshes == 1

    plain = SurfaceState(AppConfig(unity=UnityTarget("127.0.0.1", 7090, 7091)), link_factory=FakeLink)
    plain._on_frame(surface_frame(definition([param("name", "/name", "s", "Name", options=["A", "B"])])))
    plain_page = SurfacePage(plain)
    async with user_simulation(root=lambda: (plain_page.build(), plain_page.sync())) as user:
        await user.open("/")
        await user.should_not_see("一覧を更新")
