from __future__ import annotations

from nicegui.testing import user_simulation

from oscdesk_ui.config import AppConfig
from oscdesk_ui.page import SurfacePage
from oscdesk_ui.state import SurfaceState


async def test_surface_page_starts_through_browser_equivalent() -> None:
    def root() -> None:
        SurfacePage(SurfaceState(AppConfig())).build()

    async with user_simulation(root=root) as user:
        await user.open("/")
        await user.should_see("OSCDesk")
