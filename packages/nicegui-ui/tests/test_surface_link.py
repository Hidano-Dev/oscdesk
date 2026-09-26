from __future__ import annotations

from oscdesk_ui.protocol import OscMessage, WireArg
from oscdesk_ui.surface_link import BridgeLink, LinkOptions


def _link() -> BridgeLink:
    return BridgeLink(LinkOptions(url="ws://example.invalid"), lambda _frame: None)


def test_send_osc_batch_queues_one_frame_when_connected() -> None:
    link = _link()
    link._connected.set()

    assert link.send_osc_batch([
        OscMessage("/a", (WireArg("i", 1),)),
        OscMessage("/b", (WireArg("s", "value"),)),
    ]) is True

    assert link._outbox.queue.qsize() == 1
    assert link._outbox.queue.get_nowait() == (
        '{"v":1,"type":"oscBatch","messages":['
        '{"address":"/a","args":[{"type":"i","value":1}]},'
        '{"address":"/b","args":[{"type":"s","value":"value"}]}'
        ']}'
    )


def test_send_osc_batch_returns_false_when_disconnected() -> None:
    link = _link()

    assert link.send_osc_batch([OscMessage("/a")]) is False
    assert link._outbox.queue.empty()
