"""宛先パネル(D-078 / D-079 / D-085 / D-086)の表示キャッシュと画面。"""

from __future__ import annotations

import json
import time
from dataclasses import replace
from pathlib import Path
from typing import Any

from nicegui import ui
from nicegui.testing import user_simulation

from oscdesk_ui.config import AppConfig, UnityTarget
from oscdesk_ui.destinations_panel import (
    all_devices_label,
    compile_query,
    covering_network,
    device_caption,
    device_name,
    group_devices,
    match_devices,
    matches_query,
    toggled_hosts,
    toggled_networks,
)
from oscdesk_ui.page import SurfacePage
from oscdesk_ui.protocol import DestinationsFrame, decode_frame
from oscdesk_ui.state import SurfaceState
from oscdesk_ui.surface_link import LinkStatus

from .surface_fixtures import definition, echo_frame, param, surface_frame

SAMPLES = json.loads((Path(__file__).parents[3] / "protocol" / "wire-samples.json").read_text(encoding="utf-8"))["cases"]


def sample(name: str) -> DestinationsFrame:
    frame = next(case["frame"] for case in SAMPLES if case["name"] == name)
    decoded = decode_frame(json.dumps(frame))
    assert isinstance(decoded, DestinationsFrame)
    return decoded


class FakeLink:
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self.selected: list[tuple[bool, list[str], list[str]]] = []
        self.scans = 0
        self.resets = 0

    def request_surface(self) -> None:
        pass

    def select_destinations(self, all_devices: bool, networks: Any, hosts: Any) -> bool:
        self.selected.append((all_devices, list(networks), list(hosts)))
        return True

    def request_destinations_scan(self) -> bool:
        self.scans += 1
        return True

    def reset_destinations(self) -> bool:
        self.resets += 1
        return True


def make_state() -> SurfaceState:
    state = SurfaceState(AppConfig(unity=UnityTarget("127.0.0.1", 7090, 7090)), link_factory=FakeLink)
    state._on_link_status(LinkStatus(connected=True, detail="接続中"))
    return state


def test_toggled_hosts_follow_the_list_order_and_keep_unlisted_hosts() -> None:
    order = ["192.168.1.10", "192.168.1.20", "192.168.1.30"]
    assert toggled_hosts(["192.168.1.30", "stage-pc"], "192.168.1.10", True, order) == ["192.168.1.10", "192.168.1.30", "stage-pc"]
    assert toggled_hosts(["192.168.1.10", "192.168.1.30"], "192.168.1.10", False, order) == ["192.168.1.30"]


def test_names_captions_and_all_devices_label() -> None:
    frame = sample("downstream-destinations")
    # 名前が引けた端末は名前を見出しにし、IP は補足へ回す。MAC は出さない
    assert [device_name(device) for device in frame.devices] == ["control-pc", "unity-main", "192.168.1.21", "192.168.1.30"]
    captions = [device_caption(device) for device in frame.devices]
    assert captions[0] == "192.168.1.10 / この PC"
    assert captions[1] == "192.168.1.20 / 設定の宛先"
    assert captions[2] == ""
    assert captions[3] == "直近の走査で見つかりません"
    assert all_devices_label(frame) == "全てのデバイス(192.168.1.255)"


def test_search_matches_name_ip_mac_and_interface() -> None:
    device = sample("downstream-destinations").devices[1]
    assert all(matches_query(device, query) for query in ("", "  ", "UNITY", "1.20", "ee:14", "ether"))
    assert not matches_query(device, "control")


def test_search_reads_the_query_as_a_regular_expression() -> None:
    device = sample("downstream-destinations").devices[1]
    # IP を正規表現で絞る(D-086)。範囲・選択肢・先頭と末尾の固定が効き、大文字小文字は区別しない
    assert all(matches_query(device, query) for query in (r"^192\.168\.1\.2\d$", r"\.(10|20)$", "^unity-", "Unity-M.*"))
    assert not any(matches_query(device, query) for query in (r"^192\.168\.1\.1\d$", r"\.21$", "^main"))
    # 正規表現として読めない入力(打っている途中など)は文字どおりの部分一致に落とす
    assert compile_query("192.168.(") is None
    assert not matches_query(device, "192.168.(")
    assert matches_query(replace(device, hostname="stage(a)"), "stage(")


def test_a_catastrophic_regex_is_cut_off_and_falls_back_to_a_literal_match() -> None:
    frame = sample("downstream-destinations")
    slow = replace(frame.devices[1], hostname="a" * 40 + "!")
    # バックトラックの爆発する式でもイベントループを止めない(打ち切らなければこの名前で何秒もかかる)
    started = time.monotonic()
    result = match_devices((*frame.devices, slow), r"^(a|aa)+$", budget_s=0.05)
    assert time.monotonic() - started < 1.0
    # 打ち切ったら、打ち切る前に照合した端末も含めて全端末を文字どおりの部分一致で探し直す
    assert result.fallback == "slow" and result.matched == (False,) * (len(frame.devices) + 1)
    assert match_devices(frame.devices, "192.168.(").fallback == "invalid"
    assert match_devices(frame.devices, r"^unity-").fallback is None


def test_the_regex_budget_counts_only_the_time_spent_matching() -> None:
    devices = sample("downstream-destinations").devices
    # 1 台の照合に 5ms、照合の合間(部品を作るなど)に 100ms かかったとする。合間は数えないので、4 台で 20ms は上限の 50ms に収まる
    ticks = iter(value for i in range(len(devices)) for value in (i * 0.105, i * 0.105 + 0.005))
    result = match_devices(devices, r"^192\.", budget_s=0.05, clock=lambda: next(ticks))
    assert result.fallback is None
    assert result.matched == (True, True, True, True)


def test_devices_are_grouped_by_network() -> None:
    frame = sample("downstream-destinations-networks")
    groups = group_devices(frame)
    assert [(group.broadcast.network if group.broadcast else None, [d.host for d in group.devices]) for group in groups] == [
        ("192.168.1.0/24", ["192.168.1.10", "192.168.1.20"]),
        ("10.0.0.0/24", ["10.0.0.5", "10.0.0.40"]),
    ]
    # どのネットワークにも入らない宛先(設定のホスト名など)は最後にまとめる
    stage = replace(frame.devices[0], host="stage-pc", hostname=None)
    assert group_devices(replace(frame, devices=(*frame.devices, stage)))[-1].devices == (stage,)
    assert covering_network("192.168.1.20", frame.networks) == "192.168.1.0/24"
    assert covering_network("10.0.0.40", frame.networks) is None
    # 重なるネットワークでは最も狭いものだけが届く(HID-325)
    assert covering_network("10.1.2.50", ["10.0.0.0/8"], ["10.0.0.0/8", "10.1.2.0/24"]) is None
    assert covering_network("10.1.2.50", ["10.0.0.0/8", "10.1.2.0/24"], ["10.0.0.0/8", "10.1.2.0/24"]) == "10.1.2.0/24"
    assert covering_network("10.9.9.9", ["10.0.0.0/8"], ["10.0.0.0/8", "10.1.2.0/24"]) == "10.0.0.0/8"
    order = ["192.168.1.0/24", "10.0.0.0/24"]
    assert toggled_networks(["10.0.0.0/24"], "192.168.1.0/24", True, order) == order
    assert toggled_networks(order, "192.168.1.0/24", False, order) == ["10.0.0.0/24"]


def test_destinations_follow_the_primary_and_accept_echoes_from_broadcast_responders() -> None:
    state = make_state()
    state._on_frame(surface_frame(definition([param("level", "/level", "f", range=[0, 1], default=0.5)])))
    revision = state.destinations_revision

    state._on_frame(sample("downstream-destinations"))
    assert state.destinations_revision == revision + 1
    assert state.config.unity is not None and state.config.unity.host == "192.168.1.20"

    # 全てのデバイスの主系はブロードキャストアドレスで、エコーは pong を返した各ホストから届く
    state._on_frame(sample("downstream-destinations-all-devices"))
    state._on_frame(echo_frame("/level", ("f", 0.25), host="192.168.1.21"))
    assert state.values.get("/level") is not None and state.values.get("/level").values == (0.25,)
    # pong を返していないホスト(OSC ネイティブ UI の端末など)の値は表示に入れない
    state._on_frame(echo_frame("/level", ("f", 0.75), host="192.168.1.99"))
    assert state.values.get("/level").values == (0.25,)


def test_rejection_and_scan_failure_become_notices() -> None:
    state = make_state()
    state._on_frame(decode_frame('{"v":1,"type":"notice","level":"error","code":"destinations-rejected","detail":"empty-selection"}'))
    state._on_frame(decode_frame('{"v":1,"type":"notice","level":"warn","code":"destinations-scan-failed","detail":"timed out"}'))
    state._on_frame(decode_frame('{"v":1,"type":"notice","level":"error","code":"destinations-save-failed","detail":"could not write"}'))
    assert [notice.message for notice in state.notices_since(0)] == [
        "宛先を変更できません: empty-selection",
        "ネットワークの走査に失敗しました: timed out",
        "宛先の選択を保存できませんでした: could not write",
    ]
    assert [notice.level for notice in state.notices_since(0)][-1] == "error"
    assert sample("downstream-destinations-unsaved").source == "unsaved"


async def test_tab_requests_a_scan_once_when_the_bridge_has_not_scanned_yet() -> None:
    state = make_state()
    state._on_frame(replace(sample("downstream-destinations"), scanned_at=None))
    page = SurfacePage(state)
    link: FakeLink = state.link  # type: ignore[assignment]

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        page.sync()
        assert link.scans == 1


async def test_tab_sends_selection_and_greys_out_devices_for_all_devices() -> None:
    state = make_state()
    state._on_frame(sample("downstream-destinations"))
    page = SurfacePage(state)
    link: FakeLink = state.link  # type: ignore[assignment]

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        # 宛先はタブを開かなくても右側のパネルに出ている(D-086)
        assert not [tab for tab in user.find(kind=ui.tab).elements if tab.props.get("label") == "宛先"]

        boxes = {element.text: element for element in user.find(kind=ui.checkbox).elements}
        assert boxes["unity-main"].value is True and boxes["192.168.1.21"].value is False
        assert all(element.enabled for element in boxes.values())

        user.find(kind=ui.checkbox, content="192.168.1.21").click()
        assert link.selected[-1] == (False, [], ["192.168.1.20", "192.168.1.21", "192.168.1.30"])

        user.find("更新").click()
        assert link.scans == 1

        # 全てのデバイスが選ばれている間は、個別の端末はグレーアウト(選択不可)
        state._on_frame(sample("downstream-destinations-all-devices"))
        page.sync()
        boxes = {element.text: element for element in user.find(kind=ui.checkbox).elements}
        assert boxes["全てのデバイス(192.168.1.255)"].value is True
        assert boxes["control-pc"].enabled is False
        assert boxes["このネットワークの全てのデバイス(192.168.1.255)"].enabled is False


async def test_tab_requests_a_scan_again_after_reconnecting_to_a_restarted_bridge() -> None:
    state = make_state()
    unscanned = replace(sample("downstream-destinations"), scanned_at=None)
    state._on_frame(unscanned)
    page = SurfacePage(state)
    link: FakeLink = state.link  # type: ignore[assignment]

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        page.sync()
        assert link.scans == 1
        # 切断して、再起動した(未走査の)ブリッジへつなぎ直す
        state._on_link_status(LinkStatus(connected=False, detail="切断"))
        page.sync()
        state._on_link_status(LinkStatus(connected=True, detail="接続中"))
        state._on_frame(unscanned)
        page.sync()
        assert link.scans == 2


async def test_a_screen_labelled_like_an_app_tab_keeps_both_tabs_reachable() -> None:
    state = make_state()
    defn = definition([param("level", "/level", "f", range=[0, 1], default=0.5)])
    defn["screens"][0]["label"] = "OSC パッド"
    state._on_frame(surface_frame(defn))
    state._on_frame(sample("downstream-destinations"))
    page = SurfacePage(state)

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        tabs = sorted(user.find(kind=ui.tab).elements, key=lambda element: element.id)
        # ラベルは同じでも、Quasar のタブ名(選択に使う)は画面 id と予約名で別になる
        assert [tab.props["label"] for tab in tabs] == ["OSC パッド", "OSC パッド"]
        names = {tab.props["name"] for tab in tabs}
        assert names == {"main", "__extra:0"}
        panels = user.find(kind=ui.tab_panels).elements
        # value はタブの要素か名前で持たれる(NiceGUI の版による)ので名前にそろえて見る
        name_of = lambda value: value.props["name"] if hasattr(value, "props") else value  # noqa: E731
        (switcher,) = [panel for panel in panels if name_of(panel.value) in names]
        panel_names = {panel.props["name"] for panel in user.find(kind=ui.tab_panel).elements}
        assert names <= panel_names
        for name in names:
            switcher.value = name
            assert name_of(switcher.value) == name
        # 宛先タブの中身(端末のチェックボックス)と画面の部品(スライダー)の両方が作られている
        assert any(box.text == "unity-main" for box in user.find(kind=ui.checkbox).elements)
        assert user.find(kind=ui.slider).elements


async def test_quick_successive_toggles_build_on_the_selection_still_awaiting_the_bridge() -> None:
    state = make_state()
    base = sample("downstream-destinations")
    state._on_frame(base)
    clock = [100.0]
    page = SurfacePage(state)
    link: FakeLink = state.link  # type: ignore[assignment]

    def click(host: str) -> None:
        # 「いま送っている宛先」の文字にも同じ IP が出るので、チェックボックスに絞る
        user.find(kind=ui.checkbox, content=host).click()

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        panel = page._destinations_panel
        assert panel is not None
        panel._clock = lambda: clock[0]
        # ブリッジの応答が届く前に 2 台を続けて付ける。後の送信が先の変更を消さない
        click("192.168.1.21")
        click("control-pc")
        assert link.selected[-2:] == [
            (False, [], ["192.168.1.20", "192.168.1.21", "192.168.1.30"]),
            (False, [], ["192.168.1.10", "192.168.1.20", "192.168.1.21", "192.168.1.30"]),
        ]
        # 選択と関係の無い destinations(走査の完了)では未確定の選択を捨てない
        state._on_frame(replace(base, scanned_at="2026-10-18T10:05:00.000Z"))
        page.sync()
        click("192.168.1.30")
        assert link.selected[-1] == (False, [], ["192.168.1.10", "192.168.1.20", "192.168.1.21"])

        # 届いた選択が未確定の選択に一致したら捨て、以後は届いた選択に従う
        state._on_frame(replace(base, hosts=("192.168.1.10", "192.168.1.20", "192.168.1.21")))
        page.sync()
        assert panel._pending is None

        # ブリッジが断ったら捨てる(以降は通知のトーストを出さないよう、宛先タブだけを同期する)
        click("192.168.1.21")
        assert panel._pending is not None
        state._on_frame(decode_frame('{"v":1,"type":"notice","level":"error","code":"destinations-rejected","detail":"invalid-host: x"}'))
        panel.sync()
        assert panel._pending is None

        # 応答が来ないまま上限の時間が過ぎたら捨てる(他の画面の変更が後から勝った場合)
        click("192.168.1.21")
        assert panel._pending is not None
        clock[0] += 10
        panel.sync()
        assert panel._pending is None

        # 切断したら捨てる
        click("192.168.1.21")
        state._on_link_status(LinkStatus(connected=False, detail="切断"))
        panel.sync()
        assert panel._pending is None


async def test_pending_selection_survives_a_redelivered_definition() -> None:
    state = make_state()
    state._on_frame(sample("downstream-destinations"))
    page = SurfacePage(state)
    link: FakeLink = state.link  # type: ignore[assignment]
    defn = definition([param("level", "/level", "f", range=[0, 1], default=0.5)])

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        panel = page._destinations_panel
        user.find(kind=ui.checkbox, content="192.168.1.21").click()
        # 応答待ちの間に定義が(再)配信され、画面が作り直される
        state._on_frame(surface_frame(defn, revision=1))
        page.sync()
        state._on_frame(surface_frame(defn, revision=2))
        page.sync()
        # 宛先タブはページに 1 つのまま描き直され、未確定の選択を持ち越す
        assert page._destinations_panel is panel
        user.find(kind=ui.checkbox, content="control-pc").click()
        assert link.selected[-2:] == [
            (False, [], ["192.168.1.20", "192.168.1.21", "192.168.1.30"]),
            (False, [], ["192.168.1.10", "192.168.1.20", "192.168.1.21", "192.168.1.30"]),
        ]

def network_checkboxes(user: Any) -> list[Any]:
    # find は集合で返るので、作った順(一覧の並び = broadcasts の順)に並べ直す
    boxes = [element for element in user.find(kind=ui.checkbox).elements if element.text.startswith("このネットワーク")]
    return sorted(boxes, key=lambda element: element.id)


async def test_network_checkbox_sends_networks_and_greys_out_the_devices_it_covers() -> None:
    state = make_state()
    state._on_frame(sample("downstream-destinations-networks"))
    page = SurfacePage(state)
    link: FakeLink = state.link  # type: ignore[assignment]

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        boxes = {element.text: element for element in user.find(kind=ui.checkbox).elements}
        network_boxes = network_checkboxes(user)
        assert [box.value for box in network_boxes] == [True, False]
        # 選んだネットワークの端末はブロードキャストで届くのでグレーアウトし、他のネットワークの端末は選べる
        # この PC は 2 つのネットワークに 1 台ずつ(どちらも名前は control-pc)。ブロードキャストは自分にも届くので、
        # 選んでいないネットワーク側のアドレス(10.0.0.5)もグレーアウトする
        this_pc = [e for e in user.find(kind=ui.checkbox).elements if e.text == "control-pc"]
        assert len(this_pc) == 2 and not any(box.enabled for box in this_pc)
        assert boxes["venue-mac.local"].enabled is True
        # 設定の宛先はポートが違うとブロードキャストで届かないので、ネットワークの中でも選べるままにする(判定はブリッジ)
        assert boxes["unity-main"].enabled is True
        network_boxes[1].value = True
        assert link.selected[-1] == (False, ["192.168.1.0/24", "10.0.0.0/24"], ["192.168.1.20", "10.0.0.40"])


async def test_unchecking_the_last_network_without_hosts_falls_back_to_the_config_targets() -> None:
    state = make_state()
    frame = sample("downstream-destinations-networks")
    state._on_frame(replace(frame, hosts=()))
    page = SurfacePage(state)
    link: FakeLink = state.link  # type: ignore[assignment]

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        (first, _second) = network_checkboxes(user)
        first.value = False
        assert link.selected == [] and link.resets == 1


async def test_search_dims_and_disables_devices_that_do_not_match() -> None:
    state = make_state()
    state._on_frame(sample("downstream-destinations"))
    page = SurfacePage(state)

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        panel = page._destinations_panel
        assert panel is not None
        panel._search.value = "unity"
        boxes = {element.text: element for element in user.find(kind=ui.checkbox).elements}
        assert boxes["unity-main"].enabled is True
        assert boxes["control-pc"].enabled is False and boxes["192.168.1.21"].enabled is False
        # 一致しない端末も選択は保つ(チェックは付いたまま)
        assert boxes["192.168.1.30"].value is True and boxes["192.168.1.30"].enabled is False
        # 画面を作り直しても検索の文字列は残る
        state._on_frame(surface_frame(definition([param("level", "/level", "f", range=[0, 1], default=0.5)])))
        page.sync()
        assert page._destinations_panel._search.value == "unity"
        panel._search.value = ""
        boxes = {element.text: element for element in user.find(kind=ui.checkbox).elements}
        assert boxes["control-pc"].enabled is True
        # 正規表現で IP を絞る。読めない間は文字どおりに探していることを出す
        panel._search.value = r"\.(10|20)$"
        boxes = {element.text: element for element in user.find(kind=ui.checkbox).elements}
        assert boxes["control-pc"].enabled is True and boxes["unity-main"].enabled is True
        assert boxes["192.168.1.21"].enabled is False
        assert panel._query_hint.visible is False
        panel._search.value = "192.168.("
        assert panel._query_hint.visible is True
        await user.should_see("正規表現として読めないため、文字どおりに探しています")
