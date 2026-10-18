"""一覧の近くの「Sync」(D-077)。

optionsFrom.request / keysFrom.request を持つ一覧の、その一覧だけを取り直す小さなボタン。
ページ上部の「一覧を更新」(全一覧)と違い、押した場所の一覧の要求だけを全宛先へ送らせる。
通常の select の横(page)とレコード表の列の見出し(record_table)の両方から使うので、ここにまとめる。
"""

from __future__ import annotations

from typing import Any

from nicegui import ui

from .notify_history import notify
from .state import SurfaceState

SYNC_LABEL = "Sync"
# 応答で一覧が変わらなければブリッジは何も配らない(BRIDGE_PROTOCOL.md)。「送った」を「更新した」と
# 読ませると、候補が変わらないときに失敗したと誤解されるので、変わったときだけ入れ替わると書く
SENT_MESSAGE = "Unity に一覧を要求しました({request})。一覧の中身が変わったときだけ候補が入れ替わります"
OFFLINE_MESSAGE = "ブリッジに接続していないため要求できませんでした"


def request_list_sync(state: SurfaceState, request: str) -> bool:
    """その要求アドレスの一覧だけを取り直させ、結果を通知する。送れたら True。"""
    if state.request_runtime_options_refresh(request):
        notify(SENT_MESSAGE.format(request=request), type="info")
        return True
    notify(OFFLINE_MESSAGE, type="warning")
    return False


def build_sync_button(state: SurfaceState, request: str) -> Any:
    """Sync のボタン。見出しや select の横に置くので、文字の小さい flat なボタンにする。"""
    button = ui.button(SYNC_LABEL, icon="sync", on_click=lambda _e=None: request_list_sync(state, request))
    button.props("flat dense no-caps size=sm").classes("whitespace-nowrap")
    with button:
        ui.tooltip(f"この一覧だけを Unity から取り直します({request})")
    return button
