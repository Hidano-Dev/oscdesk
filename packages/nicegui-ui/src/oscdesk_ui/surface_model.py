"""サーフェス定義(D-043)から、UI が部品を作るための情報を取り出す。

検証は surface_definition.py と protocol.py のデコードで済んでいる前提で、ここでは
パラメータ層(アドレス・型・値域)と画面層(配置)を ControlSpec へ畳み込むだけにする。
ウィジェット生成(widgets.py)・値の調停(state.py)はこの型だけを見る。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Final

from .surface_definition import NO_FIXED_VALUE, resolve_action_steps

WIDGET_TYPES: Final = ("slider", "switch", "button", "input", "select")


@dataclass(frozen=True)
class ControlSpec:
    """1 つのパラメータを 1 か所に置いたときの、描画と送信に必要な情報。"""

    param_id: str
    address: str
    label: str
    type: str
    kind: str
    widget: str
    standalone: bool = True
    value_range: tuple[float, float] | None = None
    step: float | None = None
    default: Any = None
    has_default: bool = False
    options: tuple[str, ...] | None = None
    # Unity から一覧を受けるアドレス(D-053 / D-054)。あれば options は先頭の固定候補にすぎず、値の所属を問わない
    options_from_address: str | None = None
    # kind == "trigger" のとき、押下で送る値(定義が必ず明示する)
    value: Any = None

    @property
    def type_tag(self) -> str:
        """OSC 型タグ。bool は 0/1 の int として送る(DESIGN.md D-017)。"""
        if self.type == "bool":
            return "i"
        return self.type

    def clamp(self, value: float) -> float:
        if self.value_range is None:
            return value
        low, high = self.value_range
        return min(max(value, low), high)


@dataclass(frozen=True)
class ActionTarget:
    """アクションが送る 1 メッセージ分。値は押下時に state が現在値から決める(固定値があればそれ)。"""

    spec: ControlSpec
    has_fixed_value: bool = False
    fixed_value: Any = None


@dataclass(frozen=True)
class ActionSpec:
    """押すと複数のパラメータを 1 つの oscBatch でまとめて送るボタン(HID-166)。"""

    action_id: str
    label: str
    targets: tuple[ActionTarget, ...]


@dataclass(frozen=True)
class ActionNode:
    action: ActionSpec
    width: int | None = None


@dataclass(frozen=True)
class ControlNode:
    spec: ControlSpec
    width: int | None = None


@dataclass(frozen=True)
class RowNode:
    children: tuple["LayoutNode", ...]
    width: int | None = None


@dataclass(frozen=True)
class ColumnNode:
    children: tuple["LayoutNode", ...]
    width: int | None = None


@dataclass(frozen=True)
class GroupNode:
    label: str
    collapsed: bool
    children: tuple["LayoutNode", ...]
    width: int | None = None


@dataclass(frozen=True)
class TabModel:
    label: str
    children: tuple["LayoutNode", ...]


@dataclass(frozen=True)
class TabsNode:
    tabs: tuple[TabModel, ...]
    width: int | None = None


LayoutNode = ControlNode | ActionNode | RowNode | ColumnNode | GroupNode | TabsNode


@dataclass(frozen=True)
class ScreenModel:
    id: str
    label: str
    # 出現順に平らにした部品(アドレス引き当て・テスト用)。配置は layout が持つ
    controls: tuple[ControlSpec, ...]
    layout: tuple[LayoutNode, ...] = ()


@dataclass(frozen=True)
class SurfaceModel:
    name: str
    # パラメータごとに 1 件(既定の部品)。アドレスでの引き当てと値の調停に使う
    parameters: tuple[ControlSpec, ...]
    screens: tuple[ScreenModel, ...]
    actions: tuple[ActionSpec, ...] = ()

    def spec_for_address(self, address: str) -> ControlSpec | None:
        for spec in self.parameters:
            if spec.address == address:
                return spec
        return None


def default_widget(parameter: dict[str, Any]) -> str:
    """control に widget の指定が無いときの部品。型と属性だけから決める。"""
    if parameter["kind"] == "trigger":
        return "button"
    type_ = parameter["type"]
    if type_ == "bool":
        return "switch"
    if type_ == "s":
        return "select" if parameter.get("options") else "input"
    return "slider" if "range" in parameter else "input"


def _spec(parameter: dict[str, Any], widget: str, label: str) -> ControlSpec:
    value_range = parameter.get("range")
    options = parameter.get("options")
    if widget == "select" and not options:
        # 静的な候補の無い select は optionsFrom のときだけ定義に通る。一覧を UI へ重ねる(HID-206)までは
        # 候補が空で操作できない欄になるため、入力欄で代える(D-054)
        widget = "input"
    return ControlSpec(
        param_id=parameter["id"],
        address=parameter["address"],
        label=label,
        type=parameter["type"],
        kind=parameter["kind"],
        widget=widget,
        standalone=parameter.get("standalone", True),
        value_range=None if value_range is None else (float(value_range[0]), float(value_range[1])),
        step=parameter.get("step"),
        default=parameter.get("default"),
        has_default="default" in parameter,
        options=None if options is None else tuple(options),
        options_from_address=parameter.get("optionsFrom", {}).get("address"),
        value=parameter.get("value"),
    )


def _width(node: dict[str, Any]) -> int | None:
    # 'auto' は描画側に任せる(None)。数値は 12 分割グリッドの占有幅
    width = node.get("width")
    return None if width in (None, "auto") else int(width)


def _build_action(action: dict[str, Any], parameters: list[dict[str, Any]]) -> ActionSpec:
    targets = tuple(
        ActionTarget(
            spec=_spec(parameter, default_widget(parameter), parameter["label"]),
            has_fixed_value=fixed is not NO_FIXED_VALUE,
            fixed_value=None if fixed is NO_FIXED_VALUE else fixed,
        )
        for parameter, fixed in resolve_action_steps(action, parameters)
    )
    return ActionSpec(action_id=action["id"], label=action["label"], targets=targets)


def _build_nodes(
    nodes: list[dict[str, Any]],
    by_id: dict[str, dict[str, Any]],
    out: list[ControlSpec],
    actions: dict[str, ActionSpec],
) -> tuple[LayoutNode, ...]:
    result: list[LayoutNode] = []
    for node in nodes:
        kind = node["kind"]
        width = _width(node)
        if kind == "control":
            parameter = by_id[node["param"]]
            spec = _spec(
                parameter,
                node.get("widget") or default_widget(parameter),
                node.get("label") or parameter["label"],
            )
            out.append(spec)
            result.append(ControlNode(spec, width))
        elif kind == "action":
            action = actions[node["action"]]
            if node.get("label"):
                action = ActionSpec(action.action_id, node["label"], action.targets)
            result.append(ActionNode(action, width))
        elif kind == "tabs":
            tabs = tuple(
                TabModel(tab["label"], _build_nodes(tab["children"], by_id, out, actions)) for tab in node["tabs"]
            )
            result.append(TabsNode(tabs, width))
        elif kind == "group":
            result.append(
                GroupNode(
                    node["label"], bool(node.get("collapsed", False)), _build_nodes(node["children"], by_id, out, actions), width
                )
            )
        elif kind == "row":
            result.append(RowNode(_build_nodes(node["children"], by_id, out, actions), width))
        else:
            result.append(ColumnNode(_build_nodes(node["children"], by_id, out, actions), width))
    return tuple(result)


def parse_surface(definition: dict[str, Any]) -> SurfaceModel:
    """検証済みの定義から SurfaceModel を作る。未検証の入力は渡さない。"""
    by_id = {parameter["id"]: parameter for parameter in definition["parameters"]}
    parameters = tuple(
        _spec(parameter, default_widget(parameter), parameter["label"]) for parameter in definition["parameters"]
    )
    actions = {
        action["id"]: _build_action(action, definition["parameters"]) for action in definition.get("actions", [])
    }
    screens = []
    for screen in definition["screens"]:
        controls: list[ControlSpec] = []
        layout = _build_nodes(screen["children"], by_id, controls, actions)
        screens.append(ScreenModel(id=screen["id"], label=screen["label"], controls=tuple(controls), layout=layout))
    return SurfaceModel(
        name=definition["name"], parameters=parameters, screens=tuple(screens), actions=tuple(actions.values())
    )
