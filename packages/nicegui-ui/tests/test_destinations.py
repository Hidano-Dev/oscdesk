"""宛先パネル(D-078 / D-079 / D-085 / D-086)の表示キャッシュと画面。"""

from __future__ import annotations

import json
import time
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest
from nicegui import ui
from nicegui.testing import user_simulation

from oscdesk_ui.config import AppConfig, UnityTarget
from oscdesk_ui.destinations_panel import (
    ALIAS_ENTER_JS,
    alias_from_input,
    alias_key_hint,
    all_devices_label,
    all_devices_tooltip,
    compile_query,
    covering_network,
    device_caption,
    device_name,
    group_devices,
    is_checked,
    match_devices,
    matches_query,
    selection_with,
    selection_without,
    toggled_hosts,
    toggled_networks,
)
from oscdesk_ui.page import SurfacePage
from oscdesk_ui.protocol import DestinationDevice, DestinationsFrame, OscMessage, WireArg, decode_frame, osc_bundle_size
from oscdesk_ui.state import SurfaceState
from oscdesk_ui.surface_link import LinkStatus

from .surface_fixtures import definition, echo_frame, param, surface_frame

SAMPLES = json.loads((Path(__file__).parents[3] / "protocol" / "wire-samples.json").read_text(encoding="utf-8"))["cases"]


def sample(name: str) -> DestinationsFrame:
    frame = next(case["frame"] for case in SAMPLES if case["name"] == name)
    decoded = decode_frame(json.dumps(frame))
    assert isinstance(decoded, DestinationsFrame)
    return decoded


def test_a_lone_surrogate_name_does_not_drop_the_destinations_frame() -> None:
    # 孤立サロゲートは JS では長さ 1 の正しい文字列。数え方が strict だと UnicodeEncodeError でフレームごと捨て、
    # 描画に回すと orjson が符号化できずページの更新が止まる(ブリッジも保存前に断るが、UI 側でも落ちないようにする)
    frame = next(case["frame"] for case in SAMPLES if case["name"] == "downstream-destinations-aliases")
    frame = {**frame, "devices": [{**frame["devices"][0], "alias": "\ud800", "hostname": "pc\udc00"}, *frame["devices"][1:]]}
    decoded = decode_frame(json.dumps(frame))
    assert isinstance(decoded, DestinationsFrame)
    assert decoded.devices[0].alias is None and decoded.devices[0].hostname is None
    assert device_name(decoded.devices[0]) == decoded.devices[0].host
    assert decoded.devices[1].alias == "ステージ左 iPad"


def test_a_wider_overlapping_network_does_not_check_a_device_in_the_narrower_one() -> None:
    # D-093: 重なるときは最も狭い走査ネットワークだけが届く。広い方を選んでも狭い方の端末にはチェックを付けない
    device = DestinationDevice("10.1.2.50", None, None, "LAN", False, False, True, None)
    scanned = ["10.0.0.0/8", "10.1.2.0/24"]
    assert not is_checked(device, (False, ("10.0.0.0/8",), ()), scanned)
    assert is_checked(device, (False, ("10.1.2.0/24",), ()), scanned)
    assert is_checked(device, (True, (), ()), scanned)


def test_a_narrower_network_sharing_the_broadcast_address_is_reached_by_the_wider_one() -> None:
    # 192.168.0.0/16 と 192.168.255.0/24 は同じ 192.168.255.255 へ出るので、/16 を選べば /24 の端末にも届く(ブリッジと同じ規則)
    frame = replace(
        sample("downstream-destinations-networks"),
        broadcasts=(
            replace(sample("downstream-destinations-networks").broadcasts[0], network="192.168.0.0/16", address="192.168.255.255"),
            replace(sample("downstream-destinations-networks").broadcasts[1], network="192.168.255.0/24", address="192.168.255.255"),
        ),
        devices=(DestinationDevice("192.168.255.50", None, None, "LAN", False, False, True, None),),
    )
    scanned = ["192.168.0.0/16", "192.168.255.0/24"]
    device = frame.devices[0]
    assert covering_network(device.host, ["192.168.0.0/16"], scanned) == "192.168.0.0/16"
    assert is_checked(device, (False, ("192.168.0.0/16",), ()), scanned)
    # 狭い /24 だけを選んだとき、/24 の外(/16 だけ)の端末には届かない
    assert covering_network("192.168.1.50", ["192.168.255.0/24"], scanned) is None
    # /16 のネットワーク自体を外すと、共通のブロードキャストで届いていた端末を個別の選択へ展開しない
    assert selection_without(frame, (False, ("192.168.0.0/16",), ()), network_off="192.168.0.0/16") == (False, (), ())
    # 端末のチェックを外すと、届けている /16 も外す(外さないと送り続ける)
    assert selection_without(frame, (False, ("192.168.0.0/16",), ()), hosts_off=[device.host]) == (False, (), ())


def test_alias_input_rejects_lone_surrogates() -> None:
    with pytest.raises(ValueError):
        alias_from_input("卓\ud800")
    assert alias_from_input(" 卓😀 ") == "卓😀"


def test_osc_bundle_size_counts_lone_surrogates_like_the_bridge() -> None:
    # ブリッジは U+FFFD(3 バイト)にして送る。strict だと UnicodeEncodeError でまとめ送りが止まる
    assert osc_bundle_size([OscMessage("/a", (WireArg("s", "\ud800"),))]) == osc_bundle_size([OscMessage("/a", (WireArg("s", "�"),))])


class FakeLink:
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self.selected: list[tuple[bool, list[str], list[str]]] = []
        self.scans = 0
        self.resets = 0
        self.aliases: list[tuple[str, str | None]] = []

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

    def set_destination_alias(self, host: str, alias: str | None) -> bool:
        self.aliases.append((host, alias))
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
    # ブリッジの PC は「サーバー PC」(スマホから開いたときに手元の端末と紛らわしくない。D-094)
    assert captions[0] == "192.168.1.10 / サーバー PC"
    assert captions[1] == "192.168.1.20 / 設定の宛先"
    assert captions[2] == ""
    assert captions[3] == "直近の走査で見つかりません"
    # 送り先のブロードキャストアドレスはマウスオーバー(ツールチップ)だけに出す
    assert all_devices_label(frame) == "全てのデバイス"
    assert all_devices_tooltip(frame) == "送り先: 192.168.1.255"
    assert all_devices_label(frame, filtering=True) == "表示中の全てのデバイス"
    assert all_devices_label(replace(frame, broadcasts=())) == "全てのデバイス(IPv4 のネットワークが見つかりません)"


def test_aliases_take_precedence_over_looked_up_names() -> None:
    frame = sample("downstream-destinations-aliases")
    # 別名(D-092)を見出しにし、引けた名前と IP は補足へ回す
    assert [device_name(device) for device in frame.devices] == ["操作卓", "ステージ左 iPad", "照明卓"]
    assert [device_caption(device) for device in frame.devices] == [
        "control-pc / 192.168.1.10 / サーバー PC",
        "192.168.1.21",
        "light-desk / 192.168.1.30 / 直近の走査で見つかりません",
    ]
    # 別名でも、引けた名前でも探せる
    assert matches_query(frame.devices[1], "ステージ")
    assert matches_query(frame.devices[2], "light")
    assert alias_key_hint(frame.devices[1]).startswith("MAC aa:bb:cc:dd:ee:15 で覚えます")
    assert alias_key_hint(frame.devices[2]).startswith("MAC が分からないため 192.168.1.30 で覚えます")


def test_alias_input_is_trimmed_cleared_when_empty_and_bounded() -> None:
    assert alias_from_input("  照明卓 ") == "照明卓"
    assert alias_from_input("   ") is None
    assert alias_from_input(None) is None
    assert alias_from_input("a" * 64) == "a" * 64
    with pytest.raises(ValueError):
        alias_from_input("a" * 65)
    with pytest.raises(ValueError):
        alias_from_input("a\tb")
    # ブリッジと同じく UTF-16 の単位で数える(絵文字は 2)
    assert alias_from_input("😀" * 32) == "😀" * 32
    with pytest.raises(ValueError):
        alias_from_input("😀" * 32 + "a")


def test_enter_in_the_alias_input_ignores_ime_composition() -> None:
    # 日本語 IME の変換確定の Enter(isComposing、Safari は keyCode 229)では決定しない
    assert "isComposing" in ALIAS_ENTER_JS and "229" in ALIAS_ENTER_JS and "'Enter'" in ALIAS_ENTER_JS


async def test_rename_button_sends_the_alias_and_keeps_the_display_until_the_bridge_answers() -> None:
    state = make_state()
    state._on_frame(sample("downstream-destinations"))
    page = SurfacePage(state)
    link: FakeLink = state.link  # type: ignore[assignment]

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        panel = page._destinations_panel
        device = sample("downstream-destinations").devices[2]
        panel._open_alias_editor(device)
        assert panel._alias_input.value == ""
        assert panel._alias_hint.text.startswith("MAC aa:bb:cc:dd:ee:15")
        panel._alias_input.value = " ステージ左 iPad "
        panel._on_alias_save()
        assert link.aliases == [("192.168.1.21", "ステージ左 iPad")]
        # 表示はブリッジの destinations で変わる(手元では変えない)。確認が来るまでダイアログは開いたまま
        page.sync()
        assert "ステージ左 iPad" not in {element.text for element in user.find(kind=ui.checkbox).elements}
        assert panel._alias_dialog.value is True and panel._alias_pending is not None
        # 断られたら入力を残したまま待つのをやめる(直して送り直せる)
        state._on_frame(decode_frame('{"v":1,"type":"notice","level":"error","code":"destination-alias-rejected","detail":"alias-too-long"}'))
        panel.sync()
        assert panel._alias_pending is None and panel._alias_dialog.value is True
        assert panel._alias_input.value == " ステージ左 iPad "
        panel._on_alias_save()
        base = sample("downstream-destinations")
        named = tuple(replace(item, alias="ステージ左 iPad") if item.host == device.host else item for item in base.devices)
        state._on_frame(replace(base, devices=named))
        # 通知のトーストを出さないよう、宛先パネルだけを同期する
        panel.sync()
        assert "ステージ左 iPad" in {element.text for element in user.find(kind=ui.checkbox).elements}
        # 送った名前が届いたら閉じる
        assert panel._alias_dialog.value is False and panel._alias_pending is None
        # 名前を消す
        panel._open_alias_editor(replace(device, alias="ステージ左 iPad"))
        assert panel._alias_input.value == "ステージ左 iPad"
        panel._on_alias_clear()
        assert link.aliases[-1] == ("192.168.1.21", None)
        # 鉛筆ボタンが端末の行ごとにある
        edit_buttons = [button for button in user.find(kind=ui.button).elements if button.props.get("icon") == "edit"]
        assert len(edit_buttons) == len(sample("downstream-destinations").devices)


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


def test_unchecking_a_child_of_a_chosen_parent_expands_the_rest_into_individual_hosts() -> None:
    frame = sample("downstream-destinations-networks")
    # 一覧の並び: 10.0.0.5(この PC)・10.0.0.40 / 192.168.1.10(この PC)・192.168.1.20(設定の宛先)
    stage = replace(frame.devices[1], host="stage-pc", hostname=None)
    frame = replace(frame, devices=(*frame.devices, stage))
    everyone = (True, (), ("192.168.1.20",))
    # 全てのデバイスの間に 1 台を外すと、全てのデバイスとその端末のネットワークを外し、残りの端末は届き方を保つ
    # (ほかのネットワークは残し、どこにも入らない宛先は個別の選択へ)
    assert selection_without(frame, everyone, hosts_off=["10.0.0.40"]) == (False, ("192.168.1.0/24",), ("192.168.1.20", "stage-pc"))
    # ネットワークそのものを外すと、その中の端末は個別に選んでいたものだけが残る
    assert selection_without(frame, everyone, network_off="192.168.1.0/24") == (False, ("10.0.0.0/24",), ("192.168.1.20", "stage-pc"))
    # ネットワークで届いていたこの PC を外すと、そのネットワークを外す(別のネットワークのこの PC のアドレスは、
    # そのネットワークを選んでいたわけではないので個別の選択へ足さない)
    chosen = (False, ("192.168.1.0/24",), ("192.168.1.20", "10.0.0.40"))
    assert selection_without(frame, chosen, hosts_off=["192.168.1.10"]) == (False, (), ("10.0.0.40", "192.168.1.20"))
    # 個別に選んだ端末を外すだけなら親は変えない
    assert selection_without(frame, chosen, hosts_off=["10.0.0.40"]) == (False, ("192.168.1.0/24",), ("192.168.1.20",))
    # 設定の宛先を外すときもそのネットワークを外す(同じポートならブロードキャストで届き続けるため。PR #77 の指摘)
    # (この PC はもう一方のネットワークのブロードキャストで届くので個別には足さない)
    assert selection_without(frame, everyone, hosts_off=["192.168.1.20"]) == (False, ("10.0.0.0/24",), ("stage-pc",))
    assert selection_without(frame, chosen, hosts_off=["192.168.1.20"]) == (False, (), ("10.0.0.40", "192.168.1.10"))
    # 表示中の端末をまとめて足す(一覧 frame.devices の並びに揃える)
    assert selection_with(frame, (False, (), ("10.0.0.40",)), ["192.168.1.20", "10.0.0.5"]) == (
        False, (), ("10.0.0.5", "10.0.0.40", "192.168.1.20")
    )


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


async def test_tab_sends_selection_and_checks_every_child_for_all_devices() -> None:
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

        # 全てのデバイスが選ばれている間は、子の項目すべてにチェックを付けて見せ、操作も無効にしない(D-089)
        all_devices = replace(sample("downstream-destinations"), all_devices=True, hosts=("192.168.1.20",))
        state._on_frame(all_devices)
        # 先のクリックの応答待ちの選択は、他の画面の変更が勝ったものとして捨てる(上限の時間の経過と同じ)
        page._destinations_panel._pending = None
        page.sync()
        boxes = {element.text: element for element in user.find(kind=ui.checkbox).elements}
        assert boxes["全てのデバイス"].value is True
        assert all(box.value is True and box.enabled for box in boxes.values())
        # 子を 1 台外すと、全てのデバイスとそのネットワークを外し、残りを個別の選択へ展開する
        user.find(kind=ui.checkbox, content="192.168.1.21").click()
        assert link.selected[-1] == (False, [], ["192.168.1.10", "192.168.1.20", "192.168.1.30"])


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
        assert [tab.props["label"] for tab in tabs] == ["OSC パッド", "OSC パッド", "設計図", "再送", "ネットワーク"]
        names = {tab.props["name"] for tab in tabs}
        assert names == {"main", "__extra:0", "__extra:1", "__extra:2", "__extra:3"}
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


async def test_network_checkbox_sends_networks_and_checks_the_devices_it_covers() -> None:
    state = make_state()
    state._on_frame(sample("downstream-destinations-networks"))
    page = SurfacePage(state)
    link: FakeLink = state.link  # type: ignore[assignment]

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        boxes = {element.text: element for element in user.find(kind=ui.checkbox).elements}
        network_boxes = network_checkboxes(user)
        assert [box.value for box in network_boxes] == [True, False]
        # 選んだネットワークの端末はブロードキャストで届くのでチェックを付けて見せる(操作もできる)
        # この PC は 2 つのネットワークに 1 台ずつ(どちらも名前は control-pc)。ブロードキャストは自分にも届くので、
        # 選んでいないネットワーク側のアドレス(10.0.0.5)にもチェックが付く
        this_pc = [e for e in user.find(kind=ui.checkbox).elements if e.text == "control-pc"]
        assert len(this_pc) == 2 and all(box.value and box.enabled for box in this_pc)
        assert boxes["venue-mac.local"].enabled is True
        # 設定の宛先はポートが違うとブロードキャストで届かないので、ネットワークの中でも個別の選択のまま(判定はブリッジ)
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


async def test_search_hides_devices_that_do_not_match_and_selects_only_the_visible_ones() -> None:
    state = make_state()
    state._on_frame(sample("downstream-destinations"))
    page = SurfacePage(state)
    link: FakeLink = state.link  # type: ignore[assignment]

    def boxes() -> dict[str, Any]:
        return {element.text: element for element in user.find(kind=ui.checkbox).elements}

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        panel = page._destinations_panel
        assert panel is not None
        panel._search.value = "unity"
        # 一致しない端末は隠す。絞り込んでいる間の全てのデバイスは「表示中の全てのデバイス」になる
        assert set(boxes()) == {"表示中の全てのデバイス", "このネットワークの表示中のデバイス", "unity-main"}
        assert boxes()["表示中の全てのデバイス"].value is True
        # 画面を作り直しても検索の文字列は残る
        state._on_frame(surface_frame(definition([param("level", "/level", "f", range=[0, 1], default=0.5)])))
        page.sync()
        assert page._destinations_panel._search.value == "unity"
        panel._search.value = ""
        assert {"全てのデバイス", "control-pc", "192.168.1.21"} <= set(boxes())
        # 正規表現で IP を絞る。表示中の全てのデバイスは、表示中の端末だけを個別に選ぶ(隠れた選択は残す)
        panel._search.value = r"\.(10|2\d)$"
        assert "192.168.1.30" not in boxes()
        assert boxes()["表示中の全てのデバイス"].value is False
        boxes()["表示中の全てのデバイス"].value = True
        assert link.selected[-1] == (False, [], ["192.168.1.10", "192.168.1.20", "192.168.1.21", "192.168.1.30"])
        state._on_frame(replace(sample("downstream-destinations"), hosts=tuple(link.selected[-1][2])))
        page.sync()
        boxes()["表示中の全てのデバイス"].value = False
        assert link.selected[-1] == (False, [], ["192.168.1.30"])
        assert panel._query_hint.visible is False
        panel._search.value = "192.168.("
        assert panel._query_hint.visible is True
        await user.should_see("正規表現として読めないため、文字どおりに探しています")
