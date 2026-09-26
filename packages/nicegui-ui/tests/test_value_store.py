from __future__ import annotations

from oscdesk_ui.value_store import INPUT_HOLD_TIMEOUT_S, ValueChannel, ValueStore

INTERVAL = 0.1


def channel() -> ValueChannel:
    return ValueChannel(address="/a", min_send_interval_s=INTERVAL)


def test_first_local_change_is_sent_immediately() -> None:
    assert channel().on_local((0.5,), now=0.0) == (0.5,)


def test_changes_inside_the_interval_are_thinned_out() -> None:
    ch = channel()

    assert ch.on_local((0.1,), now=0.0) == (0.1,)
    assert ch.on_local((0.2,), now=0.01) is None
    assert ch.on_local((0.3,), now=0.02) is None
    # 表示は間引かれた最新値のまま先に進む。
    assert ch.values == (0.3,)


def test_the_last_thinned_value_is_flushed_once_the_interval_passes() -> None:
    ch = channel()
    ch.on_local((0.1,), now=0.0)
    ch.on_local((0.3,), now=0.02)

    assert ch.flush_due(now=0.05) is None
    assert ch.flush_due(now=0.11) == (0.3,)
    assert ch.flush_due(now=0.5) is None


def test_release_flushes_the_final_value_without_waiting() -> None:
    ch = channel()
    ch.begin_hold()
    ch.on_local((0.1,), now=0.0)
    ch.on_local((0.9,), now=0.01)

    assert ch.end_hold(now=0.02) == (0.9,)
    assert ch.holding is False


def test_echo_is_ignored_while_holding_and_wins_after_release() -> None:
    ch = channel()
    ch.begin_hold()
    ch.on_local((0.9,), now=0.0)

    assert ch.on_echo((0.1,)) is False
    assert ch.values == (0.9,)

    ch.end_hold(now=0.01)

    # 未確定の離脱で編集前値へ戻っているため、同じエコーでは表示は変わらない。
    assert ch.on_echo((0.1,)) is False
    assert ch.values == (0.1,)


def test_echo_of_an_unchanged_value_does_not_bump_the_revision() -> None:
    ch = channel()
    ch.on_echo((1,))
    revision = ch.revision

    assert ch.on_echo((1,)) is False
    assert ch.revision == revision


def test_expired_hold_is_released_and_flushes_pending_value() -> None:
    ch = channel()
    ch.begin_hold(now=1.0, timeout_s=2.0)
    ch.on_local((1,), now=1.0)
    ch.on_local((2,), now=1.05)

    assert ch.expire_hold(now=2.9) is None
    assert ch.holding is True
    assert ch.expire_hold(now=3.0) == (2,)
    assert ch.holding is False
    assert ch.hold_started_at is None


def test_input_hold_timeout_is_longer_than_default() -> None:
    ch = channel()
    ch.begin_hold(now=0.0, timeout_s=INPUT_HOLD_TIMEOUT_S)

    assert ch.expire_hold(now=INPUT_HOLD_TIMEOUT_S - 0.001) is None
    assert ch.holding is True
    assert ch.expire_hold(now=INPUT_HOLD_TIMEOUT_S) is None
    assert ch.holding is False


def test_store_releases_all_expired_holds_in_one_pass() -> None:
    store = ValueStore()
    store.channel("/a").begin_hold(now=0.0, timeout_s=1.0)
    store.channel("/b").begin_hold(now=0.0, timeout_s=2.0)

    assert store.release_all_holds(now=1.0) == [("/a", None)]
    assert store.channel("/a").holding is False
    assert store.channel("/b").holding is True


def test_store_releases_holds_for_a_disconnected_client() -> None:
    store = ValueStore()
    store.channel("/held").begin_hold(now=0.0, timeout_s=120.0)
    store.channel("/other").begin_hold(now=0.0, timeout_s=120.0)

    assert store.release_holds(["/held"], now=1.0) == [("/held", None)]
    assert store.channel("/held").holding is False
    assert store.channel("/other").holding is True


def test_discrete_changes_are_never_thinned_out() -> None:
    ch = channel()

    assert ch.on_local_immediate((1,), now=0.0) == (1,)
    assert ch.on_local_immediate((0,), now=0.001) == (0,)
    assert ch.flush_due(now=10.0) is None


def test_reset_drops_pending_sends_so_stale_values_never_reach_unity() -> None:
    ch = channel()
    ch.on_local((0.1,), now=0.0)
    ch.on_local((0.3,), now=0.01)
    ch.reset_send_state()

    assert ch.flush_due(now=10.0) is None


def test_store_flushes_every_channel_that_is_due() -> None:
    store = ValueStore(min_send_interval_s=INTERVAL)
    store.channel("/a").on_local((1,), now=0.0)
    store.channel("/a").on_local((2,), now=0.01)
    store.channel("/b").on_local((3,), now=0.0)

    assert store.flush_due(now=0.2) == [("/a", (2,))]


def test_defaults_seed_the_display_but_never_overwrite_a_known_value() -> None:
    store = ValueStore()
    store.on_echo("/known", (7,))

    class Entry:
        def __init__(self, address: str, default: object) -> None:
            self.address = address
            self.default = default
            self.has_default = True

    store.seed_defaults([Entry("/known", 1), Entry("/fresh", 2)])

    assert store.values_of("/known") == (7,)
    assert store.values_of("/fresh") == (2,)


class DefaultEntry:
    def __init__(self, address: str, default: object, type_tag: str = "f") -> None:
        self.address = address
        self.default = default
        self.has_default = True
        self.type_tag = type_tag


def test_force_seed_overwrites_display_without_touching_send_state() -> None:
    store = ValueStore()
    ch = store.channel("/value")
    ch.on_local((0.5,), now=0.0)
    ch.on_local((0.6,), now=0.01)
    revision = ch.revision

    assert store.seed_defaults([DefaultEntry("/value", 0.2)], force=True) == []
    assert store.values_of("/value") == (0.2,)
    assert ch.revision == revision + 1
    assert store.flush_due(now=0.2) == [("/value", (0.6,))]


def test_force_seed_holding_preserves_display_and_updates_pre_edit_value() -> None:
    store = ValueStore()
    ch = store.channel("/value")
    ch.on_echo((0.1,))
    ch.begin_hold(now=0.0)
    ch.set_draft("editing")

    assert store.seed_defaults([DefaultEntry("/value", 0.9)], force=True) == [
        ("/value", "holding")
    ]
    assert ch.values == (0.1,)
    assert ch.pre_edit_values == (0.9,)
    assert store.draft_of("/value") == (True, "editing")

    assert ch.end_hold(now=1.0) is None
    assert ch.values == (0.9,)
    assert store.draft_of("/value") == (False, None)


def test_confirmed_value_wins_over_a_force_seed_during_hold() -> None:
    store = ValueStore()
    ch = store.channel("/value")
    ch.on_echo((0.1,))
    ch.begin_hold(now=0.0)
    store.seed_defaults([DefaultEntry("/value", 0.9)], force=True)

    assert ch.on_local_immediate((0.7,), now=0.1) == (0.7,)
    assert ch.end_hold(now=0.2) is None
    assert ch.values == (0.7,)


class NoDefaultEntry:
    def __init__(self, address: str, type_tag: str = "s") -> None:
        self.address = address
        self.has_default = False
        self.type_tag = type_tag


def test_force_seed_clears_a_stale_value_when_the_entry_has_no_default() -> None:
    store = ValueStore()
    ch = store.channel("/note")
    ch.on_echo(("old-instance",))
    revision = ch.revision

    assert store.seed_defaults([NoDefaultEntry("/note")], force=True) == []
    assert store.values_of("/note") is None
    assert ch.revision == revision + 1

    # 既に空なら revision を進めない。未知のアドレスにチャネルを作らない
    assert store.seed_defaults([NoDefaultEntry("/note"), NoDefaultEntry("/unknown")], force=True) == []
    assert ch.revision == revision + 1
    assert store.values_of("/unknown") is None
    assert "/unknown" not in [channel.address for channel in store]


def test_non_force_seed_keeps_values_of_entries_without_default() -> None:
    store = ValueStore()
    store.on_echo("/note", ("kept",))

    store.seed_defaults([NoDefaultEntry("/note")])

    assert store.values_of("/note") == ("kept",)


def test_force_seed_without_default_clears_after_an_unconfirmed_hold() -> None:
    store = ValueStore()
    ch = store.channel("/note")
    ch.on_echo(("old-instance",))
    ch.begin_hold(now=0.0)

    assert store.seed_defaults([NoDefaultEntry("/note")], force=True) == [("/note", "holding")]
    assert ch.values == ("old-instance",)

    assert ch.end_hold(now=1.0) is None
    assert ch.values is None


def test_force_seed_without_default_keeps_a_confirmed_value_during_hold() -> None:
    store = ValueStore()
    ch = store.channel("/note")
    ch.on_echo(("old-instance",))
    ch.begin_hold(now=0.0)
    store.seed_defaults([NoDefaultEntry("/note")], force=True)

    assert ch.on_local_immediate(("typed",), now=0.1) == ("typed",)
    assert ch.end_hold(now=0.2) is None
    assert ch.values == ("typed",)


def test_blob_defaults_are_excluded_with_a_reason() -> None:
    store = ValueStore()

    assert store.seed_defaults([DefaultEntry("/blob", b"data", "b")], force=True) == [
        ("/blob", "blob")
    ]
    assert store.values_of("/blob") is None
