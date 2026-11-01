"""設計図のタブ(HID-386)。PC ごとの設計図の一覧・Sync・食い違いの表示と、設計図から既定の画面を作る操作。

画面を作るのも、保存した画面を優先するのもブリッジ(判断をサーバーに置く。HID-373 の決定 3)。ここは表示と要求だけ。
"""

from __future__ import annotations

import json
from typing import Any

from nicegui import ui

from .state import SurfaceState


def verified_label(verified: Any) -> tuple[str, str]:
    """照合の結果の表示(文言、色)。食い違いは Sync で取り直す。"""
    if verified is True:
        return "一致", "positive"
    if verified is False:
        return "食い違い(「設計図を取り直す」で取り直してください)", "negative"
    return "未照合", "grey-7"


_BASIC_TYPES = frozenset(("i", "f", "s", "bool"))


def composite_support(item: dict[str, Any]) -> str | None:
    """設計図の項目が組み合わせの型(D-121)なら、画面に出せるか("flat")・出せないか("nested" / "variable-length" / "invalid")。

    基本型だけを並べた Record だけが OSC の引数で送れる。入れ子・可変長は CBOR で送る方針で今は出せない(HID-397)。
    組み合わせの型でない項目は None。スキーマの細かな検証はブリッジ(画面を作る側)が行い、ここは表示の目安だけ。
    """
    if item.get("type") != "composite":
        return None
    text = "".join(prop.get("value", "") for prop in item.get("props", []) if prop.get("key") == "schema" and isinstance(prop.get("value"), str))
    try:
        schema = json.loads(text)
    except ValueError:
        return "invalid"
    if not isinstance(schema, dict):
        return "invalid"
    if schema.get("type") == "array":
        return "variable-length"
    fields = schema.get("fields")
    if schema.get("type") != "record" or not isinstance(fields, list) or not fields:
        return "invalid"
    kinds = {field.get("type") if isinstance(field, dict) else None for field in fields}
    if "array" in kinds:
        return "variable-length"
    if "record" in kinds:
        return "nested"
    return "flat" if kinds <= _BASIC_TYPES else "invalid"


def composite_note(items: list[dict[str, Any]]) -> str | None:
    """組み合わせの型の項目の数と、画面に出せないものの数の文言。組み合わせの型が無ければ None。"""
    support = [composite_support(item) for item in items]
    composites = [value for value in support if value is not None]
    if not composites:
        return None
    hidden = sum(1 for value in composites if value != "flat")
    note = f"組み合わせの型 {len(composites)} 項目"
    return note if hidden == 0 else f"{note}(うち {hidden} 項目は入れ子・可変長などで画面に出せません)"


def pc_rows(pcs: tuple[dict[str, Any], ...]) -> list[dict[str, Any]]:
    """表の行(純粋関数。テストで NiceGUI を起こさずに確かめる)。"""
    return [
        {
            "host": pc.get("host", ""),
            "name": pc.get("name", ""),
            "items": len(pc.get("items", [])),
            "receivedAt": pc.get("receivedAt", ""),
            "verified": verified_label(pc.get("verified"))[0],
        }
        for pc in pcs
    ]


class BlueprintPanel:
    def __init__(self, state: SurfaceState) -> None:
        self._state = state
        self._revision = -1
        self._container: Any = None

    def build(self) -> None:
        with ui.column().classes("w-full q-gutter-y-sm"):
            with ui.row().classes("items-center q-gutter-x-sm"):
                ui.button("設計図を取り直す", icon="sync", on_click=lambda _event: self._state.link.request_catalog()).props("dense no-caps")
                ui.label("ターゲットに設計図(何を操作できるか)を送り直させます").classes("text-caption text-grey-7")
            self._container = ui.column().classes("w-full q-gutter-y-xs")
        self._revision = -1
        self.sync()

    def sync(self) -> None:
        if self._container is None or self._revision == self._state.catalog_revision:
            return
        self._revision = self._state.catalog_revision
        self._container.clear()
        pcs = self._state.catalog_pcs
        with self._container:
            if not pcs:
                ui.label("まだ設計図を受けていません。ターゲットの起動時か「設計図を取り直す」で届きます。").classes("text-grey-7")
                return
            source = self._state.blueprint_pc
            for pc, row in zip(pcs, pc_rows(pcs), strict=True):
                text, color = verified_label(pc.get("verified"))
                with ui.card().classes("w-full q-pa-sm"):
                    with ui.row().classes("w-full items-center justify-between no-wrap"):
                        with ui.column().classes("q-gutter-y-none"):
                            ui.label(f"{row['name']}({row['host']})").classes("text-subtitle2")
                            ui.label(f"{row['items']} 項目・受信 {row['receivedAt']}").classes("text-caption text-grey-7")
                            ui.label(text).classes(f"text-caption text-{color}")
                            note = composite_note(list(pc.get("items", [])))
                            if note is not None:
                                ui.label(note).classes("text-caption text-grey-7")
                        current = source is not None and source.get("host") == row["host"]
                        ui.button(
                            "表示中" if current else "この設計図から画面を作る",
                            on_click=lambda _event, host=row["host"]: self._state.link.adopt_catalog(host),
                        ).props("dense no-caps" + (" flat" if current else ""))
