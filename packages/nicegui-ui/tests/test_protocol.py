from __future__ import annotations

import json

import pytest

from oscdesk_ui.protocol import (
    FrameDecodeError,
    WireArg,
    decode_frame,
    encode_heartbeat_ack,
    encode_osc_frame,
    encode_set,
)
from oscdesk_ui.protocol import ProtocolError


def test_set_carries_the_parameter_id_and_a_plain_json_value() -> None:
    # HID-373: UI は型タグを付けずに値だけを送る(どの型で送るかはブリッジが定義から決める)
    assert json.loads(encode_set("master", 0.5)) == {"v": 1, "type": "set", "param": "master", "value": 0.5}
    assert json.loads(encode_set("mute", True)) == {"v": 1, "type": "set", "param": "mute", "value": True}
    assert json.loads(encode_set("go", has_value=False)) == {"v": 1, "type": "set", "param": "go"}
    for bad in (float("nan"), float("inf"), None, [1], {"type": "f", "value": 1}):
        with pytest.raises(ProtocolError):
            encode_set("master", bad)
    with pytest.raises(ProtocolError):
        encode_set("", 1)


def test_upstream_frames_use_the_bridge_wire_format() -> None:
    assert json.loads(encode_heartbeat_ack(4)) == {"v": 1, "type": "heartbeatAck", "t": 4}
    assert json.loads(encode_osc_frame("/a", [WireArg("f", 0.5)])) == {
        "v": 1,
        "type": "osc.message",
        "address": "/a",
        "args": [{"type": "f", "value": 0.5}],
    }


def test_downstream_osc_preserves_tagged_arguments() -> None:
    frame = decode_frame(json.dumps({
        "v": 1,
        "type": "osc.message",
        "address": "/a",
        "args": [{"type": "i", "value": 1}],
        "from": {"host": "127.0.0.1", "port": 7000},
    }))
    assert frame.type == "osc.message"
    assert [(arg.type, arg.value) for arg in frame.args] == [("i", 1)]


@pytest.mark.parametrize("frame", [
    ["receiveOsc", {"address": "/a"}],
    {"v": 2, "type": "heartbeat", "t": 1},
    {"v": 1, "type": "heartbeat", "unknown": True, "t": 1},
    {"v": 1, "type": "heartbeat", "t": "1"},
])
def test_legacy_or_invalid_downstream_frames_are_rejected(frame) -> None:
    with pytest.raises(FrameDecodeError):
        decode_frame(json.dumps(frame))


@pytest.mark.parametrize("frame", [
    # 必須キーの欠落は KeyError でなく FrameDecodeError になること。
    # KeyError だと読取タスクが落ちて再接続され、「不正フレームでも接続維持」の規約を破る
    {"v": 1, "type": "osc.message", "address": "/a", "args": []},
    {"v": 1, "type": "link", "targets": []},
    {"v": 1, "type": "hello", "clientId": "ui-1"},
])
def test_missing_required_fields_raise_decode_errors(frame) -> None:
    with pytest.raises(FrameDecodeError):
        decode_frame(json.dumps(frame))


def test_heartbeat_is_decoded() -> None:
    frame = decode_frame('{"v":1,"type":"heartbeat","t":9}')
    assert frame.type == "heartbeat"
    assert frame.t == 9


def test_decode_desired_frame_keeps_arg_tags_and_order() -> None:
    from oscdesk_ui.protocol import DesiredFrame, FrameDecodeError, decode_frame

    # 保持値はパラメータ id と JSON の値・行で届く(HID-389)
    frame = decode_frame(
        '{"v":1,"type":"desired","full":true,"values":[{"param":"a","value":0.5}],'
        '"rows":[{"record":"r","key":"k","values":{"f":"x"}}]}'
    )
    assert isinstance(frame, DesiredFrame)
    assert frame.full is True
    assert [(item.param, item.value) for item in frame.values] == [("a", 0.5)]
    assert [(row.record, row.key, row.values) for row in frame.rows] == [("r", "k", {"f": "x"})]
    for bad in (
        '{"v":1,"type":"desired","full":"yes","values":[],"rows":[]}',
        '{"v":1,"type":"desired","full":true,"values":[{"address":"/a","args":[]}],"rows":[]}',
        '{"v":1,"type":"desired","full":true,"values":[{"param":"a","value":0.5,"x":1}],"rows":[]}',
        '{"v":1,"type":"desired","full":true,"values":[{"param":"a"}],"rows":[]}',
        '{"v":1,"type":"desired","full":true,"values":[],"rows":[{"record":"r","key":"k","values":{"__proto__x":1}}]}',
    ):
        try:
            decode_frame(bad)
        except FrameDecodeError:
            continue
        raise AssertionError(f"accepted: {bad}")


@pytest.mark.parametrize("target", [
    {"name": "a", "primary": "yes"},
    {"name": 1, "primary": True},
    {"name": "a", "primary": True, "consecutiveLosses": "3"},
    {"name": "a", "primary": True, "lastRttMs": "fast"},
])
def test_malformed_link_targets_are_decode_errors(target) -> None:
    frame = {"v": 1, "type": "link", "unity": {}, "targets": [target]}
    with pytest.raises(FrameDecodeError):
        decode_frame(json.dumps(frame))


def test_frames_from_an_older_bridge_without_targets_still_decode() -> None:
    frame = {"v": 1, "type": "link", "unity": {}}
    assert decode_frame(json.dumps(frame)).targets == ()
