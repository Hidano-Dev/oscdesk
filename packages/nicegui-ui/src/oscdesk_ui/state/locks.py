"""操作中のロック(HID-378・HID-390): ほかのページの操作中の判定と、操作したページ(holder)の記録。"""

from __future__ import annotations

from ..protocol import LocksFrame, lock_ref
from ..surface_model import ControlSpec, RecordSpec
from .models import row_channel_key


class LocksMixin:
    """操作中のロック。

    状態(属性)はすべて SurfaceState.__init__ が持つ。ここは振る舞いだけで、UI 要素には触れない(D-021)。
    """

    # --- 操作中のロック(HID-378) ---------------------------------------------

    def note_operator(self, entry: ControlSpec, holder: str) -> bool:
        """このページが部品を操作する。以後この部品の値の送信(間引いた後の送信を含む)に holder を付ける。

        ほかのページがロック中(locks で届いている)なら操作させずに False を返す(値を共有の表示に書き込ませない。
        書き込ませると、その値がロックの持ち主の値として送られてしまう)。

        値のチャンネルはこのプロセスの全ページで 1 つなので、操作者は「進行中の操作」の持ち主として扱う(HID-392・D-111)。
        - 進行中の操作(ホールド中か、間引きで保留した未送信の値がある)がほかのページのものなら断る。locks が届く前の
          すき間でも、別のページの値をチャンネルに書かせない(書くと、その値が持ち主の holder で送られ、ブリッジが通す)。
          保留した値は操作したページの holder のまま送られる(送るまで操作者が替わらない)
        - 進行中の操作が無ければ、このページが新しい操作の持ち主になる。前に操作したページの holder を残すと、
          ロックはこのページ・set は前のページの holder になり、ブリッジに断られる
        """
        if self.lock_label(entry, holder) is not None:
            return False
        current = self._operators.get(entry.param_id)
        channel = self.values.get(entry.param_id)
        busy = channel is not None and (channel.holding or channel.has_pending)
        if busy and current is not None and current != holder:
            return False
        self._operators[entry.param_id] = holder
        return True

    def lock_label(self, entry: ControlSpec, holder: str) -> str | None:
        """ほかのブラウザのページが操作中なら、その持ち主の表示名。空いているか自分のページなら None。"""
        return self._lock_label_of(lock_ref(entry.param_id), holder)

    def acquire_lock(self, entry: ControlSpec, holder: str, label: str) -> None:
        """操作の開始と延長。操作が続く間は呼び直して期限(LOCK_LEASE_S)を延ばす。操作者は変えない(値の操作が決める)。"""
        self.link.send_lock(lock_ref(entry.param_id), holder, label)

    def release_lock(self, entry: ControlSpec, holder: str) -> None:
        self.link.send_unlock(lock_ref(entry.param_id), holder)

    def note_record_operator(self, record: RecordSpec, key: str, holder: str) -> bool:
        """このページが Record の行を操作する(HID-390)。規則は部品の note_operator と同じで、単位が行になる。

        行の値のチャンネルもこのプロセスの全ページで 1 つなので、進行中の操作(ホールド中か保留した未送信の値)が
        ほかのページのものなら断る。断らないと、そのページの値が持ち主の holder で送られてブリッジに通される
        """
        if self.record_lock_label(record, key, holder) is not None:
            return False
        channel_key = row_channel_key(record.record_id, key)
        current = self._row_operators.get(channel_key)
        channel = self.record_values.get(channel_key)
        busy = channel is not None and (channel.holding or channel.has_pending)
        if busy and current is not None and current != holder:
            return False
        self._row_operators[channel_key] = holder
        return True

    def record_lock_label(self, record: RecordSpec, key: str, holder: str) -> str | None:
        """ほかのブラウザのページが行を操作中なら、その持ち主の表示名。空いているか自分のページなら None。"""
        return self._lock_label_of(lock_ref(record=record.record_id, key=key), holder)

    def acquire_record_lock(self, record: RecordSpec, key: str, holder: str, label: str) -> None:
        """行の操作の開始と延長(HID-390)。ロックの単位は行(D-111。1 行 = 1 メッセージ)。"""
        self.link.send_lock(lock_ref(record=record.record_id, key=key), holder, label)

    def release_record_lock(self, record: RecordSpec, key: str, holder: str) -> None:
        self.link.send_unlock(lock_ref(record=record.record_id, key=key), holder)

    def _lock_label_of(self, ref: tuple[str, ...], holder: str) -> str | None:
        own_client = self._hello.client_id if self._hello is not None else None
        for lock in self._locks:
            if lock.ref == ref and not (lock.client_id == own_client and lock.holder == holder):
                return lock.label
        return None

    def _on_locks(self, frame: LocksFrame) -> None:
        if frame.locks != self._locks:
            self._locks = frame.locks
            self.locks_revision += 1
