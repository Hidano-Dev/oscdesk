"""プロジェクトファイル(D-090)のフレーム(project・projectInspection)と、書き出し・検査・取り込みの上り。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .common import (
    DecodedFrame,
    FrameDecodeError,
    ProtocolError,
    _dumps,
    _exact,
    _object,
    _request_id,
    _string,
    _strict,
    _surface_name,
)


@dataclass(frozen=True)
class ProjectFrame(DecodedFrame):
    """書き出したプロジェクトファイル(D-090)。project は形だけを確かめた生の dict(中身の検証はブリッジが済ませている)。"""

    request_id: str = ""
    project: dict[str, Any] | None = None


@dataclass(frozen=True)
class ProjectSummary:
    """読み込む前の検査で通ったプロジェクトの要約(D-122)。件数はブリッジが取り込む形で数えたもの。"""

    exported_at: str
    surface_name: str | None
    value_count: int
    row_count: int
    spawn_count: int
    pad_name: str | None
    button_count: int


@dataclass(frozen=True)
class ProjectInspectionFrame(DecodedFrame):
    """読み込む前の検査の答え(D-122)。通れば summary、断られれば detail(取り込みの拒否と同じ理由)だけを持つ。"""

    request_id: str = ""
    summary: ProjectSummary | None = None
    detail: str | None = None


def _count(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise FrameDecodeError(f"{label} must be a non-negative integer")
    return value


def _project_inspection(value: Any) -> tuple[ProjectSummary | None, str | None]:
    ok = _object(value, "projectInspection result").get("ok")
    if ok is False:
        result = _exact(value, {"ok", "detail"}, "projectInspection result")
        return None, _string(result["detail"], "projectInspection detail")
    if ok is not True:
        raise FrameDecodeError("projectInspection result ok must be a boolean")
    summary = _exact(_exact(value, {"ok", "summary"}, "projectInspection result")["summary"], {"exportedAt", "surface", "pad"}, "projectInspection summary")
    surface = summary["surface"]
    pad = summary["pad"]
    if surface is not None:
        surface = _exact(surface, {"name", "values", "rows", "spawns"}, "projectInspection surface")
    if pad is not None:
        pad = _exact(pad, {"name", "buttons"}, "projectInspection pad")
    return ProjectSummary(
        exported_at=_string(summary["exportedAt"], "projectInspection exportedAt"),
        surface_name=None if surface is None else _surface_name(surface["name"], "projectInspection surface name"),
        value_count=0 if surface is None else _count(surface["values"], "projectInspection values"),
        row_count=0 if surface is None else _count(surface["rows"], "projectInspection rows"),
        spawn_count=0 if surface is None else _count(surface["spawns"], "projectInspection spawns"),
        pad_name=None if pad is None else _surface_name(pad["name"], "projectInspection pad name"),
        button_count=0 if pad is None else _count(pad["buttons"], "projectInspection buttons"),
    ), None


def _decode_project(frame: dict[str, Any]) -> ProjectFrame:
    _strict(frame, {"v", "type", "requestId", "project"}, "frame")
    # 中身はブリッジが取り込みと同じ検査に通してから送る(D-122)。UI はそのままファイルにするだけ
    project = _object(frame.get("project"), "project")
    return ProjectFrame("project", 1, _request_id(frame.get("requestId")), project)


def _decode_project_inspection(frame: dict[str, Any]) -> ProjectInspectionFrame:
    _strict(frame, {"v", "type", "requestId", "result"}, "frame")
    summary, detail = _project_inspection(frame.get("result"))
    return ProjectInspectionFrame("projectInspection", 1, _request_id(frame.get("requestId")), summary, detail)


def encode_project_export(request_id: str) -> str:
    """採用中の定義・保持値・パッドをまとめて返させる(D-090)。応答の project はこの request_id を持つ。"""
    try:
        _request_id(request_id)
    except FrameDecodeError as error:
        raise ProtocolError(str(error)) from error
    return _dumps({"v": 1, "type": "projectExport", "requestId": request_id})


def encode_project_inspect(request_id: str, project: dict[str, Any]) -> str:
    """読み込む前の検査(D-122)。取り込みと同じ判定をブリッジが行い、projectInspection(この request_id)で答える。"""
    try:
        _request_id(request_id)
    except FrameDecodeError as error:
        raise ProtocolError(str(error)) from error
    return _dumps({"v": 1, "type": "projectInspect", "requestId": request_id, "project": _object(project, "project")})


def encode_project_import(project: dict[str, Any]) -> str:
    """プロジェクトの取り込み(D-090)。中身はブリッジが検証して、不正なら project-import-rejected で理由を返す。"""
    return _dumps({"v": 1, "type": "projectImport", "project": _object(project, "project")})
