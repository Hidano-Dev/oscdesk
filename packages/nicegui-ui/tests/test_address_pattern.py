from __future__ import annotations

import json
from pathlib import Path

import pytest

from oscdesk_ui.address_pattern import matches_any_pattern, matches_pattern


CASES = json.loads(
    (Path(__file__).parents[3] / "protocol" / "address-pattern-cases.json").read_text(encoding="utf-8")
)["cases"]


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_shared_address_pattern_cases(case: dict[str, object]) -> None:
    assert matches_pattern(case["pattern"], case["address"]) is case["matches"]


def test_matches_any_pattern() -> None:
    assert matches_any_pattern(["/other/*", "/member/*/*"], "/member/01/name")
    assert not matches_any_pattern(["/other/*", "/member/*"], "/member/01/name")
