"""ブリッジが配る部品の木(D-124)を UI の型へ読み込む。部品の決め方の規則そのものは surface-view.test.ts が見る。"""

from __future__ import annotations

from .surface_fixtures import control, definition, model_of, param


def test_parameters_become_specs_with_type_and_range() -> None:
    model = model_of(
        definition(
            [
                param("level", "/light/level", "f", range=[0, 1], step=0.1, default=0.5),
                param("mute", "/mix/mute", "bool", default=False),
                param("scene", "/scene", "s", options=["A", "B"], default="A"),
                param("go", "/cue/go", "i", kind="trigger", value=1),
            ]
        )
    )

    level = model.spec_for("level")
    assert level is not None
    assert (level.widget, level.value_range, level.step, level.default, level.has_default) == (
        "slider",
        (0.0, 1.0),
        0.1,
        0.5,
        True,
    )
    assert model.spec_for("mute").widget == "switch"  # type: ignore[union-attr]

    assert model.spec_for("scene").options == ("A", "B")  # type: ignore[union-attr]
    go = model.spec_for("go")
    assert go is not None and (go.widget, go.kind, go.value, go.has_default) == ("button", "trigger", 1, False)
    assert model.spec_for("missing") is None


def test_options_from_and_sync_are_carried_to_the_spec() -> None:
    model = model_of(
        definition(
            [
                param("segment", "/member/1/segment", "s", options=["(none)"], optionsFrom={"address": "/mb/segments", "request": "/mb/segments/get"}),
                param("pick", "/pick", "s", optionsFrom={"address": "/mb/picks"}),
                param("scene", "/scene", "s", options=["A"]),
            ]
        )
    )

    # 一覧は id で指す(HID-389)。要求を持つ一覧だけが取り直せる(Sync)
    segment = model.spec_for("segment")
    assert segment is not None and (segment.options, segment.options_from, segment.options_sync) == (("(none)",), "l_mb_segments", "l_mb_segments")
    pick = model.spec_for("pick")
    # 固定の候補が無い一覧の select は、一覧が届くまで空の候補で持つ(HID-206)
    assert pick is not None and (pick.widget, pick.options, pick.options_sync) == ("select", (), None)
    assert model.spec_for("scene").options_from is None  # type: ignore[union-attr]


def test_controls_override_widget_and_label_and_can_repeat_a_parameter() -> None:
    model = model_of(
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
    assert first.param_id == second.param_id


def test_nested_layout_is_flattened_in_order() -> None:
    nested = [
        {"kind": "row", "children": [control("a"), {"kind": "column", "children": [control("b")]}]},
        {"kind": "group", "label": "G", "children": [control("c")]},
        {"kind": "tabs", "tabs": [{"label": "T1", "children": [control("d")]}, {"label": "T2", "children": [control("e")]}]},
    ]
    model = model_of(definition([param(name, f"/{name}", "i") for name in "abcde"], nested))

    assert [spec.param_id for spec in model.screens[0].controls] == list("abcde")
