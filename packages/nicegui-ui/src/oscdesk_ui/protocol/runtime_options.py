"""Unity の一覧とレコードの行(runtimeOptions)のフレームと、一覧の要求・反映・行の追加・削除・改名の上り。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .common import DecodedFrame, FrameDecodeError, ProtocolError, _dumps, _string, _strict


@dataclass(frozen=True)
class RuntimeOptionList:
    """一覧 1 つ分(一覧の id で指す。HID-389)。targets は一覧を返した宛先だけ(名前 → 一覧、config の順)。"""

    list_id: str
    targets: tuple[tuple[str, tuple[str, ...]], ...]


@dataclass(frozen=True)
class PendingOptionList:
    """届いたが反映していない一覧(D-088)。出所(宛先、ブロードキャストの宛先では答えたホスト)ごと。

    added / removed は反映済みの一覧から見た名前の増減で、両方が空なら並びだけが違う。list_id は一覧の id。
    """

    list_id: str
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


def _names(value: Any) -> tuple[str, ...]:
    if not isinstance(value, list) or not all(isinstance(name, str) for name in value):
        raise FrameDecodeError("runtimeOptions options must be an array of strings")
    return tuple(value)


def _decode_runtime_options(frame: dict[str, Any]) -> RuntimeOptionsFrame:
    _strict(frame, {"v", "type", "lists", "choices", "keys", "fieldChoices", "pending"}, "frame")
    lists = frame.get("lists")
    choices = frame.get("choices")
    if not isinstance(lists, list) or not isinstance(choices, list):
        raise FrameDecodeError("runtimeOptions lists and choices must be arrays")
    decoded_lists = []
    for item in lists:
        entry = _strict(item, {"list", "targets"}, "runtimeOptions list")
        address = _string(entry.get("list"), "runtimeOptions list id", non_empty=True)
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
        entry = _strict(item, {"list", "target", "host", "added", "removed"}, "runtimeOptions pending")
        address = _string(entry.get("list"), "runtimeOptions pending list id", non_empty=True)
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


def encode_runtime_options_refresh(list_id: str | None = None) -> str:
    """全宛先へ Unity の一覧を要求させる(「一覧を更新」。D-053)。

    list_id(一覧の id)を渡すと、その一覧の要求だけを送らせる(一覧の近くの Sync。D-077)。どこへ要求を送るかは
    ブリッジが結び付けから決める(HID-389)。
    """
    payload: dict[str, Any] = {"v": 1, "type": "runtimeOptionsRefresh"}
    if list_id is not None:
        if not isinstance(list_id, str) or not list_id:
            raise ProtocolError("runtimeOptionsRefresh list must be a non-empty string")
        payload["list"] = list_id
    return _dumps(payload)


def encode_runtime_options_apply(list_id: str | None = None) -> str:
    """届いた一覧を反映させる(D-088)。list_id(一覧の id)を渡すとその一覧だけ、省くと全一覧。"""
    payload: dict[str, Any] = {"v": 1, "type": "runtimeOptionsApply"}
    if list_id is not None:
        if not isinstance(list_id, str) or not list_id:
            raise ProtocolError("runtimeOptionsApply list must be a non-empty string")
        payload["list"] = list_id
    return _dumps(payload)


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
