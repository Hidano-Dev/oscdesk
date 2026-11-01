"""アクション(HID-166): 押すと複数のパラメータを 1 つのまとめ送り(batch。HID-389)で送る。"""

from __future__ import annotations

from typing import Any

import pytest
from nicegui import ui
from nicegui.testing import user_simulation
from nicegui.testing.user_interaction import UserInteraction

from oscdesk_ui.config import AppConfig, UnityTarget
from oscdesk_ui.page import SurfacePage
from oscdesk_ui.protocol import BatchParam, BatchRow, NoticeFrame
from oscdesk_ui.state import ACTION_ECHO_TIMEOUT_S, SurfaceState
from oscdesk_ui.surface_model import ActionNode, parse_surface

from .surface_fixtures import control, definition, echo_frame, param, surface_frame
from .test_state import Clock


class FakeLink:
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self.sent: list[tuple[str, list[Any]]] = []
        self.batches: list[list[BatchParam | BatchRow]] = []
        self.batch_holders: list[str | None] = []
        self.connected = True

    def send_osc(self, address: str, args: list[Any]) -> None:
        self.sent.append((address, args))

    def send_lock(self, ref: tuple[str, ...], holder: str, label: str) -> None:

        pass


    def send_unlock(self, ref: tuple[str, ...], holder: str) -> None:

        pass


    def send_set(self, param: str, value: Any = None, *, has_value: bool = True, holder: str | None = None, revision: int | None = None) -> None:
        # パラメータは ID と JSON の値で送る(HID-373)。単独送信の有無を同じ sent で確かめる
        self.sent.append((param, value))

    def send_batch(self, items: list[BatchParam | BatchRow], *, holder: str | None = None, revision: int | None = None) -> bool:
        if not self.connected:
            return False
        self.batches.append(list(items))
        self.batch_holders.append(holder)
        return True

    def request_surface(self) -> None:
        pass

    def update_heartbeat(self, interval_s: float) -> None:
        pass


PARAMS = [
    param("slot1", "/slot/01", "f", "Slot 1", range=[0, 1], default=0.0, standalone=False),
    param("slot2", "/slot/02", "f", "Slot 2", range=[0, 1], standalone=False),
    param("mode", "/slot/mode", "s", "Mode", options=["a", "b"], default="a", standalone=False),
    param("flag", "/slot/flag", "bool", "Flag", default=True, standalone=False),
    param("apply", "/cue/apply", "i", "Apply", kind="trigger", value=1),
]
ACTIONS = [
    {"id": "applyAll", "label": "Apply all", "steps": [{"match": "/slot/*"}, {"param": "apply"}]},
    {"id": "reset", "label": "Reset", "steps": [{"param": "slot1", "value": 0}, {"param": "mode", "value": "b"}]},
]
LAYOUT = [control("slot1"), control("slot2"), {"kind": "action", "action": "applyAll"}, {"kind": "action", "action": "reset", "label": "R"}]
DEFINITION = definition(PARAMS, LAYOUT, actions=ACTIONS)


def build_state() -> tuple[SurfaceState, FakeLink, Clock]:
    clock = Clock()
    state = SurfaceState(
        AppConfig(unity=UnityTarget("127.0.0.1", 7090, 7091)), clock=clock, link_factory=FakeLink
    )
    state._on_frame(surface_frame(DEFINITION))
    return state, state.link, clock  # type: ignore[return-value]


def action(state: SurfaceState, action_id: str) -> Any:
    assert state.surface is not None
    return next(item for item in state.surface.actions if item.action_id == action_id)


def notices(state: SurfaceState) -> list[tuple[str, str]]:
    return [(notice.level, notice.message) for notice in state.notices_since(0)]


def sent(link: FakeLink) -> list[tuple[str, Any]]:
    """直近のまとめ送りの (パラメータ id, 値)。値を省いた trigger は None。"""
    return [(item.param, item.value if item.has_value else None) for item in link.batches[-1] if isinstance(item, BatchParam)]


# --- モデル ---------------------------------------------------------------


def test_parse_surface_expands_steps_in_definition_order_and_keeps_layout_label() -> None:
    surface = parse_surface(DEFINITION)

    apply_all = surface.actions[0]
    # selector(版 1 の match)は結び付けから解いた selectors で展開する(D-117)
    assert [t.spec.param_id for t in apply_all.targets] == ["slot1", "slot2", "mode", "flag", "apply"]
    reset = surface.actions[1]
    assert [(t.spec.param_id, t.has_fixed_value, t.fixed_value) for t in reset.targets] == [
        ("slot1", True, 0),
        ("mode", True, "b"),
    ]
    nodes = [n for n in surface.screens[0].layout if isinstance(n, ActionNode)]
    assert [n.action.label for n in nodes] == ["Apply all", "R"]


def test_definition_without_actions_still_parses() -> None:
    assert parse_surface(definition(PARAMS[:1])).actions == ()


# --- 送信 -----------------------------------------------------------------


def test_press_sends_one_batch_in_order_with_current_values() -> None:
    state, link, _clock = build_state()
    slot2 = state.entry_for("slot2")
    assert slot2 is not None
    state.set_local(slot2, (0.5,))
    state.set_discrete(state.entry_for("flag"), (0,))  # type: ignore[arg-type]

    state.press_action(action(state, "applyAll"), holder="page-a")

    assert link.sent == []  # 単独送信は一切無い
    assert len(link.batches) == 1
    assert link.batch_holders == ["page-a"]
    # JSON の値で送る(bool は真偽、trigger は値を省いて定義の value をブリッジが送る。HID-389)
    assert sent(link) == [
        ("slot1", 0.0),
        ("slot2", 0.5),
        ("mode", "a"),
        ("flag", False),
        ("apply", None),
    ]


def test_fixed_values_override_the_current_value() -> None:
    state, link, _clock = build_state()
    state.set_local(state.entry_for("slot1"), (0.9,))  # type: ignore[arg-type]

    state.press_action(action(state, "reset"))

    assert sent(link) == [("slot1", 0.0), ("mode", "b")]


def test_state_without_a_value_is_skipped_with_a_warning() -> None:
    state, link, _clock = build_state()  # slot2 は default が無い

    state.press_action(action(state, "applyAll"))

    assert [item.param for item in link.batches[0]] == ["slot1", "mode", "flag", "apply"]
    assert [level for level, _ in notices(state)] == ["warn"]
    assert "Slot 2" in notices(state)[0][1]  # 通知は部品の表示名で示す


def test_press_while_disconnected_reports_an_error_and_waits_for_nothing() -> None:
    state, link, clock = build_state()
    link.connected = False

    state.press_action(action(state, "reset"))
    clock.now = ACTION_ECHO_TIMEOUT_S + 1
    state.tick()

    assert [level for level, _ in notices(state)] == ["error"]


# --- エコーによる確認 -----------------------------------------------------


def test_all_echoes_confirm_the_batch() -> None:
    state, _link, _clock = build_state()
    state.press_action(action(state, "reset"))

    state._on_frame(echo_frame("slot1", ("f", 0.00001)))
    assert notices(state) == []
    state._on_frame(echo_frame("mode", ("s", "b")))

    assert [level for level, _ in notices(state)] == ["info"]
    assert "2 件を確認" in notices(state)[0][1]


def test_missing_echo_is_reported_once_after_the_timeout() -> None:
    state, _link, clock = build_state()
    state.press_action(action(state, "reset"))
    state._on_frame(echo_frame("slot1", ("f", 0.0)))

    clock.now = ACTION_ECHO_TIMEOUT_S - 0.1
    state.tick()
    assert notices(state) == []
    clock.now = ACTION_ECHO_TIMEOUT_S + 0.1
    state.tick()
    state.tick()

    assert [level for level, _ in notices(state)] == ["error"]
    assert "1 / 2" in notices(state)[0][1] and "Mode" in notices(state)[0][1]


def test_a_wrong_echo_value_does_not_confirm_but_a_trigger_accepts_any_value() -> None:
    state, _link, clock = build_state()
    state.press_action(action(state, "applyAll"))
    state._on_frame(echo_frame("mode", ("s", "zzz")))
    state._on_frame(echo_frame("apply", ("i", 0)))

    clock.now = ACTION_ECHO_TIMEOUT_S + 0.1
    state.tick()

    message = notices(state)[-1][1]
    assert "Mode" in message and message.count("Apply") == 1  # trigger(Apply)は値を問わず確認できている


def test_batch_rejected_ends_the_wait_and_reports_the_reason() -> None:
    state, _link, clock = build_state()
    state.press_action(action(state, "reset"))
    state._on_frame(NoticeFrame(type="notice", level="error", code="batch-rejected", detail="batch exceeds 60KiB"))

    assert [level for level, _ in notices(state)] == ["error"]
    assert "Reset" in notices(state)[0][1] and "batch exceeds 60KiB" in notices(state)[0][1]
    clock.now = ACTION_ECHO_TIMEOUT_S + 0.1
    state.tick()
    assert len(notices(state)) == 1


def test_float_echo_tolerates_float32_rounding_but_not_a_loose_relative_gap() -> None:
    from oscdesk_ui.state import _same_values

    assert _same_values((0.1,), (0.10000000149011612,))
    assert _same_values((1e6 + 0.3,), (1000000.25,))
    assert not _same_values((1e6,), (1e6 + 1,))
    assert not _same_values((0.5,), (0.501,))
    assert not _same_values((16777217,), (16777216,))
    # 文字列と数値の混在は例外にせず不一致
    assert not _same_values(("auto",), (1.0,)) and not _same_values(("1",), (1,))
    assert not _same_values((1.0,), ("1",)) and _same_values(("a",), ("a",))
    assert _same_values((-0.5,), (-0.5,)) and not _same_values((-0.5,), (0.5,))


def test_a_second_press_takes_over_the_wait_for_the_same_addresses() -> None:
    state, _link, clock = build_state()
    state.press_action(action(state, "reset"))
    clock.now = 1.0
    state.press_action(action(state, "reset"))
    clock.now = ACTION_ECHO_TIMEOUT_S + 0.5  # 1 回目の期限は過ぎたが、待ちは 2 回目へ移っている
    state.tick()

    assert notices(state) == []


# --- 値の保持 -------------------------------------------------------------


def test_full_desired_does_not_wipe_ui_only_values_of_standalone_false_parameters() -> None:
    from .surface_fixtures import desired_frame

    state, _link, _clock = build_state()
    state.set_local(state.entry_for("slot1"), (0.4,))  # type: ignore[arg-type]

    state._on_frame(desired_frame({}, full=True))

    assert state.values.values_of("slot1") == (0.4,)


# --- レビュー指摘の回帰 -----------------------------------------------------


def test_releasing_a_standalone_false_slider_keeps_the_value() -> None:
    state, link, _clock = build_state()
    slot = state.entry_for("slot1")
    assert slot is not None

    state.begin_hold(slot.param_id, "slider")
    state.set_local(slot, (0.8,))
    state.end_hold(slot)  # 送らないのでエコーは来ない。それでも編集前の値へ戻らない

    assert state.values.values_of("slot1") == (0.8,)
    assert link.sent == []


def test_a_surface_change_drops_pending_waits() -> None:
    state, _link, clock = build_state()
    state.press_action(action(state, "reset"))

    state._on_frame(surface_frame(definition(PARAMS[:1], name="Other"), name="other", revision=2))
    clock.now = ACTION_ECHO_TIMEOUT_S + 1
    state.tick()

    assert notices(state) == []


def test_a_trigger_is_confirmed_by_an_echo_without_arguments() -> None:
    state, _link, _clock = build_state()
    state.press_action(action(state, "applyAll"))
    for address, tag, value in (("slot1", "f", 0.0), ("slot2", "f", 0.0), ("mode", "s", "a"), ("flag", "i", 1)):
        state._on_frame(echo_frame(address, (tag, value)))
    state._on_frame(echo_frame("apply"))

    assert [level for level, _ in notices(state)][-1] == "info"


def test_float_echo_tolerates_float32_rounding_on_large_values() -> None:
    from oscdesk_ui.state import _same_values

    assert _same_values((20000.123,), (20000.123046875,))
    assert not _same_values((0.5,), (0.6,))


# --- 画面 -----------------------------------------------------------------


def action_button(user: Any, text: str) -> UserInteraction[Any]:
    elements = {element for element in user.find(kind=ui.button).elements if element.text == text}
    assert len(elements) == 1
    return UserInteraction(user, elements, text)


async def test_action_button_sends_the_batch_on_click() -> None:
    state, link, _clock = build_state()
    page = SurfacePage(state)

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")

        # 定義のラベルをそのまま出す(件数を付け足さない。D-069)
        action_button(user, "Apply all").click()

        assert len(link.batches) == 1 and link.sent == []
        assert [item.param for item in link.batches[0]][-1] == "apply"
        # 押したページの holder を付ける(HID-392。このページのロックでまとめ送りが断られないように)
        assert link.batch_holders == [page._holder]
