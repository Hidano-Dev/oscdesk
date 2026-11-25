"""接続の状態のフレーム(hello・link・heartbeat・notice)と heartbeatAck の上り。"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Final

from .common import DecodedFrame, FrameDecodeError, _number, _object, _strict


@dataclass(frozen=True)
class HelloFrame(DecodedFrame):
    client_id: str = ""
    protocol_version: int = 0
    server: dict[str, Any] | None = None
    unity: dict[str, Any] | None = None
    targets: tuple[dict[str, Any], ...] = ()
    bridge: dict[str, Any] | None = None
    heartbeat: dict[str, Any] | None = None
    ping_interval_ms: float = 0
    debug: bool = False
    # ブリッジが持つ通信アダプタ(HID-373)。osc があるときだけ OSC 専用の機能(OSC パッド・送信ログ)を出す
    adapters: tuple[str, ...] = ("osc",)


@dataclass(frozen=True)
class LinkFrame(DecodedFrame):
    unity: dict[str, Any] | None = None
    targets: tuple[dict[str, Any], ...] = ()


@dataclass(frozen=True)
class HeartbeatFrame(DecodedFrame):
    timestamp: int | float = 0

    @property
    def t(self) -> int | float:
        return self.timestamp


@dataclass(frozen=True)
class NoticeFrame(DecodedFrame):
    level: str = ""
    code: str = ""
    detail: str = ""


@dataclass(frozen=True)
class HeartbeatAckFrame:
    v: int
    t: int | float
    type: Final[str] = "heartbeatAck"


def _targets(value: Any) -> tuple[dict[str, Any], ...]:
    # 旧いブリッジは targets を送らない。欠落は空(宛先ごとの表示なし)として受け、
    # hello / link ごと捨てて接続情報を失わないようにする
    if value is None:
        return ()
    if not isinstance(value, list):
        raise FrameDecodeError("targets must be an array")
    for item in value:
        target = _object(item, "target")
        if not isinstance(target.get("name"), str) or not isinstance(target.get("primary"), bool):
            raise FrameDecodeError("target name must be a string and primary a boolean")
        # state.py が int() / float 扱いする値は、ここで型を確かめて読取タスクを落とさない
        losses = target.get("consecutiveLosses", 0)
        if "reachability" in target and not isinstance(target["reachability"], str):
            raise FrameDecodeError("target reachability must be a string")
        if isinstance(losses, bool) or not isinstance(losses, int):
            raise FrameDecodeError("target consecutiveLosses must be an integer")
        rtt = target.get("lastRttMs")
        if rtt is not None and (isinstance(rtt, bool) or not isinstance(rtt, (int, float))):
            raise FrameDecodeError("target lastRttMs must be a number or null")
    return tuple(value)


def _adapters(value: Any) -> tuple[str, ...]:
    """hello の通信アダプタ(HID-373)。知らない種類は読み飛ばさず保持し、画面側が知っているものだけを使う。"""
    if not isinstance(value, list) or not value or not all(isinstance(kind, str) and kind for kind in value):
        raise FrameDecodeError("hello adapters must be a non-empty array of strings")
    return tuple(value)


def _decode_heartbeat(frame: dict[str, Any]) -> HeartbeatFrame:
    _strict(frame, {"v", "type", "t"}, "frame")
    return HeartbeatFrame("heartbeat", 1, _number(frame.get("t"), "heartbeat timestamp"))


def _decode_notice(frame: dict[str, Any]) -> NoticeFrame:
    _strict(frame, {"v", "type", "level", "code", "detail"}, "frame")
    if not all(isinstance(frame.get(key), str) for key in ("level", "code", "detail")):
        raise FrameDecodeError("invalid notice fields")
    return NoticeFrame("notice", 1, frame["level"], frame["code"], frame["detail"])


def _decode_link(frame: dict[str, Any]) -> LinkFrame:
    _strict(frame, {"v", "type", "unity", "targets"}, "frame")
    return LinkFrame("link", 1, _object(frame.get("unity"), "unity"), _targets(frame.get("targets")))


def _decode_hello(frame: dict[str, Any]) -> HelloFrame:
    _strict(frame, {"v", "type", "clientId", "protocolVersion", "server", "unity", "targets", "bridge", "heartbeat", "pingIntervalMs", "debug", "adapters"}, "frame")
    if not isinstance(frame.get("clientId"), str):
        raise FrameDecodeError("hello clientId must be a string")
    # 欠落キーは KeyError でなく FrameDecodeError にする(KeyError は読取タスクを殺し、
    # 「不正フレームでも接続維持」の規約を破って再接続を誘発する)
    return HelloFrame("hello", 1, frame["clientId"], frame.get("protocolVersion"), _object(frame.get("server"), "server"), _object(frame.get("unity"), "unity"), _targets(frame.get("targets")), _object(frame.get("bridge"), "bridge"), _object(frame.get("heartbeat"), "heartbeat"), _number(frame.get("pingIntervalMs"), "pingIntervalMs"), frame.get("debug"), _adapters(frame.get("adapters")))


def encode_heartbeat_ack(timestamp: int | float) -> str:
    _number(timestamp, "heartbeat timestamp")
    return json.dumps({"v": 1, "type": "heartbeatAck", "t": timestamp}, separators=(",", ":"))
