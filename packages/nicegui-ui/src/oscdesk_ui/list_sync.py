"""一覧の近くの「Sync」(D-077)。

要求を持つ一覧(結び付けで要求が決まっている optionsFrom / keysFrom の一覧)の、その一覧だけを取り直す小さなボタン。
一覧は id で指し、どこへ要求を送るかはブリッジが結び付けから決める(HID-389)。
ページ上部の「一覧を更新」(全一覧)と違い、押した場所の一覧の要求だけを全宛先へ送らせる。
通常の select の横(page)とレコード表の列の見出し(record_table)の両方から使うので、ここにまとめる。
"""

from __future__ import annotations

from typing import Any

from nicegui import ui

from .notify_history import notify
from .state import SurfaceState

SYNC_LABEL = "Sync"
# 応答で一覧が変わらなければブリッジは何も配らない(BRIDGE_PROTOCOL.md)。変わった一覧も、その宛先の初報でなければ
# 反映するまで候補を入れ替えない(D-088)。「送った」を「更新した」と読ませると、候補が変わらないときに失敗したと
# 誤解されるので、変わっていれば「新しい一覧があります」に出ると書く
SENT_MESSAGE = "Unity に一覧を要求しました。一覧が変わっていれば「新しい一覧があります」に出ます"
REFRESH_SENT_MESSAGE = "Unity に一覧を要求しました。一覧が変わっていれば「新しい一覧があります」に出ます"
OFFLINE_MESSAGE = "ブリッジに接続していないため要求できませんでした"


def request_list_sync(state: SurfaceState, list_id: str) -> bool:
    """その一覧(id)だけを取り直させ、結果を通知する。送れたら True。"""
    if state.request_runtime_options_refresh(list_id):
        notify(SENT_MESSAGE, type="info")
        return True
    notify(OFFLINE_MESSAGE, type="warning")
    return False


def build_sync_button(state: SurfaceState, list_id: str) -> Any:
    """Sync のボタン。見出しや select の横に置くので、文字の小さい flat なボタンにする。"""
    button = ui.button(SYNC_LABEL, icon="sync", on_click=lambda _e=None: request_list_sync(state, list_id))
    button.props("flat dense no-caps size=sm").classes("whitespace-nowrap")
    with button:
        ui.tooltip("この一覧だけを Unity から取り直します")
    return button
