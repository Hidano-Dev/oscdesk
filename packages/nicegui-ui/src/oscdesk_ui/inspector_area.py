"""アプリ全体の Inspector の領域(D-091)。

画面の右側(狭い画面では本体の上)の領域を、普段は宛先パネル(D-086 / D-089)が使い、部品の設定を編集する間だけ
Inspector が借りる。OSC パッドの編集でボタンを選んだとき、その設定をここに出す(格子の右に出すと格子が縮んで
実行モードとボタンの位置が変わるため)。

宛先パネルは借りている間も作り直さず、隠すだけにする(作り直すと、応答待ちの未確定の選択が消えるため。D-086)。
中身を描くのは借り手で、この領域は「誰が借りているか」と見出し・閉じる操作だけを持つ。
"""

from __future__ import annotations

from collections.abc import Callable

from nicegui import ui

# 領域(aside)に付ける印。狭い画面で Inspector を出している間だけ、本体の上に貼り付ける(page.BODY_CSS)
INSPECTING_CLASS = "oscdesk-aside-inspecting"


class InspectorArea:
    """右側の領域の切り替え。借り手は claim で中身の置き場(body)を受け取り、release で宛先パネルへ返す。"""

    def __init__(self) -> None:
        self._owner: object | None = None
        self._on_close: Callable[[], None] | None = None
        self._frame: ui.element | None = None
        self._default_box: ui.element | None = None
        self._inspector_box: ui.element | None = None
        self._title: ui.label | None = None
        self._body: ui.element | None = None

    def build(self, frame: ui.element, build_default: Callable[[], None]) -> None:
        """frame(右側の領域の要素)の中に、既定の中身(宛先パネル)と Inspector の置き場を作る。"""
        self._frame = frame
        with frame:
            with ui.element("div").classes("w-full") as default_box:
                build_default()
            self._default_box = default_box
            with ui.column().classes("w-full items-stretch q-pa-sm").style("gap:4px") as inspector_box:
                with ui.row().classes("w-full items-center justify-between no-wrap"):
                    with ui.row().classes("items-center no-wrap gap-1"):
                        ui.icon("tune", size="xs").classes("text-grey-8")
                        ui.label("Inspector").classes("text-subtitle2")
                        self._title = ui.label("").classes("text-caption text-grey-7")
                    # 閉じると借り手が選択を外し、宛先パネルへ戻る
                    ui.button(icon="close", on_click=self._close).props(
                        'flat dense round size=sm aria-label="Inspector を閉じて送信先へ戻る"'
                    ).tooltip("閉じて送信先へ戻る")
                self._body = ui.column().classes("w-full items-stretch").style("gap:0")
            self._inspector_box = inspector_box
        self._show(False)

    @property
    def owner(self) -> object | None:
        return self._owner

    @property
    def is_open(self) -> bool:
        return self._owner is not None

    def claim(self, owner: object, title: str, on_close: Callable[[], None]) -> ui.element | None:
        """owner が領域を借りる。中身を描く置き場(空にしてある)を返す。build 前なら None。

        別の借り手が借りていても奪う(同時に編集する部品は 1 つで、後から選んだものを出す)。
        """
        if self._body is None:
            return None
        self._owner = owner
        self._on_close = on_close
        if self._title is not None:
            self._title.text = title
        self._body.clear()
        self._show(True)
        return self._body

    def release(self, owner: object) -> None:
        """owner が借りていれば返す。借りていなければ何もしない(他の借り手の表示を消さない)。"""
        if self._owner is not owner:
            return
        self._owner = None
        self._on_close = None
        if self._body is not None:
            self._body.clear()
        self._show(False)

    def _close(self) -> None:
        on_close = self._on_close
        owner = self._owner
        if on_close is not None:
            on_close()
        # 借り手が閉じる操作で返さなかったときも、領域は宛先パネルへ戻す
        if owner is not None:
            self.release(owner)

    def _show(self, inspecting: bool) -> None:
        if self._default_box is not None:
            self._default_box.set_visibility(not inspecting)
        if self._inspector_box is not None:
            self._inspector_box.set_visibility(inspecting)
        if self._frame is not None:
            if inspecting:
                self._frame.classes(add=INSPECTING_CLASS)
            else:
                self._frame.classes(remove=INSPECTING_CLASS)
