from __future__ import annotations

from typing import Any

from oscdesk_ui.blueprint_panel import pc_rows, verified_label
from oscdesk_ui.config import AppConfig, UnityTarget
from oscdesk_ui.protocol import BlueprintStatusFrame, CatalogFrame
from oscdesk_ui.state import SurfaceState

from .surface_fixtures import control, definition, param, surface_frame


class Link:
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self.connected = True

    def request_surface(self) -> None:
        pass

    def update_heartbeat(self, interval_s: float) -> None:
        pass


PC = {"host": "10.0.0.5", "name": "PC1", "receivedAt": "2026-11-01T00:00:00.000Z", "verified": False, "items": [{}, {}]}


def test_rows_and_verification_labels() -> None:
    assert pc_rows((PC,)) == [{"host": "10.0.0.5", "name": "PC1", "items": 2, "receivedAt": PC["receivedAt"], "verified": verified_label(False)[0]}]
    assert verified_label(True) == ("一致", "positive")
    assert verified_label(None)[0] == "未照合"
    assert verified_label(False)[1] == "negative"


def test_state_keeps_the_catalog_and_marks_parameters_absent_from_the_blueprint() -> None:
    state = SurfaceState(AppConfig(unity=UnityTarget("127.0.0.1", 7090, 7091)), link_factory=Link)
    state._on_frame(surface_frame(definition([param("level", "/fx/level", "f", "Level", default=0.0)], [control("level")]), "blueprint-PC1", 1))
    before = state.catalog_revision

    state._on_frame(CatalogFrame("catalog", 1, (PC,)))
    state._on_frame(BlueprintStatusFrame("blueprintStatus", 1, {"host": "10.0.0.5", "name": "PC1"}, ("level",)))

    assert state.catalog_revision == before + 2
    assert state.catalog_pcs == (PC,)
    assert state.blueprint_pc == {"host": "10.0.0.5", "name": "PC1"}
    entry = state.entry_for("level")
    assert entry is not None and state.is_absent(entry)
