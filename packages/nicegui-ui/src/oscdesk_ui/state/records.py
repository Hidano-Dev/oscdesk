"""レコード(D-064)と Unity の一覧(runtimeOptions。D-053・D-088): 行の並び・候補・行の操作と送信。"""

from __future__ import annotations

import logging
from typing import Any, Iterable

from ..entry_rules import trigger_value
from ..protocol import PendingOptionList, RuntimeOptionsFrame
from ..surface_model import ActionSpec, ControlSpec, RecordSpec, SurfaceModel
from ..value_store import DEFAULT_HOLD_TIMEOUT_S, INPUT_HOLD_TIMEOUT_S, ValueStore
from .models import RecordRow, _json_value, _row_payload, row_channel_key

# 分ける前と同じロガー名(oscdesk_ui.state)を使う(ログの絞り込みの設定を変えずに済むように)
logger = logging.getLogger(__package__)


class RecordsMixin:
    """レコードの行と Unity の一覧。

    状態(属性)はすべて SurfaceState.__init__ が持つ。ここは振る舞いだけで、UI 要素には触れない(D-021)。
    """

    @property
    def runtime_options_revision(self) -> int:
        """Unity の一覧が変わるたびに増える。ページはこれを見て選択欄の候補だけを差し替える。"""
        return self._runtime_options_revision

    def runtime_choices(self, param_id: str) -> tuple[str, ...] | None:
        """パラメータの選択肢(静的な options を先頭に含む)。一覧が未着なら None。"""
        return self._runtime_choices.get(param_id)

    def options_for(self, entry: ControlSpec) -> tuple[tuple[str, ...], bool]:
        """欄の候補と、Unity の一覧が届いているか。届くまでは静的な options だけ(候補の規則はここ 1 か所)。"""
        choices = self._runtime_choices.get(entry.param_id)
        if choices is None:
            return entry.options or (), False
        return choices, True

    # --- レコード(D-064) ---------------------------------------------------

    @property
    def record_rows_revision(self) -> int:
        """レコード表の行(キーの一覧・保持値を持つキー・一覧の到着)が変わるたびに増える。ページは行の増減だけを行う。"""
        return self._record_rows_revision

    def field_options_for(self, record_id: str, entry: ControlSpec) -> tuple[tuple[str, ...], bool]:
        """レコードのフィールドの候補と、一覧が届いているか(D-056)。

        ブリッジは一覧が未着でも fieldChoices を(静的な options だけで)送るので、届いたかどうかは
        行の印と同じく lists で見る。fieldChoices の有無で判定すると、起動直後に保持値の全行へ「一覧に無い」が付く。
        """
        choices = self._runtime_field_choices.get((record_id, entry.param_id))
        if choices is None:
            return entry.options or (), False
        return choices, entry.options_from in self._arrived_lists

    def record_rows(self, record: RecordSpec) -> tuple[RecordRow, ...]:
        """行の順: キーの一覧の和集合の順 → 一覧に無いが保持値を持つキーを desired に現れた順。

        一覧が一度も届いていない間は「一覧に無い」と言えないので印を付けない(D-056 と同じ)。
        """
        listed = self._runtime_keys.get(record.record_id, ())
        arrived = record.keys_from in self._arrived_lists
        names = self._runtime_key_names.get(record.record_id, {})
        rows: dict[str, RecordRow] = {}
        for key in listed:
            rows.setdefault(key, RecordRow(key, listed=True, marked=False, name=names.get(key, key)))
        for key in self._desired_keys.get(record.record_id, {}):
            if key not in rows:
                rows[key] = RecordRow(key, listed=False, marked=arrived, name=names.get(key, key))
        return tuple(rows.values())

    def record_row_name(self, record: RecordSpec, key: str) -> str | None:
        """行の Name。UI で管理する行(D-087)で一覧に無い ID は None(Name の分からない行は Unity へ送れない)。"""
        if not record.has_row_ids:
            return key
        return self._runtime_key_names.get(record.record_id, {}).get(key)

    def record_values_of(self, record: RecordSpec, key: str) -> tuple[Any, ...] | None:
        return self.record_values.values_of(row_channel_key(record.record_id, key))

    def record_channel(self, record: RecordSpec, key: str) -> Any:
        """行の ValueChannel(無ければ None)。ページが改訂を見て表示を更新するために使う。"""
        return self.record_values.get(row_channel_key(record.record_id, key))

    def action_row_keys(self, action: ActionSpec) -> tuple[str, ...]:
        """scope "all" のアクションが対象にする行(表示中の全行を表示順に)。レコードが複数なら出現順の和集合。"""
        keys: dict[str, None] = {}
        for record in action.records:
            for row in self.record_rows(record):
                keys.setdefault(row.key, None)
        return tuple(keys)

    def request_runtime_options_refresh(self, list_id: str | None = None) -> bool:
        """「一覧を更新」。全宛先へ一覧の要求を送らせる。未接続なら False。

        list_id(一覧の id)を渡すと、その一覧の要求だけを送らせる(一覧の近くの Sync。D-077)。
        """
        return self.link.request_runtime_options_refresh(list_id)

    @property
    def pending_options(self) -> tuple[PendingOptionList, ...]:
        """届いたが反映していない一覧(D-088)。出所(宛先・ホスト)ごとで、ブリッジの並びのまま。"""
        return self._pending_options

    @property
    def pending_options_revision(self) -> int:
        """反映待ちの一覧が変わるたびに増える。ページはこれを見て「新しい一覧があります」を描き直す。"""
        return self._pending_options_revision

    def apply_runtime_options(self, list_id: str | None = None) -> bool:
        """届いた一覧を反映させる(D-088)。list_id(一覧の id)を省くと全一覧。未接続なら False。

        反映はブリッジが行い、全 UI へ runtimeOptions で配る(ここでは表示を先に変えない)。
        """
        return self.link.apply_runtime_options(list_id)

    def record_key_limit_reached(self, record: RecordSpec) -> bool:
        """UI で管理するキーの一覧が上限に達しているか(D-075)。達していれば追加の口を閉じる。"""
        return record.keys_max is not None and len(self.record_rows(record)) >= record.keys_max

    def add_record_key(self, record: RecordSpec, key: str) -> str | None:
        """通常の画面からの行の追加(D-075)。送れなかった理由を返す(送れたら None)。

        行はブリッジが作って desired(と UI で管理するキーなら runtimeOptions)で配るので、ここでは行を作らない。
        前後の空白は打ち間違いとみなして落とす(見た目で区別できないキーを作らないため)。
        """
        name = key.strip()
        if not name:
            return "名前を入力してください"
        if any(row.label == name for row in self.record_rows(record)):
            return f"「{name}」は既にあります"
        if self.record_key_limit_reached(record):
            return f"上限の {record.keys_max} 件に達しています"
        if not self.link.add_record_key(record.record_id, name):
            return "ブリッジに未接続のため追加できません"
        return None

    def remove_record_key(self, record: RecordSpec, key: str) -> str | None:
        """通常の画面からの行の削除(D-075)。同じキーの集合を共有する全レコードの行の保持値が消える。"""
        if not self.link.remove_record_key(record.record_id, key):
            return "ブリッジに未接続のため削除できません"
        return None

    def rename_record_key(self, record: RecordSpec, key: str, name: str) -> str | None:
        """UI で管理する行の Name の変更(D-087)。送れなかった理由を返す(送れたら、または変わらないなら None)。

        行は ID(key)で指すので、値・ホールド・表示キャッシュは付け替えない。Name の表示はブリッジの
        runtimeOptions で揃う(断られたら notice が届き、表示は元の Name のまま)。
        """
        if not record.has_row_ids:
            return "この表の行の名前は変更できません"
        new_name = name.strip()
        if not new_name:
            return "名前を入力してください"
        if self.record_row_name(record, key) == new_name:
            return None
        if any(row.label == new_name and row.key != key for row in self.record_rows(record)):
            return f"「{new_name}」は既にあります"
        if not self.link.rename_record_key(record.record_id, key, new_name):
            return "ブリッジに未接続のため名前を変更できません"
        return None

    # --- レコードの操作(D-064) ---------------------------------------------

    def begin_record_hold(self, record: RecordSpec, key: str, widget: str | None = None) -> None:
        """行のどれかの欄の操作開始。保護は行単位(1 行 = 1 メッセージなので、欄ごとに分けても送る値は行全体)。"""
        timeout_s = INPUT_HOLD_TIMEOUT_S if widget == "input" else DEFAULT_HOLD_TIMEOUT_S
        channel_key = row_channel_key(record.record_id, key)
        channel = self.record_values.channel(channel_key)
        if not channel.holding:
            # 新しいホールド。前のホールドで編集した欄の記録は持ち越さない
            self._record_edits.pop(channel_key, None)
        channel.begin_hold(self._clock(), timeout_s)

    def end_record_hold(self, record: RecordSpec, key: str) -> None:
        values = self.record_values.channel(row_channel_key(record.record_id, key)).end_hold(self._clock())
        if values is not None:
            self._send_record_row(record, key, values)

    def release_record_holds(self, rows: Iterable[tuple[RecordSpec, str]]) -> None:
        """切断したクライアントが開始した行のホールドを期限に関係なく解放する。"""
        by_channel = {row_channel_key(record.record_id, key): (record, key) for record, key in rows}
        for channel_key, values in self.record_values.release_holds(by_channel, self._clock()):
            if values is not None:
                record, key = by_channel[channel_key]
                self._send_record_row(record, key, values)

    def set_record_field(self, record: RecordSpec, key: str, index: int, value: Any, *, discrete: bool) -> None:
        """欄の編集。行の全フィールド(他は表示キャッシュの値)を 1 メッセージで送る(D-061)。

        discrete はトグル・選択・入力確定(間引かない)。連続操作(スライダー)は間引き、tick() が後から送る。
        """
        channel_key = row_channel_key(record.record_id, key)
        channel = self.record_values.channel(channel_key)
        if channel.holding:
            self._record_edits.setdefault(channel_key, set()).add(index)
        else:
            self._record_edits.pop(channel_key, None)
        current = list(channel.values if channel.values is not None else record.initial_values())
        current[index] = value
        row = tuple(current)
        if discrete:
            self._send_record_row(record, key, channel.on_local_immediate(row, self._clock()))
            return
        to_send = channel.on_local(row, self._clock())
        if to_send is not None:
            self._send_record_row(record, key, to_send)

    def press_record_trigger(self, record: RecordSpec, key: str) -> None:
        """trigger レコードの行の送信ボタン。行のキーと各フィールドの value を 1 回だけ送る。"""
        self._send_record_row(record, key, tuple(trigger_value(field) for field in record.fields))

    def _reset_records(self, surface: SurfaceModel | None) -> None:
        """定義が替わったら行の表示キャッシュを捨てる。行と値は続く desired(full) と runtimeOptions で揃い直す。

        キーの一覧(runtimeOptions)はレコード id で引くので残す。ブリッジは採用のたびに全量を送り直す(D-055)。
        """
        self.record_values.cancel_all_holds()
        self.record_values = ValueStore(min_send_interval_s=self._min_send_interval_s)
        self._record_index = {} if surface is None else {record.record_id: record for record in surface.records}
        self._desired_keys = {}
        self._record_edits = {}
        # 行のチャンネルを作り直したので、進行中の操作も無い。前の定義の行の操作者は持ち越さない
        self._row_operators = {}
        self._record_rows_revision += 1
        self._seed_record_rows()

    def _on_desired_records(self, rows: dict[str, dict[str, tuple[Any, ...]]], *, full: bool) -> None:
        """レコードの保持値を行の表示キャッシュへ取り込む。full は全キーの全量、差分は変わったキーだけ。"""
        changed = False
        for record in self._record_index.values():
            if record.kind != "state":
                continue
            incoming = rows.get(record.record_id, {})
            known = self._desired_keys.setdefault(record.record_id, {})
            if full:
                # 保持値から消えたキーは行の表示値も消す(一覧にあれば default で埋め直す)
                dropped = [key for key in known if key not in incoming]
                self.record_values.replace_all(
                    [row_channel_key(record.record_id, key) for key in dropped],
                    {},
                )
                for key in dropped:
                    del known[key]
                changed = changed or bool(dropped)
            for key, values in incoming.items():
                if key not in known:
                    known[key] = None
                    changed = True
                self._apply_record_values(record, key, values)
        if changed:
            self._record_rows_revision += 1
            self._seed_record_rows()

    def _apply_record_values(self, record: RecordSpec, key: str, values: tuple[Any, ...]) -> None:
        """行の確定値(エコー・保持値)を取り込む。ホールド中は、この行で編集した欄だけ手元の値を残して映す。"""
        channel_key = row_channel_key(record.record_id, key)
        channel = self.record_values.channel(channel_key)
        channel.on_echo(values)
        if channel.holding and channel.values is not None:
            edited = self._record_edits.get(channel_key, set())
            channel.show_during_hold(
                tuple(channel.values[index] if index in edited else value for index, value in enumerate(values))
            )

    def _on_runtime_options(self, frame: RuntimeOptionsFrame) -> None:
        # 反映待ちだけが変わったフレーム(届いた一覧の変化。D-088)では、候補と行の改訂を進めない
        if frame.pending != self._pending_options:
            self._pending_options = frame.pending
            self._pending_options_revision += 1
        choices = dict(frame.choices)
        keys = {record_id: tuple(dict.fromkeys(key for key in names if key)) for record_id, names in frame.keys}
        key_names = {record_id: dict(pairs) for record_id, pairs in frame.key_names}
        field_choices = {(record_id, field_id): options for record_id, field_id, options in frame.field_choices}
        arrived = frozenset(item.list_id for item in frame.lists if item.targets)
        if (choices, keys, key_names, field_choices, arrived) == (
            self._runtime_choices,
            self._runtime_keys,
            self._runtime_key_names,
            self._runtime_field_choices,
            self._arrived_lists,
        ):
            return
        # 改名(D-087)は行の集合を変えないが、行の表示(キーの列の Name)を描き直すために行の改訂として扱う
        rows_changed = keys != self._runtime_keys or key_names != self._runtime_key_names or arrived != self._arrived_lists
        self._runtime_choices = choices
        self._runtime_keys = keys
        self._runtime_key_names = key_names
        self._runtime_field_choices = field_choices
        self._arrived_lists = arrived
        self._runtime_options_revision += 1
        if rows_changed:
            self._record_rows_revision += 1
            self._seed_record_rows()

    def _seed_record_rows(self) -> None:
        """値の無い行(一覧に現れたが保持値がまだ届いていないキー)へ、新しい行の値(default)を表示用に入れる。

        ブリッジも同じ default で行を作って desired を配る(D-061)ので、届くまでの表示として食い違わない。OSC は送らない。
        """
        for record in self._record_index.values():
            if record.kind != "state":
                continue
            for row in self.record_rows(record):
                channel = self.record_values.channel(row_channel_key(record.record_id, row.key))
                if channel.values is None and not channel.holding:
                    channel.on_echo(record.initial_values())

    def _send_record_row(self, record: RecordSpec, key: str, values: tuple[Any, ...]) -> None:
        name = self.record_row_name(record, key)
        if name is None:
            # 一覧から消えた ID の行(別の画面で消した直後など)。Name が無いと Unity が行を名前で扱えないので送らない
            logger.info("record row %s of %s is not listed; not sending", key, record.record_id)
            return
        # レコード id・行のキー・フィールド id ごとの JSON の値で送る(HID-389)。アドレス・型・Name はブリッジが決める
        current = self._record_index.get(record.record_id)
        if current is not record:
            logger.info("record %s belongs to a replaced surface; not sending", record.record_id)
            return
        # 操作したページの holder を付ける(HID-390)。付けないと、自分で取った行のロックに自分の送信が断られる
        self.link.send_set_row(
            record.record_id,
            key,
            _row_payload(record, tuple(_json_value(field, value) for field, value in zip(record.fields, values, strict=True))),
            holder=self._row_operators.get(row_channel_key(record.record_id, key)),
            revision=self._current_revision(),
        )
