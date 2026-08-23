from __future__ import annotations

from typing import Any

from nicegui import ui
from nicegui.testing import user_simulation
from nicegui.testing.user_interaction import UserInteraction

from oscdesk_ui.config import AppConfig, UnityTarget
from oscdesk_ui.page import SurfacePage
from oscdesk_ui.protocol import ManifestFrame, OscFrame, Peer, WireArg
from oscdesk_ui.state import SurfaceState


class FakeLink:
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self.sent: list[tuple[str, list[Any]]] = []

    def send_osc(self, address: str, args: list[Any]) -> None:
        self.sent.append((address, args))

    def request_manifest(self) -> None:
        pass


MANIFEST = {
    "version": 1,
    "projectId": "browser-input-events",
    "entries": [
        {
            "address": "/config/name",
            "label": "Name",
            "type": "s",
            "widget": "input",
            "pattern": "^[A-Z]+$",
            "default": "START",
        },
        {
            "address": "/config/count",
            "label": "Count",
            "type": "i",
            "widget": "input",
            "range": [0, 10],
            "default": 1,
        },
    ],
}


def build_page() -> tuple[SurfaceState, FakeLink, SurfacePage]:
    state = SurfaceState(
        AppConfig(unity=UnityTarget("127.0.0.1", 7090, 7091)),
        link_factory=FakeLink,
    )
    state._on_frame(ManifestFrame(type="manifest", manifest=MANIFEST))
    page = SurfacePage(state)
    return state, state.link, page  # type: ignore[return-value]


def input_for(user: Any, label: str) -> UserInteraction[Any]:
    elements = {element for element in user.find(kind=ui.input).elements if element.label == label}
    assert len(elements) == 1
    return UserInteraction(user, elements, label)


def deliver_echo(state: SurfaceState, address: str, value: Any) -> None:
    state._on_frame(
        OscFrame(
            type="osc",
            address=address,
            args=(WireArg(type="s" if isinstance(value, str) else "i", value=value),),
            source=Peer(host="127.0.0.1", port=7091),
        )
    )


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
        name = input_for(user, "Name")

        name.trigger("focus").type("bad")
        assert state.values.channel("/config/name").holding is True
        deliver_echo(state, "/config/name", "UNITY")
        assert next(iter(name.elements)).value == "STARTbad"

        name.trigger("blur")
        assert next(iter(name.elements)).value == "START"
        assert state.values.channel("/config/name").holding is False
        assert link.sent == []

        deliver_echo(state, "/config/name", "UNITY")
        page.sync()
        assert next(iter(name.elements)).value == "UNITY"


async def test_integer_input_sends_typed_value_on_enter() -> None:
    _state, link, page = build_page()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        count = input_for(user, "Count")

        count.clear().type("7").trigger("keydown.enter")
        assert link.sent == [("/config/count", [{"type": "i", "value": 7}])]
