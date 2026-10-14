"""送信ログと通知履歴を見るドロワー(D-067)。

右側のドロワーに 2 つをまとめ、切り替えて見る。どちらも「後から見返す」ためのもので、操作画面を狭めない
よう普段は閉じておく。表の更新はページのタイマー(D-021)から `sync` で行い、閉じている間は何もしない。
"""

from __future__ import annotations

import time
from typing import Any, Callable

from nicegui import ui

from .notify_history import NotificationHistory, notification_row
from .sent_log import SentLogCache, sent_log_row

# 開いている間の表の書き換え間隔。スライダー操作中に 20Hz で表全体を送り直すとブラウザが重くなる
REFRESH_INTERVAL_S = 0.5
ROWS_PER_PAGE = 50
SENT = "sent"
NOTIFY = "notify"

SENT_COLUMNS = [
    {"name": "time", "label": "時刻", "field": "time", "align": "left"},
    {"name": "origin", "label": "契機", "field": "origin", "align": "left"},
    {"name": "targets", "label": "宛先", "field": "targets", "align": "left"},
    {"name": "address", "label": "アドレス", "field": "address", "align": "left"},
    {"name": "args", "label": "引数", "field": "args", "align": "left", "classes": "break-all", "style": "white-space:normal"},
    {"name": "count", "label": "回数", "field": "count", "align": "right"},
    {"name": "batch", "label": "まとめ送り", "field": "batch", "align": "left"},
]

NOTIFY_COLUMNS = [
    {"name": "time", "label": "時刻", "field": "time", "align": "left"},
    {"name": "type", "label": "種類", "field": "type", "align": "left"},
    {"name": "message", "label": "本文", "field": "message", "align": "left", "style": "white-space:normal"},
]


class LogDrawer:
    def __init__(
        self,
        sent_log: SentLogCache,
        history: NotificationHistory,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._sent_log = sent_log
        self._history = history
        self._clock = clock
        self._sent_revision = -1
        self._notify_revision = -1
        self._last_refresh = float("-inf")

    def build(self) -> None:
        # ページ直下に置く(Quasar のドロワーはレイアウトの子でないと出ない)
        self._drawer = ui.right_drawer(value=False, fixed=True).props("width=640 bordered").classes("q-pa-sm")
        with self._drawer:
            # 切り替えは ui.tabs でなく toggle にする。画面層のタブ(layout.py)と同じ部品にすると、
            # ページ内のタブを数える処理・テストに混ざるため
            self._view = ui.toggle({SENT: "送信ログ", NOTIFY: "通知履歴"}, value=SENT, on_change=self._on_view).props(
                "dense no-caps"
            )
            with ui.column().classes("w-full q-gutter-y-xs") as self._sent_panel:
                ui.label(
                    "ブリッジが Unity へ送った OSC の直近の記録(新しい順)。同じアドレスへの連続送信は 1 行にまとめて回数を出す。"
                    "ping は含まない。完全な証跡はデバッグ起動時の診断ログ(logs/diagnostics)にある。"
                ).classes("text-caption text-grey-7")
                self._sent_table = ui.table(
                    columns=SENT_COLUMNS,
                    rows=[],
                    row_key="seq",
                    pagination={"rowsPerPage": ROWS_PER_PAGE},
                ).props("dense flat wrap-cells").classes("w-full")
            with ui.column().classes("w-full q-gutter-y-xs") as self._notify_panel:
                with ui.row().classes("w-full items-center justify-between no-wrap"):
                    ui.label("この画面に出た通知(新しい順)。ページを閉じると消える。").classes("text-caption text-grey-7")
                    ui.button("消去", on_click=self._clear_notifications).props("flat dense no-caps")
                self._notify_table = ui.table(
                    columns=NOTIFY_COLUMNS,
                    rows=[],
                    row_key="seq",
                    pagination={"rowsPerPage": ROWS_PER_PAGE},
                ).props("dense flat wrap-cells").classes("w-full")
            self._notify_panel.set_visibility(False)

    def _on_view(self, event: Any) -> None:
        self._sent_panel.set_visibility(event.value == SENT)
        self._notify_panel.set_visibility(event.value == NOTIFY)

    @property
    def is_open(self) -> bool:
        return bool(self._drawer.value)

    def toggle(self) -> None:
        self._drawer.toggle()
        # 開いた直後は間隔を待たずに最新を出す
        self._last_refresh = float("-inf")
        self.sync()

    def sync(self) -> None:
        if not self.is_open:
            return
        now = self._clock()
        if now - self._last_refresh < REFRESH_INTERVAL_S:
            return
        self._last_refresh = now
        if self._sent_revision != self._sent_log.revision:
            self._sent_revision = self._sent_log.revision
            self._sent_table.rows = [sent_log_row(record) for record in self._sent_log.records()]
            self._sent_table.update()
        if self._notify_revision != self._history.revision:
            self._notify_revision = self._history.revision
            self._notify_table.rows = [notification_row(record) for record in self._history.records()]
            self._notify_table.update()

    def _clear_notifications(self) -> None:
        self._history.clear()
        self._last_refresh = float("-inf")
        self.sync()
