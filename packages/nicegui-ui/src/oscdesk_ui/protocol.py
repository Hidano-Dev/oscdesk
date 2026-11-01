"""OscDesk WebSocket wire protocol (version 1).

The wire representation is deliberately strict.  A frame that is not one of
the documented downstream frames is rejected instead of being guessed at.
"""

from __future__ import annotations

import base64
import binascii
import json
import math
import re
from datetime import datetime
from dataclasses import dataclass
from typing import Any, Final, Sequence

# utf16_length はパッドと宛先(別名)で数え方を揃えるため osc_pad の 1 つを使う(destinations_panel もここから import する)
from .osc_pad import collect_pad_issues, has_lone_surrogate, utf16_length
from .project_file import REQUEST_ID_MAX_CHARS, project_shape_issues
from .surface_definition import OSC_BATCH_MAX_MESSAGES, SurfaceDefinitionError, validate_surface_definition

WIRE_PROTOCOL_VERSION: Final = 1
KNOWN_DOWNSTREAM_TYPES: Final = frozenset(
    {
        "hello", "osc.message", "link", "heartbeat", "notice", "surface", "surfaceList", "desired", "runtimeOptions", "osc.sentLog",
        "osc.pad", "osc.padList", "destinations", "project", "desiredStatus", "catalog", "locks", "blueprintStatus",
    }
)
# bridge 側 (packages/shared/src/limits.ts) の DESTINATIONS.MAX_SELECTED_HOSTS と同じ上限
DESTINATIONS_MAX_SELECTED_HOSTS: Final = 256
# packages/shared の DESTINATIONS.MAX_SCAN_INTERFACES と同じ(ネットワークごとの全てのデバイスで選べる数。D-085)
DESTINATIONS_MAX_NETWORKS: Final = 4
# packages/shared の DESTINATIONS.MAX_ALIAS_CHARS と同じ(端末の別名の文字数。D-092)
DESTINATIONS_MAX_ALIAS_CHARS: Final = 64
# packages/shared の DESTINATIONS.MAX_ALIAS_INPUT_CHARS と同じ(destinationsAlias でフレームとして送れる長さ)
DESTINATIONS_MAX_ALIAS_INPUT_CHARS: Final = 256
# 送信ログ(D-067)の契機。bridge 側 (packages/shared/src/wire.ts) の SENT_LOG_ORIGINS と同じ
# 操作中のロック(HID-378)。packages/shared/src/wire.ts の LOCK と同じ値
LOCK_LEASE_S: Final = 2.0
LOCK_MAX_HOLDER_CHARS: Final = 64
LOCK_MAX_LABEL_CHARS: Final = 64
SENT_LOG_ORIGINS: Final = frozenset({"ui", "action", "resend", "row", "request", "relay", "pad"})
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
    # ブリッジが持つ通信アダプタ(HID-373)。osc があるときだけ OSC 専用の機能(OSC パッド・送信ログ)を出す
    adapters: tuple[str, ...] = ("osc",)


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
class PadFrame(DecodedFrame):
    """採用中の OSC パッド(D-080)。pad は検証済みの生の dict。"""

    name: str = ""
    revision: int = 0
    at: str = ""
    pad: dict[str, Any] | None = None
    # 採用ごとに一意な版の印(起動ごとのエポック + revision)。押下に載せ、ブリッジが照合する
    version: str = ""


@dataclass(frozen=True)
class PadListFrame(DecodedFrame):
    names: tuple[str, ...] = ()
    active: str | None = None


@dataclass(frozen=True)
class ProjectFrame(DecodedFrame):
    """書き出したプロジェクトファイル(D-090)。project は形だけを確かめた生の dict(中身の検証はブリッジが済ませている)。"""

    request_id: str = ""
    project: dict[str, Any] | None = None


@dataclass(frozen=True)
class DesiredStatusFrame(DecodedFrame):
    """保持値をまだ Unity へ送っていないか(D-090)。since は取り込んだ時刻で、unsent の間だけ入る。"""

    unsent: bool = False
    since: str | None = None


@dataclass(frozen=True)
class LockEntry:
    """操作中のロック 1 件(HID-378)。ref は ("param", id) か ("record", id, key)。"""

    ref: tuple[str, ...]
    client_id: str
    holder: str
    label: str


@dataclass(frozen=True)
class LocksFrame(DecodedFrame):
    """操作中のロックの全量(HID-378)。UI は丸ごと置き換える。"""

    locks: tuple[LockEntry, ...] = ()


def lock_ref(param: str | None = None, *, record: str | None = None, key: str | None = None) -> tuple[str, ...]:
    """ロックの単位の印(HID-378)。パラメータは ("param", id)、Record の行は ("record", id, key)。"""
    if param is not None:
        return ("param", param)
    if record is None or key is None:
        raise ProtocolError("a lock ref is a parameter or a record row")
    return ("record", record, key)


def _lock_ref_payload(ref: tuple[str, ...]) -> dict[str, str]:
    if len(ref) == 2 and ref[0] == "param" and ref[1]:
        return {"param": ref[1]}
    if len(ref) == 3 and ref[0] == "record" and ref[1] and ref[2]:
        return {"record": ref[1], "key": ref[2]}
    raise ProtocolError("invalid lock ref")


def _decode_lock_ref(value: Any) -> tuple[str, ...]:
    if isinstance(value, dict) and set(value) == {"param"} and isinstance(value["param"], str) and value["param"]:
        return ("param", value["param"])
    if (
        isinstance(value, dict) and set(value) == {"record", "key"}
        and all(isinstance(value[name], str) and value[name] for name in ("record", "key"))
    ):
        return ("record", value["record"], value["key"])
    raise FrameDecodeError("lock ref must be {param} or {record, key}")


def _decode_lock(value: Any) -> LockEntry:
    if not isinstance(value, dict) or set(value) != {"ref", "clientId", "holder", "label"}:
        raise FrameDecodeError("lock must have exactly ref, clientId, holder and label")
    if not isinstance(value["clientId"], str) or not isinstance(value["label"], str):
        raise FrameDecodeError("lock clientId and label must be strings")
    holder = value["holder"]
    if not isinstance(holder, str) or not 1 <= len(holder) <= LOCK_MAX_HOLDER_CHARS or len(value["label"]) > LOCK_MAX_LABEL_CHARS:
        raise FrameDecodeError("lock holder or label is out of range")
    return LockEntry(_decode_lock_ref(value["ref"]), value["clientId"], holder, value["label"])


@dataclass(frozen=True)
class BlueprintStatusFrame(DecodedFrame):
    """採用中の画面と設計図の突き合わせ(HID-386)。pc は設計図から作った画面の取得元(無ければ None)。"""

    pc: dict[str, str] | None = None
    absent: tuple[str, ...] = ()


@dataclass(frozen=True)
class CatalogFrame(DecodedFrame):
    """ターゲットから受けた設計図(D-104)。PC ごとの全量で、UI は丸ごと置き換える。pcs は形だけを確かめた生の dict の並び。"""

    pcs: tuple[dict[str, Any], ...] = ()


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
class PendingOptionList:
    """届いたが反映していない一覧(D-088)。出所(宛先、ブロードキャストの宛先では答えたホスト)ごと。

    added / removed は反映済みの一覧から見た名前の増減で、両方が空なら並びだけが違う。
    """

    address: str
    target: str
    host: str | None
    added: tuple[str, ...]
    removed: tuple[str, ...]


@dataclass(frozen=True)
class RuntimeOptionsFrame(DecodedFrame):
    """Unity が実行時に持つ文字列の一覧(D-053)。毎回全量で、choices はパラメータ id → 選択肢。"""

    lists: tuple[RuntimeOptionList, ...] = ()
    choices: tuple[tuple[str, tuple[str, ...]], ...] = ()
    # レコード(D-061)。keys はレコード id → キーの一覧、field_choices は (レコード id, フィールド id) → 選択肢。
    # 旧いブリッジは送らないので、欄が無ければ空として扱う
    keys: tuple[tuple[str, tuple[str, ...]], ...] = ()
    field_choices: tuple[tuple[str, str, tuple[str, ...]], ...] = ()
    # UI で管理する行(D-087)の Name。レコード id → (行の ID, Name) の並び。keys に names が付いたレコードだけ
    key_names: tuple[tuple[str, tuple[tuple[str, str], ...]], ...] = ()
    # 反映待ちの一覧(D-088)。旧いブリッジは送らないので、欄が無ければ空として扱う
    pending: tuple[PendingOptionList, ...] = ()


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
    """宛先タブの一覧の 1 台(D-078)。found は直近の走査で見つかったか、is_self はこの PC(ブリッジの PC)か。

    hostname はブリッジが引けた端末の名前(この PC は OS のホスト名)。引けなければ None(D-085)。
    alias は UI から付けた別名(ブリッジが MAC か host で覚えたもの)。無ければ None(D-092)。
    """

    host: str
    hostname: str | None
    mac: str | None
    interface: str | None
    is_self: bool
    configured: bool
    found: bool
    alias: str | None = None


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
    """宛先タブ(D-078)。毎回全量で、UI は丸ごと置き換える。

    source は config(選択なし。設定ファイルの宛先)/ saved(保存した選択)/ unsaved(選択は効いているがファイルへ書けなかった)。
    networks はネットワークごとの「全てのデバイス」で選んだネットワーク(broadcasts の network。D-085)。
    """

    send_port: int = 0
    scanning: bool = False
    scanned_at: str | None = None
    devices: tuple[DestinationDevice, ...] = ()
    broadcasts: tuple[DestinationBroadcast, ...] = ()
    source: str = "config"
    all_devices: bool = False
    networks: tuple[str, ...] = ()
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
    type: Final[str] = "osc.message"
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


def _request_id(value: Any) -> str:
    # packages/shared の ProjectRequestIdSchema と同じ(1〜64 文字の文字列)
    if not isinstance(value, str) or not 1 <= len(value) <= REQUEST_ID_MAX_CHARS:
        raise FrameDecodeError(f"project requestId must be a string of 1 to {REQUEST_ID_MAX_CHARS} characters")
    return value


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
        device_keys = {"host", "hostname", "alias", "mac", "interface", "self", "configured", "found"}
        device = _strict(item, device_keys, "destinations device")
        if set(device) != device_keys:
            raise FrameDecodeError("destinations device is missing a key")
        hostname = _string(device["hostname"], "device hostname", nullable=True)
        if hostname == "" or (hostname is not None and len(hostname) > 253):
            raise FrameDecodeError("device hostname must be 1-253 characters or null")
        alias = _string(device["alias"], "device alias", nullable=True)
        if alias == "" or (alias is not None and utf16_length(alias) > DESTINATIONS_MAX_ALIAS_CHARS):
            raise FrameDecodeError(f"device alias must be 1-{DESTINATIONS_MAX_ALIAS_CHARS} characters or null")
        # 孤立サロゲートを含む名前は表示の名前として使わない(無いものとして IP を見せる)。NiceGUI の orjson が描画で
        # 符号化に失敗し、その端末が一覧にある限りページの更新が止まる。フレームごと捨てると宛先一覧を受け取れなくなる
        if hostname is not None and has_lone_surrogate(hostname):
            hostname = None
        if alias is not None and has_lone_surrogate(alias):
            alias = None
        decoded_devices.append(DestinationDevice(
            _string(device["host"], "device host", non_empty=True),
            hostname,
            _string(device["mac"], "device mac", nullable=True),
            _string(device["interface"], "device interface", nullable=True),
            _bool(device["self"], "device self"),
            _bool(device["configured"], "device configured"),
            _bool(device["found"], "device found"),
            alias,
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
    selection_keys = {"source", "allDevices", "networks", "hosts"}
    selection = _strict(frame["selection"], selection_keys, "destinations selection")
    if set(selection) != selection_keys:
        raise FrameDecodeError("destinations selection is missing a key")
    if selection.get("source") not in ("config", "saved", "unsaved"):
        raise FrameDecodeError("destinations selection source must be config, saved or unsaved")
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
        _strings(selection.get("networks"), "selection networks"),
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
    if set(frame) - {"v", "type", "clientId", "protocolVersion", "server", "unity", "targets", "bridge", "heartbeat", "pingIntervalMs", "debug", "adapters", "address", "args", "from", "t", "level", "code", "detail", "messages", "name", "revision", "at", "definition", "names", "active", "full", "values", "lists", "choices", "keys", "fieldChoices", "pending", "records", "pad", "version", "sendPort", "scanning", "scannedAt", "devices", "broadcasts", "selection", "primaryHosts", "requestId", "project", "unsent", "since", "pcs", "locks", "pc", "absent"}:
        raise FrameDecodeError("frame contains unknown key(s)")
    if frame.get("v") != WIRE_PROTOCOL_VERSION:
        raise FrameDecodeError("missing or mismatched protocol version")
    kind = frame.get("type")
    if not isinstance(kind, str) or kind not in KNOWN_DOWNSTREAM_TYPES:
        raise FrameDecodeError(f"unknown downstream frame type: {kind!r}")

    if kind == "osc.message":
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
        _strict(frame, {"v", "type", "lists", "choices", "keys", "fieldChoices", "pending"}, "frame")
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
        decoded_key_names = []
        for item in keys:
            entry = _strict(item, {"record", "keys", "names"}, "runtimeOptions keys")
            if not isinstance(entry.get("record"), str):
                raise FrameDecodeError("runtimeOptions keys record must be a string")
            record_keys = _names(entry.get("keys"))
            decoded_keys.append((entry["record"], record_keys))
            if "names" in entry:
                record_names = _names(entry.get("names"))
                if len(record_names) != len(record_keys):
                    raise FrameDecodeError("runtimeOptions keys names must have the same length as keys")
                decoded_key_names.append((entry["record"], tuple(zip(record_keys, record_names))))
        decoded_field_choices = []
        for item in field_choices:
            entry = _strict(item, {"record", "field", "options"}, "runtimeOptions field choice")
            if not isinstance(entry.get("record"), str) or not isinstance(entry.get("field"), str):
                raise FrameDecodeError("runtimeOptions field choice record and field must be strings")
            decoded_field_choices.append((entry["record"], entry["field"], _names(entry.get("options"))))
        pending = frame.get("pending", [])
        if not isinstance(pending, list):
            raise FrameDecodeError("runtimeOptions pending must be an array")
        decoded_pending = []
        for item in pending:
            entry = _strict(item, {"address", "target", "host", "added", "removed"}, "runtimeOptions pending")
            address = entry.get("address")
            if not isinstance(address, str) or not address.startswith("/"):
                raise FrameDecodeError("runtimeOptions pending address must start with '/'")
            if not isinstance(entry.get("target"), str):
                raise FrameDecodeError("runtimeOptions pending target must be a string")
            host = entry.get("host")
            if host is not None and not isinstance(host, str):
                raise FrameDecodeError("runtimeOptions pending host must be a string")
            if "added" not in entry or "removed" not in entry:
                raise FrameDecodeError("runtimeOptions pending must have added and removed")
            decoded_pending.append(
                PendingOptionList(address, entry["target"], host, _names(entry["added"]), _names(entry["removed"]))
            )
        return RuntimeOptionsFrame(
            "runtimeOptions",
            1,
            tuple(decoded_lists),
            tuple(decoded_choices),
            tuple(decoded_keys),
            tuple(decoded_field_choices),
            tuple(decoded_key_names),
            tuple(decoded_pending),
        )
    if kind == "osc.sentLog":
        _strict(frame, {"v", "type", "full", "records"}, "frame")
        if not isinstance(frame.get("full"), bool):
            raise FrameDecodeError("sentLog full must be a boolean")
        records = frame.get("records")
        if not isinstance(records, list) or len(records) > SENT_LOG_MAX_RECORDS_PER_FRAME:
            raise FrameDecodeError(f"sentLog records must be an array of at most {SENT_LOG_MAX_RECORDS_PER_FRAME}")
        return SentLogFrame("osc.sentLog", 1, frame["full"], tuple(_sent_record(record) for record in records))
    if kind == "destinations":
        return _destinations(frame)
    if kind == "osc.pad":
        _strict(frame, {"v", "type", "name", "revision", "version", "at", "pad"}, "frame")
        # 不正なパッドを含むフレームはブリッジと同じく丸ごと拒否する(押せないボタンや予約アドレスを画面に出さない)
        pad = _object(frame.get("pad"), "pad")
        issues = collect_pad_issues(pad)
        if issues:
            raise FrameDecodeError(f"invalid pad: {'; '.join(issues[:3])}")
        return PadFrame(
            "osc.pad", 1,
            _surface_name(frame.get("name"), "pad name"),
            _int_at_least(frame.get("revision"), 1, "pad revision"),
            _iso_datetime(frame.get("at"), "pad at"),
            pad,
            _pad_version(frame.get("version")),
        )
    if kind == "osc.padList":
        _strict(frame, {"v", "type", "names", "active"}, "frame")
        names = frame.get("names")
        if not isinstance(names, list):
            raise FrameDecodeError("padList names must be an array")
        active = frame.get("active")
        return PadListFrame(
            "osc.padList", 1,
            tuple(_surface_name(name, "padList name") for name in names),
            None if active is None else _surface_name(active, "padList active"),
        )
    if kind == "project":
        _strict(frame, {"v", "type", "requestId", "project"}, "frame")
        project = _object(frame.get("project"), "project")
        issues = project_shape_issues(project)
        if issues:
            raise FrameDecodeError(f"invalid project: {'; '.join(issues[:3])}")
        return ProjectFrame("project", 1, _request_id(frame.get("requestId")), project)
    if kind == "blueprintStatus":
        _strict(frame, {"v", "type", "pc", "absent"}, "frame")
        pc = frame.get("pc")
        if pc is not None and not (
            isinstance(pc, dict) and set(pc) == {"host", "name"} and all(isinstance(pc[name], str) for name in ("host", "name"))
        ):
            raise FrameDecodeError("blueprintStatus pc must be null or {host, name}")
        absent = frame.get("absent")
        if not isinstance(absent, list) or not all(isinstance(param, str) for param in absent):
            raise FrameDecodeError("blueprintStatus absent must be an array of strings")
        return BlueprintStatusFrame("blueprintStatus", 1, None if pc is None else dict(pc), tuple(absent))
    if kind == "locks":
        _strict(frame, {"v", "type", "locks"}, "frame")
        locks = frame.get("locks")
        if not isinstance(locks, list):
            raise FrameDecodeError("locks must be an array")
        return LocksFrame("locks", 1, tuple(_decode_lock(entry) for entry in locks))
    if kind == "catalog":
        _strict(frame, {"v", "type", "pcs"}, "frame")
        pcs = frame.get("pcs")
        if not isinstance(pcs, list):
            raise FrameDecodeError("catalog pcs must be an array")
        return CatalogFrame("catalog", 1, tuple(_catalog_pc(pc) for pc in pcs))
    if kind == "desiredStatus":
        _strict(frame, {"v", "type", "unsent", "since"}, "frame")
        if "since" not in frame:
            raise FrameDecodeError("desiredStatus since is required")
        unsent = _bool(frame.get("unsent"), "desiredStatus unsent")
        since = frame.get("since")
        if unsent != (since is not None):
            raise FrameDecodeError("desiredStatus since must be set exactly while unsent")
        return DesiredStatusFrame("desiredStatus", 1, unsent, None if since is None else _iso_datetime(since, "desiredStatus since"))
    if kind == "link":
        _strict(frame, {"v", "type", "unity", "targets"}, "frame")
        return LinkFrame("link", 1, _object(frame.get("unity"), "unity"), _targets(frame.get("targets")))
    _strict(frame, {"v", "type", "clientId", "protocolVersion", "server", "unity", "targets", "bridge", "heartbeat", "pingIntervalMs", "debug", "adapters"}, "frame")
    if not isinstance(frame.get("clientId"), str):
        raise FrameDecodeError("hello clientId must be a string")
    # 欠落キーは KeyError でなく FrameDecodeError にする(KeyError は読取タスクを殺し、
    # 「不正フレームでも接続維持」の規約を破って再接続を誘発する)
    return HelloFrame("hello", 1, frame["clientId"], frame.get("protocolVersion"), _object(frame.get("server"), "server"), _object(frame.get("unity"), "unity"), _targets(frame.get("targets")), _object(frame.get("bridge"), "bridge"), _object(frame.get("heartbeat"), "heartbeat"), _number(frame.get("pingIntervalMs"), "pingIntervalMs"), frame.get("debug"), _adapters(frame.get("adapters")))


def _adapters(value: Any) -> tuple[str, ...]:
    """hello の通信アダプタ(HID-373)。知らない種類は読み飛ばさず保持し、画面側が知っているものだけを使う。"""
    if not isinstance(value, list) or not value or not all(isinstance(kind, str) and kind for kind in value):
        raise FrameDecodeError("hello adapters must be a non-empty array of strings")
    return tuple(value)


def _catalog_pc(value: Any) -> dict[str, Any]:
    pc = _strict(value, {"host", "name", "receivedAt", "verified", "items"}, "catalog pc")
    _string(pc.get("host"), "catalog host", non_empty=True)
    _string(pc.get("name"), "catalog name", non_empty=True)
    _iso_datetime(pc.get("receivedAt"), "catalog receivedAt")
    if pc.get("verified") is not None:
        _bool(pc.get("verified"), "catalog verified")
    items = pc.get("items")
    if not isinstance(items, list):
        raise FrameDecodeError("catalog items must be an array")
    for item in items:
        item = _strict(item, {"address", "kind", "type", "props"}, "catalog item")
        address = item.get("address")
        if not isinstance(address, str) or not address.startswith("/"):
            raise FrameDecodeError("catalog item address must start with '/'")
        _string(item.get("kind"), "catalog item kind", non_empty=True)
        _string(item.get("type"), "catalog item type", non_empty=True)
        props = item.get("props")
        if not isinstance(props, list):
            raise FrameDecodeError("catalog item props must be an array")
        for prop in props:
            prop = _strict(prop, {"key", "arg"}, "catalog prop")
            _string(prop.get("key"), "catalog prop key", non_empty=True)
            arg = _strict(prop.get("arg"), {"type", "value"}, "catalog prop arg")
            if arg.get("type") not in ("i", "f", "s"):
                raise FrameDecodeError("catalog prop value must be i, f or s")
            if arg["type"] == "s":
                _string(arg.get("value"), "catalog prop value")
            else:
                _number(arg.get("value"), "catalog prop value")
    return pc


def _dumps(payload: dict[str, Any]) -> str:
    """上りフレームの JSON。非 ASCII は \\uXXXX のエスケープにする。

    ensure_ascii=False だと、孤立サロゲート(JS では正しい文字列で、ブリッジが配ったパッドのラベルなどに入りうる)が
    そのまま残り、WebSocket の text 送信で UTF-8 にできずに例外になってリンクごと切れる。エスケープなら JSON として
    正しく、ブリッジ(JSON.parse)も同じ文字列に戻す。
    """
    return json.dumps(payload, separators=(",", ":"))


def _wire_arg(arg: WireArg | tuple[str, Any] | dict[str, Any]) -> dict[str, Any]:
    if isinstance(arg, WireArg):
        return {"type": arg.type, "value": arg.value}
    if isinstance(arg, tuple) and len(arg) == 2:
        return {"type": arg[0], "value": arg[1]}
    if isinstance(arg, dict) and set(arg) == {"type", "value"}:
        return dict(arg)
    raise FrameDecodeError("invalid upstream argument")


def encode_osc_frame(address: str, args: Sequence[WireArg | tuple[str, Any] | dict[str, Any]], *, holder: str | None = None) -> str:
    if not isinstance(address, str) or not address.startswith("/"):
        raise ProtocolError("OSC address must start with '/'")
    payload: dict[str, Any] = {"v": 1, "type": "osc.message", "address": address, "args": [_wire_arg(arg) for arg in args]}
    if holder is not None:
        payload["holder"] = _holder(holder)
    return _dumps(payload)


def _holder(holder: str) -> str:
    if not isinstance(holder, str) or not 1 <= len(holder) <= LOCK_MAX_HOLDER_CHARS:
        raise ProtocolError(f"lock holder must be a string of 1 to {LOCK_MAX_HOLDER_CHARS} characters")
    return holder


def encode_lock(ref: tuple[str, ...], holder: str, label: str) -> str:
    """操作中のロックの取得・延長(HID-378)。操作が続く間は送り直して期限を延ばす。"""
    return _dumps({"v": 1, "type": "lock", "ref": _lock_ref_payload(ref), "holder": _holder(holder), "label": label[:LOCK_MAX_LABEL_CHARS]})


def encode_unlock(ref: tuple[str, ...], holder: str) -> str:
    """操作の終わり(HID-378)。"""
    return _dumps({"v": 1, "type": "unlock", "ref": _lock_ref_payload(ref), "holder": _holder(holder)})


def encode_set(param: str, value: Any = None, *, has_value: bool = True, holder: str | None = None, revision: int | None = None) -> str:
    """パラメータの値の変更(HID-373)。型タグを付けず JSON の値のまま送り、アドレスと型への直し方はブリッジに任せる。

    has_value が False なら value を省く(trigger は定義の value を送る)。holder は操作したページ(HID-378)。
    """
    if not isinstance(param, str) or not param:
        raise ProtocolError("set param must be a non-empty string")
    payload: dict[str, Any] = {"v": 1, "type": "set", "param": param}
    if holder is not None:
        payload["holder"] = _holder(holder)
    if revision is not None:
        # 操作した画面が描いた定義の版。違えばブリッジが断る(旧画面の操作を新しい定義の別のアドレスへ送らない)
        if not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
            raise ProtocolError("set revision must be a positive integer")
        payload["revision"] = revision
    if has_value:
        if isinstance(value, float) and not math.isfinite(value):
            raise ProtocolError("set value must be finite")
        if not isinstance(value, (bool, int, float, str)):
            raise ProtocolError("set value must be a number, string or boolean")
        payload["value"] = value
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


def encode_resend(target: str | None = None) -> str:
    """保持値の再送要求。target を省くと全宛先(D-046)。"""
    payload: dict[str, Any] = {"v": 1, "type": "resend"}
    if target is not None:
        if not isinstance(target, str) or not target:
            raise ProtocolError("resend target must be a non-empty string")
        payload["target"] = target
    return _dumps(payload)


def encode_runtime_options_refresh(request: str | None = None) -> str:
    """全宛先へ Unity の一覧を要求させる(「一覧を更新」。D-053)。

    request を渡すと、その要求アドレスだけを送らせる(一覧の近くの Sync。D-077)。
    """
    payload: dict[str, Any] = {"v": 1, "type": "runtimeOptionsRefresh"}
    if request is not None:
        if not isinstance(request, str) or not request.startswith("/"):
            raise ProtocolError("runtimeOptionsRefresh request must be an address starting with /")
        payload["request"] = request
    return _dumps(payload)


def encode_runtime_options_apply(address: str | None = None) -> str:
    """届いた一覧を反映させる(D-088)。address(一覧のアドレス)を渡すとその一覧だけ、省くと全一覧。"""
    payload: dict[str, Any] = {"v": 1, "type": "runtimeOptionsApply"}
    if address is not None:
        if not isinstance(address, str) or not address.startswith("/"):
            raise ProtocolError("runtimeOptionsApply address must be an address starting with /")
        payload["address"] = address
    return _dumps(payload)


def encode_destinations_scan() -> str:
    """宛先タブの「更新」。ブリッジに LAN を走査させる(D-078)。"""
    return _dumps({"v": 1, "type": "destinationsScan"})


def encode_destinations_select(all_devices: bool, networks: Sequence[str], hosts: Sequence[str]) -> str:
    """宛先の選択(D-078 / D-085)。all_devices の間も networks と hosts は外したときに戻すために送る。"""
    if not isinstance(all_devices, bool):
        raise ProtocolError("allDevices must be a boolean")
    chosen = list(networks)
    if len(chosen) > DESTINATIONS_MAX_NETWORKS or not all(isinstance(network, str) and 0 < len(network) <= 18 for network in chosen):
        raise ProtocolError(f"networks must be at most {DESTINATIONS_MAX_NETWORKS} CIDR strings")
    selected = list(hosts)
    if len(selected) > DESTINATIONS_MAX_SELECTED_HOSTS or not all(isinstance(host, str) and host for host in selected):
        raise ProtocolError(f"hosts must be at most {DESTINATIONS_MAX_SELECTED_HOSTS} non-empty strings")
    return _dumps({"v": 1, "type": "destinationsSelect", "allDevices": all_devices, "networks": chosen, "hosts": selected})


def encode_catalog_request() -> str:
    """ターゲットに設計図を送り直させる(Sync。D-104)。ブリッジが全宛先へ /sys/catalog/request を送る。"""
    return _dumps({"v": 1, "type": "catalogRequest"})


def encode_catalog_adopt(host: str) -> str:
    """その PC の設計図から既定の画面を作って採用させる(HID-386)。画面を作るのはブリッジ。"""
    if not isinstance(host, str) or not 1 <= len(host) <= 253:
        raise ProtocolError("catalogAdopt host must be a string of 1 to 253 characters")
    return _dumps({"v": 1, "type": "catalogAdopt", "host": host})


def encode_destinations_reset() -> str:
    """保存した選択を消して設定ファイルの宛先へ戻す(D-078)。"""
    return _dumps({"v": 1, "type": "destinationsReset"})


def encode_destinations_alias(host: str, alias: str | None) -> str:
    """端末の別名を付ける・消す(D-092)。alias が None なら消す。MAC か host のどちらで覚えるかはブリッジが決める。"""
    if not isinstance(host, str) or not 0 < len(host) <= 253:
        raise ProtocolError("host must be 1-253 characters")
    # フレームとして送れる長さ(別名の上限より広い。上限の判定はブリッジが理由つきで返す)。UTF-16 の単位で数える
    if alias is not None and (not isinstance(alias, str) or utf16_length(alias) > DESTINATIONS_MAX_ALIAS_INPUT_CHARS):
        raise ProtocolError(f"alias must be at most {DESTINATIONS_MAX_ALIAS_INPUT_CHARS} UTF-16 code units or None")
    return _dumps({"v": 1, "type": "destinationsAlias", "host": host, "alias": alias})


def encode_record_key_add(record_id: str, key: str) -> str:
    """通常の画面からのレコードの行の追加(D-075)。空のキーは行として扱わないので送らない。"""
    return _record_key_frame("recordKeyAdd", record_id, key)


def encode_record_key_remove(record_id: str, key: str) -> str:
    """通常の画面からのレコードの行の削除(D-075)。UI で管理する行では key は行の ID(D-087)。"""
    return _record_key_frame("recordKeyRemove", record_id, key)


def encode_record_key_rename(record_id: str, key: str, name: str) -> str:
    """UI で管理する行の Name の変更(D-087)。key は行の ID で、空の Name は送らない。"""
    if not isinstance(name, str) or not name:
        raise ProtocolError("record row name must be a non-empty string")
    return _record_key_frame("recordKeyRename", record_id, key, name=name)


def _record_key_frame(frame_type: str, record_id: str, key: str, **extra: str) -> str:
    if not isinstance(record_id, str) or not record_id:
        raise ProtocolError("record id must be a non-empty string")
    if not isinstance(key, str) or not key:
        raise ProtocolError("record key must be a non-empty string")
    payload = {"v": 1, "type": frame_type, "record": record_id, "key": key, **extra}
    return _dumps(payload)


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
    return _dumps(payload)


def encode_pad_request() -> str:
    """採用中の OSC パッドと保存済みの一覧を求める(D-080)。"""
    return '{"v":1,"type":"osc.padRequest"}'


def encode_pad_load(name: str) -> str:
    _surface_name(name, "pad name")
    return json.dumps({"v": 1, "type": "osc.padLoad", "name": name}, separators=(",", ":"))


def encode_pad_save(name: str, pad: dict[str, Any]) -> str:
    """パッドの保存と採用。中身はブリッジが検証して、不正なら pad-rejected で理由を返す。"""
    _surface_name(name, "pad name")
    payload = {"v": 1, "type": "osc.padSave", "name": name, "pad": _object(pad, "pad")}
    return _dumps(payload)


def _pad_version(value: Any) -> str:
    # packages/shared の PadVersionSchema と同じ(1〜64 文字の文字列)
    if not isinstance(value, str) or not 1 <= len(value) <= 64:
        raise FrameDecodeError("pad version must be a string of 1 to 64 characters")
    return value


def encode_pad_press(name: str, version: str, button_id: str) -> str:
    """押下。アドレスと引数は送らず、ブリッジが採用中のパッドから引く(D-080)。

    version は表示中のパッドの pad フレームの version。同じ名前で上書き保存された後や、ブリッジの再起動の前に
    描いた古い表示からの押下を、ブリッジが版の食い違いで断れるように必ず載せる。
    """
    _surface_name(name, "pad name")
    _pad_version(version)
    if not isinstance(button_id, str) or not button_id:
        raise ProtocolError("pad button id must be a non-empty string")
    payload = {"v": 1, "type": "osc.padPress", "name": name, "version": version, "button": button_id}
    return _dumps(payload)


def encode_project_export(request_id: str) -> str:
    """採用中の定義・保持値・パッドをまとめて返させる(D-090)。応答の project はこの request_id を持つ。"""
    try:
        _request_id(request_id)
    except FrameDecodeError as error:
        raise ProtocolError(str(error)) from error
    return _dumps({"v": 1, "type": "projectExport", "requestId": request_id})


def encode_project_import(project: dict[str, Any]) -> str:
    """プロジェクトの取り込み(D-090)。中身はブリッジが検証して、不正なら project-import-rejected で理由を返す。"""
    return _dumps({"v": 1, "type": "projectImport", "project": _object(project, "project")})


def encode_heartbeat_ack(timestamp: int | float) -> str:
    _number(timestamp, "heartbeat timestamp")
    return json.dumps({"v": 1, "type": "heartbeatAck", "t": timestamp}, separators=(",", ":"))


def encode_frame(frame: Any) -> str:
    if isinstance(frame, (UpstreamOscFrame, HeartbeatAckFrame)):
        data = {"v": frame.v, "type": frame.type}
        if frame.type == "osc.message":
            data.update({"address": frame.address, "args": [_wire_arg(arg) for arg in frame.args]})
        elif frame.type == "heartbeatAck":
            data["t"] = frame.t
        return _dumps(data)
    raise ProtocolError("encode_frame accepts an upstream frame value object")
