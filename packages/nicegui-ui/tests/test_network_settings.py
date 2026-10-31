"""ネットワークの設定(D-113)。UI の HTTP の接続元の判定と、networkSettings の表示キャッシュ。"""

from __future__ import annotations

import json
from typing import Any

import pytest
from nicegui import ui
from nicegui.testing import user_simulation

from oscdesk_ui.config import AppConfig
from oscdesk_ui.network_access import (
    BrowserAccessMiddleware,
    is_browser_allowed,
    is_localhost,
    normalize_address,
    split_entries,
)
from oscdesk_ui.protocol import FrameDecodeError, NoticeFrame, decode_frame, encode_network_settings_set
from oscdesk_ui.page import SurfacePage
from oscdesk_ui.state import SurfaceState, describe_network_rejection
from oscdesk_ui.surface_link import LinkStatus

from .surface_fixtures import control, definition, param, surface_frame


def test_localhost_is_always_allowed_even_before_the_list_arrives() -> None:
    for address in ("127.0.0.1", "::1", "::ffff:127.0.0.1"):
        assert is_localhost(address)
        assert is_browser_allowed(address, None)
        assert is_browser_allowed(address, ())
    # ループバックの別アドレスは localhost として扱わない(ブリッジと同じ規則)
    assert not is_localhost("127.0.0.2")
    # 許可リストが届くまでは localhost だけ
    assert not is_browser_allowed("192.168.1.30", None)


def test_matches_cidr_and_single_addresses_like_the_bridge() -> None:
    assert is_browser_allowed("192.168.1.30", ("192.168.1.0/24",))
    assert is_browser_allowed("::ffff:192.168.1.30", ("192.168.1.0/24",))
    assert not is_browser_allowed("192.168.2.30", ("192.168.1.0/24",))
    assert is_browser_allowed("192.168.2.30", ("192.168.2.30/32",))
    assert is_browser_allowed("fe80::5", ("fe80::/10",))
    assert is_browser_allowed("203.0.113.9", ("0.0.0.0/0", "::/0"))
    assert not is_browser_allowed("192.168.1.30", ())
    assert not is_browser_allowed("testclient", ("0.0.0.0/0", "::/0"))
    assert normalize_address("::FFFF:10.0.0.1") == "10.0.0.1"


def test_split_entries_accepts_lines_commas_and_spaces() -> None:
    assert split_entries("192.168.1.0/24\n 10.0.0.5, 10.0.0.5\n\n::/0") == ["192.168.1.0/24", "10.0.0.5", "::/0"]
    assert split_entries("  ") == []


async def _call(middleware: BrowserAccessMiddleware, kind: str, client: tuple[str, int] | None) -> list[dict[str, Any]]:
    sent: list[dict[str, Any]] = []

    async def receive() -> dict[str, Any]:
        return {"type": "http.request"}

    async def send(message: dict[str, Any]) -> None:
        sent.append(dict(message))

    await middleware({"type": kind, "client": client, "path": "/"}, receive, send)
    return sent


async def test_middleware_passes_allowed_peers_and_turns_away_the_others() -> None:
    reached: list[str] = []

    async def app(scope: Any, _receive: Any, _send: Any) -> None:
        reached.append(scope["type"])

    allowed: list[tuple[str, ...] | None] = [None]
    middleware = BrowserAccessMiddleware(app, allowed=lambda: allowed[0])

    # 許可リストの到着前: localhost は通し、他は 503(待ってから読み込み直す)
    assert await _call(middleware, "http", ("127.0.0.1", 5000)) == []
    waiting = await _call(middleware, "http", ("192.168.1.30", 5000))
    assert waiting[0]["status"] == 503

    allowed[0] = ("192.168.1.0/24",)
    assert await _call(middleware, "http", ("192.168.1.30", 5000)) == []
    forbidden = await _call(middleware, "http", ("10.0.0.5", 5000))
    assert forbidden[0]["status"] == 403
    assert "10.0.0.5" in forbidden[1]["body"].decode("utf-8")
    # NiceGUI の画面の更新(socket.io の WebSocket)も同じ規則で断る
    assert await _call(middleware, "websocket", ("10.0.0.5", 5000)) == [{"type": "websocket.close", "code": 1008}]
    assert await _call(middleware, "websocket", ("192.168.1.31", 5000)) == []
    # 接続元の無い要求は localhost ではないので断る。lifespan などは素通し
    assert (await _call(middleware, "http", None))[0]["status"] == 403
    await middleware({"type": "lifespan"}, None, None)  # type: ignore[arg-type]
    assert reached == ["http", "http", "websocket", "lifespan"]


def test_encodes_the_change_with_the_requesting_browser() -> None:
    assert json.loads(encode_network_settings_set("192.168.1.10", ["192.168.1.0/24"], [], "192.168.1.30")) == {
        "v": 1, "type": "networkSettingsSet", "targetInterface": "192.168.1.10",
        "targetRanges": ["192.168.1.0/24"], "allowedBrowsers": [], "browser": "192.168.1.30",
    }
    assert "browser" not in json.loads(encode_network_settings_set(None, [], ["0.0.0.0/0"]))
    with pytest.raises(FrameDecodeError):
        encode_network_settings_set(None, ["10.0.0.0/8"] * 9, [])


def _settings_frame(**overrides: Any) -> str:
    frame = {
        "v": 1, "type": "networkSettings", "targetInterface": None, "targetRanges": [],
        "allowedBrowsers": ["192.168.1.0/24"], "interfaces": [{"address": "127.0.0.1", "name": "localhost"}], "source": "saved",
    }
    frame.update(overrides)
    return json.dumps(frame)


def test_rejects_malformed_network_settings_frames() -> None:
    with pytest.raises(FrameDecodeError):
        decode_frame(_settings_frame(source="nope"))
    with pytest.raises(FrameDecodeError):
        decode_frame(_settings_frame(targetRanges="10.0.0.0/8"))
    with pytest.raises(FrameDecodeError):
        decode_frame(_settings_frame(interfaces=[{"address": "127.0.0.1"}]))


class FakeLink:
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self.network: list[tuple[Any, ...]] = []

    def set_network_settings(self, *args: Any) -> bool:
        self.network.append(args)
        return True


def test_state_keeps_the_latest_settings_and_counts_rejections() -> None:
    state = SurfaceState(AppConfig(), link_factory=FakeLink)
    assert state.allowed_browsers is None
    state._on_frame(decode_frame(_settings_frame()))
    assert state.allowed_browsers == ("192.168.1.0/24",)
    assert state.network_settings_revision == 1

    state._on_frame(NoticeFrame("notice", 1, "error", "network-settings-rejected", "would-lock-out: 192.168.1.30"))
    assert state.network_settings_rejections == 1
    notices = state.notices_since(0)
    assert "192.168.1.30" in notices[-1].message and "接続できなくなります" in notices[-1].message

    assert state.set_network_settings(None, [], ["0.0.0.0/0"], "192.168.1.30")
    assert state.link.network == [(None, [], ["0.0.0.0/0"], "192.168.1.30")]


def test_describes_unknown_rejections_as_they_are() -> None:
    assert describe_network_rejection("something-new") == "something-new"
    assert "203.0.113.1" in describe_network_rejection("invalid-target-interface: 203.0.113.1")


class PageLink(FakeLink):
    def send_osc(self, *args: Any) -> None:
        pass

    def request_surface(self) -> None:
        pass

    def update_heartbeat(self, interval_s: float) -> None:
        pass


async def test_network_tab_shows_the_bridge_settings_and_sends_a_change() -> None:
    state = SurfaceState(AppConfig(), link_factory=PageLink)
    state._on_link_status(LinkStatus(True, "接続済み"))
    state._on_frame(decode_frame(_settings_frame(
        targetRanges=["192.168.1.0/24"],
        interfaces=[{"address": "127.0.0.1", "name": "localhost"}, {"address": "192.168.1.10", "name": "Ethernet"}],
    )))
    page = SurfacePage(state)

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        user.find("ネットワーク").click()
        await user.should_see("サーバーが使うネットワーク(ターゲット向け)")
        await user.should_see("状態: 保存済み")
        radio = next(iter(user.find(kind=ui.radio).elements))
        assert radio.options == {"": "すべてのネットワーク", "127.0.0.1": "localhost (127.0.0.1)", "192.168.1.10": "Ethernet (192.168.1.10)"}
        ranges, browsers = sorted(user.find(kind=ui.textarea).elements, key=lambda element: element.id)
        assert (ranges.value, browsers.value) == ("192.168.1.0/24", "192.168.1.0/24")

        radio.value = "192.168.1.10"
        browsers.value = "192.168.1.0/24\n10.0.0.0/8"
        user.find("保存して適用").click()
        assert state.link.network[-1][:3] == ("192.168.1.10", ["192.168.1.0/24"], ["192.168.1.0/24", "10.0.0.0/8"])

        # 別のブラウザの変更が届いても、応答待ちが終われば新しい設定を見せる
        state._on_frame(decode_frame(_settings_frame(targetInterface="192.168.1.10", allowedBrowsers=["10.0.0.0/8"])))
        page.sync()
        assert browsers.value == "10.0.0.0/8"
        assert radio.value == "192.168.1.10"


async def test_rebuilt_network_tab_keeps_the_unsaved_input() -> None:
    # 編集中に別のブラウザが定義を切り替えると画面ごと作り直される。入力途中の値を空の欄にしない(そのまま保存すると締め出す)
    state = SurfaceState(AppConfig(), link_factory=PageLink)
    state._on_link_status(LinkStatus(True, "接続済み"))
    state._on_frame(decode_frame(_settings_frame(
        interfaces=[{"address": "127.0.0.1", "name": "localhost"}, {"address": "192.168.1.10", "name": "Ethernet"}],
    )))
    page = SurfacePage(state)

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        radio = next(iter(user.find(kind=ui.radio).elements))
        ranges, browsers = sorted(user.find(kind=ui.textarea).elements, key=lambda element: element.id)
        radio.value = "192.168.1.10"
        ranges.value = "192.168.1.0/28"
        browsers.value = "192.168.1.0/24\n10.0.0.0/8"

        state._on_frame(surface_frame(definition([param("level", "/level", "f", range=[0, 1], default=0.5)], [control("level")])))
        page.sync()
        radio = next(iter(user.find(kind=ui.radio).elements))
        ranges, browsers = sorted(user.find(kind=ui.textarea).elements, key=lambda element: element.id)
        assert (radio.value, ranges.value, browsers.value) == ("192.168.1.10", "192.168.1.0/28", "192.168.1.0/24\n10.0.0.0/8")
        user.find("保存して適用").click()
        assert state.link.network[-1][:3] == ("192.168.1.10", ["192.168.1.0/28"], ["192.168.1.0/24", "10.0.0.0/8"])


async def test_a_page_outside_the_allowed_range_is_stopped_on_the_server() -> None:
    state = SurfaceState(AppConfig(), link_factory=PageLink)
    state._on_link_status(LinkStatus(True, "接続済み"))
    state._on_frame(decode_frame(_settings_frame(allowedBrowsers=["0.0.0.0/0"])))
    state._on_frame(surface_frame(definition([param("level", "/level", "f", range=[0, 1], default=0.5)], [control("level")])))
    page = SurfacePage(state)

    async with user_simulation(root=lambda: (page.build(), page.sync())) as user:
        await user.open("/")
        page._browser_address = "10.0.0.5"
        page._network_panel.set_browser("10.0.0.5")
        assert page._permitted()
        binding = page._bindings[0]

        # 別のブラウザが範囲を狭めると、同期を待たずに操作の時点で断り、ページの要素を外す
        state._on_frame(decode_frame(_settings_frame(allowedBrowsers=["192.168.1.0/24"])))
        page._on_local(binding.entry, (0.9,))
        assert page._evicted
        assert not user.client.elements or all(element is user.client.layout for element in user.client.elements.values())
        # 開いたままの画面から許可リストを戻すこともできない
        with user.client:
            page._network_panel._on_apply()
        assert state.link.network == []
