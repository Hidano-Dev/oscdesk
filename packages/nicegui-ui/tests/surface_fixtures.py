"""テスト用のサーフェス定義とフレームの組み立て。

定義の構造・意味の検証は本番と同じ validate_surface_definition(SurfaceFrame の
デコード)を通すので、テストが検証に通らない定義を前提にしないようにしている。
"""

from __future__ import annotations

from typing import Any

from oscdesk_ui.protocol import DesiredFrame, DesiredValue, OscFrame, Peer, SurfaceFrame, WireArg
from oscdesk_ui.surface_definition import validate_surface_definition

AT = "2026-10-10T00:00:00Z"


def param(id: str, address: str, type: str, label: str | None = None, kind: str = "state", **fields: Any) -> dict[str, Any]:
    return {"id": id, "address": address, "label": label or id, "type": type, "kind": kind, **fields}


def control(param_id: str, **fields: Any) -> dict[str, Any]:
    return {"kind": "control", "param": param_id, **fields}


def definition(
    parameters: list[dict[str, Any]],
    controls: list[dict[str, Any]] | None = None,
    name: str = "Test",
) -> dict[str, Any]:
    """controls を省くと、全パラメータを既定の部品で 1 画面に並べる。"""
    if controls is None:
        controls = [control(p["id"]) for p in parameters]
    result = {
        "format": "oscdesk-surface",
        "version": 1,
        "name": name,
        "parameters": parameters,
        "screens": [{"id": "main", "label": "Main", "children": controls}],
    }
    validate_surface_definition(result)
    return result


def surface_frame(defn: dict[str, Any], name: str = "test", revision: int = 1) -> SurfaceFrame:
    return SurfaceFrame(type="surface", name=name, revision=revision, at=AT, definition=defn)


def desired_frame(values: dict[str, list[tuple[str, Any]]], full: bool = True) -> DesiredFrame:
    return DesiredFrame(
        type="desired",
        full=full,
        values=tuple(
            DesiredValue(address, tuple(WireArg(type=tag, value=value) for tag, value in args))
            for address, args in values.items()
        ),
    )


def echo_frame(address: str, *args: tuple[str, Any], host: str = "127.0.0.1") -> OscFrame:
    return OscFrame(
        type="osc",
        address=address,
        args=tuple(WireArg(type=tag, value=value) for tag, value in args),
        source=Peer(host=host, port=7091),
    )
