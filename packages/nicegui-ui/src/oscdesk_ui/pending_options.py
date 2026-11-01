"""「新しい一覧があります」(D-088)。

Unity から届いた一覧のうち、まだ反映していないもの(runtimeOptions の pending)を出所ごとに見せ、
一覧ごとの「反映」と「すべて反映」を置く。反映はブリッジが行って全 UI へ配るので、ここは表示と要求の送信だけ。
文言の組み立ては純粋関数に分け、画面を作らずにテストできるようにする。
"""

from __future__ import annotations

from typing import Any

from nicegui import ui

from .notify_history import notify
from .protocol import PendingOptionList
from .state import SurfaceState

TITLE = "新しい一覧があります"
HINT = "反映するまで、画面の行と選択肢は変わりません。心当たりの無い宛先からの一覧は反映しないでください"
APPLY_LABEL = "反映"
APPLY_ALL_LABEL = "すべて反映"
OFFLINE_MESSAGE = "ブリッジに接続していないため反映できませんでした"
# 名前を全部並べると、数百件の一覧で表示が埋まる。超えた分は件数だけ出す
MAX_NAMES = 10


def source_label(item: PendingOptionList) -> str:
    """出所の表示。ブロードキャストの宛先では答えたホストを添える(同じ宛先名で複数の PC が答えるため)。"""
    return item.target if item.host is None else f"{item.target}({item.host})"


def _names(names: tuple[str, ...]) -> str:
    shown = "、".join(name if name else "(空)" for name in names[:MAX_NAMES])
    rest = len(names) - MAX_NAMES
    return shown if rest <= 0 else f"{shown} ほか {rest} 件"


def change_summary(item: PendingOptionList) -> str:
    """「<宛先> の一覧が変わりました(追加: …/削除: …)」。増減が無ければ並びだけが変わった。"""
    parts = []
    if item.added:
        parts.append(f"追加: {_names(item.added)}")
    if item.removed:
        parts.append(f"削除: {_names(item.removed)}")
    detail = " / ".join(parts) if parts else "並び順だけが変わりました"
    return f"{source_label(item)} の一覧が変わりました({detail})"


def list_usages(definition: dict[str, Any] | None, list_id: str) -> tuple[str, ...]:
    """その一覧を使う欄のラベル(定義順)。どの画面の何が変わるのかを、一覧の id だけより分かりやすくする。"""
    if definition is None:
        return ()
    usages: list[str] = []
    for param in definition.get("parameters", []):
        if (param.get("optionsFrom") or {}).get("list") == list_id:
            usages.append(f"{param.get('label') or param.get('id')} の選択肢")
    for record in definition.get("records", []):
        label = record.get("label") or record.get("id")
        if (record.get("keysFrom") or {}).get("list") == list_id:
            usages.append(f"{label} の行")
        for field in record.get("fields", []):
            if (field.get("optionsFrom") or {}).get("list") == list_id:
                usages.append(f"{label} の {field.get('label') or field.get('id')} の選択肢")
    return tuple(dict.fromkeys(usages))


def group_by_list(pending: tuple[PendingOptionList, ...]) -> list[tuple[str, list[PendingOptionList]]]:
    """一覧(id)ごとに、ブリッジの並び(定義順 → 宛先の順)を保ってまとめる。反映は一覧の単位なので。"""
    groups: dict[str, list[PendingOptionList]] = {}
    for item in pending:
        groups.setdefault(item.list_id, []).append(item)
    return list(groups.items())


def request_apply(state: SurfaceState, list_id: str | None = None) -> bool:
    if state.apply_runtime_options(list_id):
        return True
    notify(OFFLINE_MESSAGE, type="warning")
    return False


class PendingOptionsPanel:
    """反映待ちがある間だけ中身を描く。画面の作り直しの外に置き、ページの同期タイマーから sync を呼ぶ。"""

    def __init__(self, state: SurfaceState) -> None:
        self._state = state
        self._revision: tuple[int, int] = (-1, -1)
        self._container: Any = None

    def build(self) -> None:
        self._container = ui.column().classes("w-full items-stretch")
        self._revision = (-1, -1)
        self.sync()

    def sync(self) -> None:
        # 使用箇所の文言は定義から引くため、反映待ちが同じままでも定義が変われば描き直す
        # (ブリッジは参照が残る一覧の反映待ちを引き継ぎ、pending_options_revision が増えない)
        revision = (self._state.pending_options_revision, self._state.surface_revision)
        if self._container is None or self._revision == revision:
            return
        self._revision = revision
        self._container.clear()
        pending = self._state.pending_options
        if not pending:
            return
        with self._container, ui.card().classes("w-full q-pa-sm").props("flat bordered").style(
            "border-color: var(--q-warning)"
        ):
            with ui.row().classes("w-full items-center justify-between no-wrap"):
                with ui.row().classes("items-center no-wrap gap-1"):
                    ui.icon("new_releases", color="warning")
                    ui.label(TITLE).classes("text-subtitle2")
                ui.button(APPLY_ALL_LABEL, on_click=lambda _e=None: request_apply(self._state)).props(
                    "dense no-caps color=warning"
                ).classes("whitespace-nowrap").mark("pending-apply-all")
            ui.label(HINT).classes("text-caption text-grey-7")
            for list_id, items in group_by_list(pending):
                usages = list_usages(self._state.definition, list_id)
                with ui.row().classes("w-full items-start justify-between no-wrap q-mt-xs"):
                    with ui.column().classes("gap-0 min-w-0"):
                        # 使っている欄で示す(一覧の id は定義の中の名前で、操作者には分かりにくい)
                        heading = list_id if not usages else "、".join(usages)
                        ui.label(heading).classes("text-caption text-weight-medium break-all")
                        for item in items:
                            ui.label(change_summary(item)).classes("text-caption break-all")
                    ui.button(
                        APPLY_LABEL,
                        on_click=lambda _e=None, target=list_id: request_apply(self._state, target),
                    ).props("flat dense no-caps color=warning").classes("whitespace-nowrap").mark("pending-apply")
