"""NiceGUI のページ組み立て。

ページは複数同時に開かれうる。状態(接続・マニフェスト・値)はプロセスに 1 つで、
各ページはタイマーで revision を見て差分だけを取り込む。バックグラウンドタスクから
他クライアントの要素を直接触らずに済み、高頻度のエコーバックも自然に間引ける。
"""

from __future__ import annotations

from typing import Any

from nicegui import ui

from .manifest import ManifestEntry
from .state import SurfaceState
from .widgets import WidgetBinding, WidgetFactory

SYNC_INTERVAL_S = 0.05


class SurfacePage:
    def __init__(self, state: SurfaceState) -> None:
        self._state = state
        self._bindings: list[WidgetBinding] = []
        self._manifest_revision = -1
        self._held_addresses: set[str] = set()
        self._notice_cursor = 0

        self._factory = WidgetFactory(
            on_local=self._on_local,
            on_discrete=self._on_discrete,
            on_trigger_press=self._on_trigger_press,
            on_draft=self._on_draft,
            on_hold_begin=self._on_hold_begin,
            on_hold_end=self._on_hold_end,
        )

    def build(self) -> None:
        ui.context.client.on_disconnect(self._on_disconnect)
        ui.page_title("OSCDesk")

        with ui.header().classes("items-center justify-between q-px-md q-py-sm"):
            ui.label("OSCDesk").classes("text-h6")
            with ui.row().classes("items-center q-gutter-x-md"):
                self._link_badge = ui.badge("ブリッジ: -").props("color=grey-7")
                self._unity_badge = ui.badge("Unity: -").props("color=grey-7")
                self._manifest_badge = ui.badge("マニフェスト: -").props("color=grey-7")

        with ui.column().classes("w-full q-pa-md items-stretch").style("max-width:900px;margin:0 auto"):
            with ui.card().classes("w-full q-pa-sm"):
                with ui.row().classes("w-full items-center justify-between no-wrap"):
                    self._manifest_label = ui.label("-").classes("text-caption")
                    ui.button("再取得", on_click=self._state.link.request_manifest).props(
                        "flat dense no-caps"
                    ).classes("whitespace-nowrap")

                self._link_label = ui.label("-").classes("text-caption text-grey-7 break-all")
                self._target_label = ui.label("-").classes("text-caption text-grey-7")
                # 冗長構成(宛先が 2 台以上)のときだけ中身を作る(D-046)
                self._targets_key: tuple = ()
                self._targets_row = ui.row().classes("w-full items-center q-gutter-x-sm")
                self._error_label = ui.label("").classes("text-caption text-negative")

            self._container = ui.column().classes("w-full items-stretch")

        ui.timer(SYNC_INTERVAL_S, self.sync)

    # --- 定期同期 ---------------------------------------------------------

    def sync(self) -> None:
        self._state.tick()
        self._show_notices()
        self._sync_status()

        if self._manifest_revision != self._state.manifest_revision:
            self._rebuild()

        for binding in self._bindings:
            if binding.is_editing:
                # フォーカス中の input はキー入力がなくてもホールドを延長する。
                # 期限切れ(INPUT_HOLD_TIMEOUT_S)は、このタイマーが止まった
                # (ページが消えた)あとの保険としてだけ働く。
                self._on_hold_begin(binding.entry)

            channel = self._state.values.get(binding.entry.address)

            if channel is None or channel.revision == binding.revision:
                continue

            binding.revision = channel.revision
            binding.apply(channel.values)

    def _show_notices(self) -> None:
        for notice in self._state.notices_since(self._notice_cursor):
            self._notice_cursor = notice.seq
            notification_type = {
                "error": "negative",
                "warn": "warning",
                "info": "info",
            }[notice.level]
            ui.notify(notice.message, type=notification_type)

    def _sync_status(self) -> None:
        link = self._state.link_status
        manifest = self._state.manifest_status
        config = self._state.config

        bridge_detail = f"ブリッジ: {link.detail}"
        if self._link_badge.text != bridge_detail:
            self._link_badge.text = bridge_detail
            self._link_badge.props(f"color={'positive' if link.connected else 'warning'}")

        reachability = self._state.unity_link_status
        rtt = "-" if reachability.last_rtt_ms is None else f"{reachability.last_rtt_ms:g} ms"
        if reachability.reachability == "lost":
            unity_detail = f"Unity 未接続 (RTT {rtt}, 連続喪失 {reachability.consecutive_losses} 回)"
            unity_color = "negative"
        elif reachability.reachability == "reachable":
            unity_detail = f"Unity 接続中 ({rtt}, 連続喪失 {reachability.consecutive_losses} 回)"
            unity_color = "positive"
        else:
            unity_detail = "Unity 未確認"
            unity_color = "grey-7"
        self._unity_badge.text = unity_detail
        self._unity_badge.props(f"color={unity_color}")

        self._link_label.text = f"ブリッジ: {config.websocket_url}"

        manifest_detail = f"マニフェスト: {manifest.detail}"
        if manifest.project_id is not None:
            manifest_detail += f" — {manifest.project_id} ({manifest.entry_count} 件)"
        self._manifest_label.text = manifest_detail
        if manifest.last_rejection:
            manifest_detail += f" / 直近拒否: {manifest.last_rejection}"
        self._manifest_badge.text = manifest_detail
        self._manifest_badge.props(f"color={'negative' if manifest.last_rejection else 'positive'}")

        # hello フレーム受信前は unity が None(ブリッジ未接続・再接続中の新規ページ)
        unity_target = "未取得 (hello 待ち)" if config.unity is None else config.unity.target
        self._target_label.text = f"Unity 宛先: {unity_target}"
        self._sync_targets()
        self._error_label.text = manifest.error or link.last_error or ""

    def _sync_targets(self) -> None:
        targets = self._state.unity_targets if len(self._state.unity_targets) > 1 else ()
        key = tuple((t.name, t.primary, t.reachability) for t in targets)
        if key == self._targets_key:
            return
        self._targets_key = key
        self._targets_row.clear()
        colors = {"reachable": "positive", "lost": "negative"}
        labels = {"reachable": "接続中", "lost": "未接続"}
        with self._targets_row:
            for target in targets:
                role = "主系" if target.primary else "副系"
                state = labels.get(target.reachability, "未確認")
                ui.badge(f"{target.name} ({role}): {state}").props(f"color={colors.get(target.reachability, 'grey-7')}")
                ui.button(
                    "再送",
                    on_click=lambda _event=None, name=target.name: self._state.request_resend(name),
                ).props("flat dense no-caps")
            ui.button("全台へ再送", on_click=lambda _event=None: self._state.request_resend()).props(
                "flat dense no-caps"
            )

    def _rebuild(self) -> None:
        self._manifest_revision = self._state.manifest_revision
        self._bindings = []
        self._container.clear()
        manifest = self._state.manifest

        with self._container:
            if manifest is None:
                ui.label(
                    "マニフェスト待ち。ブリッジからの manifest フレームを待っています"
                    "(元は Unity の /sys/manifest)。"
                ).classes("text-grey-7")
                return

            if not manifest.entries:
                ui.label("マニフェストにエントリがありません。").classes("text-grey-7")
                return

            for group, entries in manifest.groups():
                if group is not None:
                    with ui.expansion(group, value=True).classes("w-full q-mt-md"):
                        for entry in entries:
                            self._bindings.append(self._factory.build(entry))
                else:
                    for entry in entries:
                        self._bindings.append(self._factory.build(entry))

    # --- UI からの操作 ----------------------------------------------------

    def _on_local(self, entry: ManifestEntry, values: tuple[Any, ...]) -> None:
        self._state.set_local(entry, values)

    def _on_discrete(self, entry: ManifestEntry, values: tuple[Any, ...]) -> None:
        self._state.set_discrete(entry, values)

    def _on_trigger_press(self, entry: ManifestEntry) -> None:
        self._state.press_trigger(entry)

    def _on_draft(self, entry: ManifestEntry, raw: Any) -> None:
        self._state.set_draft(entry, raw)

    def _on_hold_begin(self, entry: ManifestEntry) -> None:
        self._held_addresses.add(entry.address)
        self._state.begin_hold(entry.address)

    def _on_hold_end(self, entry: ManifestEntry) -> None:
        self._held_addresses.discard(entry.address)
        self._state.end_hold(entry)

    def _on_disconnect(self) -> None:
        """クライアント切断時に、このページが開始したホールドを解放する。"""
        self._state.release_holds(self._held_addresses)
        self._held_addresses.clear()
