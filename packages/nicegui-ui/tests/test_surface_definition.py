"""protocol/surface-definition-samples.json を JSON Schema + 意味検証へ通す。

TS 側の packages/shared/src/surface-definition.test.ts と同じフィクスチャを読み、
受理/拒否の判定が両言語で一致することを担保する(D-043)。
"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest

from oscdesk_ui.surface_definition import (
    SurfaceDefinitionError,
    collect_semantic_issues,
    load_schema,
    validate_surface_definition,
)

SAMPLES_PATH = Path(__file__).parents[3] / "protocol" / "surface-definition-samples.json"


def _samples() -> list[dict[str, Any]]:
    return json.loads(SAMPLES_PATH.read_text(encoding="utf-8"))["cases"]


def test_fixture_is_not_empty() -> None:
    assert _samples()


class _CountingSteps(list):
    """steps を何回走査したかを数える(rowActions 数 × steps 数の総当たりの回帰検出用)。"""

    iterations = 0

    def __iter__(self):  # type: ignore[no-untyped-def]
        _CountingSteps.iterations += 1
        return super().__iter__()


_COLUMN_ACTION_PATH = "screens/0/children/1/columns/0/actions/0"


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("records-column-actions", []),
        ("records-column-action-unknown", [f"{_COLUMN_ACTION_PATH}: unknown action: missing"]),
        ("records-column-action-row-scope", [f"{_COLUMN_ACTION_PATH}: column action must have scope all: update"]),
        ("records-column-action-unscoped", [f"{_COLUMN_ACTION_PATH}: column action must have scope all: masterReset"]),
        (
            "records-column-action-other-keys",
            [f"{_COLUMN_ACTION_PATH}: column action records must share the keysFrom list of record member"],
        ),
    ],
)
def test_column_actions_report_the_same_issues_as_ts(name: str, expected: list[str]) -> None:
    """列のアクション(D-066)。TS 側 surface-definition.test.ts と同じ場所・同じ文言で報告する。"""
    definition = next(case for case in _samples() if case["name"] == name)["definition"]
    assert collect_semantic_issues(definition) == expected


def test_row_actions_scan_each_action_steps_once() -> None:
    definition = copy.deepcopy(next(case for case in _samples() if case["name"] == "records-basic")["definition"])
    steps = _CountingSteps([{"record": "member"}] * 100)
    definition["actions"].append({"id": "many", "label": "Many", "scope": "row", "steps": steps})
    node = next(child for child in definition["screens"][0]["children"] if child["kind"] == "record")
    node["rowActions"] = ["many"] * 1000
    _CountingSteps.iterations = 0
    assert collect_semantic_issues(definition) == []
    # アクション自体の検証で 1 回、rowActions のキー集合の集約で 1 回、結び付けの selector の有無で 1 回。rowActions の数には比例しない
    assert _CountingSteps.iterations <= 3


@pytest.mark.parametrize("case", _samples(), ids=lambda case: case["name"])
def test_surface_definition_sample(case: dict[str, Any]) -> None:
    schema = load_schema()
    if case["valid"]:
        validate_surface_definition(case["definition"], schema)
    else:
        with pytest.raises(SurfaceDefinitionError):
            validate_surface_definition(case["definition"], schema)
