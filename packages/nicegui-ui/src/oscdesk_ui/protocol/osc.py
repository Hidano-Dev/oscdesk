"""OSC 専用のフレーム(osc.message・osc.sentLog)と、生の OSC・osc.batch の上り(D-110)。

OSC パッドの osc.pad* は pad に置く。
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from typing import Any, Final, Sequence

from ..surface_definition import OSC_BATCH_MAX_MESSAGES
from .common import (
    DecodedFrame,
    FrameDecodeError,
    Peer,
    ProtocolError,
    WireArg,
    _arg,
    _dumps,
    _int_at_least,
    _iso_datetime,
    _strict,
    _wire_arg,
)
from .locks import _holder


# 送信ログ(D-067)の契機。bridge 側 (packages/shared/src/wire.ts) の SENT_LOG_ORIGINS と同じ
SENT_LOG_ORIGINS: Final = frozenset({"ui", "action", "resend", "row", "request", "relay", "pad"})
# bridge 側 (packages/shared/src/limits.ts) の SENT_LOG と同じ上限
SENT_LOG_MAX_RECORDS_PER_FRAME: Final = 100
SENT_LOG_MAX_ARGS: Final = 16


@dataclass(frozen=True)
class OscFrame(DecodedFrame):
    address: str = ""
    args: tuple[WireArg, ...] = ()
    source: Peer | None = None


@dataclass(frozen=True)
class SentBatch:
    id: int
    index: int
    size: int


@dataclass(frozen=True)
class SentRecord:
    """ブリッジが Unity へ送った OSC の 1 件(D-067)。count は連続送信をまとめた件数。"""

    seq: int
    at: str
    origin: str
    targets: tuple[str, ...]
    address: str
    args: tuple[WireArg, ...]
    count: int
    batch: SentBatch | None
    clipped: bool


@dataclass(frozen=True)
class SentLogFrame(DecodedFrame):
    full: bool = False
    records: tuple[SentRecord, ...] = ()


@dataclass(frozen=True)
class UpstreamOscFrame:
    v: int
    type: Final[str] = "osc.message"
    address: str = ""
    args: tuple[WireArg, ...] = ()


@dataclass(frozen=True)
class OscMessage:
    address: str
    args: tuple[WireArg, ...] = ()


def _sent_record(value: Any) -> SentRecord:
    item = _strict(value, {"seq", "at", "origin", "targets", "address", "args", "count", "batch", "clipped"}, "sentLog record")
    missing = {"seq", "at", "origin", "targets", "address", "args", "count", "batch", "clipped"} - set(item)
    if missing:
        raise FrameDecodeError(f"sentLog record is missing: {', '.join(sorted(missing))}")
    if item["origin"] not in SENT_LOG_ORIGINS:
        raise FrameDecodeError(f"unknown sentLog origin: {item['origin']!r}")
    targets = item["targets"]
    if not isinstance(targets, list) or not targets or not all(isinstance(name, str) for name in targets):
        raise FrameDecodeError("sentLog targets must be a non-empty array of strings")
    address = item["address"]
    if not isinstance(address, str) or not address.startswith("/"):
        raise FrameDecodeError("sentLog address must start with '/'")
    args = item["args"]
    if not isinstance(args, list) or len(args) > SENT_LOG_MAX_ARGS:
        raise FrameDecodeError(f"sentLog args must be an array of at most {SENT_LOG_MAX_ARGS}")
    if not isinstance(item["clipped"], bool):
        raise FrameDecodeError("sentLog clipped must be a boolean")
    batch = None
    if item["batch"] is not None:
        raw_batch = _strict(item["batch"], {"id", "index", "size"}, "sentLog batch")
        batch = SentBatch(
            _int_at_least(raw_batch.get("id"), 1, "sentLog batch id"),
            _int_at_least(raw_batch.get("index"), 0, "sentLog batch index"),
            _int_at_least(raw_batch.get("size"), 1, "sentLog batch size"),
        )
    return SentRecord(
        _int_at_least(item["seq"], 1, "sentLog seq"),
        _iso_datetime(item["at"], "sentLog at"),
        item["origin"],
        tuple(targets),
        address,
        tuple(_arg(arg) for arg in args),
        _int_at_least(item["count"], 1, "sentLog count"),
        batch,
        item["clipped"],
    )


def _decode_osc_message(frame: dict[str, Any]) -> OscFrame:
    _strict(frame, {"v", "type", "address", "args", "from"}, "frame")
    if not isinstance(frame.get("address"), str) or not frame["address"].startswith("/"):
        raise FrameDecodeError("osc address must start with '/'")
    args = frame.get("args")
    if not isinstance(args, list):
        raise FrameDecodeError("osc args must be an array")
    source = _strict(frame.get("from"), {"host", "port"}, "from")
    if not isinstance(source.get("host"), str) or not isinstance(source.get("port"), int):
        raise FrameDecodeError("invalid osc source")
    return OscFrame("osc.message", 1, frame["address"], tuple(_arg(arg) for arg in args), Peer(source["host"], source["port"]))


def _decode_sent_log(frame: dict[str, Any]) -> SentLogFrame:
    _strict(frame, {"v", "type", "full", "records"}, "frame")
    if not isinstance(frame.get("full"), bool):
        raise FrameDecodeError("sentLog full must be a boolean")
    records = frame.get("records")
    if not isinstance(records, list) or len(records) > SENT_LOG_MAX_RECORDS_PER_FRAME:
        raise FrameDecodeError(f"sentLog records must be an array of at most {SENT_LOG_MAX_RECORDS_PER_FRAME}")
    return SentLogFrame("osc.sentLog", 1, frame["full"], tuple(_sent_record(record) for record in records))


def encode_osc_frame(address: str, args: Sequence[WireArg | tuple[str, Any] | dict[str, Any]], *, holder: str | None = None) -> str:
    if not isinstance(address, str) or not address.startswith("/"):
        raise ProtocolError("OSC address must start with '/'")
    payload: dict[str, Any] = {"v": 1, "type": "osc.message", "address": address, "args": [_wire_arg(arg) for arg in args]}
    if holder is not None:
        payload["holder"] = _holder(holder)
    return _dumps(payload)


def encode_osc_batch_frame(messages: Sequence[OscMessage | dict[str, Any]], *, holder: str | None = None) -> str:
    if not messages or len(messages) > OSC_BATCH_MAX_MESSAGES:
        raise ProtocolError(f"oscBatch messages must contain 1 to {OSC_BATCH_MAX_MESSAGES} items")
    encoded_messages: list[dict[str, Any]] = []
    for message in messages:
        if isinstance(message, OscMessage):
            address, args = message.address, message.args
        elif isinstance(message, dict) and set(message) == {"address", "args"}:
            address, args = message["address"], message["args"]
        else:
            raise ProtocolError("invalid oscBatch message")
        if not isinstance(address, str) or not address.startswith("/"):
            raise ProtocolError("OSC address must start with '/'")
        encoded_messages.append({"address": address, "args": [_wire_arg(arg) for arg in args]})
    payload: dict[str, Any] = {"v": 1, "type": "osc.batch", "messages": encoded_messages}
    if holder is not None:
        payload["holder"] = _holder(holder)
    return _dumps(payload)


def _osc_string_size(text: str) -> int:
    # OSC 1.0 の文字列は NUL 終端を含めて 4 バイト境界まで詰める(ちょうど割り切れても NUL の 4 バイトが要る)。
    # surrogatepass: 孤立サロゲートはブリッジが U+FFFD(3 バイト)にして送るので同じ 3 バイトで数える(strict だと
    # UnicodeEncodeError でまとめ送りが通知も出さずに止まる)
    return (len(text.encode("utf-8", "surrogatepass")) // 4 + 1) * 4


def osc_bundle_size(messages: Sequence[OscMessage]) -> int:
    """messages を 1 つの OSC bundle にしたときのバイト数(ブリッジが 60 KiB の上限と比べる値と同じ数え方)。

    UI が展開した件数が実行時に決まるまとめ送り(レコードの全行。D-064)を、送る前に上限と比べるために使う。
    """
    size = 16  # "#bundle\0" + timetag
    for message in messages:
        body = _osc_string_size(message.address) + _osc_string_size("," + "".join(arg.type for arg in message.args))
        for arg in message.args:
            if arg.type == "s":
                body += _osc_string_size(str(arg.value))
            elif arg.type == "b":
                length = len(base64.b64decode(str(arg.value)))
                body += 4 + (length + 3) // 4 * 4
            else:
                body += 4
        size += 4 + body
    return size
