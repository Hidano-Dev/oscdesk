from __future__ import annotations

import math

import pytest

from oscdesk_ui.entry_rules import (
    INT32_MAX,
    INT32_MIN,
    validate_input_confirmation,
)
from oscdesk_ui.manifest import parse_manifest


def entry(value_type: str, **fields: object):
    raw = {"address": "/input", "label": "Input", "type": value_type, "widget": "input"}
    raw.update(fields)
    return parse_manifest({"version": 1, "projectId": "p", "entries": [raw]}).entries[0]


@pytest.mark.parametrize("raw", ["", "hello"])
def test_string_input_accepts_empty_and_matching_values(raw: str) -> None:
    result = validate_input_confirmation(entry("s", pattern=r"[a-z]*"), raw)

    assert result.values == (raw,)
    assert result.error is None


def test_string_input_rejects_pattern_mismatch() -> None:
    result = validate_input_confirmation(entry("s", pattern=r"[A-Z]+"), "abc")

    assert result.values is None
    assert result.error is not None


def test_string_input_without_pattern_accepts_any_string() -> None:
    assert validate_input_confirmation(entry("s"), "anything").values == ("anything",)


@pytest.mark.parametrize("raw", [None, 1.5, math.inf, "1"])
def test_integer_input_rejects_non_integer_values(raw: object) -> None:
    result = validate_input_confirmation(entry("i"), raw)  # type: ignore[arg-type]

    assert result.values is None
    assert result.error is not None


@pytest.mark.parametrize("raw", [INT32_MIN, INT32_MAX, 4.0])
def test_integer_input_converts_integral_values_and_accepts_int32_boundaries(raw: int | float) -> None:
    assert validate_input_confirmation(entry("i"), raw).values == (int(raw),)


@pytest.mark.parametrize("raw", [INT32_MIN - 1, INT32_MAX + 1])
def test_integer_input_rejects_values_outside_int32(raw: int) -> None:
    result = validate_input_confirmation(entry("i"), raw)

    assert result.values is None
    assert result.error is not None


@pytest.mark.parametrize("raw", [0, 10])
def test_integer_input_accepts_range_boundaries_without_clamping(raw: int) -> None:
    assert validate_input_confirmation(entry("i", range=[0, 10]), raw).values == (raw,)


def test_integer_input_rejects_value_outside_range() -> None:
    result = validate_input_confirmation(entry("i", range=[0, 10]), 11)

    assert result.values is None
    assert result.error is not None


@pytest.mark.parametrize("raw", [0, 1.25, -2.5])
def test_float_input_converts_finite_values(raw: int | float) -> None:
    result = validate_input_confirmation(entry("f"), raw)

    assert result.values == (float(raw),)


@pytest.mark.parametrize("raw", [math.inf, -math.inf, math.nan])
def test_float_input_rejects_non_finite_values(raw: float) -> None:
    result = validate_input_confirmation(entry("f"), raw)

    assert result.values is None
    assert result.error is not None


def test_float_input_rejects_value_outside_range() -> None:
    result = validate_input_confirmation(entry("f", range=[0.0, 1.0]), 1.01)

    assert result.values is None
    assert result.error is not None
