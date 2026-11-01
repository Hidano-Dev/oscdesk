from __future__ import annotations

import copy
from typing import Any

from nicegui import ui
from nicegui.testing import user_simulation
from nicegui.testing.user_interaction import UserInteraction

from oscdesk_ui import editor_panel
from oscdesk_ui.config import AppConfig, UnityTarget
from oscdesk_ui.page import SurfacePage
from oscdesk_ui.protocol import SurfaceEditedFrame, SurfaceListFrame
from oscdesk_ui.state import SurfaceState

from .surface_fixtures import control, definition, param, surface_frame

PARAMS = [param("a", "/a", "bool", "A"), param("b", "/b", "bool", "B")]


class RecordingLink:
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self.saved: list[tuple[str, dict[str, Any], bool]] = []
        self.loaded: list[str] = []
        # 編集命令(D-123)。答えはテストが SurfaceEditedFrame で返す(規則はブリッジの surface-editor.test.ts が確かめる)
        self.edits: list[tuple[str, dict[str, Any] | None, dict[str, Any]]] = []
        self.connected = True

    def edit_surface(self, request_id: str, draft: dict[str, Any] | None, edit: dict[str, Any]) -> bool:
        self.edits.append((request_id, copy.deepcopy(draft), edit))
        return self.connected

    def request_surface(self) -> None:
        pass

    def send_osc(self, address: str, args: list[Any]) -> None:
        pass

    def send_lock(self, ref: tuple[str, ...], holder: str, label: str) -> None:

        pass


    def send_unlock(self, ref: tuple[str, ...], holder: str) -> None:

        pass


    def send_set(self, param: str, value: Any = None, *, has_value: bool = True, holder: str | None = None, revision: int | None = None) -> None:
        # パラメータは ID と JSON の値で送る(HID-373)。単独送信の有無を同じ sent で確かめる
        pass

    def load_surface(self, name: str) -> None:
        self.loaded.append(name)

    def save_surface(self, name: str, defn: dict[str, Any], *, bindings: dict[str, Any] | None = None, activate: bool = True) -> bool:
        # 本体と結び付けは別の欄で送る(D-117)。確かめやすいよう 1 つの定義に戻して残す
        assert "bindings" not in defn
        self.saved.append((name, {**defn, **({"bindings": bindings} if bindings is not None else {})}, activate))
        return True


def build() -> tuple[SurfaceState, RecordingLink, SurfacePage]:
    state = SurfaceState(AppConfig(unity=UnityTarget("127.0.0.1", 7090, 7091)), link_factory=RecordingLink)
    state._on_frame(surface_frame(definition(PARAMS), name="stage", revision=1))
    return state, state.link, SurfacePage(state)  # type: ignore[return-value]


def moved_down(draft: dict[str, Any]) -> dict[str, Any]:
    """先頭の部品を 1 つ後ろへ動かした作業コピー(ブリッジの moveNode の答えの代わり)。"""
    result = copy.deepcopy(draft)
    children = result["screens"][0]["children"]
    children[0], children[1] = children[1], children[0]
    return result


def move_first_down(state: SurfaceState, link: RecordingLink, page: SurfacePage) -> dict[str, Any]:
    """編集モードで先頭の部品を下へ動かす。命令を送り、ブリッジの答えを返して取り込ませる。"""
    assert page._editor is not None
    page._editor._edit_node("moveNode", (0, (), 0), delta=1)
    request_id, draft, edit = link.edits[-1]
    assert edit == {"op": "moveNode", "ref": {"screen": 0, "steps": [], "index": 0}, "delta": 1}
    assert draft is not None
    answer = moved_down(draft)
    state._on_frame(SurfaceEditedFrame("surfaceEdited", 1, request_id, answer, None))
    page.sync()
    return answer


def button(user: Any, label: str) -> UserInteraction[Any]:
    elements = {e for e in user.find(kind=ui.button).elements if e.text == label}
    assert len(elements) == 1
    return UserInteraction(user, elements, label)


def switch(user: Any, label: str) -> UserInteraction[Any]:
    # 編集モードのスイッチはラベルを持たず aria-label で名乗る(HID-255)
    elements = {
        e for e in user.find(kind=ui.switch).elements if label in (e.text, e.props.get("aria-label"))
    }
    assert len(elements) == 1
    return UserInteraction(user, elements, label)


async def test_production_mode_hides_editing_controls() -> None:
    state, _link, page = build()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")

        assert not [e for e in user.find(kind=ui.button).elements if e.text == "保存"]
        assert page._editor is None


async def test_edit_mode_switch_hit_area_is_only_the_toggle() -> None:
    # HID-255: ラベル文字や行の余白を押しても編集モードに入らないよう、
    # スイッチ自体はラベルを持たず、表示用のラベルは別要素に分ける
    state, _link, page = build()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        await user.should_see("編集モード")

        toggle = page._edit_switch
        assert toggle.text == "" and toggle.props.get("aria-label") == "編集モード"
        row = toggle.parent_slot.parent
        assert "self-start" in row.classes
        assert [type(e) for e in row] == [ui.switch, ui.label]


async def test_edit_mode_moves_a_control_and_saves_the_draft_to_the_bridge() -> None:
    state, link, page = build()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        switch(user, "編集モード").click()
        assert page._editor is not None

        move_first_down(state, link, page)
        page._editor._name_input.value = "stage-b"
        button(user, "保存").click()

        assert len(link.saved) == 1
        name, saved, activate = link.saved[0]
        assert name == "stage-b" and activate is True
        assert [n["param"] for n in saved["screens"][0]["children"]] == ["b", "a"]


async def test_invalid_save_name_is_not_sent() -> None:
    state, link, page = build()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        switch(user, "編集モード").click()
        page._editor._name_input.value = "../evil"
        button(user, "保存").click()

        assert link.saved == []


async def test_saved_draft_adopted_by_bridge_is_not_a_conflict() -> None:
    state, link, page = build()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        switch(user, "編集モード").click()
        move_first_down(state, link, page)
        assert page._editor.session.dirty

        # ブリッジが保存内容を採用して再配信した
        state._on_frame(surface_frame(page._editor.session.draft, name="stage", revision=2))
        page.sync()

        assert not page._editor.session.dirty
        assert not page._editor.session.is_conflicted(state.surface_revision)


async def test_other_terminal_save_while_dirty_is_reported_as_conflict_and_keeps_the_draft() -> None:
    state, link, page = build()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        switch(user, "編集モード").click()
        draft = move_first_down(state, link, page)

        state._on_frame(surface_frame(definition(PARAMS[:1]), name="stage", revision=2))
        page.sync()

        assert page._editor.session.draft == draft
        assert page._editor.session.is_conflicted(state.surface_revision)
        assert "上書き" in page._editor._conflict_label.text


async def test_other_terminal_save_while_clean_is_followed() -> None:
    state, link, page = build()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        switch(user, "編集モード").click()

        newer = definition(PARAMS[:1])
        state._on_frame(surface_frame(newer, name="stage", revision=2))
        page.sync()

        assert page._editor.session.draft == newer


async def test_clean_adoption_of_identical_content_under_another_name_follows_name_and_revision() -> None:
    state, link, page = build()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        switch(user, "編集モード").click()

        # 内容が同一でも、別名の定義が採用されたら保存名と出発点 revision を合わせる
        state._on_frame(surface_frame(definition(PARAMS), name="other", revision=5))
        state._on_frame(SurfaceListFrame(type="surfaceList", names=("stage", "other"), active="other"))
        page.sync()

        session = page._editor.session
        assert session.base_name == "other"
        assert session.base_revision == state.surface_revision
        assert page._editor._name_input.value == "other"


async def test_one_edit_waits_for_its_answer_and_a_rejection_keeps_the_draft() -> None:
    state, link, page = build()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        switch(user, "編集モード").click()
        editor = page._editor
        assert editor is not None
        before = copy.deepcopy(editor.session.draft)

        # 答えを待つ間の命令は送らない(描いた位置が古く、別のノードに当たるため)。保存もしない
        editor._edit_node("moveNode", (0, (), 0), delta=1)
        editor._edit_node("removeNode", (0, (), 0))
        assert len(link.edits) == 1 and editor.session.busy
        await user.should_see("前の変更を反映しています")
        editor._name_input.value = "stage"
        button(user, "保存").click()
        assert link.saved == []
        # 元の値へ戻す操作も「変わっていない」と黙って捨てず、断って知らせる
        before_edits = len(link.edits)
        editor._on_width((0, (), 1), "")
        assert len(link.edits) == before_edits

        # 答えを待つ間は、採用中の定義への追従もしない
        state._on_frame(surface_frame(definition(PARAMS[:1]), name="stage", revision=2))
        page.sync()
        assert editor.session.draft == before

        # 断られたら作業コピーは変えない。答えを待ち終えて未編集なので、待つ間に採用された定義へここで追従する
        state._on_frame(SurfaceEditedFrame("surfaceEdited", 1, link.edits[0][0], None, "対象の部品が見つかりません"))
        page.sync()
        assert not editor.session.busy and not editor.session.dirty
        assert editor.session.draft == state.editable_definition != before
        await user.should_see("変更できません: 対象の部品が見つかりません")

        current = copy.deepcopy(editor.session.draft)
        editor._edit({"op": "removeParameter", "param": "a"})
        assert link.edits[1][1] == current
        after = copy.deepcopy(current)
        after["parameters"] = []
        state._on_frame(SurfaceEditedFrame("surfaceEdited", 1, link.edits[1][0], after, None))
        page.sync()
        assert editor.session.draft == after and not editor.session.busy


async def test_closing_the_editor_forgets_the_pending_edit() -> None:
    state, link, page = build()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        switch(user, "編集モード").click()
        assert page._editor is not None
        page._editor._edit_node("moveNode", (0, (), 0), delta=1)
        request_id = link.edits[-1][0]
        page._close_editor()
        # 閉じた後に届いた答えを state に溜めない
        state._on_frame(SurfaceEditedFrame("surfaceEdited", 1, request_id, definition(PARAMS), None))
        assert state.take_surface_edit(request_id) is None


async def test_upload_replaces_the_draft_through_the_bridge_without_sending_the_draft() -> None:
    state, link, page = build()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        switch(user, "編集モード").click()
        editor = page._editor
        assert editor is not None
        uploaded = {"format": "oscdesk-surface", "version": 1, "name": "Up", "parameters": [], "screens": []}

        class Upload:
            async def read(self) -> bytes:
                import json

                return json.dumps(uploaded).encode()

        class Event:
            file = Upload()

        await editor._on_upload(Event())  # type: ignore[arg-type]
        request_id, draft, edit = link.edits[-1]
        # 版 1 から版 2 への移行も検証もブリッジ(D-123)。作業コピーは送らない
        assert draft is None and edit == {"op": "replace", "definition": uploaded}
        migrated = {**uploaded, "version": 2, "bindings": {"osc": {"parameters": []}}}
        state._on_frame(SurfaceEditedFrame("surfaceEdited", 1, request_id, migrated, None))
        page.sync()
        assert editor.session.draft == migrated
        await user.should_see("アップロードした定義を作業コピーに読み込みました")


def texts(user: Any, kind: type, predicate: Any) -> list[str]:
    return [e.text for e in user.find(kind=kind).elements if predicate(e.text)]


async def test_large_drafts_draw_a_bounded_number_of_rows_and_show_more_on_request(monkeypatch: Any) -> None:
    # HID-405: 1 万個の部品を置いた定義をそのまま描くと、作るのに数十秒・ブラウザが数分固まって保存もできない。
    # 一覧ごとに描く行を区切り、残りは数だけ出して「さらに表示」で増やす
    monkeypatch.setattr(editor_panel, "EDITOR_ROWS_STEP", 5)
    params = [param(f"p{i}", f"/p{i}", "bool") for i in range(12)]
    # p0 を 11 か所に置き、グループ(子 2 つ)を 1 つ足す(ノードは 14 個)。p1〜p11 は未配置
    placements = [control("p0") for _ in range(11)] + [{"kind": "group", "label": "G", "children": [control("p0"), control("p0")]}]
    state = SurfaceState(AppConfig(unity=UnityTarget("127.0.0.1", 7090, 7091)), link_factory=RecordingLink)
    state._on_frame(surface_frame(definition(params, placements), name="stage", revision=1))
    page = SurfacePage(state)

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        switch(user, "編集モード").click()
        editor = page._editor
        assert editor is not None

        assert len(texts(user, ui.button, lambda t: t == "横並び")) == 5  # 画面の部品の行
        assert len(texts(user, ui.button, lambda t: t == "編集")) == 5  # パラメータの行
        assert len(texts(user, ui.button, lambda t: t.endswith(" を置く"))) == 5  # 未配置のパラメータ
        await user.should_see("ほかに 9 件あります")  # 部品の行の残り(グループの子を含む)
        await user.should_see("ほかに 7 件あります")  # パラメータの残り(12 個)
        await user.should_see("ほかに 6 件あります")  # 未配置の残り(p1〜p11)
        assert len(texts(user, ui.button, lambda t: t == "さらに 5 件を表示")) == 3

        editor._show_more("nodes")
        assert len(texts(user, ui.button, lambda t: t == "横並び")) == 10
        await user.should_see("ほかに 4 件あります")
        # 増やした上限は描き直し(編集の答えの取り込み)でも保つ
        editor.refresh()
        assert len(texts(user, ui.button, lambda t: t == "横並び")) == 10

        editor._show_more("nodes")
        assert len(texts(user, ui.button, lambda t: t == "横並び")) == 14
        assert not texts(user, ui.label, lambda t: t.startswith("ほかに 4 件"))


def test_count_nodes_includes_group_and_tab_children() -> None:
    nodes = [
        control("a"),
        {"kind": "group", "label": "G", "children": [control("a"), {"kind": "row", "children": [control("a")]}]},
        {"kind": "tabs", "tabs": [{"label": "T1", "children": [control("a")]}, {"label": "T2", "children": []}]},
    ]
    assert editor_panel.count_nodes(nodes) == 7
