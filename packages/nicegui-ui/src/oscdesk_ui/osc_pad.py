"""OSC パッド(D-080)の作業コピーと表示キャッシュ。編集の規則と検証はブリッジが持つ(D-126)。

パッドはサーフェス定義とは別の、ユーザーが自由にアドレスと引数を書いて撃つボタンの格子。正はブリッジが持ち、
UI は採用中のパッドを表示キャッシュとして持つ。編集はサーフェス定義(D-123)と同じく、UI が作業コピーを持ち、
「何をしたいか」を編集命令(上り osc.padEdit)として作業コピーと一緒に送り、ブリッジが規則を当てて保存と同じ検査に通した
結果(下り osc.padEdited)を新しい作業コピーにする。ここに残すのは、命令を順に送って答えを受け取る PadEditSession と、
作業コピーを描くための読み取りだけの関数(マスのボタンを引く・表示の外のボタンを数える・コピーする設定を写す)。
"""

from __future__ import annotations

import copy
import hashlib
import json
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Final

from .surface_editor import EDIT_TIMEOUT_S

OSC_PAD_FORMAT: Final = "oscdesk-pad"
OSC_PAD_VERSION: Final = 1

# 画面の選択肢と入力欄の歯止めにだけ使う(packages/shared の OSC_PAD と同じ値)。上限を超えたときの判定と理由はブリッジが返す
MAX_ROWS: Final = 12
MAX_COLUMNS: Final = 12
MAX_ARGS: Final = 16
MAX_LABEL_CHARS: Final = 64
# 画像のアップロードの受け口の歯止め(大きなファイルを読み込んでからブリッジへ運ばないため)。種類と大きさの判定はブリッジ
MAX_IMAGE_BYTES: Final = 256 * 1024
ARG_TYPES: Final = ("i", "f", "s")

DEFAULT_ROWS: Final = 4
DEFAULT_COLUMNS: Final = 4

# 答えを待つ間に打ち続けられる入力欄の命令。どれもボタンの id と引数の添字を変えないので、答えを待つ間に届いた分を
# 欄ごとに最後の 1 つだけ預かって順に送っても、別のボタン・引数に当たらない(構造を変える命令は D-123 と同じく断る)
_FIELD_OPS: Final = frozenset({"setLabel", "setAddress", "setColor", "setArgValue"})


# --- 読み取りだけ(作業コピーを描くため) -------------------------------------


def new_pad(rows: int = DEFAULT_ROWS, columns: int = DEFAULT_COLUMNS) -> dict[str, Any]:
    """採用中のパッドが無いとき・「新規」の編集の出発点(空の格子)。"""
    return {"format": OSC_PAD_FORMAT, "version": OSC_PAD_VERSION, "rows": rows, "columns": columns, "buttons": []}


def find_button(pad: dict[str, Any], button_id: str) -> dict[str, Any] | None:
    return next((button for button in pad["buttons"] if button["id"] == button_id), None)


def button_at(pad: dict[str, Any], row: int, column: int) -> dict[str, Any] | None:
    return next((button for button in pad["buttons"] if button["row"] == row and button["column"] == column), None)


def buttons_outside(pad: dict[str, Any], rows: int, columns: int) -> list[dict[str, Any]]:
    """rows × columns の格子に収まらないボタン(実行中に表示の行数・列数を減らしたときに隠れるもの)。"""
    return [button for button in pad["buttons"] if button["row"] >= rows or button["column"] >= columns]


# コピー・貼り付けの単位。id と位置はマスに属するので写さない(貼り付け先のものを保つ)
_SETTING_KEYS: Final = ("label", "color", "image", "address", "args")


def button_settings(button: dict[str, Any]) -> dict[str, Any]:
    """ボタンの設定(ラベル・背景色・画像・アドレス・引数)の写し。コピーした後に元のボタンを編集しても変わらない。"""
    return copy.deepcopy({key: button[key] for key in _SETTING_KEYS if key in button})


def format_arg_value(arg: dict[str, Any]) -> str:
    """引数の値の入力欄に出す書き方(整数の f は 1.0)。"""
    value = arg["value"]
    if arg["type"] == "f" and isinstance(value, (int, float)) and not isinstance(value, bool) and float(value).is_integer():
        return f"{float(value):.1f}"
    return str(value)


# --- 作業コピー -------------------------------------------------------------------


@dataclass
class _Edit:
    edit: dict[str, Any]
    on_ok: Callable[[], None] | None
    on_error: Callable[[str], None] | None


def _field_key(edit: dict[str, Any]) -> tuple[Any, ...] | None:
    if edit.get("op") not in _FIELD_OPS:
        return None
    return (edit["op"], edit.get("button"), edit.get("index"))


class PadEditSession:
    """編集中のパッドの作業コピー。採用中のパッド(ブリッジが正)は直接いじらない(D-049 と同じ考え方)。

    ブリッジが規則を当てて検証に通した結果だけを作業コピーにする(D-126)。答えを待つ命令は 1 つだけで、その間の構造を
    変える命令(ボタンの追加・削除・引数の並べ替えなど)は断る(D-123 と同じく、描いた時点の位置で指す命令を古い作業コピーへ
    当てないため)。入力欄の命令は打つたびに届くので、答えを待つ間は欄ごとに最後の 1 つだけを預かり、答えの後に順に送る
    (断ると打った文字が作業コピーに入らない)。
    base_version はブリッジが採用したときの版の印(pad フレームの version)、base_name は保存名。保存の結果は pad フレームで戻る。
    """

    def __init__(
        self,
        pad: dict[str, Any] | None,
        version: str,
        name: str | None,
        *,
        send: Callable[[dict[str, Any], dict[str, Any]], str | None],
        take: Callable[[str], dict[str, Any] | str | None],
        cancel: Callable[[str], None] = lambda _request_id: None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.draft: dict[str, Any] = copy.deepcopy(pad) if pad is not None else new_pad()
        self.base_version = version
        self.base_name = name
        self.dirty = False
        self._send = send
        self._take = take
        self._cancel = cancel
        self._clock = clock
        self._pending: tuple[str, float, _Edit] | None = None
        self._queued: dict[tuple[Any, ...], _Edit] = {}

    @property
    def busy(self) -> bool:
        """答えを待っている命令か、送る順番を待つ入力欄の命令があるか(この間は保存・追従・構造の命令をしない)。"""
        return self._pending is not None or bool(self._queued)

    def submit(
        self,
        edit: dict[str, Any],
        *,
        on_ok: Callable[[], None] | None = None,
        on_error: Callable[[str], None] | None = None,
    ) -> bool:
        """編集命令を送る。答えは settle で受け取り、通れば on_ok、断られれば on_error(理由)を呼ぶ。

        答えを待っている間は、入力欄の命令なら預かって True、それ以外は送らずに False を返す(呼び出し側が知らせて描き直す)。
        """
        item = _Edit(edit, on_ok, on_error)
        if self._pending is not None:
            key = _field_key(edit)
            pending_key = _field_key(self._pending[2].edit)
            if key is None or pending_key is None:
                return False
            # 同じ欄の古い入力は送らない(最後の入力だけが作業コピーに残ればよい)
            self._queued.pop(key, None)
            self._queued[key] = item
            return True
        self._dispatch(item)
        return True

    def _dispatch(self, item: _Edit) -> None:
        request_id = self._send(self.draft, item.edit)
        if request_id is None:
            if item.on_error is not None:
                item.on_error("ブリッジに接続していないため変更できません")
            return
        self._pending = (request_id, self._clock() + EDIT_TIMEOUT_S, item)

    def settle(self) -> bool:
        """届いた答えを取り込み、預かった命令を送る。ページの同期タイマーから呼ぶ(D-021)。作業コピーが変わったら True。"""
        if self._pending is None:
            return False
        request_id, deadline, item = self._pending
        result = self._take(request_id)
        if result is None:
            if self._clock() <= deadline:
                return False
            self._cancel(request_id)
            result = "ブリッジの応答がありませんでした"
        self._pending = None
        changed = False
        if isinstance(result, dict):
            if result != self.draft:
                self.draft = result
                self.dirty = True
                changed = True
            if item.on_ok is not None:
                item.on_ok()
        elif item.on_error is not None:
            item.on_error("ブリッジとの接続が切れました" if result == "disconnected" else result)
        if self._queued:
            key = next(iter(self._queued))
            self._dispatch(self._queued.pop(key))
        return changed

    def close(self) -> None:
        """編集モードを閉じる・作業コピーを捨てる。待っている命令を忘れさせる(後から届く答えを state に溜めない)。"""
        if self._pending is not None:
            self._cancel(self._pending[0])
            self._pending = None
        self._queued.clear()

    def restart(self, pad: dict[str, Any]) -> None:
        """作業コピーを pad から始め直す(「新規」)。待っている命令は忘れる。"""
        self.close()
        self.draft = copy.deepcopy(pad)
        self.dirty = True

    def follow(self, pad: dict[str, Any] | None, version: str, name: str | None) -> bool:
        """未編集で答えを待っていなければ、他の端末の保存・切り替えへ追従する。追従したら True。"""
        if self.dirty or self.busy:
            return False
        self.draft = copy.deepcopy(pad) if pad is not None else new_pad()
        self.base_version, self.base_name = version, name
        return True

    def mark_saved(self, version: str, name: str | None) -> None:
        self.base_version, self.base_name = version, name
        self.dirty = False

    def is_conflicted(self, current_version: str) -> bool:
        """編集を始めた後に、採用中のパッドが他から変わったか(未保存の変更があるときだけ意味を持つ)。"""
        return self.dirty and current_version != self.base_version


# --- 表示キャッシュ ---------------------------------------------------------------


ADOPTION_HISTORY = 32
# 読み手が止まったままでも履歴が無制限に増えないための絶対の上限(切断の取りこぼしへの保険)
ADOPTION_HISTORY_HARD_LIMIT = 1024


def _canonical(value: Any) -> Any:
    # 整数値の float(1.0)は、ブリッジが JSON.stringify で 1 として返し、辞書比較でも同値。表記の違いで別物にしない
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, dict):
        return {key: _canonical(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_canonical(item) for item in value]
    return value


def pad_digest(pad: dict[str, Any]) -> str:
    """パッドの内容の同一性を見る小さな識別子(キーの並びと数値の表記に依らない)。surrogatepass は孤立サロゲートを含む表示用ラベルのため。"""
    text = json.dumps(_canonical(pad), sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(text.encode("utf-8", "surrogatepass")).hexdigest()


@dataclass(frozen=True)
class PadAdoption:
    """ブリッジが pad フレームで配った採用 1 件(保存・切り替えの確認用)。"""

    seq: int
    name: str
    version: str
    # 内容のダイジェスト。パッド全体(上限 8 MiB)を履歴に持つと、画像の多いパッドの保存を重ねるだけで
    # 表示キャッシュのメモリが履歴の長さ倍に膨らむため、照合に要る同一性だけを小さく残す
    digest: str


class PadCache:
    """ブリッジが採用中のパッドと保存済みの一覧(D-080)。表示キャッシュで、受けるたびに置き換える。

    revision は内容か名前か一覧が変わったときだけ増える(同じ内容の再配信では画面を作り直さない)。
    """

    def __init__(self) -> None:
        self.pad: dict[str, Any] | None = None
        self.name: str | None = None
        # ブリッジが採用したときの版の印(pad フレームの version)。押下・編集の競合の検知・保存の確認に使う
        self.version = ""
        self.names: tuple[str, ...] = ()
        self.revision = 0
        # 採用の履歴(新しい順に末尾へ)。画面の同期(50ms)より前に複数の採用が届いても、保存・切り替えの確認が
        # 最新だけを見て取りこぼさないように、照合に使う採用を列で残す。seq は採用ごとに増える通し番号
        self.adoptions: deque[PadAdoption] = deque()
        self.adoption_seq = 0
        # 照合する側(編集中のパネル。ページごとに 1 つ)が読み終えた位置の seq。全員が読み終えた採用だけを
        # 履歴の上限で捨てる。固定長で古い順に捨てると、同期(50ms)の前に大量の pad フレームが届いたとき
        # 保存・切り替えの応答の採用が消えて照合されず dirty が残る
        self._readers: dict[object, int] = {}

    def has_gap_after(self, seq: int) -> bool:
        """seq まで読んだ読み手の未読の採用が、履歴から欠けているか。

        履歴は seq が連続しているので、残っている最古が seq+1 より先なら途中が捨てられている。読み手別の
        記録を持たず履歴だけで判定できるため、一時切断で登録が外れていた読み手(古い既読位置のまま戻る)も
        他の読み手の有無に左右されず検出できる。
        """
        return seq < self.adoption_seq and (not self.adoptions or self.adoptions[0].seq > seq + 1)

    def set_reader(self, reader: object, seq: int) -> None:
        self._readers[reader] = seq
        self._trim()

    def drop_reader(self, reader: object) -> None:
        # 編集を閉じた・切断したページを残すと、その位置より先の履歴を溜め続けるので、必ず外す
        self._readers.pop(reader, None)
        self._trim()

    def _trim(self) -> None:
        keep_after = min(self._readers.values(), default=None)
        while len(self.adoptions) > ADOPTION_HISTORY_HARD_LIMIT or (
            len(self.adoptions) > ADOPTION_HISTORY and (keep_after is None or self.adoptions[0].seq <= keep_after)
        ):
            self.adoptions.popleft()

    def adoptions_since(self, seq: int) -> list["PadAdoption"]:
        return [adoption for adoption in self.adoptions if adoption.seq > seq]

    def apply_pad(self, name: str, version: str, pad: dict[str, Any]) -> None:
        changed = (name, pad) != (self.name, self.pad)
        self.name, self.pad, self.version = name, pad, version
        self.adoption_seq += 1
        self.adoptions.append(PadAdoption(self.adoption_seq, name, version, pad_digest(pad)))
        self._trim()
        if changed:
            self.revision += 1

    def apply_list(self, names: tuple[str, ...], active: str | None) -> None:
        changed = names != self.names
        self.names = names
        if active is None and self.pad is not None:
            self.pad, self.name = None, None
            changed = True
        if changed:
            self.revision += 1
