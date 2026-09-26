"""確定時の input 値検証。

NiceGUI のイベントや状態を持たない、入力値から送信値を作る純関数だけを
提供する。マニフェストの pattern 自体の妥当性はパース時に検証済みである。
"""

from __future__ import annotations

from dataclasses import dataclass
import math
import re
from typing import Any, Final

from .manifest import ManifestEntry

INT32_MIN: Final = -2_147_483_648
INT32_MAX: Final = 2_147_483_647
DISPLAY_ONLY_WIDGETS: Final = ("text",)


@dataclass(frozen=True)
class ConfirmResult:
    """確定時検証の結果。受理時は送信値、拒否時はエラー文言を持つ。"""

    values: tuple[Any, ...] | None
    error: str | None


def is_display_only(entry: ManifestEntry) -> bool:
    if entry.widget in DISPLAY_ONLY_WIDGETS:
        return True
    if entry.widget == "input":
        return entry.type not in ("s", "i", "f")
    if entry.widget == "select":
        return entry.type != "s"
    return False


def is_apply_trigger(entry: ManifestEntry) -> bool:
    return entry.widget == "button" and bool(entry.applies_to)


def button_values(entry: ManifestEntry) -> tuple[Any, Any]:
    if entry.type == "f":
        return (1.0, 0.0)
    return (1, 0)


def _accepted(value: Any) -> ConfirmResult:
    return ConfirmResult(values=(value,), error=None)


def _rejected(message: str) -> ConfirmResult:
    return ConfirmResult(values=None, error=message)


def validate_input_confirmation(
    entry: ManifestEntry,
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
        if entry.pattern is not None and re.fullmatch(entry.pattern, raw) is None:
            return _rejected("value does not match the declared pattern")
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
