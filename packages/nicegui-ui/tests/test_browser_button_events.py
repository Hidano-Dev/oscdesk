from __future__ import annotations

from typing import Any

from nicegui import ui
from nicegui.testing import user_simulation
from nicegui.testing.user_interaction import UserInteraction

from oscdesk_ui.config import AppConfig, UnityTarget
from oscdesk_ui.page import SurfacePage
from oscdesk_ui.state import SurfaceState

from .surface_fixtures import control, definition, desired_frame, echo_frame, param, surface_frame


class FakeLink:
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self.sent: list[tuple[str, list[Any]]] = []

    def send_osc(self, address: str, args: list[Any]) -> None:
        self.sent.append((address, args))

    def request_surface(self) -> None:
        pass


DEFINITION = definition(
    [
        param("name", "/member/01/name", "s", "Name", default="START"),
        param("enabled", "/member/01/enabled", "bool", "Enabled", default=False),
        param("go", "/cue/go", "i", "GO", kind="trigger", value=1),
        param("armed", "/cue/armed", "bool", "Armed", kind="trigger", value=True),
        param("part", "/cue/part", "i", "Part", kind="trigger", value=1, standalone=False),
    ]
)


def build_page(defn: dict[str, Any] = DEFINITION) -> tuple[SurfaceState, FakeLink, SurfacePage]:
    state = SurfaceState(
        AppConfig(unity=UnityTarget("127.0.0.1", 7090, 7091)),
        link_factory=FakeLink,
    )
    state._on_frame(surface_frame(defn))
    page = SurfacePage(state)
    return state, state.link, page  # type: ignore[return-value]


def button_for(user: Any, label: str) -> UserInteraction[Any]:
    elements = {element for element in user.find(kind=ui.button).elements if element.text == label}
    assert len(elements) == 1
    return UserInteraction(user, elements, label)


def input_for(user: Any, label: str) -> UserInteraction[Any]:
    elements = {element for element in user.find(kind=ui.input).elements if element.label == label}
    assert len(elements) == 1
    return UserInteraction(user, elements, label)


async def test_trigger_button_sends_its_value_once_on_press_and_nothing_on_release() -> None:
    _state, link, page = build_page()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        go = button_for(user, "GO")

        go.trigger("pointerdown")
        go.trigger("pointerup")
        go.trigger("pointerleave")

        assert link.sent == [("/cue/go", [{"type": "i", "value": 1}])]


async def test_bool_trigger_is_sent_as_int() -> None:
    _state, link, page = build_page()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")

        button_for(user, "Armed").trigger("pointerdown")

        assert link.sent == [("/cue/armed", [{"type": "i", "value": 1}])]


async def test_standalone_false_trigger_is_disabled_and_sends_nothing() -> None:
    _state, link, page = build_page()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        part = button_for(user, "Part")

        assert next(iter(part.elements)).enabled is False
        part.trigger("pointerdown")
        assert link.sent == []


async def test_full_desired_resets_an_unfocused_input_and_a_new_definition_redraws() -> None:
    state, _link, page = build_page()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        name = input_for(user, "Name")
        state._on_frame(echo_frame("/member/01/name", ("s", "EDITED")))
        page.sync()
        assert next(iter(name.elements)).value == "EDITED"

        state._on_frame(desired_frame({"/member/01/name": [("s", "START")]}))
        page.sync()
        assert next(iter(name.elements)).value == "START"

        # 定義が変わると画面を作り直す
        state._on_frame(
            surface_frame(
                definition([param("name", "/member/01/name", "s", "Renamed", default="START")]),
                revision=2,
            )
        )
        page.sync()
        assert input_for(user, "Renamed") is not None


async def test_desired_clears_an_input_without_a_held_value() -> None:
    """保持値に無い state は欄を空にする(古い値が見えたまま、再送もされない状態を作らない)。"""
    state, _link, page = build_page()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        name = input_for(user, "Name")

        state._on_frame(desired_frame({}))
        page.sync()

        assert next(iter(name.elements)).value == ""


async def test_desired_defers_the_reset_of_a_focused_input_until_unedited_blur() -> None:
    state, link, page = build_page()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        name = input_for(user, "Name")
        state._on_frame(echo_frame("/member/01/name", ("s", "EDITED")))
        page.sync()

        name.trigger("focus")
        state._on_frame(desired_frame({"/member/01/name": [("s", "START")]}))
        page.sync()

        assert next(iter(name.elements)).value == "EDITED"
        assert state.values.channel("/member/01/name").holding is True

        name.trigger("blur")
        page.sync()

        assert next(iter(name.elements)).value == "START"
        assert link.sent == []


async def test_edited_input_is_sent_on_confirming_blur() -> None:
    state, link, page = build_page()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        name = input_for(user, "Name")
        name.trigger("focus").clear().type("CONFIRMED").trigger("blur")

        assert link.sent == [
            ("/member/01/name", [{"type": "s", "value": "CONFIRMED"}]),
        ]
        assert state.values.channel("/member/01/name").holding is False


async def test_page_shows_a_placeholder_until_a_definition_arrives() -> None:
    state = SurfaceState(AppConfig(unity=UnityTarget("127.0.0.1", 7090, 7091)), link_factory=FakeLink)
    page = SurfacePage(state)

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        await user.should_see("定義待ち")

        state._on_frame(surface_frame(DEFINITION, name="stage"))
        page.sync()

        await user.should_see("GO")
        await user.should_see("stage")
