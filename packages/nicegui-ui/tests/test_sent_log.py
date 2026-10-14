from __future__ import annotations

import json

import pytest

from oscdesk_ui.config import AppConfig, UnityTarget
from oscdesk_ui.protocol import FrameDecodeError, SentLogFrame, decode_frame
from oscdesk_ui.sent_log import SentLogCache, format_args, sent_log_row
from oscdesk_ui.state import SurfaceState


def record(seq: int, **overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "seq": seq,
        "at": "2026-10-14T10:00:00.250Z",
        "origin": "ui",
        "targets": ["unity"],
        "address": f"/p/{seq}",
        "args": [{"type": "f", "value": 0.5}],
        "count": 1,
        "batch": None,
        "clipped": False,
    }
    base.update(overrides)
    return base


def frame(records: list[dict[str, object]], *, full: bool = False) -> SentLogFrame:
    decoded = decode_frame(json.dumps({"v": 1, "type": "sentLog", "full": full, "records": records}))
    assert isinstance(decoded, SentLogFrame)
    return decoded


def test_decode_keeps_batch_and_clipped() -> None:
    decoded = frame([record(1, origin="action", batch={"id": 2, "index": 1, "size": 3}, clipped=True)])
    item = decoded.records[0]
    assert (item.origin, item.batch.id if item.batch else None, item.batch.index if item.batch else None, item.clipped) == (
        "action", 2, 1, True,
    )


@pytest.mark.parametrize(
    "bad",
    [
        record(0),
        record(1, count=0),
        record(1, targets=[]),
        record(1, origin="ping"),
        record(1, at="2026-10-14T10:00:00"),
        record(1, batch={"id": 1, "index": -1, "size": 1}),
        {key: value for key, value in record(1).items() if key != "batch"},
        record(1, args=[{"type": "i", "value": 1}] * 17),
    ],
)
def test_decode_rejects_invalid_records(bad: dict[str, object]) -> None:
    with pytest.raises(FrameDecodeError):
        decode_frame(json.dumps({"v": 1, "type": "sentLog", "full": False, "records": [bad]}))


def test_decode_rejects_more_records_than_one_frame_may_carry() -> None:
    with pytest.raises(FrameDecodeError):
        decode_frame(json.dumps({"v": 1, "type": "sentLog", "full": False, "records": [record(i + 1) for i in range(101)]}))


def test_cache_upserts_by_seq_and_lists_newest_first() -> None:
    cache = SentLogCache()
    cache.apply(frame([record(1), record(2)]))
    cache.apply(frame([record(2, count=5)]))
    assert [(item.seq, item.count) for item in cache.records()] == [(2, 5), (1, 1)]


def test_full_frame_replaces_the_cache() -> None:
    cache = SentLogCache()
    cache.apply(frame([record(7), record(8)]))
    revision = cache.revision
    cache.apply(frame([record(1)], full=True))
    assert [item.seq for item in cache.records()] == [1]
    assert cache.revision > revision


def test_cache_drops_the_oldest_beyond_capacity() -> None:
    cache = SentLogCache(capacity=2)
    cache.apply(frame([record(1), record(2), record(3)]))
    assert [item.seq for item in cache.records()] == [3, 2]


def test_row_formats_batch_count_and_clipped_args() -> None:
    decoded = frame([
        record(
            4,
            origin="action",
            targets=["unity", "backup"],
            args=[{"type": "s", "value": "A"}, {"type": "i", "value": 3}, {"type": "f", "value": 0.25}],
            count=3,
            batch={"id": 2, "index": 0, "size": 2},
            clipped=True,
        )
    ])
    row = sent_log_row(decoded.records[0])
    assert row["origin"] == "まとめ送り"
    assert row["targets"] == "unity, backup"
    assert row["args"] == 's:"A" i:3 f:0.25 …'
    assert row["count"] == "×3"
    assert row["batch"] == "#2 1/2"
    assert len(str(row["time"])) == len("00:00:00.000")
    assert format_args(()) == ""


class NullLink:
    def __init__(self, *args: object, **kwargs: object) -> None:
        pass

    def request_surface(self) -> None:
        pass


def test_state_keeps_the_sent_log_from_bridge_frames() -> None:
    state = SurfaceState(AppConfig(unity=UnityTarget("127.0.0.1", 7090, 7091)), link_factory=NullLink)
    state._on_frame(frame([record(1)], full=True))
    state._on_frame(frame([record(2)]))
    assert [item.seq for item in state.sent_log.records()] == [2, 1]
