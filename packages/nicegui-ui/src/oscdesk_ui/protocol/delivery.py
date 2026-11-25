"""到達のイベント(D-116)の delivery フレーム。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Final

from .common import DecodedFrame, FrameDecodeError, _string, _strict


DELIVERY_RESULTS: Final = ("ok", "ignored", "failed")


@dataclass(frozen=True)
class DeliveryEvent:
    host: str
    target: str
    result: str
    param: str | None
    elapsed_ms: int


@dataclass(frozen=True)
class DeliveryFrame(DecodedFrame):
    """到達のイベント(D-116)。送り先の PC ごとに、送ったものが届いたか(ok)・届いたが対象がいない(ignored)・処理できなかった(failed)。"""

    events: tuple[DeliveryEvent, ...] = ()


def _delivery_event(value: Any) -> DeliveryEvent:
    event = _strict(value, {"host", "target", "result", "param", "elapsedMs"}, "delivery event")
    host = _string(event.get("host"), "delivery host", non_empty=True)
    target = _string(event.get("target"), "delivery target", non_empty=True)
    result = event.get("result")
    if result not in DELIVERY_RESULTS:
        raise FrameDecodeError("delivery result must be ok, ignored or failed")
    # param は省略しない(パラメータに当たらない送信は null)。共通のフレームなので OSC のアドレスは来ない(HID-373)
    if "param" not in event:
        raise FrameDecodeError("delivery param is required")
    param = event["param"]
    if param is not None and (not isinstance(param, str) or not param):
        raise FrameDecodeError("delivery param must be a non-empty string or null")
    elapsed = event.get("elapsedMs")
    if isinstance(elapsed, bool) or not isinstance(elapsed, int) or elapsed < 0:
        raise FrameDecodeError("delivery elapsedMs must be a non-negative integer")
    return DeliveryEvent(host, target, result, param, elapsed)


def _decode_delivery(frame: dict[str, Any]) -> DeliveryFrame:
    _strict(frame, {"v", "type", "events"}, "frame")
    events = frame.get("events")
    if not isinstance(events, list) or not 1 <= len(events) <= 64:
        raise FrameDecodeError("delivery events must be an array of 1 to 64 items")
    return DeliveryFrame("delivery", 1, tuple(_delivery_event(event) for event in events))
