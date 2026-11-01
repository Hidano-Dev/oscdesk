"""OSC パッド(D-080 / D-081)の作業コピー・表示キャッシュ・タブの操作。

編集の規則と検証はブリッジ(packages/bridge/src/pad-editor.ts。D-126)が持ち、その検査は pad-editor.test.ts が行う。
ここでは、操作が編集命令になって送られ、ブリッジの答え(テストが PadEditedFrame で返す)を作業コピーとして描くことを確かめる。
"""

from __future__ import annotations

import base64
import copy
import json
from typing import Any

import pytest
from nicegui import ui
from nicegui.testing import user_simulation
from nicegui.testing.user_interaction import UserInteraction

from oscdesk_ui import osc_pad as pads
from oscdesk_ui.config import AppConfig, UnityTarget
from oscdesk_ui.inspector_area import HIDDEN_VIEW_CLASS, InspectorArea
from oscdesk_ui.layout import extra_tab_name
from oscdesk_ui.osc_pad import ADOPTION_HISTORY, ADOPTION_HISTORY_HARD_LIMIT, PadCache, PadEditSession
from oscdesk_ui.osc_pad_panel import SELECTED_CLASS, cell_style, text_color_for
from oscdesk_ui.page import SurfacePage
from oscdesk_ui.protocol import (
    FrameDecodeError,
    OscMessage,
    PadEditedFrame,
    PadFrame,
    PadListFrame,
    SentLogFrame,
    WireArg,
    decode_frame,
    encode_osc_batch_frame,
    encode_osc_frame,
    encode_pad_edit,
    encode_pad_save,
    utf16_length,
)
from oscdesk_ui.state import SurfaceState

PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def _button(button_id: str, row: int, column: int, **fields: Any) -> dict[str, Any]:
    return {"id": button_id, "row": row, "column": column, "label": button_id, "address": f"/pad/{button_id}", "args": [], **fields}


def _with(pad: dict[str, Any], *buttons: dict[str, Any], **fields: Any) -> dict[str, Any]:
    """pad にボタンを足した・置き換えたもの(ブリッジの答えの代わり。規則の正否は pad-editor.test.ts が見る)。"""
    result = copy.deepcopy(pad)
    for button in buttons:
        result["buttons"] = [current for current in result["buttons"] if current["id"] != button["id"]] + [copy.deepcopy(button)]
    result.update(fields)
    return result


# --- 作業コピー(命令と答え) ---------------------------------------------------


class FakeBridge:
    """PadEditSession の send / take / cancel。答えはテストが answer で置く。"""

    def __init__(self) -> None:
        self.sent: list[tuple[str, dict[str, Any], dict[str, Any]]] = []
        self.answers: dict[str, dict[str, Any] | str] = {}
        self.cancelled: list[str] = []
        self.connected = True

    def send(self, draft: dict[str, Any], edit: dict[str, Any]) -> str | None:
        if not self.connected:
            return None
        request_id = f"r{len(self.sent) + 1}"
        self.sent.append((request_id, copy.deepcopy(draft), edit))
        return request_id

    def take(self, request_id: str) -> dict[str, Any] | str | None:
        return self.answers.pop(request_id, None)

    def cancel(self, request_id: str) -> None:
        self.cancelled.append(request_id)

    def answer(self, result: dict[str, Any] | str) -> None:
        self.answers[self.sent[-1][0]] = result


def _session(bridge: FakeBridge, pad: dict[str, Any] | None = None, clock: Any = None) -> PadEditSession:
    kwargs: dict[str, Any] = {} if clock is None else {"clock": clock}
    return PadEditSession(pad, "e-3", "take-01", send=bridge.send, take=bridge.take, cancel=bridge.cancel, **kwargs)


def test_edit_session_sends_one_command_and_takes_only_the_bridges_answer() -> None:
    bridge = FakeBridge()
    saved = _with(pads.new_pad(), _button("b1", 0, 0))
    session = _session(bridge, saved)
    assert not session.dirty and not session.busy
    errors: list[str] = []

    assert session.submit({"op": "setLabel", "button": "b1", "label": "Fire"})
    request_id, draft, edit = bridge.sent[-1]
    assert (draft, edit) == (saved, {"op": "setLabel", "button": "b1", "label": "Fire"})
    # 答えを待つ間の構造を変える命令は送らない(描いた時点の位置で指す命令を古い作業コピーに当てない)
    assert session.busy and not session.submit({"op": "removeButton", "button": "b1"})
    assert len(bridge.sent) == 1 and not session.settle()

    edited = _with(saved, _button("b1", 0, 0, label="Fire"))
    bridge.answer(edited)
    assert session.settle() and session.draft == edited and session.dirty and not session.busy

    # 断られたら作業コピーは変えず、理由を渡す
    session.submit({"op": "setAddress", "button": "b1", "address": "/sys/ping"}, on_error=errors.append)
    bridge.answer("/sys と /oscdesk は予約されています")
    assert not session.settle() and session.draft == edited and errors == ["/sys と /oscdesk は予約されています"]


def test_edit_session_drops_every_queued_field_edit_when_the_bridge_is_gone() -> None:
    # 切断で答えが「disconnected」になり、預かった命令も送れないとき、1 つ目で止めると残りが送られないまま busy が続き、
    # 保存も切り替えもできなくなる(PR #126 の Codex レビュー)。送れない命令は理由を知らせて捨て、最後まで進める
    bridge = FakeBridge()
    session = _session(bridge, _with(pads.new_pad(), _button("b1", 0, 0)))
    errors: list[str] = []
    session.submit({"op": "setLabel", "button": "b1", "label": "F"}, on_error=errors.append)
    session.submit({"op": "setLabel", "button": "b1", "label": "Fi"}, on_error=errors.append)
    session.submit({"op": "setAddress", "button": "b1", "address": "/fx/a"}, on_error=errors.append)
    bridge.connected = False
    bridge.answer("disconnected")
    session.settle()
    assert not session.busy
    assert errors == ["ブリッジとの接続が切れました"] + ["ブリッジに接続していないため変更できません"] * 2
    # 再接続した後の命令は、いつもどおり送れる
    bridge.connected = True
    assert session.submit({"op": "setLabel", "button": "b1", "label": "Go"}) and session.busy


def test_edit_session_keeps_the_last_typed_value_of_each_field_while_waiting() -> None:
    bridge = FakeBridge()
    session = _session(bridge, _with(pads.new_pad(), _button("b1", 0, 0, args=[{"type": "i", "value": 0}])))
    ok: list[str] = []
    session.submit({"op": "setLabel", "button": "b1", "label": "F"})
    # 入力欄の命令は、答えを待つ間は欄ごとに最後の 1 つだけ預かる(断ると打った文字が作業コピーに入らない)
    assert session.submit({"op": "setLabel", "button": "b1", "label": "Fi"}, on_ok=lambda: ok.append("Fi"))
    assert session.submit({"op": "setArgValue", "button": "b1", "index": 0, "raw": "7"}, on_ok=lambda: ok.append("7"))
    assert session.submit({"op": "setLabel", "button": "b1", "label": "Fire"}, on_ok=lambda: ok.append("Fire"))
    assert len(bridge.sent) == 1 and session.busy

    first = _with(session.draft, _button("b1", 0, 0, label="F", args=[{"type": "i", "value": 0}]))
    bridge.answer(first)
    session.settle()
    # 預かった命令は答えの作業コピーへ当てる。同じ欄の古い入力(Fi)は送らない
    assert [edit for _, _, edit in bridge.sent[1:]] == [{"op": "setArgValue", "button": "b1", "index": 0, "raw": "7"}]
    assert bridge.sent[1][1] == first
    bridge.answer(_with(first, _button("b1", 0, 0, label="F", args=[{"type": "i", "value": 7}])))
    session.settle()
    assert bridge.sent[2][2] == {"op": "setLabel", "button": "b1", "label": "Fire"}
    bridge.answer(_with(first, _button("b1", 0, 0, label="Fire", args=[{"type": "i", "value": 7}])))
    session.settle()
    assert ok == ["7", "Fire"] and not session.busy
    # 構造を変える命令を待つ間の入力は預からない(添字が変わりうる)
    session.submit({"op": "moveArg", "button": "b1", "index": 0, "delta": 1})
    assert not session.submit({"op": "setArgValue", "button": "b1", "index": 0, "raw": "1"})


def test_edit_session_gives_up_after_the_timeout_and_when_disconnected() -> None:
    bridge = FakeBridge()
    now = [0.0]
    session = _session(bridge, pads.new_pad(), clock=lambda: now[0])
    errors: list[str] = []
    session.submit({"op": "addButton", "row": 0, "column": 0}, on_error=errors.append)
    now[0] = 14.0
    assert not session.settle() and session.busy
    now[0] = 15.5
    session.settle()
    assert errors == ["ブリッジの応答がありませんでした"] and bridge.cancelled == ["r1"] and not session.busy

    session.submit({"op": "addButton", "row": 0, "column": 0}, on_error=errors.append)
    bridge.answer("disconnected")
    session.settle()
    assert errors[-1] == "ブリッジとの接続が切れました"
    bridge.connected = False
    session.submit({"op": "addButton", "row": 0, "column": 0}, on_error=errors.append)
    assert errors[-1] == "ブリッジに接続していないため変更できません" and not session.busy


def test_edit_session_follows_only_when_clean_and_idle() -> None:
    bridge = FakeBridge()
    session = _session(bridge, pads.new_pad())
    assert not session.is_conflicted("e-4")  # 未編集なら競合ではない
    session.submit({"op": "addButton", "row": 0, "column": 0})
    # 答えを待つ間は追従しない(答えが追従した作業コピーを上書きするため)
    assert session.follow(pads.new_pad(2, 2), "e-4", "take-02") is False
    bridge.answer(_with(pads.new_pad(), _button("b1", 0, 0)))
    session.settle()
    assert session.dirty and session.is_conflicted("e-4") and not session.is_conflicted("e-3")
    assert session.follow(pads.new_pad(2, 2), "e-4", "take-02") is False
    session.mark_saved("e-5", "take-01")
    assert not session.dirty and session.follow(pads.new_pad(2, 2), "e-6", "take-02") is True
    assert (session.draft, session.base_version, session.base_name) == (pads.new_pad(2, 2), "e-6", "take-02")

    # 新規は待っている命令を忘れて空のパッドから始める
    session.submit({"op": "addButton", "row": 0, "column": 0})
    session.restart(pads.new_pad())
    assert session.draft == pads.new_pad() and session.dirty and not session.busy and bridge.cancelled[-1] == bridge.sent[-1][0]
    assert _session(bridge).draft == pads.new_pad()


# --- 表示キャッシュ ---------------------------------------------------------------


def test_pad_cache_bumps_its_revision_only_when_something_changes() -> None:
    cache = PadCache()
    pad = pads.new_pad()
    cache.apply_pad("take-01", "e-1", pad)
    assert (cache.revision, cache.version, cache.name) == (1, "e-1", "take-01")
    cache.apply_pad("take-01", "e-2", copy.deepcopy(pad))
    assert (cache.revision, cache.version) == (1, "e-2")
    cache.apply_list(("take-01",), "take-01")
    assert cache.revision == 2
    cache.apply_list(("take-01",), None)
    assert (cache.revision, cache.pad, cache.name) == (3, None, None)


def test_pad_cache_keeps_adoptions_so_coalesced_ones_can_be_matched() -> None:
    cache = PadCache()
    pad = pads.new_pad()
    cache.apply_pad("mine", "e-1", pad)
    seen = cache.adoption_seq
    cache.apply_pad("mine", "e-2", pad)
    cache.apply_pad("other", "e-3", pads.new_pad())
    assert [(a.name, a.version) for a in cache.adoptions_since(seen)] == [("mine", "e-2"), ("other", "e-3")]
    assert cache.adoptions_since(cache.adoption_seq) == []


def test_pad_cache_does_not_evict_adoptions_the_panel_has_not_read_yet() -> None:
    cache = PadCache()
    pad = pads.new_pad()
    cache.apply_pad("mine", "e-0", pad)
    seen = cache.adoption_seq
    cache.set_reader("a", seen)
    cache.set_reader("b", seen)
    for i in range(1, ADOPTION_HISTORY * 2):
        cache.apply_pad("mine", f"e-{i}", pad)
    # 未読の採用は履歴の長さを超えても残る
    assert len(cache.adoptions_since(seen)) == ADOPTION_HISTORY * 2 - 1
    # 遅い読み手がいる間は、速い読み手が読み終えても残る
    cache.set_reader("a", cache.adoption_seq)
    assert len(cache.adoptions_since(seen)) == ADOPTION_HISTORY * 2 - 1
    # 全員が読み終えた(または外れた)時点で、次の採用を待たずに上限まで刈り込む
    cache.drop_reader("b")
    assert len(cache.adoptions) == ADOPTION_HISTORY


def test_pad_cache_adoption_history_has_a_hard_limit_for_stalled_readers() -> None:
    cache = PadCache()
    pad = pads.new_pad()
    cache.set_reader("gone", 0)
    for i in range(ADOPTION_HISTORY_HARD_LIMIT + 10):
        cache.apply_pad("mine", f"e-{i}", pad)
    assert len(cache.adoptions) == ADOPTION_HISTORY_HARD_LIMIT
    # 止まっていた読み手は、未読の採用を失ったことを検出できる。読み終えた読み手は影響を受けない
    assert cache.has_gap_after(0)
    assert not cache.has_gap_after(cache.adoption_seq)


def test_pad_cache_detects_a_gap_for_a_reader_that_was_temporarily_unregistered() -> None:
    cache = PadCache()
    cache.apply_pad("mine", "e-0", pads.new_pad())
    seen = cache.adoption_seq
    cache.set_reader("a", seen)
    cache.set_reader("b", seen)
    # 一方の読み手だけが外れ、もう一方が読み進めても、外れていた側の欠落を検出できる
    cache.drop_reader("a")
    for i in range(1, ADOPTION_HISTORY + 5):
        cache.apply_pad("mine", f"e-{i}", pads.new_pad())
        cache.set_reader("b", cache.adoption_seq)
    assert cache.has_gap_after(seen)
    assert not cache.has_gap_after(cache.adoption_seq - ADOPTION_HISTORY)


def test_pad_cache_has_no_gap_while_the_reader_stays_registered() -> None:
    cache = PadCache()
    cache.set_reader("a", 0)
    for i in range(ADOPTION_HISTORY * 3):
        cache.apply_pad("mine", f"e-{i}", pads.new_pad())
        cache.set_reader("a", cache.adoption_seq)
    assert len(cache.adoptions) == ADOPTION_HISTORY
    assert not cache.has_gap_after(cache.adoption_seq - 1)


def test_reading_helpers_for_drawing_the_draft() -> None:
    pad = _with(pads.new_pad(3, 3), _button("b1", 2, 0), _button("b2", 0, 2, color="#FF0000", args=[{"type": "f", "value": 1.0}]))
    assert pads.button_at(pad, 2, 0)["id"] == "b1" and pads.button_at(pad, 1, 1) is None
    assert [button["id"] for button in pads.buttons_outside(pad, 2, 3)] == ["b1"]
    assert [button["id"] for button in pads.buttons_outside(pad, 2, 2)] == ["b1", "b2"]
    settings = pads.button_settings(pads.find_button(pad, "b2"))
    assert settings == {"label": "b2", "color": "#FF0000", "address": "/pad/b2", "args": [{"type": "f", "value": 1.0}]}
    # コピーした後に元を編集しても、写しは変わらない
    pads.find_button(pad, "b2")["args"][0]["value"] = 2.0
    assert settings["args"] == [{"type": "f", "value": 1.0}]
    assert pads.format_arg_value({"type": "f", "value": 1}) == "1.0" and pads.format_arg_value({"type": "i", "value": 1}) == "1"


def test_cell_style_picks_a_readable_text_color() -> None:
    assert text_color_for("#FFFFFF") == "#000000"
    assert text_color_for("#000000") == "#FFFFFF"
    assert text_color_for("#FFEB3B") == "#000000"
    assert text_color_for("bad") == "#FFFFFF"
    assert cell_style({"color": "#FFFFFF", "image": "data:image/png;base64,AAAA"}) == {
        "background-color": "#FFFFFF", "color": "#000000", "background-image": 'url("data:image/png;base64,AAAA")',
    }


# --- プロトコル -------------------------------------------------------------


def _pad_frame(pad: dict[str, Any], name: str = "take-01", revision: int = 1, epoch: str = "e") -> str:
    return json.dumps({
        "v": 1, "type": "osc.pad", "name": name, "revision": revision, "version": f"{epoch}-{revision}",
        "at": "2026-10-18T10:00:00.000Z", "pad": pad,
    })


def test_decode_pad_frames() -> None:
    pad = _with(pads.new_pad(), _button("b1", 0, 0))
    decoded = decode_frame(_pad_frame(pad))
    assert isinstance(decoded, PadFrame) and decoded.pad == pad and decoded.revision == 1 and decoded.version == "e-1"
    # パッドの中身の検証はブリッジだけが行う(採用したパッドしか配らない。D-122)。UI は外形だけを見る
    broken = copy.deepcopy(pad)
    broken["buttons"][0]["row"] = 9
    assert isinstance(decode_frame(_pad_frame(broken)), PadFrame)
    with pytest.raises(FrameDecodeError):
        decode_frame(_pad_frame(pad, name="../x"))
    listed = decode_frame('{"v":1,"type":"osc.padList","names":["a"],"active":null}')
    assert isinstance(listed, PadListFrame) and listed.names == ("a",) and listed.active is None
    log = decode_frame(json.dumps({"v": 1, "type": "osc.sentLog", "full": False, "records": [
        {"seq": 1, "at": "2026-10-18T10:00:00.000Z", "origin": "pad", "targets": ["unity"], "address": "/x", "args": [],
         "count": 1, "batch": None, "clipped": False}]}))
    assert isinstance(log, SentLogFrame) and log.records[0].origin == "pad"


def test_decode_pad_edited_frames() -> None:
    ok = decode_frame(json.dumps({"v": 1, "type": "osc.padEdited", "requestId": "padedit-1", "result": {"ok": True, "pad": pads.new_pad()}}))
    assert isinstance(ok, PadEditedFrame) and (ok.request_id, ok.pad, ok.detail) == ("padedit-1", pads.new_pad(), None)
    refused = decode_frame('{"v":1,"type":"osc.padEdited","requestId":"padedit-2","result":{"ok":false,"detail":"その引数はありません"}}')
    assert isinstance(refused, PadEditedFrame) and (refused.pad, refused.detail) == (None, "その引数はありません")
    with pytest.raises(FrameDecodeError):
        decode_frame('{"v":1,"type":"osc.padEdited","requestId":"padedit-3","result":{"ok":false,"detail":"x","pad":{}}}')


# --- タブの操作 ---------------------------------------------------------------


class PadLink:
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self.pressed: list[tuple[str, str, str]] = []
        self.saved: list[tuple[str, dict[str, Any]]] = []
        self.loaded: list[str] = []
        # 編集命令(D-126)。答えはテストが PadEditedFrame で返す(規則はブリッジの pad-editor.test.ts が確かめる)
        self.edits: list[tuple[str, dict[str, Any], dict[str, Any]]] = []

    def request_surface(self) -> None:
        pass

    connected = True

    def press_pad(self, name: str, version: str, button_id: str) -> bool:
        self.pressed.append((name, version, button_id))
        return True

    def save_pad(self, name: str, pad: dict[str, Any]) -> bool:
        self.saved.append((name, pad))
        return True

    def load_pad(self, name: str) -> bool:
        if not self.connected:
            return False
        self.loaded.append(name)
        return True

    def edit_pad(self, request_id: str, draft: dict[str, Any], edit: dict[str, Any]) -> bool:
        self.edits.append((request_id, copy.deepcopy(draft), edit))
        return self.connected


PAD = {
    "format": "oscdesk-pad",
    "version": 1,
    "rows": 2,
    "columns": 2,
    "buttons": [{"id": "fire", "row": 0, "column": 0, "label": "Fire", "address": "/fx/fire", "args": [{"type": "i", "value": 1}]}],
}


def _state_with_pad() -> tuple[SurfaceState, PadLink, SurfacePage]:
    state = SurfaceState(AppConfig(unity=UnityTarget("127.0.0.1", 7090, 7091)), link_factory=PadLink)
    state._on_frame(decode_frame(_pad_frame(PAD)))
    state._on_frame(decode_frame('{"v":1,"type":"osc.padList","names":["take-01"],"active":"take-01"}'))
    return state, state.link, SurfacePage(state)  # type: ignore[return-value]


def _interaction(user: Any, element: ui.element) -> UserInteraction[Any]:
    return UserInteraction(user, {element}, "")


def _answer(state: SurfaceState, link: PadLink, page: SurfacePage, result: dict[str, Any] | str) -> dict[str, Any]:
    """最後に送った編集命令へブリッジの答えを返し、同期させる。送った命令を返す。"""
    request_id, _draft, edit = link.edits[-1]
    if isinstance(result, dict):
        state._on_frame(PadEditedFrame("osc.padEdited", 1, request_id, result, None))
    else:
        state._on_frame(PadEditedFrame("osc.padEdited", 1, request_id, None, result))
    page.sync()
    return edit


def _add(state: SurfaceState, link: PadLink, page: SurfacePage, row: int, column: int, button_id: str = "b1") -> dict[str, Any]:
    """空きマスにボタンを足す命令を送り、ブリッジの答え(仮のボタンを足した作業コピー)を返して取り込ませる。"""
    panel = page._pad_panel
    panel._on_add(row, column)
    _request_id, draft, edit = link.edits[-1]
    assert edit == {"op": "addButton", "row": row, "column": column}
    answer = _with(draft, _button(button_id, row, column))
    _answer(state, link, page, answer)
    return answer


async def test_run_mode_sends_the_press_on_pointerdown() -> None:
    state, link, page = _state_with_pad()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        await user.should_see("Fire")
        panel = page._pad_panel
        cell = panel._cells["fire"][0]
        assert "run" in cell.classes
        _interaction(user, cell).trigger("pointerdown")
        assert link.pressed == [("take-01", "e-1", "fire")]
        # 同じ名前で上書き保存された版が届いたら描き直し、押下には新しい版を載せる
        state._on_frame(decode_frame(_pad_frame(PAD, revision=2)))
        page.sync()
        _interaction(user, panel._cells["fire"][0]).trigger("pointerdown")
        assert link.pressed[-1] == ("take-01", "e-2", "fire")
        # ブリッジの再起動後は revision が 1 に戻っても版の印が変わるので、描き直して新しい版を載せる
        state._on_frame(decode_frame(_pad_frame(PAD, revision=1, epoch="f")))
        page.sync()
        _interaction(user, panel._cells["fire"][0]).trigger("pointerdown")
        assert link.pressed[-1] == ("take-01", "f-1", "fire")
        # 実行モードでは Inspector も保存の操作も出さない
        assert not page._inspector_area.is_open
        assert not [e for e in user.find(kind=ui.button).elements if e.text == "保存"]


async def test_edit_mode_adds_a_button_edits_it_in_the_inspector_and_saves() -> None:
    state, link, page = _state_with_pad()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        panel = page._pad_panel
        panel._switch.value = True
        assert panel._session is not None

        # 編集モードでボタンを押すと送らずに選ぶ
        _interaction(user, panel._cells["fire"][0]).trigger("click")
        assert link.pressed == [] and panel._selected == "fire"
        await user.should_see("ボタン (fire)")

        # 空きマスを押すと命令を送り、答えのボタン(id はブリッジが振る)を選ぶ
        added = _add(state, link, page, 1, 1)
        assert panel._selected == "b1" and panel._session.draft == added
        await user.should_see("ボタン (b1)")

        # 入力欄の命令は欄の値のまま送る。断られた理由は欄の下に出し、作業コピーは変えない
        address = next(e for e in user.find(kind=ui.input).elements if e.value == "/pad/b1")
        address.value = "/sys/ping"
        assert link.edits[-1][2] == {"op": "setAddress", "button": "b1", "address": "/sys/ping"}
        _answer(state, link, page, "/sys と /oscdesk は予約されています")
        assert address.error == "/sys と /oscdesk は予約されています" and panel._session.draft == added
        address.value = "/fx/next"
        after_address = _with(added, _button("b1", 1, 1, address="/fx/next"))
        _answer(state, link, page, after_address)
        assert address.error is None and panel._cells["b1"][2].text == "/fx/next"

        user.find(kind=ui.button, content="引数を追加").click()
        assert link.edits[-1][2] == {"op": "addArg", "button": "b1", "type": "i"}
        with_arg = _with(after_address, _button("b1", 1, 1, address="/fx/next", args=[{"type": "i", "value": 0}]))
        _answer(state, link, page, with_arg)
        await user.should_see("1 / 16 個")
        panel._edit({"op": "setLabel", "button": "b1", "label": "Next"}, "cell")
        final = _with(with_arg, _button("b1", 1, 1, label="Next", address="/fx/next", args=[{"type": "i", "value": 0}]))
        _answer(state, link, page, final)
        assert panel._cells["b1"][1].text == "Next"
        assert panel._session.dirty

        panel._name_input.value = "take-01"
        with panel._root:  # 通知(トースト)を出すページの文脈
            panel._on_save()
        name, saved = link.saved[-1]
        assert (name, saved) == ("take-01", final)

        # ブリッジが保存を採用して戻すと、作業コピーは保存済みになる
        state._on_frame(decode_frame(_pad_frame(saved, revision=2)))
        panel.sync()
        assert not panel._session.dirty


async def test_waiting_for_an_answer_refuses_other_commands_and_saving() -> None:
    state, link, page = _state_with_pad()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        panel = page._pad_panel
        panel._switch.value = True
        panel._on_add(1, 1)
        draft = panel._session.draft
        with panel._root:
            # 答えを待つ間は次の構造の命令を送らず、答えを含まない作業コピーを保存しない
            panel._on_add(1, 0)
            assert len(link.edits) == 1
            panel._name_input.value = "take-01"
            panel._on_save()
            assert link.saved == []
        await user.should_see("前の変更を反映しています")
        # 答えを待つ間は、他の端末の採用へ追従しない(答えが追従した作業コピーを上書きしないため)
        state._on_frame(decode_frame(_pad_frame(pads.new_pad(1, 1), revision=2)))
        page.sync()
        assert panel._session.draft == draft
        # 断られたら理由を出し、作業コピーは変えない。答えの後は追従する(未編集なので)
        _answer(state, link, page, "このマスには既にボタンがあります")
        await user.should_see("このマスには既にボタンがあります")
        page.sync()
        assert panel._session.draft == pads.new_pad(1, 1)


async def test_leaving_edit_mode_with_unsaved_changes_asks_first() -> None:
    state, link, page = _state_with_pad()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        panel = page._pad_panel
        panel._switch.value = True
        _add(state, link, page, 0, 1)
        panel._switch.value = False
        await user.should_see("保存していない変更があります")
        assert panel._session is not None  # まだ編集中(確認待ち)
        user.find("破棄する").click()
        assert panel._session is None and not panel._switch.value


def _shown(view: ui.element) -> bool:
    return HIDDEN_VIEW_CLASS not in view.classes


async def test_closing_the_inspector_keeps_a_claim_made_while_closing() -> None:
    # 閉じる操作の中で借り直された(別の部品を選び直した)ときは、その新しい表示を消さない
    area = InspectorArea()
    owner = object()

    def root() -> None:
        area.build(ui.element("aside"), lambda: ui.label("dest"))

    async with user_simulation(root=root) as user:
        await user.open("/")
        area.claim(owner, "first", lambda: area.claim(owner, "second", lambda: None))
        area._close()
        assert area.owner is owner and _shown(area._inspector_view)
        area._close()
        assert not area.is_open and _shown(area._default_view)


async def test_the_button_inspector_takes_the_destination_pane_place_and_gives_it_back() -> None:
    state, link, page = _state_with_pad()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        panel = page._pad_panel
        area = page._inspector_area
        panel._switch.value = True
        # 格子は Inspector の隣に置かない(ボタンを選んでも幅が変わらない。D-091)
        assert "flex" not in panel._grid_box.style
        assert _shown(area._default_view) and not _shown(area._inspector_view)

        # ボタンを選ぶと送信先パネルの場所に Inspector が出て、送信先パネルは隠れる(作り直さない)
        _interaction(user, panel._cells["fire"][0]).trigger("click")
        assert area.owner is panel and _shown(area._inspector_view) and not _shown(area._default_view)
        assert "oscdesk-aside-inspecting" in area._frame.classes
        await user.should_see("ボタン (fire)")

        # 閉じる(×)と選択が外れて送信先パネルへ戻る
        area._close()
        assert panel._selected is None and not area.is_open
        assert _shown(area._default_view) and "oscdesk-aside-inspecting" not in area._frame.classes
        assert SELECTED_CLASS not in panel._cells["fire"][0].classes

        # 他のタブへ移ると送信先パネルへ戻し、パッドのタブへ戻ると同じボタンの Inspector を出し直す
        _interaction(user, panel._cells["fire"][0]).trigger("click")
        page._on_tab_change("main")
        assert not area.is_open and panel._selected == "fire"
        page._on_tab_change(extra_tab_name(0))
        assert area.owner is panel

        # 削除(答えが届いてから)・編集モードの終了でも送信先パネルへ戻る
        panel._remove("fire")
        assert area.is_open
        assert _answer(state, link, page, {**PAD, "buttons": []}) == {"op": "removeButton", "button": "fire"}
        assert not area.is_open
        _add(state, link, page, 0, 0)
        assert area.owner is panel
        panel._switch.value = False
        user.find("破棄する").click()
        assert not area.is_open and _shown(area._default_view)


async def test_run_mode_changes_only_this_screens_grid_size() -> None:
    state, link, page = _state_with_pad()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        panel = page._pad_panel
        # 格子の大きさは編集モードに入らなくても変えられ、パッドは保存しない(この画面の表示だけ)
        assert panel._session is None
        await user.should_see("この画面の表示だけ")
        panel._on_size(None, 1)
        assert link.saved == [] and link.edits == [] and panel._session is None
        assert "fire" in panel._cells  # 列を減らしても fire は (0, 0) なので見えたまま
        panel._on_size(3, 3)
        assert panel._grid_size(state.pad.pad) == (3, 3)
        # 隠れたボタンはパッドから消えない
        panel._on_size(1, 1)
        assert "fire" in panel._cells
        state._on_frame(decode_frame(_pad_frame({**PAD, "buttons": [{**PAD["buttons"][0], "row": 1, "column": 1}]}, revision=2)))
        page.sync()
        assert "fire" not in panel._cells and len(state.pad.pad["buttons"]) == 1
        await user.should_see("表示の外に 1 個のボタンがあります")
        # パッドと同じ大きさに戻すと、この画面だけの選択は消える
        panel._on_size(2, 2)
        assert panel._view_size is None and "fire" in panel._cells
        # 編集モードに入ると、保存される格子の大きさで編集する(大きさの変更は命令にする)
        panel._on_size(4, 4)
        panel._switch.value = True
        assert panel._grid_size(panel._session.draft) == (2, 2)
        panel._on_size(3, None)
        assert link.edits[-1][2] == {"op": "resize", "rows": 3, "columns": 2}
        _answer(state, link, page, {**panel._session.draft, "rows": 3})
        assert panel._session.draft["rows"] == 3 and panel._session.dirty
        # 断られたら選択欄を作業コピーの値へ戻す
        panel._on_size(1, None)
        with panel._root:
            _answer(state, link, page, "格子の外に出るボタンがあります: Fire")
        assert panel._grid_size(panel._session.draft) == (3, 2)


async def test_copied_button_settings_paste_over_another_button_without_changing_empty_cells() -> None:
    state, link, page = _state_with_pad()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        panel = page._pad_panel
        panel._switch.value = True
        # 編集の案内は格子の上に出し、ボタンを選ぶまで Inspector の領域を借りない(送信先パネルのまま)
        assert panel._hint_label.visible and not page._inspector_area.is_open
        _interaction(user, panel._cells["fire"][0]).trigger("click")
        assert page._inspector_area.owner is panel
        await user.should_see("ボタン (fire)")
        # 背景色・画像は畳まれ、OSC はボタンの子として開いている
        expansions = {element._props.get("label"): element for element in user.find(kind=ui.expansion).elements}
        assert expansions["外観(任意)"].value is False and expansions["OSC"].value is True
        # 位置の編集は無い
        assert not [element for element in user.find(kind=ui.label).elements if element.text == "位置"]

        user.find("コピー").click()
        await user.should_see("「Fire」の設定をコピー済みです")
        # コピーはクリップボードとして使い、空きマスは従来どおり仮の設定のボタンを足す
        _add(state, link, page, 1, 0)
        assert panel._selected == "b1"
        # 足したボタンへ「貼り付け」で設定を写す命令を送る(id と位置を保つのはブリッジの規則)
        user.find(kind=ui.button, content="貼り付け").click()
        assert link.edits[-1][2] == {
            "op": "pasteSettings", "button": "b1", "settings": {"label": "Fire", "address": "/fx/fire", "args": [{"type": "i", "value": 1}]},
        }
        # 開閉は描き直しても保つ
        panel._expanded["appearance"] = True
        panel._render_inspector()
        expansions = {element._props.get("label"): element for element in user.find(kind=ui.expansion).elements}
        assert expansions["外観(任意)"].value is True


async def test_an_uploaded_image_is_sent_as_its_bytes() -> None:
    state, link, page = _state_with_pad()

    class Upload:
        async def read(self) -> bytes:
            return PNG_1PX

    class Event:
        file = Upload()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        panel = page._pad_panel
        panel._switch.value = True
        # 種類(先頭のバイト)と大きさの判定と data URL への変換はブリッジ(D-126)。UI はバイト列を base64 で送るだけ
        await panel._on_image("fire", Event())  # type: ignore[arg-type]
        assert link.edits[-1][2] == {"op": "setImage", "button": "fire", "data": base64.b64encode(PNG_1PX).decode("ascii")}


def test_a_pad_with_lone_surrogates_is_not_dropped_by_the_ui() -> None:
    # zod は孤立サロゲートを含むラベルを通すので、ブリッジが配ったフレームを UI が捨ててはならない
    raw = '{"v":1,"type":"osc.pad","name":"take-01","revision":1,"version":"e-1","at":"2026-10-18T10:00:00.000Z","pad":{"format":"oscdesk-pad",' \
        '"version":1,"rows":1,"columns":1,"buttons":[{"id":"b1","row":0,"column":0,"label":"\\ud800","address":"/x",' \
        '"args":[{"type":"s","value":"a"}]}]}}'
    decoded = decode_frame(raw)
    assert isinstance(decoded, PadFrame) and decoded.pad is not None
    assert decoded.pad["buttons"][0]["label"] == "\ud800"
    assert utf16_length("\ud800") == 1 and utf16_length("😀") == 2


async def test_rebuilding_the_page_does_not_add_timers() -> None:
    # パネルは自前のタイマーを持たず、ページの同期タイマーから同期する(作り直しのたびにタイマーが増えないように)
    state, _link, page = _state_with_pad()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")

        def timers() -> int:
            return sum(isinstance(element, ui.timer) for element in user.client.elements.values())

        before = timers()
        assert before == 1
        for _ in range(5):
            page._surface_revision = -1  # 定義の再配信と同じく画面を作り直させる
            page.sync()
        assert timers() == before
        assert page._pad_panel._cells["fire"][0] is not None


async def test_switching_pads_keeps_the_draft_until_the_requested_pad_is_adopted() -> None:
    state, link, page = _state_with_pad()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        panel = page._pad_panel
        panel._switch.value = True
        draft = _add(state, link, page, 1, 1)
        panel._load_select.value = "take-01"

        with panel._root:  # 通知(トースト)を出すページの文脈
            # 未接続で送れなければ、下書きは未保存のまま残る
            link.connected = False
            panel._on_load()
            user.find("破棄する").click()
            page.sync()
            assert panel._session.dirty and panel._session.draft == draft

            # 送れても、要求したパッドが採用されて届くまでは(拒否されたままなら)下書きを残す
            link.connected = True
            panel._on_load()
            user.find("破棄する").click()
            assert link.loaded == ["take-01"]
            state._on_frame(decode_frame('{"v":1,"type":"notice","level":"error","code":"pad-rejected","detail":"x"}'))
            page.sync()
            assert panel._session.dirty and panel._session.draft == draft

            # 採用された pad が届いたら下書きを捨てて追従する
            state._on_frame(decode_frame(_pad_frame(PAD, revision=2)))
            page.sync()
            assert not panel._session.dirty and panel._session.draft == PAD


async def test_a_matching_pad_adopted_by_someone_else_does_not_mark_the_draft_saved() -> None:
    state, link, page = _state_with_pad()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        panel = page._pad_panel
        panel._switch.value = True
        draft = _add(state, link, page, 1, 1)
        panel._name_input.value = "mine"
        panel._save_name = "mine"

        # 保存を頼んでいないのに、他の端末がたまたま同じ内容のパッドを別の名前で採用した
        state._on_frame(decode_frame(_pad_frame(draft, name="theirs", revision=2)))
        page.sync()
        assert panel._session.dirty and panel._save_name == "mine"

        # 自分の保存の要求に対応する採用(名前・新しい版・送った内容が一致)が届いたときだけ保存済みにする
        with panel._root:
            panel._on_save()
            # 採用中のパッドが替わったので上書きの確認が出る
            user.find("上書き保存").click()
        assert link.saved[-1] == ("mine", draft)
        state._on_frame(decode_frame(_pad_frame(draft, name="mine", revision=3)))
        page.sync()
        assert not panel._session.dirty and panel._session.base_name == "mine"


def test_upstream_frames_with_lone_surrogates_can_be_sent_as_utf8_text() -> None:
    # ブリッジが配ったパッドに孤立サロゲートがあっても、保存し直す・編集する・撃つときに WebSocket の text(UTF-8)で送れる
    pad = _with(pads.new_pad(), _button("b1", 0, 0, label="\ud800", args=[{"type": "s", "value": "メンバーA"}]))
    for encoded in (
        encode_pad_save("take-01", pad),
        encode_pad_edit("padedit-1", pad, {"op": "setLabel", "button": "b1", "label": "\udfff"}),
        encode_osc_frame("/x", [("s", "a\ud800")]),
        encode_osc_batch_frame([OscMessage("/x", (WireArg("s", "\udfff"),))]),
    ):
        encoded.encode("utf-8")  # 例外にならない
        assert encoded.isascii()
    assert json.loads(encode_pad_save("take-01", pad))["pad"] == pad


async def test_edits_made_after_requesting_a_switch_are_not_discarded() -> None:
    state, link, page = _state_with_pad()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        panel = page._pad_panel
        panel._switch.value = True
        added = _add(state, link, page, 1, 1)
        panel._load_select.value = "take-01"
        with panel._root:  # 通知(トースト)を出すページの文脈
            panel._on_load()
            user.find("破棄する").click()
            assert link.loaded == ["take-01"]
            # 切り替えの要求中に編集を続けた
            panel._edit({"op": "setLabel", "button": "b1", "label": "Edited later"}, "cell")
            edited = _with(added, _button("b1", 1, 1, label="Edited later"))
            _answer(state, link, page, edited)
            state._on_frame(decode_frame(_pad_frame(PAD, revision=2)))
            page.sync()
            assert panel._session.dirty and panel._session.draft == edited
        await user.should_see("下書きを残しました")


async def test_a_pending_save_survives_someone_elses_save_under_the_same_name() -> None:
    state, link, page = _state_with_pad()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        panel = page._pad_panel
        panel._switch.value = True
        draft = _add(state, link, page, 1, 1)
        panel._name_input.value = "take-01"
        with panel._root:
            panel._on_save()
            assert link.saved[-1] == ("take-01", draft)
            # 先に他の端末の保存(同じ名前・違う内容)が採用され、その後に自分の保存の採用が届く
            state._on_frame(decode_frame(_pad_frame(pads.new_pad(1, 1), revision=2)))
            page.sync()
            assert panel._session.dirty
            state._on_frame(decode_frame(_pad_frame(draft, revision=3)))
            page.sync()
            assert not panel._session.dirty and panel._session.base_version == "e-3"


async def test_adoption_arriving_with_a_surface_rebuild_is_still_reconciled() -> None:
    # 定義の再配信(画面の作り直し)とパッドの採用が同じ同期の周期に届いても、保存の確認を飛ばさない
    state, link, page = _state_with_pad()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        panel = page._pad_panel
        panel._switch.value = True
        draft = _add(state, link, page, 1, 1)
        panel._name_input.value = "take-01"
        with panel._root:
            panel._on_save()
        assert link.saved[-1] == ("take-01", draft)

        page._surface_revision = -1  # 定義の再配信と同じく、次の同期で画面を作り直させる
        state._on_frame(decode_frame(_pad_frame(draft, revision=2)))
        page.sync()
        assert not panel._session.dirty and panel._session.base_version == "e-2"


async def test_my_save_is_confirmed_even_when_another_adoption_arrives_in_the_same_sync() -> None:
    state, link, page = _state_with_pad()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        panel = page._pad_panel
        panel._switch.value = True
        draft = _add(state, link, page, 1, 1)
        panel._name_input.value = "mine"
        panel._save_name = "mine"
        with panel._root:
            panel._on_save()
        assert link.saved[-1] == ("mine", draft)

        # 自分の保存の採用の直後、同じ同期の前に別名の採用が届く
        state._on_frame(decode_frame(_pad_frame(draft, name="mine", revision=3)))
        state._on_frame(decode_frame(_pad_frame(pads.new_pad(), name="theirs", revision=4)))
        page.sync()
        assert not panel._session.dirty


def test_pad_edit_answers_are_kept_per_request_and_unrequested_ones_are_dropped() -> None:
    state = SurfaceState(AppConfig(unity=UnityTarget("127.0.0.1", 7090, 7091)), link_factory=PadLink)
    request_id = state.request_pad_edit(pads.new_pad(), {"op": "addButton", "row": 0, "column": 0})
    assert request_id is not None and state.take_pad_edit(request_id) is None
    state._on_frame(PadEditedFrame("osc.padEdited", 1, request_id, pads.new_pad(2, 2), None))
    assert state.take_pad_edit(request_id) == pads.new_pad(2, 2) and state.take_pad_edit(request_id) is None
    # 頼んでいない答え・待つのをやめた答えは溜めない
    state._on_frame(PadEditedFrame("osc.padEdited", 1, "other", pads.new_pad(), None))
    cancelled = state.request_pad_edit(pads.new_pad(), {"op": "resize", "rows": 1, "columns": 1})
    assert cancelled is not None
    state.cancel_pad_edit(cancelled)
    state._on_frame(PadEditedFrame("osc.padEdited", 1, cancelled, None, "x"))
    assert state.take_pad_edit("other") is None and state.take_pad_edit(cancelled) is None


def test_pad_digest_ignores_float_spelling_of_whole_numbers_and_key_order() -> None:
    a = {"b": [{"type": "f", "value": 1.0}], "a": 0.0}
    b = {"a": 0, "b": [{"value": 1, "type": "f"}]}
    assert pads.pad_digest(a) == pads.pad_digest(b)
    assert pads.pad_digest(a) != pads.pad_digest({"a": 0.5, "b": b["b"]})
