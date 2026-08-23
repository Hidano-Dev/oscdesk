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
    "projectId": "browser-select-events",
    "optionLists": {"devices": ["Device A", "Device B"]},
    "entries": [
        {
            "address": "/config/inline",
            "label": "Inline",
            "type": "s",
            "widget": "select",
            "options": ["Inline A", "Inline B"],
            "default": "Inline A",
        },
        {
            "address": "/config/shared",
            "label": "Shared",
            "type": "s",
            "widget": "select",
            "optionsRef": "devices",
            "default": "Device A",
        },
        {
            "address": "/config/empty",
            "label": "Empty",
            "type": "s",
            "widget": "select",
            "options": [],
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


def select_for(user: Any, label: str, target: str | None = None) -> UserInteraction[Any]:
    elements = {element for element in user.find(kind=ui.select).elements if element.label == label}
    assert len(elements) == 1
    return UserInteraction(user, elements, target or label)


def deliver_echo(state: SurfaceState, address: str, value: str) -> None:
    state._on_frame(
        OscFrame(
            type="osc",
            address=address,
            args=(WireArg(type="s", value=value),),
            source=Peer(host="127.0.0.1", port=7091),
        )
    )


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


async def test_empty_select_is_disabled_and_annotated() -> None:
    _state, _link, page = build_page()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        empty = select_for(user, "Empty")

        assert next(iter(empty.elements)).enabled is False
        await user.should_see("選択肢なし")
