from __future__ import annotations

from typing import Any

from oscdesk_ui.config import AppConfig, UnityTarget
from oscdesk_ui.protocol import LinkFrame, NoticeFrame, OscFrame, Peer, SurfaceListFrame, WireArg
from oscdesk_ui.state import SurfaceState
from oscdesk_ui.surface_link import LinkStatus

from .surface_fixtures import control, definition, desired_frame, echo_frame, param, surface_frame

DEFINITION = definition(
    [
        param("smile", "/avatar/blend/smile", "f", "Smile", range=[0, 1], default=0.35),
        param("visible", "/avatar/toggle/visible", "bool", "Visible", default=True),
        param("name", "/config/name", "s", "Name"),
        param("go", "/cue/go", "i", "GO", kind="trigger", value=1),
        param("armed", "/cue/armed", "bool", "Armed", kind="trigger", value=True),
        param("part", "/cue/part", "i", "Part", kind="trigger", value=1, standalone=False),
        param("slot", "/slot/01", "f", "Slot", range=[0, 1], default=0.0, standalone=False),
    ],
    [
        control("smile"),
        control("visible"),
        control("name"),
        control("go"),
        control("armed"),
        control("part"),
        control("slot"),
    ],
)


class FakeLink:
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self.sent: list[tuple[str, list[Any]]] = []
        self.connected = True
        self.surface_requests = 0
        self.resends: list[str | None] = []

    def send_osc(self, address: str, args: list[Any]) -> None:
        self.sent.append((address, args))

    def request_surface(self) -> None:
        self.surface_requests += 1

    def request_resend(self, target: str | None = None) -> None:
        self.resends.append(target)

    def update_heartbeat(self, interval_s: float) -> None:
        pass


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def build_state(host: str = "127.0.0.1") -> tuple[SurfaceState, FakeLink, Clock]:
    clock = Clock()
    config = AppConfig(unity=UnityTarget(host=host, send_port=7090, receive_port=7091))
    state = SurfaceState(config, clock=clock, min_send_interval_s=0.1, link_factory=FakeLink)

    return state, state.link, clock  # type: ignore[return-value]


def deliver_surface(state: SurfaceState, defn: dict[str, Any] = DEFINITION, name: str = "test", revision: int = 1) -> None:
    state._on_frame(surface_frame(defn, name, revision))


def spec(state: SurfaceState, address: str) -> Any:
    entry = state.entry_for(address)
    assert entry is not None
    return entry


# --- 定義の取り込み -------------------------------------------------------


def test_adopts_a_surface_and_seeds_state_defaults() -> None:
    state, _link, _clock = build_state()

    deliver_surface(state, name="stage", revision=4)

    assert state.surface is not None
    assert state.surface_revision == 1
    assert state.surface_status.detail == "採用済み"
    assert (state.surface_status.name, state.surface_status.revision, state.surface_status.parameter_count) == ("stage", 4, 7)
    assert state.entry_for("/avatar/blend/smile") is state.surface.parameters[0]
    assert state.entry_for("/missing") is None
    assert state.values.values_of("/avatar/blend/smile") == (0.35,)
    assert state.values.values_of("/avatar/toggle/visible") == (True,)
    # default の無い state と、トリガは表示値を持たない
    assert state.values.values_of("/config/name") is None
    assert state.values.get("/cue/go") is None


def test_redelivery_of_the_same_definition_does_not_rebuild_the_screen() -> None:
    state, _link, _clock = build_state()

    deliver_surface(state, revision=1)
    state._on_frame(echo_frame("/avatar/blend/smile", ("f", 0.9)))
    deliver_surface(state, revision=2)

    assert state.surface_revision == 1
    assert state.surface_status.revision == 2
    assert state.values.values_of("/avatar/blend/smile") == (0.9,)


def test_a_changed_definition_rebuilds_and_keeps_existing_values() -> None:
    state, link, _clock = build_state()
    deliver_surface(state)
    state._on_frame(echo_frame("/avatar/blend/smile", ("f", 0.9)))

    changed = definition(
        [param("smile", "/avatar/blend/smile", "f", "Smile", range=[0, 1], default=0.1)],
    )
    deliver_surface(state, changed, revision=2)

    assert state.surface_revision == 2
    assert state.entry_for("/avatar/toggle/visible") is None
    # 値の引き継ぎはブリッジの保持値(desired)が決める。UI は default で巻き戻さない
    assert state.values.values_of("/avatar/blend/smile") == (0.9,)
    assert link.sent == []


def test_a_changed_definition_cancels_holds_and_drops_drafts_without_sending() -> None:
    state, link, clock = build_state()
    deliver_surface(state)
    smile = spec(state, "/avatar/blend/smile")
    name = spec(state, "/config/name")
    state.begin_hold(smile.address)
    state.set_local(smile, (0.1,))
    clock.now = 0.01
    state.set_local(smile, (0.9,))  # 間引きで保留される
    state.begin_hold(name.address)
    state.set_draft(name, "TYPING")
    sent_before = list(link.sent)

    deliver_surface(state, definition([param("smile", "/avatar/blend/smile", "f", range=[0, 1])]), revision=2)

    assert state.values.channel(smile.address).holding is False
    assert state.values.channel(name.address).holding is False
    assert state.values.draft_of(name.address) == (False, None)
    clock.now = 1.0
    state.tick()
    assert link.sent == sent_before


def test_surface_list_is_kept() -> None:
    state, _link, _clock = build_state()

    state._on_frame(SurfaceListFrame(type="surfaceList", names=("stage", "stage-b"), active="stage"))

    assert (state.surface_names, state.active_surface) == (("stage", "stage-b"), "stage")


def test_surface_rejected_notice_is_shown_and_other_notices_are_not() -> None:
    state, _link, _clock = build_state()

    state._on_frame(NoticeFrame(type="notice", level="error", code="surface-rejected", detail="parameters/0: bad"))
    state._on_frame(NoticeFrame(type="notice", level="warn", code="something-else", detail="x"))

    notices = state.notices_since(0)
    assert [(n.level, "parameters/0: bad" in n.message) for n in notices] == [("error", True)]
    assert state.notices_since(notices[-1].seq) == ()


# --- desired(保持値) ------------------------------------------------------


def test_full_desired_replaces_the_displayed_values() -> None:
    state, link, _clock = build_state()
    deliver_surface(state)
    state._on_frame(echo_frame("/config/name", ("s", "OLD")))

    state._on_frame(
        desired_frame({"/avatar/blend/smile": [("f", 0.8)], "/avatar/toggle/visible": [("i", 0)], "/unplanned": [("i", 1)]})
    )

    assert state.values.values_of("/avatar/blend/smile") == (0.8,)
    assert state.values.values_of("/avatar/toggle/visible") == (0,)
    # 保持値に無い state は表示を消す(古い値を残さない)
    assert state.values.values_of("/config/name") is None
    assert state.values.get("/unplanned") is None
    assert link.sent == []


def test_partial_desired_updates_only_the_listed_values() -> None:
    state, _link, _clock = build_state()
    deliver_surface(state)

    state._on_frame(desired_frame({"/avatar/blend/smile": [("f", 0.6)]}, full=False))

    assert state.values.values_of("/avatar/blend/smile") == (0.6,)
    assert state.values.values_of("/avatar/toggle/visible") == (True,)


def test_desired_does_not_overwrite_a_value_being_operated() -> None:
    state, _link, _clock = build_state()
    deliver_surface(state)
    smile = spec(state, "/avatar/blend/smile")
    state.begin_hold(smile.address)
    state.set_local(smile, (0.9,))

    state._on_frame(desired_frame({smile.address: [("f", 0.1)]}))
    assert state.values.values_of(smile.address) == (0.9,)

    state.end_hold(smile)
    assert state.values.values_of(smile.address) == (0.1,)


def test_desired_ignores_blobs_and_empty_args() -> None:
    state, _link, _clock = build_state()
    deliver_surface(state)

    state._on_frame(desired_frame({"/avatar/blend/smile": [("b", "AAAA")], "/avatar/toggle/visible": []}, full=False))

    assert state.values.values_of("/avatar/blend/smile") == (0.35,)
    assert state.values.values_of("/avatar/toggle/visible") == (True,)


# --- 送信 -----------------------------------------------------------------


def test_sends_operated_values_to_the_configured_unity_target() -> None:
    state, link, _clock = build_state()
    deliver_surface(state)

    state.set_local(spec(state, "/avatar/blend/smile"), (0.5,))

    assert link.sent == [("/avatar/blend/smile", [{"type": "f", "value": 0.5}])]


def test_sends_bool_parameters_as_int_zero_or_one() -> None:
    state, link, _clock = build_state()
    deliver_surface(state)

    state.set_discrete(spec(state, "/avatar/toggle/visible"), (0,))

    assert link.sent == [("/avatar/toggle/visible", [{"type": "i", "value": 0}])]


def test_pressing_a_trigger_sends_its_value_once_and_keeps_no_display_value() -> None:
    state, link, _clock = build_state()
    deliver_surface(state)

    state.press_trigger(spec(state, "/cue/go"))
    state.press_trigger(spec(state, "/cue/armed"))

    assert link.sent == [
        ("/cue/go", [{"type": "i", "value": 1}]),
        ("/cue/armed", [{"type": "i", "value": 1}]),
    ]
    assert state.values.get("/cue/go") is None


def test_standalone_false_parameters_are_never_sent_on_their_own() -> None:
    state, link, clock = build_state()
    deliver_surface(state)
    slot = spec(state, "/slot/01")

    state.begin_hold(slot.address)
    state.set_local(slot, (0.7,))
    state.end_hold(slot)
    state.set_discrete(slot, (0.2,))
    state.press_trigger(spec(state, "/cue/part"))
    clock.now = 1.0
    state.tick()

    assert link.sent == []
    # 操作は表示としては残す(まとめ送りの材料になる。HID-166)
    assert state.values.values_of("/slot/01") == (0.2,)


def test_thins_out_a_drag_and_sends_the_final_value_on_tick() -> None:
    state, link, clock = build_state()
    deliver_surface(state)
    entry = spec(state, "/avatar/blend/smile")

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
    deliver_surface(state)
    entry = spec(state, "/avatar/blend/smile")

    state.begin_hold(entry.address)
    state.set_local(entry, (0.1,))
    clock.now = 0.01
    state.set_local(entry, (0.9,))
    state.end_hold(entry)

    assert [values for _address, values in link.sent] == [
        [{"type": "f", "value": 0.1}],
        [{"type": "f", "value": 0.9}],
    ]


def test_tick_expires_input_and_slider_holds_using_their_timeouts() -> None:
    state, link, clock = build_state()
    deliver_surface(state)
    slider = spec(state, "/avatar/blend/smile")
    name = spec(state, "/config/name")  # 既定の部品は input

    state.begin_hold(slider.address)
    state.begin_hold(name.address)
    assert state.values.channel(slider.address).hold_timeout_s == 2.0
    assert state.values.channel(name.address).hold_timeout_s == 120.0

    clock.now = 2.0
    state.tick()
    assert state.values.channel(slider.address).holding is False
    assert state.values.channel(name.address).holding is True

    clock.now = 120.0
    state.tick()
    assert state.values.channel(name.address).holding is False
    assert link.sent == []


def test_hold_timeout_follows_the_placed_widget_not_the_default_one() -> None:
    """数値パラメータを input として置いた場合も、入力欄の長い期限で保護する。"""
    state, _link, _clock = build_state()
    deliver_surface(state)

    state.begin_hold("/avatar/blend/smile", "input")

    assert state.values.channel("/avatar/blend/smile").hold_timeout_s == 120.0


# --- エコーバック ---------------------------------------------------------


def test_echo_back_is_applied_once_the_operation_ends() -> None:
    state, _link, _clock = build_state()
    deliver_surface(state)
    entry = spec(state, "/avatar/blend/smile")

    state.begin_hold(entry.address)
    state.set_local(entry, (0.9,))
    state._on_frame(echo_frame(entry.address, ("f", 0.1)))

    assert state.values.values_of(entry.address) == (0.9,)

    state.end_hold(entry)
    state._on_frame(echo_frame(entry.address, ("f", 0.1)))

    assert state.values.values_of(entry.address) == (0.1,)


def test_unity_hostname_matches_numeric_echo_source() -> None:
    """unity.host がホスト名でも、数値アドレスで届く UDP 送信元をエコーとして受理する。"""
    state, _link, _clock = build_state(host="localhost")
    deliver_surface(state)

    state._on_frame(echo_frame("/avatar/blend/smile", ("f", 0.25)))

    assert state.values.values_of("/avatar/blend/smile") == (0.25,)


def test_non_unity_sources_never_update_values() -> None:
    """oscUi 有効時は OSC ネイティブ UI の操作値も from つきで届く。Unity 以外の送信元は表示を変えない。"""
    state, _link, _clock = build_state()
    deliver_surface(state)

    state._on_frame(
        OscFrame(
            type="osc",
            address="/avatar/blend/smile",
            args=(WireArg(type="f", value=0.1),),
            source=Peer(host="192.168.0.50", port=9100),
        )
    )

    assert state.values.values_of("/avatar/blend/smile") == (0.35,)


def test_off_definition_echo_never_reaches_display_or_cache() -> None:
    state, _link, _clock = build_state()
    deliver_surface(state)

    state._on_frame(echo_frame("/avatar/blend/unplanned", ("f", 0.7)))

    assert state.values.get("/avatar/blend/unplanned") is None


def test_every_echo_is_dropped_before_a_definition_is_adopted() -> None:
    state, _link, _clock = build_state()

    state._on_frame(echo_frame("/avatar/blend/smile", ("f", 0.9)))

    assert state.values.get("/avatar/blend/smile") is None


def test_internal_namespaces_never_reach_the_value_store() -> None:
    state, _link, _clock = build_state()

    state._on_frame(echo_frame("/sys/pong", ("i", 1)))

    assert state.values.values_of("/sys/pong") is None
    assert state.values.values_of("/oscdesk/diag") is None


# --- 切断・リンク -----------------------------------------------------------


def test_disconnect_drops_pending_sends() -> None:
    state, link, clock = build_state()
    deliver_surface(state)
    entry = spec(state, "/avatar/blend/smile")

    state.set_local(entry, (0.1,))
    clock.now = 0.01
    state.set_local(entry, (0.3,))
    state._on_link_status(LinkStatus(connected=False, detail="切断"))

    clock.now = 1.0
    state.tick()

    assert [values for _address, values in link.sent] == [[{"type": "f", "value": 0.1}]]


def test_disconnect_releases_client_holds_and_sends_pending_value() -> None:
    state, link, clock = build_state()
    deliver_surface(state)
    entry = spec(state, "/avatar/blend/smile")

    state.begin_hold(entry.address)
    state.set_local(entry, (0.1,))
    clock.now = 0.01
    state.set_local(entry, (0.3,))

    state.release_holds([entry.address])
    state._on_frame(echo_frame(entry.address, ("f", 0.3)))

    assert state.values.channel(entry.address).holding is False
    assert [values for _address, values in link.sent] == [
        [{"type": "f", "value": 0.1}],
        [{"type": "f", "value": 0.3}],
    ]


def test_link_frame_exposes_targets_and_resend_goes_to_the_link() -> None:
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
