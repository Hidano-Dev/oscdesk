from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from nicegui import ui
from nicegui.testing import user_simulation
from nicegui.testing.user_interaction import UserInteraction

from oscdesk_ui.config import AppConfig, UnityTarget
from oscdesk_ui.notify_history import NotificationHistory, notification_row
from oscdesk_ui.page import SurfacePage
from oscdesk_ui.protocol import decode_frame
from oscdesk_ui.state import SurfaceState

from .surface_fixtures import definition, param, surface_frame

SRC = Path(__file__).parents[1] / "src" / "oscdesk_ui"


def test_history_keeps_newest_first_within_capacity() -> None:
    history = NotificationHistory(capacity=2)
    history.add("a", "info")
    history.add("b", "warning")
    history.add("c", "negative")
    assert [(r.message, r.type) for r in history.records()] == [("c", "negative"), ("b", "warning")]
    row = notification_row(history.records()[0])
    assert row["type"] == "エラー" and row["message"] == "c"


def test_clear_changes_the_revision() -> None:
    history = NotificationHistory()
    history.add("a")
    revision = history.revision
    history.clear()
    assert history.records() == () and history.revision != revision


def test_every_toast_goes_through_the_history_helper() -> None:
    """ui.notify を直接呼ぶとトーストが履歴に残らない(D-067)。notify_history.notify を使う。"""
    offenders = [
        path.name
        for path in SRC.glob("*.py")
        if path.name != "notify_history.py" and re.search(r"\bui\.notify\(", path.read_text(encoding="utf-8"))
    ]
    assert offenders == []


class RecordingLink:
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self.saved: list[Any] = []

    def request_surface(self) -> None:
        pass

    def send_osc(self, address: str, args: list[Any]) -> None:
        pass

    def save_surface(self, name: str, defn: dict[str, Any], *, activate: bool = True) -> bool:
        self.saved.append(name)
        return True


def build() -> tuple[SurfaceState, SurfacePage]:
    state = SurfaceState(AppConfig(unity=UnityTarget("127.0.0.1", 7090, 7091)), link_factory=RecordingLink)
    state._on_frame(surface_frame(definition([param("a", "/a", "bool", "A")]), name="stage", revision=1))
    return state, SurfacePage(state)


def find(user: Any, kind: Any, label: str) -> UserInteraction[Any]:
    elements = {e for e in user.find(kind=kind).elements if e.text == label}
    assert len(elements) == 1
    return UserInteraction(user, elements, label)


async def test_toasts_are_kept_per_page_and_shown_with_the_sent_log_in_the_drawer() -> None:
    state, page = build()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        drawer = page._log_drawer
        assert not drawer.is_open

        # 保存名の誤りはトーストで知らせる。それが履歴に残る
        find(user, ui.switch, "編集モード").click()
        assert page._editor is not None
        page._editor._name_input.value = "../evil"
        find(user, ui.button, "保存").click()
        assert [record.type for record in drawer._history.records()] == ["negative"]

        state._on_frame(decode_frame(json.dumps({"v": 1, "type": "sentLog", "full": True, "records": [{
            "seq": 1, "at": "2026-10-14T10:00:00.000Z", "origin": "resend", "targets": ["unity"],
            "address": "/a", "args": [{"type": "i", "value": 1}], "count": 1, "batch": None, "clipped": False,
        }]})))

        find(user, ui.button, "ログ").click()
        assert drawer.is_open
        assert [row["address"] for row in drawer._sent_table.rows] == ["/a"]
        assert drawer._sent_table.rows[0]["origin"] == "再送"
        assert [row["type"] for row in drawer._notify_table.rows] == ["エラー"]
        assert "保存名" in drawer._notify_table.rows[0]["message"]

        assert drawer._sent_panel.visible and not drawer._notify_panel.visible
        drawer._view.value = "notify"
        assert drawer._notify_panel.visible and not drawer._sent_panel.visible
