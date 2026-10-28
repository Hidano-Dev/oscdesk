"""アプリ全体の Inspector の領域(D-091)。

画面の右側(狭い画面では本体の上)の領域を、普段は宛先パネル(D-086 / D-089)が使い、部品の設定を編集する間だけ
Inspector が借りる。OSC パッドの編集でボタンを選んだとき、その設定をここに出す(格子の右に出すと格子が縮んで
実行モードとボタンの位置が変わるため)。

宛先パネルは借りている間も作り直さず、隠すだけにする(作り直すと、応答待ちの未確定の選択が消えるため。D-086)。
中身を描くのは借り手で、この領域は「誰が借りているか」と見出し・閉じる操作だけを持つ。

2 つの面(宛先パネルと Inspector)は領域の同じ升目に重ね、それぞれが自分でスクロールする(領域そのものはスクロール
させない)。隠す面は display:none でなく visibility:hidden にする(page.BODY_CSS)。display:none にすると箱が消えて
スクロール位置が失われ、Inspector を閉じたときに宛先パネルが先頭へ戻ってしまう。領域全体を 1 つのスクロールに
すると、2 つの面が同じスクロール位置を共有し、片方の位置がもう片方へずれて持ち込まれる。
"""

from __future__ import annotations

from collections.abc import Callable

from nicegui import ui

# 領域(aside)に付ける印。狭い画面で Inspector を出している間だけ、本体の上に貼り付ける(page.BODY_CSS)
INSPECTING_CLASS = "oscdesk-aside-inspecting"
# 領域に重ねる面と、隠している面の印(page.BODY_CSS)
VIEW_CLASS = "oscdesk-aside-view"
HIDDEN_VIEW_CLASS = "oscdesk-aside-view-hidden"


class InspectorArea:
    """右側の領域の切り替え。借り手は claim で中身の置き場(body)を受け取り、release で宛先パネルへ返す。"""

    def __init__(self) -> None:
        self._owner: object | None = None
        self._on_close: Callable[[], None] | None = None
        # claim のたびに進める。閉じる操作の途中で借り直されたかを見分けるため
        self._generation = 0
        self._frame: ui.element | None = None
        self._default_view: ui.element | None = None
        self._inspector_view: ui.element | None = None
        self._title: ui.label | None = None
        self._body: ui.element | None = None

    def build(self, frame: ui.element, build_default: Callable[[], None]) -> None:
        """frame(右側の領域の要素)の中に、既定の中身(宛先パネル)と Inspector の置き場を作る。"""
        self._frame = frame
        with frame:
            with ui.element("div").classes(VIEW_CLASS) as default_view:
                build_default()
            self._default_view = default_view
            # 見出し(閉じる操作)は動かさず、中身だけをスクロールさせる(見出しが流れると × が見えなくなる)
            with ui.element("div").classes(f"{VIEW_CLASS} oscdesk-inspector-view") as inspector_view:
                with ui.row().classes("oscdesk-inspector-head w-full items-center justify-between no-wrap q-px-sm q-py-xs"):
                    with ui.row().classes("items-center no-wrap gap-1"):
                        ui.icon("tune", size="xs").classes("text-grey-8")
                        ui.label("Inspector").classes("text-subtitle2")
                        self._title = ui.label("").classes("text-caption text-grey-7")
                    # 閉じると借り手が選択を外し、宛先パネルへ戻る
                    ui.button(icon="close", on_click=self._close).props(
                        'flat dense round size=sm aria-label="Inspector を閉じて送信先へ戻る"'
                    ).tooltip("閉じて送信先へ戻る")
                self._body = ui.column().classes("oscdesk-inspector-body w-full items-stretch no-wrap q-px-sm q-pb-sm").style("gap:0")
            self._inspector_view = inspector_view
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
        self._generation += 1
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
        generation = self._generation
        if on_close is not None:
            on_close()
        # 借り手が閉じる操作で返さなかったときも、領域は宛先パネルへ戻す。ただし on_close の中で借り直された
        # (世代が進んだ)ときは、その新しい表示を消さない
        if owner is not None and self._generation == generation:
            self.release(owner)

    def _show(self, inspecting: bool) -> None:
        if self._default_view is not None:
            self._set_hidden(self._default_view, inspecting)
        if self._inspector_view is not None:
            self._set_hidden(self._inspector_view, not inspecting)
        if self._frame is not None:
            if inspecting:
                self._frame.classes(add=INSPECTING_CLASS)
            else:
                self._frame.classes(remove=INSPECTING_CLASS)

    @staticmethod
    def _set_hidden(view: ui.element, hidden: bool) -> None:
        if hidden:
            view.classes(add=HIDDEN_VIEW_CLASS)
        else:
            view.classes(remove=HIDDEN_VIEW_CLASS)
