"""WebSocket connection to the OscDesk bridge."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Iterable, Sequence

import websockets

from .protocol import (
    DecodedFrame,
    FrameDecodeError,
    OscMessage,
    decode_frame,
    encode_destinations_alias,
    encode_destinations_reset,
    encode_destinations_scan,
    encode_destinations_select,
    encode_heartbeat_ack,
    encode_network_settings_set,
    encode_pad_load,
    encode_pad_press,
    encode_pad_request,
    encode_pad_save,
    encode_project_export,
    encode_project_import,
    encode_surface_load,
    encode_surface_request,
    encode_surface_save,
    encode_osc_batch_frame,
    encode_osc_frame,
    encode_record_key_add,
    encode_record_key_remove,
    encode_record_key_rename,
    encode_resend,
    encode_runtime_options_apply,
    encode_runtime_options_refresh,
)

logger = logging.getLogger(__name__)

INITIAL_RECONNECT_DELAY_S = 0.5
MAX_RECONNECT_DELAY_S = 10.0
HEARTBEAT_INTERVAL_S = 15.0
RECEIVE_TIMEOUT_S = HEARTBEAT_INTERVAL_S * 3
OUTBOX_MAX_FRAMES = 256
# D-071: 既定の 1 MiB だと、レコード行が数千行溜まった desired(full)で接続ごと切れて再接続を繰り返す。
WS_MAX_MESSAGE_BYTES = 16 * 1024 * 1024


@dataclass(frozen=True)
class LinkStatus:
    connected: bool
    detail: str
    last_error: str | None = None
    attempts: int = 0


@dataclass
class LinkOptions:
    url: str
    heartbeat_interval_s: float = HEARTBEAT_INTERVAL_S
    receive_timeout_s: float | None = None
    initial_reconnect_delay_s: float = INITIAL_RECONNECT_DELAY_S
    max_reconnect_delay_s: float = MAX_RECONNECT_DELAY_S
    outbox_max_frames: int = OUTBOX_MAX_FRAMES

    def __post_init__(self) -> None:
        if self.receive_timeout_s is None:
            object.__setattr__(self, "receive_timeout_s", self.heartbeat_interval_s * 3)


def drain_failures(done: Iterable[Any]) -> BaseException | None:
    failure: BaseException | None = None
    for task in done:
        if task.cancelled():
            continue
        error = task.exception()
        if error is not None and failure is None:
            failure = error
    return failure


FrameHandler = Callable[[DecodedFrame], None]
StatusHandler = Callable[[LinkStatus], None]
Connector = Callable[[str], Awaitable[Any]]


@dataclass
class _Outbox:
    max_frames: int
    queue: asyncio.Queue[str] = field(init=False)
    dropped: int = 0

    def __post_init__(self) -> None:
        self.queue = asyncio.Queue(maxsize=self.max_frames)

    def put(self, frame: str) -> None:
        try:
            self.queue.put_nowait(frame)
        except asyncio.QueueFull:
            with contextlib.suppress(asyncio.QueueEmpty):
                self.queue.get_nowait()
            self.dropped += 1
            with contextlib.suppress(asyncio.QueueFull):
                self.queue.put_nowait(frame)

    def clear(self) -> None:
        while True:
            try:
                self.queue.get_nowait()
            except asyncio.QueueEmpty:
                return


class BridgeLink:
    """Maintain a resilient bridge WebSocket connection."""

    def __init__(
        self,
        options: LinkOptions,
        on_frame: FrameHandler,
        on_status: StatusHandler | None = None,
        connector: Connector | None = None,
    ) -> None:
        self._options = options
        self._on_frame = on_frame
        self._on_status = on_status
        # D-023: the application heartbeat owns liveness; never use proxy env vars.
        self._connector = connector or (
            lambda url: websockets.connect(
                url, ping_interval=None, proxy=None, max_size=WS_MAX_MESSAGE_BYTES
            )
        )
        self._outbox = _Outbox(options.outbox_max_frames)
        self._status = LinkStatus(False, "未接続")
        self._stopping = asyncio.Event()
        self._connected = asyncio.Event()

    @property
    def status(self) -> LinkStatus:
        return self._status

    @property
    def dropped_frames(self) -> int:
        return self._outbox.dropped

    def send_osc(self, address: str, args: Sequence[Any]) -> None:
        if self._connected.is_set():
            self._outbox.put(encode_osc_frame(address, args))

    def send_osc_batch(self, messages: Sequence[OscMessage | dict[str, Any]]) -> bool:
        """Queue one WebSocket frame containing an ordered OSC message set."""
        if not self._connected.is_set():
            return False
        self._outbox.put(encode_osc_batch_frame(messages))
        return True

    def request_surface(self) -> None:
        """採用中の定義・保存済み一覧・保持値の再配信を求める(D-044)。"""
        if self._connected.is_set():
            self._outbox.put(encode_surface_request())

    def load_surface(self, name: str) -> None:
        """保存済みの定義を読み込んで採用するよう求める(HID-165)。"""
        if self._connected.is_set():
            self._outbox.put(encode_surface_load(name))

    def save_surface(self, name: str, definition: dict[str, Any], *, activate: bool = True) -> bool:
        """定義の保存を求める。未接続なら送れないので False を返し、呼び出し側が知らせる。"""
        if not self._connected.is_set():
            return False
        self._outbox.put(encode_surface_save(name, definition, activate=activate))
        return True

    def request_resend(self, target: str | None = None) -> None:
        if self._connected.is_set():
            self._outbox.put(encode_resend(target))

    def request_runtime_options_refresh(self, request: str | None = None) -> bool:
        """Unity の一覧を全宛先へ取り直させる(D-055 の runtimeOptionsRefresh)。未接続なら送れないので False。

        request を渡すと、その要求アドレスの一覧だけを取り直させる(Sync。D-077)。
        """
        if not self._connected.is_set():
            return False
        self._outbox.put(encode_runtime_options_refresh(request))
        return True

    def apply_runtime_options(self, address: str | None = None) -> bool:
        """届いた一覧を反映させる(D-088)。address を省くと全一覧。未接続なら送れないので False。"""
        return self._put_if_connected(encode_runtime_options_apply(address))

    def request_destinations_scan(self) -> bool:
        """宛先タブの「更新」(D-078)。未接続なら送れないので False。"""
        return self._put_if_connected(encode_destinations_scan())

    def select_destinations(self, all_devices: bool, networks: Sequence[str], hosts: Sequence[str]) -> bool:
        """宛先の選択をブリッジへ送る(D-078 / D-085)。未接続なら送れないので False。"""
        return self._put_if_connected(encode_destinations_select(all_devices, networks, hosts))

    def reset_destinations(self) -> bool:
        """保存した選択を消して設定ファイルの宛先へ戻させる(D-078)。未接続なら送れないので False。"""
        return self._put_if_connected(encode_destinations_reset())

    def export_project(self, request_id: str) -> bool:
        """プロジェクトの書き出しを求める(D-090)。結果は project フレームで戻る。未接続なら送れないので False。"""
        return self._put_if_connected(encode_project_export(request_id))

    def import_project(self, project: dict[str, Any]) -> bool:
        """プロジェクトの取り込みを求める(D-090)。結果は surface・pad・desired と notice で戻る。未接続なら False。"""
        return self._put_if_connected(encode_project_import(project))

    def set_destination_alias(self, host: str, alias: str | None) -> bool:
        """端末の別名を付ける・消す(D-092)。未接続なら送れないので False。"""
        return self._put_if_connected(encode_destinations_alias(host, alias))

    def set_network_settings(
        self, target_interface: str | None, target_ranges: Sequence[str], allowed_browsers: Sequence[str], browser: str | None = None
    ) -> bool:
        """ネットワークの設定を置き換えさせる(D-113)。未接続なら送れないので False。"""
        return self._put_if_connected(encode_network_settings_set(target_interface, target_ranges, allowed_browsers, browser))

    def _put_if_connected(self, frame: str) -> bool:
        if not self._connected.is_set():
            return False
        self._outbox.put(frame)
        return True

    def add_record_key(self, record_id: str, key: str) -> bool:
        """レコードの行の追加をブリッジへ求める(D-075)。未接続なら送れないので False。"""
        if not self._connected.is_set():
            return False
        self._outbox.put(encode_record_key_add(record_id, key))
        return True

    def remove_record_key(self, record_id: str, key: str) -> bool:
        """レコードの行の削除をブリッジへ求める(D-075)。未接続なら送れないので False。"""
        if not self._connected.is_set():
            return False
        self._outbox.put(encode_record_key_remove(record_id, key))
        return True

    def rename_record_key(self, record_id: str, key: str, name: str) -> bool:
        """UI で管理する行の Name の変更をブリッジへ求める(D-087)。未接続なら送れないので False。"""
        if not self._connected.is_set():
            return False
        self._outbox.put(encode_record_key_rename(record_id, key, name))
        return True

    def request_pad(self) -> None:
        """採用中の OSC パッドと保存済みの一覧の再配信を求める(D-080)。"""
        if self._connected.is_set():
            self._outbox.put(encode_pad_request())

    def load_pad(self, name: str) -> bool:
        if not self._connected.is_set():
            return False
        self._outbox.put(encode_pad_load(name))
        return True

    def save_pad(self, name: str, pad: dict[str, Any]) -> bool:
        if not self._connected.is_set():
            return False
        self._outbox.put(encode_pad_save(name, pad))
        return True

    def press_pad(self, name: str, version: str, button_id: str) -> bool:
        """押下を送る。送信待ちの列に積むだけで待たない(押してから送るまでの遅れを作らない)。未接続なら False。"""
        if not self._connected.is_set():
            return False
        self._outbox.put(encode_pad_press(name, version, button_id))
        return True

    def update_heartbeat(self, interval_s: float) -> None:
        self._options.heartbeat_interval_s = interval_s
        self._options.receive_timeout_s = interval_s * 3

    def stop(self) -> None:
        self._stopping.set()

    async def run(self) -> None:
        delay = self._options.initial_reconnect_delay_s
        attempts = 0
        while not self._stopping.is_set():
            attempts += 1
            self._set_status(LinkStatus(False, "接続中", attempts=attempts))
            try:
                await self._session()
                delay = self._options.initial_reconnect_delay_s
                attempts = 0
            except asyncio.CancelledError:
                raise
            except Exception as error:  # noqa: BLE001
                message = f"{type(error).__name__}: {error}"
                logger.warning("ブリッジへの接続に失敗しました (%s)", message)
                self._set_status(LinkStatus(False, "再接続待ち", message, attempts))
            if self._stopping.is_set():
                return
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(self._stopping.wait(), timeout=delay)
            delay = min(delay * 2, self._options.max_reconnect_delay_s)

    async def _session(self) -> None:
        async with await self._connector(self._options.url) as websocket:
            self._outbox.clear()
            self._connected.set()
            self._set_status(LinkStatus(True, "接続済み"))
            # A reconnect always refreshes the surface, including after the first connect.
            self.request_surface()
            self.request_pad()
            tasks = [
                asyncio.create_task(self._read_loop(websocket)),
                asyncio.create_task(self._write_loop(websocket)),
            ]
            try:
                done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                for task in pending:
                    task.cancel()
                await asyncio.gather(*pending, return_exceptions=True)
                failure = drain_failures(done)
                if failure is not None:
                    raise failure
            finally:
                self._connected.clear()
                self._outbox.clear()
                self._set_status(LinkStatus(False, "切断"))

    async def _read_loop(self, websocket: Any) -> None:
        while True:
            raw = await asyncio.wait_for(websocket.recv(), timeout=self._options.receive_timeout_s)
            await self._read_frame(websocket, raw)

    async def _read_frame(self, websocket: Any, raw: str | bytes) -> None:
        try:
            frame = decode_frame(raw)
        except (FrameDecodeError, ValueError) as error:
            # Rejecting a frame never costs the connection (Req 3-5 の対称適用).
            logger.warning("不正なフレームを破棄しました: %s", error)
            return
        if frame.type == "heartbeat":
            # Bypass the outbox: heartbeat acknowledgements have highest priority.
            await websocket.send(encode_heartbeat_ack(frame.t))
            return
        try:
            self._on_frame(frame)
        except Exception:  # noqa: BLE001
            logger.exception("受信フレームのハンドラで例外が発生しました (%s)", frame.type)

    async def _write_loop(self, websocket: Any) -> None:
        while True:
            await websocket.send(await self._outbox.queue.get())

    def _set_status(self, status: LinkStatus) -> None:
        self._status = status
        if self._on_status is not None:
            try:
                self._on_status(status)
            except Exception:  # noqa: BLE001
                logger.exception("状態ハンドラで例外が発生しました")


# Kept as the module's established public class name until the package rename task.
SurfaceLink = BridgeLink
