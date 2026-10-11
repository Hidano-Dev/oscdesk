"""サーフェス定義(D-043)から、UI が部品を作るための情報を取り出す。

検証は surface_definition.py と protocol.py のデコードで済んでいる前提で、ここでは
パラメータ層(アドレス・型・値域)と画面層(配置)を ControlSpec へ畳み込むだけにする。
ウィジェット生成(widgets.py)・値の調停(state.py)はこの型だけを見る。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Final

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
class ScreenModel:
    id: str
    label: str
    controls: tuple[ControlSpec, ...]


@dataclass(frozen=True)
class SurfaceModel:
    name: str
    # パラメータごとに 1 件(既定の部品)。アドレスでの引き当てと値の調停に使う
    parameters: tuple[ControlSpec, ...]
    screens: tuple[ScreenModel, ...]

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
        value=parameter.get("value"),
    )


def _collect_controls(
    nodes: list[dict[str, Any]],
    by_id: dict[str, dict[str, Any]],
    out: list[ControlSpec],
) -> None:
    # 行・列・グループ・タブの入れ子は、この段階では出現順に平らにする(配置の描画は HID-163)
    for node in nodes:
        kind = node["kind"]
        if kind == "control":
            parameter = by_id[node["param"]]
            out.append(
                _spec(
                    parameter,
                    node.get("widget") or default_widget(parameter),
                    node.get("label") or parameter["label"],
                )
            )
        elif kind == "tabs":
            for tab in node["tabs"]:
                _collect_controls(tab["children"], by_id, out)
        else:
            _collect_controls(node["children"], by_id, out)


def parse_surface(definition: dict[str, Any]) -> SurfaceModel:
    """検証済みの定義から SurfaceModel を作る。未検証の入力は渡さない。"""
    by_id = {parameter["id"]: parameter for parameter in definition["parameters"]}
    parameters = tuple(
        _spec(parameter, default_widget(parameter), parameter["label"]) for parameter in definition["parameters"]
    )
    screens = []
    for screen in definition["screens"]:
        controls: list[ControlSpec] = []
        _collect_controls(screen["children"], by_id, controls)
        screens.append(ScreenModel(id=screen["id"], label=screen["label"], controls=tuple(controls)))
    return SurfaceModel(name=definition["name"], parameters=parameters, screens=tuple(screens))
