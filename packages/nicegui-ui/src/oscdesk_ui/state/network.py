"""宛先タブ(D-078)とネットワークの設定(D-113)。"""

from __future__ import annotations

from dataclasses import replace
from typing import Sequence

from ..config import UnityTarget
from ..protocol import DestinationsFrame, NetworkSettingsFrame


def describe_network_rejection(detail: str) -> str:
    """network-settings-rejected の理由(D-113)を画面向けの文にする。知らない理由はそのまま見せる。"""
    reason, _, value = detail.partition(": ")
    messages = {
        "would-lock-out": "この変更をすると、操作しているブラウザ({value})が接続できなくなります",
        "invalid-target-interface": "{value} はこの PC のアドレスではありません",
        "invalid-target-range": "ターゲットがいる範囲「{value}」は IPv4 の CIDR(例 192.168.1.0/24)ではありません",
        "invalid-allowed-browser": "接続してよい範囲「{value}」は CIDR かアドレスではありません",
        "rebind-failed": "ターゲット向けのネットワークで待ち受けられませんでした({value})",
        "stale-revision": "ほかのブラウザが先に設定を変えました。今の設定を確かめてから、もう一度保存してください",
        "not-allowed": "このブラウザ({value})は接続してよい範囲の外です",
    }
    template = messages.get(reason)
    return detail if template is None else template.format(value=value)


class NetworkMixin:
    """宛先とネットワークの設定の表示キャッシュと変更の要求。

    状態(属性)はすべて SurfaceState.__init__ が持つ。ここは振る舞いだけで、UI 要素には触れない(D-021)。
    """

    @property
    def destinations(self) -> DestinationsFrame | None:
        """宛先タブ(D-078)の最新の全量。ブリッジから届くまでは None。"""
        return self._destinations

    @property
    def destinations_revision(self) -> int:
        """destinations が届くたびに増える(宛先タブはこれを見て一覧を作り直す)。"""
        return self._destinations_revision

    @property
    def destinations_rejections(self) -> int:
        """ブリッジが宛先の選択を断った(destinations-rejected)回数。"""
        return self._destinations_rejections

    def request_destinations_scan(self) -> bool:
        """宛先タブの「更新」。ブリッジに LAN を走査させる。未接続なら False。"""
        return self.link.request_destinations_scan()

    def select_destinations(self, all_devices: bool, networks: Sequence[str], hosts: Sequence[str]) -> bool:
        """宛先の選択をブリッジへ送る(D-078 / D-085)。結果は destinations で戻ってくるので、ここでは表示を変えない。"""
        return self.link.select_destinations(all_devices, networks, hosts)

    def reset_destinations(self) -> bool:
        """保存した選択を消して設定ファイルの宛先へ戻させる。未接続なら False。"""
        return self.link.reset_destinations()

    @property
    def destination_alias_rejections(self) -> int:
        """ブリッジが端末の名前を断った(destination-alias-rejected)回数(D-092)。"""
        return self._destination_alias_rejections

    def set_destination_alias(self, host: str, alias: str | None) -> bool:
        """端末の別名をブリッジへ送る(D-092)。結果は destinations で戻ってくるので、ここでは表示を変えない。"""
        return self.link.set_destination_alias(host, alias)

    @property
    def network_settings(self) -> NetworkSettingsFrame | None:
        """ネットワークの設定(D-113)の最新の全量。ブリッジから届くまでは None。"""
        return self._network_settings

    @property
    def network_settings_revision(self) -> int:
        """networkSettings が届くたびに増える。"""
        return self._network_settings_revision

    @property
    def network_settings_rejections(self) -> int:
        """ブリッジがネットワークの設定の変更を断った(network-settings-rejected)回数。"""
        return self._network_settings_rejections

    @property
    def allowed_browsers(self) -> tuple[str, ...] | None:
        """接続してよいブラウザの範囲(D-113)。まだ届いていなければ None(UI の HTTP は localhost だけを通す)。"""
        return None if self._network_settings is None else self._network_settings.allowed_browsers

    def set_network_settings(
        self,
        target_interface: str | None,
        target_ranges: Sequence[str],
        allowed_browsers: Sequence[str],
        browser: str | None,
        *,
        revision: int | None = None,
    ) -> bool:
        """ネットワークの設定をブリッジへ送る。browser は操作したブラウザのアドレス(締め出しの判定に使う)。

        revision は編集を始めた時点の設定の版(省くと今届いている版)。ブリッジは今の版と違えば断るので、同じ接続に先に
        積まれた別のページの変更(許可の取り消しなど)や、編集中にほかのブラウザが保存した設定を、古い入力で上書きしない。
        未接続・設定が届く前なら False。
        """
        if self._network_settings is None:
            return False
        return self.link.set_network_settings(
            target_interface, target_ranges, allowed_browsers, browser,
            revision=self._network_settings.revision if revision is None else revision,
        )

    def _on_destinations(self, frame: DestinationsFrame) -> None:
        self._destinations = frame
        self._destinations_revision += 1
        # 宛先を変えても hello は届き直さないので、エコーの出所の判定に使う主系はここで追従させる
        primary = next((target for target in frame.targets if target.primary), None)
        if primary is not None:
            self._config = replace(self._config, unity=UnityTarget(primary.host, primary.send_port, primary.send_port))
