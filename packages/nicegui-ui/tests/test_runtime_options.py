from __future__ import annotations

from typing import Any

from nicegui import ui
from nicegui.testing import user_simulation

from oscdesk_ui.config import AppConfig, UnityTarget
from oscdesk_ui.page import SurfacePage
from oscdesk_ui.protocol import RuntimeOptionsFrame, decode_frame
from oscdesk_ui.state import SurfaceState
from oscdesk_ui.widgets import select_view

from .surface_fixtures import control, definition, echo_frame, param, surface_frame


class FakeLink:
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self.sent: list[tuple[str, list[Any]]] = []
        self.connected = True
        self.refreshes = 0
        # 送った runtimeOptionsRefresh の request(None は全一覧の「一覧を更新」)
        self.refresh_requests: list[str | None] = []

    def send_osc(self, address: str, args: list[Any]) -> None:
        self.sent.append((address, args))

    def request_surface(self) -> None:
        pass

    def request_runtime_options_refresh(self, request: str | None = None) -> bool:
        if not self.connected:
            return False
        self.refreshes += 1
        self.refresh_requests.append(request)
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


async def test_sync_next_to_the_select_requests_only_its_list() -> None:
    """optionsFrom.request を持つ select の横の Sync は、その一覧の要求だけを送らせる(D-077)。"""
    state, link, page = build()
    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        await user.should_see("Sync")
        user.find("Sync").click()
        assert link.refresh_requests == ["/mb/segments/get"]
        # 一覧が変わらなければ何も届かないので、「更新した」でなく「変わったときだけ入れ替わる」と知らせる
        await user.should_see("一覧の中身が変わったときだけ候補が入れ替わります")

        link.connected = False
        user.find("Sync").click()
        assert link.refresh_requests == ["/mb/segments/get"]
        await user.should_see("ブリッジに接続していないため要求できませんでした")


async def test_no_sync_without_a_request_or_when_the_list_is_not_shown_as_a_select() -> None:
    cases = [
        # request の無い一覧は Unity の自発送信を待つだけなので、取り直す口を出さない
        param("segment", "/member/1/segment", "s", "Segment", optionsFrom={"address": "/mb/segments"}),
        param("name", "/name", "s", "Name", options=["A", "B"]),
    ]
    for parameter in cases:
        plain = SurfaceState(AppConfig(unity=UnityTarget("127.0.0.1", 7090, 7091)), link_factory=FakeLink)
        plain._on_frame(surface_frame(definition([parameter])))
        plain_page = SurfacePage(plain)
        async with user_simulation(root=lambda: (plain_page.build(), plain_page.sync())) as user:
            await user.open("/")
            await user.should_not_see("Sync")

    # 入力欄にした欄は候補が見えないので、押しても画面が変わらない Sync を置かない
    entry = SurfaceState(AppConfig(unity=UnityTarget("127.0.0.1", 7090, 7091)), link_factory=FakeLink)
    entry._on_frame(surface_frame(definition(DEFINITION["parameters"], [control("segment", widget="input")])))
    assert entry.surface is not None
    (spec,) = entry.surface.screens[0].controls
    assert spec.widget == "input" and spec.options_request == "/mb/segments/get" and spec.sync_request is None


def test_sync_encodes_only_the_named_request_and_reports_a_rejection() -> None:
    from oscdesk_ui.protocol import ProtocolError, encode_runtime_options_refresh

    assert encode_runtime_options_refresh() == '{"v":1,"type":"runtimeOptionsRefresh"}'
    assert encode_runtime_options_refresh("/mb/segments/get") == '{"v":1,"type":"runtimeOptionsRefresh","request":"/mb/segments/get"}'
    try:
        encode_runtime_options_refresh("mb/segments/get")
    except ProtocolError:
        pass
    else:
        raise AssertionError("a relative request must be rejected")

    state, _link, _page = build()
    state._on_frame(
        decode_frame(
            '{"v":1,"type":"notice","level":"error","code":"runtime-options-refresh-rejected","detail":"unknown-request: /gone"}'
        )
    )
    assert [(n.level, n.message) for n in state.notices_since(0)] == [
        ("error", "一覧を取り直せません(採用中の定義に無い要求です): unknown-request: /gone")
    ]


def test_choices_are_cleared_on_disconnect_so_a_stale_list_is_not_shown_as_current() -> None:
    from oscdesk_ui.surface_link import LinkStatus

    state, _link, _page = build()
    state._on_frame(runtime_frame(["(none)", "Intro"]))
    revision = state.runtime_options_revision
    state._on_link_status(LinkStatus(False, "切断"))
    assert state.runtime_choices("segment") is None
    assert state.runtime_options_revision == revision + 1
    entry = state.surface.parameters[0]  # type: ignore[union-attr]
    assert state.options_for(entry) == (("(none)",), False)


async def test_no_not_in_list_mark_before_the_list_arrives() -> None:
    state, _link, page = build()
    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        select = next(iter(user.find(kind=ui.select).elements))
        state._on_frame(echo_frame("/member/1/segment", ("s", "Song B")))
        page.sync()
        assert select.props["display-value"] == "Song B"
        state._on_frame(runtime_frame(["(none)", "Intro"]))
        page.sync()
        assert select.props["display-value"] == "Song B(一覧に無い)"
