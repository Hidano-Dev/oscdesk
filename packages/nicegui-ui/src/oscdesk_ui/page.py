"""NiceGUI のページ組み立て。

ページは複数同時に開かれうる。状態(接続・定義・値)はプロセスに 1 つで、
各ページはタイマーで revision を見て差分だけを取り込む。バックグラウンドタスクから
他クライアントの要素を直接触らずに済み、高頻度のエコーバックも自然に間引ける。
"""

from __future__ import annotations

from typing import Any

from nicegui import ui

from .layout import render_screens
from .surface_model import ControlSpec
from .state import SurfaceState
from .widgets import WidgetBinding, WidgetFactory

SYNC_INTERVAL_S = 0.05


class SurfacePage:
    def __init__(self, state: SurfaceState) -> None:
        self._state = state
        self._bindings: list[WidgetBinding] = []
        self._surface_revision = -1
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
                self._surface_badge = ui.badge("定義: -").props("color=grey-7")

        with ui.column().classes("w-full q-pa-md items-stretch").style("max-width:900px;margin:0 auto"):
            with ui.card().classes("w-full q-pa-sm"):
                with ui.row().classes("w-full items-center justify-between no-wrap"):
                    self._surface_label = ui.label("-").classes("text-caption")
                    ui.button("再取得", on_click=self._state.link.request_surface).props(
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

        if self._surface_revision != self._state.surface_revision:
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
        surface = self._state.surface_status
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

        surface_detail = f"定義: {surface.detail}"
        if surface.name is not None:
            surface_detail += f" — {surface.name} ({surface.parameter_count} 件, rev {surface.revision})"
        saved = self._state.surface_names
        if saved:
            surface_detail_long = f"{surface_detail} / 保存済み: {', '.join(saved)}"
        else:
            surface_detail_long = surface_detail
        self._surface_label.text = surface_detail_long
        self._surface_badge.text = surface_detail
        self._surface_badge.props(f"color={'positive' if surface.name is not None else 'grey-7'}")

        # hello フレーム受信前は unity が None(ブリッジ未接続・再接続中の新規ページ)
        unity_target = "未取得 (hello 待ち)" if config.unity is None else config.unity.target
        self._target_label.text = f"Unity 宛先: {unity_target}"
        self._sync_targets()
        self._error_label.text = link.last_error or ""

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
        self._surface_revision = self._state.surface_revision
        self._bindings = []
        self._container.clear()
        surface = self._state.surface

        with self._container:
            if surface is None:
                ui.label("定義待ち。ブリッジからの surface フレームを待っています。").classes("text-grey-7")
                return

            if not surface.screens or not any(screen.controls for screen in surface.screens):
                ui.label("定義に画面または部品がありません。").classes("text-grey-7")
                return

            # 配置は layout.py が決め、部品は与えられた枠に収まるだけ(HID-163)
            render_screens(surface.screens, lambda spec: self._bindings.append(self._factory.build(spec)))

    # --- UI からの操作 ----------------------------------------------------

    def _on_local(self, entry: ControlSpec, values: tuple[Any, ...]) -> None:
        self._state.set_local(entry, values)

    def _on_discrete(self, entry: ControlSpec, values: tuple[Any, ...]) -> None:
        self._state.set_discrete(entry, values)

    def _on_trigger_press(self, entry: ControlSpec) -> None:
        self._state.press_trigger(entry)

    def _on_draft(self, entry: ControlSpec, raw: Any) -> None:
        self._state.set_draft(entry, raw)

    def _on_hold_begin(self, entry: ControlSpec) -> None:
        self._held_addresses.add(entry.address)
        self._state.begin_hold(entry.address, entry.widget)

    def _on_hold_end(self, entry: ControlSpec) -> None:
        self._held_addresses.discard(entry.address)
        self._state.end_hold(entry)

    def _on_disconnect(self) -> None:
        """クライアント切断時に、このページが開始したホールドを解放する。"""
        self._state.release_holds(self._held_addresses)
        self._held_addresses.clear()
