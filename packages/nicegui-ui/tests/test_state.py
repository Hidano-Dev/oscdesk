from __future__ import annotations

from typing import Any

import pytest

from oscdesk_ui.config import AppConfig, UnityTarget
from oscdesk_ui.protocol import ManifestFrame, NoticeFrame, OscFrame, OscMessage, Peer, WireArg
from oscdesk_ui.state import APPLY_ECHO_TIMEOUT_S, APPLY_LATE_ECHO_WINDOW_S, SurfaceState
from oscdesk_ui.surface_link import LinkStatus

MANIFEST = {
    "version": 1,
    "projectId": "oscdesk-demo",
    "entries": [
        {
            "address": "/avatar/blend/smile",
            "label": "Smile",
            "type": "f",
            "widget": "fader",
            "range": [0, 1],
            "default": 0.35,
            "group": "Face",
        },
        {
            "address": "/avatar/toggle/visible",
            "label": "Visible",
            "type": "bool",
            "widget": "toggle",
            "default": True,
        },
        {
            "address": "/avatar/text/name",
            "label": "Name",
            "type": "s",
            "widget": "text",
        },
    ],
}

ADOPTION = {"seq": 1, "at": "2026-01-01T00:00:00Z"}
SECOND_ADOPTION = {"seq": 2, "at": "2026-01-01T00:00:01Z"}

# 適用トリガ(appliesTo)と staged 値を持つマニフェスト。/member/02/name は staged でないため範囲外。
STAGING_MANIFEST = {
    "version": 1,
    "projectId": "oscdesk-demo",
    "entries": [
        {
            "address": "/member/01/name",
            "label": "Member 01 Name",
            "type": "s",
            "widget": "input",
            "default": "Alice",
            "staged": True,
        },
        {
            "address": "/member/01/enabled",
            "label": "Member 01 Enabled",
            "type": "bool",
            "widget": "toggle",
            "default": False,
            "staged": True,
        },
        {
            "address": "/member/01/update",
            "label": "Member 01 Update",
            "type": "i",
            "widget": "button",
            "default": 0,
            "appliesTo": ["/member/01/*"],
        },
        {
            "address": "/member/02/name",
            "label": "Member 02 Name",
            "type": "s",
            "widget": "input",
            "default": "Bob",
        },
        {
            "address": "/legacy/update",
            "label": "Legacy Update",
            "type": "i",
            "widget": "button",
            "default": 0,
        },
        {
            "address": "/nothing/update",
            "label": "Nothing Update",
            "type": "i",
            "widget": "button",
            "default": 0,
            "appliesTo": ["/nothing/*"],
        },
    ],
}
MEMBER_01_BATCH = [
    ("/member/01/name", [("s", "Alice")]),
    ("/member/01/enabled", [("i", 0)]),
    ("/member/01/update", [("i", 1)]),
]


class FakeLink:
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self.sent: list[tuple[str, list[Any]]] = []
        self.batches: list[list[tuple[str, list[tuple[str, Any]]]]] = []
        self.connected = True
        self.manifest_requests = 0
        self.resends: list[str | None] = []

    def send_osc(self, address: str, args: list[Any]) -> None:
        self.sent.append((address, args))

    def send_osc_batch(self, messages: list[OscMessage]) -> bool:
        if not self.connected:
            return False
        self.batches.append(
            [(message.address, [(arg.type, arg.value) for arg in message.args]) for message in messages]
        )
        return True

    def request_manifest(self) -> None:
        self.manifest_requests += 1

    def request_resend(self, target: str | None = None) -> None:
        self.resends.append(target)


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def build_state() -> tuple[SurfaceState, FakeLink, Clock]:
    clock = Clock()
    config = AppConfig(
        unity=UnityTarget(host="127.0.0.1", send_port=7090, receive_port=7091),
    )
    state = SurfaceState(config, clock=clock, min_send_interval_s=0.1, link_factory=FakeLink)

    return state, state.link, clock  # type: ignore[return-value]


def deliver_manifest(
    state: SurfaceState,
    manifest: dict | str = MANIFEST,
    adoption: dict[str, Any] | None = ADOPTION,
) -> None:
    payload = manifest if isinstance(manifest, dict) else {"invalid": manifest}
    state._on_frame(ManifestFrame(type="manifest", manifest=payload, adoption=adoption))


def deliver_echo(state: SurfaceState, address: str, *args: Any) -> None:
    state._on_frame(
        OscFrame(
            type="osc",
            address=address,
            args=tuple(WireArg(type=type_tag, value=value) for type_tag, value in args),
            source=Peer(host="127.0.0.1", port=7091),
        )
    )


def test_adopts_a_manifest_and_seeds_defaults() -> None:
    state, _link, _clock = build_state()

    deliver_manifest(state)

    assert state.manifest is not None
    assert state.manifest_revision == 1
    assert state.manifest_status.detail == "採用済み"
    assert state.manifest_status.entry_count == 3
    assert state.entry_for("/avatar/blend/smile") is state.manifest.entries[0]
    assert state.entry_for("/missing") is None
    assert state.values.values_of("/avatar/blend/smile") == (0.35,)


def test_ignores_a_repeated_identical_manifest() -> None:
    state, _link, _clock = build_state()

    deliver_manifest(state)
    deliver_manifest(state)

    assert state.manifest_revision == 1


def test_ignores_a_manifest_replayed_with_the_same_adoption() -> None:
    state, _link, _clock = build_state()

    deliver_manifest(state)
    deliver_echo(state, "/avatar/blend/smile", ("f", 0.9))
    deliver_manifest(state, adoption=ADOPTION)

    assert state.manifest_revision == 1
    assert state.values.values_of("/avatar/blend/smile") == (0.9,)


def test_resyncs_defaults_for_a_new_adoption_without_manifest_revision_or_osc() -> None:
    state, link, _clock = build_state()

    deliver_manifest(state)
    deliver_echo(state, "/avatar/blend/smile", ("f", 0.9))
    deliver_manifest(
        state,
        adoption={"seq": 2, "at": "2026-01-01T00:00:01Z"},
    )

    assert state.manifest_revision == 1
    assert state.values.values_of("/avatar/blend/smile") == (0.35,)
    assert link.sent == []


def test_new_adoption_with_changed_content_resyncs_values_and_redraws() -> None:
    state, link, _clock = build_state()

    deliver_manifest(state)
    deliver_echo(state, "/avatar/blend/smile", ("f", 0.9))
    changed = {
        **MANIFEST,
        "entries": [
            *MANIFEST["entries"],
            {"address": "/avatar/blend/frown", "label": "Frown", "type": "f", "widget": "fader", "default": 0.1},
        ],
    }
    deliver_manifest(state, changed, adoption=SECOND_ADOPTION)

    assert state.manifest_revision == 2
    assert state.manifest_status.entry_count == 4
    assert state.values.values_of("/avatar/blend/smile") == (0.35,)
    assert state.values.values_of("/avatar/blend/frown") == (0.1,)
    assert link.sent == []


def test_new_adoption_preserves_a_hold_until_it_is_released() -> None:
    state, link, _clock = build_state()

    deliver_manifest(state)
    entry = state.entry_for("/avatar/blend/smile")
    assert entry is not None
    state.begin_hold(entry.address)
    state.set_local(entry, (0.9,))
    deliver_manifest(
        state,
        adoption={"seq": 2, "at": "2026-01-01T00:00:01Z"},
    )

    assert state.values.values_of(entry.address) == (0.9,)
    state.end_hold(entry)
    assert state.values.values_of(entry.address) == (0.35,)
    assert link.sent == [(entry.address, [{"type": "f", "value": 0.9}])]


def test_changed_manifest_releases_holds_and_drops_hidden_drafts_before_rebuild() -> None:
    """内容が変わったマニフェスト(default の更新など)は全ウィジェットを再構築するため、
    編集中の欄は未確定離脱と同じ扱いにし、見えなくなった下書きを適用セットに残さない。"""
    state, link, _clock = build_state()
    deliver_manifest(state, STAGING_MANIFEST)
    name = state.entry_for("/member/01/name")
    assert name is not None
    state.begin_hold(name.address)
    state.set_draft(name, "TYPING")
    assert state.values.draft_of(name.address) == (True, "TYPING")

    changed = {
        **STAGING_MANIFEST,
        "entries": [
            {**item, "default": "Alicia"} if item["address"] == "/member/01/name" else item
            for item in STAGING_MANIFEST["entries"]
        ],
    }
    deliver_manifest(state, changed, adoption=SECOND_ADOPTION)

    assert state.manifest_revision == 2
    assert state.values.channel(name.address).holding is False
    assert state.values.draft_of(name.address) == (False, None)
    assert state.values.values_of(name.address) == ("Alicia",)
    assert link.sent == []

    press(state, "/member/01/update")
    assert link.batches[-1][0] == ("/member/01/name", [("s", "Alicia")])


def test_changed_manifest_discards_pending_thinned_values_without_sending() -> None:
    """ドラッグ途中(間引きで保留中)のフェーダーがあっても、再同期は OSC を送らない(Req 5.3)。"""
    state, link, clock = build_state()
    deliver_manifest(state)
    fader = state.entry_for("/avatar/blend/smile")
    assert fader is not None
    state.begin_hold(fader.address)
    state.set_local(fader, (0.1,))
    clock.now = 0.01
    state.set_local(fader, (0.9,))
    sent_before = list(link.sent)
    assert sent_before == [(fader.address, [{"type": "f", "value": 0.1}])]

    changed = {
        **MANIFEST,
        "entries": [
            {**item, "default": 0.5} if item["address"] == fader.address else item
            for item in MANIFEST["entries"]
        ],
    }
    deliver_manifest(state, changed, adoption=SECOND_ADOPTION)

    assert link.sent == sent_before
    assert state.values.channel(fader.address).holding is False
    assert state.values.values_of(fader.address) == (0.5,)

    clock.now = 1.0
    state.tick()
    assert link.sent == sent_before


def test_new_adoption_without_a_prior_manifest_seeds_defaults_once() -> None:
    state, link, _clock = build_state()

    deliver_manifest(state, adoption=SECOND_ADOPTION)

    assert state.manifest_revision == 1
    assert state.values.values_of("/avatar/blend/smile") == (0.35,)
    assert link.sent == []


# --- 適用トリガの押下・エコー待ち・通知(5.1) -----------------------------


def build_staging_state() -> tuple[SurfaceState, FakeLink, Clock]:
    state, link, clock = build_state()
    deliver_manifest(state, STAGING_MANIFEST)
    return state, link, clock


def press(state: SurfaceState, address: str) -> None:
    entry = state.entry_for(address)
    assert entry is not None
    state.press_trigger(entry)


def notice_messages(state: SurfaceState, level: str | None = None) -> list[str]:
    return [notice.message for notice in state.notices_since(0) if level is None or notice.level == level]


def test_press_trigger_sends_scope_values_in_definition_order_then_the_trigger() -> None:
    state, link, _clock = build_staging_state()

    press(state, "/member/01/update")

    assert link.batches == [MEMBER_01_BATCH]
    assert link.sent == []
    assert not any(isinstance(value, bool) for _address, args in link.batches[0] for _tag, value in args)
    assert state.values.values_of("/member/01/update") == (1,)
    assert set(state.pending_applies) == {"/member/01/update"}
    assert state.pending_applies["/member/01/update"].value_count == 2
    assert notice_messages(state) == []


def test_press_trigger_without_applies_to_sends_the_on_value_alone() -> None:
    state, link, _clock = build_staging_state()

    press(state, "/legacy/update")

    assert link.batches == []
    assert link.sent == [("/legacy/update", [{"type": "i", "value": 1}])]
    assert state.pending_applies == {}


def test_press_trigger_with_an_empty_scope_sends_the_on_value_and_warns() -> None:
    state, link, _clock = build_staging_state()

    press(state, "/nothing/update")

    assert link.batches == []
    assert link.sent == [("/nothing/update", [{"type": "i", "value": 1}])]
    assert state.pending_applies == {}
    assert notice_messages(state, "warn") == ["Nothing Update: 適用対象がありません"]


def test_new_adoption_clears_stale_echo_of_an_entry_without_default() -> None:
    """再起動後の Unity が default を供給しないエントリは、前のインスタンスの
    エコー値を表示にも適用セットにも残さない(no-value として除外する)。"""
    manifest = {
        **STAGING_MANIFEST,
        "entries": [
            *STAGING_MANIFEST["entries"],
            {
                "address": "/member/01/note",
                "label": "Member 01 Note",
                "type": "s",
                "widget": "input",
                "staged": True,
            },
        ],
    }
    state, link, _clock = build_state()
    deliver_manifest(state, manifest)
    deliver_echo(state, "/member/01/note", ("s", "old-instance"))

    press(state, "/member/01/update")
    assert link.batches[-1][:3] == MEMBER_01_BATCH[:2] + [("/member/01/note", [("s", "old-instance")])]

    deliver_manifest(state, manifest, adoption=SECOND_ADOPTION)
    assert state.values.values_of("/member/01/note") is None
    assert state.manifest_revision == 1

    press(state, "/member/01/update")
    assert link.batches[-1] == MEMBER_01_BATCH
    assert notice_messages(state, "warn") == ["Member 01 Update: 1 件を送信対象から除外しました(ログ確認)"]
    assert link.sent == []


def test_press_trigger_refuses_a_trigger_whose_scope_contains_a_staged_xy_entry() -> None:
    """Unity のステージングは xy の最初の引数しか記録しないため、UI で除外しても
    Unity 側の適用範囲には残る。X だけが適用される押下自体を止めて error 通知する。"""
    manifest = {
        **STAGING_MANIFEST,
        "entries": [
            *STAGING_MANIFEST["entries"],
            {
                "address": "/member/01/position",
                "label": "Member 01 Position",
                "type": "f",
                "widget": "xy",
                "range": [0, 1],
                "default": 0.5,
                "staged": True,
            },
        ],
    }
    state, link, _clock = build_state()
    deliver_manifest(state, manifest)

    press(state, "/member/01/update")

    assert link.batches == []
    assert link.sent == []
    assert state.pending_applies == {}
    assert state.values.values_of("/member/01/update") == (0,)
    errors = notice_messages(state, "error")
    assert len(errors) == 1
    assert errors[0].startswith("Member 01 Update: 適用範囲に xy エントリ(/member/01/position)が含まれるため送信しません")

    # 範囲に xy を含まないトリガは影響を受けない
    press(state, "/legacy/update")
    assert link.sent == [("/legacy/update", [{"type": "i", "value": 1}])]


def test_press_trigger_rejects_a_set_over_the_batch_limit_before_encoding() -> None:
    """512 件の値 + トリガ = 513 件はエンコーダが例外を投げるため、その手前で弾いて通知する。"""
    manifest = {
        "version": 1,
        "projectId": "oscdesk-demo",
        "entries": [
            {
                "address": f"/big/{index:03d}/v",
                "label": f"Big {index}",
                "type": "i",
                "widget": "fader",
                "range": [0, 10],
                "default": 1,
                "staged": True,
            }
            for index in range(512)
        ]
        + [
            {
                "address": "/big/all/update",
                "label": "Big Update",
                "type": "i",
                "widget": "button",
                "default": 0,
                "appliesTo": ["/big/*/*"],
            }
        ],
    }
    state, link, _clock = build_state()
    deliver_manifest(state, manifest)

    press(state, "/big/all/update")

    assert link.batches == []
    assert link.sent == []
    assert state.pending_applies == {}
    assert state.values.values_of("/big/all/update") == (0,)
    assert notice_messages(state, "error") == [
        "Big Update: 適用セットが 513 件で上限 512 件を超えているため送信しません"
    ]


def test_press_trigger_includes_an_edited_value_that_was_already_confirmed() -> None:
    state, link, _clock = build_staging_state()
    deliver_echo(state, "/member/01/name", ("s", "Carol"))

    press(state, "/member/01/update")

    assert link.batches[0][0] == ("/member/01/name", [("s", "Carol")])


def test_press_trigger_reports_an_error_when_the_bridge_is_disconnected() -> None:
    state, link, _clock = build_staging_state()
    link.connected = False

    press(state, "/member/01/update")

    assert link.batches == []
    assert state.pending_applies == {}
    assert notice_messages(state, "error") == ["ブリッジ未接続のため Member 01 Update を適用できません"]


def test_nonzero_trigger_echo_clears_the_pending_apply() -> None:
    state, _link, clock = build_staging_state()
    press(state, "/member/01/update")

    deliver_echo(state, "/member/01/update", ("i", 0))
    assert set(state.pending_applies) == {"/member/01/update"}

    deliver_echo(state, "/member/01/update", ("i", 1))
    assert state.pending_applies == {}

    clock.now = APPLY_ECHO_TIMEOUT_S + 1
    state.tick()
    assert notice_messages(state) == []


def test_pending_apply_expires_into_an_unconfirmed_error_notice() -> None:
    state, _link, clock = build_staging_state()
    press(state, "/member/01/update")

    clock.now = APPLY_ECHO_TIMEOUT_S - 0.1
    state.tick()
    assert notice_messages(state) == []

    clock.now = APPLY_ECHO_TIMEOUT_S
    state.tick()
    assert state.pending_applies == {}
    errors = notice_messages(state, "error")
    assert len(errors) == 1
    assert "Member 01 Update" in errors[0]
    assert "確認できませんでした" in errors[0]
    assert "未適用" not in errors[0]

    state.tick()
    assert len(notice_messages(state)) == 1


def test_late_echo_within_the_window_reports_info_once() -> None:
    state, _link, clock = build_staging_state()
    press(state, "/member/01/update")
    clock.now = APPLY_ECHO_TIMEOUT_S
    state.tick()

    clock.now = APPLY_ECHO_TIMEOUT_S + APPLY_LATE_ECHO_WINDOW_S - 0.1
    deliver_echo(state, "/member/01/update", ("i", 1))
    deliver_echo(state, "/member/01/update", ("i", 1))

    assert notice_messages(state, "info") == ["Member 01 Update の適用が遅れて確認されました"]


def test_late_echo_after_the_window_is_ignored() -> None:
    state, _link, clock = build_staging_state()
    press(state, "/member/01/update")
    clock.now = APPLY_ECHO_TIMEOUT_S
    state.tick()

    clock.now = APPLY_ECHO_TIMEOUT_S + APPLY_LATE_ECHO_WINDOW_S
    state.tick()
    deliver_echo(state, "/member/01/update", ("i", 1))

    assert notice_messages(state, "info") == []


@pytest.mark.parametrize(
    ("level", "code"),
    [
        ("error", "batch-rejected"),
        # ui-hub はスキーマ違反(例: 513 件超のバッチ)を warn の invalid-frame で返す
        ("warn", "invalid-frame"),
        ("error", "invalid-frame"),
    ],
)
def test_bridge_rejection_notice_fails_the_pending_apply(level: str, code: str) -> None:
    state, _link, clock = build_staging_state()
    press(state, "/member/01/update")

    state._on_frame(NoticeFrame(type="notice", level=level, code=code, detail="too-large: 70000 bytes"))

    assert state.pending_applies == {}
    errors = notice_messages(state, "error")
    assert errors == ["Member 01 Update の適用をブリッジが拒否しました: too-large: 70000 bytes"]

    clock.now = APPLY_ECHO_TIMEOUT_S
    state.tick()
    assert notice_messages(state, "error") == errors


def test_other_notices_do_not_touch_the_pending_apply() -> None:
    state, _link, _clock = build_staging_state()
    press(state, "/member/01/update")

    state._on_frame(NoticeFrame(type="notice", level="warn", code="manifest-size", detail="58000 bytes"))

    assert set(state.pending_applies) == {"/member/01/update"}
    assert notice_messages(state) == []


def test_disconnect_fails_every_pending_apply() -> None:
    state, _link, _clock = build_staging_state()
    press(state, "/member/01/update")

    state._on_link_status(LinkStatus(connected=False, detail="切断"))

    assert state.pending_applies == {}
    assert notice_messages(state, "error") == ["ブリッジ未接続のため Member 01 Update を適用できません"]


def test_notices_since_returns_only_entries_after_the_cursor() -> None:
    state, _link, _clock = build_staging_state()
    press(state, "/nothing/update")
    first = state.notices_since(0)
    assert [notice.level for notice in first] == ["warn"]

    press(state, "/nothing/update")

    later = state.notices_since(first[-1].seq)
    assert len(later) == 1
    assert later[0].seq == first[-1].seq + 1
    assert state.notices_since(later[0].seq) == ()


def test_reports_a_broken_manifest_without_crashing() -> None:
    state, _link, _clock = build_state()

    deliver_manifest(state, "{not json")

    assert state.manifest is None
    assert state.manifest_status.detail == "不正"


def test_sends_operated_values_to_the_configured_unity_target() -> None:
    state, link, _clock = build_state()
    deliver_manifest(state)
    entry = state.entry_for("/avatar/blend/smile")
    assert entry is not None

    state.set_local(entry, (0.5,))

    assert link.sent == [("/avatar/blend/smile", [{"type": "f", "value": 0.5}])]


def test_sends_bool_entries_as_int_zero_or_one() -> None:
    state, link, _clock = build_state()
    deliver_manifest(state)
    entry = state.entry_for("/avatar/toggle/visible")
    assert entry is not None

    state.set_discrete(entry, (0,))

    assert link.sent == [("/avatar/toggle/visible", [{"type": "i", "value": 0}])]


def test_never_sends_for_display_only_entries() -> None:
    state, link, _clock = build_state()
    deliver_manifest(state)
    entry = state.entry_for("/avatar/text/name")
    assert entry is not None

    state.set_local(entry, ("hello",))

    assert link.sent == []


def test_thins_out_a_drag_and_sends_the_final_value_on_tick() -> None:
    state, link, clock = build_state()
    deliver_manifest(state)
    entry = state.entry_for("/avatar/blend/smile")
    assert entry is not None

    state.begin_hold(entry.address)
    state.set_local(entry, (0.1,))
    clock.now = 0.01
    state.set_local(entry, (0.2,))
    clock.now = 0.02
    state.set_local(entry, (0.3,))

    assert [values for _address, values in link.sent] == [[{"type": "f", "value": 0.1}]]

    clock.now = 0.2
    state.tick()

    assert [values for _address, values in link.sent] == [
        [{"type": "f", "value": 0.1}],
        [{"type": "f", "value": 0.3}],
    ]


def test_release_sends_the_final_value_immediately() -> None:
    state, link, clock = build_state()
    deliver_manifest(state)
    entry = state.entry_for("/avatar/blend/smile")
    assert entry is not None

    state.begin_hold(entry.address)
    state.set_local(entry, (0.1,))
    clock.now = 0.01
    state.set_local(entry, (0.9,))
    state.end_hold(entry)

    assert [values for _address, values in link.sent] == [
        [{"type": "f", "value": 0.1}],
        [{"type": "f", "value": 0.9}],
    ]


def test_tick_expires_input_and_existing_widget_holds_using_their_timeouts() -> None:
    state, link, clock = build_state()
    manifest = {
        **MANIFEST,
        "entries": [
            *MANIFEST["entries"],
            {
                "address": "/config/name",
                "label": "Name",
                "type": "s",
                "widget": "input",
            },
        ],
    }
    deliver_manifest(state, manifest)
    fader = state.entry_for("/avatar/blend/smile")
    input_entry = state.entry_for("/config/name")
    assert fader is not None and input_entry is not None

    state.begin_hold(fader.address)
    state.begin_hold(input_entry.address)
    assert state.values.channel(fader.address).hold_timeout_s == 2.0
    assert state.values.channel(input_entry.address).hold_timeout_s == 120.0

    clock.now = 2.0
    state.tick()
    assert state.values.channel(fader.address).holding is False
    assert state.values.channel(input_entry.address).holding is True

    clock.now = 120.0
    state.tick()
    assert state.values.channel(input_entry.address).holding is False
    assert link.sent == []


def test_echo_back_is_the_source_of_truth_once_the_operation_ends() -> None:
    state, _link, _clock = build_state()
    deliver_manifest(state)
    entry = state.entry_for("/avatar/blend/smile")
    assert entry is not None

    state.begin_hold(entry.address)
    state.set_local(entry, (0.9,))
    deliver_echo(state, entry.address, ("f", 0.1))

    assert state.values.values_of(entry.address) == (0.9,)

    state.end_hold(entry)
    deliver_echo(state, entry.address, ("f", 0.1))

    assert state.values.values_of(entry.address) == (0.1,)


def test_input_confirmation_arbitrates_echoes_across_the_state_transition() -> None:
    state, link, clock = build_state()
    manifest = {
        "version": 1,
        "projectId": "input-arbitration",
        "entries": [
            {
                "address": f"/group/{index}/value",
                "label": f"Value {index}",
                "type": "f",
                "widget": "fader",
                "default": 0.0,
            }
            for index in range(258)
        ]
        + [
            {
                "address": "/config/name",
                "label": "Name",
                "type": "s",
                "widget": "input",
                "default": "START",
            },
            {
                "address": "/config/mode",
                "label": "Mode",
                "type": "s",
                "widget": "select",
                "options": ["A", "B"],
                "default": "A",
            },
        ],
    }
    deliver_manifest(state, manifest)
    assert state.manifest_status.entry_count == 260
    entry = state.entry_for("/config/name")
    assert entry is not None

    state.begin_hold(entry.address)
    state.set_local(entry, ("EDITING",))
    clock.now = 0.01
    state.set_local(entry, ("EDITING-AGAIN",))

    # Unity の処理前に届いたエコーバックは、編集中の UI 値を上書きしない。
    deliver_echo(state, entry.address, ("s", "UNITY-BEFORE-CONFIRM"))
    assert state.values.values_of(entry.address) == ("EDITING-AGAIN",)
    assert link.sent == [
        ("/config/name", [{"type": "s", "value": "EDITING"}]),
    ]

    # 確定時に保留値を送り、以降は Unity のエコーバックを表示値の正とする。
    state.end_hold(entry)
    assert link.sent == [
        ("/config/name", [{"type": "s", "value": "EDITING"}]),
        ("/config/name", [{"type": "s", "value": "EDITING-AGAIN"}]),
    ]

    deliver_echo(state, entry.address, ("s", "UNITY-CONFIRMED"))
    assert state.values.values_of(entry.address) == ("UNITY-CONFIRMED",)


def test_unity_hostname_matches_numeric_echo_source() -> None:
    """unity.host がホスト名でも、数値アドレスで届く UDP 送信元をエコーとして受理する。"""
    clock = Clock()
    config = AppConfig(
        unity=UnityTarget(host="localhost", send_port=7090, receive_port=7091),
    )
    state = SurfaceState(config, clock=clock, min_send_interval_s=0.1, link_factory=FakeLink)
    deliver_manifest(state)
    entry = state.entry_for("/avatar/blend/smile")
    assert entry is not None

    deliver_echo(state, entry.address, ("f", 0.25))

    assert state.values.values_of(entry.address) == (0.25,)


def test_non_unity_sources_never_confirm_values() -> None:
    """oscUi 有効時は OSC ネイティブ UI の操作値も from つきで届く。
    Unity 以外の送信元は表示キャッシュを確定させない(値の確定は Unity のエコーのみ)。"""
    state, _link, _clock = build_state()
    deliver_manifest(state)
    entry = state.entry_for("/avatar/blend/smile")
    assert entry is not None
    before = state.values.values_of(entry.address)

    state._on_frame(
        OscFrame(
            type="osc",
            address=entry.address,
            args=(WireArg(type="f", value=0.1),),
            source=Peer(host="192.168.0.50", port=9100),
        )
    )

    assert state.values.values_of(entry.address) == before


def test_internal_namespaces_never_reach_the_value_store() -> None:
    state, _link, _clock = build_state()

    deliver_echo(state, "/sys/pong", ("i", 1))

    assert state.values.values_of("/sys/pong") is None
    assert state.values.values_of("/oscdesk/diag") is None


def test_disconnect_drops_pending_sends() -> None:
    from oscdesk_ui.surface_link import LinkStatus

    state, link, clock = build_state()
    deliver_manifest(state)
    entry = state.entry_for("/avatar/blend/smile")
    assert entry is not None

    state.set_local(entry, (0.1,))
    clock.now = 0.01
    state.set_local(entry, (0.3,))
    state._on_link_status(LinkStatus(connected=False, detail="切断"))

    clock.now = 1.0
    state.tick()

    assert [values for _address, values in link.sent] == [[{"type": "f", "value": 0.1}]]


def test_disconnect_releases_client_holds_and_sends_pending_value() -> None:
    state, link, clock = build_state()
    deliver_manifest(state)
    entry = state.entry_for("/avatar/blend/smile")
    assert entry is not None

    state.begin_hold(entry.address)
    state.set_local(entry, (0.1,))
    clock.now = 0.01
    state.set_local(entry, (0.3,))

    state.release_holds([entry.address])
    deliver_echo(state, entry.address, ("f", 0.3))

    assert state.values.channel(entry.address).holding is False
    assert [values for _address, values in link.sent] == [
        [{"type": "f", "value": 0.1}],
        [{"type": "f", "value": 0.3}],
    ]


# --- マニフェストの組・計画外エコー・再採用の固定(runtime-manifest-reinject P2) ------

BOOT_A = "3f9c2a7e0b1d4c58a6e2f7b9d0c1e3a4"
BOOT_B = "9b1d4c58a6e2f7b9d0c1e3a43f9c2a7e"
THIRD_ADOPTION = {"seq": 3, "at": "2026-01-01T00:00:02Z"}


def with_origin(manifest: dict, boot_id: Any, generation: Any) -> dict:
    return {**manifest, "bootId": boot_id, "structureGeneration": generation}


def restart_notices(state: SurfaceState) -> list[str]:
    return [message for message in notice_messages(state, "warn") if "再起動" in message]


def test_restart_notice_fires_once_when_boot_id_changes() -> None:
    state, _link, _clock = build_state()

    deliver_manifest(state, with_origin(MANIFEST, BOOT_A, 0), adoption=ADOPTION)
    assert restart_notices(state) == []
    deliver_manifest(state, with_origin(MANIFEST, BOOT_B, 0), adoption=SECOND_ADOPTION)

    assert len(restart_notices(state)) == 1
    deliver_manifest(state, with_origin(MANIFEST, BOOT_B, 1), adoption=THIRD_ADOPTION)
    assert len(restart_notices(state)) == 1


def test_no_restart_notice_for_first_adoption_same_boot_or_missing_origin() -> None:
    state, _link, _clock = build_state()

    deliver_manifest(state, with_origin(MANIFEST, BOOT_A, 0), adoption=ADOPTION)
    deliver_manifest(state, with_origin(MANIFEST, BOOT_A, 1), adoption=SECOND_ADOPTION)
    assert restart_notices(state) == []

    legacy, _link, _clock = build_state()
    deliver_manifest(legacy, MANIFEST, adoption=ADOPTION)
    deliver_manifest(legacy, MANIFEST, adoption=SECOND_ADOPTION)
    assert restart_notices(legacy) == []


@pytest.mark.parametrize(
    "boot_id, generation",
    [("", 0), (None, 0), (BOOT_A, None), (BOOT_A, True), (BOOT_A, -1), (BOOT_A, 1.5), (7, 0)],
)
def test_malformed_origin_is_treated_as_no_origin_and_does_not_stop_adoption(boot_id: Any, generation: Any) -> None:
    state, _link, _clock = build_state()
    deliver_manifest(state, with_origin(MANIFEST, BOOT_A, 0), adoption=ADOPTION)

    deliver_manifest(state, with_origin(MANIFEST, boot_id, generation), adoption=SECOND_ADOPTION)

    assert restart_notices(state) == []
    assert state.manifest_status.detail == "採用済み"
    # 組なしの採用で記録は消えるため、次に別の bootId が来ても「直前の採用の bootId」が無く通知しない
    deliver_manifest(state, with_origin(MANIFEST, BOOT_B, 0), adoption=THIRD_ADOPTION)
    assert restart_notices(state) == []


def test_origin_fields_do_not_change_manifest_equality() -> None:
    from oscdesk_ui.manifest import parse_manifest, parse_manifest_origin

    assert parse_manifest(with_origin(MANIFEST, BOOT_A, 3)) == parse_manifest(MANIFEST)
    origin = parse_manifest_origin(with_origin(MANIFEST, BOOT_A, 3))
    assert origin is not None and (origin.boot_id, origin.structure_generation) == (BOOT_A, 3)
    assert parse_manifest_origin(MANIFEST) is None
    assert parse_manifest_origin([]) is None


def test_off_manifest_echo_never_reaches_display_or_cache() -> None:
    state, _link, _clock = build_state()
    deliver_manifest(state)

    deliver_echo(state, "/avatar/blend/unplanned", ("f", 0.7))
    deliver_echo(state, "/avatar/blend/smile", ("f", 0.9))

    assert state.values.values_of("/avatar/blend/unplanned") is None
    assert state.values.get("/avatar/blend/unplanned") is None
    assert state.values.values_of("/avatar/blend/smile") == (0.9,)


def test_every_echo_is_dropped_before_a_manifest_is_adopted() -> None:
    state, _link, _clock = build_state()

    deliver_echo(state, "/avatar/blend/smile", ("f", 0.9))

    assert state.values.get("/avatar/blend/smile") is None


def test_echo_for_an_address_removed_by_readoption_is_dropped() -> None:
    state, _link, _clock = build_state()
    deliver_manifest(state)
    reduced = {**MANIFEST, "entries": MANIFEST["entries"][:1]}
    deliver_manifest(state, reduced, adoption=SECOND_ADOPTION)

    deliver_echo(state, "/avatar/toggle/visible", ("i", 0))

    assert state.entry_for("/avatar/toggle/visible") is None
    assert state.values.values_of("/avatar/toggle/visible") == (True,)  # 取り込まれず、seed 済みの default のまま


def test_readoption_with_added_and_removed_rows_redraws() -> None:
    state, _link, _clock = build_state()
    deliver_manifest(state)
    grown = {
        **MANIFEST,
        "entries": [
            *MANIFEST["entries"],
            {"address": "/avatar/blend/frown", "label": "Frown", "type": "f", "widget": "fader", "default": 0.1},
        ],
    }
    deliver_manifest(state, grown, adoption=SECOND_ADOPTION)
    assert state.manifest_revision == 2
    assert state.entry_for("/avatar/blend/frown") is not None

    shrunk = {**MANIFEST, "entries": MANIFEST["entries"][:2]}
    deliver_manifest(state, shrunk, adoption=THIRD_ADOPTION)

    assert state.manifest_revision == 3
    assert state.entry_for("/avatar/blend/frown") is None
    assert state.entry_for("/avatar/text/name") is None


def test_same_adoption_replay_keeps_input_display_and_apply_set_values() -> None:
    state, link, _clock = build_state()
    deliver_manifest(state, STAGING_MANIFEST)
    name = state.entry_for("/member/01/name")
    assert name is not None
    deliver_echo(state, name.address, ("s", "Echoed"))
    state.begin_hold(name.address)
    state.set_draft(name, "TYPING")
    revision = state.manifest_revision

    deliver_manifest(state, STAGING_MANIFEST, adoption=ADOPTION)

    assert state.manifest_revision == revision
    assert state.values.channel(name.address).holding is True
    assert state.values.draft_of(name.address) == (True, "TYPING")
    assert state.values.values_of(name.address) == ("Echoed",)
    state.values.channel(name.address).cancel_hold()
    press(state, "/member/01/update")
    assert link.batches[-1][0] == (name.address, [("s", "Echoed")])


def test_widget_only_change_redraws_and_resyncs_display_to_default() -> None:
    state, link, _clock = build_state()
    base = {
        "version": 1,
        "projectId": "oscdesk-demo",
        "entries": [
            {"address": "/dev/value", "label": "V", "type": "f", "widget": "fader", "range": [0, 1], "default": 0.25},
        ],
    }
    deliver_manifest(state, base)
    deliver_echo(state, "/dev/value", ("f", 0.8))
    revision = state.manifest_revision

    changed = {**base, "entries": [{**base["entries"][0], "widget": "input"}]}
    deliver_manifest(state, changed, adoption=SECOND_ADOPTION)

    assert state.manifest_revision == revision + 1
    entry = state.entry_for("/dev/value")
    assert entry is not None and entry.widget == "input"
    assert state.values.values_of("/dev/value") == (0.25,)
    assert link.sent == []


def test_link_frame_exposes_targets_and_resend_goes_to_the_link() -> None:
    from oscdesk_ui.protocol import LinkFrame

    state, link, _clock = build_state()
    state._on_frame(
        LinkFrame(
            type="link",
            unity={"reachability": "reachable", "lastRttMs": 3, "consecutiveLosses": 0, "lastPongSeq": 1},
            targets=(
                {"name": "unity", "primary": True, "reachability": "reachable", "lastRttMs": 3, "consecutiveLosses": 0},
                {"name": "backup", "primary": False, "reachability": "lost", "lastRttMs": None, "consecutiveLosses": 3},
            ),
            manifest={"state": "none"},
        )
    )
    assert [(t.name, t.primary, t.reachability) for t in state.unity_targets] == [
        ("unity", True, "reachable"),
        ("backup", False, "lost"),
    ]
    state.request_resend("backup")
    state.request_resend()
    assert link.resends == ["backup", None]
