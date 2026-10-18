"""OSC パッドのタブ(D-080 / D-081)。

格子に並べたボタンを押すと、ボタンに登録したアドレスと引数の OSC を 1 つ送る。タブ上部のスイッチで
実行モードと編集モードを切り替え、編集モードではボタンを押すとその設定を右側の Inspector(Unity の
Inspector に倣った、見出しと「名前 | 値」の行の並び)で編集できる。

編集の規則は osc_pad.py の純粋関数に集め、ここは操作を受けて PadEditSession へ渡し、結果を描くだけにする。
パッドの正はブリッジが持ち、保存の結果は pad フレームで戻る(UI は保存成功を自分で確定しない)。
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, Literal

from nicegui import events, ui

from . import osc_pad as pads
from .notify_history import notify
from .osc_pad import PadEditError, PadEditSession, pad_digest
from .protocol import is_valid_surface_name

DEFAULT_BUTTON_COLOR = "#546E7A"
SELECTED_CLASS = "oscdesk-pad-selected"
DEFAULT_SAVE_NAME = "pad"

# 押した瞬間の見た目はブラウザだけで出す(サーバーとの往復を待たない)。長押しのメニュー・文字選択・
# ダブルタップの拡大を止め、タッチでも押した直後に pointerdown が届くようにする
_PAD_CSS = """
.oscdesk-pad-cell { position: relative; aspect-ratio: 4 / 3; min-height: 56px; border-radius: 8px; overflow: hidden;
  display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;
  user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; touch-action: manipulation;
  cursor: pointer; background-size: cover; background-position: center; background-repeat: no-repeat;
  box-shadow: 0 1px 3px rgba(0,0,0,.35); transition: transform 40ms, filter 40ms; }
.oscdesk-pad-cell.run:active { transform: scale(0.96); filter: brightness(0.75); }
.oscdesk-pad-cell.empty { box-shadow: none; border: 2px dashed #B0BEC5; background: transparent; cursor: default; }
.oscdesk-pad-cell.empty.edit { cursor: pointer; color: #90A4AE; }
.oscdesk-pad-cell.oscdesk-pad-selected { outline: 3px solid #FFB300; outline-offset: 2px; }
.oscdesk-pad-label { font-weight: 600; line-height: 1.2; padding: 2px 6px; word-break: break-word; }
.oscdesk-pad-label.over-image { position: absolute; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,.5); color: #fff; }
.oscdesk-pad-caption { font-size: 10px; opacity: .8; padding: 0 4px; word-break: break-all; }
.oscdesk-inspector { background: #C8C8C8; border: 1px solid #8F8F8F; border-radius: 4px; font-size: 12px; color: #111; }
.oscdesk-inspector .q-expansion-item__container > .q-item { background: #BDBDBD; border-top: 1px solid #9E9E9E;
  min-height: 28px; font-weight: 700; }
.oscdesk-inspector-row { display: grid; grid-template-columns: 92px minmax(0, 1fr); align-items: center; gap: 4px 8px;
  padding: 3px 8px; }
.oscdesk-inspector-row > .name { color: #222; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.oscdesk-inspector .q-field--outlined .q-field__control { background: #F2F2F2; }
@media (max-width: 600px) { .oscdesk-inspector-row { grid-template-columns: 64px minmax(0, 1fr); } }
"""

# 押下は左ボタン(タッチ・ペンの主接触を含む)の pointerdown だけで送る。click は指を離すまで待つので使わない
_PRESS_JS = "(e) => { if (e.button === 0) emit(); }"


def text_color_for(color: str) -> str:
    """背景色の上で読める文字色(白か黒)。相対輝度で決める。"""
    try:
        red, green, blue = (int(color[index:index + 2], 16) / 255 for index in (1, 3, 5))
    except (ValueError, IndexError):
        return "#FFFFFF"

    def linear(channel: float) -> float:
        return channel / 12.92 if channel <= 0.03928 else ((channel + 0.055) / 1.055) ** 2.4

    luminance = 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
    return "#000000" if luminance > 0.45 else "#FFFFFF"


def cell_style(button: dict[str, Any]) -> dict[str, str]:
    """ボタンのマスのインライン style(背景色・画像・文字色)。

    文字列の style(`a:b;c:d`)で渡さないのは、画像の data URL が `:` と `;` を含み、NiceGUI の style の
    文字列の解析で壊れるため。辞書で要素の style へ直接入れる。
    """
    color = button.get("color") or DEFAULT_BUTTON_COLOR
    style = {"background-color": color, "color": text_color_for(color)}
    if "image" in button:
        style["background-image"] = f'url("{button["image"]}")'
    return style


def _apply_cell_style(cell: ui.element, button: dict[str, Any]) -> None:
    with cell.style.suspend_updates():
        for key in ("background-color", "color", "background-image"):
            cell.style.pop(key, None)
        cell.style.update(cell_style(button))
    cell.update()


class OscPadPanel:
    """OSC パッドのタブの中身。ページに 1 つ持ち、画面の作り直しのたびに build で描き直す(作業コピーは保つ)。"""

    def __init__(self, state: Any) -> None:
        self._state = state
        self._editing = False
        self._session: PadEditSession | None = None
        self._selected: str | None = None
        self._save_name = ""
        self._seen: tuple[int, str] = (-1, "")
        self._css_added = False
        # 描いたマス(ボタン id → (マス, ラベル, 補助表示))。ラベルや色の編集でマスだけを書き換えるために持つ
        self._cells: dict[str, tuple[ui.element, ui.label, ui.label | None]] = {}
        self._root: ui.column | None = None
        # 実行モードで描いたパッドの版(pad フレームの version)。押下に載せ、描いた後に上書き保存・ブリッジの再起動が
        # あればブリッジが断る
        self._drawn_version = ""
        # 編集中に要求した切り替え(名前・要求時の版・要求時の下書き)。そのパッドが実際に採用されて届くまで下書きは
        # 捨てず、届いたときも要求の後に下書きを編集していれば捨てない(確認を取った下書きだけを捨てる)
        self._pending_load: tuple[str, str, dict[str, Any], int] | None = None
        # 未完了の保存の要求(名前・要求時の版・送った内容)。これに対応する採用が届いたときだけ保存済みにする
        # (他の端末がたまたま同じ内容のパッドを採用しても、頼んでいない保存を保存済みとみなさない)
        self._pending_save: tuple[str, str, dict[str, Any], int] | None = None
        self._adoption_seen = 0

    # --- 描画 -------------------------------------------------------------

    def build(self) -> None:
        if not self._css_added:
            ui.add_css(_PAD_CSS)
            self._css_added = True
        with ui.column().classes("w-full items-stretch q-pa-sm").style("gap:8px") as root:
            self._root = root
            # 当たり判定はスイッチ本体だけ(HID-255 と同じ。文字まで押せると実行中に誤って編集へ入る)
            with ui.row().classes("self-start items-center no-wrap gap-1"):
                self._switch = ui.switch(value=self._editing, on_change=self._on_toggle).props('aria-label="パッドを編集"')
                ui.label("パッドを編集").classes("select-none")
                self._title = ui.label("").classes("text-caption text-grey-7 q-ml-md")
                self._dirty_label = ui.label("").classes("text-caption text-warning q-ml-sm")
            self._toolbar = ui.row().classes("w-full items-center q-gutter-x-sm")
            self._conflict_label = ui.label("").classes("text-caption text-negative")
            # 狭い画面では Inspector が格子の下へ回る(flex の折り返し)
            with ui.element("div").classes("w-full").style("display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start"):
                self._grid_box = ui.element("div").style("flex:2 1 320px;min-width:min(100%,280px)")
                self._inspector_box = ui.element("div").style("flex:1 1 300px;min-width:min(100%,280px)")
        # _seen はここでは進めない。定義の再配信とパッドの採用が同じ同期の周期に届くと、作り直し(build)が先に走る。
        # ここで進めると、続く sync が採用の照合(保存・切り替えの確認、競合の警告)を飛ばしてしまう。照合は sync だけが行う
        self._render_all()

    def _cache_key(self) -> tuple[int, str]:
        cache = self._state.pad
        return (cache.revision, cache.version)

    def _current_pad(self) -> dict[str, Any] | None:
        if self._session is not None:
            return self._session.draft
        return self._state.pad.pad

    def _render_all(self) -> None:
        self._render_header()
        self._render_toolbar()
        self._render_grid()
        self._render_inspector()

    def _render_header(self) -> None:
        cache = self._state.pad
        if self._session is not None:
            name = self._session.base_name or "(新規)"
            self._title.text = f"編集中: {name}"
            self._dirty_label.text = "未保存の変更があります" if self._session.dirty else ""
            conflicted = self._session.is_conflicted(cache.version)
            self._conflict_label.text = "別の端末などがパッドを保存・切り替えました。保存すると上書きします" if conflicted else ""
        else:
            self._title.text = f"パッド: {cache.name}" if cache.name else "パッド: 未選択"
            self._dirty_label.text = ""
            self._conflict_label.text = ""

    def _render_toolbar(self) -> None:
        self._toolbar.clear()
        if self._session is None:
            return
        with self._toolbar:
            self._load_select = ui.select(list(self._state.pad.names), label="保存済み", value=None).props("dense outlined").classes("min-w-40")
            ui.button("切り替え", on_click=self._on_load).props("flat dense no-caps")
            self._name_input = ui.input("保存名", value=self._save_name).props("dense outlined").classes("min-w-32")
            ui.button("保存", on_click=self._on_save).props("dense no-caps color=primary")
            ui.button("新規", on_click=self._on_new).props("flat dense no-caps")

    def _render_grid(self) -> None:
        self._grid_box.clear()
        self._cells = {}
        pad = self._current_pad()
        editing = self._session is not None
        if not editing:
            self._drawn_version = self._state.pad.version
        with self._grid_box:
            if pad is None:
                ui.label("パッドがありません。「パッドを編集」をオンにして作ります。").classes("text-grey-7")
                return
            grid_style = f"display:grid;grid-template-columns:repeat({pad['columns']},minmax(0,1fr));gap:8px"
            with ui.element("div").classes("w-full").style(grid_style):
                for row in range(pad["rows"]):
                    for column in range(pad["columns"]):
                        button = pads.button_at(pad, row, column)
                        if button is None:
                            self._draw_empty(row, column, editing)
                        else:
                            self._draw_button(button, editing)

    def _draw_empty(self, row: int, column: int, editing: bool) -> None:
        cell = ui.element("div").classes("oscdesk-pad-cell empty" + (" edit" if editing else ""))
        if editing:
            with cell:
                ui.icon("add", size="sm")
            cell.on("click", lambda _event=None, r=row, c=column: self._on_add(r, c))

    def _draw_button(self, button: dict[str, Any], editing: bool) -> None:
        classes = "oscdesk-pad-cell " + ("edit" if editing else "run")
        if editing and button["id"] == self._selected:
            classes += f" {SELECTED_CLASS}"
        cell = ui.element("div").classes(classes).props("role=button")
        _apply_cell_style(cell, button)
        # ラベルは任意の文字列なので props の文字列解析を通さずに入れる(引用符で壊れないように)
        cell._props["aria-label"] = button["label"] or button["id"]
        with cell:
            label = ui.label(button["label"]).classes("oscdesk-pad-label" + (" over-image" if "image" in button else ""))
            caption = ui.label(button["address"]).classes("oscdesk-pad-caption") if editing else None
        self._cells[button["id"]] = (cell, label, caption)
        if editing:
            cell.on("click", lambda _event=None, bid=button["id"]: self._select(bid))
        else:
            # 押下からの遅れを作らないよう、ハンドラは送信待ちの列に積むだけにする(D-081)
            cell.on("pointerdown", lambda _event=None, bid=button["id"]: self._press(bid), js_handler=_PRESS_JS)

    def _refresh_cell(self, button_id: str) -> None:
        """ラベル・色・画像・アドレスの変更を、格子を作り直さずにそのマスだけへ映す(画像の再送を最小にする)。"""
        drawn = self._cells.get(button_id)
        pad = self._current_pad()
        button = None if pad is None else pads.find_button(pad, button_id)
        if drawn is None or button is None:
            self._render_grid()
            return
        cell, label, caption = drawn
        _apply_cell_style(cell, button)
        label.text = button["label"]
        if "image" in button:
            label.classes(add="over-image")
        else:
            label.classes(remove="over-image")
        if caption is not None:
            caption.text = button["address"]

    # --- Inspector --------------------------------------------------------

    def _render_inspector(self) -> None:
        self._inspector_box.clear()
        session = self._session
        self._inspector_box.set_visibility(session is not None)
        if session is None:
            return
        pad = session.draft
        button = None if self._selected is None else pads.find_button(pad, self._selected)
        with self._inspector_box:
            with ui.column().classes("oscdesk-inspector w-full items-stretch").style("gap:0"):
                with self._section("パッド"):
                    with self._row("行数"):
                        ui.select(list(range(1, pads.MAX_ROWS + 1)), value=pad["rows"],
                                  on_change=lambda e: self._resize(int(e.value), None)).props("dense outlined options-dense")
                    with self._row("列数"):
                        ui.select(list(range(1, pads.MAX_COLUMNS + 1)), value=pad["columns"],
                                  on_change=lambda e: self._resize(None, int(e.value))).props("dense outlined options-dense")
                if button is None:
                    ui.label("格子のボタンを押すと、ここで編集できます。空きマス(+)を押すとボタンを足します。").classes("q-pa-sm text-grey-8")
                    return
                self._inspect_button(pad, button)

    def _section(self, title: str) -> ui.expansion:
        # Unity の Inspector の折りたたみ見出しに倣う(左に開閉の印、太字の見出し)
        expansion = ui.expansion(title, value=True).classes("w-full").props("dense switch-toggle-side expand-separator")
        return expansion

    def _row(self, name: str) -> ui.element:
        row = ui.element("div").classes("oscdesk-inspector-row")
        with row:
            ui.label(name).classes("name")
        return row

    def _inspect_button(self, pad: dict[str, Any], button: dict[str, Any]) -> None:
        bid = button["id"]
        with self._section(f"ボタン ({bid})"):
            with self._row("ラベル"):
                ui.input(value=button["label"], on_change=lambda e: self._edit(lambda p: pads.set_label(p, bid, str(e.value or "")), "cell")).props(
                    f"dense outlined maxlength={pads.MAX_LABEL_CHARS}"
                )
            with self._row("背景色"):
                with ui.row().classes("items-center no-wrap gap-1"):
                    ui.color_input(value=button.get("color", ""), on_change=lambda e: self._on_color(bid, e.value), preview=True).props(
                        "dense outlined"
                    ).classes("grow")
                    ui.button(icon="format_color_reset", on_click=lambda: self._edit(lambda p: pads.set_color(p, bid, None), "all")).props(
                        "flat dense round size=sm"
                    ).tooltip("既定の色に戻す")
            with self._row("画像"):
                with ui.column().classes("items-stretch gap-1"):
                    if "image" in button:
                        with ui.row().classes("items-center no-wrap gap-1"):
                            ui.image(button["image"]).style("width:48px;height:36px;object-fit:cover;border-radius:4px")
                            ui.button("削除", on_click=lambda: self._edit(lambda p: pads.set_image(p, bid, None), "all")).props("flat dense no-caps")
                    # Quasar のアップローダーは一覧の枠が大きいので隠し、ボタンからファイルの選択だけを開く
                    upload = ui.upload(
                        auto_upload=True,
                        max_files=1,
                        max_file_size=pads.MAX_IMAGE_BYTES,
                        on_upload=lambda e: self._on_image(bid, e),
                        on_rejected=lambda: notify(f"画像は {pads.MAX_IMAGE_BYTES // 1024} KiB までです", type="negative"),
                    ).props("accept=image/png,image/jpeg,image/gif,image/webp").classes("hidden")
                    ui.button(
                        f"画像を選ぶ ({pads.MAX_IMAGE_BYTES // 1024} KiB まで)", icon="image",
                        on_click=lambda: upload.run_method("pickFiles"),
                    ).props("flat dense no-caps")
            with self._row("位置"):
                with ui.row().classes("items-center no-wrap gap-1"):
                    ui.select({r: f"{r + 1} 行" for r in range(pad["rows"])}, value=button["row"],
                              on_change=lambda e: self._move(bid, int(e.value), None)).props("dense outlined options-dense")
                    ui.select({c: f"{c + 1} 列" for c in range(pad["columns"])}, value=button["column"],
                              on_change=lambda e: self._move(bid, None, int(e.value))).props("dense outlined options-dense")
            with ui.row().classes("w-full justify-end q-px-sm q-pb-sm"):
                ui.button("ボタンを削除", icon="delete", on_click=lambda: self._remove(bid)).props("flat dense no-caps color=negative")

        with self._section("OSC"):
            with self._row("アドレス"):
                ui.input(
                    value=button["address"],
                    validation=lambda value: pads.address_problem(str(value or "")),
                    on_change=lambda e: self._on_address(bid, str(e.value or "")),
                ).props("dense outlined")
            for index, arg in enumerate(button["args"]):
                self._inspect_arg(bid, index, arg, len(button["args"]))
            with ui.row().classes("w-full items-center justify-between q-px-sm q-pb-sm"):
                ui.label(f"{len(button['args'])} / {pads.MAX_ARGS} 個").classes("text-grey-8")
                ui.button("引数を追加", icon="add", on_click=lambda: self._edit(lambda p: pads.add_arg(p, bid), "inspector")).props(
                    "flat dense no-caps"
                ).set_enabled(len(button["args"]) < pads.MAX_ARGS)

    def _inspect_arg(self, bid: str, index: int, arg: dict[str, Any], count: int) -> None:
        with self._row(f"引数 {index + 1}"):
            # 並べ替え・削除はメニューにまとめ、狭い画面でも値の欄の幅を残す
            with ui.row().classes("w-full items-center no-wrap gap-1"):
                ui.select(list(pads.ARG_TYPES), value=arg["type"],
                          on_change=lambda e: self._edit(lambda p: pads.set_arg_type(p, bid, index, str(e.value)), "inspector")).props(
                    "dense outlined options-dense"
                ).style("width:64px;flex:none")

                def problem(value: Any, arg_type: str = arg["type"]) -> str | None:
                    try:
                        pads.parse_arg_value(arg_type, str(value if value is not None else ""))
                    except PadEditError as error:
                        return str(error)
                    return None

                ui.input(value=pads.format_arg_value(arg), validation=problem,
                         on_change=lambda e: self._on_arg_value(bid, index, str(e.value if e.value is not None else ""))).props(
                    "dense outlined"
                ).style("flex:1 1 0;min-width:0")
                with ui.button(icon="more_vert").props("flat dense round size=sm").tooltip("並べ替え・削除"):
                    with ui.menu():
                        ui.menu_item("上へ", on_click=lambda: self._edit(lambda p: pads.move_arg(p, bid, index, -1), "inspector")).set_enabled(index > 0)
                        ui.menu_item("下へ", on_click=lambda: self._edit(lambda p: pads.move_arg(p, bid, index, 1), "inspector")).set_enabled(
                            index < count - 1
                        )
                        ui.menu_item("削除", on_click=lambda: self._edit(lambda p: pads.remove_arg(p, bid, index), "inspector"))

    # --- 同期 -------------------------------------------------------------

    def release(self) -> None:
        """ページの切断時に呼ぶ。編集中のまま閉じたブラウザが採用の履歴を押さえ続けないようにする。"""
        self._state.pad.drop_reader(self)

    def sync(self) -> None:
        """ページの同期タイマー(D-021)から呼ぶ。パネル自身はタイマーを持たない。

        build は定義の作り直しのたびに呼ばれ、NiceGUI はタブの要素を消してもその中の ui.timer を止めないので、
        パネルがタイマーを作ると作り直すたびに増えていく。
        """
        if self._root is None:
            return
        cache = self._state.pad
        # 読み手の登録は切断(NiceGUI 2.x では一時切断も)で外れることがある。キーが変わらず早期 return する周期でも、
        # 編集中なら元の既読位置で登録し直し、再接続後に保存の応答が刈り込まれないようにする
        if self._editing and self._session is not None:
            cache.set_reader(self, self._adoption_seen)
        key = self._cache_key()
        if key == self._seen:
            return
        self._seen = key
        session = self._session
        if session is None:
            self._render_all()
            return
        # 要求した切り替えが実際に採用されたら、破棄を確認済みの下書きを捨てて追従させる
        # (未接続や padLoad の拒否で採用されなければ、下書きは未保存のまま残る)。要求の後に下書きを編集していたら、
        # その編集は確認を取っていないので捨てず、未保存のまま残して知らせる(以後は通常の競合と同じ扱い)
        # 採用は最新だけでなく、前回の同期以降に届いた全件で照合する(同じ周期に自分の保存の採用と別名の採用が
        # 続けて届くと、最新だけを見る実装は保存の確認を取りこぼして dirty が残り、不要な上書き確認が出る)
        adoptions = cache.adoptions_since(self._adoption_seen)
        self._adoption_seen = cache.adoption_seq
        cache.set_reader(self, self._adoption_seen)
        for adoption in adoptions:
            pending = self._pending_load
            # 要求より前に届いていた採用は、その要求への応答ではない(後で拒否されたときに確認済みの下書きを捨てないため)
            if pending is not None and adoption.seq > pending[3] and adoption.name == pending[0] and adoption.version != pending[1]:
                self._pending_load = None
                if session.draft is pending[2] or session.draft == pending[2]:
                    session.dirty = False
                    self._pending_save = None
                else:
                    notify(f"{adoption.name} に切り替わりましたが、切り替えを頼んだ後の編集があるので下書きを残しました(保存するか、実行モードへ戻って破棄してください)", type="warning")
            saving = self._pending_save
            if saving is not None and adoption.seq > saving[3] and adoption.name == saving[0] and adoption.version != saving[1] and adoption.digest == pad_digest(saving[2]):
                self._pending_save = None
                still_edited = pad_digest(session.draft) != adoption.digest
                session.mark_saved(adoption.version, adoption.name)
                session.dirty = still_edited
                self._save_name = adoption.name or self._save_name
                if adoption is adoptions[-1]:
                    self._render_header()
                    self._render_toolbar()
                    return
        # 未編集なら、他の端末の保存・切り替えへ作業コピーを追従させる。編集中なら作業コピーは保って警告だけ出す
        if session.follow(cache.pad, cache.version, cache.name):
            self._save_name = cache.name or self._save_name
            if self._selected is not None and pads.find_button(session.draft, self._selected) is None:
                self._selected = None
            self._render_all()
            return
        self._render_header()
        self._render_toolbar()

    # --- 実行モード -------------------------------------------------------

    def _press(self, button_id: str) -> None:
        if not self._state.press_pad(button_id, self._drawn_version):
            notify("ブリッジに接続していないため送れませんでした", type="warning")

    # --- 編集モード -------------------------------------------------------

    def _on_toggle(self, event: Any) -> None:
        editing = bool(event.value)
        # コードからスイッチを戻したときにも呼ばれるので、状態が変わらないなら何もしない
        if editing == self._editing:
            return
        if editing:
            self._open_edit()
            return
        if self._session is not None and self._session.dirty:
            self._confirm("保存していない変更があります。破棄して実行モードへ戻りますか?", "破棄する", self._close_edit, self._keep_editing)
            return
        self._close_edit()

    def _open_edit(self) -> None:
        cache = self._state.pad
        self._editing = True
        self._session = PadEditSession.start(cache.pad, cache.version, cache.name)
        # 編集を始める前の採用は照合の対象にしない(作業コピーはいまの採用から始まる)
        self._adoption_seen = cache.adoption_seq
        cache.set_reader(self, self._adoption_seen)
        self._save_name = cache.name or DEFAULT_SAVE_NAME
        self._selected = None
        self._render_all()

    def _close_edit(self) -> None:
        self._editing = False
        self._state.pad.drop_reader(self)
        self._pending_load = None
        self._pending_save = None
        self._session = None
        self._selected = None
        self._switch.value = False
        self._render_all()

    def _keep_editing(self) -> None:
        self._switch.value = True

    def _confirm(self, message: str, ok_label: str, on_ok: Callable[[], None], on_cancel: Callable[[], None] | None = None) -> None:
        # persistent: 外側のクリックで閉じると、スイッチの表示と実際のモードがずれる
        with ui.dialog().props("persistent") as dialog, ui.card():
            ui.label(message)
            with ui.row().classes("w-full justify-end"):

                def cancel() -> None:
                    dialog.close()
                    if on_cancel is not None:
                        on_cancel()

                def ok() -> None:
                    dialog.close()
                    on_ok()

                ui.button("やめる", on_click=cancel).props("flat no-caps")
                ui.button(ok_label, on_click=ok).props("no-caps color=negative")
        dialog.open()

    def _edit(self, change: Callable[[dict[str, Any]], dict[str, Any]], refresh: Literal["cell", "grid", "inspector", "all"]) -> bool:
        session = self._session
        if session is None:
            return False
        try:
            updated = change(session.draft)
        except PadEditError as error:
            notify(str(error), type="negative")
            return False
        problem = session.apply(updated)
        if problem is not None:
            notify(f"パッドとして不正です: {problem}", type="negative")
            return False
        if refresh == "cell" and self._selected is not None:
            self._refresh_cell(self._selected)
        elif refresh == "grid":
            self._render_grid()
        elif refresh == "inspector":
            self._render_inspector()
            if self._selected is not None:
                self._refresh_cell(self._selected)
        else:
            self._render_grid()
            self._render_inspector()
        self._render_header()
        return True

    def _select(self, button_id: str) -> None:
        previous = self._cells.get(self._selected) if self._selected is not None else None
        if previous is not None:
            previous[0].classes(remove=SELECTED_CLASS)
        self._selected = button_id
        current = self._cells.get(button_id)
        if current is not None:
            current[0].classes(add=SELECTED_CLASS)
        self._render_inspector()

    def _on_add(self, row: int, column: int) -> None:
        session = self._session
        if session is None:
            return
        try:
            updated, button_id = pads.add_button(session.draft, row, column)
        except PadEditError as error:
            notify(str(error), type="negative")
            return
        if self._edit(lambda _pad: updated, "grid"):
            self._select(button_id)

    def _remove(self, button_id: str) -> None:
        if self._edit(lambda p: pads.remove_button(p, button_id), "grid"):
            self._selected = None
            self._render_inspector()

    def _move(self, button_id: str, row: int | None, column: int | None) -> None:
        session = self._session
        button = None if session is None else pads.find_button(session.draft, button_id)
        if button is None:
            return
        target_row = button["row"] if row is None else row
        target_column = button["column"] if column is None else column
        self._edit(lambda p: pads.move_button(p, button_id, target_row, target_column), "all")

    def _resize(self, rows: int | None, columns: int | None) -> None:
        session = self._session
        if session is None:
            return
        pad = session.draft
        target_rows = pad["rows"] if rows is None else rows
        target_columns = pad["columns"] if columns is None else columns
        if not self._edit(lambda p: pads.resize_pad(p, target_rows, target_columns), "all"):
            # 断ったときは選択欄を元の値へ戻す
            self._render_inspector()

    def _on_color(self, button_id: str, value: Any) -> None:
        text = str(value or "").strip()
        # 入力途中(#12 など)は送らない。正しい形になったら映す
        if text and not pads.is_valid_color(text):
            return
        self._edit(lambda p: pads.set_color(p, button_id, text or None), "cell")

    def _on_address(self, button_id: str, address: str) -> None:
        # 不正な間は作業コピーを変えない(欄の下に理由が出る)
        if pads.address_problem(address) is None:
            self._edit(lambda p: pads.set_address(p, button_id, address), "cell")

    def _on_arg_value(self, button_id: str, index: int, raw: str) -> None:
        try:
            self._edit_quiet(lambda p: pads.set_arg_value(p, button_id, index, raw))
        except PadEditError:
            pass  # 入力途中の値は欄の検証表示に任せ、通知は出さない

    def _edit_quiet(self, change: Callable[[dict[str, Any]], dict[str, Any]]) -> None:
        session = self._session
        if session is None:
            return
        if session.apply(change(session.draft)) is None:
            self._render_header()

    async def _on_image(self, button_id: str, event: events.UploadEventArguments) -> None:
        try:
            data_url = pads.image_data_url(await _read_upload(event))
        except PadEditError as error:
            notify(str(error), type="negative")
            return
        self._edit(lambda p: pads.set_image(p, button_id, data_url), "all")

    def _on_new(self) -> None:
        def start_new() -> None:
            session = self._session
            if session is None:
                return
            session.draft = pads.new_pad()
            session.dirty = True
            self._save_name = ""
            self._selected = None
            self._render_all()

        if self._session is not None and self._session.dirty:
            self._confirm("保存していない変更があります。破棄して新しいパッドを作りますか?", "破棄する", start_new)
            return
        start_new()

    def _on_load(self) -> None:
        name = self._load_select.value
        if not name:
            notify("切り替えるパッドを選んでください", type="warning")
            return

        def load() -> None:
            if not self._state.load_pad(name):
                notify("ブリッジに接続していないため切り替えられません", type="negative")
                return
            # 下書きはここでは捨てない。届いた pad が要求したものだったときに sync で追従させる
            session = self._session
            if session is not None:
                self._pending_load = (name, self._state.pad.version, session.draft, self._state.pad.adoption_seq)
            notify(f"{name} への切り替えを要求しました", type="info")

        if self._session is not None and self._session.dirty:
            self._confirm("保存していない変更があります。破棄して切り替えますか?", "破棄する", load)
            return
        load()

    def _on_save(self) -> None:
        session = self._session
        if session is None:
            return
        name = str(self._name_input.value or "").strip()
        if not is_valid_surface_name(name):
            notify("保存名は英数字で始まる英数字・_・- の 1〜64 文字にしてください", type="negative")
            return
        self._save_name = name
        size = pads.serialized_bytes(session.draft)
        if size > pads.MAX_SERIALIZED_BYTES:
            # ブリッジも同じ上限で断るが、送る前に理由を出す(画像や長い文字列を減らしてもらう)
            notify(
                f"パッドが大きすぎて保存できません({size // 1024} KiB / 上限 {pads.MAX_SERIALIZED_BYTES // 1024} KiB)。画像や長い文字列を減らしてください",
                type="negative",
            )
            return

        def send() -> None:
            draft = session.draft
            if not self._state.save_pad(name, draft):
                notify("ブリッジに接続していないため保存できません", type="negative")
                return
            self._pending_save = (name, self._state.pad.version, draft, self._state.pad.adoption_seq)
            notify(f"パッド {name} の保存を要求しました", type="info")

        if session.is_conflicted(self._state.pad.version):
            self._confirm("別の端末などが先にパッドを保存・切り替えています。上書きして保存しますか?", "上書き保存", send)
            return
        send()


async def _read_upload(event: events.UploadEventArguments) -> bytes:
    # NiceGUI 3 は event.file(非同期 read)、2.x は event.content(同期ストリーム)。pyproject は >=2.0 を許す
    file = getattr(event, "file", None)
    if file is not None:
        return await file.read()
    return event.content.read()  # type: ignore[attr-defined]
