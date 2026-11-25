"""アクション(HID-166)のまとめ送り(batch。D-050)と、エコーでの到着の確認。"""

from __future__ import annotations

from typing import Any

from ..entry_rules import trigger_value
from ..protocol import OSC_BATCH_MAX_MESSAGES, BatchParam, BatchRow
from ..surface_model import ActionSpec, resolve_record_action_steps
from .echo_match import _same_values
from .models import ACTION_ECHO_TIMEOUT_S, EchoTarget, _ActionBatch, _json_value, _row_payload


class ActionsMixin:
    """アクションのまとめ送りとエコー待ち。

    状態(属性)はすべて SurfaceState.__init__ が持つ。ここは振る舞いだけで、UI 要素には触れない(D-021)。
    """

    def press_action(self, action: ActionSpec, key: str | None = None, *, holder: str | None = None) -> None:
        """アクション(HID-166)の押下。対象の値を定義順に並べ、1 つのまとめ送り(batch。HID-389)で送る。

        state は UI が持つ現在値、trigger は定義の value、step の固定値があればそれを送る。
        値がまだ無い state は送れないので外して警告する(黙って欠けると Unity 側が半端な状態になる)。
        送ったあとはエコーが揃うまで待ち、揃わなければ警告する(再送はしない)。
        scope を持つアクション(D-061)は、row なら key の行、all なら表示中の全行について展開する。
        holder は押したページ(HID-392)。自分のページが操作中(ロック中)の部品を含むまとめ送りを、ブリッジが
        自分のロックで断らないように付ける
        """
        if action.scope is not None:
            self._press_record_action(action, key, holder)
            return
        if action.truncated:
            # 上限超はブリッジが truncated で明示する(件数で推し量ると上限の値を TS と Python で揃え続ける必要がある。D-128)
            self._add_notice("error", f"「{action.label}」: 一度に送れる上限({OSC_BATCH_MAX_MESSAGES} 件)を超えています")
            return

        items: list[BatchParam | BatchRow] = []
        missing: list[EchoTarget] = []
        waiting: dict[EchoTarget, tuple[tuple[Any, ...], bool]] = {}

        for target in action.targets:
            spec = target.spec
            if spec.kind == "trigger":
                # trigger は値を省き、ブリッジが定義の value を送る(エコーは値を問わず到着で確かめる)
                items.append(BatchParam(spec.param_id, has_value=False))
                waiting[spec.param_id] = ((trigger_value(spec),), True)
                continue
            if target.has_fixed_value:
                value: Any = _json_value(spec, target.fixed_value)
                expected: tuple[Any, ...] = (value,)
            else:
                current = self.values.values_of(spec.param_id)
                if not current:
                    missing.append(spec.param_id)
                    continue
                try:
                    value = spec.wire_value(current)
                except ValueError:
                    missing.append(spec.param_id)
                    continue
                # エコーと突き合わせるのは表示キャッシュの組(組み合わせの型はフィールドの値の組。D-121)
                expected = tuple(current) if spec.is_composite else (value,)
            items.append(BatchParam(spec.param_id, value))
            waiting[spec.param_id] = (expected, False)

        self._send_action_batch(action.label, items, waiting, missing, holder)

    def _press_record_action(self, action: ActionSpec, key: str | None, holder: str | None) -> None:
        if action.scope == "row":
            if key is None:
                self._add_notice("warn", f"「{action.label}」: 行の指定がありません")
                return
            keys: tuple[str, ...] = (key,)
        else:
            keys = self.action_row_keys(action)
        targets = resolve_record_action_steps(action, keys)
        if len(targets) > OSC_BATCH_MAX_MESSAGES:
            # 展開を上限 + 1 件で打ち切っているので、件数は「上限を超える」としか言えない
            self._add_notice(
                "error", f"「{action.label}」: {len(keys)} 行分は一度に送れる上限({OSC_BATCH_MAX_MESSAGES} 件)を超えています"
            )
            return

        items: list[BatchParam | BatchRow] = []
        missing: list[EchoTarget] = []
        waiting: dict[EchoTarget, tuple[tuple[Any, ...], bool]] = {}
        for target in targets:
            record = target.record
            if record.kind == "trigger":
                values: tuple[Any, ...] = tuple(trigger_value(field) for field in record.fields)
            else:
                current = self.record_values_of(record, target.key)
                if current is None:
                    missing.append((record.record_id, target.key))
                    continue
                row = list(current)
                for index, fixed in target.fixed:
                    row[index] = fixed
                values = tuple(_json_value(field, value) for field, value in zip(record.fields, row))
            # 一覧から消えた ID の行(別の画面で消した直後など)はブリッジが Name を付けられず断るので送らない
            if self.record_row_name(record, target.key) is None:
                missing.append((record.record_id, target.key))
                continue
            items.append(BatchRow(record.record_id, target.key, _row_payload(record, values)))
            waiting[(record.record_id, target.key)] = (values, record.kind == "trigger")

        self._send_action_batch(action.label, items, waiting, missing, holder)

    def _target_text(self, target: EchoTarget) -> str:
        """通知に出す対象。UI で管理する行(D-087)は ID でなく Name で示す(ID は操作者に意味が無い)。"""
        if isinstance(target, tuple):
            record = self._record_index.get(target[0])
            name = self.record_row_name(record, target[1]) if record is not None else None
            label = record.label if record is not None else target[0]
            return f"{label} [{name or target[1]}]"
        entry = self._entry_index.get(target)
        return entry.label if entry is not None else target

    def _send_action_batch(
        self,
        label: str,
        items: list[BatchParam | BatchRow],
        waiting: dict[EchoTarget, tuple[tuple[Any, ...], bool]],
        missing: list[EchoTarget],
        holder: str | None = None,
    ) -> None:
        if missing:
            shown = ", ".join(self._target_text(item) for item in missing[:3]) + (" ほか" if len(missing) > 3 else "")
            self._add_notice("warn", f"「{label}」: 値が未設定の {len(missing)} 件は送りませんでした ({shown})")
        if not items:
            if not missing:
                self._add_notice("warn", f"「{label}」: 送る対象がありません")
            return
        if len(items) > OSC_BATCH_MAX_MESSAGES:
            self._add_notice("error", f"「{label}」: {len(items)} 件は一度に送れる上限を超えています")
            return
        # 1 データグラムの大きさの上限(60 KiB)はブリッジが通信の形にしてから判定し、超えれば batch-rejected で理由が届く
        # (UI は通信の形を知らない。HID-389)
        if not self.link.send_batch(items, holder=holder, revision=self._current_revision()):
            self._add_notice("error", f"「{label}」: ブリッジに接続していないため送れませんでした")
            return

        # 後続の押下が同じ対象を送り直したら、古い待ちはそちらへ引き継ぐ(二重に警告しない)
        for batch in self._action_batches:
            for target in waiting:
                batch.waiting.pop(target, None)
        # 待ちを全部引き継がれた古い押下は、確認できたわけではないので成功も警告も出さず捨てる
        self._action_batches = [batch for batch in self._action_batches if batch.waiting]
        self._action_batches.append(
            _ActionBatch(
                label=label,
                total=len(waiting),
                deadline=self._clock() + ACTION_ECHO_TIMEOUT_S,
                waiting=waiting,
            )
        )

    def _confirm_action_echo(self, target: EchoTarget, values: tuple[Any, ...]) -> None:
        for batch in self._action_batches:
            expectation = batch.waiting.get(target)
            if expectation is None:
                continue
            expected, any_value = expectation
            if any_value or _same_values(expected, values):
                del batch.waiting[target]
        self._finish_action_batches(expired_only=False)

    def _on_batch_rejected(self, detail: str) -> None:
        # ブリッジは拒否したバッチを一つも送らない。フレームは送信順に届くので、拒否されたのは
        # 直近のアクションとみなし、エコー待ちを残さず理由をそのまま伝える(残すと「確認できませんでした」になる)
        if not self._action_batches:
            self._add_notice("error", f"一括送信がブリッジに拒否されました: {detail}")
            return
        batch = self._action_batches.pop()
        self._add_notice("error", f"「{batch.label}」を送れませんでした: {detail}")

    def _expire_action_batches(self) -> None:
        self._finish_action_batches(expired_only=True)

    def _finish_action_batches(self, *, expired_only: bool) -> None:
        now = self._clock()
        remaining: list[_ActionBatch] = []
        for batch in self._action_batches:
            if not batch.waiting:
                if not expired_only or now >= batch.deadline:
                    self._add_notice("info", f"「{batch.label}」を送信しました({batch.total} 件を確認)")
                    continue
            elif now >= batch.deadline:
                missing = list(batch.waiting)
                shown = ", ".join(self._target_text(item) for item in missing[:3]) + (" ほか" if len(missing) > 3 else "")
                self._add_notice(
                    "error",
                    f"「{batch.label}」: {len(missing)} / {batch.total} 件のエコーを確認できませんでした ({shown})",
                )
                continue
            remaining.append(batch)
        self._action_batches = remaining
