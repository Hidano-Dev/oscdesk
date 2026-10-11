"""サーフェス定義(D-043)の編集操作。UI を持たない純粋関数だけを置く。

編集は「作業コピー(dict)を丸ごと複製して変えた新しい dict を返す」形に統一する。
失敗しても元の定義は壊れず、呼び出し側は検証(validate_surface_definition)に通った
ものだけを作業コピーとして採用できる。画面(NiceGUI)側はこのモジュールを呼ぶだけにして、
配置の木をどう操作するかの規則をここに集める。

ノードの指し方(NodeRef)は `(screen, steps, index)`:
- screen: screens の添字
- steps: そこから降りる入れ子。行・列・グループへは子の添字(int)、
  タブへは `(子の添字, タブの添字)`
- index: 降りた先の children の中の添字
"""

from __future__ import annotations

import copy
from typing import Any, Final, Literal

Definition = dict[str, Any]
Step = int | tuple[int, int]
NodeRef = tuple[int, tuple[Step, ...], int]

WRAP_KINDS: Final = ("row", "column", "group")


class EditError(ValueError):
    """編集操作が成立しない(対象が無い・範囲外など)。"""


def _children(definition: Definition, screen: int, steps: tuple[Step, ...]) -> list[dict[str, Any]]:
    try:
        nodes: list[dict[str, Any]] = definition["screens"][screen]["children"]
        for step in steps:
            if isinstance(step, tuple):
                index, tab = step
                nodes = nodes[index]["tabs"][tab]["children"]
            else:
                nodes = nodes[step]["children"]
    except (IndexError, KeyError, TypeError) as error:
        raise EditError("対象の場所が見つかりません") from error
    return nodes


def _locate(definition: Definition, ref: NodeRef) -> tuple[list[dict[str, Any]], int]:
    screen, steps, index = ref
    nodes = _children(definition, screen, steps)
    if not 0 <= index < len(nodes):
        raise EditError("対象の部品が見つかりません")
    return nodes, index


# --- パラメータ層 -----------------------------------------------------------


def add_parameter(definition: Definition, parameter: dict[str, Any]) -> Definition:
    result = copy.deepcopy(definition)
    result["parameters"].append(copy.deepcopy(parameter))
    return result


def update_parameter(definition: Definition, param_id: str, parameter: dict[str, Any]) -> Definition:
    """param_id のパラメータを丸ごと差し替える。id を変えたときは配置側の参照も追従させる。"""
    result = copy.deepcopy(definition)
    for index, current in enumerate(result["parameters"]):
        if current["id"] == param_id:
            result["parameters"][index] = copy.deepcopy(parameter)
            break
    else:
        raise EditError(f"パラメータ {param_id} がありません")

    new_id = parameter["id"]
    if new_id != param_id:
        for screen in result["screens"]:
            _visit(screen["children"], lambda node: _rename_param(node, param_id, new_id))
    return result


def _rename_param(node: dict[str, Any], old: str, new: str) -> None:
    if node["kind"] == "control" and node["param"] == old:
        node["param"] = new


def remove_parameter(definition: Definition, param_id: str) -> Definition:
    """パラメータを消す。それを参照する配置上の部品も一緒に消す(参照が宙に浮かないように)。"""
    result = copy.deepcopy(definition)
    before = len(result["parameters"])
    result["parameters"] = [p for p in result["parameters"] if p["id"] != param_id]
    if len(result["parameters"]) == before:
        raise EditError(f"パラメータ {param_id} がありません")
    for screen in result["screens"]:
        screen["children"] = _without_param(screen["children"], param_id)
    return result


def _without_param(nodes: list[dict[str, Any]], param_id: str) -> list[dict[str, Any]]:
    kept: list[dict[str, Any]] = []
    for node in nodes:
        if node["kind"] == "control":
            if node["param"] != param_id:
                kept.append(node)
            continue
        if node["kind"] == "tabs":
            for tab in node["tabs"]:
                tab["children"] = _without_param(tab["children"], param_id)
        else:
            node["children"] = _without_param(node["children"], param_id)
        kept.append(node)
    return kept


def _visit(nodes: list[dict[str, Any]], action: Any) -> None:
    for node in nodes:
        action(node)
        if node["kind"] == "tabs":
            for tab in node["tabs"]:
                _visit(tab["children"], action)
        elif node["kind"] != "control":
            _visit(node["children"], action)


def placed_parameter_ids(definition: Definition) -> set[str]:
    placed: set[str] = set()

    def collect(node: dict[str, Any]) -> None:
        if node["kind"] == "control":
            placed.add(node["param"])

    for screen in definition["screens"]:
        _visit(screen["children"], collect)
    return placed


def unplaced_parameter_ids(definition: Definition) -> list[str]:
    placed = placed_parameter_ids(definition)
    return [p["id"] for p in definition["parameters"] if p["id"] not in placed]


# --- 画面層 -----------------------------------------------------------------


def add_control(definition: Definition, screen: int, param_id: str, steps: tuple[Step, ...] = ()) -> Definition:
    """param_id の部品を、指定した入れ子の末尾へ置く。"""
    if all(p["id"] != param_id for p in definition["parameters"]):
        raise EditError(f"パラメータ {param_id} がありません")
    result = copy.deepcopy(definition)
    _children(result, screen, steps).append({"kind": "control", "param": param_id})
    return result


def remove_node(definition: Definition, ref: NodeRef) -> Definition:
    result = copy.deepcopy(definition)
    nodes, index = _locate(result, ref)
    del nodes[index]
    return result


def move_node(definition: Definition, ref: NodeRef, delta: Literal[-1, 1]) -> Definition:
    """同じ入れ子の中で 1 つ前/後ろへ動かす。端では動かさない(エラーにはしない)。"""
    result = copy.deepcopy(definition)
    nodes, index = _locate(result, ref)
    target = index + delta
    if 0 <= target < len(nodes):
        nodes[index], nodes[target] = nodes[target], nodes[index]
    return result


def wrap_node(definition: Definition, ref: NodeRef, kind: str, label: str = "グループ") -> Definition:
    """対象を行・列・グループで包む(横並び・グループ化の入口)。"""
    if kind not in WRAP_KINDS:
        raise EditError(f"包めない種類です: {kind}")
    result = copy.deepcopy(definition)
    nodes, index = _locate(result, ref)
    wrapper: dict[str, Any] = {"kind": kind, "children": [nodes[index]]}
    if kind == "group":
        wrapper["label"] = label
    nodes[index] = wrapper
    return result


def merge_with_next(definition: Definition, ref: NodeRef) -> Definition:
    """対象とすぐ後ろの兄弟を 1 つの行にまとめる(横並びにする基本操作)。

    対象が行ならその末尾へ、そうでなければ対象を行で包んでから後ろの兄弟を足す。
    """
    result = copy.deepcopy(definition)
    nodes, index = _locate(result, ref)
    if index + 1 >= len(nodes):
        raise EditError("後ろに並べる部品がありません")
    nxt = nodes.pop(index + 1)
    current = nodes[index]
    if current["kind"] == "row":
        current["children"].append(nxt)
    else:
        nodes[index] = {"kind": "row", "children": [current, nxt]}
    return result


def unwrap_node(definition: Definition, ref: NodeRef) -> Definition:
    """行・列・グループを解いて、中身をその場に展開する。"""
    result = copy.deepcopy(definition)
    nodes, index = _locate(result, ref)
    node = nodes[index]
    if node["kind"] not in WRAP_KINDS:
        raise EditError("解けるのは行・列・グループだけです")
    nodes[index : index + 1] = node["children"]
    return result


def set_width(definition: Definition, ref: NodeRef, width: int | Literal["auto"] | None) -> Definition:
    """幅を変える。None は指定なし(キーを消す)。範囲の検証は定義の検証に任せる。"""
    result = copy.deepcopy(definition)
    nodes, index = _locate(result, ref)
    if width is None:
        nodes[index].pop("width", None)
    else:
        nodes[index]["width"] = width
    return result


def set_collapsed(definition: Definition, ref: NodeRef, collapsed: bool) -> Definition:
    result = copy.deepcopy(definition)
    nodes, index = _locate(result, ref)
    if nodes[index]["kind"] != "group":
        raise EditError("折りたたみの初期状態はグループだけが持ちます")
    nodes[index]["collapsed"] = collapsed
    return result


def set_label(definition: Definition, ref: NodeRef, label: str) -> Definition:
    result = copy.deepcopy(definition)
    nodes, index = _locate(result, ref)
    node = nodes[index]
    if node["kind"] not in ("group", "control"):
        raise EditError("表示名を持つのはグループと部品だけです")
    node["label"] = label
    return result


def rename_definition(definition: Definition, name: str) -> Definition:
    result = copy.deepcopy(definition)
    result["name"] = name
    return result


def new_definition(name: str = "New") -> Definition:
    """空の定義から始める(画面は 1 つ持たせ、すぐ部品を置ける)。"""
    return {
        "format": "oscdesk-surface",
        "version": 1,
        "name": name,
        "parameters": [],
        "screens": [{"id": "main", "label": "Main", "children": []}],
    }


class EditSession:
    """編集中の作業コピーと、その出発点の記録。

    採用中の定義(Unity/ブリッジが正)を直接いじらず、検証に通った変更だけを作業コピーへ
    取り込む。出発点の revision を覚えておき、他の端末が先に保存したか(競合)を判定する。
    """

    def __init__(self, definition: Definition, base_revision: int, base_name: str | None) -> None:
        self.draft: Definition = copy.deepcopy(definition)
        self.base_revision = base_revision
        self.base_name = base_name
        self._saved: Definition = copy.deepcopy(definition)

    @property
    def dirty(self) -> bool:
        return self.draft != self._saved

    def apply(self, edit: Any, *args: Any, **kwargs: Any) -> str | None:
        """編集関数を適用する。検証に通らなければ作業コピーを変えず、理由を返す。"""
        # 循環 import を避けるため、検証は呼ぶ時点で取り込む
        from .surface_definition import SurfaceDefinitionError, validate_surface_definition

        try:
            candidate = edit(self.draft, *args, **kwargs)
            validate_surface_definition(candidate)
        except (EditError, SurfaceDefinitionError, KeyError, TypeError) as error:
            return str(error)
        self.draft = candidate
        return None

    def replace(self, definition: Definition) -> str | None:
        """定義を丸ごと差し替える(アップロード・最新の取り直し)。検証に通らなければ変えない。"""
        return self.apply(lambda _current: copy.deepcopy(definition))

    def is_conflicted(self, current_revision: int) -> bool:
        """編集を始めたあとに、採用中の定義が(他の端末の保存などで)変わったか。"""
        return current_revision != self.base_revision

    def mark_saved(self, revision: int, name: str | None) -> None:
        """保存が採用されたあとの出発点へ更新する。"""
        self._saved = copy.deepcopy(self.draft)
        self.base_revision = revision
        self.base_name = name


def _number_or_none(raw: str, label: str, *, integer: bool) -> int | float | None:
    text = raw.strip()
    if not text:
        return None
    try:
        number = float(text)
    except ValueError as error:
        raise EditError(f"{label} は数値で入力してください") from error
    if integer or number.is_integer():
        return int(number) if number.is_integer() else number
    return number


def build_parameter(form: dict[str, Any]) -> dict[str, Any]:
    """編集フォームの入力(文字列中心)から、パラメータ定義の dict を組み立てる。

    空欄は「指定なし」としてキーごと省く。値域や相互関係の正否はここでは見ず、
    定義全体の検証(EditSession.apply)に任せる。
    """
    kind = form["kind"]
    type_ = form["type"]
    parameter: dict[str, Any] = {
        "id": form["id"].strip(),
        "address": form["address"].strip(),
        "label": form["label"].strip(),
        "kind": kind,
        "type": type_,
    }
    if not form.get("standalone", True):
        parameter["standalone"] = False

    numeric = type_ in ("i", "f")
    low = _number_or_none(form.get("min", ""), "最小", integer=type_ == "i")
    high = _number_or_none(form.get("max", ""), "最大", integer=type_ == "i")
    if numeric and kind == "state" and (low is not None or high is not None):
        if low is None or high is None:
            raise EditError("範囲は最小と最大を両方入力してください")
        parameter["range"] = [low, high]
    step = _number_or_none(form.get("step", ""), "刻み", integer=type_ == "i")
    if numeric and kind == "state" and step is not None:
        parameter["step"] = step

    options = [item.strip() for item in form.get("options", "").split(",") if item.strip()]
    if type_ == "s" and kind == "state" and options:
        parameter["options"] = options

    for field, key in (("default", "default"), ("value", "value")):
        if field == "default" and kind != "state":
            continue
        if field == "value" and kind != "trigger":
            continue
        raw = form.get(field, "")
        if type_ == "bool":
            if raw in ("true", "false"):
                parameter[key] = raw == "true"
        elif numeric:
            number = _number_or_none(raw, "既定値" if key == "default" else "送信値", integer=type_ == "i")
            if number is not None:
                parameter[key] = number
        elif raw != "":
            parameter[key] = raw
    return parameter
