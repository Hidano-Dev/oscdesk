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
from oscdesk_ui.osc_pad import PadCache, PadEditError, PadEditSession
from oscdesk_ui.osc_pad_panel import cell_style, text_color_for
from oscdesk_ui.page import SurfacePage
from oscdesk_ui.protocol import FrameDecodeError, PadFrame, PadListFrame, SentLogFrame, decode_frame
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
    session = PadEditSession.start(saved, revision=3, name="take-01")
    assert not session.dirty

    broken = copy.deepcopy(session.draft)
    broken["buttons"][0]["address"] = "/sys/ping"
    assert session.apply(broken) is not None and not session.dirty

    edited = pads.set_label(session.draft, "b1", "Fire")
    assert session.apply(edited) is None and session.dirty
    assert not session.is_conflicted(3) and session.is_conflicted(4)
    # 編集中は他の端末の保存へ追従しない
    assert session.follow(pads.new_pad(), 4, "take-02") is False and session.draft == edited
    session.mark_saved(5, "take-01")
    assert not session.dirty and session.follow(pads.new_pad(), 6, "take-02") is True
    assert (session.draft, session.base_revision, session.base_name) == (pads.new_pad(), 6, "take-02")

    fresh = PadEditSession.start(None, 0, None)
    assert fresh.draft == pads.new_pad()


def test_pad_cache_bumps_its_revision_only_when_something_changes() -> None:
    cache = PadCache()
    pad = pads.new_pad()
    cache.apply_pad("take-01", 1, pad)
    assert (cache.revision, cache.bridge_revision, cache.name) == (1, 1, "take-01")
    cache.apply_pad("take-01", 2, copy.deepcopy(pad))
    assert (cache.revision, cache.bridge_revision) == (1, 2)
    cache.apply_list(("take-01",), "take-01")
    assert cache.revision == 2
    cache.apply_list(("take-01",), None)
    assert (cache.revision, cache.pad, cache.name) == (3, None, None)


def test_cell_style_picks_a_readable_text_color() -> None:
    assert text_color_for("#FFFFFF") == "#000000"
    assert text_color_for("#000000") == "#FFFFFF"
    assert text_color_for("#FFEB3B") == "#000000"
    assert text_color_for("bad") == "#FFFFFF"
    assert cell_style({"color": "#FFFFFF", "image": "data:image/png;base64,AAAA"}) == {
        "background-color": "#FFFFFF", "color": "#000000", "background-image": 'url("data:image/png;base64,AAAA")',
    }


# --- プロトコル -------------------------------------------------------------


def _pad_frame(pad: dict[str, Any], name: str = "take-01", revision: int = 1) -> str:
    return json.dumps({"v": 1, "type": "pad", "name": name, "revision": revision, "at": "2026-10-18T10:00:00.000Z", "pad": pad})


def test_decode_pad_frames() -> None:
    pad, _ = pads.add_button(pads.new_pad(), 0, 0)
    decoded = decode_frame(_pad_frame(pad))
    assert isinstance(decoded, PadFrame) and decoded.pad == pad and decoded.revision == 1
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
        self.pressed: list[tuple[str, str]] = []
        self.saved: list[tuple[str, dict[str, Any]]] = []
        self.loaded: list[str] = []

    def request_surface(self) -> None:
        pass

    def press_pad(self, name: str, button_id: str) -> bool:
        self.pressed.append((name, button_id))
        return True

    def save_pad(self, name: str, pad: dict[str, Any]) -> bool:
        self.saved.append((name, pad))
        return True

    def load_pad(self, name: str) -> bool:
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
        assert link.pressed == [("take-01", "fire")]
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
    raw = '{"v":1,"type":"pad","name":"take-01","revision":1,"at":"2026-10-18T10:00:00.000Z","pad":{"format":"oscdesk-pad",' \
        '"version":1,"rows":1,"columns":1,"buttons":[{"id":"b1","row":0,"column":0,"label":"\\ud800","address":"/x",' \
        '"args":[{"type":"s","value":"a\\udc00"}]}]}}'
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
