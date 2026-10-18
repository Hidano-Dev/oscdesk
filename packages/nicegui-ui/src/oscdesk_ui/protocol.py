"""OscDesk WebSocket wire protocol (version 1).

The wire representation is deliberately strict.  A frame that is not one of
the documented downstream frames is rejected instead of being guessed at.
"""

from __future__ import annotations

import base64
import binascii
import json
import re
from datetime import datetime
from dataclasses import dataclass
from typing import Any, Final, Sequence

from .surface_definition import OSC_BATCH_MAX_MESSAGES, SurfaceDefinitionError, validate_surface_definition

WIRE_PROTOCOL_VERSION: Final = 1
KNOWN_DOWNSTREAM_TYPES: Final = frozenset(
    {
        "hello", "osc", "link", "heartbeat", "notice", "surface", "surfaceList", "desired", "runtimeOptions", "sentLog",
        "destinations",
    }
)
# bridge 側 (packages/shared/src/limits.ts) の DESTINATIONS.MAX_SELECTED_HOSTS と同じ上限
DESTINATIONS_MAX_SELECTED_HOSTS: Final = 256
# 送信ログ(D-067)の契機。bridge 側 (packages/shared/src/wire.ts) の SENT_LOG_ORIGINS と同じ
SENT_LOG_ORIGINS: Final = frozenset({"ui", "action", "resend", "row", "request", "relay"})
# bridge 側 (packages/shared/src/limits.ts) の SENT_LOG と同じ上限
SENT_LOG_MAX_RECORDS_PER_FRAME: Final = 100
SENT_LOG_MAX_ARGS: Final = 16
# bridge 側 (packages/shared/src/wire.ts) の isValidSurfaceName と同じ規則
SURFACE_NAME_PATTERN: Final = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}\Z")
_WINDOWS_RESERVED_NAME: Final = re.compile(r"(?:con|prn|aux|nul|com[1-9]|lpt[1-9])\Z", re.IGNORECASE)
WIRE_ARG_TYPES: Final = frozenset({"i", "f", "s", "b"})


class FrameDecodeError(ValueError):
    """A JSON value is not a valid version 1 downstream frame."""


# Kept as the public name used by the connection layer during the migration.
ProtocolError = FrameDecodeError


@dataclass(frozen=True)
class WireArg:
    type: str
    value: int | float | str


@dataclass(frozen=True)
class Peer:
    host: str
    port: int


@dataclass(frozen=True)
class DecodedFrame:
    """Common value-object surface shared by all downstream frame variants."""

    type: str
    v: int = WIRE_PROTOCOL_VERSION


@dataclass(frozen=True)
class OscFrame(DecodedFrame):
    address: str = ""
    args: tuple[WireArg, ...] = ()
    source: Peer | None = None


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


@dataclass(frozen=True)
class SurfaceFrame(DecodedFrame):
    name: str = ""
    revision: int = 0
    at: str = ""
    definition: dict[str, Any] | None = None


@dataclass(frozen=True)
class SurfaceListFrame(DecodedFrame):
    names: tuple[str, ...] = ()
    active: str | None = None


@dataclass(frozen=True)
class DesiredValue:
    address: str
    args: tuple[WireArg, ...]


@dataclass(frozen=True)
class DesiredFrame(DecodedFrame):
    full: bool = False
    values: tuple[DesiredValue, ...] = ()


@dataclass(frozen=True)
class RuntimeOptionList:
    """一覧のアドレス 1 つ分。targets は一覧を返した宛先だけ(名前 → 一覧、config の順)。"""

    address: str
    targets: tuple[tuple[str, tuple[str, ...]], ...]


@dataclass(frozen=True)
class RuntimeOptionsFrame(DecodedFrame):
    """Unity が実行時に持つ文字列の一覧(D-053)。毎回全量で、choices はパラメータ id → 選択肢。"""

    lists: tuple[RuntimeOptionList, ...] = ()
    choices: tuple[tuple[str, tuple[str, ...]], ...] = ()
    # レコード(D-061)。keys はレコード id → キーの一覧、field_choices は (レコード id, フィールド id) → 選択肢。
    # 旧いブリッジは送らないので、欄が無ければ空として扱う
    keys: tuple[tuple[str, tuple[str, ...]], ...] = ()
    field_choices: tuple[tuple[str, str, tuple[str, ...]], ...] = ()


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
class DestinationDevice:
    """宛先タブの一覧の 1 台(D-078)。found は直近の走査で見つかったか、is_self はこの PC(ブリッジの PC)か。"""

    host: str
    mac: str | None
    interface: str | None
    is_self: bool
    configured: bool
    found: bool


@dataclass(frozen=True)
class DestinationBroadcast:
    """「全てのデバイス」で送るブロードキャストアドレス(D-079)。network は CIDR 表記。"""

    address: str
    interface: str
    network: str


@dataclass(frozen=True)
class DestinationTarget:
    """ブリッジが実際に送っている宛先(hello.targets と同じ形 + broadcast)。"""

    name: str
    host: str
    send_port: int
    primary: bool
    broadcast: bool


@dataclass(frozen=True)
class DestinationsFrame(DecodedFrame):
    """宛先タブ(D-078)。毎回全量で、UI は丸ごと置き換える。source は config(未保存)/ saved。"""

    send_port: int = 0
    scanning: bool = False
    scanned_at: str | None = None
    devices: tuple[DestinationDevice, ...] = ()
    broadcasts: tuple[DestinationBroadcast, ...] = ()
    source: str = "config"
    all_devices: bool = False
    hosts: tuple[str, ...] = ()
    targets: tuple[DestinationTarget, ...] = ()
    # 主系の Unity とみなす送信元ホスト(主系がブロードキャスト・この PC のとき host と送信元が一致しないため。D-079)
    primary_hosts: tuple[str, ...] = ()


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
class UpstreamOscFrame:
    v: int
    type: Final[str] = "osc"
    address: str = ""
    args: tuple[WireArg, ...] = ()


@dataclass(frozen=True)
class HeartbeatAckFrame:
    v: int
    t: int | float
    type: Final[str] = "heartbeatAck"


@dataclass(frozen=True)
class OscMessage:
    address: str
    args: tuple[WireArg, ...] = ()


def _object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise FrameDecodeError(f"{label} must be an object")
    return value


def _strict(value: Any, allowed: set[str], label: str) -> dict[str, Any]:
    result = _object(value, label)
    unknown = set(result) - allowed
    if unknown:
        raise FrameDecodeError(f"unknown {label} key(s): {', '.join(sorted(unknown))}")
    return result


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


def is_valid_surface_name(value: Any) -> bool:
    return (
        isinstance(value, str)
        and SURFACE_NAME_PATTERN.match(value) is not None
        and _WINDOWS_RESERVED_NAME.match(value) is None
    )


def _surface_name(value: Any, label: str) -> str:
    if not is_valid_surface_name(value):
        raise FrameDecodeError(f"{label} is not a valid surface name")
    return value


def _number(value: Any, label: str) -> int | float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise FrameDecodeError(f"{label} must be a number")
    return value


def _names(value: Any) -> tuple[str, ...]:
    if not isinstance(value, list) or not all(isinstance(name, str) for name in value):
        raise FrameDecodeError("runtimeOptions options must be an array of strings")
    return tuple(value)


def _int_at_least(value: Any, minimum: int, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise FrameDecodeError(f"{label} must be an integer >= {minimum}")
    return value


def _iso_datetime(value: Any, label: str) -> str:
    try:
        if not isinstance(value, str):
            raise ValueError("not a string")
        if datetime.fromisoformat(value.replace("Z", "+00:00")).tzinfo is None:
            raise ValueError("offset is missing")
    except ValueError as error:
        raise FrameDecodeError(f"{label} must be ISO 8601") from error
    return value


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


def _bool(value: Any, label: str) -> bool:
    if not isinstance(value, bool):
        raise FrameDecodeError(f"{label} must be a boolean")
    return value


def _string(value: Any, label: str, *, nullable: bool = False, non_empty: bool = False) -> Any:
    if value is None and nullable:
        return None
    if not isinstance(value, str) or (non_empty and not value):
        raise FrameDecodeError(f"{label} must be a {'non-empty ' if non_empty else ''}string")
    return value


def _strings(value: Any, label: str) -> tuple[str, ...]:
    if not isinstance(value, list) or not all(isinstance(item, str) and item for item in value):
        raise FrameDecodeError(f"{label} must be an array of non-empty strings")
    return tuple(value)


def _port(value: Any, label: str) -> int:
    port = _int_at_least(value, 1, label)
    if port > 65535:
        raise FrameDecodeError(f"{label} must be at most 65535")
    return port


def _destinations(frame: dict[str, Any]) -> DestinationsFrame:
    keys = {"sendPort", "scanning", "scannedAt", "devices", "broadcasts", "selection", "targets", "primaryHosts"}
    _strict(frame, {"v", "type", *keys}, "frame")
    missing = keys - set(frame)
    if missing:
        raise FrameDecodeError(f"destinations is missing: {', '.join(sorted(missing))}")
    devices = frame["devices"]
    broadcasts = frame["broadcasts"]
    targets = frame["targets"]
    if not isinstance(devices, list) or not isinstance(broadcasts, list) or not isinstance(targets, list):
        raise FrameDecodeError("destinations devices, broadcasts and targets must be arrays")
    if not targets:
        raise FrameDecodeError("destinations targets must not be empty")
    decoded_devices = []
    for item in devices:
        device = _strict(item, {"host", "mac", "interface", "self", "configured", "found"}, "destinations device")
        if set(device) != {"host", "mac", "interface", "self", "configured", "found"}:
            raise FrameDecodeError("destinations device is missing a key")
        decoded_devices.append(DestinationDevice(
            _string(device["host"], "device host", non_empty=True),
            _string(device["mac"], "device mac", nullable=True),
            _string(device["interface"], "device interface", nullable=True),
            _bool(device["self"], "device self"),
            _bool(device["configured"], "device configured"),
            _bool(device["found"], "device found"),
        ))
    decoded_broadcasts = []
    for item in broadcasts:
        broadcast = _strict(item, {"address", "interface", "network"}, "destinations broadcast")
        decoded_broadcasts.append(DestinationBroadcast(
            _string(broadcast.get("address"), "broadcast address", non_empty=True),
            _string(broadcast.get("interface"), "broadcast interface"),
            _string(broadcast.get("network"), "broadcast network"),
        ))
    decoded_targets = []
    for item in targets:
        target = _strict(item, {"name", "host", "sendPort", "primary", "broadcast"}, "destinations target")
        decoded_targets.append(DestinationTarget(
            _string(target.get("name"), "target name"),
            _string(target.get("host"), "target host"),
            _port(target.get("sendPort"), "target sendPort"),
            _bool(target.get("primary"), "target primary"),
            _bool(target.get("broadcast"), "target broadcast"),
        ))
    selection = _strict(frame["selection"], {"source", "allDevices", "hosts"}, "destinations selection")
    if selection.get("source") not in ("config", "saved"):
        raise FrameDecodeError("destinations selection source must be config or saved")
    scanned_at = frame["scannedAt"]
    return DestinationsFrame(
        "destinations",
        1,
        _port(frame["sendPort"], "destinations sendPort"),
        _bool(frame["scanning"], "destinations scanning"),
        None if scanned_at is None else _iso_datetime(scanned_at, "destinations scannedAt"),
        tuple(decoded_devices),
        tuple(decoded_broadcasts),
        selection["source"],
        _bool(selection.get("allDevices"), "selection allDevices"),
        _strings(selection.get("hosts"), "selection hosts"),
        tuple(decoded_targets),
        _strings(frame["primaryHosts"], "destinations primaryHosts"),
    )


def _arg(value: Any) -> WireArg:
    item = _strict(value, {"type", "value"}, "argument")
    tag = item.get("type")
    if tag not in WIRE_ARG_TYPES:
        raise FrameDecodeError(f"unsupported argument type tag: {tag!r}")
    if "value" not in item:
        raise FrameDecodeError("argument value is missing")
    arg_value = item["value"]
    if tag == "i" and (isinstance(arg_value, bool) or not isinstance(arg_value, int)):
        raise FrameDecodeError("integer argument value does not match tag i")
    if tag == "f" and (isinstance(arg_value, bool) or not isinstance(arg_value, (int, float))):
        raise FrameDecodeError("numeric argument value does not match tag f")
    if tag == "s" and not isinstance(arg_value, str):
        raise FrameDecodeError("string argument value does not match tag s")
    if tag == "b":
        if not isinstance(arg_value, str):
            raise FrameDecodeError("blob argument value does not match tag b")
        try:
            base64.b64decode(arg_value, validate=True)
        except (binascii.Error, ValueError) as error:
            raise FrameDecodeError("blob argument is not valid base64") from error
    return WireArg(tag, arg_value)


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
    if set(frame) - {"v", "type", "clientId", "protocolVersion", "server", "unity", "targets", "bridge", "heartbeat", "pingIntervalMs", "debug", "address", "args", "from", "t", "level", "code", "detail", "messages", "name", "revision", "at", "definition", "names", "active", "full", "values", "lists", "choices", "keys", "fieldChoices", "records", "sendPort", "scanning", "scannedAt", "devices", "broadcasts", "selection", "primaryHosts"}:
        raise FrameDecodeError("frame contains unknown key(s)")
    if frame.get("v") != WIRE_PROTOCOL_VERSION:
        raise FrameDecodeError("missing or mismatched protocol version")
    kind = frame.get("type")
    if not isinstance(kind, str) or kind not in KNOWN_DOWNSTREAM_TYPES:
        raise FrameDecodeError(f"unknown downstream frame type: {kind!r}")

    if kind == "osc":
        _strict(frame, {"v", "type", "address", "args", "from"}, "frame")
        if not isinstance(frame.get("address"), str) or not frame["address"].startswith("/"):
            raise FrameDecodeError("osc address must start with '/'")
        args = frame.get("args")
        if not isinstance(args, list):
            raise FrameDecodeError("osc args must be an array")
        source = _strict(frame.get("from"), {"host", "port"}, "from")
        if not isinstance(source.get("host"), str) or not isinstance(source.get("port"), int):
            raise FrameDecodeError("invalid osc source")
        return OscFrame("osc", 1, frame["address"], tuple(_arg(arg) for arg in args), Peer(source["host"], source["port"]))
    if kind == "heartbeat":
        _strict(frame, {"v", "type", "t"}, "frame")
        return HeartbeatFrame("heartbeat", 1, _number(frame.get("t"), "heartbeat timestamp"))
    if kind == "notice":
        _strict(frame, {"v", "type", "level", "code", "detail"}, "frame")
        if not all(isinstance(frame.get(key), str) for key in ("level", "code", "detail")):
            raise FrameDecodeError("invalid notice fields")
        return NoticeFrame("notice", 1, frame["level"], frame["code"], frame["detail"])
    if kind == "surface":
        _strict(frame, {"v", "type", "name", "revision", "at", "definition"}, "frame")
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
        # 不正な定義を含むフレームは bridge と同じく丸ごと拒否する(画面が壊れた定義で上書きされない)
        definition = _object(frame.get("definition"), "definition")
        try:
            validate_surface_definition(definition)
        except SurfaceDefinitionError as error:
            raise FrameDecodeError(f"invalid surface definition: {error}") from error
        return SurfaceFrame("surface", 1, _surface_name(frame.get("name"), "surface name"), revision, at, definition)
    if kind == "surfaceList":
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
    if kind == "desired":
        _strict(frame, {"v", "type", "full", "values"}, "frame")
        if not isinstance(frame.get("full"), bool):
            raise FrameDecodeError("desired full must be a boolean")
        values = frame.get("values")
        if not isinstance(values, list):
            raise FrameDecodeError("desired values must be an array")
        decoded_values = []
        for item in values:
            entry = _strict(item, {"address", "args"}, "desired value")
            address = entry.get("address")
            if not isinstance(address, str) or not address.startswith("/"):
                raise FrameDecodeError("desired address must start with '/'")
            args = entry.get("args")
            if not isinstance(args, list):
                raise FrameDecodeError("desired args must be an array")
            decoded_values.append(DesiredValue(address, tuple(_arg(arg) for arg in args)))
        return DesiredFrame("desired", 1, frame["full"], tuple(decoded_values))
    if kind == "runtimeOptions":
        _strict(frame, {"v", "type", "lists", "choices", "keys", "fieldChoices"}, "frame")
        lists = frame.get("lists")
        choices = frame.get("choices")
        if not isinstance(lists, list) or not isinstance(choices, list):
            raise FrameDecodeError("runtimeOptions lists and choices must be arrays")
        decoded_lists = []
        for item in lists:
            entry = _strict(item, {"address", "targets"}, "runtimeOptions list")
            address = entry.get("address")
            if not isinstance(address, str) or not address.startswith("/"):
                raise FrameDecodeError("runtimeOptions list address must start with '/'")
            targets = entry.get("targets")
            if not isinstance(targets, list):
                raise FrameDecodeError("runtimeOptions list targets must be an array")
            decoded_targets = []
            for target in targets:
                named = _strict(target, {"name", "options"}, "runtimeOptions target")
                if not isinstance(named.get("name"), str):
                    raise FrameDecodeError("runtimeOptions target name must be a string")
                decoded_targets.append((named["name"], _names(named.get("options"))))
            decoded_lists.append(RuntimeOptionList(address, tuple(decoded_targets)))
        decoded_choices = []
        for item in choices:
            entry = _strict(item, {"param", "options"}, "runtimeOptions choice")
            if not isinstance(entry.get("param"), str):
                raise FrameDecodeError("runtimeOptions choice param must be a string")
            decoded_choices.append((entry["param"], _names(entry.get("options"))))
        keys = frame.get("keys", [])
        field_choices = frame.get("fieldChoices", [])
        if not isinstance(keys, list) or not isinstance(field_choices, list):
            raise FrameDecodeError("runtimeOptions keys and fieldChoices must be arrays")
        decoded_keys = []
        for item in keys:
            entry = _strict(item, {"record", "keys"}, "runtimeOptions keys")
            if not isinstance(entry.get("record"), str):
                raise FrameDecodeError("runtimeOptions keys record must be a string")
            decoded_keys.append((entry["record"], _names(entry.get("keys"))))
        decoded_field_choices = []
        for item in field_choices:
            entry = _strict(item, {"record", "field", "options"}, "runtimeOptions field choice")
            if not isinstance(entry.get("record"), str) or not isinstance(entry.get("field"), str):
                raise FrameDecodeError("runtimeOptions field choice record and field must be strings")
            decoded_field_choices.append((entry["record"], entry["field"], _names(entry.get("options"))))
        return RuntimeOptionsFrame(
            "runtimeOptions",
            1,
            tuple(decoded_lists),
            tuple(decoded_choices),
            tuple(decoded_keys),
            tuple(decoded_field_choices),
        )
    if kind == "sentLog":
        _strict(frame, {"v", "type", "full", "records"}, "frame")
        if not isinstance(frame.get("full"), bool):
            raise FrameDecodeError("sentLog full must be a boolean")
        records = frame.get("records")
        if not isinstance(records, list) or len(records) > SENT_LOG_MAX_RECORDS_PER_FRAME:
            raise FrameDecodeError(f"sentLog records must be an array of at most {SENT_LOG_MAX_RECORDS_PER_FRAME}")
        return SentLogFrame("sentLog", 1, frame["full"], tuple(_sent_record(record) for record in records))
    if kind == "destinations":
        return _destinations(frame)
    if kind == "link":
        _strict(frame, {"v", "type", "unity", "targets"}, "frame")
        return LinkFrame("link", 1, _object(frame.get("unity"), "unity"), _targets(frame.get("targets")))
    _strict(frame, {"v", "type", "clientId", "protocolVersion", "server", "unity", "targets", "bridge", "heartbeat", "pingIntervalMs", "debug"}, "frame")
    if not isinstance(frame.get("clientId"), str):
        raise FrameDecodeError("hello clientId must be a string")
    # 欠落キーは KeyError でなく FrameDecodeError にする(KeyError は読取タスクを殺し、
    # 「不正フレームでも接続維持」の規約を破って再接続を誘発する)
    return HelloFrame("hello", 1, frame["clientId"], frame.get("protocolVersion"), _object(frame.get("server"), "server"), _object(frame.get("unity"), "unity"), _targets(frame.get("targets")), _object(frame.get("bridge"), "bridge"), _object(frame.get("heartbeat"), "heartbeat"), _number(frame.get("pingIntervalMs"), "pingIntervalMs"), frame.get("debug"))


def _wire_arg(arg: WireArg | tuple[str, Any] | dict[str, Any]) -> dict[str, Any]:
    if isinstance(arg, WireArg):
        return {"type": arg.type, "value": arg.value}
    if isinstance(arg, tuple) and len(arg) == 2:
        return {"type": arg[0], "value": arg[1]}
    if isinstance(arg, dict) and set(arg) == {"type", "value"}:
        return dict(arg)
    raise FrameDecodeError("invalid upstream argument")


def encode_osc_frame(address: str, args: Sequence[WireArg | tuple[str, Any] | dict[str, Any]]) -> str:
    if not isinstance(address, str) or not address.startswith("/"):
        raise ProtocolError("OSC address must start with '/'")
    payload = {"v": 1, "type": "osc", "address": address, "args": [_wire_arg(arg) for arg in args]}
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)



def encode_osc_batch_frame(messages: Sequence[OscMessage | dict[str, Any]]) -> str:
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
    return json.dumps({"v": 1, "type": "oscBatch", "messages": encoded_messages}, separators=(",", ":"), ensure_ascii=False)


def _osc_string_size(text: str) -> int:
    # OSC 1.0 の文字列は NUL 終端を含めて 4 バイト境界まで詰める(ちょうど割り切れても NUL の 4 バイトが要る)
    return (len(text.encode("utf-8")) // 4 + 1) * 4


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


def encode_resend(target: str | None = None) -> str:
    """保持値の再送要求。target を省くと全宛先(D-046)。"""
    payload: dict[str, Any] = {"v": 1, "type": "resend"}
    if target is not None:
        if not isinstance(target, str) or not target:
            raise ProtocolError("resend target must be a non-empty string")
        payload["target"] = target
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


def encode_runtime_options_refresh() -> str:
    """全宛先へ Unity の一覧を要求させる(「一覧を更新」。D-053)。"""
    return '{"v":1,"type":"runtimeOptionsRefresh"}'


def encode_destinations_scan() -> str:
    """宛先タブの「更新」。ブリッジに LAN を走査させる(D-078)。"""
    return '{"v":1,"type":"destinationsScan"}'


def encode_destinations_select(all_devices: bool, hosts: Sequence[str]) -> str:
    """宛先の選択(D-078)。all_devices の間も hosts は外したときに戻すために送る。"""
    if not isinstance(all_devices, bool):
        raise ProtocolError("allDevices must be a boolean")
    selected = list(hosts)
    if len(selected) > DESTINATIONS_MAX_SELECTED_HOSTS or not all(isinstance(host, str) and host for host in selected):
        raise ProtocolError(f"hosts must be at most {DESTINATIONS_MAX_SELECTED_HOSTS} non-empty strings")
    payload = {"v": 1, "type": "destinationsSelect", "allDevices": all_devices, "hosts": selected}
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


def encode_destinations_reset() -> str:
    """保存した選択を消して設定ファイルの宛先へ戻す(D-078)。"""
    return '{"v":1,"type":"destinationsReset"}'


def encode_record_key_add(record_id: str, key: str) -> str:
    """通常の画面からのレコードの行の追加(D-075)。空のキーは行として扱わないので送らない。"""
    return _record_key_frame("recordKeyAdd", record_id, key)


def encode_record_key_remove(record_id: str, key: str) -> str:
    """通常の画面からのレコードの行の削除(D-075)。"""
    return _record_key_frame("recordKeyRemove", record_id, key)


def _record_key_frame(frame_type: str, record_id: str, key: str) -> str:
    if not isinstance(record_id, str) or not record_id:
        raise ProtocolError("record id must be a non-empty string")
    if not isinstance(key, str) or not key:
        raise ProtocolError("record key must be a non-empty string")
    payload = {"v": 1, "type": frame_type, "record": record_id, "key": key}
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


def encode_surface_request() -> str:
    return '{"v":1,"type":"surfaceRequest"}'


def encode_surface_load(name: str) -> str:
    _surface_name(name, "surface name")
    return json.dumps({"v": 1, "type": "surfaceLoad", "name": name}, separators=(",", ":"))


def encode_surface_save(name: str, definition: dict[str, Any], *, activate: bool | None = None) -> str:
    _surface_name(name, "surface name")
    payload: dict[str, Any] = {"v": 1, "type": "surfaceSave", "name": name, "definition": _object(definition, "definition")}
    if activate is not None:
        payload["activate"] = activate
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


def encode_heartbeat_ack(timestamp: int | float) -> str:
    _number(timestamp, "heartbeat timestamp")
    return json.dumps({"v": 1, "type": "heartbeatAck", "t": timestamp}, separators=(",", ":"))


def encode_frame(frame: Any) -> str:
    if isinstance(frame, (UpstreamOscFrame, HeartbeatAckFrame)):
        data = {"v": frame.v, "type": frame.type}
        if frame.type == "osc":
            data.update({"address": frame.address, "args": [_wire_arg(arg) for arg in frame.args]})
        elif frame.type == "heartbeatAck":
            data["t"] = frame.t
        return json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    raise ProtocolError("encode_frame accepts an upstream frame value object")
