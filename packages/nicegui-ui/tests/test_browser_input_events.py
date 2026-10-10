from __future__ import annotations

from typing import Any

from nicegui import ui
from nicegui.testing import user_simulation
from nicegui.testing.user_interaction import UserInteraction

from oscdesk_ui.config import AppConfig, UnityTarget
from oscdesk_ui.page import SurfacePage
from oscdesk_ui.state import SurfaceState

from .surface_fixtures import control, definition, echo_frame, param, surface_frame


class FakeLink:
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self.sent: list[tuple[str, list[Any]]] = []

    def send_osc(self, address: str, args: list[Any]) -> None:
        self.sent.append((address, args))

    def request_surface(self) -> None:
        pass


DEFINITION = definition(
    [
        param("name", "/config/name", "s", "Name", default="START"),
        param("count", "/config/count", "i", "Count", range=[0, 10], default=1),
    ],
    [control("name"), control("count", widget="input")],
)


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def build_page(clock: FakeClock | None = None) -> tuple[SurfaceState, FakeLink, SurfacePage]:
    state = SurfaceState(
        AppConfig(unity=UnityTarget("127.0.0.1", 7090, 7091)),
        clock=clock or FakeClock(),
        link_factory=FakeLink,
    )
    state._on_frame(surface_frame(DEFINITION))
    page = SurfacePage(state)
    return state, state.link, page  # type: ignore[return-value]


def input_for(user: Any, label: str) -> UserInteraction[Any]:
    elements = {element for element in user.find(kind=ui.input).elements if element.label == label}
    assert len(elements) == 1
    return UserInteraction(user, elements, label)


def deliver_echo(state: SurfaceState, address: str, value: Any) -> None:
    state._on_frame(echo_frame(address, ("s" if isinstance(value, str) else "i", value)))


async def test_input_enter_and_blur_are_single_confirmations() -> None:
    state, link, page = build_page()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        name = input_for(user, "Name")

        name.clear().type("ABC").trigger("keydown.enter")
        assert link.sent == [("/config/name", [{"type": "s", "value": "ABC"}])]
        name.trigger("blur")
        assert len(link.sent) == 1

        name.trigger("focus").type("DEF").trigger("blur")
        assert link.sent[-1] == ("/config/name", [{"type": "s", "value": "ABCDEF"}])
        assert len(link.sent) == 2


async def test_input_invalid_blur_restores_echo_and_editing_ignores_echo() -> None:
    state, link, page = build_page()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        count = input_for(user, "Count")

        # 範囲外(0〜10)の値は送らず、直近のエコーへ戻す
        count.trigger("focus").clear().type("99")
        assert state.values.channel("/config/count").holding is True
        deliver_echo(state, "/config/count", 4)
        assert next(iter(count.elements)).value == "99"

        count.trigger("blur")
        assert next(iter(count.elements)).value == 1
        assert state.values.channel("/config/count").holding is False
        assert link.sent == []

        deliver_echo(state, "/config/count", 4)
        page.sync()
        assert next(iter(count.elements)).value == 4


async def test_focus_holds_before_first_edit_and_unedited_blur_sends_nothing() -> None:
    state, link, page = build_page()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        name = input_for(user, "Name")

        # フォーカスしただけ(未編集)でもホールドが始まり、エコーバックで欄が書き換わらない
        name.trigger("focus")
        assert state.values.channel("/config/name").holding is True
        deliver_echo(state, "/config/name", "UNITY")
        page.sync()
        assert next(iter(name.elements)).value == "START"

        # 未編集のまま離れても同じ値を送り直さず、ホールドだけ解除する
        name.trigger("blur")
        assert link.sent == []
        assert state.values.channel("/config/name").holding is False

        deliver_echo(state, "/config/name", "UNITY")
        page.sync()
        assert next(iter(name.elements)).value == "UNITY"


async def test_sync_extends_the_hold_while_the_input_stays_focused() -> None:
    from oscdesk_ui.value_store import INPUT_HOLD_TIMEOUT_S

    clock = FakeClock()
    state, link, page = build_page(clock)

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        name = input_for(user, "Name")
        channel = state.values.channel("/config/name")

        name.trigger("focus").type("A")
        # キー入力が止まっても、ページの同期タイマーが動いている限り期限切れしない
        for _ in range(3):
            clock.now += INPUT_HOLD_TIMEOUT_S * 0.9
            page.sync()
            assert channel.holding is True

        # Enter で確定するとフォーカスが残っていてもホールドは終わり、延長もされない
        name.trigger("keydown.enter")
        assert channel.holding is False
        page.sync()
        assert channel.holding is False
        assert link.sent == [("/config/name", [{"type": "s", "value": "STARTA"}])]

        # ページの同期が止まった(タブが消えた)場合だけ期限切れの保険が働く
        name.type("B")
        assert channel.holding is True
        clock.now += INPUT_HOLD_TIMEOUT_S
        state.tick()
        assert channel.holding is False


async def test_editing_after_enter_confirms_again_on_blur() -> None:
    state, link, page = build_page()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        name = input_for(user, "Name")

        name.clear().type("ABC").trigger("keydown.enter")
        assert len(link.sent) == 1

        # Enter のあと続けて編集した分は、次の blur で新しい確定として送る
        name.type("D").trigger("blur")
        assert link.sent[-1] == ("/config/name", [{"type": "s", "value": "ABCD"}])
        assert len(link.sent) == 2
        assert state.values.channel("/config/name").holding is False


async def test_integer_input_sends_typed_value_on_enter() -> None:
    _state, link, page = build_page()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        count = input_for(user, "Count")

        count.clear().type("7").trigger("keydown.enter")
        assert link.sent == [("/config/count", [{"type": "i", "value": 7}])]
