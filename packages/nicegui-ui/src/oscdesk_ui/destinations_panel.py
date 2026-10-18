"""宛先タブ(D-078 / D-079)。

LAN の走査・宛先の選択・選択の保存はブリッジが受け持ち、このタブは destinations の表示と、
チェックの付け外しを destinationsSelect として送るだけにする(ブリッジと UI の責務分離)。
チェックの状態はブリッジから届いた選択で毎回描き直す。手元で先に変えないのは、ブリッジが断った選択
(空の選択など)を画面に残さないため。
"""

from __future__ import annotations

from datetime import datetime
from typing import Sequence

from nicegui import ui

from .notify_history import notify
from .protocol import DestinationDevice, DestinationsFrame
from .state import SurfaceState


def toggled_hosts(selected: Sequence[str], host: str, checked: bool, order: Sequence[str]) -> list[str]:
    """チェックの付け外しを反映した選択。一覧の並び(order)に揃え、一覧に無い選択は後ろにそのまま残す。"""
    chosen = set(selected)
    if checked:
        chosen.add(host)
    else:
        chosen.discard(host)
    listed = [item for item in order if item in chosen]
    rest = [item for item in selected if item in chosen and item not in order]
    return listed + rest


def device_caption(device: DestinationDevice) -> str:
    """端末の行の補足。この PC・設定の宛先・見つからなかったことは、選ぶときに必要なので文字で出す。"""
    parts: list[str] = []
    if device.is_self:
        parts.append("この PC")
    if device.configured:
        parts.append("設定の宛先")
    if not device.found:
        parts.append("直近の走査で見つかりません")
    if device.mac:
        parts.append(device.mac)
    if device.interface:
        parts.append(device.interface)
    return " / ".join(parts)


def all_devices_label(frame: DestinationsFrame) -> str:
    if not frame.broadcasts:
        return "全てのデバイス(IPv4 のネットワークが見つかりません)"
    return f"全てのデバイス({', '.join(broadcast.address for broadcast in frame.broadcasts)})"


def scan_status(frame: DestinationsFrame) -> str:
    if frame.scanning:
        return "走査中…"
    if frame.scanned_at is None:
        return "未走査"
    at = datetime.fromisoformat(frame.scanned_at.replace("Z", "+00:00")).astimezone()
    return f"最終走査 {at:%H:%M:%S}"


class DestinationsPanel:
    def __init__(self, state: SurfaceState) -> None:
        self._state = state
        self._key: tuple[int, bool] | None = None
        self._auto_scan_requested = False

    def build(self) -> None:
        with ui.column().classes("w-full items-stretch q-pa-sm").style("gap:8px"):
            with ui.row().classes("w-full items-center justify-between no-wrap"):
                ui.label("送信先").classes("text-subtitle1")
                with ui.row().classes("items-center no-wrap gap-2"):
                    self._scan_label = ui.label("").classes("text-caption text-grey-7")
                    self._scan_button = ui.button("更新", icon="refresh", on_click=self._on_scan).props(
                        "flat dense no-caps"
                    )
            self._summary = ui.label("").classes("text-caption text-grey-7 break-all")
            self._list = ui.column().classes("w-full items-stretch").style("gap:0")
            with ui.row().classes("w-full items-center justify-between"):
                self._source_label = ui.label("").classes("text-caption text-grey-7")
                self._reset_button = ui.button("設定ファイルの宛先に戻す", on_click=self._on_reset).props(
                    "flat dense no-caps"
                )
            ui.label(
                "OscDesk には認証がありません。信頼できる LAN の中だけで使ってください。"
            ).classes("text-caption text-grey-7")
        self.sync()

    def sync(self) -> None:
        key = (self._state.destinations_revision, self._state.link_status.connected)
        if key == self._key:
            return
        self._key = key
        self._render()

    def _render(self) -> None:
        frame = self._state.destinations
        connected = self._state.link_status.connected
        self._list.clear()
        if frame is None:
            self._scan_label.text = ""
            self._summary.text = ""
            self._source_label.text = ""
            self._scan_button.disable()
            self._reset_button.disable()
            with self._list:
                ui.label("ブリッジから宛先の情報を待っています。").classes("text-grey-7")
            return

        # ブリッジは起動時に走査しない(UI を使わない起動で LAN へ撒かないため)。未走査のまま開いたら 1 回だけ走査を頼む。
        # 「頼んだ」印は、切断(ブリッジの再起動を含む)と走査済みの受信で戻す。戻さないと、再起動した新しいブリッジの
        # 未走査の destinations を受けても頼まず、一覧が空のままになる
        if not connected or frame.scanned_at is not None:
            self._auto_scan_requested = False
        if connected and frame.scanned_at is None and not frame.scanning and not self._auto_scan_requested:
            self._auto_scan_requested = self._state.request_destinations_scan()
        self._scan_label.text = scan_status(frame)
        if frame.scanning:
            self._scan_button.props("loading")
        else:
            self._scan_button.props(remove="loading")
        self._scan_button.set_enabled(connected and not frame.scanning)
        self._reset_button.set_enabled(connected and frame.source != "config")
        targets = ", ".join(f"{target.host}:{target.send_port}" for target in frame.targets)
        self._summary.text = f"いま送っている宛先: {targets}"
        self._source_label.text = {
            "saved": "保存した選択を使っています",
            "unsaved": "選択を使っています(保存できなかったため、ブリッジを再起動すると設定ファイルの宛先に戻ります)",
        }.get(frame.source, "設定ファイルの宛先を使っています")

        selected = set(frame.hosts)
        with self._list:
            everyone = ui.checkbox(
                all_devices_label(frame),
                value=frame.all_devices,
                on_change=lambda event: self._on_all_devices(bool(event.value)),
            ).props("dense")
            # ネットワークが無いときは選べないが、既に選んでいれば外せるようにしておく
            everyone.set_enabled(connected and (bool(frame.broadcasts) or frame.all_devices))
            ui.separator().classes("q-my-xs")
            if not frame.devices:
                ui.label("端末が見つかっていません。「更新」で走査します。").classes("text-grey-7")
            for device in frame.devices:
                with ui.row().classes("w-full items-center no-wrap").style("gap:8px"):
                    box = ui.checkbox(
                        device.host,
                        value=device.host in selected,
                        on_change=lambda event, host=device.host: self._on_toggle(host, bool(event.value)),
                    ).props("dense")
                    # 全てのデバイスの間は個別の選択は使わないのでグレーアウトする(選択そのものは外したときのために残る)
                    box.set_enabled(connected and not frame.all_devices)
                    caption = device_caption(device)
                    if caption:
                        ui.label(caption).classes(
                            "text-caption " + ("text-grey-5" if frame.all_devices else "text-grey-7")
                        )

    def _redraw(self) -> None:
        # チェックボックスは押した時点で見た目が変わっているので、ブリッジが持つ選択で描き直す
        self._key = None
        self.sync()

    def _on_toggle(self, host: str, checked: bool) -> None:
        frame = self._state.destinations
        if frame is None:
            return
        hosts = toggled_hosts(frame.hosts, host, checked, [device.host for device in frame.devices])
        if not hosts:
            notify("送信先を 1 台以上選んでください", type="warning")
            self._redraw()
            return
        if not self._state.select_destinations(frame.all_devices, hosts):
            notify("ブリッジに接続していないため変更できませんでした", type="warning")
            self._redraw()

    def _on_all_devices(self, checked: bool) -> None:
        frame = self._state.destinations
        if frame is None or checked == frame.all_devices:
            return
        # 個別の選択が残っていなければ戻す先が無い(全てのデバイスの間は端末を選べない)ので、設定ファイルの宛先へ戻す
        sent = (
            self._state.select_destinations(checked, list(frame.hosts))
            if checked or frame.hosts
            else self._state.reset_destinations()
        )
        if not sent:
            notify("ブリッジに接続していないため変更できませんでした", type="warning")
            self._redraw()

    def _on_scan(self) -> None:
        if not self._state.request_destinations_scan():
            notify("ブリッジに接続していないため走査できませんでした", type="warning")

    def _on_reset(self) -> None:
        if not self._state.reset_destinations():
            notify("ブリッジに接続していないため戻せませんでした", type="warning")
