"""ブリッジから届く送信ログ(D-067)の表示キャッシュ。

送信の記録の正はブリッジが持ち、UI は直近の窓を表示するだけ。証跡は NDJSON 診断ログ(D-031)にある。
"""

from __future__ import annotations

from datetime import datetime
from typing import Final

from .protocol import SentLogFrame, SentRecord, WireArg

# ブリッジの保持件数(packages/shared/src/limits.ts の SENT_LOG.CAPACITY)と同じ。
# 多く持っても既存分の再送でブリッジ側の件数に揃うので、ここで増やす意味は無い
SENT_LOG_CAPACITY: Final = 1000

ORIGIN_LABELS: Final = {
    "ui": "操作",
    "action": "まとめ送り",
    "resend": "再送",
    "row": "行の生成",
    "request": "一覧の要求",
    "relay": "OSC 中継",
}


class SentLogCache:
    """seq ごとの記録。間引き(count)で更新された記録は同じ seq で届き直すので、追加でなく置き換える。"""

    def __init__(self, capacity: int = SENT_LOG_CAPACITY) -> None:
        self._capacity = capacity
        self._records: dict[int, SentRecord] = {}
        self.revision = 0

    def apply(self, frame: SentLogFrame) -> None:
        if frame.full:
            # 接続(再接続)直後の既存分。ブリッジの再起動で seq が 1 に戻るので、古い記録は必ず捨てる
            self._records = {}
        for record in frame.records:
            self._records[record.seq] = record
        if len(self._records) > self._capacity:
            for seq in sorted(self._records)[: len(self._records) - self._capacity]:
                del self._records[seq]
        self.revision += 1

    def records(self) -> tuple[SentRecord, ...]:
        """新しい順。"""
        return tuple(self._records[seq] for seq in sorted(self._records, reverse=True))

    def __len__(self) -> int:
        return len(self._records)


def format_args(args: tuple[WireArg, ...], clipped: bool = False) -> str:
    parts = []
    for arg in args:
        if arg.type == "s":
            parts.append(f's:"{arg.value}"')
        elif arg.type == "b":
            parts.append(f"b:{arg.value}")
        elif arg.type == "f":
            parts.append(f"f:{arg.value:g}" if isinstance(arg.value, (int, float)) else f"f:{arg.value}")
        else:
            parts.append(f"{arg.type}:{arg.value}")
    text = " ".join(parts)
    return f"{text} …" if clipped else text


def format_local_time(iso: str) -> str:
    """ISO 8601 の時刻を、UI を動かしている PC のローカル時刻(ミリ秒まで)にする。"""
    try:
        moment = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone()
    except ValueError:
        return iso
    return moment.strftime("%H:%M:%S.") + f"{moment.microsecond // 1000:03d}"


def sent_log_row(record: SentRecord) -> dict[str, object]:
    """表(ui.table)の 1 行。"""
    batch = ""
    if record.batch is not None:
        batch = f"#{record.batch.id} {record.batch.index + 1}/{record.batch.size}"
    return {
        "seq": record.seq,
        "time": format_local_time(record.at),
        "origin": ORIGIN_LABELS.get(record.origin, record.origin),
        "targets": ", ".join(record.targets),
        "address": record.address,
        "args": format_args(record.args, record.clipped),
        "count": "" if record.count == 1 else f"×{record.count}",
        "batch": batch,
    }
