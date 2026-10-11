from __future__ import annotations

import copy

import pytest

from oscdesk_ui import surface_editor as ed
from oscdesk_ui.surface_definition import validate_surface_definition

from .surface_fixtures import control, definition, param

PARAMS = [
    param("a", "/a", "bool", "A"),
    param("b", "/b", "f", "B", range=[0, 1]),
    param("c", "/c", "bool", "C"),
]


def base() -> dict:
    return definition(PARAMS)


def kinds(defn: dict) -> list[str]:
    return [node["kind"] for node in defn["screens"][0]["children"]]


def test_edits_never_mutate_the_source_definition() -> None:
    source = base()
    snapshot = copy.deepcopy(source)

    ed.move_node(source, (0, (), 0), 1)
    ed.wrap_node(source, (0, (), 0), "group")
    ed.remove_parameter(source, "a")

    assert source == snapshot


def test_move_swaps_neighbours_and_stops_at_the_ends() -> None:
    moved = ed.move_node(base(), (0, (), 0), 1)
    assert [n["param"] for n in moved["screens"][0]["children"]] == ["b", "a", "c"]

    assert ed.move_node(base(), (0, (), 0), -1) == base()


def test_wrap_in_group_and_unwrap_roundtrip() -> None:
    wrapped = ed.wrap_node(base(), (0, (), 1), "group", "G")
    group = wrapped["screens"][0]["children"][1]
    assert group["kind"] == "group" and group["label"] == "G" and group["children"][0]["param"] == "b"
    validate_surface_definition(wrapped)

    assert ed.unwrap_node(wrapped, (0, (), 1)) == base()


def test_merge_with_next_builds_a_row_and_extends_it() -> None:
    merged = ed.merge_with_next(base(), (0, (), 0))
    assert kinds(merged) == ["row", "control"]
    assert len(merged["screens"][0]["children"][0]["children"]) == 2

    extended = ed.merge_with_next(merged, (0, (), 0))
    assert kinds(extended) == ["row"] and len(extended["screens"][0]["children"][0]["children"]) == 3

    with pytest.raises(ed.EditError):
        ed.merge_with_next(extended, (0, (), 0))


def test_width_and_collapsed() -> None:
    wrapped = ed.wrap_node(base(), (0, (), 0), "group", "G")
    collapsed = ed.set_collapsed(wrapped, (0, (), 0), True)
    assert collapsed["screens"][0]["children"][0]["collapsed"] is True

    widened = ed.set_width(collapsed, (0, (), 0), 6)
    assert widened["screens"][0]["children"][0]["width"] == 6
    assert "width" not in ed.set_width(widened, (0, (), 0), None)["screens"][0]["children"][0]

    with pytest.raises(ed.EditError):
        ed.set_collapsed(base(), (0, (), 0), True)


def test_nested_refs_reach_inside_rows_and_tabs() -> None:
    defn = definition(
        PARAMS,
        [
            {"kind": "row", "children": [control("a"), control("b")]},
            {"kind": "tabs", "tabs": [{"label": "T", "children": [control("c")]}]},
        ],
    )

    inside_row = ed.remove_node(defn, (0, (0,), 0))
    assert [n["param"] for n in inside_row["screens"][0]["children"][0]["children"]] == ["b"]

    inside_tab = ed.remove_node(defn, (0, ((1, 0),), 0))
    assert inside_tab["screens"][0]["children"][1]["tabs"][0]["children"] == []

    with pytest.raises(ed.EditError):
        ed.remove_node(defn, (0, (9,), 0))


def test_remove_parameter_drops_its_controls_everywhere() -> None:
    defn = definition(
        PARAMS,
        [{"kind": "group", "label": "G", "children": [control("a")]}, control("b"), control("c")],
    )
    result = ed.remove_parameter(defn, "a")

    assert [p["id"] for p in result["parameters"]] == ["b", "c"]
    assert result["screens"][0]["children"][0]["children"] == []
    validate_surface_definition(result)


def test_update_parameter_follows_id_rename_in_layout() -> None:
    renamed = ed.update_parameter(base(), "a", param("alpha", "/a", "bool", "A"))

    assert [n["param"] for n in renamed["screens"][0]["children"]] == ["alpha", "b", "c"]
    validate_surface_definition(renamed)


def test_unplaced_parameters_can_be_placed() -> None:
    defn = definition(PARAMS, [control("a")])
    assert ed.unplaced_parameter_ids(defn) == ["b", "c"]

    placed = ed.add_control(defn, 0, "b")
    assert ed.unplaced_parameter_ids(placed) == ["c"]
    with pytest.raises(ed.EditError):
        ed.add_control(defn, 0, "missing")


def test_session_rejects_invalid_edits_and_keeps_the_draft() -> None:
    session = ed.EditSession(base(), base_revision=3, base_name="stage")

    # 範囲の逆転は検証で拒否され、作業コピーは変わらない
    bad = param("b", "/b", "f", "B", range=[1, 0])
    assert session.apply(ed.update_parameter, "b", bad) is not None
    assert session.draft == base() and not session.dirty

    assert session.apply(ed.move_node, (0, (), 0), 1) is None
    assert session.dirty


def test_session_conflict_and_mark_saved() -> None:
    session = ed.EditSession(base(), base_revision=3, base_name="stage")
    session.apply(ed.move_node, (0, (), 0), 1)

    assert not session.is_conflicted(3)
    assert session.is_conflicted(4)

    session.mark_saved(5, "stage")
    assert not session.dirty and not session.is_conflicted(5)


def test_session_replace_validates() -> None:
    session = ed.EditSession(base(), 1, None)
    assert session.replace({"format": "nope"}) is not None
    assert session.draft == base()
    assert session.replace(definition(PARAMS[:1])) is None


def form(**overrides: str) -> dict:
    result = {"id": "x", "address": "/x", "label": "X", "kind": "state", "type": "f", "standalone": True,
              "min": "", "max": "", "step": "", "options": "", "default": "", "value": ""}
    result.update(overrides)
    return result


def test_build_parameter_numeric_range_and_defaults() -> None:
    built = ed.build_parameter(form(min="0", max="10", step="0.5", default="5"))
    assert built == {"id": "x", "address": "/x", "label": "X", "kind": "state", "type": "f", "range": [0, 10], "step": 0.5, "default": 5}

    with pytest.raises(ed.EditError):
        ed.build_parameter(form(min="0"))
    with pytest.raises(ed.EditError):
        ed.build_parameter(form(min="a", max="1"))


def test_build_parameter_trigger_select_and_bool() -> None:
    trigger = ed.build_parameter(form(kind="trigger", type="bool", value="true", default="false"))
    assert trigger["value"] is True and "default" not in trigger

    select = ed.build_parameter(form(type="s", options="a, b", default="a"))
    assert select["options"] == ["a", "b"] and select["default"] == "a"

    assert ed.build_parameter(form(standalone=False))["standalone"] is False
