"""編集モードの画面(HID-165)。

編集の規則は surface_editor.py に集め、ここは操作を受けて EditSession へ渡し、結果を描くだけにする。
配置の変更は本番モードでは出さない(認証が無いので鍵ではなく誤操作防止の切り替え)。
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from typing import Any

from nicegui import events, ui

from . import surface_editor as editor
from .protocol import is_valid_surface_name
from .surface_editor import EditSession, NodeRef, Step

WIDTH_OPTIONS = {"": "指定なし", "auto": "自動", **{str(n): f"{n}/12" for n in range(1, 13)}}
KIND_NAMES = {"control": "部品", "row": "行", "column": "列", "group": "グループ", "tabs": "タブ"}


def suggest_parameter_id(existing: set[str], base: str = "param") -> str:
    """重複しない id の候補(base1, base2 ...)。"""
    number = 1
    while f"{base}{number}" in existing:
        number += 1
    return f"{base}{number}"


def safe_filename(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "_", name) or "surface"


class EditorPanel:
    """作業コピーの木とパラメータ一覧を描き、操作を EditSession へ渡す。"""

    def __init__(
        self,
        session: EditSession,
        *,
        save: Callable[[str, dict[str, Any]], bool],
        load: Callable[[str], None],
        current_revision: Callable[[], int],
        saved_names: Callable[[], tuple[str, ...]],
        active_name: Callable[[], str | None],
    ) -> None:
        self.session = session
        self._save = save
        self._load = load
        self._current_revision = current_revision
        self._saved_names = saved_names
        self._active_name = active_name
        self._body: ui.column | None = None
        self._conflict_label: ui.label | None = None
        self._save_name = session.base_name or ""

    # --- 描画 -------------------------------------------------------------

    def build(self) -> None:
        with ui.card().classes("w-full q-pa-sm") as card:
            self._card = card
            ui.label("編集モード").classes("text-subtitle2")
            self._conflict_label = ui.label("").classes("text-caption text-negative")
            self._build_file_row()
            self._body = ui.column().classes("w-full items-stretch").style("gap:6px")
        self.refresh()

    def _build_file_row(self) -> None:
        with ui.row().classes("w-full items-center q-gutter-x-sm"):
            self._load_select = ui.select(list(self._saved_names()), label="保存済み", value=None).props("dense outlined").classes("min-w-40")
            ui.button("読み込み", on_click=self._on_load).props("flat dense no-caps")
            self._name_input = ui.input("保存名", value=self._save_name).props("dense outlined").classes("min-w-32")
            ui.button("保存", on_click=self._on_save).props("dense no-caps color=primary")
            ui.button("ダウンロード", on_click=self._on_download).props("flat dense no-caps")
            ui.upload(label="アップロード", auto_upload=True, max_files=1, on_upload=self._on_upload).props("flat dense accept=.json").classes("max-w-48")

    def set_save_name(self, name: str) -> None:
        """採用中の定義が替わったとき、保存先の名前も追従させる(古い名前への上書き保存を防ぐ)。"""
        self._save_name = name
        self._name_input.value = name

    def refresh(self) -> None:
        """作業コピーが変わったときと、保存済み一覧・競合が変わったときに描き直す。"""
        if self._body is None:
            return
        self._load_select.set_options(list(self._saved_names()))
        self._update_conflict()
        self._body.clear()
        definition = self.session.draft
        with self._body:
            for screen_index, screen in enumerate(definition["screens"]):
                ui.label(f"画面: {screen['label']}").classes("text-caption text-weight-medium")
                self._render_nodes(screen["children"], screen_index, ())
            self._render_unplaced()
            self._render_parameters()

    def _update_conflict(self) -> None:
        if self._conflict_label is None:
            return
        conflicted = self.session.is_conflicted(self._current_revision())
        self._conflict_label.text = (
            "編集を始めたあとに、別の端末などが定義を保存しました。保存すると上書きされます(読み込み直すと作業中の内容は失われます)。"
            if conflicted and self.session.dirty
            else ""
        )

    def _render_nodes(self, nodes: list[dict[str, Any]], screen: int, steps: tuple[Step, ...]) -> None:
        for index, node in enumerate(nodes):
            ref: NodeRef = (screen, steps, index)
            kind = node["kind"]
            with ui.row().classes("w-full items-center no-wrap q-pl-sm").style(f"border-left:{2 if steps else 0}px solid #bbb"):
                ui.label(self._node_text(node)).classes("col text-body2")
                ui.button(icon="arrow_upward", on_click=lambda _e=None, r=ref: self._apply(editor.move_node, r, -1)).props("flat dense round size=sm")
                ui.button(icon="arrow_downward", on_click=lambda _e=None, r=ref: self._apply(editor.move_node, r, 1)).props("flat dense round size=sm")
                ui.select(
                    WIDTH_OPTIONS,
                    value=str(node.get("width", "")),
                    on_change=lambda e, r=ref: self._on_width(r, e.value),
                ).props("dense outlined").classes("w-24")
                ui.button("横並び", on_click=lambda _e=None, r=ref: self._apply(editor.merge_with_next, r)).props("flat dense no-caps size=sm")
                if kind == "group":
                    ui.switch("閉じて開始", value=bool(node.get("collapsed", False)), on_change=lambda e, r=ref: self._apply(editor.set_collapsed, r, e.value))
                if kind in editor.WRAP_KINDS:
                    ui.button("解く", on_click=lambda _e=None, r=ref: self._apply(editor.unwrap_node, r)).props("flat dense no-caps size=sm")
                else:
                    ui.button("グループ化", on_click=lambda _e=None, r=ref: self._apply(editor.wrap_node, r, "group")).props("flat dense no-caps size=sm")
                ui.button(icon="close", on_click=lambda _e=None, r=ref: self._apply(editor.remove_node, r)).props("flat dense round size=sm color=negative")
            if kind == "tabs":
                for tab_index, tab in enumerate(node["tabs"]):
                    ui.label(f"タブ: {tab['label']}").classes("text-caption q-pl-md")
                    self._render_nodes(tab["children"], screen, (*steps, (index, tab_index)))
            elif kind != "control":
                self._render_nodes(node["children"], screen, (*steps, index))

    def _node_text(self, node: dict[str, Any]) -> str:
        kind = node["kind"]
        if kind == "control":
            return f"部品: {node.get('label') or node['param']} ({node['param']})"
        if kind == "group":
            return f"グループ: {node['label']}"
        return KIND_NAMES[kind]

    def _render_unplaced(self) -> None:
        unplaced = editor.unplaced_parameter_ids(self.session.draft)
        if not unplaced:
            return
        ui.label("未配置のパラメータ").classes("text-caption text-weight-medium")
        with ui.row().classes("w-full items-center q-gutter-x-sm"):
            for param_id in unplaced:
                ui.button(f"{param_id} を置く", on_click=lambda _e=None, p=param_id: self._apply(editor.add_control, 0, p)).props("flat dense no-caps size=sm")

    def _render_parameters(self) -> None:
        ui.label("パラメータ").classes("text-caption text-weight-medium")
        for parameter in self.session.draft["parameters"]:
            with ui.row().classes("w-full items-center no-wrap"):
                ui.label(f"{parameter['id']}  {parameter['address']}  ({parameter['type']}, {parameter['kind']})").classes("col text-body2 break-all")
                ui.button("編集", on_click=lambda _e=None, p=parameter: self._open_parameter_dialog(p)).props("flat dense no-caps size=sm")
                ui.button(icon="delete", on_click=lambda _e=None, i=parameter["id"]: self._apply(editor.remove_parameter, i)).props("flat dense round size=sm color=negative")
        ui.button("パラメータを追加", on_click=lambda _e=None: self._open_parameter_dialog(None)).props("flat dense no-caps")

    # --- 操作 -------------------------------------------------------------

    def _apply(self, edit: Callable[..., Any], *args: Any) -> None:
        error = self.session.apply(edit, *args)
        if error is not None:
            ui.notify(f"変更できません: {error}", type="negative")
        self.refresh()

    def _on_width(self, ref: NodeRef, raw: str) -> None:
        width: int | str | None = None if raw == "" else ("auto" if raw == "auto" else int(raw))
        nodes, index = editor._locate(self.session.draft, ref)
        if nodes[index].get("width") == width:
            return  # 再描画で戻した値による発火では何もしない
        self._apply(editor.set_width, ref, width)

    def _open_parameter_dialog(self, parameter: dict[str, Any] | None) -> None:
        existing = parameter is not None
        base = parameter or {
            "id": suggest_parameter_id({p["id"] for p in self.session.draft["parameters"]}),
            "address": "/",
            "label": "",
            "kind": "state",
            "type": "f",
        }
        fields: dict[str, Any] = {}
        with ui.dialog() as dialog, ui.card().classes("w-96"):
            ui.label("パラメータ").classes("text-subtitle2")
            fields["id"] = ui.input("id", value=base["id"])
            fields["address"] = ui.input("アドレス", value=base["address"])
            fields["label"] = ui.input("表示名", value=base.get("label", ""))
            fields["kind"] = ui.select(["state", "trigger"], label="kind", value=base["kind"])
            fields["type"] = ui.select(["i", "f", "s", "bool"], label="型", value=base["type"])
            fields["standalone"] = ui.switch("単独で送る", value=base.get("standalone", True))
            value_range = base.get("range") or ["", ""]
            fields["min"] = ui.input("最小", value=str(value_range[0]))
            fields["max"] = ui.input("最大", value=str(value_range[1]))
            fields["step"] = ui.input("刻み", value=str(base.get("step", "")))
            fields["options"] = ui.input("候補(カンマ区切り)", value=",".join(base.get("options", [])))
            fields["default"] = ui.input("既定値(bool は true/false)", value=_bool_text(base.get("default", "")))
            fields["value"] = ui.input("送信値(trigger)", value=_bool_text(base.get("value", "")))

            def commit() -> None:
                form = {key: (field.value if key in ("kind", "type", "standalone") else str(field.value or "")) for key, field in fields.items()}
                try:
                    built = editor.build_parameter(form)
                except editor.EditError as error:
                    ui.notify(str(error), type="negative")
                    return
                if existing:
                    error = self.session.apply(editor.update_parameter, base["id"], built)
                else:
                    error = self.session.apply(editor.add_parameter, built)
                if error is not None:
                    ui.notify(f"保存できません: {error}", type="negative")
                    return
                dialog.close()
                self.refresh()

            with ui.row().classes("w-full justify-end"):
                ui.button("キャンセル", on_click=dialog.close).props("flat no-caps")
                ui.button("OK", on_click=commit).props("no-caps color=primary")
        dialog.open()

    def _on_load(self) -> None:
        name = self._load_select.value
        if not name:
            ui.notify("読み込む定義を選んでください", type="warning")
            return
        self._load(name)
        ui.notify(f"{name} の読み込みを要求しました", type="info")

    def _on_save(self) -> None:
        name = str(self._name_input.value or "").strip()
        if not is_valid_surface_name(name):
            ui.notify("保存名は英数字で始まる英数字・_・- の 1〜64 文字にしてください", type="negative")
            return
        conflicted = self.session.is_conflicted(self._current_revision()) and self.session.dirty
        if conflicted:
            self._confirm_overwrite(name)
            return
        self._send_save(name)

    def _confirm_overwrite(self, name: str) -> None:
        with ui.dialog() as dialog, ui.card():
            ui.label("別の端末などが先に定義を保存しています。上書きして保存しますか?")
            with ui.row().classes("w-full justify-end"):
                ui.button("やめる", on_click=dialog.close).props("flat no-caps")

                def overwrite() -> None:
                    dialog.close()
                    self._send_save(name)

                ui.button("上書き保存", on_click=overwrite).props("no-caps color=negative")
        dialog.open()

    def _send_save(self, name: str) -> None:
        if not self._save(name, self.session.draft):
            ui.notify("ブリッジに接続していないため保存できません", type="negative")
            return
        ui.notify(f"{name} の保存を要求しました", type="info")

    def _on_download(self) -> None:
        text = json.dumps(self.session.draft, ensure_ascii=False, indent=2)
        ui.download(text.encode("utf-8"), f"{safe_filename(self._name_input.value or self.session.draft['name'])}.json")

    async def _on_upload(self, event: events.UploadEventArguments) -> None:
        try:
            loaded = json.loads((await _read_upload(event)).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            ui.notify(f"JSON として読めません: {error}", type="negative")
            return
        error = self.session.replace(loaded)
        if error is not None:
            ui.notify(f"定義として不正です: {error}", type="negative")
            return
        ui.notify("アップロードした定義を作業コピーに読み込みました。保存すると採用されます", type="info")
        self.refresh()


def _bool_text(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


async def _read_upload(event: events.UploadEventArguments) -> bytes:
    # NiceGUI 3 は event.file(非同期 read)、2.x は event.content(同期ストリーム)。pyproject は >=2.0 を許す
    file = getattr(event, "file", None)
    if file is not None:
        return await file.read()
    return event.content.read()  # type: ignore[attr-defined]
