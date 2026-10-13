from __future__ import annotations

from oscdesk_ui.surface_model import default_widget, parse_surface

from .surface_fixtures import control, definition, param


def test_parameters_become_specs_with_type_and_range() -> None:
    model = parse_surface(
        definition(
            [
                param("level", "/light/level", "f", range=[0, 1], step=0.1, default=0.5),
                param("mute", "/mix/mute", "bool", default=False),
                param("scene", "/scene", "s", options=["A", "B"], default="A"),
                param("go", "/cue/go", "i", kind="trigger", value=1),
            ]
        )
    )

    level = model.spec_for_address("/light/level")
    assert level is not None
    assert (level.widget, level.value_range, level.step, level.default, level.has_default) == (
        "slider",
        (0.0, 1.0),
        0.1,
        0.5,
        True,
    )
    assert model.spec_for_address("/mix/mute").widget == "switch"  # type: ignore[union-attr]
    assert model.spec_for_address("/mix/mute").type_tag == "i"  # type: ignore[union-attr]
    assert model.spec_for_address("/scene").options == ("A", "B")  # type: ignore[union-attr]
    go = model.spec_for_address("/cue/go")
    assert go is not None and (go.widget, go.kind, go.value, go.has_default) == ("button", "trigger", 1, False)
    assert model.spec_for_address("/missing") is None


def test_options_from_address_is_carried_to_the_spec() -> None:
    model = parse_surface(
        definition(
            [
                param("segment", "/member/1/segment", "s", options=["(none)"], optionsFrom={"address": "/mb/segments", "request": "/mb/segments/get"}),
                param("scene", "/scene", "s", options=["A"]),
            ]
        )
    )

    segment = model.spec_for_address("/member/1/segment")
    assert segment is not None and (segment.options, segment.options_from_address) == (("(none)",), "/mb/segments")
    assert model.spec_for_address("/scene").options_from_address is None  # type: ignore[union-attr]


def test_select_without_static_options_falls_back_to_input_until_lists_arrive() -> None:
    # 一覧を UI に重ねる(HID-206)までは、候補の無い select は操作できないので入力欄で代える
    model = parse_surface(
        definition(
            [param("segment", "/member/1/segment", "s", optionsFrom={"address": "/mb/segments"})],
            [control("segment", widget="select")],
        )
    )
    assert model.screens[0].controls[0].widget == "input"


def test_default_widget_follows_type_and_attributes() -> None:
    assert default_widget({"kind": "state", "type": "i", "range": [0, 3]}) == "slider"
    assert default_widget({"kind": "state", "type": "i"}) == "input"
    assert default_widget({"kind": "state", "type": "f"}) == "input"
    assert default_widget({"kind": "state", "type": "s"}) == "input"
    assert default_widget({"kind": "state", "type": "s", "options": ["a"]}) == "select"
    assert default_widget({"kind": "trigger", "type": "s"}) == "button"


def test_controls_override_widget_and_label_and_can_repeat_a_parameter() -> None:
    model = parse_surface(
        definition(
            [param("count", "/count", "i", label="Count", range=[0, 10], default=3)],
            [
                control("count"),
                control("count", widget="input", label="Count (typed)"),
            ],
        )
    )

    first, second = model.screens[0].controls
    assert (first.widget, first.label) == ("slider", "Count")
    assert (second.widget, second.label) == ("input", "Count (typed)")
    assert first.address == second.address


def test_nested_layout_is_flattened_in_order() -> None:
    nested = [
        {"kind": "row", "children": [control("a"), {"kind": "column", "children": [control("b")]}]},
        {"kind": "group", "label": "G", "children": [control("c")]},
        {"kind": "tabs", "tabs": [{"label": "T1", "children": [control("d")]}, {"label": "T2", "children": [control("e")]}]},
    ]
    model = parse_surface(
        definition([param(name, f"/{name}", "i") for name in "abcde"], nested)
    )

    assert [spec.param_id for spec in model.screens[0].controls] == list("abcde")
