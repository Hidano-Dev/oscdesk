"""組み合わせの型(HID-380・D-121)の部品をページで組み、操作が全フィールドの値として送られることを確かめる。"""

from __future__ import annotations

from nicegui import ui
from nicegui.testing import user_simulation

from oscdesk_ui.config import AppConfig, UnityTarget
from oscdesk_ui.page import SurfacePage
from oscdesk_ui.protocol import EchoFrame, DesiredValue
from oscdesk_ui.state import SurfaceState

from .surface_fixtures import control, definition, param, surface_frame
from .test_browser_input_events import FakeClock, FakeLink

DEFINITION = definition(
    [
        param(
            "tint", "/fx/tint", "composite", "Tint", hint="color",
            fields=[{"id": c, "label": c.upper(), "type": "f", "range": [0, 1], "default": 1} for c in "rgba"],
        ),
        param(
            "light", "/fx/light", "composite", "Light", hint="acme.light",
            fields=[
                {"id": "level", "label": "Level", "type": "f", "range": [0, 1], "default": 0.5},
                {"id": "on", "label": "On", "type": "bool", "default": True},
            ],
        ),
    ],
    [control("tint"), control("light")],
)


def build_page() -> tuple[SurfaceState, FakeLink, SurfacePage]:
    state = SurfaceState(AppConfig(unity=UnityTarget("127.0.0.1", 7090, 7091)), clock=FakeClock(), link_factory=FakeLink)
    state._on_frame(surface_frame(DEFINITION))
    return state, state.link, SurfacePage(state)  # type: ignore[return-value]


async def test_generic_fields_and_color_picker_send_the_whole_value() -> None:
    state, link, page = build_page()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        # 知らないヒントはフィールドごとの部品(スイッチ)、color は色の選択
        switch = next(element for element in user.find(kind=ui.switch).elements if element.text == "On")
        picker = next(iter(user.find(kind=ui.color_input).elements))
        assert picker.value == "#ffffff"

        switch.value = False
        assert link.sent[-1] == ("light", {"level": 0.5, "on": False})

        picker.value = "#ff0000"
        assert link.sent[-1] == ("tint", {"r": 1.0, "g": 0.0, "b": 0.0, "a": 1.0})

        # エコーで表示が揃う
        state._on_frame(EchoFrame(type="echo", values=(DesiredValue("tint", {"r": 0, "g": 0, "b": 1, "a": 0.5}),), rows=()))
        page.sync()
        assert picker.value == "#0000ff"
