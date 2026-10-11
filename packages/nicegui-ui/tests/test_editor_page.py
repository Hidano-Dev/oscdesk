from __future__ import annotations

from typing import Any

from nicegui import ui
from nicegui.testing import user_simulation
from nicegui.testing.user_interaction import UserInteraction

from oscdesk_ui.config import AppConfig, UnityTarget
from oscdesk_ui.page import SurfacePage
from oscdesk_ui.protocol import SurfaceListFrame
from oscdesk_ui.state import SurfaceState

from .surface_fixtures import definition, param, surface_frame

PARAMS = [param("a", "/a", "bool", "A"), param("b", "/b", "bool", "B")]


class RecordingLink:
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self.saved: list[tuple[str, dict[str, Any], bool]] = []
        self.loaded: list[str] = []

    def request_surface(self) -> None:
        pass

    def send_osc(self, address: str, args: list[Any]) -> None:
        pass

    def load_surface(self, name: str) -> None:
        self.loaded.append(name)

    def save_surface(self, name: str, defn: dict[str, Any], *, activate: bool = True) -> bool:
        self.saved.append((name, defn, activate))
        return True


def build() -> tuple[SurfaceState, RecordingLink, SurfacePage]:
    state = SurfaceState(AppConfig(unity=UnityTarget("127.0.0.1", 7090, 7091)), link_factory=RecordingLink)
    state._on_frame(surface_frame(definition(PARAMS), name="stage", revision=1))
    return state, state.link, SurfacePage(state)  # type: ignore[return-value]


def button(user: Any, label: str) -> UserInteraction[Any]:
    elements = {e for e in user.find(kind=ui.button).elements if e.text == label}
    assert len(elements) == 1
    return UserInteraction(user, elements, label)


def switch(user: Any, label: str) -> UserInteraction[Any]:
    elements = {e for e in user.find(kind=ui.switch).elements if e.text == label}
    assert len(elements) == 1
    return UserInteraction(user, elements, label)


async def test_production_mode_hides_editing_controls() -> None:
    state, _link, page = build()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")

        assert not [e for e in user.find(kind=ui.button).elements if e.text == "保存"]
        assert page._editor is None


async def test_edit_mode_moves_a_control_and_saves_the_draft_to_the_bridge() -> None:
    state, link, page = build()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        switch(user, "編集モード").click()
        assert page._editor is not None

        session = page._editor.session
        assert session.apply(__import__("oscdesk_ui.surface_editor", fromlist=["x"]).move_node, (0, (), 0), 1) is None
        page._editor.refresh()
        page._editor._name_input.value = "stage-b"
        button(user, "保存").click()

        assert len(link.saved) == 1
        name, saved, activate = link.saved[0]
        assert name == "stage-b" and activate is True
        assert [n["param"] for n in saved["screens"][0]["children"]] == ["b", "a"]


async def test_invalid_save_name_is_not_sent() -> None:
    state, link, page = build()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        switch(user, "編集モード").click()
        page._editor._name_input.value = "../evil"
        button(user, "保存").click()

        assert link.saved == []


async def test_saved_draft_adopted_by_bridge_is_not_a_conflict() -> None:
    state, link, page = build()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        switch(user, "編集モード").click()
        from oscdesk_ui import surface_editor as ed

        page._editor.session.apply(ed.move_node, (0, (), 0), 1)
        assert page._editor.session.dirty

        # ブリッジが保存内容を採用して再配信した
        state._on_frame(surface_frame(page._editor.session.draft, name="stage", revision=2))
        page.sync()

        assert not page._editor.session.dirty
        assert not page._editor.session.is_conflicted(state.surface_revision)


async def test_other_terminal_save_while_dirty_is_reported_as_conflict_and_keeps_the_draft() -> None:
    state, link, page = build()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        switch(user, "編集モード").click()
        from oscdesk_ui import surface_editor as ed

        page._editor.session.apply(ed.move_node, (0, (), 0), 1)
        draft = page._editor.session.draft

        state._on_frame(surface_frame(definition(PARAMS[:1]), name="stage", revision=2))
        page.sync()

        assert page._editor.session.draft == draft
        assert page._editor.session.is_conflicted(state.surface_revision)
        assert "上書き" in page._editor._conflict_label.text


async def test_other_terminal_save_while_clean_is_followed() -> None:
    state, link, page = build()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        switch(user, "編集モード").click()

        newer = definition(PARAMS[:1])
        state._on_frame(surface_frame(newer, name="stage", revision=2))
        page.sync()

        assert page._editor.session.draft == newer


async def test_clean_adoption_of_identical_content_under_another_name_follows_name_and_revision() -> None:
    state, link, page = build()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        switch(user, "編集モード").click()

        # 内容が同一でも、別名の定義が採用されたら保存名と出発点 revision を合わせる
        state._on_frame(surface_frame(definition(PARAMS), name="other", revision=5))
        state._on_frame(SurfaceListFrame(type="surfaceList", names=("stage", "other"), active="other"))
        page.sync()

        session = page._editor.session
        assert session.base_name == "other"
        assert session.base_revision == state.surface_revision
        assert page._editor._name_input.value == "other"
