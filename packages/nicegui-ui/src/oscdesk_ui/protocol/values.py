"""値のフレーム(desired・echo・desiredStatus)と、値を送る上り(set・setRow・batch・resend・reconcile)。

値はパラメータ ID と型タグを付けない JSON の値で書く(HID-389)。
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Sequence

from ..surface_definition import OSC_BATCH_MAX_MESSAGES
from .common import (
    DecodedFrame,
    FrameDecodeError,
    ProtocolError,
    _bool,
    _dumps,
    _is_composite_value,
    _is_identifier,
    _is_param_value,
    _iso_datetime,
    _object,
    _string,
    _strict,
    has_lone_surrogate,
)
from .locks import _holder


@dataclass(frozen=True)
class DesiredStatusFrame(DecodedFrame):
    """保持値をまだ Unity へ送っていないか(D-090)。since は取り込んだ時刻で、unsent の間だけ入る。"""

    unsent: bool = False
    since: str | None = None


@dataclass(frozen=True)
class DesiredValue:
    """パラメータ 1 つの値(HID-389)。value は型タグを付けない JSON の値。エコーでは読めなかったとき has_value が False。"""

    param: str
    value: Any = None
    has_value: bool = True


@dataclass(frozen=True)
class DesiredRow:
    """Record の 1 行の値(HID-389)。key は行のキー(UI で管理する行では ID)、values はフィールド id → 値。"""

    record: str
    key: str
    values: dict[str, Any]


@dataclass(frozen=True)
class DesiredFrame(DecodedFrame):
    full: bool = False
    values: tuple[DesiredValue, ...] = ()
    rows: tuple[DesiredRow, ...] = ()


@dataclass(frozen=True)
class EchoFrame(DecodedFrame):
    """主系のターゲットが返したエコー(HID-389)。届いた確認で、表示とまとめ送りの到着の確認に使う(保持値は変えない)。"""

    values: tuple[DesiredValue, ...] = ()
    rows: tuple[DesiredRow, ...] = ()


def _param_values(value: Any, label: str, *, value_required: bool) -> tuple[DesiredValue, ...]:
    if not isinstance(value, list):
        raise FrameDecodeError(f"{label} values must be an array")
    decoded = []
    for item in value:
        entry = _strict(item, {"param", "value"}, f"{label} value")
        param = _string(entry.get("param"), f"{label} param", non_empty=True)
        if "value" not in entry:
            if value_required:
                raise FrameDecodeError(f"{label} value is required")
            decoded.append(DesiredValue(param, None, has_value=False))
            continue
        if not _is_param_value(entry["value"]) and not _is_composite_value(entry["value"]):
            raise FrameDecodeError(f"{label} value must be a number, string, boolean or an object of field values")
        decoded.append(DesiredValue(param, dict(entry["value"]) if isinstance(entry["value"], dict) else entry["value"]))
    return tuple(decoded)


def _row_values(value: Any, label: str) -> tuple[DesiredRow, ...]:
    if not isinstance(value, list):
        raise FrameDecodeError(f"{label} rows must be an array")
    decoded = []
    for item in value:
        entry = _strict(item, {"record", "key", "values"}, f"{label} row")
        record = _string(entry.get("record"), f"{label} row record", non_empty=True)
        key = _string(entry.get("key"), f"{label} row key")
        values = _object(entry.get("values"), f"{label} row values")
        if not all(_is_identifier(field) and _is_param_value(field_value) for field, field_value in values.items()):
            raise FrameDecodeError(f"{label} row values must map field ids to numbers, strings or booleans")
        decoded.append(DesiredRow(record, key, dict(values)))
    return tuple(decoded)


def _decode_desired(frame: dict[str, Any]) -> DesiredFrame:
    _strict(frame, {"v", "type", "full", "values", "rows"}, "frame")
    if not isinstance(frame.get("full"), bool):
        raise FrameDecodeError("desired full must be a boolean")
    return DesiredFrame(
        "desired", 1, frame["full"],
        _param_values(frame.get("values"), "desired", value_required=True),
        _row_values(frame.get("rows"), "desired"),
    )


def _decode_echo(frame: dict[str, Any]) -> EchoFrame:
    _strict(frame, {"v", "type", "values", "rows"}, "frame")
    return EchoFrame("echo", 1, _param_values(frame.get("values"), "echo", value_required=False), _row_values(frame.get("rows"), "echo"))


def _decode_desired_status(frame: dict[str, Any]) -> DesiredStatusFrame:
    _strict(frame, {"v", "type", "unsent", "since"}, "frame")
    if "since" not in frame:
        raise FrameDecodeError("desiredStatus since is required")
    unsent = _bool(frame.get("unsent"), "desiredStatus unsent")
    since = frame.get("since")
    if unsent != (since is not None):
        raise FrameDecodeError("desiredStatus since must be set exactly while unsent")
    return DesiredStatusFrame("desiredStatus", 1, unsent, None if since is None else _iso_datetime(since, "desiredStatus since"))


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
        if isinstance(value, dict):
            # 組み合わせの型(D-121)。フィールド id → 基本型の値。文字列は OSC の文字列として送るので行の値と同じ規則
            payload["value"] = _upstream_row_values(value)
            return _dumps(payload)
        if isinstance(value, float) and not math.isfinite(value):
            raise ProtocolError("set value must be finite")
        if not isinstance(value, (bool, int, float, str)):
            raise ProtocolError("set value must be a number, string or boolean")
        payload["value"] = value
    return _dumps(payload)


def encode_resend(target: str | None = None) -> str:
    """保持値の再送要求。target を省くと全宛先(D-046)。"""
    payload: dict[str, Any] = {"v": 1, "type": "resend"}
    if target is not None:
        if not isinstance(target, str) or not target:
            raise ProtocolError("resend target must be a non-empty string")
        payload["target"] = target
    return _dumps(payload)


def encode_reconcile(target: str) -> str:
    """「この PC を記録に合わせる」(HID-385)。その宛先の PC にだけ、生成の記録にあって欠けているものを生成し、
    記録に無い余分なものを消し、保持値を送り直させる。"""
    if not isinstance(target, str) or not target:
        raise ProtocolError("reconcile target must be a non-empty string")
    return _dumps({"v": 1, "type": "reconcile", "target": target})


def _upstream_value(value: Any, label: str) -> Any:
    if not _is_param_value(value):
        raise ProtocolError(f"{label} must be a finite number, string or boolean")
    if isinstance(value, str) and ("\x00" in value or has_lone_surrogate(value)):
        # 上りの OSC の文字列と同じく NUL と孤立サロゲートは送らない(ブリッジが断る。D-111 の追記)
        raise ProtocolError(f"{label} must not contain NUL or lone surrogates")
    return value


def _upstream_key(key: Any) -> str:
    if not isinstance(key, str) or not key:
        raise ProtocolError("record row key must be a non-empty string")
    return _upstream_value(key, "record row key")


def _upstream_row_values(values: Any) -> dict[str, Any]:
    if not isinstance(values, dict):
        raise ProtocolError("record row values must be an object")
    for field, value in values.items():
        if not _is_identifier(field):
            raise ProtocolError("record row values must be keyed by field ids")
        _upstream_value(value, "record row value")
    return dict(values)


def _revision(revision: int | None, label: str) -> int | None:
    if revision is None:
        return None
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
        raise ProtocolError(f"{label} revision must be a positive integer")
    return revision


def encode_set_row(
    record: str, key: str, values: dict[str, Any], *, holder: str | None = None, revision: int | None = None,
) -> str:
    """Record の 1 行の値の変更(HID-389)。全フィールドの値をフィールド id → JSON の値で送る。

    アドレス・型・UI で管理する行の Name はブリッジが定義と一覧から決める(UI は OSC の語を持たない)。
    """
    if not isinstance(record, str) or not record:
        raise ProtocolError("setRow record must be a non-empty string")
    payload: dict[str, Any] = {"v": 1, "type": "setRow", "record": record, "key": _upstream_key(key), "values": _upstream_row_values(values)}
    if (checked := _revision(revision, "setRow")) is not None:
        payload["revision"] = checked
    if holder is not None:
        payload["holder"] = _holder(holder)
    return _dumps(payload)


@dataclass(frozen=True)
class BatchParam:
    """まとめ送りの 1 件(パラメータ)。has_value が False なら value を省く(trigger の定義の value を送る)。"""

    param: str
    value: Any = None
    has_value: bool = True


@dataclass(frozen=True)
class BatchRow:
    """まとめ送りの 1 件(Record の行)。"""

    record: str
    key: str
    values: dict[str, Any]


def encode_batch(
    items: Sequence[BatchParam | BatchRow], *, holder: str | None = None, revision: int | None = None,
) -> str:
    """まとめ送り(D-050・HID-389)。UI が展開したアクションの中身をパラメータ id・行で並べ、ブリッジが 1 つのまとめにする。"""
    if not items or len(items) > OSC_BATCH_MAX_MESSAGES:
        raise ProtocolError(f"batch items must contain 1 to {OSC_BATCH_MAX_MESSAGES} items")
    encoded: list[dict[str, Any]] = []
    for item in items:
        if isinstance(item, BatchParam):
            if not isinstance(item.param, str) or not item.param:
                raise ProtocolError("batch param must be a non-empty string")
            entry: dict[str, Any] = {"param": item.param}
            if item.has_value:
                entry["value"] = (
                    _upstream_row_values(item.value) if isinstance(item.value, dict) else _upstream_value(item.value, "batch value")
                )
            encoded.append(entry)
        elif isinstance(item, BatchRow):
            if not isinstance(item.record, str) or not item.record:
                raise ProtocolError("batch record must be a non-empty string")
            encoded.append({"record": item.record, "key": _upstream_key(item.key), "values": _upstream_row_values(item.values)})
        else:
            raise ProtocolError("invalid batch item")
    payload: dict[str, Any] = {"v": 1, "type": "batch", "items": encoded}
    if (checked := _revision(revision, "batch")) is not None:
        payload["revision"] = checked
    if holder is not None:
        payload["holder"] = _holder(holder)
    return _dumps(payload)
