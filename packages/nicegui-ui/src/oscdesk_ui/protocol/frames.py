"""下りのフレームの入口(decode_frame)と、値オブジェクトの上りの符号化(encode_frame)。

フレーム全体の検査(未知のキー・版・種類)をここで行い、種類ごとの読み取りは各モジュールの関数へ振り分ける。
"""

from __future__ import annotations

import json
from typing import Any, Callable, Final

from .common import WIRE_PROTOCOL_VERSION, DecodedFrame, FrameDecodeError, ProtocolError, _dumps, _object, _wire_arg
from .catalog import _decode_blueprint_status, _decode_catalog
from .connection import HeartbeatAckFrame, _decode_heartbeat, _decode_hello, _decode_link, _decode_notice
from .delivery import _decode_delivery
from .destinations import _destinations
from .locks import _decode_locks
from .network import _network_settings
from .osc import UpstreamOscFrame, _decode_osc_message, _decode_sent_log
from .pad import _decode_pad, _decode_pad_edited, _decode_pad_list
from .project import _decode_project, _decode_project_inspection
from .runtime_options import _decode_runtime_options
from .surface import _decode_surface, _decode_surface_edited, _decode_surface_list
from .values import _decode_desired, _decode_desired_status, _decode_echo


KNOWN_DOWNSTREAM_TYPES: Final = frozenset(
    {
        "hello", "osc.message", "link", "heartbeat", "notice", "surface", "surfaceList", "desired", "echo", "runtimeOptions", "osc.sentLog",
        "osc.pad", "osc.padList", "osc.padEdited", "destinations", "project", "projectInspection", "surfaceEdited", "desiredStatus", "networkSettings", "catalog", "locks",
        "blueprintStatus", "delivery",
    }
)


# 種類 → 読み取り(HID-440 で decode_frame の分岐を各モジュールへ移した)
_DECODERS: Final[dict[str, Callable[[dict[str, Any]], DecodedFrame]]] = {
    "hello": _decode_hello,
    "osc.message": _decode_osc_message,
    "link": _decode_link,
    "heartbeat": _decode_heartbeat,
    "notice": _decode_notice,
    "surface": _decode_surface,
    "surfaceList": _decode_surface_list,
    "desired": _decode_desired,
    "echo": _decode_echo,
    "runtimeOptions": _decode_runtime_options,
    "osc.sentLog": _decode_sent_log,
    "osc.pad": _decode_pad,
    "osc.padList": _decode_pad_list,
    "osc.padEdited": _decode_pad_edited,
    "destinations": _destinations,
    "project": _decode_project,
    "projectInspection": _decode_project_inspection,
    "surfaceEdited": _decode_surface_edited,
    "desiredStatus": _decode_desired_status,
    "networkSettings": _network_settings,
    "catalog": _decode_catalog,
    "locks": _decode_locks,
    "blueprintStatus": _decode_blueprint_status,
    "delivery": _decode_delivery,
}


def decode_frame(raw: str | bytes | bytearray) -> DecodedFrame:
    """Decode one downstream JSON frame and preserve argument tags/order."""
    if isinstance(raw, (bytes, bytearray)):
        try:
            raw = bytes(raw).decode("utf-8")
        except UnicodeDecodeError as error:
            raise FrameDecodeError("frame is not UTF-8") from error
    try:
        value = json.loads(raw)
    except (TypeError, json.JSONDecodeError) as error:
        raise FrameDecodeError("frame is not valid JSON") from error
    frame = _object(value, "frame")
    if set(frame) - {"v", "type", "clientId", "protocolVersion", "server", "unity", "targets", "bridge", "heartbeat", "pingIntervalMs", "debug", "adapters", "address", "args", "from", "t", "level", "code", "detail", "messages", "name", "revision", "at", "definition", "names", "active", "full", "values", "lists", "choices", "keys", "fieldChoices", "pending", "records", "pad", "version", "sendPort", "scanning", "scannedAt", "devices", "broadcasts", "selection", "primaryHosts", "requestId", "project", "unsent", "since", "targetInterface", "targetRanges", "allowedBrowsers", "interfaces", "source", "pcs", "hosts", "locks", "pc", "absent", "events", "bindings", "view", "rows", "result"}:
        raise FrameDecodeError("frame contains unknown key(s)")
    if frame.get("v") != WIRE_PROTOCOL_VERSION:
        raise FrameDecodeError("missing or mismatched protocol version")
    kind = frame.get("type")
    if not isinstance(kind, str) or kind not in KNOWN_DOWNSTREAM_TYPES:
        raise FrameDecodeError(f"unknown downstream frame type: {kind!r}")
    # kind は KNOWN_DOWNSTREAM_TYPES で確かめ済み。表は同じ種類をちょうど持つ(test_protocol が検査する)
    return _DECODERS[kind](frame)


def encode_frame(frame: Any) -> str:
    if isinstance(frame, (UpstreamOscFrame, HeartbeatAckFrame)):
        data = {"v": frame.v, "type": frame.type}
        if frame.type == "osc.message":
            data.update({"address": frame.address, "args": [_wire_arg(arg) for arg in frame.args]})
        elif frame.type == "heartbeatAck":
            data["t"] = frame.t
        return _dumps(data)
    raise ProtocolError("encode_frame accepts an upstream frame value object")
