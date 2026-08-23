"""protocol/manifest-samples.json を Python ミラーパーサへ通す。

TS 側の packages/shared/src/manifest-samples.test.ts と同じフィクスチャを読み、
受理/拒否の判定が両言語で一致することを機械的に担保する(要件 1.6)。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from oscdesk_ui.manifest import ManifestError, parse_manifest


SAMPLES_PATH = Path(__file__).parents[3] / "protocol" / "manifest-samples.json"


def _samples() -> list[dict[str, Any]]:
    data = json.loads(SAMPLES_PATH.read_text(encoding="utf-8"))
    return data["cases"]


def _expected_options(manifest: dict[str, Any], raw_entry: dict[str, Any]) -> tuple[str, ...]:
    if "options" in raw_entry:
        return tuple(raw_entry["options"])
    return tuple(manifest["optionLists"][raw_entry["optionsRef"]])


def test_fixture_is_not_empty() -> None:
    assert _samples()


@pytest.mark.parametrize("case", _samples(), ids=lambda case: case["name"])
def test_manifest_sample(case: dict[str, Any]) -> None:
    raw_manifest = case["manifest"]

    if not case["valid"]:
        with pytest.raises(ManifestError):
            parse_manifest(raw_manifest)
        return

    manifest = parse_manifest(raw_manifest)
    assert len(manifest.entries) == len(raw_manifest["entries"])

    # 受理したうえで、select の選択肢が宣言どおりに解決されていることも見る。
    # optionsRef の解決は Python 側だけが持つ処理なので、受理判定とは別に確認する。
    for entry, raw_entry in zip(manifest.entries, raw_manifest["entries"]):
        if entry.widget != "select":
            continue
        assert entry.options == _expected_options(raw_manifest, raw_entry), (
            f"{entry.address}: 選択肢の解決結果が宣言と一致しません"
        )
