"""パラメータの値: UI の操作(ホールド・間引き・確定)、保持値とエコーの取り込み、set の送信、tick。"""

from __future__ import annotations

import logging
from typing import Any, Iterable, Sequence

from ..entry_rules import trigger_value
from ..protocol import DesiredFrame, EchoFrame
from ..surface_model import ControlSpec
from ..value_store import DEFAULT_HOLD_TIMEOUT_S, INPUT_HOLD_TIMEOUT_S

# 分ける前と同じロガー名(oscdesk_ui.state)を使う(ログの絞り込みの設定を変えずに済むように)
logger = logging.getLogger(__package__)


class ValuesMixin:
    """パラメータの値の操作と取り込み(D-045)。

    状態(属性)はすべて SurfaceState.__init__ が持つ。ここは振る舞いだけで、UI 要素には触れない(D-021)。
    """

    # --- UI からの操作 ----------------------------------------------------

    def begin_hold(self, param_id: str, widget: str | None = None) -> None:
        """widget は配置された部品の種類。省くとパラメータの既定の部品で判断する。"""
        if widget is None:
            entry = self.entry_for(param_id)
            widget = entry.widget if entry is not None else None
        timeout_s = INPUT_HOLD_TIMEOUT_S if widget == "input" else DEFAULT_HOLD_TIMEOUT_S
        self.values.channel(param_id).begin_hold(self._clock(), timeout_s)

    def end_hold(self, entry: ControlSpec) -> None:
        values = self.values.channel(entry.param_id).end_hold(self._clock())

        if values is not None:
            self._send(entry, values)

    def release_holds(self, param_ids: Iterable[str]) -> None:
        """切断したクライアントが開始したホールドを期限に関係なく解放する。"""
        for param_id, values in self.values.release_holds(param_ids, self._clock()):
            if values is None:
                continue
            entry = self.entry_for(param_id)
            if entry is not None:
                self._send(entry, values)

    def set_local(self, entry: ControlSpec, values: Sequence[Any]) -> None:
        """UI 操作による値変更。間引きに掛かった分は tick() が後から送る。"""
        if not entry.standalone:
            # 送らない値にはエコーが返らない。離したときに編集前の値へ戻らないよう、その場で確定する
            self.values.channel(entry.param_id).on_local_immediate(tuple(values), self._clock())
            return
        to_send = self.values.channel(entry.param_id).on_local(tuple(values), self._clock())

        if to_send is not None:
            self._send(entry, to_send)

    def set_discrete(self, entry: ControlSpec, values: Sequence[Any]) -> None:
        """トグル・選択・入力確定の操作。取りこぼすと状態が食い違うため間引かない。"""
        to_send = self.values.channel(entry.param_id).on_local_immediate(tuple(values), self._clock())
        self._send(entry, to_send)

    def set_draft(self, entry: ControlSpec, raw: Any) -> None:
        self.values.set_draft(entry.param_id, raw)

    def press_trigger(self, entry: ControlSpec) -> None:
        """トリガの押下。定義の value を 1 回だけ送る(値は保持・表示しない。D-043)。"""
        if entry.is_composite:
            # 組み合わせの型の trigger はフィールドの value を並べた組(D-121)
            self._send(entry, tuple(trigger_value(field) for field in entry.fields))
            return
        self._send(entry, (trigger_value(entry),))

    def request_resend(self, target: str | None = None) -> None:
        """保持値を宛先へ送り直させる(クラッシュ・再起動した台を追いつかせる。D-046)。"""
        self.link.request_resend(target)

    def request_reconcile(self, target: str) -> None:
        """その宛先の PC を生成の記録に合わせさせる(欠けているものを生成し、余分なものを消し、保持値を送り直す。HID-385)。"""
        self.link.request_reconcile(target)

    def tick(self) -> None:
        """保留値の送信と、全チャネルの期限切れホールド解除を行う。"""
        now = self._clock()
        self._expire_action_batches()

        for param_id, values in self.values.release_all_holds(now):
            if values is None:
                continue
            entry = self.entry_for(param_id)
            if entry is not None:
                self._send(entry, values)

        for param_id, values in self.values.flush_due(now):
            entry = self.entry_for(param_id)

            if entry is not None:
                self._send(entry, values)

        released = [(key, values) for key, values in self.record_values.release_all_holds(now) if values is not None]
        for channel_key, values in [*released, *self.record_values.flush_due(now)]:
            record_id, _, key = channel_key.partition("\x00")
            record = self._record_index.get(record_id)
            if record is not None:
                self._send_record_row(record, key, values)

    def _on_echo(self, frame: EchoFrame) -> None:
        """主系のターゲットのエコー(HID-389)を、届いた確認として表示へ反映する。保持値は変えない(D-045)。

        出所の判定(主系のターゲットか・OSC ネイティブ UI の端末でないか)はブリッジが済ませている。
        """
        for row in frame.rows:
            record = self._record_index.get(row.record)
            # 空のキーは行として扱わない。行は作らない(行はキーの一覧と保持値から来る。D-064)
            if record is None or not row.key:
                continue
            fields = record.row_values(row.values)
            if fields is None:
                continue
            self._confirm_action_echo((record.record_id, row.key), fields)
            if record.kind == "state":
                self._apply_record_values(record, row.key, fields)
        for item in frame.values:
            # 現在の定義に無いパラメータ(計画外・未採用)は表示にもキャッシュにも入れない
            if item.param not in self._entry_index:
                continue
            # 組み合わせの型(D-121)はフィールドの値の組。読めない値は値の無い応答と同じに扱う
            echoed = (self._entry_index[item.param].values_from_wire(item.value) or ()) if item.has_value else ()
            # 値の読めない応答でも、トリガーの到着確認には使える
            self._confirm_action_echo(item.param, echoed)
            if echoed:
                self.values.on_echo(item.param, echoed)

    def _on_desired(self, frame: DesiredFrame) -> None:
        """ブリッジが保持する狙いの値(D-045)を表示キャッシュへ取り込む。OSC は送らない。"""
        values: dict[str, tuple[Any, ...]] = {}
        # レコードの保持値は行ごとに 1 エントリ(レコード id・行のキー・フィールド id ごとの値。D-061・HID-389)
        record_rows: dict[str, dict[str, tuple[Any, ...]]] = {}
        for row in frame.rows:
            record = self._record_index.get(row.record)
            # 空文字のキーはブリッジが保持も生成もしない(一覧からも除く)ので、行にしない
            if record is None or record.kind != "state" or not row.key:
                continue
            fields = record.row_values(row.values)
            if fields is not None:
                record_rows.setdefault(record.record_id, {})[row.key] = fields
        for item in frame.values:
            if item.param not in self._entry_index or not item.has_value:
                continue
            decoded = self._entry_index[item.param].values_from_wire(item.value)
            if decoded is not None:
                values[item.param] = decoded

        self._on_desired_records(record_rows, full=frame.full)

        if frame.full:
            # standalone:false はブリッジが保持しない UI だけの値なので、全量で消さない(まとめ送りの材料)
            state_params = [
                spec.param_id for spec in self._entry_index.values() if spec.kind == "state" and spec.standalone
            ]
            self.values.replace_all(state_params, values)
            return

        for param_id, param_values in values.items():
            self.values.on_echo(param_id, param_values)

    def _send(self, entry: ControlSpec, values: tuple[Any, ...]) -> None:
        # 単独で送らない定義(standalone: false)は、まとめ送り(HID-166)の対象としてのみ
        # 送る。ここで送るとブリッジの保持対象外の値が Unity にだけ届いてしまう
        if not entry.standalone:
            return

        # パラメータ ID と JSON の値で送る(HID-373)。アドレスと型タグへの直し方はブリッジが定義から決めるので、
        # UI は OSC の語を持たない。パラメータは 1 つの値(組み合わせの型はフィールド id → 値のオブジェクト。D-121)を持つ
        try:
            wire_value = entry.wire_value(values)
        except ValueError as error:
            logger.warning("parameter %s: %s; not sending", entry.param_id, error)
            return
        # 操作したページの holder を付ける(HID-378)。ロック中の部品は持ち主のページからの変更だけをブリッジが通す
        # 作り直し前の画面の部品(今の定義に無いもの)からは送らない。同じ id が新しい定義で別のアドレスを指すことがある
        # 作り直した画面に同じ部品が無ければ、古い画面の部品とみなして送らない。同じ id でも制約・表示が変わっていれば
        # 別のものを指しうる(新しい定義で別のアドレスに結び付いたときはブリッジも set の revision で断る)
        # 等しさでなく同一性で照合する。結び付けだけを変えた定義では、旧画面と新画面の部品が等値になるが、旧画面の操作に
        # 今の revision を付けて送ると、ブリッジの stale-surface 判定も通って新しいアドレスへ送られてしまう(PR #111 の指摘)
        if self._current_specs.get(id(entry)) is not entry:
            logger.info("parameter %s belongs to a replaced surface; not sending", entry.param_id)
            return
        self.link.send_set(
            entry.param_id,
            wire_value,
            holder=self._operators.get(entry.param_id),
            revision=self._current_revision(),
        )
