"""組み合わせの型(HID-380・D-121)の UI 側: 部品の選び方・値の変換・表示キャッシュと送信。"""

from __future__ import annotations

import json
from typing import Any

from oscdesk_ui.blueprint_panel import composite_note, composite_support
from oscdesk_ui.protocol import DesiredFrame, DesiredValue, EchoFrame
from oscdesk_ui.surface_model import default_widget, is_color_composite, parse_surface
from oscdesk_ui.widgets import color_hex, parse_color_hex

from .surface_fixtures import body_of, check_structure, control, definition, param
from .test_state import build_state, deliver_surface, spec


def _rgba(**overrides: Any) -> dict[str, Any]:
    fields = {
        "hint": "color",
        "fields": [{"id": c, "label": c.upper(), "type": "f", "range": [0, 1], "default": 1} for c in "rgba"],
        **overrides,
    }
    return param("tint", "/fx/tint", "composite", "Tint", **fields)


GENERIC = param(
    "light", "/fx/light", "composite", "Light", hint="acme.light",
    fields=[
        {"id": "level", "label": "Level", "type": "f", "range": [0, 1], "default": 0.5},
        {"id": "on", "label": "On", "type": "bool", "default": True},
        {"id": "mode", "label": "Mode", "type": "s", "options": ["a", "b"], "default": "a"},
    ],
)
KICK = param(
    "kick", "/fx/kick", "composite", "Kick", kind="trigger",
    fields=[{"id": "x", "label": "X", "type": "f", "value": 0.25}, {"id": "on", "label": "On", "type": "bool", "value": True}],
)
DEFINITION = definition([_rgba(), GENERIC, KICK], [control("tint"), control("light"), control("kick")])


def test_known_color_hint_gets_the_color_picker_and_unknown_hints_get_fields() -> None:
    assert default_widget(_rgba()) == "color"
    assert default_widget(GENERIC) == "composite"
    # ヒントが color でも、範囲 0〜1 の f が 3 つか 4 つでなければ色の選択では表せない
    assert not is_color_composite(_rgba(fields=[{"id": c, "label": c, "type": "f", "range": [0, 255], "default": 1} for c in "rgb"]))
    assert not is_color_composite({**_rgba(), "kind": "trigger"})


def test_the_composite_spec_keeps_field_specs_and_converts_values_both_ways() -> None:
    model = parse_surface(body_of(DEFINITION))
    light = model.spec_for("light")
    assert light is not None and light.is_composite
    assert [field.widget for field in light.fields] == ["slider", "switch", "select"]
    assert light.has_default and light.default_values == (0.5, True, "a")
    assert light.wire_value((0.25, False, "b")) == {"level": 0.25, "on": False, "mode": "b"}
    assert light.values_from_wire({"level": 0.25, "on": False, "mode": "b"}) == (0.25, False, "b")
    # 欠け・余分・値域外・選択肢外・単独の値は表示キャッシュに入れない
    for bad in ({"level": 0.25, "on": False}, {"level": 0.25, "on": False, "mode": "b", "x": 1}, {"level": 2, "on": False, "mode": "b"},
                {"level": 0.25, "on": False, "mode": "c"}, 0.5):
        assert light.values_from_wire(bad) is None
    # 1 つの値のパラメータにオブジェクトは入れない
    assert parse_surface(body_of(definition([param("x", "/x", "f", range=[0, 1], default=0)], [control("x")]))).spec_for("x").values_from_wire({"a": 1}) is None  # type: ignore[union-attr]


def test_desired_and_echo_fill_the_cache_with_field_tuples_and_sends_carry_objects() -> None:
    state, link, _clock = build_state()
    deliver_surface(state, DEFINITION)
    # 採用直後は default の組を表示する
    assert state.values.values_of("light") == (0.5, True, "a")

    state._on_frame(DesiredFrame(type="desired", full=True, values=(DesiredValue("light", {"level": 0.75, "on": False, "mode": "b"}),), rows=()))
    assert state.values.values_of("light") == (0.75, False, "b")

    light = spec(state, "light")
    state.set_discrete(light, (0.75, True, "b"))
    assert link.sent[-1] == ("light", {"level": 0.75, "on": True, "mode": "b"})

    state._on_frame(EchoFrame(type="echo", values=(DesiredValue("tint", {"r": 0.5, "g": 0.25, "b": 0, "a": 1}),), rows=()))
    assert state.values.values_of("tint") == (0.5, 0.25, 0, 1)

    # trigger はフィールドの value を並べて送る
    state.press_trigger(spec(state, "kick"))
    assert link.sent[-1] == ("kick", {"x": 0.25, "on": True})


def test_shared_samples_for_composites_validate_in_python() -> None:
    check_structure(DEFINITION)


def test_color_hex_round_trip() -> None:
    assert color_hex((1, 0.5, 0)) == "#ff8000"
    assert parse_color_hex("#ff8000") == (1.0, 128 / 255, 0.0)
    assert parse_color_hex("#f80") == (1.0, 136 / 255, 0.0)
    assert parse_color_hex("#ff8000cc") == (1.0, 128 / 255, 0.0)
    assert parse_color_hex("red") is None
    assert parse_color_hex("#zzzzzz") is None


def test_blueprint_panel_counts_composites_it_cannot_show() -> None:
    def item(schema: str) -> dict[str, Any]:
        return {"param": "p", "kind": "state", "type": "composite", "props": [{"key": "schema", "value": schema}]}

    flat = item('{"name":"color","type":"record","fields":[{"id":"r","type":"f"}]}')
    nested = item('{"name":"n","type":"record","fields":[{"id":"c","type":"record","fields":[{"id":"r","type":"f"}]}]}')
    listed = item('{"name":"l","type":"array","items":{"type":"f"}}')
    assert [composite_support(entry) for entry in (flat, nested, listed, item("{"))] == ["flat", "nested", "variable-length", "invalid"]
    assert composite_support({"type": "f", "props": []}) is None
    assert composite_note([flat]) == "組み合わせの型 1 項目"
    assert composite_note([flat, nested, listed]) == "組み合わせの型 3 項目(うち 2 項目は入れ子・可変長などで画面に出せません)"
    assert composite_note([{"type": "f", "props": []}]) is None


def test_blueprint_panel_treats_malformed_schemas_as_invalid_without_raising() -> None:
    # HID-398: LAN の誰でも送れる schema に、型の欄の配列・オブジェクトや深すぎる木を入れても例外にしない
    def item(schema: str) -> dict[str, Any]:
        return {"param": "p", "kind": "state", "type": "composite", "props": [{"key": "schema", "value": schema}]}

    deep: dict[str, Any] = {"id": "leaf", "type": "f"}
    for depth in range(12):
        deep = {"id": f"n{depth}", "type": "record", "fields": [deep]}
    for schema in (
        '{"type":"record","fields":[{"type":[]}]}',
        '{"type":"record","fields":[{"id":"r","type":{"x":1}}]}',
        '{"type":"record","fields":[1]}',
        '{"type":"array","items":[]}',
        '{"type":[],"fields":[]}',
        "[" * 100000 + "]" * 100000,
        json.dumps({"name": "d", "type": "record", "fields": [deep]}),
    ):
        assert composite_support(item(schema)) == "invalid", schema[:60]
    assert composite_support(item('{"name":"a","type":"array","items":{"type":"record","fields":[{"id":"x","type":"f"}]}}')) == "variable-length"
    assert composite_note([item('{"type":"record","fields":[{"type":[]}]}')]) == "組み合わせの型 1 項目(うち 1 項目は入れ子・可変長などで画面に出せません)"


def test_composite_echoes_at_a_float32_range_bound_and_int32_limits_are_handled() -> None:
    # HID-398: 0.1 は float32 で 0.10000000149011612 として届く。範囲の端として受ける。範囲の無い i は int32 の外を受けない
    defn = definition(
        [param("p", "/fx/p", "composite", "P", fields=[
            {"id": "x", "label": "X", "type": "f", "range": [0, 0.1], "default": 0},
            {"id": "n", "label": "N", "type": "i", "default": 0},
        ])],
        [control("p")],
    )
    spec_p = parse_surface(body_of(defn)).spec_for("p")
    assert spec_p is not None
    assert spec_p.values_from_wire({"x": 0.10000000149011612, "n": 1}) == (0.1, 1)
    assert spec_p.values_from_wire({"x": 0.11, "n": 1}) is None
    assert spec_p.values_from_wire({"x": 0.05, "n": 4294967296}) is None
