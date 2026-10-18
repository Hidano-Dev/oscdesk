"""宛先タブ(D-078 / D-079)の表示キャッシュと画面。"""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path
from typing import Any

from nicegui import ui
from nicegui.testing import user_simulation

from oscdesk_ui.config import AppConfig, UnityTarget
from oscdesk_ui.destinations_panel import all_devices_label, device_caption, toggled_hosts
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
        self.selected: list[tuple[bool, list[str]]] = []
        self.scans = 0
        self.resets = 0

    def request_surface(self) -> None:
        pass

    def select_destinations(self, all_devices: bool, hosts: Any) -> bool:
        self.selected.append((all_devices, list(hosts)))
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


def test_captions_and_all_devices_label() -> None:
    frame = sample("downstream-destinations")
    captions = [device_caption(device) for device in frame.devices]
    assert captions[0] == "この PC / Ethernet"
    assert captions[1] == "設定の宛先 / aa:bb:cc:dd:ee:14 / Ethernet"
    assert "直近の走査で見つかりません" in captions[3]
    assert all_devices_label(frame) == "全てのデバイス(192.168.1.255)"


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
        user.find("宛先").click()

        boxes = {element.text: element for element in user.find(kind=ui.checkbox).elements}
        assert boxes["192.168.1.20"].value is True and boxes["192.168.1.21"].value is False
        assert all(element.enabled for element in boxes.values())

        user.find("192.168.1.21").click()
        assert link.selected[-1] == (False, ["192.168.1.20", "192.168.1.21", "192.168.1.30"])

        user.find("更新").click()
        assert link.scans == 1

        # 全てのデバイスが選ばれている間は、個別の端末はグレーアウト(選択不可)
        state._on_frame(sample("downstream-destinations-all-devices"))
        page.sync()
        boxes = {element.text: element for element in user.find(kind=ui.checkbox).elements}
        assert boxes["全てのデバイス(192.168.1.255)"].value is True
        assert boxes["192.168.1.10"].enabled is False


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
    defn["screens"][0]["label"] = "宛先"
    state._on_frame(surface_frame(defn))
    state._on_frame(sample("downstream-destinations"))
    page = SurfacePage(state)

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        tabs = user.find(kind=ui.tab).elements
        # ラベルは同じ「宛先」でも、Quasar のタブ名(選択に使う)は画面 id と予約名で別になる
        assert [tab.props["label"] for tab in tabs] == ["宛先", "宛先"]
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
        assert any(box.text == "192.168.1.20" for box in user.find(kind=ui.checkbox).elements)
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
        click("192.168.1.10")
        assert link.selected[-2:] == [
            (False, ["192.168.1.20", "192.168.1.21", "192.168.1.30"]),
            (False, ["192.168.1.10", "192.168.1.20", "192.168.1.21", "192.168.1.30"]),
        ]
        # 選択と関係の無い destinations(走査の完了)では未確定の選択を捨てない
        state._on_frame(replace(base, scanned_at="2026-10-18T10:05:00.000Z"))
        page.sync()
        click("192.168.1.30")
        assert link.selected[-1] == (False, ["192.168.1.10", "192.168.1.20", "192.168.1.21"])

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