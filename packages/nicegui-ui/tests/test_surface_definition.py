"""protocol/surface-definition-samples.json を JSON Schema + 意味検証へ通す。

TS 側の packages/shared/src/surface-definition.test.ts と同じフィクスチャを読み、
受理/拒否の判定が両言語で一致することを担保する(D-043)。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from oscdesk_ui.surface_definition import (
    SurfaceDefinitionError,
    load_schema,
    validate_surface_definition,
)

SAMPLES_PATH = Path(__file__).parents[3] / "protocol" / "surface-definition-samples.json"


def _samples() -> list[dict[str, Any]]:
    return json.loads(SAMPLES_PATH.read_text(encoding="utf-8"))["cases"]


def test_fixture_is_not_empty() -> None:
    assert _samples()


@pytest.mark.parametrize("case", _samples(), ids=lambda case: case["name"])
def test_surface_definition_sample(case: dict[str, Any]) -> None:
    schema = load_schema()
    if case["valid"]:
        validate_surface_definition(case["definition"], schema)
    else:
        with pytest.raises(SurfaceDefinitionError):
            validate_surface_definition(case["definition"], schema)
