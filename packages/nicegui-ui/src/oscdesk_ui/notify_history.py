"""画面上の通知(トースト)と、その履歴(D-067)。

トーストは消えると見返せないので、通知はすべて `notify` を通して履歴に残す。履歴はブラウザのページ
(NiceGUI のクライアント)ごとに持つ。トーストは操作したページにだけ出るため、プロセス全体で持つと
他の端末の入力ミスまで混ざり、自分が見た通知の見返しにならない。ページを閉じる・再読み込みすると消える。

`notify` は UI のイベントハンドラかページのタイマー(D-021)からだけ呼ぶ。バックグラウンドタスクでは
どのページの通知か決まらない(ui.context.client が無い)。
"""

from __future__ import annotations

import weakref
from collections import deque
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final, Literal

from nicegui import ui

NOTIFY_HISTORY_CAPACITY: Final = 200

NotifyType = Literal["positive", "negative", "warning", "info", "ongoing"]

TYPE_LABELS: Final = {
    "positive": "成功",
    "negative": "エラー",
    "warning": "警告",
    "info": "情報",
    "ongoing": "処理中",
}


@dataclass(frozen=True)
class NotificationRecord:
    seq: int
    at: datetime
    type: str
    message: str


class NotificationHistory:
    def __init__(self, capacity: int = NOTIFY_HISTORY_CAPACITY) -> None:
        self._records: deque[NotificationRecord] = deque(maxlen=capacity)
        self._seq = 0

    @property
    def revision(self) -> int:
        return self._seq

    def add(self, message: str, type: str = "info", at: datetime | None = None) -> NotificationRecord:
        self._seq += 1
        record = NotificationRecord(self._seq, at or datetime.now().astimezone(), type, message)
        self._records.append(record)
        return record

    def records(self) -> tuple[NotificationRecord, ...]:
        """新しい順。"""
        return tuple(reversed(self._records))

    def clear(self) -> None:
        self._records.clear()
        self._seq += 1


def notification_row(record: NotificationRecord) -> dict[str, object]:
    return {
        "seq": record.seq,
        "time": record.at.strftime("%H:%M:%S"),
        "type": TYPE_LABELS.get(record.type, record.type),
        "message": record.message,
    }


# NiceGUI のクライアント → 履歴。弱参照なので、ページが破棄されれば履歴も消える
# (切断のたびに消すと、通信の瞬断で再接続したページの履歴まで失う)
_histories: "weakref.WeakKeyDictionary[Any, NotificationHistory]" = weakref.WeakKeyDictionary()


def history_for(client: Any) -> NotificationHistory:
    history = _histories.get(client)
    if history is None:
        history = _histories[client] = NotificationHistory()
    return history


def notify(message: str, *, type: NotifyType = "info") -> None:
    """ui.notify の代わり。表示中のページの履歴に残してからトーストを出す。"""
    history_for(ui.context.client).add(message, type)
    ui.notify(message, type=type)
