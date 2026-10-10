"""確定時の input 値検証。

NiceGUI のイベントや状態を持たない、入力値から送信値を作る純関数だけを
提供する。定義の値域・options の妥当性は定義の検証時に済んでいる。
"""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Any, Final

from .surface_model import ControlSpec

INT32_MIN: Final = -2_147_483_648
INT32_MAX: Final = 2_147_483_647


@dataclass(frozen=True)
class ConfirmResult:
    """確定時検証の結果。受理時は送信値、拒否時はエラー文言を持つ。"""

    values: tuple[Any, ...] | None
    error: str | None


def trigger_value(entry: ControlSpec) -> Any:
    """トリガの押下で送る値。定義の value を OSC の型タグに合わせる(bool は 0/1)。"""
    value = entry.value
    if entry.type == "bool":
        return 1 if value else 0
    if entry.type == "f":
        return float(value)
    return value


def _accepted(value: Any) -> ConfirmResult:
    return ConfirmResult(values=(value,), error=None)


def _rejected(message: str) -> ConfirmResult:
    return ConfirmResult(values=None, error=message)


def validate_input_confirmation(
    entry: ControlSpec,
    raw: str | float | None,
) -> ConfirmResult:
    """入力欄の値を検証し、OSC 送信に使う型へ変換する。

    範囲外の値はクランプせず拒否する。入力欄の更新や通知などの副作用は
    持たず、受理時は ``values``、拒否時は ``error`` のみを返す。
    """

    if entry.widget != "input":
        return _rejected("input widget is required")

    if entry.type == "s":
        if not isinstance(raw, str):
            return _rejected("a string value is required")
        if entry.options is not None and raw not in entry.options:
            return _rejected("value is not one of the declared options")
        return _accepted(raw)

    if entry.type == "i":
        if isinstance(raw, bool) or not isinstance(raw, (int, float)):
            return _rejected("an integer value is required")
        if isinstance(raw, float) and (not math.isfinite(raw) or not raw.is_integer()):
            return _rejected("an integer value is required")
        value = int(raw)
        if not INT32_MIN <= value <= INT32_MAX:
            return _rejected("integer value is outside the int32 range")
        if entry.value_range is not None and not _in_range(value, entry.value_range):
            return _rejected("value is outside the declared range")
        return _accepted(value)

    if entry.type == "f":
        if isinstance(raw, bool) or not isinstance(raw, (int, float)):
            return _rejected("a numeric value is required")
        value = float(raw)
        if not math.isfinite(value):
            return _rejected("value must be finite")
        if entry.value_range is not None and not _in_range(value, entry.value_range):
            return _rejected("value is outside the declared range")
        return _accepted(value)

    return _rejected("input widget requires type s, i, or f")


def _in_range(value: float, value_range: tuple[float, float]) -> bool:
    low, high = value_range
    return low <= value <= high
