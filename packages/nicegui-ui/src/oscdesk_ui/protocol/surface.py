"""サーフェス定義のフレーム(surface・surfaceList・surfaceEdited)と、定義の要求・切り替え・保存・編集命令の上り。"""

from __future__ import annotations

import json
from datetime import datetime
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
class SurfaceFrame(DecodedFrame):
    """採用中の定義(版 2。D-117)。definition は本体(結び付けを含まない)、bindings は通信アダプタごとの結び付け
    (OSC のアダプタがあるときだけ osc を持つ)、view はブリッジが組み立てた表示する部品の木(D-124)。"""

    name: str = ""
    revision: int = 0
    at: str = ""
    definition: dict[str, Any] | None = None
    bindings: dict[str, Any] | None = None
    view: dict[str, Any] | None = None


@dataclass(frozen=True)
class SurfaceListFrame(DecodedFrame):
    names: tuple[str, ...] = ()
    active: str | None = None


@dataclass(frozen=True)
class SurfaceEditedFrame(DecodedFrame):
    """編集命令の答え(D-123)。通れば definition(編集後の作業コピー。結び付けを含む全体)、断られれば detail だけを持つ。"""

    request_id: str = ""
    definition: dict[str, Any] | None = None
    detail: str | None = None


def _decode_surface(frame: dict[str, Any]) -> SurfaceFrame:
    _strict(frame, {"v", "type", "name", "revision", "at", "definition", "bindings", "view"}, "frame")
    revision = frame.get("revision")
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
        raise FrameDecodeError("surface revision must be a positive integer")
    at = frame.get("at")
    try:
        if not isinstance(at, str):
            raise ValueError("not a string")
        if datetime.fromisoformat(at.replace("Z", "+00:00")).tzinfo is None:
            raise ValueError("offset is missing")
    except ValueError as error:
        raise FrameDecodeError("surface at must be ISO 8601") from error
    # 定義の検証はブリッジだけが行う(採用した定義しか配らない。D-122)。UI は外形だけを見て、判定の写しを持たない
    definition = _object(frame.get("definition"), "definition")
    # 本体に結び付けは載せない(bindings の欄で添える。D-117)
    if "bindings" in definition:
        raise FrameDecodeError("surface definition must not carry bindings")
    bindings = _object(frame.get("bindings"), "bindings")
    # 部品の木の中身もブリッジが組み立てたもの(D-124)。外形だけを見て、読めない形は state が受け止めて知らせる
    view = _object(frame.get("view"), "view")
    return SurfaceFrame(
        "surface", 1, _surface_name(frame.get("name"), "surface name"), revision, at, definition, dict(bindings), dict(view),
    )


def _decode_surface_list(frame: dict[str, Any]) -> SurfaceListFrame:
    _strict(frame, {"v", "type", "names", "active"}, "frame")
    names = frame.get("names")
    if not isinstance(names, list):
        raise FrameDecodeError("surfaceList names must be an array")
    active = frame.get("active")
    return SurfaceListFrame(
        "surfaceList", 1,
        tuple(_surface_name(name, "surfaceList name") for name in names),
        None if active is None else _surface_name(active, "surfaceList active"),
    )


def _decode_surface_edited(frame: dict[str, Any]) -> SurfaceEditedFrame:
    _strict(frame, {"v", "type", "requestId", "result"}, "frame")
    ok = _object(frame.get("result"), "surfaceEdited result").get("ok")
    if ok is True:
        # 中身の判定はブリッジが保存と同じ検査で済ませている(D-122)。UI は外形だけを見る
        result = _exact(frame["result"], {"ok", "definition"}, "surfaceEdited result")
        return SurfaceEditedFrame("surfaceEdited", 1, _request_id(frame.get("requestId")), _object(result["definition"], "surfaceEdited definition"), None)
    if ok is False:
        result = _exact(frame["result"], {"ok", "detail"}, "surfaceEdited result")
        return SurfaceEditedFrame("surfaceEdited", 1, _request_id(frame.get("requestId")), None, _string(result["detail"], "surfaceEdited detail"))
    raise FrameDecodeError("surfaceEdited result ok must be a boolean")


def encode_surface_request() -> str:
    return '{"v":1,"type":"surfaceRequest"}'


def encode_surface_load(name: str) -> str:
    _surface_name(name, "surface name")
    return json.dumps({"v": 1, "type": "surfaceLoad", "name": name}, separators=(",", ":"))


def encode_surface_save(
    name: str, definition: dict[str, Any], *, bindings: dict[str, Any] | None = None, activate: bool | None = None,
) -> str:
    """定義の保存(D-117)。definition は本体(bindings を含めない)、bindings は結び付けで、ブリッジが 1 つにして検証・保存する。"""
    _surface_name(name, "surface name")
    body = _object(definition, "definition")
    if "bindings" in body:
        raise ProtocolError("surfaceSave definition must not carry bindings (pass them as bindings)")
    payload: dict[str, Any] = {"v": 1, "type": "surfaceSave", "name": name, "definition": body}
    if bindings is not None:
        payload["bindings"] = _object(bindings, "bindings")
    if activate is not None:
        payload["activate"] = activate
    return _dumps(payload)


def encode_surface_edit(request_id: str, draft: dict[str, Any] | None, edit: dict[str, Any]) -> str:
    """編集命令(D-123)。draft は作業コピー(結び付けを含む全体。replace では省く)。答えは surfaceEdited(この request_id)。"""
    try:
        _request_id(request_id)
    except FrameDecodeError as error:
        raise ProtocolError(str(error)) from error
    payload: dict[str, Any] = {"v": 1, "type": "surfaceEdit", "requestId": request_id, "edit": _object(edit, "edit")}
    if draft is not None:
        payload["draft"] = _object(draft, "draft")
    return _dumps(payload)
