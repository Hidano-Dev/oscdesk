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
# input のホールド期限。フォーカス中はページの同期タイマー(page.sync)が begin_hold を
# 呼び直して延長し続けるため、通常は期限切れしない。ページが消えて blur も切断通知も
# 届かなかったときに、ホールドが恒久に残らないようにする保険。
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
    draft: Any = field(default=None, repr=False)
    has_draft: bool = field(default=False, repr=False)
    pre_edit_values: tuple[Any, ...] | None = field(default=None, repr=False)
    _pending: tuple[Any, ...] | None = field(default=None, repr=False)
    _last_sent_at: float | None = field(default=None, repr=False)

    def begin_hold(
        self,
        now: float = 0.0,
        timeout_s: float = DEFAULT_HOLD_TIMEOUT_S,
    ) -> None:
        if not self.holding:
            self.pre_edit_values = self.values
        self.holding = True
        self.hold_started_at = now
        self.hold_timeout_s = timeout_s

    def end_hold(self, now: float) -> tuple[Any, ...] | None:
        """操作終了。間引きで保留していた最終値があれば、間隔を無視して送る。"""
        self.holding = False
        self.hold_started_at = None
        values = self._take_pending(now)
        self._finish_hold(values)
        return values

    def expire_hold(self, now: float) -> tuple[Any, ...] | None:
        """期限切れのホールドを解除し、保留値があれば即時送信用に返す。"""
        if not self.holding or self.hold_started_at is None:
            return None
        if now - self.hold_started_at < self.hold_timeout_s:
            return None

        self.holding = False
        self.hold_started_at = None
        values = self._take_pending(now)
        self._finish_hold(values)
        return values

    def set_draft(self, raw: Any) -> None:
        """編集中の下書きを保持する。ホールド外の値は受け付けない。"""
        if self.holding:
            self.draft = raw
            self.has_draft = True

    def clear_draft(self) -> None:
        self.draft = None
        self.has_draft = False

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
        self.clear_draft()
        # 即時送信はこのホールドの確定操作なので、解除時に編集前値へ戻さない。
        self.pre_edit_values = values
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
            self.pre_edit_values = values
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

    def _finish_hold(self, sent_values: tuple[Any, ...] | None) -> None:
        if sent_values is None and self.pre_edit_values != self.values:
            if self.pre_edit_values is None:
                if self.values is not None:
                    self.values = None
                    self.revision += 1
            else:
                self._set_values(self.pre_edit_values)

        self.clear_draft()
        self.pre_edit_values = None

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

    def set_draft(self, address: str, raw: Any) -> None:
        self.channel(address).set_draft(raw)

    def draft_of(self, address: str) -> tuple[bool, Any]:
        channel = self._channels.get(address)
        if channel is None or not channel.has_draft:
            return False, None
        return True, channel.draft

    def is_holding(self, address: str) -> bool:
        channel = self._channels.get(address)
        return channel is not None and channel.holding

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

    def seed_defaults(
        self,
        entries: Iterable[Any],
        *,
        force: bool = False,
    ) -> list[tuple[str, str]]:
        """マニフェストの default を表示値へ反映し、表示を変えられない理由を返す。

        force=False では既存値を保持する。force=True ではホールド中を除いて
        default で上書きし、default を持たないエントリは表示値を消す(前の Unity
        インスタンスのエコー値を、再起動後の Unity に送り返さないため)。
        いずれも送信状態には触れない。
        """
        unchanged: list[tuple[str, str]] = []
        for entry in entries:
            if not getattr(entry, "has_default", False):
                if force:
                    self._clear_without_default(entry.address, unchanged)
                continue

            type_tag = getattr(entry, "type_tag", getattr(entry, "type", ""))
            if type_tag == "b":
                unchanged.append((entry.address, "blob"))
                continue

            channel = self.channel(entry.address)
            default_values = (entry.default,)
            if channel.holding:
                if force:
                    channel.pre_edit_values = default_values
                    unchanged.append((entry.address, "holding"))
                    continue
                if channel.values is None:
                    channel._set_values(default_values)
                continue

            if not force and channel.values is not None:
                continue
            channel._set_values(default_values)

        return unchanged

    def _clear_without_default(self, address: str, unchanged: list[tuple[str, str]]) -> None:
        """新たな採用で default が供給されなかったチャネルの表示値を消す。

        ホールド中は表示を据え置き、編集前値を「なし」にして、確定せずに離脱した
        ときに表示が消えるようにする。チャネルが無ければ何も作らない。
        """
        channel = self._channels.get(address)
        if channel is None:
            return
        if channel.holding:
            channel.pre_edit_values = None
            unchanged.append((address, "holding"))
            return
        if channel.values is not None:
            channel.values = None
            channel.revision += 1

    def __iter__(self) -> Iterator[ValueChannel]:
        return iter(self._channels.values())
