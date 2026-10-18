from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from oscdesk_ui.protocol import (
    FrameDecodeError,
    OscMessage,
    WireArg,
    DestinationsFrame,
    decode_frame,
    encode_destinations_reset,
    encode_destinations_scan,
    encode_destinations_select,
    encode_heartbeat_ack,
    encode_osc_batch_frame,
    encode_osc_frame,
    encode_pad_load,
    encode_pad_press,
    encode_pad_request,
    encode_pad_save,
    encode_record_key_add,
    encode_record_key_remove,
    encode_resend,
    encode_runtime_options_refresh,
    encode_surface_load,
    encode_surface_request,
    encode_surface_save,
)


SAMPLES_PATH = Path(__file__).parents[3] / "protocol" / "wire-samples.json"


def _samples() -> list[dict[str, Any]]:
    data = json.loads(SAMPLES_PATH.read_text(encoding="utf-8"))
    return data["cases"]


def _encode_upstream(frame: dict[str, Any]) -> str:
    if frame["type"] == "osc":
        args = [WireArg(arg["type"], arg["value"]) for arg in frame["args"]]
        return encode_osc_frame(frame["address"], args)
    if frame["type"] == "oscBatch":
        messages = [
            OscMessage(message["address"], tuple(WireArg(arg["type"], arg["value"]) for arg in message["args"]))
            for message in frame["messages"]
        ]
        return encode_osc_batch_frame(messages)
    if frame["type"] == "heartbeatAck":
        return encode_heartbeat_ack(frame["t"])
    if frame["type"] == "resend":
        return encode_resend(frame.get("target"))
    if frame["type"] == "runtimeOptionsRefresh":
        return encode_runtime_options_refresh(frame.get("request"))
    if frame["type"] == "surfaceRequest":
        return encode_surface_request()
    if frame["type"] == "surfaceLoad":
        return encode_surface_load(frame["name"])
    if frame["type"] == "surfaceSave":
        return encode_surface_save(frame["name"], frame["definition"], activate=frame.get("activate"))
    if frame["type"] == "recordKeyAdd":
        return encode_record_key_add(frame["record"], frame["key"])
    if frame["type"] == "recordKeyRemove":
        return encode_record_key_remove(frame["record"], frame["key"])
    if frame["type"] == "destinationsScan":
        return encode_destinations_scan()
    if frame["type"] == "destinationsSelect":
        return encode_destinations_select(frame["allDevices"], frame["hosts"])
    if frame["type"] == "destinationsReset":
        return encode_destinations_reset()
    if frame["type"] == "padRequest":
        return encode_pad_request()
    if frame["type"] == "padLoad":
        return encode_pad_load(frame["name"])
    if frame["type"] == "padSave":
        return encode_pad_save(frame["name"], frame["pad"])
    if frame["type"] == "padPress":
        return encode_pad_press(frame["name"], frame["version"], frame["button"])
    raise AssertionError(f"unhandled upstream sample type: {frame['type']}")


@pytest.mark.parametrize("case", _samples(), ids=lambda case: case["name"])
def test_wire_sample(case: dict[str, Any]) -> None:
    frame = case["frame"]

    # These assertions are intentionally asymmetric with the TypeScript-side checks from task 1.6.
    if case["direction"] == "downstream":
        if not case["valid"]:
            with pytest.raises(FrameDecodeError):
                decode_frame(json.dumps(frame))
            return

        decoded = decode_frame(json.dumps(frame))
        assert decoded.type == frame["type"]
        if frame["type"] == "osc":
            assert len(decoded.args) == len(frame["args"])
            assert [(arg.type, arg.value) for arg in decoded.args] == [
                (arg["type"], arg["value"]) for arg in frame["args"]
            ]
        if frame["type"] == "pad":
            assert (decoded.name, decoded.revision, decoded.version, decoded.pad) == (frame["name"], frame["revision"], frame["version"], frame["pad"])
        if frame["type"] == "padList":
            assert (list(decoded.names), decoded.active) == (frame["names"], frame["active"])
        if frame["type"] == "runtimeOptions":
            assert [(item.address, [(name, list(options)) for name, options in item.targets]) for item in decoded.lists] == [
                (item["address"], [(target["name"], target["options"]) for target in item["targets"]]) for item in frame["lists"]
            ]
            assert [(param, list(options)) for param, options in decoded.choices] == [
                (choice["param"], choice["options"]) for choice in frame["choices"]
            ]
            # keys / fieldChoices は省略可(無ければ空。D-061)
            assert [(record, list(keys)) for record, keys in decoded.keys] == [
                (item["record"], item["keys"]) for item in frame.get("keys", [])
            ]
            assert [(record, field, list(options)) for record, field, options in decoded.field_choices] == [
                (item["record"], item["field"], item["options"]) for item in frame.get("fieldChoices", [])
            ]
        if frame["type"] == "destinations":
            assert isinstance(decoded, DestinationsFrame)
            assert [device.host for device in decoded.devices] == [device["host"] for device in frame["devices"]]
            assert [device.is_self for device in decoded.devices] == [device["self"] for device in frame["devices"]]
            assert (decoded.source, decoded.all_devices, list(decoded.hosts)) == (
                frame["selection"]["source"], frame["selection"]["allDevices"], frame["selection"]["hosts"]
            )
            assert [(t.name, t.primary, t.broadcast) for t in decoded.targets] == [
                (t["name"], t["primary"], t["broadcast"]) for t in frame["targets"]
            ]
            assert list(decoded.primary_hosts) == frame["primaryHosts"]
        return

    if not case["valid"]:
        pytest.skip("Python does not produce invalid upstream sample shapes")

    encoded = _encode_upstream(frame)
    assert json.loads(encoded) == frame
