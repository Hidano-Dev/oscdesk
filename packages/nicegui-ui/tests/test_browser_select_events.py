from __future__ import annotations

from typing import Any

from nicegui import ui
from nicegui.testing import user_simulation
from nicegui.testing.user_interaction import UserInteraction

from oscdesk_ui.config import AppConfig, UnityTarget
from oscdesk_ui.page import SurfacePage
from oscdesk_ui.state import SurfaceState

from .surface_fixtures import definition, echo_frame, param, surface_frame


class FakeLink:
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self.sent: list[tuple[str, list[Any]]] = []

    def send_osc(self, address: str, args: list[Any]) -> None:
        self.sent.append((address, args))

    def request_surface(self) -> None:
        pass


DEFINITION = definition(
    [
        param("inline", "/config/inline", "s", "Inline", options=["Inline A", "Inline B"], default="Inline A"),
        param("shared", "/config/shared", "s", "Shared", options=["Device A", "Device B"], default="Device A"),
    ]
)


def build_page() -> tuple[SurfaceState, FakeLink, SurfacePage]:
    state = SurfaceState(
        AppConfig(unity=UnityTarget("127.0.0.1", 7090, 7091)),
        link_factory=FakeLink,
    )
    state._on_frame(surface_frame(DEFINITION))
    page = SurfacePage(state)
    return state, state.link, page  # type: ignore[return-value]


def select_for(user: Any, label: str, target: str | None = None) -> UserInteraction[Any]:
    elements = {element for element in user.find(kind=ui.select).elements if element.label == label}
    assert len(elements) == 1
    return UserInteraction(user, elements, target or label)


def deliver_echo(state: SurfaceState, address: str, value: str) -> None:
    state._on_frame(echo_frame(address, ("s", value)))


async def test_select_inline_and_shared_options_send_once_on_selection() -> None:
    _state, link, page = build_page()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")

        select_for(user, "Inline").click()
        select_for(user, "Inline", "Inline B").click()
        select_for(user, "Shared").click()
        select_for(user, "Shared", "Device B").click()

        assert link.sent == [
            ("/config/inline", [{"type": "s", "value": "Inline B"}]),
            ("/config/shared", [{"type": "s", "value": "Device B"}]),
        ]


async def test_select_out_of_list_echo_is_displayed_without_becoming_selection() -> None:
    state, link, page = build_page()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        inline = select_for(user, "Inline")
        element = next(iter(inline.elements))
        assert element.value == "Inline A"

        deliver_echo(state, "/config/inline", "Unity-only")
        page.sync()

        assert element.value is None
        assert element.props["display-value"] == "Unity-only"
        assert link.sent == []
