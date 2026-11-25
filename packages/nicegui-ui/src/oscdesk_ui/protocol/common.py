"""全てのフレームに共通する土台(HID-440 で protocol.py から分けた)。

プロトコル版・引数(WireArg)・フレームの基底・検証の小さな部品・上りの JSON 化を持つ。フレームの種類ごとの
モジュールはここに依存し、ここは protocol の中のほかのモジュールに依存しない(パッケージの外では
project_file の REQUEST_ID_MAX_CHARS だけを使う)。
"""

from __future__ import annotations

import base64
import binascii
import json
import math
import re
from datetime import datetime
from dataclasses import dataclass
from typing import Any, Final

from ..project_file import REQUEST_ID_MAX_CHARS


WIRE_PROTOCOL_VERSION: Final = 1


# bridge 側 (packages/shared/src/wire.ts) の isValidSurfaceName と同じ規則
SURFACE_NAME_PATTERN: Final = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}\Z")
_WINDOWS_RESERVED_NAME: Final = re.compile(r"(?:con|prn|aux|nul|com[1-9]|lpt[1-9])\Z", re.IGNORECASE)
WIRE_ARG_TYPES: Final = frozenset({"i", "f", "s", "b"})


def utf16_length(text: str) -> int:
    """JS の string.length と同じ数え方(zod の max と判定を揃える。絵文字などは 2 と数える)。destinations_panel もここから使う。

    surrogatepass: JSON の "\\ud800" のような孤立サロゲートは JS では 1 文字の正しい文字列で、zod も通す。
    既定の strict では UnicodeEncodeError になり、ブリッジが配ったフレームを UI が捨ててしまう。
    """
    return len(text.encode("utf-16-le", "surrogatepass")) // 2


def has_lone_surrogate(text: str) -> bool:
    """孤立サロゲートを含むか。OSC の UTF-8 化で U+FFFD に置き換わり、送った内容と違うものが届く(TS の hasLoneSurrogate と同じ判定)。"""
    return any("\ud800" <= char <= "\udfff" for char in text)


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


def _request_id(value: Any) -> str:
    # packages/shared の ProjectRequestIdSchema と同じ(1〜64 文字の文字列)
    if not isinstance(value, str) or not 1 <= len(value) <= REQUEST_ID_MAX_CHARS:
        raise FrameDecodeError(f"project requestId must be a string of 1 to {REQUEST_ID_MAX_CHARS} characters")
    return value


def _exact(value: Any, keys: set[str], label: str) -> dict[str, Any]:
    """ちょうど keys を持つオブジェクト(未知のキーも欠けたキーも断る)。"""
    result = _object(value, label)
    if set(result) != keys:
        raise FrameDecodeError(f"{label} must have exactly {', '.join(sorted(keys))}")
    return result


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


# フィールド id・パラメータ id の規則(packages/shared の IDENTIFIER_PATTERN と同じ)
_IDENTIFIER: Final = re.compile(r"[A-Za-z][A-Za-z0-9_-]{0,63}\Z")


def _is_identifier(value: Any) -> bool:
    return isinstance(value, str) and _IDENTIFIER.match(value) is not None


def _is_param_value(value: Any) -> bool:
    """型タグを付けない JSON の値(HID-373)。有限の数値・文字列・真偽だけ。"""
    if isinstance(value, (bool, str)):
        return True
    return isinstance(value, (int, float)) and math.isfinite(value)


def _is_composite_value(value: Any) -> bool:
    """組み合わせの型(D-121)の値。フィールド id → 基本型の値のオブジェクト(入れ子は書けない)。"""
    return isinstance(value, dict) and all(_is_identifier(field) and _is_param_value(item) for field, item in value.items())


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
