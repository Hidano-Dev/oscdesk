"""サーフェス定義(D-043)の編集モードの作業コピー。編集の規則はブリッジが持つ(D-123)。

UI は「何をしたいか」を編集命令(上り surfaceEdit)として作業コピーと一緒に送り、ブリッジが規則を当てて検証した結果
(下り surfaceEdited)を新しい作業コピーにする。ここに残すのは、命令を順に送って答えを受け取る EditSession と、
作業コピーを描くための読み取りだけの関数(結び付けの引き当て・未配置のパラメータ・ノードの指し方)。これらは表示用の
モデルをサーバーへ移す段階(HID-401)で扱う。

ノードの指し方(NodeRef)は `(screen, steps, index)`:
- screen: screens の添字
- steps: そこから降りる入れ子。行・列・グループへは子の添字(int)、
  タブへは `(子の添字, タブの添字)`
- index: 降りた先の children の中の添字
"""

from __future__ import annotations

import copy
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Final

Definition = dict[str, Any]
Step = int | tuple[int, int]
NodeRef = tuple[int, tuple[Step, ...], int]
EditResult = dict[str, Any] | str

WRAP_KINDS: Final = ("row", "column", "group")
# 子を持たない配置のノード。record(D-061)はレコード表で、children を持たない
LEAF_KINDS: Final = ("control", "action", "record")
# ブリッジの答えを待つ長さ。答えが来ないまま命令の列を止めないための歯止め(LAN 内なら数ミリ秒で返る)
EDIT_TIMEOUT_S: Final = 15.0


# --- 読み取りだけ(作業コピーを描くため) -------------------------------------


def ref_payload(ref: NodeRef) -> dict[str, Any]:
    """NodeRef を編集命令の ref(JSON)にする。タブへの降り方は [子の添字, タブの添字]。"""
    screen, steps, index = ref
    return {"screen": screen, "steps": [list(step) if isinstance(step, tuple) else step for step in steps], "index": index}


def node_at(definition: Definition, ref: NodeRef) -> dict[str, Any] | None:
    """ref のノード(無ければ None)。描画が今の値と比べるためだけに使う(書き換えはブリッジの編集命令)。"""
    screen, steps, index = ref
    try:
        nodes: list[dict[str, Any]] = definition["screens"][screen]["children"]
        for step in steps:
            if isinstance(step, tuple):
                nodes = nodes[step[0]]["tabs"][step[1]]["children"]
            else:
                nodes = nodes[step]["children"]
        return nodes[index]
    except (IndexError, KeyError, TypeError):
        return None


def osc_bindings(definition: Definition) -> dict[str, Any] | None:
    """定義の OSC の結び付け(bindings.osc)。無ければ None(OSC のアダプタが無いブリッジの定義)。"""
    bindings = definition.get("bindings")
    if not isinstance(bindings, dict):
        return None
    osc = bindings.get("osc")
    return osc if isinstance(osc, dict) else None


def parameter_address(definition: Definition, param_id: str) -> str | None:
    """パラメータの OSC のアドレス(結び付けに無ければ None)。編集モードのアドレスの欄に出す。"""
    for binding in (osc_bindings(definition) or {}).get("parameters", []):
        if binding["id"] == param_id:
            return binding["address"]
    return None


def record_address(definition: Definition, record_id: str) -> str | None:
    for binding in (osc_bindings(definition) or {}).get("records", []):
        if binding["id"] == record_id:
            return binding["address"]
    return None


def list_binding(definition: Definition, list_id: str) -> dict[str, Any] | None:
    """一覧の結び付け({id, address, request?})。無ければ None。"""
    for binding in (osc_bindings(definition) or {}).get("lists", []):
        if binding["id"] == list_id:
            return binding
    return None


def _visit(nodes: list[dict[str, Any]], action: Any) -> None:
    for node in nodes:
        action(node)
        if node["kind"] == "tabs":
            for tab in node["tabs"]:
                _visit(tab["children"], action)
        elif node["kind"] not in LEAF_KINDS:
            _visit(node["children"], action)


def unplaced_parameter_ids(definition: Definition) -> list[str]:
    placed: set[str] = set()

    def collect(node: dict[str, Any]) -> None:
        if node["kind"] == "control":
            placed.add(node["param"])

    for screen in definition["screens"]:
        _visit(screen["children"], collect)
    return [p["id"] for p in definition["parameters"] if p["id"] not in placed]


def new_definition(name: str = "New", *, osc: bool = True) -> Definition:
    """採用中の定義が無いときの編集の出発点(画面を 1 つ持たせ、すぐ部品を置ける)。osc なら空の OSC の結び付けも持たせる。"""
    definition: Definition = {
        "format": "oscdesk-surface",
        "version": 2,
        "name": name,
        "parameters": [],
        "screens": [{"id": "main", "label": "Main", "children": []}],
    }
    if osc:
        definition["bindings"] = {"osc": {"parameters": []}}
    return definition


# --- 作業コピー -------------------------------------------------------------


@dataclass
class _Edit:
    edit: dict[str, Any]
    on_ok: Callable[[], None] | None
    on_error: Callable[[str], None] | None


class EditSession:
    """編集中の作業コピーと、その出発点の記録。

    採用中の定義(ブリッジが正)を直接いじらず、ブリッジが規則を当てて検証に通した結果だけを作業コピーにする(D-123)。
    答えを待つ命令は 1 つだけで、その間の命令は断る。画面のボタンは描いた時点の位置(NodeRef)でノードを指すので、
    答えで木が変わる前に押された命令を受けると、別のノードに当たる(移動の直後の削除が隣を消すなど)。
    出発点の revision を覚えておき、他の端末が先に保存したか(競合)を判定する。
    """

    def __init__(
        self,
        definition: Definition,
        base_revision: int,
        base_name: str | None,
        *,
        send: Callable[[Definition | None, dict[str, Any]], str | None],
        take: Callable[[str], EditResult | None],
        cancel: Callable[[str], None] = lambda _request_id: None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.draft: Definition = copy.deepcopy(definition)
        self.base_revision = base_revision
        self.base_name = base_name
        self._saved: Definition = copy.deepcopy(definition)
        self._send = send
        self._take = take
        self._cancel = cancel
        self._clock = clock
        self._pending: tuple[str, float, _Edit] | None = None

    @property
    def dirty(self) -> bool:
        return self.draft != self._saved

    @property
    def busy(self) -> bool:
        """答えを待っている命令があるか(この間は新しい命令・保存・採用中の定義への追従をしない)。"""
        return self._pending is not None

    def submit(
        self,
        edit: dict[str, Any],
        *,
        on_ok: Callable[[], None] | None = None,
        on_error: Callable[[str], None] | None = None,
    ) -> bool:
        """編集命令を送る。答えは settle で受け取り、通れば on_ok、断られれば on_error(理由)を呼ぶ。

        前の命令の答えを待っている間は送らずに False を返す(呼び出し側が知らせて描き直す)。
        """
        if self._pending is not None:
            return False
        item = _Edit(edit, on_ok, on_error)
        # 差し替え(アップロード)は作業コピーを使わない(壊れた作業コピーでも直せるように)
        draft = None if edit.get("op") == "replace" else self.draft
        request_id = self._send(draft, edit)
        if request_id is None:
            if on_error is not None:
                on_error("ブリッジに接続していないため変更できません")
            return True
        self._pending = (request_id, self._clock() + EDIT_TIMEOUT_S, item)
        return True

    def settle(self) -> bool:
        """届いた答えを取り込み、次の命令を送る。ページの同期タイマーから呼ぶ(D-021)。作業コピーが変わったら True。"""
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
                changed = True
            if item.on_ok is not None:
                item.on_ok()
        elif item.on_error is not None:
            item.on_error("ブリッジとの接続が切れました" if result == "disconnected" else result)
        return changed

    def close(self) -> None:
        """編集モードを閉じる。待っている命令を忘れさせる(後から届く答えを state に溜めない)。"""
        if self._pending is not None:
            self._cancel(self._pending[0])
            self._pending = None

    def follow(self, definition: Definition) -> None:
        """採用中の定義(ブリッジが採用したもの)を作業コピーにする。未編集で答えを待っていないときだけ呼ぶ。"""
        self.draft = copy.deepcopy(definition)

    def is_conflicted(self, current_revision: int) -> bool:
        """編集を始めたあとに、採用中の定義が(他の端末の保存などで)変わったか。"""
        return current_revision != self.base_revision

    def mark_saved(self, revision: int, name: str | None) -> None:
        """保存が採用されたあとの出発点へ更新する。"""
        self._saved = copy.deepcopy(self.draft)
        self.base_revision = revision
        self.base_name = name


def parameter_form(form: dict[str, Any], *, has_osc: bool) -> dict[str, Any]:
    """編集フォームの入力を編集命令の form(JSON)にする。読み取りと型ごとの規則はブリッジ(D-123)。

    OSC の欄(アドレス・一覧のアドレスと要求)はブリッジが OSC のアダプタを持つときだけ osc に入れる(D-117)。
    """
    payload: dict[str, Any] = {
        key: str(form.get(key, "") or "") for key in ("id", "label", "kind", "type", "widget", "min", "max", "step", "options", "default", "value")
    }
    payload["standalone"] = bool(form.get("standalone", True))
    if has_osc:
        payload["osc"] = {
            "address": str(form.get("address", "") or ""),
            "listAddress": str(form.get("options_from_address", "") or ""),
            "listRequest": str(form.get("options_from_request", "") or ""),
        }
    else:
        payload["optionsFromList"] = str(form.get("options_from_list", "") or "")
    return payload
