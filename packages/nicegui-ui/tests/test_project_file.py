from __future__ import annotations

import json
from datetime import datetime
from typing import Any

import pytest
from nicegui import ui
from nicegui.testing import user_simulation

from oscdesk_ui.config import AppConfig, UnityTarget
from oscdesk_ui.page import SurfacePage
from oscdesk_ui.project_file import (
    PROJECT_FILE_MAX_BYTES,
    PROJECT_UPLOAD_MAX_BYTES,
    ProjectFileError,
    parse_project_upload,
    project_download_bytes,
    project_download_name,
    project_shape_issues,
    summarize_project,
)
from oscdesk_ui.project_panel import unsent_message
from oscdesk_ui.protocol import DesiredStatusFrame, FrameDecodeError, ProjectFrame, decode_frame
from oscdesk_ui.state import SurfaceState

from .surface_fixtures import definition, param, surface_frame

DEFINITION = {"format": "oscdesk-surface", "version": 2, "name": "Stage", "parameters": [], "screens": [], "bindings": {"osc": {"parameters": []}}}
PAD = {
    "format": "oscdesk-pad", "version": 1, "rows": 1, "columns": 2,
    "buttons": [{"id": "b1", "row": 0, "column": 0, "label": "発火", "address": "/fx/fire", "args": []}],
}


def project(**overrides: Any) -> dict[str, Any]:
    """版 2 のプロジェクト(D-117)。pad= は osc.pad へ入れる(OSC パッドは osc の欄)。"""
    base: dict[str, Any] = {
        "format": "oscdesk-project",
        "version": 2,
        "exportedAt": "2026-10-28T10:00:00.000Z",
        "surface": {
            "name": "stage",
            "definition": DEFINITION,
            "values": {"values": [{"param": "a", "value": 0.5}], "rows": []},
        },
        "osc": {"pad": {"name": "take-01", "pad": PAD}},
    }
    if "pad" in overrides:
        base["osc"] = {"pad": overrides.pop("pad")}
    base.update(overrides)
    return base


def legacy_project() -> dict[str, Any]:
    """版 1 のプロジェクト(保持値は OSC のアドレス、パッドは直下)。"""
    return {
        "format": "oscdesk-project",
        "version": 1,
        "exportedAt": "2026-10-28T10:00:00.000Z",
        "surface": {
            "name": "stage",
            "definition": {"format": "oscdesk-surface", "version": 1, "name": "Stage", "parameters": [], "screens": []},
            "values": {"values": [{"id": "a", "address": "/a", "type": "f", "args": [{"type": "f", "value": 0.5}]}], "records": [],
                       "spawns": [{"param": "spawn", "address": "/effect/spawner/spawn", "name": "spark1", "host": "192.168.1.20"}]},
        },
        "pad": {"name": "take-01", "pad": PAD},
    }


def test_version_1_projects_are_still_accepted_for_upload() -> None:
    # 版 1 のファイルも取り込める(定義と保持値を版 2 へ移すのはブリッジ。D-117)
    legacy = legacy_project()
    assert project_shape_issues(legacy) == []
    assert parse_project_upload(json.dumps(legacy).encode()) == legacy
    summary = summarize_project(legacy)
    assert (summary.value_count, summary.pad_name, summary.spawn_count) == (1, "take-01", 1)
    # 版 2 の形の欄を版 1 に混ぜたものは断る
    assert project_shape_issues({**legacy, "osc": {"pad": None}})


class ProjectLink:
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self.exports: list[str] = []
        self.imports: list[dict[str, Any]] = []
        self.resends: list[str | None] = []
        self.connected = True

    def request_surface(self) -> None:
        pass

    def export_project(self, request_id: str) -> bool:
        self.exports.append(request_id)
        return self.connected

    def import_project(self, value: dict[str, Any]) -> bool:
        self.imports.append(value)
        return self.connected

    def request_resend(self, target: str | None = None) -> None:
        self.resends.append(target)


def make_state() -> SurfaceState:
    return SurfaceState(AppConfig(unity=UnityTarget("127.0.0.1", 7090, 7091)), link_factory=ProjectLink)


# --- 形の検査とアップロード ---------------------------------------------------


def test_shape_accepts_either_part_and_rejects_an_empty_project() -> None:
    assert project_shape_issues(project()) == []
    assert project_shape_issues(project(pad=None)) == []
    assert project_shape_issues(project(surface=None)) == []
    assert project_shape_issues(project(surface=None, pad=None))
    assert project_shape_issues(project(extra=1))
    assert project_shape_issues(project(surface={"name": "../x", "definition": {}, "values": {"values": [], "rows": []}}))
    # 版 2 の保持値は rows(版 1 の records は受けない)
    assert project_shape_issues(project(surface={"name": "stage", "definition": DEFINITION, "values": {"values": [], "records": []}}))
    assert project_shape_issues([])


def test_upload_reads_a_bom_prefixed_file_and_rejects_other_json() -> None:
    raw = ("﻿" + json.dumps(project(), ensure_ascii=False)).encode("utf-8")
    assert parse_project_upload(raw) == project()
    with pytest.raises(ProjectFileError, match="サーフェス定義"):
        parse_project_upload(json.dumps(DEFINITION).encode())
    with pytest.raises(ProjectFileError, match="JSON"):
        parse_project_upload(b"{")
    with pytest.raises(ProjectFileError, match="定義が不正"):
        parse_project_upload(json.dumps(project(surface={**project()["surface"], "definition": {**DEFINITION, "screens": 1}})).encode())
    with pytest.raises(ProjectFileError, match="パッドが不正"):
        parse_project_upload(json.dumps(project(pad={"name": "take-01", "pad": {**PAD, "rows": 0}})).encode())


def test_upload_leaves_the_project_size_limit_to_the_bridge_and_only_caps_the_file() -> None:
    # 12 MiB を少し超えるもの(UI では断らない。判定はブリッジ)
    pad = {**PAD, "buttons": [{**PAD["buttons"][0], "label": "x" * (PROJECT_FILE_MAX_BYTES + 10)}]}
    big = project(surface=None, pad={"name": "take-01", "pad": pad})
    with pytest.raises(ProjectFileError, match="パッドが不正"):  # ラベルの 64 文字の上限で断られるだけで、大きさでは断らない
        parse_project_upload(json.dumps(big).encode())
    with pytest.raises(ProjectFileError, match="大きすぎ"):
        parse_project_upload(b" " * (PROJECT_UPLOAD_MAX_BYTES + 1))


def test_download_escapes_lone_surrogates_so_the_file_reads_back(monkeypatch: pytest.MonkeyPatch) -> None:
    import oscdesk_ui.project_file as project_file

    lone = project(pad={"name": "take-01", "pad": {**PAD, "buttons": [{**PAD["buttons"][0], "label": "a\ud800b"}]}})
    for limit in (PROJECT_UPLOAD_MAX_BYTES, 10):  # 字下げ版とコンパクト版
        monkeypatch.setattr(project_file, "PROJECT_UPLOAD_MAX_BYTES", limit)
        data = project_file.project_download_bytes(lone)
        assert b"\\ud800" in data
        data.decode("utf-8")  # 正しい UTF-8
        monkeypatch.setattr(project_file, "PROJECT_UPLOAD_MAX_BYTES", PROJECT_UPLOAD_MAX_BYTES)
        assert parse_project_upload(data) == lone


def test_download_drops_the_indentation_when_it_would_not_fit_the_upload_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    import oscdesk_ui.project_file as project_file

    monkeypatch.setattr(project_file, "PROJECT_UPLOAD_MAX_BYTES", 200)
    data = project_file.project_download_bytes(project())
    assert b"\n  " not in data
    assert json.loads(data) == project()


def test_summary_download_bytes_and_name() -> None:
    summary = summarize_project(project())
    assert (summary.surface_name, summary.value_count, summary.row_count, summary.pad_name, summary.button_count) == ("stage", 1, 0, "take-01", 1)
    # 非 ASCII はエスケープせず UTF-8 で書き、読み戻すと同じ内容になる
    data = project_download_bytes(project())
    assert "発火".encode("utf-8") in data
    assert parse_project_upload(data) == project()
    assert project_download_name(project(), datetime(2026, 10, 28, 9, 5, 7)) == "stage-20261028-090507.oscdesk-project.json"
    assert project_download_name(project(surface=None), datetime(2026, 10, 28)).startswith("take-01-")


# --- フレーム ----------------------------------------------------------------


def test_decode_desired_status_requires_since_exactly_while_unsent() -> None:
    frame = decode_frame(json.dumps({"v": 1, "type": "desiredStatus", "unsent": True, "since": "2026-10-28T10:00:00.000Z"}))
    assert frame == DesiredStatusFrame("desiredStatus", 1, True, "2026-10-28T10:00:00.000Z")
    with pytest.raises(FrameDecodeError):
        decode_frame(json.dumps({"v": 1, "type": "desiredStatus", "unsent": True, "since": None}))
    with pytest.raises(FrameDecodeError):
        decode_frame(json.dumps({"v": 1, "type": "desiredStatus", "unsent": False, "since": "2026-10-28T10:00:00.000Z"}))


# --- 状態 --------------------------------------------------------------------


def test_state_routes_each_export_to_its_request_and_tracks_the_unsent_mark() -> None:
    state = make_state()
    first = state.request_project_export()
    second = state.request_project_export()
    assert first is not None and second is not None and first != second
    state._on_frame(ProjectFrame("project", 1, second, project()))
    assert state.take_project_export(first) is None
    assert state.take_project_export(second) == project()
    assert state.take_project_export(second) is None

    assert state.desired_unsent_since is None
    state._on_frame(DesiredStatusFrame("desiredStatus", 1, True, "2026-10-28T10:00:00.000Z"))
    assert state.desired_unsent_since == "2026-10-28T10:00:00.000Z"
    state._on_frame(DesiredStatusFrame("desiredStatus", 1, False, None))
    assert state.desired_unsent_since is None


def test_state_settles_the_oldest_export_on_a_rejection_and_all_on_disconnect() -> None:
    from oscdesk_ui.protocol import NoticeFrame
    from oscdesk_ui.surface_link import LinkStatus

    state = make_state()
    first = state.request_project_export()
    second = state.request_project_export()
    assert first is not None and second is not None
    state._on_frame(NoticeFrame("notice", 1, "error", "project-export-rejected", "empty: nothing"))
    assert state.take_project_export(first) == "empty: nothing"
    assert state.take_project_export(second) is None
    state._on_link_status(LinkStatus(False, "切断"))
    assert state.take_project_export(second) == "disconnected"


def test_import_notice_mentions_unsent_values_only_when_there_are_some() -> None:
    from oscdesk_ui.protocol import NoticeFrame

    state = make_state()
    state._on_frame(NoticeFrame("notice", 1, "info", "project-imported", 'pad "take-01"'))
    assert "まだ Unity" not in state.notices_since(0)[-1].message
    state._on_frame(DesiredStatusFrame("desiredStatus", 1, True, "2026-10-28T10:00:00.000Z"))
    state._on_frame(NoticeFrame("notice", 1, "info", "project-imported", 'surface "stage"'))
    assert "まだ Unity へ送っていません" in state.notices_since(0)[-1].message


def test_state_reports_export_failure_when_not_connected() -> None:
    state = make_state()
    state.link.connected = False  # type: ignore[attr-defined]
    assert state.request_project_export() is None
    assert state.import_project(project()) is False


def test_unsent_message_shows_the_import_time() -> None:
    assert "まだ Unity へ送っていません" in unsent_message("2026-10-28T10:00:00.000Z")
    assert "not-a-date" in unsent_message("not-a-date")


# --- ページ ------------------------------------------------------------------


async def test_page_shows_import_only_in_edit_mode_and_the_unsent_banner() -> None:
    state = make_state()
    state._on_frame(surface_frame(definition([param("a", "/a", "bool", "A")]), name="stage", revision=1))
    page = SurfacePage(state)

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        panel = page._project_panel
        assert panel._import_row is not None and not panel._import_row.visible
        assert panel._banner is not None and not panel._banner.visible

        page._edit_switch.value = True
        page.sync()
        assert panel._import_row.visible

        state._on_frame(DesiredStatusFrame("desiredStatus", 1, True, "2026-10-28T10:00:00.000Z"))
        page.sync()
        assert panel._banner.visible
        await user.should_see("Unity へ送る")


async def test_page_downloads_the_export_it_requested() -> None:
    state = make_state()
    page = SurfacePage(state)

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        exports = [e for e in user.find(kind=ui.button).elements if e.text == "書き出す"]
        assert len(exports) == 1
        user.find(kind=ui.button, content="書き出す").click()
        link = state.link
        assert len(link.exports) == 1  # type: ignore[attr-defined]
        state._on_frame(ProjectFrame("project", 1, link.exports[0], project()))  # type: ignore[attr-defined]
        page.sync()
        assert page._project_panel._pending_exports == {}


def test_spawn_records_are_part_of_the_held_values_and_counted() -> None:
    # 生成の記録(HID-385)は、版 2 では OSC 専用のものとして surface.osc の欄で運ぶ(D-117)。未知のキーとしては断らない
    with_spawns = project()
    with_spawns["surface"]["osc"] = {"spawns": [
        {"param": "spawn", "address": "/effect/spawner/spawn", "name": "spark1", "host": "192.168.1.20"},
    ]}
    assert project_shape_issues(with_spawns) == []
    assert summarize_project(with_spawns).spawn_count == 1
    assert summarize_project(project()).spawn_count == 0
    broken = project()
    broken["surface"]["osc"] = {"spawns": {"spark1": "192.168.1.20"}}
    assert project_shape_issues(broken) != []
