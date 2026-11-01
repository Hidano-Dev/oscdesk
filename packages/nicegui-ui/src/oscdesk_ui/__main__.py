"""NiceGUI 版サーフェスの起動口。

ブリッジは別プロセスで先に立ち上げておくこと(通常は start-oscdesk.bat が両方を面倒見る)。

    node packages/bridge/dist/oscdesk-bridge.js
    python -m oscdesk_ui --osc-port 7080 --ui-port 8080
"""

from __future__ import annotations

import argparse
import asyncio
import logging

from nicegui import app, ui

from .config import (
    DEFAULT_CLIENT_ID,
    DEFAULT_OSC_HOST,
    DEFAULT_OSC_PORT,
    DEFAULT_UI_PORT,
    AppConfig,
)
from .network_access import BrowserAccessMiddleware
from .page import SurfacePage
from .state import SurfaceState

logger = logging.getLogger(__name__)

# ブラウザが接続し直すのを待つ秒数(NiceGUI の既定は 3 秒)。部品の多い画面を描く間はブラウザが数秒〜十数秒固まって接続が
# 切れる。既定のままだと描き終えて繋ぎ直す前にページが破棄され、ブラウザが読み込み直して同じ画面をまた描き、切断と
# 読み込み直しを繰り返す(HID-405)。ホールドと行のロックは一時切断(on_disconnect)で外すので、延ばしても残らない。
# 遅れるのはページの破棄(on_delete)で外す OSC パッドの採用の履歴の読み手だけで(ほかの端末の操作は妨げない)、
# タブを閉じてから最大この秒数
RECONNECT_TIMEOUT_SECONDS = 30.0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="oscdesk-ui",
        description="OSCDesk の NiceGUI 版コントロールサーフェス",
    )
    parser.add_argument("--osc-host", default=DEFAULT_OSC_HOST, help="ブリッジのホスト")
    parser.add_argument("--osc-port", type=int, default=DEFAULT_OSC_PORT, help="ブリッジの WebSocket ポート")
    parser.add_argument("--ui-host", default="0.0.0.0", help="NiceGUI の待ち受けホスト")
    parser.add_argument("--ui-port", type=int, default=DEFAULT_UI_PORT, help="NiceGUI のポート")
    parser.add_argument("--client-id", default=DEFAULT_CLIENT_ID, help="WebSocket の clientId")
    parser.add_argument("--show-ui", action="store_true", help="起動時にブラウザを開く")
    parser.add_argument("--verbose", action="store_true", help="デバッグログを出す")

    return parser.parse_args(argv)


def build_config(args: argparse.Namespace) -> AppConfig:
    return AppConfig(
        osc_host=args.osc_host,
        osc_port=args.osc_port,
        ui_host=args.ui_host,
        ui_port=args.ui_port,
        client_id=args.client_id,
    )


def create_app(config: AppConfig) -> SurfaceState:
    """状態を作り、NiceGUI のページとライフサイクルに配線する。"""
    state = SurfaceState(config)
    link_task: dict[str, asyncio.Task[None]] = {}
    # 接続してよいブラウザの範囲(D-113)。HTTP と WebSocket(socket.io)の両方で、ページより前に接続元を判定する。
    # 許可リストはブリッジから届いたもの(設定ファイルは読まない。D-029)
    app.add_middleware(BrowserAccessMiddleware, allowed=lambda: state.allowed_browsers)

    @ui.page("/")
    def index() -> None:
        SurfacePage(state).build()

    async def start() -> None:
        link_task["task"] = asyncio.create_task(state.link.run())

    async def shutdown() -> None:
        state.link.stop()
        task = link_task.pop("task", None)

        if task is not None:
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass

    app.on_startup(start)
    app.on_shutdown(shutdown)

    return state


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    config = build_config(args)

    create_app(config)

    logger.info("Bridge: %s", config.websocket_url)

    ui.run(
        host=config.ui_host,
        port=config.ui_port,
        title="OSCDesk",
        show=args.show_ui,
        reload=False,
        favicon="🎛️",
        reconnect_timeout=RECONNECT_TIMEOUT_SECONDS,
    )


if __name__ in {"__main__", "__mp_main__"}:
    main()
