"""設計図のタブ(HID-386)。PC ごとの設計図の一覧・Sync・食い違いの表示と、設計図から既定の画面を作る操作。

画面を作るのも、保存した画面を優先するのもブリッジ(判断をサーバーに置く。HID-373 の決定 3)。ここは表示と要求だけ。
"""

from __future__ import annotations

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
                        current = source is not None and source.get("host") == row["host"]
                        ui.button(
                            "表示中" if current else "この設計図から画面を作る",
                            on_click=lambda _event, host=row["host"]: self._state.link.adopt_catalog(host),
                        ).props("dense no-caps" + (" flat" if current else ""))
