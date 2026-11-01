"""ネットワークのタブ(D-113)。サーバーが使うネットワーク・ターゲットがいる範囲・接続してよいブラウザの範囲を変える。

設定の正はブリッジが持ち、ここは表示キャッシュと入力欄だけ。どのブラウザからでも変えられ、保存すると全ブラウザへ届く。
ターゲット向けのネットワークを変えても、ブラウザ向け(この画面と UI のプロセスの接続)は常にすべてのネットワークで
待ち受けるので、操作しているブラウザの接続は切れない。操作しているブラウザを締め出す許可リストはブリッジが断る。
"""

from __future__ import annotations

import time
from collections.abc import Callable

from nicegui import ui

from .network_access import is_browser_allowed, normalize_address, split_entries
from .notify_history import notify
from .protocol import NETWORK_MAX_ALLOWED_BROWSERS, NETWORK_MAX_TARGET_RANGES, ProtocolError
from .state import SurfaceState

ALL_INTERFACES = ""
ALLOW_ALL = ("0.0.0.0/0", "::/0")
# 変更の応答(networkSettings か拒否の notice)を待つ長さ。ソケットの付け替えを含めても LAN 内なら十分に短い
APPLY_TIMEOUT_S = 10.0

SOURCE_LABELS = {
    "default": "保存していません(既定のまま)",
    "saved": "保存済み",
    "unsaved": "ファイルへ書けなかったため、ブリッジを止めるまでだけ効いています",
}


class NetworkPanel:
    """ページに 1 つ。タブは画面の作り直しのたびに組み直されるので、入力中の値はこのオブジェクトに持つ。"""

    def __init__(self, state: SurfaceState, clock: Callable[[], float] = time.monotonic) -> None:
        self._state = state
        # 操作しているブラウザのアドレス(ページの build で決まる。締め出しの判定にブリッジへ名乗る)
        self._browser = ""
        self._clock = clock
        # 入力中の値。None なら未編集(ブリッジの設定に追従する)
        self._draft: tuple[str, str, str] | None = None
        # 入力を始めたときの設定の版(networkSettings.revision)。保存に添え、編集中にほかのブラウザが保存していれば
        # ブリッジが stale-revision で断る(古い入力で黙って上書きしない)。断られたら今の版に替え、次の保存は確かめた上での上書きにする
        self._draft_base: int | None = None
        # 応答待ち(送った時刻と、送ったときの revision・拒否の回数)
        self._pending: tuple[float, int, int] | None = None
        self._revision = -1
        # 選択欄は ui.select でなくラジオにする(候補はこの PC の NIC の数だけで少なく、一覧を開かずに全部が見える)
        self._interface: ui.radio | None = None
        self._ranges: ui.textarea | None = None
        self._browsers: ui.textarea | None = None
        self._source: ui.label | None = None
        self._warning: ui.label | None = None
        self._apply_button: ui.button | None = None

    def set_browser(self, address: str) -> None:
        self._browser = normalize_address(address) if address else ""

    def build(self) -> None:
        ui.label(
            "OSCDesk のサーバー(ブリッジ)が使うネットワークの設定です。どのブラウザから変えても、すべてのブラウザに反映されます。"
            "許可リストは認証の代わりではありません。信頼できる LAN の中だけで使ってください。"
        ).classes("text-caption text-grey-7")
        ui.label(f"このブラウザ: {self._browser or '不明'}").classes("text-caption")
        self._source = ui.label("").classes("text-caption text-grey-7")

        ui.label("サーバーが使うネットワーク(ターゲット向け)").classes("text-subtitle2 q-mt-md")
        ui.label(
            "Unity との送受信に使うこの PC のアドレスです。ブラウザとの接続は常にすべてのネットワークで受けるので、変えても切れません。"
            "特定のアドレスを選ぶと、同じ PC の Unity が 127.0.0.1 へ返す応答は届かなくなります(同じ PC の Unity だけなら localhost を選びます)。"
        ).classes("text-caption text-grey-7")
        self._interface = ui.radio({ALL_INTERFACES: "すべてのネットワーク"}, value=ALL_INTERFACES, on_change=self._on_edit).props("dense")

        ui.label("ターゲットがいる範囲").classes("text-subtitle2 q-mt-md")
        ui.label(
            "1 行に 1 つ、IPv4 の CIDR(例 192.168.1.0/24)で書きます。空なら自動(この PC のネットワークそのまま)。"
            "送信先パネルの走査と、個別に選べる端末をこの範囲に絞ります。"
        ).classes("text-caption text-grey-7")
        self._ranges = ui.textarea(on_change=self._on_edit).classes("w-full").props(
            'dense outlined autogrow placeholder="自動" aria-label="ターゲットがいる範囲" maxlength=1000'
        )

        ui.label("接続してよいブラウザの範囲").classes("text-subtitle2 q-mt-md")
        ui.label(
            "1 行に 1 つ、CIDR かアドレス(例 192.168.1.0/24、192.168.1.30)で書きます。空ならこの PC の localhost だけ。"
            "この PC の localhost(http://localhost:…)からは、どの設定でも常に接続できます。"
        ).classes("text-caption text-grey-7")
        self._browsers = ui.textarea(on_change=self._on_edit).classes("w-full").props(
            'dense outlined autogrow aria-label="接続してよいブラウザの範囲" maxlength=2000'
        )
        with ui.row().classes("items-center q-gutter-x-sm"):
            ui.button("すべて許可", on_click=self._allow_all).props("flat dense no-caps")
            if self._browser:
                ui.button("このブラウザを足す", on_click=self._add_this_browser).props("flat dense no-caps")
        self._warning = ui.label("").classes("text-caption text-negative")

        with ui.row().classes("items-center q-gutter-x-sm q-mt-md"):
            self._apply_button = ui.button("保存して適用", icon="save", on_click=self._on_apply).props("no-caps")
            ui.button("元に戻す", on_click=self._on_discard).props("flat dense no-caps")
        # 作り直したタブは空なので、次の同期で必ず描く。入力途中の値があれば、作り直した欄へ戻す
        # (戻さないと空の欄のまま「保存して適用」を押せて、許可リストが空(localhost だけ)などの意図しない設定を送るため)
        draft = self._draft
        self._revision = -1
        self.sync()
        if draft is not None:
            self._restore(draft)

    # --- 同期 ---------------------------------------------------------------

    def sync(self) -> None:
        settings = self._state.network_settings
        if self._pending is not None:
            sent_at, revision, rejections = self._pending
            if self._state.network_settings_rejections != rejections:
                # 断られた(理由は通知で出る)。入力は残して直せるようにする
                self._pending = None
                if settings is not None and self._draft is not None:
                    self._draft_base = settings.revision
            elif self._state.network_settings_revision != revision:
                self._pending = None
                self._draft = None
                self._draft_base = None
            elif self._clock() - sent_at > APPLY_TIMEOUT_S:
                self._pending = None
                notify("ネットワークの設定の応答がブリッジから届きませんでした", type="warning")
        if self._interface is None or self._ranges is None or self._browsers is None:
            return
        if self._apply_button is not None:
            enabled = settings is not None and self._pending is None and self._state.link_status.connected
            if self._apply_button.enabled != enabled:
                self._apply_button.set_enabled(enabled)
        if self._revision == self._state.network_settings_revision:
            self._update_warning()
            return
        self._revision = self._state.network_settings_revision
        if settings is None:
            if self._source is not None:
                self._source.text = "ブリッジから設定が届くのを待っています"
            return
        options = {ALL_INTERFACES: "すべてのネットワーク"}
        for choice in settings.interfaces:
            options[choice.address] = f"{choice.name} ({choice.address})"
        current = settings.target_interface or ALL_INTERFACES
        # 今の設定と入力中の値は、候補から消えても選んだまま見せる(消えた値を set_options が拒んで同期が止まらないように)
        for value in (current, str(self._interface.value or ALL_INTERFACES)):
            if value not in options:
                options[value] = value
        self._interface.set_options(options)
        if self._source is not None:
            self._source.text = f"状態: {SOURCE_LABELS.get(settings.source, settings.source)}"
        if self._draft is None:
            self._show((current, "\n".join(settings.target_ranges), "\n".join(settings.allowed_browsers)))
        self._update_warning()

    def _show(self, values: tuple[str, str, str]) -> None:
        assert self._interface is not None and self._ranges is not None and self._browsers is not None
        interface, ranges, browsers = values
        self._interface.value = interface
        self._ranges.value = ranges
        self._browsers.value = browsers
        # 値を入れた on_change で編集中に見えないよう、ここで未編集へ戻す
        self._draft = None
        self._draft_base = None

    def _restore(self, draft: tuple[str, str, str]) -> None:
        assert self._interface is not None and self._ranges is not None and self._browsers is not None
        interface, ranges, browsers = draft
        options = dict(self._interface.options)
        if interface not in options:
            options[interface] = interface
            self._interface.set_options(options)
        self._interface.value = interface
        self._ranges.value = ranges
        self._browsers.value = browsers
        self._draft = draft
        self._update_warning()

    def _current_inputs(self) -> tuple[str, str, str]:
        assert self._interface is not None and self._ranges is not None and self._browsers is not None
        return (str(self._interface.value or ALL_INTERFACES), str(self._ranges.value or ""), str(self._browsers.value or ""))

    def _update_warning(self) -> None:
        if self._warning is None or self._browsers is None:
            return
        text = ""
        if self._browser and not is_browser_allowed(self._browser, split_entries(str(self._browsers.value or ""))):
            text = f"このままではこのブラウザ({self._browser})が範囲の外になるため、ブリッジは保存を断ります。"
        if self._warning.text != text:
            self._warning.text = text

    # --- 操作 ---------------------------------------------------------------

    def _on_edit(self, _event: object = None) -> None:
        settings = self._state.network_settings
        if settings is None or self._interface is None:
            return
        inputs = self._current_inputs()
        saved = (settings.target_interface or ALL_INTERFACES, "\n".join(settings.target_ranges), "\n".join(settings.allowed_browsers))
        self._draft = None if inputs == saved else inputs
        if self._draft is None:
            self._draft_base = None
        elif self._draft_base is None:
            self._draft_base = settings.revision
        self._update_warning()

    def _allow_all(self) -> None:
        if self._browsers is not None:
            self._browsers.value = "\n".join(ALLOW_ALL)

    def _add_this_browser(self) -> None:
        if self._browsers is None or not self._browser:
            return
        entries = split_entries(str(self._browsers.value or ""))
        if self._browser not in entries:
            self._browsers.value = "\n".join([*entries, self._browser])

    def _on_discard(self) -> None:
        settings = self._state.network_settings
        if settings is None or self._interface is None:
            return
        self._show((settings.target_interface or ALL_INTERFACES, "\n".join(settings.target_ranges), "\n".join(settings.allowed_browsers)))
        self._update_warning()

    def _on_apply(self) -> None:
        if self._interface is None:
            return
        allowed = self._state.allowed_browsers
        # 範囲の外になったブラウザ(D-113)からは送らない(読み込み直しの指示に従わない端末が、開いたままの画面から許可リストを戻せないように)
        if allowed is not None and self._browser and not is_browser_allowed(self._browser, allowed):
            notify("このブラウザは接続してよい範囲の外です", type="negative")
            return
        interface, ranges_text, browsers_text = self._current_inputs()
        ranges = split_entries(ranges_text)
        browsers = split_entries(browsers_text)
        if len(ranges) > NETWORK_MAX_TARGET_RANGES:
            notify(f"ターゲットがいる範囲は {NETWORK_MAX_TARGET_RANGES} 件までです", type="negative")
            return
        if len(browsers) > NETWORK_MAX_ALLOWED_BROWSERS:
            notify(f"接続してよいブラウザの範囲は {NETWORK_MAX_ALLOWED_BROWSERS} 件までです", type="negative")
            return
        try:
            sent = self._state.set_network_settings(interface or None, ranges, browsers, self._browser or None, revision=self._draft_base)
        except ProtocolError as error:
            notify(f"ネットワークの設定を送れません: {error}", type="negative")
            return
        if not sent:
            notify("ブリッジに接続していないため保存できませんでした", type="warning")
            return
        self._draft = (interface, ranges_text, browsers_text)
        self._pending = (self._clock(), self._state.network_settings_revision, self._state.network_settings_rejections)
