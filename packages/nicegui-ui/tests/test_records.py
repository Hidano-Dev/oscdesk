"""レコード型パラメータの UI(HID-216 / D-064): モデル・行の順・値の調停・送信・アクション・画面。"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest
from nicegui import ui
from nicegui.testing import user_simulation
from nicegui.testing.user_interaction import UserInteraction

from oscdesk_ui import surface_editor as ed
from oscdesk_ui.config import AppConfig, UnityTarget
from oscdesk_ui.page import SurfacePage
from oscdesk_ui.protocol import OscMessage, RuntimeOptionList, RuntimeOptionsFrame, WireArg, decode_frame, osc_bundle_size
from oscdesk_ui.state import ACTION_ECHO_TIMEOUT_S, SurfaceState
from oscdesk_ui.surface_definition import validate_surface_definition
from oscdesk_ui.surface_editor import EditSession
from oscdesk_ui.surface_link import LinkStatus
from oscdesk_ui.surface_model import ActionNode, RecordNode, parse_surface, resolve_record_action_steps

from .surface_fixtures import echo_frame, surface_frame
from .test_state import Clock

SAMPLES_PATH = Path(__file__).parents[3] / "protocol" / "surface-definition-samples.json"


def sample(name: str) -> dict[str, Any]:
    cases = json.loads(SAMPLES_PATH.read_text(encoding="utf-8"))["cases"]
    return copy.deepcopy(next(case["definition"] for case in cases if case["name"] == name))


BASIC = sample("records-basic")
LIST = "/vp/members/list"
SEGMENTS = "/vp/segments/list"


class FakeLink:
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self.sent: list[tuple[str, list[Any]]] = []
        self.batches: list[list[OscMessage]] = []
        self.connected = True
        self.refreshes = 0

    def send_osc(self, address: str, args: list[Any]) -> None:
        self.sent.append((address, args))

    def send_set(self, param: str, value: Any = None, *, has_value: bool = True, revision: int | None = None) -> None:
        # パラメータは ID と JSON の値で送る(HID-373)。単独送信の有無を同じ sent で確かめる
        self.sent.append((param, value))

    def send_osc_batch(self, messages: list[OscMessage]) -> bool:
        if not self.connected:
            return False
        self.batches.append(list(messages))
        return True

    def request_surface(self) -> None:
        pass

    def update_heartbeat(self, interval_s: float) -> None:
        pass

    def request_runtime_options_refresh(self, request: str | None = None) -> bool:
        self.refreshes += 1
        self.refresh_requests.append(request)
        return True

    @property
    def refresh_requests(self) -> list[str | None]:
        if not hasattr(self, "_refresh_requests"):
            self._refresh_requests: list[str | None] = []
        return self._refresh_requests

    def add_record_key(self, record_id: str, key: str) -> bool:
        if not self.connected:
            return False
        self.key_requests.append(("add", record_id, key))
        return True

    def remove_record_key(self, record_id: str, key: str) -> bool:
        if not self.connected:
            return False
        self.key_requests.append(("remove", record_id, key))
        return True

    def rename_record_key(self, record_id: str, key: str, name: str) -> bool:
        if not self.connected:
            return False
        self.key_requests.append(("rename", record_id, key, name))
        return True

    @property
    def key_requests(self) -> list[tuple[str, ...]]:
        if not hasattr(self, "_key_requests"):
            self._key_requests: list[tuple[str, ...]] = []
        return self._key_requests


def build_state(definition: dict[str, Any] = BASIC) -> tuple[SurfaceState, FakeLink, Clock]:
    clock = Clock()
    state = SurfaceState(AppConfig(unity=UnityTarget("127.0.0.1", 7090, 7091)), clock=clock, link_factory=FakeLink)
    state._on_frame(surface_frame(definition))
    return state, state.link, clock  # type: ignore[return-value]


def runtime(keys: list[str] | None, *, arrived: bool = True, segments: list[str] | None = None) -> RuntimeOptionsFrame:
    """ブリッジ(HID-215)が送る runtimeOptions。arrived は一覧がどこかの宛先から届いているか。"""
    names = tuple(keys or ())
    lists = (RuntimeOptionList(LIST, (("main", names),)),) if arrived else ()
    if segments is not None:
        lists += (RuntimeOptionList(SEGMENTS, (("main", tuple(segments)),)),)
    return RuntimeOptionsFrame(
        type="runtimeOptions",
        lists=lists,
        keys=(("member", names), ("memberUpdate", names)),
        field_choices=(("member", "segment", tuple(segments or ["(none)"])),),
    )


def member(key: str, active: int = 0, slot: int = 1, ip: str = "", segment: str = "(none)") -> list[tuple[str, Any]]:
    return [("s", key), ("i", active), ("i", slot), ("s", ip), ("s", segment)]


def desired(rows: list[list[tuple[str, Any]]], *, full: bool = True) -> Any:
    from oscdesk_ui.protocol import DesiredFrame, DesiredValue

    return DesiredFrame(
        type="desired",
        full=full,
        values=tuple(DesiredValue("/vp/member", tuple(WireArg(t, v) for t, v in row)) for row in rows),
    )


def record(state: SurfaceState, record_id: str = "member") -> Any:
    assert state.surface is not None
    found = state.surface.record(record_id)
    assert found is not None
    return found


def action(state: SurfaceState, action_id: str) -> Any:
    assert state.surface is not None
    return next(item for item in state.surface.actions if item.action_id == action_id)


def args_of(message: OscMessage) -> list[tuple[str, Any]]:
    return [(arg.type, arg.value) for arg in message.args]


def notices(state: SurfaceState) -> list[tuple[str, str]]:
    return [(notice.level, notice.message) for notice in state.notices_since(0)]


# --- モデル ---------------------------------------------------------------


def test_parse_surface_builds_records_record_nodes_and_scoped_actions() -> None:
    surface = parse_surface(BASIC)

    member_record, update_record = surface.records
    assert (member_record.record_id, member_record.kind, member_record.key_label) == ("member", "state", "メンバー名")
    assert [f.param_id for f in member_record.fields] == ["active", "slot", "ip", "segment"]
    assert member_record.fields[3].options_from_address == "/vp/segments/list"
    assert member_record.initial_values() == (False, 1, "", "(none)")
    assert update_record.kind == "trigger" and update_record.fields == ()

    node = next(n for n in surface.screens[0].layout if isinstance(n, RecordNode))
    assert node.label == "メンバー" and node.width == 12
    assert [(c.field_index, c.spec.widget, c.spec.label) for c in node.columns] == [
        (0, "switch", "Active"),
        (1, "slider", "Slot"),
        (3, "select", "Seg"),
    ]
    assert [a.action_id for a in node.row_actions] == ["update"]

    update_all = next(n.action for n in surface.screens[0].layout if isinstance(n, ActionNode))
    assert update_all.scope == "all" and update_all.targets == ()
    assert [s.record.record_id for s in update_all.record_steps] == ["member", "memberUpdate"]
    all_active = action_of(surface, "allActive")
    assert all_active.record_steps[0].fixed == ((0, True),)


def action_of(surface: Any, action_id: str) -> Any:
    return next(item for item in surface.actions if item.action_id == action_id)


def test_parse_surface_attaches_column_actions_to_their_column() -> None:
    surface = parse_surface(sample("records-column-actions"))
    node = next(n for n in surface.screens[0].layout if isinstance(n, RecordNode))
    assert [[a.action_id for a in c.actions] for c in node.columns] == [["allActive", "allInactive"], [], []]
    assert all(a.scope == "all" for a in node.columns[0].actions)
    # 列に置いたアクションは表の外には出ない(Update All だけが action ノード)
    assert [n.action.action_id for n in surface.screens[0].layout if isinstance(n, ActionNode)] == ["updateAll"]


def test_omitted_columns_show_every_field_and_the_key_label_falls_back() -> None:
    surface = parse_surface(sample("records-minimal"))
    node = next(n for screen in surface.screens for n in screen.layout if isinstance(n, RecordNode))
    assert [c.field_index for c in node.columns] == list(range(len(node.record.fields)))
    assert node.record.key_label == "キー"


def test_key_of_accepts_only_a_well_formed_row() -> None:
    member_record = parse_surface(BASIC).records[0]

    def key(*args: tuple[str, Any]) -> str | None:
        return member_record.key_of(tuple(WireArg(t, v) for t, v in args))

    assert key(*member("A", 1, 3, "10.0.0.1", "Intro")) == "A"  # optionsFrom は所属を問わない
    assert key(("s", "A"), ("f", 1.0), ("f", 3.0), ("s", ""), ("s", "(none)")) == "A"  # 数値は i / f どちらも
    assert key(*member("A")[1:]) is None  # キーが無い
    assert key(*member("A"), ("i", 1)) is None  # フィールドの数違い
    assert key(*member("A", slot=65)) is None  # 値域外
    assert key(*member("A", active=2)) is None  # bool は 0 / 1 だけ
    assert key(("i", 1), *member("A")[1:]) is None


def test_record_steps_expand_row_by_row_in_step_order_and_stop_past_the_limit() -> None:
    surface = parse_surface(BASIC)
    update_all = action_of(surface, "updateAll")

    expanded = resolve_record_action_steps(update_all, ["A", "B"])
    assert [(t.record.record_id, t.key) for t in expanded] == [
        ("member", "A"), ("memberUpdate", "A"), ("member", "B"), ("memberUpdate", "B"),
    ]
    assert len(resolve_record_action_steps(update_all, [f"k{i}" for i in range(1000)])) == 513


def test_bundle_size_counts_like_the_osc_encoder() -> None:
    assert osc_bundle_size([OscMessage("/a")]) == 16 + 4 + 4 + 4
    # "/vp/member\0" は 12、",si\0" は 4、"A\0" は 4、i は 4
    assert osc_bundle_size([OscMessage("/vp/member", (WireArg("s", "A"), WireArg("i", 1)))]) == 16 + 4 + 12 + 4 + 4 + 4


# --- 行の順と印 -----------------------------------------------------------


def test_rows_follow_the_key_list_then_desired_only_keys_and_mark_them_only_after_a_list_arrives() -> None:
    state, _link, _clock = build_state()
    member_record = record(state)

    state._on_frame(desired([member("Z"), member("B")]))
    assert [(r.key, r.marked) for r in state.record_rows(member_record)] == [("Z", False), ("B", False)]

    # keys は未着でも [] で届く(ブリッジの規則)。lists に来ていなければ印は付けない
    state._on_frame(runtime([], arrived=False))
    assert [r.marked for r in state.record_rows(member_record)] == [False, False]

    revision = state.record_rows_revision
    state._on_frame(runtime(["A", "B"]))
    assert state.record_rows_revision > revision
    assert [(r.key, r.listed, r.marked) for r in state.record_rows(member_record)] == [
        ("A", True, False), ("B", True, False), ("Z", False, True),
    ]
    # 一覧に現れた行は保持値が届くまで default を表示する(OSC は送らない)
    assert state.record_values_of(member_record, "A") == (False, 1, "", "(none)")


def test_full_desired_drops_keys_that_are_no_longer_held() -> None:
    state, _link, _clock = build_state()
    member_record = record(state)
    state._on_frame(desired([member("A", 1), member("B")]))
    state._on_frame(desired([member("A", 1)]))

    assert [r.key for r in state.record_rows(member_record)] == ["A"]
    state._on_frame(desired([member("C")], full=False))
    assert [r.key for r in state.record_rows(member_record)] == ["A", "C"]
    assert state.record_values_of(member_record, "A") == (1, 1, "", "(none)")


def test_an_empty_key_never_becomes_a_row() -> None:
    state, _link, _clock = build_state()
    state._on_frame(desired([member(""), member("A")]))
    state._on_frame(echo_frame("/vp/member", *member("")))
    assert [r.key for r in state.record_rows(record(state))] == ["A"]


def test_disconnect_forgets_the_key_list() -> None:
    state, _link, _clock = build_state()
    state._on_frame(runtime(["A"]))
    state._on_link_status(LinkStatus(False, "切断"))
    assert state.record_rows(record(state)) == ()


# --- 編集と送信 -----------------------------------------------------------


def test_editing_one_field_sends_the_whole_row_in_one_message() -> None:
    state, link, _clock = build_state()
    member_record = record(state)
    state._on_frame(desired([member("A", 0, 5, "10.0.0.1", "Intro")]))

    state.set_record_field(member_record, "A", 0, 1, discrete=True)

    address, args = link.sent[-1]
    assert address == "/vp/member"
    assert [(a["type"], a["value"]) for a in args] == member("A", 1, 5, "10.0.0.1", "Intro")


def test_slider_edits_are_throttled_per_row_and_the_last_value_is_flushed() -> None:
    state, link, clock = build_state()
    member_record = record(state)
    state._on_frame(runtime(["A"]))

    state.begin_record_hold(member_record, "A", "slider")
    state.set_record_field(member_record, "A", 1, 2, discrete=False)
    state.set_record_field(member_record, "A", 1, 3, discrete=False)
    assert len(link.sent) == 1
    # 操作中は Unity のエコーで表示を戻さない
    state._on_frame(echo_frame("/vp/member", *member("A", slot=9)))
    assert state.record_values_of(member_record, "A") == (False, 3, "", "(none)")

    clock.now = 1.0
    state.tick()
    assert [a["value"] for a in link.sent[-1][1]][2] == 3
    state.end_record_hold(member_record, "A")
    assert state.record_values_of(member_record, "A") == (0, 9, "", "(none)")


def test_hold_end_without_a_hold_keeps_the_row_and_the_next_edit_keeps_other_fields() -> None:
    # スライダーの pointerleave は押していなくても届く(マウスが上を通り過ぎただけ)。
    # 行の表示値を消すと、続く別の欄の編集が他の欄を default にした行を Unity へ送ってしまう
    state, link, _clock = build_state()
    member_record = record(state)
    state._on_frame(runtime(["A"]))
    state._on_frame(desired([member("A", 1, 7, "10.0.0.1", "Intro")]))

    state.end_record_hold(member_record, "A")
    assert state.record_values_of(member_record, "A") == (1, 7, "10.0.0.1", "Intro")

    state.set_record_field(member_record, "A", 0, 0, discrete=True)
    assert [(a["type"], a["value"]) for a in link.sent[-1][1]] == member("A", 0, 7, "10.0.0.1", "Intro")


def test_a_hold_shows_other_fields_changes_and_does_not_send_them_back_stale() -> None:
    # 入力欄にフォーカスしている間(行のホールド)に、他の操作者や Unity が同じ行の別の欄を変えた。
    # 確定で送る行は、編集した欄だけ手元の値で、ほかは最新の確定値でなければならない
    state, link, _clock = build_state()
    member_record = record(state)
    state._on_frame(runtime(["A"]))
    state._on_frame(desired([member("A", 0, 7, "", "Intro")]))

    state.begin_record_hold(member_record, "A", "input")
    state._on_frame(desired([member("A", 1, 9, "", "Intro")], full=False))
    assert state.record_values_of(member_record, "A") == (1, 9, "", "Intro")

    state.set_record_field(member_record, "A", 2, "10.0.0.9", discrete=True)
    assert [(a["type"], a["value"]) for a in link.sent[-1][1]] == member("A", 1, 9, "10.0.0.9", "Intro")


def test_a_held_slider_field_keeps_the_local_value_while_others_follow_echoes() -> None:
    state, _link, _clock = build_state()
    member_record = record(state)
    state._on_frame(runtime(["A"]))
    state._on_frame(desired([member("A", 0, 1, "", "Intro")]))

    state.begin_record_hold(member_record, "A", "slider")
    state.set_record_field(member_record, "A", 1, 5, discrete=False)
    # 自分の古い送信のエコー(slot=3)と、別の欄の変化(active=1)が一緒に届く
    state._on_frame(echo_frame("/vp/member", *member("A", 1, 3, "", "Intro")))
    assert state.record_values_of(member_record, "A") == (1, 5, "", "Intro")

    # 次のホールドには前のホールドで編集した欄を持ち越さない
    state.end_record_hold(member_record, "A")
    state.begin_record_hold(member_record, "A", "slider")
    state._on_frame(echo_frame("/vp/member", *member("A", 1, 4, "", "Intro")))
    assert state.record_values_of(member_record, "A") == (1, 4, "", "Intro")


def test_echo_is_routed_by_key_and_malformed_rows_are_ignored() -> None:
    state, _link, _clock = build_state()
    member_record = record(state)
    state._on_frame(desired([member("A"), member("B")]))

    state._on_frame(echo_frame("/vp/member", *member("B", 1, 7)))
    state._on_frame(echo_frame("/vp/member", ("s", "A")))  # フィールドが足りない

    assert state.record_values_of(member_record, "A") == (0, 1, "", "(none)")
    assert state.record_values_of(member_record, "B") == (1, 7, "", "(none)")
    # エコーだけで行は作らない
    state._on_frame(echo_frame("/vp/member", *member("Q")))
    assert [r.key for r in state.record_rows(member_record)] == ["A", "B"]


def test_trigger_record_sends_the_key_and_fixed_values() -> None:
    state, link, _clock = build_state()
    state.press_record_trigger(record(state, "memberUpdate"), "A")
    assert link.sent[-1] == ("/vp/member/update", [{"type": "s", "value": "A"}])


def test_field_choices_feed_the_select_candidates() -> None:
    state, _link, _clock = build_state()
    member_record = record(state)
    segment = member_record.fields[3]
    assert state.field_options_for("member", segment) == (("(none)",), False)  # 一覧が届くまでは静的な options
    # ブリッジは一覧が未着でも fieldChoices を静的な options で送る。未着の間は「一覧に無い」と言わない
    state._on_frame(runtime(["A"]))
    assert state.field_options_for("member", segment) == (("(none)",), False)
    state._on_frame(runtime(["A"], segments=["(none)", "Intro"]))
    assert state.field_options_for("member", segment) == (("(none)", "Intro"), True)


# --- アクション -----------------------------------------------------------


def test_row_action_sends_that_row_and_is_confirmed_by_address_and_key() -> None:
    state, link, _clock = build_state()
    state._on_frame(desired([member("A", 1, 4), member("B")]))

    state.press_action(action(state, "update"), "A")

    assert [(m.address, args_of(m)) for m in link.batches[-1]] == [
        ("/vp/member", member("A", 1, 4)),
        ("/vp/member/update", [("s", "A")]),
    ]
    # 別のキーのエコーでは確認しない
    state._on_frame(echo_frame("/vp/member", *member("B", 1, 4)))
    state._on_frame(echo_frame("/vp/member/update", ("s", "B")))
    assert notices(state) == []
    state._on_frame(echo_frame("/vp/member", *member("A", 1, 4)))
    state._on_frame(echo_frame("/vp/member/update", ("s", "A")))
    assert [level for level, _ in notices(state)] == ["info"]


def test_missing_record_echo_names_the_row_after_the_timeout() -> None:
    state, _link, clock = build_state()
    state._on_frame(desired([member("A")]))
    state.press_action(action(state, "update"), "A")
    state._on_frame(echo_frame("/vp/member/update", ("s", "A")))

    clock.now = ACTION_ECHO_TIMEOUT_S + 0.1
    state.tick()

    level, message = notices(state)[-1]
    assert level == "error" and "/vp/member [A]" in message


def test_all_action_covers_every_displayed_row_in_order_with_fixed_values() -> None:
    state, link, _clock = build_state()
    state._on_frame(desired([member("Z", 0, 2)]))
    state._on_frame(runtime(["A", "B"]))

    state.press_action(action(state, "allActive"))

    assert [(m.address, args_of(m)) for m in link.batches[-1]] == [
        ("/vp/member", member("A", 1)),
        ("/vp/member", member("B", 1)),
        ("/vp/member", member("Z", 1, 2)),
    ]

    state.press_action(action(state, "updateAll"))
    assert [(m.address, m.args[0].value) for m in link.batches[-1]] == [
        ("/vp/member", "A"), ("/vp/member/update", "A"),
        ("/vp/member", "B"), ("/vp/member/update", "B"),
        ("/vp/member", "Z"), ("/vp/member/update", "Z"),
    ]


def test_all_action_over_the_message_limit_is_not_sent() -> None:
    state, link, _clock = build_state()
    state._on_frame(runtime([f"m{i}" for i in range(300)]))  # 300 行 × 2 step = 600 件

    state.press_action(action(state, "updateAll"))

    assert link.batches == []
    assert notices(state)[-1][0] == "error" and "512" in notices(state)[-1][1]


def test_all_action_over_the_datagram_size_is_not_sent() -> None:
    state, link, _clock = build_state()
    # 400 行 × 1 件でも、長いキーで 60 KiB を超える
    state._on_frame(runtime([f"{i:03d}" + "x" * 200 for i in range(400)]))

    state.press_action(action(state, "allActive"))

    assert link.batches == []
    level, message = notices(state)[-1]
    assert level == "error" and "バイト" in message


def test_all_action_with_no_rows_warns() -> None:
    state, link, _clock = build_state()
    state.press_action(action(state, "updateAll"))
    assert link.batches == [] and notices(state)[-1][0] == "warn"


# --- 編集モード -----------------------------------------------------------


def test_editor_keeps_records_record_nodes_and_scoped_actions_through_edits() -> None:
    session = EditSession(BASIC, 1, "members")

    assert session.apply(ed.move_node, (0, (), 1), 1) is None  # record ノードを動かす
    assert session.apply(ed.set_label, (0, (), 2), "表") is None
    assert session.apply(ed.remove_parameter, "master") is None
    assert session.apply(ed.add_parameter, {"id": "gain", "address": "/mix/gain", "label": "Gain", "type": "f", "kind": "state"}) is None

    draft = session.draft
    validate_surface_definition(draft)
    assert draft["records"] == BASIC["records"] and draft["actions"] == BASIC["actions"]
    assert [n["kind"] for n in draft["screens"][0]["children"]] == ["action", "record", "action"]
    assert ed.placed_parameter_ids(draft) == set()


def test_editor_keeps_column_actions_through_edits() -> None:
    definition = sample("records-column-actions")
    session = EditSession(definition, 1, "members")

    assert session.apply(ed.move_node, (0, (), 1), 1) is None  # record ノードを動かす
    assert session.apply(ed.remove_parameter, "master") is None

    draft = session.draft
    validate_surface_definition(draft)
    node = next(n for n in draft["screens"][0]["children"] if n["kind"] == "record")
    assert node["columns"][0]["actions"] == ["allActive", "allInactive"]
    assert draft["actions"] == definition["actions"]


# --- 画面 -----------------------------------------------------------------


def find_button(user: Any, text: str) -> UserInteraction[Any]:
    elements = {element for element in user.find(kind=ui.button).elements if element.text == text}
    assert len(elements) >= 1
    return UserInteraction(user, {sorted(elements, key=lambda e: e.id)[0]}, text)


async def test_record_table_headers_have_a_sync_for_each_requested_list() -> None:
    """一覧の要求を持つ列(キーの列と optionsFrom.request の select 列)の見出しに Sync を置き、その要求だけを送らせる(D-077)。"""
    state, link, _clock = build_state()
    page = SurfacePage(state)

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        state._on_frame(runtime(["A", "B"], segments=["(none)", "Intro"]))
        page.sync()
        syncs = sorted((e for e in user.find(kind=ui.button).elements if e.text == "Sync"), key=lambda e: e.id)
        # 見出しにだけ置く(行の欄ごとには置かない)。キーの列 → Seg の列の順
        assert len(syncs) == 2
        UserInteraction(user, {syncs[0]}, "Sync").click()
        UserInteraction(user, {syncs[1]}, "Sync").click()
        assert link.refresh_requests == ["/vp/members/request", "/vp/segments/request"]
        await user.should_see("Unity に一覧を要求しました(/vp/segments/request)")
        # 既存の「一覧を更新」は従来どおり全一覧(request なし)
        find_button(user, "一覧を更新").click()
        assert link.refresh_requests[-1] is None
        assert link.sent == []


async def test_record_table_adds_and_reorders_rows_without_rebuilding_the_screen() -> None:
    state, link, _clock = build_state()
    page = SurfacePage(state)

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        await user.should_see("メンバー名")
        await user.should_see("行がありません(Unity のキーの一覧待ち)")
        (table,) = page._record_tables

        state._on_frame(desired([member("Z")]))
        page.sync()
        z_row = table._rows["Z"].element
        assert table.row_keys() == ["Z"]
        assert not table._rows["Z"].mark.visible  # 一覧が未着の間は印なし

        revision = state.surface_revision
        state._on_frame(runtime(["A", "B"]))
        page.sync()
        assert table.row_keys() == ["A", "B", "Z"]
        assert table._rows["Z"].element is z_row  # 既存の行は作り直さない
        assert list(table._body.default_slot.children) == [table._rows[k].element for k in ("A", "B", "Z")]
        assert table._rows["Z"].mark.visible and not table._rows["A"].mark.visible
        assert state.surface_revision == revision and page._record_tables == [table]
        # scope "all" も定義のラベルをそのまま出す(「(全行)」を付け足さない。D-069)
        assert any(e.text == "Update All" for e in user.find(kind=ui.button).elements)
        assert not any("全行" in e.text for e in user.find(kind=ui.button).elements)
        await user.should_see("一覧を更新")
        assert link.sent == []


async def test_record_table_cells_send_rows_and_reflect_echoes() -> None:
    state, link, _clock = build_state()
    page = SurfacePage(state)

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        state._on_frame(runtime(["A"], segments=["(none)", "Intro"]))
        state._on_frame(desired([member("A", 0, 3, "", "Intro")]))
        page.sync()
        (table,) = page._record_tables
        cells = dict(table._rows["A"].cells)
        assert sorted(cells) == [0, 1, 3] and cells[3].entry.param_id == "segment"

        # 編集モードのスイッチもラベルを持たない(HID-255)ので aria-label で除く
        switches = [
            e for e in user.find(kind=ui.switch).elements if e.text == "" and "aria-label" not in e.props
        ]
        assert len(switches) == 1
        switches[0].value = True
        assert [(a["type"], a["value"]) for a in link.sent[-1][1]] == member("A", 1, 3, "", "Intro")

        selects = [e for e in user.find(kind=ui.select).elements if list(e.options) == ["(none)", "Intro"]]
        assert len(selects) == 1 and selects[0].value == "Intro"

        state._on_frame(echo_frame("/vp/member", *member("A", 0, 3, "", "(none)")))
        page.sync()
        assert switches[0].value is False and selects[0].value == "(none)"

        find_button(user, "Update").click()
        assert [m.address for m in link.batches[-1]] == ["/vp/member", "/vp/member/update"]
        assert link.batches[-1][0].args[0].value == "A"


def test_key_column_is_wide_and_switch_columns_are_fixed_narrow() -> None:
    # キーの列は名前と × を 1 段で収める幅、スイッチの列は部品の幅で固定(D-076)
    from oscdesk_ui.record_table import KEY_COLUMN_MIN_PX, SWITCH_COLUMN_PX, RecordTable

    state, _link, _clock = build_state(sample(TOGGLE))
    assert state.surface is not None
    node = next(n for n in state.surface.screens[0].layout if isinstance(n, RecordNode))
    template = RecordTable(node, state)._row_style.split("grid-template-columns:")[1].split(";")[0].split(" ")
    # キー・Active(switch)・Slot(slider)・Seg(select)・行のアクション
    assert template == [
        f"minmax({KEY_COLUMN_MIN_PX}px,2fr)", f"{SWITCH_COLUMN_PX}px", "minmax(80px,2fr)", "minmax(80px,2fr)", "auto",
    ]


async def test_column_actions_sit_in_a_bulk_row_above_the_rows() -> None:
    state, link, _clock = build_state(sample("records-column-actions"))
    page = SurfacePage(state)

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        state._on_frame(runtime(["A", "B"]))
        page.sync()
        (table,) = page._record_tables
        # 一括操作の行は表の枠内で見出しの直後・行の並び(本体)の直前に置き、行の並べ替えの対象にしない(D-076)
        siblings = list(table._body.parent_slot.children)
        assert siblings.index(table._bulk_row) == siblings.index(table._body) - 1
        assert siblings.index(table._bulk_row) == 1
        cells = list(table._bulk_row.default_slot.children)
        # キーの欄・Active・Slot・Seg・行のアクションの欄。Active の直下だけにボタンが入る
        assert [[e.text for e in cell.descendants() if isinstance(e, ui.button)] for cell in cells] == [
            [], ["All Active", "All Inactive"], [], [], []
        ]

        find_button(user, "All Inactive").click()
        assert [(m.address, args_of(m)) for m in link.batches[-1]] == [
            ("/vp/member", member("A", 0)),
            ("/vp/member", member("B", 0)),
        ]


TOGGLE = "records-column-toggle-and-table-actions"


def test_parse_surface_attaches_the_column_toggle_and_table_actions() -> None:
    surface = parse_surface(sample(TOGGLE))
    (node,) = [n for n in surface.screens[0].layout if isinstance(n, RecordNode)]
    toggle = node.columns[0].toggle
    assert toggle is not None
    assert (toggle.label, toggle.on.action_id, toggle.off.action_id) == ("All Active", "allActive", "allInactive")
    assert [a.action_id for a in node.table_actions] == ["updateAll"]


def test_editor_keeps_the_column_toggle_and_table_actions_through_edits() -> None:
    definition = sample(TOGGLE)
    session = EditSession(definition, 1, "members")

    assert session.apply(ed.remove_parameter, "master") is None

    draft = session.draft
    validate_surface_definition(draft)
    node = next(n for n in draft["screens"][0]["children"] if n["kind"] == "record")
    assert node["columns"][0]["toggle"] == {"label": "All Active", "on": "allActive", "off": "allInactive"}
    assert node["tableActions"] == ["updateAll"]


async def test_column_toggle_shows_every_row_and_sends_on_or_off() -> None:
    # 一括トグル(D-073): 全行オン → オン、全行オフ → オフ、混在 → 不定。操作で on / off のアクションを送る
    state, link, _clock = build_state(sample(TOGGLE))
    page = SurfacePage(state)

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        state._on_frame(runtime(["A", "B"]))
        state._on_frame(desired([member("A", 0), member("B", 0)]))
        page.sync()
        (table,) = page._record_tables
        (view,) = table._toggles
        labels = [e.text for e in table._bulk_row.descendants() if isinstance(e, ui.label)]
        assert "All Active" in labels
        assert view.switch.value is False
        assert not [e for e in table._bulk_row.descendants() if isinstance(e, ui.button)]

        view.switch.value = True
        assert [(m.address, args_of(m)) for m in link.batches[-1]] == [
            ("/vp/member", member("A", 1)),
            ("/vp/member", member("B", 1)),
        ]

        state._on_frame(desired([member("A", 1), member("B", 0)]))
        page.sync()
        # 混在は不定(つまみが中央)でなくオフで見せ、注記を添える(D-094)。行の値から表示を引き直しただけでは送らない
        sent = len(link.batches)
        assert view.switch.value is False and view.partial.visible and len(link.batches) == sent
        # 混在から切り替えると、全行がその状態(オン)になる
        view.switch.value = True
        assert [args_of(m)[1] for m in link.batches[-1]] == [("i", 1), ("i", 1)]
        sent = len(link.batches)
        state._on_frame(desired([member("A", 1), member("B", 1)]))
        page.sync()
        assert view.switch.value is True and not view.partial.visible and len(link.batches) == sent

        view.switch.value = False
        assert [args_of(m)[1] for m in link.batches[-1]] == [("i", 0), ("i", 0)]


async def test_table_actions_sit_beside_the_table_as_tall_buttons() -> None:
    # 表全体のアクション(D-074): 表の右に縦長のボタンで置き、押すと表示中の全行を 1 つの oscBatch で送る
    state, link, _clock = build_state(sample(TOGGLE))
    page = SurfacePage(state)

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        state._on_frame(runtime(["A", "B"]))
        state._on_frame(desired([member("A", 1), member("B", 0)]))
        page.sync()
        (table,) = page._record_tables
        (button,) = table._table_action_buttons
        assert button.text == "Update All" and button.props.get("stack") is True
        # 表(横スクロールする箱)と同じ行に並び、その行は縦に伸ばして揃える
        container = button.parent_slot.parent.parent_slot.parent
        assert "items-stretch" in container.classes
        assert table._body in list(container.descendants())

        find_button(user, "Update All").click()
        # 行ごとに step の順(値 → Update)で展開する(D-061)
        assert [m.address for m in link.batches[-1]] == ["/vp/member", "/vp/member/update", "/vp/member", "/vp/member/update"]


UI_KEYS = "records-ui-keys"


def mb_id(name: str) -> str:
    """テストで UI で管理する行に振る ID(D-087)。実際のブリッジは UUID を振る。"""
    return f"id-{name}"


def ui_key_runtime(member_keys: list[str], mb_names: list[str], ids: list[str] | None = None) -> RuntimeOptionsFrame:
    """UI で管理する行(mb)は keys が ID、names が Name(D-087)。ids を省くと Name から mb_id で作る。"""
    frame = runtime(member_keys)
    mb_ids = tuple(ids if ids is not None else [mb_id(name) for name in mb_names])
    pairs = tuple(zip(mb_ids, mb_names))
    extra = (("mb", mb_ids), ("mbUpdate", mb_ids))
    return RuntimeOptionsFrame(
        type=frame.type,
        lists=frame.lists,
        choices=frame.choices,
        keys=frame.keys + extra,
        field_choices=frame.field_choices,
        key_names=(("mb", pairs), ("mbUpdate", pairs)),
    )


def mb_row(row_id: str, name: str, active: int = 1, host: str = "127.0.0.1", port: int = 22000) -> Any:
    from oscdesk_ui.protocol import DesiredValue

    return DesiredValue("/mb/values", tuple(WireArg(t, v) for t, v in [("s", row_id), ("s", name), ("i", active), ("s", host), ("i", port)]))


def test_parse_surface_reads_the_key_source_and_where_rows_can_be_edited() -> None:
    surface = parse_surface(sample(UI_KEYS))
    mb = next(r for r in surface.records if r.record_id == "mb")
    assert (mb.keys_source, mb.keys_max) == ("ui", 4)
    member, mb_node = [n for n in surface.screens[0].layout if isinstance(n, RecordNode)]
    # Unity の一覧の表は editRows で、UI で管理するキーの表は省略時に、行の追加・削除を出す
    assert member.edit_rows is True and mb_node.edit_rows is True
    basic = next(n for n in parse_surface(BASIC).screens[0].layout if isinstance(n, RecordNode))
    assert basic.edit_rows is False


def test_add_record_key_checks_the_name_duplicates_and_the_limit_before_sending() -> None:
    state, link, _clock = build_state(sample(UI_KEYS))
    mb = record(state, "mb")
    state._on_frame(ui_key_runtime(["A"], ["MB 1", "MB 2", "MB 3"]))

    assert state.add_record_key(mb, "  ") == "名前を入力してください"
    assert state.add_record_key(mb, "MB 1") == "「MB 1」は既にあります"
    assert state.add_record_key(mb, " MB 4 ") is None
    assert link.key_requests == [("add", "mb", "MB 4")]

    state._on_frame(ui_key_runtime(["A"], ["MB 1", "MB 2", "MB 3", "MB 4"]))
    assert state.record_key_limit_reached(mb)
    assert state.add_record_key(mb, "MB 5") == "上限の 4 件に達しています"

    # 削除は行の ID で指す(D-087)
    assert state.remove_record_key(mb, mb_id("MB 2")) is None
    link.connected = False
    assert state.remove_record_key(mb, mb_id("MB 3")) == "ブリッジに未接続のため削除できません"
    assert link.key_requests[-1] == ("remove", "mb", mb_id("MB 2"))


def test_ui_managed_rows_are_keyed_by_id_and_shown_and_sent_with_their_name() -> None:
    from oscdesk_ui.protocol import DesiredFrame

    state, link, _clock = build_state(sample(UI_KEYS))
    mb = record(state, "mb")
    state._on_frame(ui_key_runtime(["A"], ["MB 1"], ids=["r1"]))
    state._on_frame(DesiredFrame(type="desired", full=False, values=(mb_row("r1", "MB 1", port=1234),)))

    (row,) = state.record_rows(mb)
    assert (row.key, row.label) == ("r1", "MB 1")
    assert state.record_values_of(mb, "r1") == (1, "127.0.0.1", 1234)

    # 改名しても行(ID)と値はそのまま。表示と送る Name だけが替わる
    state._on_frame(ui_key_runtime(["A"], ["MB A"], ids=["r1"]))
    (row,) = state.record_rows(mb)
    assert (row.key, row.label) == ("r1", "MB A")
    assert state.record_values_of(mb, "r1") == (1, "127.0.0.1", 1234)
    state.set_record_field(mb, "r1", 2, 4321, discrete=True)
    assert link.sent[-1] == (
        "/mb/values",
        [{"type": "s", "value": "r1"}, {"type": "s", "value": "MB A"}, {"type": "i", "value": 1},
         {"type": "s", "value": "127.0.0.1"}, {"type": "i", "value": 4321}],
    )
    # エコーは ID で行へ振り分ける
    state._on_frame(echo_frame("/mb/values", ("s", "r1"), ("s", "MB A"), ("i", 0), ("s", "10.0.0.1"), ("i", 5)))
    assert state.record_values_of(mb, "r1") == (0, "10.0.0.1", 5)

    # 一覧から消えた ID の行は、Name が分からないので送らない
    sent = len(link.sent)
    state._on_frame(ui_key_runtime(["A"], []))
    state.set_record_field(mb, "r1", 2, 1, discrete=True)
    assert len(link.sent) == sent


def test_rename_record_key_checks_the_name_before_sending() -> None:
    state, link, _clock = build_state(sample(UI_KEYS))
    mb = record(state, "mb")
    member = record(state, "member")
    state._on_frame(ui_key_runtime(["A"], ["MB 1", "MB 2"]))

    assert state.rename_record_key(mb, mb_id("MB 1"), "  ") == "名前を入力してください"
    assert state.rename_record_key(mb, mb_id("MB 1"), "MB 2") == "「MB 2」は既にあります"
    assert state.rename_record_key(mb, mb_id("MB 1"), " MB 1 ") is None  # 変わらない名前は送らない
    assert state.rename_record_key(member, "A", "B") == "この表の行の名前は変更できません"
    assert link.key_requests == []
    assert state.rename_record_key(mb, mb_id("MB 1"), " MB A ") is None
    assert link.key_requests == [("rename", "mb", mb_id("MB 1"), "MB A")]
    link.connected = False
    assert state.rename_record_key(mb, mb_id("MB 1"), "MB B") == "ブリッジに未接続のため名前を変更できません"


async def test_record_table_adds_rows_below_and_removes_them_from_the_left() -> None:
    state, link, _clock = build_state(sample(UI_KEYS))
    page = SurfacePage(state)

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        state._on_frame(ui_key_runtime(["A"], ["MB 1"]))
        page.sync()
        member_table, mb_table = page._record_tables
        assert mb_table._add_button is not None and mb_table._add_button.enabled

        mb_table._add_input.value = "MB 2"
        mb_table._add()
        assert link.key_requests == [("add", "mb", "MB 2")]
        assert mb_table._add_input.value == ""

        # 各行のキーの左に × があり、メニューの項目で消す
        row = mb_table._rows[mb_id("MB 1")].element
        (menu,) = [e for e in row.descendants() if isinstance(e, ui.menu)]
        (item,) = [e for e in menu.descendants() if isinstance(e, ui.menu_item)]
        assert item.props.get("clickable") is not False
        assert mb_table._rows[mb_id("MB 1")].remove_item.text == "「MB 1」を削除"
        # UI で管理するキーの表には「行が残る」注記を出さない(消せば行ごと消える)
        assert not [e for e in menu.descendants() if isinstance(e, ui.label) and "Unity の一覧" in e.text]
        mb_table._remove(mb_id("MB 1"))
        assert link.key_requests[-1] == ("remove", "mb", mb_id("MB 1"))

        # 上限に達したら追加を閉じる
        state._on_frame(ui_key_runtime(["A"], ["MB 1", "MB 2", "MB 3", "MB 4"]))
        page.sync()
        assert not mb_table._add_button.enabled and not mb_table._add_input.enabled
        # Unity の一覧の表(editRows)にも × と追加が出る
        assert member_table._add_button is not None
        (member_menu,) = [e for e in member_table._rows["A"].element.descendants() if isinstance(e, ui.menu)]
        assert [e for e in member_menu.descendants() if isinstance(e, ui.label) and "Unity の一覧" in e.text]


async def test_record_table_edits_the_name_of_ui_managed_rows_in_place() -> None:
    state, link, _clock = build_state(sample(UI_KEYS))
    page = SurfacePage(state)

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        state._on_frame(ui_key_runtime(["A"], ["MB 1", "MB 2"]))
        page.sync()
        member_table, mb_table = page._record_tables
        shown = mb_table._rows[mb_id("MB 1")]
        # UI で管理する行のキーの列は Name の入力欄。Unity の一覧の行は名前の表示だけ
        assert isinstance(shown.name_view, ui.input) and shown.name_view.value == "MB 1"
        assert not isinstance(member_table._rows["A"].name_view, ui.input)

        # 確定で改名を送り、欄はブリッジの応答までいまの Name に戻す
        shown.name_view.value = "MB A"
        mb_table._rename(shown)
        assert link.key_requests[-1] == ("rename", "mb", mb_id("MB 1"), "MB A")
        assert shown.name_view.value == "MB 1"
        # 重なる名前は送らずに戻す(通知はページの中で出すので、行の要素の中で確定する)
        shown.name_view.value = "MB 2"
        with shown.element:
            mb_table._rename(shown)
        assert link.key_requests[-1] == ("rename", "mb", mb_id("MB 1"), "MB A")
        assert shown.name_view.value == "MB 1"

        # ブリッジの一覧で Name が替わったら、行を作り直さずに表示と削除のメニューを替える
        element = shown.element
        state._on_frame(ui_key_runtime(["A"], ["MB A", "MB 2"], ids=[mb_id("MB 1"), mb_id("MB 2")]))
        page.sync()
        assert mb_table._rows[mb_id("MB 1")].element is element
        assert shown.name_view.value == "MB A"
        assert shown.remove_item.text == "「MB A」を削除"


async def test_record_row_cells_are_compact_and_unboxed() -> None:
    # 欄のカードは枠・影・余白の無い透明な箱にし、入力欄・選択・スイッチは dense で低い 1 段にそろえる(D-072)
    definition = copy.deepcopy(BASIC)
    node = next(n for n in definition["screens"][0]["children"] if n["kind"] == "record")
    node["columns"].insert(1, {"field": "ip"})
    validate_surface_definition(definition)
    state, _link, _clock = build_state(definition)
    page = SurfacePage(state)

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        state._on_frame(runtime(["A"]))
        page.sync()
        (table,) = page._record_tables
        row = table._rows["A"].element
        assert row._style["align-items"] == "center"
        assert "border-bottom" in row._style
        descendants = list(row.descendants())
        fields = [e for e in descendants if isinstance(e, (ui.input, ui.select))]
        assert {type(e) for e in fields} == {ui.input, ui.select}
        assert all(e.props.get("dense") is True and e.props.get("hide-bottom-space") is True for e in fields)
        switches = [e for e in descendants if isinstance(e, ui.switch)]
        assert switches and all(e.props.get("dense") is True for e in switches)
        cards = [e for e in descendants if isinstance(e, ui.card)]
        assert len(cards) == 4
        assert all(card.props.get("flat") is True and card._style.get("box-shadow") == "none" for card in cards)
        actions = row.default_slot.children[-1]
        assert isinstance(actions, ui.row) and "items-center" in actions.classes


async def test_trigger_record_node_has_a_send_button_per_row() -> None:
    definition = copy.deepcopy(BASIC)
    definition["screens"][0]["children"].append({"kind": "record", "record": "memberUpdate"})
    validate_surface_definition(definition)
    state, link, _clock = build_state(definition)
    page = SurfacePage(state)

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        state._on_frame(runtime(["A"]))
        page.sync()
        trigger_table = page._record_tables[1]
        assert trigger_table.row_keys() == ["A"]
        find_button(user, "送信").click()
        assert link.sent[-1] == ("/vp/member/update", [{"type": "s", "value": "A"}])


async def test_edit_mode_shows_records_and_saves_them_unchanged() -> None:
    from .test_editor_page import RecordingLink, button, switch

    state = SurfaceState(AppConfig(unity=UnityTarget("127.0.0.1", 7090, 7091)), link_factory=RecordingLink)
    state._on_frame(surface_frame(BASIC, name="members"))
    page = SurfacePage(state)

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        switch(user, "編集モード").click()
        await user.should_see("レコード表: メンバー (member)")
        await user.should_see("レコード(編集は JSON で行います)")
        assert page._editor is not None
        page._editor._name_input.value = "members"
        button(user, "保存").click()

        (_name, saved, _activate), = state.link.saved  # type: ignore[attr-defined]
        assert saved == BASIC


def test_wire_sample_runtime_options_with_records_feeds_the_rows() -> None:
    state, _link, _clock = build_state()
    frame = decode_frame(
        json.dumps(
            {
                "v": 1,
                "type": "runtimeOptions",
                "lists": [{"address": LIST, "targets": [{"name": "main", "options": ["A", "B"]}]}],
                "choices": [],
                "keys": [{"record": "member", "keys": ["A", "B", "A", ""]}, {"record": "memberUpdate", "keys": ["A", "B"]}],
                "fieldChoices": [{"record": "member", "field": "segment", "options": ["(none)"]}],
            }
        )
    )
    state._on_frame(frame)
    # 重複と空文字は除く(ブリッジも除くが、UI でも行を二重にしない)
    assert [r.key for r in state.record_rows(record(state))] == ["A", "B"]


@pytest.mark.parametrize("scope_key", [None])
def test_row_action_without_a_key_only_warns(scope_key: Any) -> None:
    state, link, _clock = build_state()
    state.press_action(action(state, "update"), scope_key)
    assert link.batches == [] and notices(state)[-1][0] == "warn"
