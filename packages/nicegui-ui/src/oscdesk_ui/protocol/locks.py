"""操作中のロック(HID-378)の locks フレームと lock / unlock の上り。上りに載せる holder の検査もここに置く。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Final

from .common import DecodedFrame, FrameDecodeError, ProtocolError, _dumps, _strict


# 操作中のロック(HID-378)。packages/shared/src/wire.ts の LOCK と同じ値
LOCK_LEASE_S: Final = 2.0
LOCK_MAX_HOLDER_CHARS: Final = 64
LOCK_MAX_LABEL_CHARS: Final = 64


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


def _decode_locks(frame: dict[str, Any]) -> LocksFrame:
    _strict(frame, {"v", "type", "locks"}, "frame")
    locks = frame.get("locks")
    if not isinstance(locks, list):
        raise FrameDecodeError("locks must be an array")
    return LocksFrame("locks", 1, tuple(_decode_lock(entry) for entry in locks))


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
