"""値の調停と送信レート制限。

CLAUDE.md の絶対規律「Unity が真実の源。UI は表示キャッシュ」に対応する層。

- 操作中(hold)は自分の値を表示し、Unity のエコーバックを無視する
- 指を離したらエコーバックが正になる
- 連続操作の送信は間引き、最後の値だけは必ず送る(取りこぼすと Unity と食い違う)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable, Iterator

DEFAULT_MIN_SEND_INTERVAL_S = 1.0 / 30.0
DEFAULT_HOLD_TIMEOUT_S = 2.0
INPUT_HOLD_TIMEOUT_S = 120.0


@dataclass
class ValueChannel:
    """1 アドレス分の表示値と送信状態。"""

    address: str
    min_send_interval_s: float = DEFAULT_MIN_SEND_INTERVAL_S
    values: tuple[Any, ...] | None = None
    revision: int = 0
    holding: bool = False
    hold_started_at: float | None = None
    hold_timeout_s: float = DEFAULT_HOLD_TIMEOUT_S
    _pending: tuple[Any, ...] | None = field(default=None, repr=False)
    _last_sent_at: float | None = field(default=None, repr=False)

    def begin_hold(
        self,
        now: float = 0.0,
        timeout_s: float = DEFAULT_HOLD_TIMEOUT_S,
    ) -> None:
        self.holding = True
        self.hold_started_at = now
        self.hold_timeout_s = timeout_s

    def end_hold(self, now: float) -> tuple[Any, ...] | None:
        """操作終了。間引きで保留していた最終値があれば、間隔を無視して送る。"""
        self.holding = False
        self.hold_started_at = None
        return self._take_pending(now)

    def expire_hold(self, now: float) -> tuple[Any, ...] | None:
        """期限切れのホールドを解除し、保留値があれば即時送信用に返す。"""
        if not self.holding or self.hold_started_at is None:
            return None
        if now - self.hold_started_at < self.hold_timeout_s:
            return None

        self.holding = False
        self.hold_started_at = None
        return self._take_pending(now)

    def on_local(self, values: tuple[Any, ...], now: float) -> tuple[Any, ...] | None:
        """UI 操作による値変更。送るべき値を返す(間引き対象なら None)。"""
        self._set_values(values)

        if self._last_sent_at is not None and now - self._last_sent_at < self.min_send_interval_s:
            self._pending = values
            return None

        self._pending = None
        self._last_sent_at = now
        return values

    def on_local_immediate(self, values: tuple[Any, ...], now: float) -> tuple[Any, ...]:
        """ボタン・トグルのような離散操作。間引きせず必ず送る。"""
        self._set_values(values)
        self._pending = None
        self._last_sent_at = now
        return values

    def flush_due(self, now: float) -> tuple[Any, ...] | None:
        """間引きで保留した値の遅延送信。送信間隔を満たしていなければ何もしない。"""
        if self._pending is None:
            return None

        if self._last_sent_at is not None and now - self._last_sent_at < self.min_send_interval_s:
            return None

        return self._take_pending(now)

    def on_echo(self, values: tuple[Any, ...]) -> bool:
        """Unity からのエコーバック。表示を更新したら True を返す。"""
        if self.holding:
            return False

        return self._set_values(values)

    def reset_send_state(self) -> None:
        """再接続時など、送信途中の状態を捨てる(古い値を後から流さない)。"""
        self._pending = None
        self._last_sent_at = None

    def _take_pending(self, now: float) -> tuple[Any, ...] | None:
        pending = self._pending
        if pending is None:
            return None

        self._pending = None
        self._last_sent_at = now
        return pending

    def _set_values(self, values: tuple[Any, ...]) -> bool:
        if self.values == values:
            return False

        self.values = values
        self.revision += 1
        return True


class ValueStore:
    """アドレスごとの ValueChannel をまとめて扱う。"""

    def __init__(self, min_send_interval_s: float = DEFAULT_MIN_SEND_INTERVAL_S) -> None:
        self._min_send_interval_s = min_send_interval_s
        self._channels: dict[str, ValueChannel] = {}

    def channel(self, address: str) -> ValueChannel:
        channel = self._channels.get(address)

        if channel is None:
            channel = ValueChannel(address=address, min_send_interval_s=self._min_send_interval_s)
            self._channels[address] = channel

        return channel

    def get(self, address: str) -> ValueChannel | None:
        return self._channels.get(address)

    def values_of(self, address: str) -> tuple[Any, ...] | None:
        channel = self._channels.get(address)
        return channel.values if channel is not None else None

    def on_echo(self, address: str, values: tuple[Any, ...]) -> bool:
        return self.channel(address).on_echo(values)

    def flush_due(self, now: float) -> list[tuple[str, tuple[Any, ...]]]:
        flushed: list[tuple[str, tuple[Any, ...]]] = []

        for address, channel in self._channels.items():
            values = channel.flush_due(now)
            if values is not None:
                flushed.append((address, values))

        return flushed

    def reset_send_state(self) -> None:
        for channel in self._channels.values():
            channel.reset_send_state()

    def release_all_holds(self, now: float) -> list[tuple[str, tuple[Any, ...] | None]]:
        """全チャネルのホールドを期限判定し、期限切れ分をまとめて解除する。"""
        released: list[tuple[str, tuple[Any, ...] | None]] = []
        for address, channel in self._channels.items():
            if not channel.holding:
                continue
            values = channel.expire_hold(now)
            if not channel.holding:
                released.append((address, values))
        return released

    def release_holds(
        self,
        addresses: Iterable[str],
        now: float,
    ) -> list[tuple[str, tuple[Any, ...] | None]]:
        """指定されたクライアント由来のホールドを期限に関係なく解除する。"""
        released: list[tuple[str, tuple[Any, ...] | None]] = []
        for address in addresses:
            channel = self._channels.get(address)
            if channel is None or not channel.holding:
                continue
            released.append((address, channel.end_hold(now)))
        return released

    def seed_defaults(self, entries: Iterable[Any]) -> None:
        """マニフェストの default を初期表示値に使う。既に値があるものは触らない。

        default はあくまで初期表示で、値の確定は Unity のエコーバックのみ。
        """
        for entry in entries:
            if not getattr(entry, "has_default", False):
                continue

            channel = self.channel(entry.address)
            if channel.values is None:
                channel.values = (entry.default,)
                channel.revision += 1

    def __iter__(self) -> Iterator[ValueChannel]:
        return iter(self._channels.values())
