"""OSC パッド(D-080 / D-081)の検証・編集規則・表示キャッシュ・タブの操作。"""

from __future__ import annotations

import base64
import copy
import json
from pathlib import Path
from typing import Any

import pytest
from nicegui import ui
from nicegui.testing import user_simulation
from nicegui.testing.user_interaction import UserInteraction

from oscdesk_ui import osc_pad as pads
from oscdesk_ui.config import AppConfig, UnityTarget
from oscdesk_ui.osc_pad import ADOPTION_HISTORY, ADOPTION_HISTORY_HARD_LIMIT, PadCache, PadEditError, PadEditSession
from oscdesk_ui.osc_pad_panel import cell_style, text_color_for
from oscdesk_ui.page import SurfacePage
from oscdesk_ui.protocol import (
    FrameDecodeError,
    OscMessage,
    PadFrame,
    PadListFrame,
    SentLogFrame,
    WireArg,
    decode_frame,
    encode_osc_batch_frame,
    encode_osc_frame,
    encode_pad_save,
)
from oscdesk_ui.state import SurfaceState

SAMPLES_PATH = Path(__file__).parents[3] / "protocol" / "osc-pad-samples.json"
PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def _samples() -> list[dict[str, Any]]:
    return json.loads(SAMPLES_PATH.read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("case", _samples(), ids=lambda case: case["name"])
def test_pad_samples_match_the_typescript_judgement(case: dict[str, Any]) -> None:
    assert (pads.collect_pad_issues(case["pad"]) == []) is case["valid"]


def _image_of(size: int) -> str:
    groups, rest = divmod(size, 3)
    tail = {0: "", 1: "AA==", 2: "AAA="}[rest]
    return f"data:image/png;base64,{'AAAA' * groups}{tail}"


def _pad_with_images(*sizes: int) -> dict[str, Any]:
    pad = pads.new_pad(12, 12)
    pad["buttons"] = [
        {"id": f"b{index}", "row": index // 12, "column": index % 12, "label": "", "image": _image_of(size), "address": "/x", "args": []}
        for index, size in enumerate(sizes)
    ]
    return pad


def test_image_limits_match_the_typescript_side() -> None:
    assert [pads.image_data_url_bytes(_image_of(size)) for size in (0, 1, 2, 300)] == [0, 1, 2, 300]
    assert pads.collect_pad_issues(_pad_with_images(pads.MAX_IMAGE_BYTES)) == []
    assert f'image of "b0" exceeds {pads.MAX_IMAGE_BYTES} bytes' in " ".join(
        pads.collect_pad_issues(_pad_with_images(pads.MAX_IMAGE_BYTES + 1))
    )
    count = pads.MAX_TOTAL_IMAGE_BYTES // pads.MAX_IMAGE_BYTES
    assert pads.collect_pad_issues(_pad_with_images(*[pads.MAX_IMAGE_BYTES] * count)) == []
    assert any("in total" in issue for issue in pads.collect_pad_issues(_pad_with_images(*[pads.MAX_IMAGE_BYTES] * (count + 1))))


def test_labels_are_counted_like_javascript_strings() -> None:
    pad, button_id = pads.add_button(pads.new_pad(), 0, 0)
    # 絵文字は JS では 2 文字と数える(zod の max と判定を揃える)
    assert pads.collect_pad_issues(pads.set_label(pad, button_id, "😀" * 32)) == []
    with pytest.raises(PadEditError):
        pads.set_label(pad, button_id, "😀" * 33)


# --- 編集規則 -------------------------------------------------------------


def test_add_button_fills_an_empty_cell_with_a_valid_placeholder() -> None:
    pad = pads.new_pad(2, 2)
    added, first = pads.add_button(pad, 0, 1)
    added, second = pads.add_button(added, 1, 0)
    assert (first, second) == ("b1", "b2")
    assert pad["buttons"] == []  # 元の dict は変えない
    assert pads.button_at(added, 0, 1) == {"id": "b1", "row": 0, "column": 1, "label": "b1", "address": "/pad/b1", "args": []}
    assert pads.collect_pad_issues(added) == []
    with pytest.raises(PadEditError, match="既にボタン"):
        pads.add_button(added, 0, 1)
    with pytest.raises(PadEditError, match="格子の外"):
        pads.add_button(added, 2, 0)


def test_move_swaps_with_the_button_already_in_the_target_cell() -> None:
    pad, first = pads.add_button(pads.new_pad(2, 2), 0, 0)
    pad, second = pads.add_button(pad, 1, 1)
    moved = pads.move_button(pad, first, 1, 1)
    assert (pads.find_button(moved, first)["row"], pads.find_button(moved, first)["column"]) == (1, 1)
    assert (pads.find_button(moved, second)["row"], pads.find_button(moved, second)["column"]) == (0, 0)
    moved = pads.move_button(moved, first, 0, 1)
    assert pads.button_at(moved, 1, 1) is None and pads.collect_pad_issues(moved) == []


def test_resize_refuses_to_drop_buttons() -> None:
    pad, _ = pads.add_button(pads.new_pad(3, 3), 2, 2)
    pad = pads.set_label(pad, "b1", "Fire")
    with pytest.raises(PadEditError, match="Fire"):
        pads.resize_pad(pad, 2, 3)
    assert pads.resize_pad(pad, 3, 12)["columns"] == 12
    with pytest.raises(PadEditError):
        pads.resize_pad(pad, 13, 3)


def test_address_rules_reject_reserved_and_pattern_addresses() -> None:
    pad, button_id = pads.add_button(pads.new_pad(), 0, 0)
    assert pads.find_button(pads.set_address(pad, button_id, "/fx/fire"), button_id)["address"] == "/fx/fire"
    for address, reason in (
        ("fx", "/ で始め"),
        ("/sys/ping", "予約"),
        ("/oscdesk", "予約"),
        ("/fx/*", "使えません"),
        ("/fx/", "使えません"),
        ("/a b", "使えません"),
    ):
        assert reason in (pads.address_problem(address) or "")
        with pytest.raises(PadEditError):
            pads.set_address(pad, button_id, address)


def test_args_are_typed_and_range_checked() -> None:
    pad, button_id = pads.add_button(pads.new_pad(), 0, 0)
    pad = pads.add_arg(pad, button_id, "i")
    pad = pads.set_arg_value(pad, button_id, 0, "2147483647")
    pad = pads.add_arg(pad, button_id, "f")
    pad = pads.set_arg_value(pad, button_id, 1, "0.25")
    pad = pads.add_arg(pad, button_id, "s")
    pad = pads.set_arg_value(pad, button_id, 2, " メンバーA ")
    assert pads.find_button(pad, button_id)["args"] == [
        {"type": "i", "value": 2147483647},
        {"type": "f", "value": 0.25},
        {"type": "s", "value": " メンバーA "},
    ]
    assert pads.collect_pad_issues(pad) == []
    for arg_type, raw in (("i", "2147483648"), ("i", "1.5"), ("f", "nan"), ("f", "inf"), ("f", "x")):
        with pytest.raises(PadEditError):
            pads.parse_arg_value(arg_type, raw)
    # 型を変えると、読める値は引き継ぎ、読めない値は既定値にする
    converted = pads.set_arg_type(pad, button_id, 1, "s")
    assert pads.find_button(converted, button_id)["args"][1] == {"type": "s", "value": "0.25"}
    converted = pads.set_arg_type(pad, button_id, 2, "i")
    assert pads.find_button(converted, button_id)["args"][2] == {"type": "i", "value": 0}
    reordered = pads.move_arg(pad, button_id, 0, 1)
    assert [arg["type"] for arg in pads.find_button(reordered, button_id)["args"]] == ["f", "i", "s"]
    assert [arg["type"] for arg in pads.find_button(pads.remove_arg(pad, button_id, 1), button_id)["args"]] == ["i", "s"]


def test_arg_count_is_limited() -> None:
    pad, button_id = pads.add_button(pads.new_pad(), 0, 0)
    for _ in range(pads.MAX_ARGS):
        pad = pads.add_arg(pad, button_id)
    with pytest.raises(PadEditError):
        pads.add_arg(pad, button_id)


def test_color_and_image_editing() -> None:
    pad, button_id = pads.add_button(pads.new_pad(), 0, 0)
    colored = pads.set_color(pad, button_id, "#1e88e5")
    assert pads.find_button(colored, button_id)["color"] == "#1E88E5"
    assert "color" not in pads.find_button(pads.set_color(colored, button_id, None), button_id)
    with pytest.raises(PadEditError):
        pads.set_color(pad, button_id, "blue")

    data_url = pads.image_data_url(PNG_1PX)
    assert data_url.startswith("data:image/png;base64,")
    with_image = pads.set_image(pad, button_id, data_url)
    assert pads.collect_pad_issues(with_image) == []
    assert "image" not in pads.find_button(pads.set_image(with_image, button_id, None), button_id)
    with pytest.raises(PadEditError, match="PNG"):
        pads.image_data_url(b"<svg/>")
    with pytest.raises(PadEditError, match="KiB"):
        pads.image_data_url(b"\x89PNG\r\n\x1a\n" + b"\0" * pads.MAX_IMAGE_BYTES)
    assert pads.sniff_image_mime(b"RIFF\0\0\0\0WEBPVP8 ") == "image/webp"
    assert pads.sniff_image_mime(b"\xff\xd8\xff\xe0") == "image/jpeg"


def test_remove_button() -> None:
    pad, button_id = pads.add_button(pads.new_pad(), 0, 0)
    assert pads.remove_button(pad, button_id)["buttons"] == []
    with pytest.raises(PadEditError):
        pads.remove_button(pad, "nope")


def test_edit_session_applies_only_valid_changes_and_follows_when_clean() -> None:
    saved, _ = pads.add_button(pads.new_pad(), 0, 0)
    session = PadEditSession.start(saved, version="e-3", name="take-01")
    assert not session.dirty

    broken = copy.deepcopy(session.draft)
    broken["buttons"][0]["address"] = "/sys/ping"
    assert session.apply(broken) is not None and not session.dirty

    edited = pads.set_label(session.draft, "b1", "Fire")
    assert session.apply(edited) is None and session.dirty
    assert not session.is_conflicted("e-3") and session.is_conflicted("e-4")
    # 編集中は他の端末の保存へ追従しない
    assert session.follow(pads.new_pad(), "e-4", "take-02") is False and session.draft == edited
    session.mark_saved("e-5", "take-01")
    assert not session.dirty and session.follow(pads.new_pad(), "e-6", "take-02") is True
    assert (session.draft, session.base_version, session.base_name) == (pads.new_pad(), "e-6", "take-02")

    fresh = PadEditSession.start(None, "", None)
    assert fresh.draft == pads.new_pad()


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
        "v": 1, "type": "pad", "name": name, "revision": revision, "version": f"{epoch}-{revision}",
        "at": "2026-10-18T10:00:00.000Z", "pad": pad,
    })


def test_decode_pad_frames() -> None:
    pad, _ = pads.add_button(pads.new_pad(), 0, 0)
    decoded = decode_frame(_pad_frame(pad))
    assert isinstance(decoded, PadFrame) and decoded.pad == pad and decoded.revision == 1 and decoded.version == "e-1"
    broken = copy.deepcopy(pad)
    broken["buttons"][0]["row"] = 9
    with pytest.raises(FrameDecodeError):
        decode_frame(_pad_frame(broken))
    with pytest.raises(FrameDecodeError):
        decode_frame(_pad_frame(pad, name="../x"))
    listed = decode_frame('{"v":1,"type":"padList","names":["a"],"active":null}')
    assert isinstance(listed, PadListFrame) and listed.names == ("a",) and listed.active is None
    log = decode_frame(json.dumps({"v": 1, "type": "sentLog", "full": False, "records": [
        {"seq": 1, "at": "2026-10-18T10:00:00.000Z", "origin": "pad", "targets": ["unity"], "address": "/x", "args": [],
         "count": 1, "batch": None, "clipped": False}]}))
    assert isinstance(log, SentLogFrame) and log.records[0].origin == "pad"


# --- タブの操作 ---------------------------------------------------------------


class PadLink:
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self.pressed: list[tuple[str, str, str]] = []
        self.saved: list[tuple[str, dict[str, Any]]] = []
        self.loaded: list[str] = []

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
    state._on_frame(decode_frame('{"v":1,"type":"padList","names":["take-01"],"active":"take-01"}'))
    return state, state.link, SurfacePage(state)  # type: ignore[return-value]


def _interaction(user: Any, element: ui.element) -> UserInteraction[Any]:
    return UserInteraction(user, {element}, "")


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
        assert not panel._inspector_box.visible
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

        panel._on_add(1, 1)
        assert panel._selected == "b1"
        panel._on_address("b1", "/sys/ping")  # 予約アドレスは作業コピーへ入れない
        panel._on_address("b1", "/fx/next")
        panel._edit(lambda p: pads.add_arg(p, "b1", "s"), "inspector")
        panel._on_arg_value("b1", 0, "メンバーA")
        panel._on_arg_value("b1", 0, "x" * (pads.MAX_STRING_ARG_CHARS + 1))  # 入力途中の不正値は無視
        panel._edit(lambda p: pads.set_label(p, "b1", "Next"), "cell")
        assert panel._cells["b1"][1].text == "Next"
        assert panel._session.dirty

        panel._name_input.value = "take-01"
        with panel._root:  # 通知(トースト)を出すページの文脈
            panel._on_save()
        name, saved = link.saved[-1]
        assert name == "take-01"
        assert pads.find_button(saved, "b1") == {
            "id": "b1", "row": 1, "column": 1, "label": "Next", "address": "/fx/next", "args": [{"type": "s", "value": "メンバーA"}],
        }

        # ブリッジが保存を採用して戻すと、作業コピーは保存済みになる
        state._on_frame(decode_frame(_pad_frame(saved, revision=2)))
        panel.sync()
        assert not panel._session.dirty


async def test_leaving_edit_mode_with_unsaved_changes_asks_first() -> None:
    state, link, page = _state_with_pad()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        panel = page._pad_panel
        panel._switch.value = True
        panel._on_add(0, 1)
        panel._switch.value = False
        await user.should_see("保存していない変更があります")
        assert panel._session is not None  # まだ編集中(確認待ち)
        user.find("破棄する").click()
        assert panel._session is None and not panel._switch.value

def test_a_pad_with_lone_surrogates_is_not_dropped_by_the_ui() -> None:
    # zod は孤立サロゲートを含むラベルを通すので、ブリッジが配ったフレームを UI が捨ててはならない
    raw = '{"v":1,"type":"pad","name":"take-01","revision":1,"version":"e-1","at":"2026-10-18T10:00:00.000Z","pad":{"format":"oscdesk-pad",' \
        '"version":1,"rows":1,"columns":1,"buttons":[{"id":"b1","row":0,"column":0,"label":"\\ud800","address":"/x",' \
        '"args":[{"type":"s","value":"a"}]}]}}'
    decoded = decode_frame(raw)
    assert isinstance(decoded, PadFrame) and decoded.pad is not None
    assert decoded.pad["buttons"][0]["label"] == "\ud800"
    assert pads.utf16_length("\ud800") == 1 and pads.utf16_length("😀") == 2


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

def test_float_arguments_must_fit_in_float32() -> None:
    assert pads.fits_float32(3.4028234663852886e38) and pads.fits_float32(-3.4028235e38) and pads.fits_float32(1e-50)
    assert not pads.fits_float32(1e300) and not pads.fits_float32(-3.5e38) and not pads.fits_float32(float("inf"))
    with pytest.raises(PadEditError, match="float32"):
        pads.parse_arg_value("f", "1e300")


async def test_switching_pads_keeps_the_draft_until_the_requested_pad_is_adopted() -> None:
    state, link, page = _state_with_pad()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        panel = page._pad_panel
        panel._switch.value = True
        panel._on_add(1, 1)
        draft = panel._session.draft
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

def test_address_length_and_serialized_size_limits() -> None:
    pad, button_id = pads.add_button(pads.new_pad(), 0, 0)
    assert pads.find_button(pads.set_address(pad, button_id, "/" + "a" * 255), button_id) is not None
    assert pads.address_problem("/" + "a" * 256) == "256 文字までです"
    with pytest.raises(PadEditError):
        pads.set_address(pad, button_id, "/" + "a" * 256)
    assert pads.serialized_bytes(pads.new_pad(1, 1)) == len(
        '{"format":"oscdesk-pad","version":1,"rows":1,"columns":1,"buttons":[]}'
    )


async def test_saving_an_oversized_pad_is_refused_before_sending() -> None:
    state, link, page = _state_with_pad()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        panel = page._pad_panel
        panel._switch.value = True
        session = panel._session
        big = pads.new_pad(12, 12)
        big["buttons"] = [
            {"id": f"b{i}", "row": i // 12, "column": i % 12, "label": "", "address": "/x",
             "args": [{"type": "s", "value": "あ" * pads.MAX_STRING_ARG_CHARS}] * pads.MAX_ARGS}
            for i in range(144)
        ]
        big["buttons"][0]["image"] = "data:image/png;base64," + "AAAA" * (pads.MAX_IMAGE_BYTES // 3)
        assert session.apply(big) is None and pads.serialized_bytes(big) <= pads.MAX_SERIALIZED_BYTES
        for i in range(1, 16):
            big["buttons"][i]["image"] = big["buttons"][0]["image"]
        assert session.apply(big) is None and pads.serialized_bytes(big) > pads.MAX_SERIALIZED_BYTES
        panel._name_input.value = "big"
        with panel._root:
            panel._on_save()
        assert link.saved == []
        await user.should_see("大きすぎて保存できません")

async def test_a_matching_pad_adopted_by_someone_else_does_not_mark_the_draft_saved() -> None:
    state, link, page = _state_with_pad()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        panel = page._pad_panel
        panel._switch.value = True
        panel._on_add(1, 1)
        draft = panel._session.draft
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
    # ブリッジが配ったパッドに孤立サロゲートがあっても、保存し直す・撃つときに WebSocket の text(UTF-8)で送れる
    pad, button_id = pads.add_button(pads.new_pad(), 0, 0)
    pad = pads.set_label(pad, button_id, "\ud800")
    pad = pads.add_arg(pad, button_id, "s")
    pad = pads.set_arg_value(pad, button_id, 0, "メンバーA")
    for encoded in (
        encode_pad_save("take-01", pad),
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
        panel._on_add(1, 1)
        panel._load_select.value = "take-01"
        with panel._root:  # 通知(トースト)を出すページの文脈
            panel._on_load()
            user.find("破棄する").click()
            assert link.loaded == ["take-01"]
            # 切り替えの要求中に編集を続けた
            panel._edit(lambda p: pads.set_label(p, "b1", "Edited later"), "cell")
            edited = panel._session.draft
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
        panel._on_add(1, 1)
        draft = panel._session.draft
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

def test_nul_is_refused_in_string_arguments_and_addresses() -> None:
    pad, button_id = pads.add_button(pads.new_pad(), 0, 0)
    pad = pads.add_arg(pad, button_id, "s")
    with pytest.raises(PadEditError, match="NUL"):
        pads.set_arg_value(pad, button_id, 0, "a\x00b")
    with pytest.raises(PadEditError, match="NUL"):
        pads.parse_arg_value("s", "\x00")
    assert pads.address_problem("/a\x00b") == "NUL 文字は使えません"
    with pytest.raises(PadEditError):
        pads.set_address(pad, button_id, "/a\x00b")
    assert not pads.is_valid_address("/a\x00b")

async def test_adoption_arriving_with_a_surface_rebuild_is_still_reconciled() -> None:
    # 定義の再配信(画面の作り直し)とパッドの採用が同じ同期の周期に届いても、保存の確認を飛ばさない
    state, link, page = _state_with_pad()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        panel = page._pad_panel
        panel._switch.value = True
        panel._on_add(1, 1)
        draft = panel._session.draft
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
        panel._on_add(1, 1)
        draft = panel._session.draft
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


def test_string_input_with_a_lone_surrogate_is_refused_with_a_message() -> None:
    with pytest.raises(PadEditError):
        pads.parse_arg_value("s", "a\ud800")
    assert pads.address_problem("/x\udc00") is not None
    assert pads.parse_arg_value("s", "😀") == "😀"


def test_pad_digest_ignores_float_spelling_of_whole_numbers_and_key_order() -> None:
    a = {"b": [{"type": "f", "value": 1.0}], "a": 0.0}
    b = {"a": 0, "b": [{"value": 1, "type": "f"}]}
    assert pads.pad_digest(a) == pads.pad_digest(b)
    assert pads.pad_digest(a) != pads.pad_digest({"a": 0.5, "b": b["b"]})
