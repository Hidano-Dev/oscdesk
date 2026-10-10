from __future__ import annotations

import math

import pytest

from oscdesk_ui.entry_rules import (
    INT32_MAX,
    INT32_MIN,
    trigger_value,
    validate_input_confirmation,
)
from oscdesk_ui.surface_model import ControlSpec, parse_surface

from .surface_fixtures import control, definition, param


def entry(value_type: str, **fields: object) -> ControlSpec:
    """input として置いたパラメータ 1 件の ControlSpec。"""
    parameter = param("p", "/input", value_type, **fields)
    return parse_surface(definition([parameter], [control("p", widget="input")])).screens[0].controls[0]


def trigger(value_type: str, value: object) -> ControlSpec:
    parameter = param("t", "/trigger", value_type, kind="trigger", value=value)
    return parse_surface(definition([parameter])).screens[0].controls[0]


@pytest.mark.parametrize(
    ("value_type", "value", "expected"),
    [
        ("i", 1, 1),
        ("f", 1, 1.0),
        ("bool", True, 1),
        ("bool", False, 0),
        ("s", "go", "go"),
    ],
)
def test_trigger_value_follows_the_wire_type(value_type: str, value: object, expected: object) -> None:
    result = trigger_value(trigger(value_type, value))

    assert result == expected
    assert type(result) is type(expected)


def test_non_input_widget_is_rejected() -> None:
    spec = parse_surface(definition([param("p", "/p", "i", range=[0, 1])])).screens[0].controls[0]

    assert validate_input_confirmation(spec, 1).values is None


def test_string_input_rejects_a_value_outside_options() -> None:
    result = validate_input_confirmation(entry("s", options=["A", "B"]), "C")

    assert result.values is None
    assert result.error is not None


def test_string_input_accepts_a_declared_option() -> None:
    assert validate_input_confirmation(entry("s", options=["A", "B"]), "B").values == ("B",)


def test_string_input_without_options_accepts_any_string() -> None:
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
