"""編集モードの画面(HID-165)。

編集の規則はブリッジが持つ(D-123)。ここは操作を編集命令にして EditSession へ渡し、ブリッジが返した作業コピーを描くだけにする。
配置の変更は本番モードでは出さない(認証が無いので鍵ではなく誤操作防止の切り替え)。
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from typing import Any

from nicegui import events, ui

from . import surface_editor as editor
from .notify_history import notify
from .protocol import is_valid_surface_name
from .surface_editor import EditSession, NodeRef, Step, node_at, parameter_form, ref_payload

WIDTH_OPTIONS = {"": "指定なし", "auto": "自動", **{str(n): f"{n}/12" for n in range(1, 13)}}
KIND_NAMES = {
    "control": "部品",
    "action": "アクション",
    "record": "レコード表",
    "row": "行",
    "column": "列",
    "group": "グループ",
    "tabs": "タブ",
}


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
        has_osc: Callable[[], bool] = lambda: True,
    ) -> None:
        self.session = session
        # OSC のアドレスの欄は、ブリッジが OSC のアダプタを持つときだけ出す(HID-389・D-117)
        self._has_osc = has_osc
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
            self._render_records()

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
                ui.button(icon="arrow_upward", on_click=lambda _e=None, r=ref: self._edit_node("moveNode", r, delta=-1)).props("flat dense round size=sm")
                ui.button(icon="arrow_downward", on_click=lambda _e=None, r=ref: self._edit_node("moveNode", r, delta=1)).props("flat dense round size=sm")
                ui.select(
                    WIDTH_OPTIONS,
                    value=str(node.get("width", "")),
                    on_change=lambda e, r=ref: self._on_width(r, e.value),
                ).props("dense outlined").classes("w-24")
                ui.button("横並び", on_click=lambda _e=None, r=ref: self._edit_node("mergeWithNext", r)).props("flat dense no-caps size=sm")
                if kind == "group":
                    ui.switch("閉じて開始", value=bool(node.get("collapsed", False)), on_change=lambda e, r=ref: self._on_collapsed(r, bool(e.value)))
                if kind in editor.WRAP_KINDS:
                    ui.button("解く", on_click=lambda _e=None, r=ref: self._edit_node("unwrapNode", r)).props("flat dense no-caps size=sm")
                else:
                    ui.button("グループ化", on_click=lambda _e=None, r=ref: self._edit_node("wrapNode", r, kind="group")).props("flat dense no-caps size=sm")
                ui.button(icon="close", on_click=lambda _e=None, r=ref: self._edit_node("removeNode", r)).props("flat dense round size=sm color=negative")
            if kind == "tabs":
                for tab_index, tab in enumerate(node["tabs"]):
                    ui.label(f"タブ: {tab['label']}").classes("text-caption q-pl-md")
                    self._render_nodes(tab["children"], screen, (*steps, (index, tab_index)))
            elif kind not in editor.LEAF_KINDS:
                self._render_nodes(node["children"], screen, (*steps, index))

    def _node_text(self, node: dict[str, Any]) -> str:
        kind = node["kind"]
        if kind == "control":
            return f"部品: {node.get('label') or node['param']} ({node['param']})"
        if kind == "action":
            return f"アクション: {node.get('label') or node['action']} ({node['action']})"
        if kind == "record":
            return f"レコード表: {node.get('label') or node['record']} ({node['record']})"
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
                ui.button(
                    f"{param_id} を置く", on_click=lambda _e=None, p=param_id: self._edit({"op": "addControl", "screen": 0, "steps": [], "param": p})
                ).props("flat dense no-caps size=sm")

    def _render_parameters(self) -> None:
        ui.label("パラメータ").classes("text-caption text-weight-medium")
        for parameter in self.session.draft["parameters"]:
            address = editor.parameter_address(self.session.draft, parameter["id"]) if self._has_osc() else None
            with ui.row().classes("w-full items-center no-wrap"):
                ui.label(f"{parameter['id']}  {address or ''}  ({parameter['type']}, {parameter['kind']})").classes("col text-body2 break-all")
                ui.button("編集", on_click=lambda _e=None, p=parameter: self._open_parameter_dialog(p)).props("flat dense no-caps size=sm")
                ui.button(
                    icon="delete", on_click=lambda _e=None, i=parameter["id"]: self._edit({"op": "removeParameter", "param": i})
                ).props("flat dense round size=sm color=negative")
        ui.button("パラメータを追加", on_click=lambda _e=None: self._open_parameter_dialog(None)).props("flat dense no-caps")

    def _render_records(self) -> None:
        """レコード(D-061)は一覧の表示だけ。編集フォームは持たず、JSON のアップロード/ダウンロードで扱う(D-064)。"""
        records = self.session.draft.get("records", [])
        if not records:
            return
        ui.label("レコード(編集は JSON で行います)").classes("text-caption text-weight-medium")
        for record in records:
            fields = ", ".join(f"{field['id']}:{field['type']}" for field in record["fields"]) or "フィールドなし"
            keys = record["keysFrom"]["list"]
            address = ""
            if self._has_osc():
                address = editor.record_address(self.session.draft, record["id"]) or ""
                binding = editor.list_binding(self.session.draft, keys)
                keys = binding["address"] if binding is not None else keys
            ui.label(f"{record['id']}  {address}  ({record['kind']}, キー: {keys}, {fields})").classes("text-body2 break-all")

    # --- 操作 -------------------------------------------------------------

    def sync(self) -> None:
        """ページの同期タイマーから呼ぶ(D-021)。ブリッジの答えを作業コピーへ取り込み、変わったら描き直す。"""
        if self.session.settle():
            self.refresh()

    def _edit(self, edit: dict[str, Any], *, on_ok: Callable[[], None] | None = None, failure: str = "変更できません") -> None:
        """編集命令を送る。規則と検証はブリッジ(D-123)で、断られたら理由を出し、作業コピーは変えない。"""
        card = self._card

        def on_error(detail: str) -> None:
            # 答えは同期タイマーの中で届く。通知をこのページに出すため、枠に入る
            with card:
                notify(f"{failure}: {detail}", type="negative")
            # 断られた操作で動いたスイッチ・選択(閉じて開始・幅)を作業コピーの値へ戻す
            self.refresh()

        if not self.session.submit(edit, on_ok=on_ok, on_error=on_error):
            # 前の変更の答えを待っている(描いた位置が古いかもしれないので受けない)。動いたスイッチ・選択を戻す
            with card:
                notify("前の変更を反映しています。反映してからもう一度操作してください", type="warning")
            self.refresh()

    def _edit_node(self, op: str, ref: NodeRef, **fields: Any) -> None:
        self._edit({"op": op, "ref": ref_payload(ref), **fields})

    def _on_width(self, ref: NodeRef, raw: str) -> None:
        width: int | str | None = None if raw == "" else ("auto" if raw == "auto" else int(raw))
        if self.session.busy:
            # 答えを待つ作業コピーは古いので比べない(元の値へ戻す操作を「変わっていない」と捨てない)。断って描き直す
            self._edit_node("setWidth", ref, width=width)
            return
        node = node_at(self.session.draft, ref)
        if node is None or node.get("width") == width:
            return  # 再描画で戻した値による発火では何もしない
        self._edit_node("setWidth", ref, width=width)

    def _on_collapsed(self, ref: NodeRef, collapsed: bool) -> None:
        if self.session.busy:
            self._edit_node("setCollapsed", ref, collapsed=collapsed)
            return
        node = node_at(self.session.draft, ref)
        if node is None or bool(node.get("collapsed", False)) == collapsed:
            return  # 再描画で戻した値による発火では何もしない
        self._edit_node("setCollapsed", ref, collapsed=collapsed)

    def _open_parameter_dialog(self, parameter: dict[str, Any] | None) -> None:
        existing = parameter is not None
        if parameter is not None and parameter.get("type") == "composite":
            # 組み合わせの型(D-121)のフィールドはこのフォームで表せない。フォームで作り直すとフィールドを失うので開かない
            # (設計図から作るか、定義ファイルを書き出して編集する。画面の並べ替え・削除はこれまでどおりできる)
            notify("組み合わせの型のパラメータはこのフォームでは編集できません(定義ファイルで編集してください)", type="warning")
            return
        base = parameter or {
            "id": suggest_parameter_id({p["id"] for p in self.session.draft["parameters"]}),
            "label": "",
            "kind": "state",
            "type": "f",
        }
        has_osc = self._has_osc()
        draft = self.session.draft
        fields: dict[str, Any] = {}
        with ui.dialog() as dialog, ui.card().classes("w-96"):
            ui.label("パラメータ").classes("text-subtitle2")
            fields["id"] = ui.input("id", value=base["id"])
            if has_osc:
                fields["address"] = ui.input("アドレス", value=(editor.parameter_address(draft, base["id"]) if existing else None) or "/")
            fields["label"] = ui.input("表示名", value=base.get("label", ""))
            fields["kind"] = ui.select(["state", "trigger"], label="kind", value=base["kind"])
            fields["type"] = ui.select(["i", "f", "s", "bool"], label="型", value=base["type"])
            fields["standalone"] = ui.switch("単独で送る", value=base.get("standalone", True))
            # 表示ヒント(D-103)。空は「型と制約から決める」。フォームで作り直しても失わないよう編集項目に持つ
            fields["widget"] = ui.select(["", "slider", "switch", "button", "input", "select"], label="表示ヒント(空で自動)", value=base.get("widget", ""))
            value_range = base.get("range") or ["", ""]
            fields["min"] = ui.input("最小", value=str(value_range[0]))
            fields["max"] = ui.input("最大", value=str(value_range[1]))
            fields["step"] = ui.input("刻み", value=str(base.get("step", "")))
            fields["options"] = ui.input("候補(カンマ区切り)", value=",".join(base.get("options", [])))
            options_from = base.get("optionsFrom", {})
            if has_osc:
                list_source = editor.list_binding(draft, options_from["list"]) if options_from else None
                fields["options_from_address"] = ui.input("Unity の一覧のアドレス(s の state)", value=(list_source or {}).get("address", ""))
                fields["options_from_request"] = ui.input("一覧の要求アドレス(省略可)", value=(list_source or {}).get("request", ""))
            else:
                fields["options_from_list"] = ui.input("実行時の一覧の id(s の state)", value=options_from.get("list", ""))
            fields["default"] = ui.input("既定値(bool は true/false)", value=_bool_text(base.get("default", "")))
            fields["value"] = ui.input("送信値(trigger)", value=_bool_text(base.get("value", "")))

            def commit() -> None:
                form = {key: (field.value if key in ("kind", "type", "standalone") else str(field.value or "")) for key, field in fields.items()}
                # フォームの読み取り(数値・範囲・一覧)と定義全体の検証はブリッジ(D-123)。通ったときだけダイアログを閉じる
                self._edit(
                    {"op": "setParameter", "original": base["id"] if existing else None, "form": parameter_form(form, has_osc=has_osc)},
                    on_ok=dialog.close,
                    failure="保存できません",
                )

            with ui.row().classes("w-full justify-end"):
                ui.button("キャンセル", on_click=dialog.close).props("flat no-caps")
                ui.button("OK", on_click=commit).props("no-caps color=primary")
        dialog.open()

    def _on_load(self) -> None:
        name = self._load_select.value
        if not name:
            notify("読み込む定義を選んでください", type="warning")
            return
        self._load(name)
        notify(f"{name} の読み込みを要求しました", type="info")

    def _on_save(self) -> None:
        name = str(self._name_input.value or "").strip()
        if not is_valid_surface_name(name):
            notify("保存名は英数字で始まる英数字・_・- の 1〜64 文字にしてください", type="negative")
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
        if self.session.busy:
            # 答えを待つ変更を含まない作業コピーを保存しないように(保存したつもりの変更が落ちる)
            notify("前の変更を反映しています。反映してから保存してください", type="warning")
            return
        if not self._save(name, self.session.draft):
            notify("ブリッジに接続していないため保存できません", type="negative")
            return
        notify(f"{name} の保存を要求しました", type="info")

    def _on_download(self) -> None:
        if self.session.busy:
            notify("前の変更を反映しています。反映してからダウンロードしてください", type="warning")
            return
        text = json.dumps(self.session.draft, ensure_ascii=False, indent=2)
        ui.download(text.encode("utf-8"), f"{safe_filename(self._name_input.value or self.session.draft['name'])}.json")

    async def _on_upload(self, event: events.UploadEventArguments) -> None:
        try:
            loaded = json.loads((await _read_upload(event)).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            notify(f"JSON として読めません: {error}", type="negative")
            return
        # 版 1 のファイル(パラメータに address を書く形)を版 2 へ移すのも、検証もブリッジ(D-123)
        card = self._card

        def on_ok() -> None:
            with card:
                notify("アップロードした定義を作業コピーに読み込みました。保存すると採用されます", type="info")

        self._edit({"op": "replace", "definition": loaded}, on_ok=on_ok, failure="定義として不正です")


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
