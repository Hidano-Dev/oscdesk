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
        self.batches: list[list[Any]] = []

    def send_osc(self, address: str, args: list[Any]) -> None:
        self.sent.append((address, args))

    def send_osc_batch(self, messages: list[Any]) -> bool:
        self.batches.append(messages)
        return True

    def request_manifest(self) -> None:
        pass


MANIFEST = {
    "version": 1,
    "projectId": "browser-button-events",
    "entries": [
        {
            "address": "/member/01/name",
            "label": "Name",
            "type": "s",
            "widget": "input",
            "default": "START",
            "staged": True,
        },
        {
            "address": "/member/01/enabled",
            "label": "Enabled",
            "type": "bool",
            "widget": "toggle",
            "default": False,
            "staged": True,
        },
        {
            "address": "/member/all/update",
            "label": "Apply",
            "type": "i",
            "widget": "button",
            "staged": True,
            "appliesTo": ["/member/*/*"],
        },
        {
            "address": "/member/all/ping",
            "label": "Ping",
            "type": "i",
            "widget": "button",
        },
    ],
}


def build_page() -> tuple[SurfaceState, FakeLink, SurfacePage]:
    state = SurfaceState(
        AppConfig(unity=UnityTarget("127.0.0.1", 7090, 7091)),
        link_factory=FakeLink,
    )
    state._on_frame(
        ManifestFrame(
            type="manifest",
            manifest=MANIFEST,
            adoption={"seq": 1, "at": "2026-01-01T00:00:00Z"},
        )
    )
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


def deliver_echo(state: SurfaceState, address: str, value: str) -> None:
    state._on_frame(
        OscFrame(
            type="osc",
            address=address,
            args=(WireArg(type="s", value=value),),
            source=Peer(host="127.0.0.1", port=7091),
        )
    )


async def test_apply_button_sends_one_ordered_batch_and_release_sends_off() -> None:
    _state, link, page = build_page()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")

        button_for(user, "Apply").trigger("pointerdown")

        assert len(link.batches) == 1
        assert [message.address for message in link.batches[0]] == [
            "/member/01/name",
            "/member/01/enabled",
            "/member/all/update",
        ]
        assert [
            (message.args[0].type, message.args[0].value) for message in link.batches[0]
        ] == [("s", "START"), ("i", 0), ("i", 1)]
        assert link.sent == []

        button_for(user, "Apply").trigger("pointerup")

        assert link.sent == [
            ("/member/all/update", [{"type": "i", "value": 0}]),
        ]


async def test_button_without_apply_scope_sends_on_and_off_once_each() -> None:
    _state, link, page = build_page()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        ping = button_for(user, "Ping")

        ping.trigger("pointerdown")
        ping.trigger("pointerup")

        assert link.batches == []
        assert link.sent == [
            ("/member/all/ping", [{"type": "i", "value": 1}]),
            ("/member/all/ping", [{"type": "i", "value": 0}]),
        ]


async def test_new_adoption_resets_unfocused_input_to_default() -> None:
    state, _link, page = build_page()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        name = input_for(user, "Name")
        deliver_echo(state, "/member/01/name", "EDITED")
        page.sync()
        assert next(iter(name.elements)).value == "EDITED"

        state._on_frame(
            ManifestFrame(
                type="manifest",
                manifest=MANIFEST,
                adoption={"seq": 2, "at": "2026-01-01T00:00:01Z"},
            )
        )
        page.sync()

        assert next(iter(name.elements)).value == "START"


async def test_adoption_defers_held_input_reset_until_unedited_blur() -> None:
    state, link, page = build_page()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        name = input_for(user, "Name")
        deliver_echo(state, "/member/01/name", "EDITED")
        page.sync()

        name.trigger("focus")
        state._on_frame(
            ManifestFrame(
                type="manifest",
                manifest=MANIFEST,
                adoption={"seq": 2, "at": "2026-01-01T00:00:01Z"},
            )
        )
        page.sync()

        assert next(iter(name.elements)).value == "EDITED"
        assert state.values.channel("/member/01/name").holding is True

        name.trigger("blur")
        page.sync()

        assert next(iter(name.elements)).value == "START"
        assert link.sent == []


async def test_edited_input_after_adoption_is_sent_on_confirming_blur() -> None:
    state, link, page = build_page()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        name = input_for(user, "Name")
        name.trigger("focus").clear().type("CONFIRMED").trigger("blur")

        assert link.sent == [
            ("/member/01/name", [{"type": "s", "value": "CONFIRMED"}]),
        ]
        assert state.values.channel("/member/01/name").holding is False
