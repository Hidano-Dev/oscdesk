"""サーフェス定義(D-043)から、UI が部品を作るための情報を取り出す。

検証は surface_definition.py と protocol.py のデコードで済んでいる前提で、ここでは
パラメータ層(アドレス・型・値域)と画面層(配置)を ControlSpec へ畳み込むだけにする。
ウィジェット生成(widgets.py)・値の調停(state.py)はこの型だけを見る。
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any, Final, Sequence

from .surface_definition import NO_FIXED_VALUE, OSC_BATCH_MAX_MESSAGES, resolve_action_steps

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
class RecordSpec:
    """レコード型パラメータ(D-061)。1 行 = 1 メッセージ `[s:key, フィールドを宣言順に]`。

    fields はフィールドごとの ControlSpec(param_id = フィールド id、address = レコードの address、
    kind = レコードの kind)。部品の生成と入力の検証(entry_rules)を通常のパラメータと共有するため同じ型にする。
    """

    record_id: str
    address: str
    label: str
    kind: str
    key_label: str
    keys_from_address: str
    fields: tuple[ControlSpec, ...]

    def field_index(self, field_id: str) -> int:
        for index, field in enumerate(self.fields):
            if field.param_id == field_id:
                return index
        raise KeyError(field_id)

    def initial_values(self) -> tuple[Any, ...]:
        """新しい行の値(宣言順)。state はフィールドの default、trigger は value(TS の recordInitialValues)。"""
        return tuple(field.default if self.kind == "state" else field.value for field in self.fields)

    def key_of(self, args: tuple[Any, ...]) -> str | None:
        """受けた引数(WireArg の列)が正しい 1 行ならキー、でなければ None(TS の recordKeyOf と同じ規則)。

        数値は i / f のどちらも受け、bool は 0 / 1 を受ける。optionsFrom を持つ s は options への所属を問わない。
        """
        if len(args) != len(self.fields) + 1:
            return None
        head = args[0]
        if head.type != "s" or not isinstance(head.value, str):
            return None
        for field, arg in zip(self.fields, args[1:]):
            if not _field_accepts(field, arg):
                return None
        return head.value


def _field_accepts(field: ControlSpec, arg: Any) -> bool:
    if field.type == "s":
        return arg.type == "s" and (
            field.options is None or field.options_from_address is not None or arg.value in field.options
        )
    if arg.type not in ("i", "f") or isinstance(arg.value, bool) or not isinstance(arg.value, (int, float)):
        return False
    if field.type == "bool":
        return arg.value in (0, 1)
    return field.value_range is None or field.value_range[0] <= arg.value <= field.value_range[1]


@dataclass(frozen=True)
class RecordStep:
    """scope を持つアクションの 1 step。fixed は (フィールドの添字, 固定値)。trigger レコードでは常に空。"""

    record: RecordSpec
    fixed: tuple[tuple[int, Any], ...] = ()


@dataclass(frozen=True)
class RecordTarget:
    """record step を行のキーで展開した 1 メッセージ分。"""

    record: RecordSpec
    key: str
    fixed: tuple[tuple[int, Any], ...] = ()


@dataclass(frozen=True)
class ActionSpec:
    """押すと複数のパラメータを 1 つの oscBatch でまとめて送るボタン(HID-166)。

    scope("row" / "all")を持つアクション(D-061)は targets を持たず、record_steps を押下時に行のキーで展開する。
    """

    action_id: str
    label: str
    targets: tuple[ActionTarget, ...]
    scope: str | None = None
    record_steps: tuple[RecordStep, ...] = ()

    @property
    def records(self) -> tuple[RecordSpec, ...]:
        """record step が参照するレコード(重複を除いて出現順)。"""
        seen: dict[str, RecordSpec] = {}
        for step in self.record_steps:
            seen.setdefault(step.record.record_id, step.record)
        return tuple(seen.values())


def resolve_record_action_steps(action: ActionSpec, keys: Sequence[str]) -> list[RecordTarget]:
    """scope を持つアクションを行のキーごとの送信対象へ展開する(TS の resolveRecordActionSteps と同じ規則)。

    row は押した行のキー 1 つ、all は表示中の全行のキーを表示順に渡す。並びは行ごとに steps を定義順
    (行1の全 step → 行2の全 step …)。1 bundle の上限(512 件)を超えた時点で打ち切るので、
    結果が上限を超えていたら呼び出し側は送らずに通知する。
    """
    resolved: list[RecordTarget] = []
    for key in keys:
        for step in action.record_steps:
            resolved.append(RecordTarget(step.record, key, step.fixed))
            if len(resolved) > OSC_BATCH_MAX_MESSAGES:
                return resolved
    return resolved


@dataclass(frozen=True)
class RecordColumn:
    """レコード表の 1 列。spec はフィールドの ControlSpec に列の部品ヒントと表示名を重ねたもの。

    actions は列の直下(表の枠内のフッター行)に出す scope "all" のアクション(列の一括操作。D-066)。
    """

    field_index: int
    spec: ControlSpec
    actions: tuple[ActionSpec, ...] = ()


@dataclass(frozen=True)
class RecordNode:
    record: RecordSpec
    label: str
    columns: tuple[RecordColumn, ...]
    row_actions: tuple[ActionSpec, ...] = ()
    width: int | None = None


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


LayoutNode = ControlNode | ActionNode | RecordNode | RowNode | ColumnNode | GroupNode | TabsNode


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
    records: tuple[RecordSpec, ...] = ()

    def spec_for_address(self, address: str) -> ControlSpec | None:
        for spec in self.parameters:
            if spec.address == address:
                return spec
        return None

    def record(self, record_id: str) -> RecordSpec | None:
        for record in self.records:
            if record.record_id == record_id:
                return record
        return None


def default_widget(parameter: dict[str, Any]) -> str:
    """control に widget の指定が無いときの部品。型と属性だけから決める。"""
    if parameter["kind"] == "trigger":
        return "button"
    type_ = parameter["type"]
    if type_ == "bool":
        return "switch"
    if type_ == "s":
        # optionsFrom があれば、一覧が届く前でも select(候補は静的な options だけ。D-053)
        return "select" if parameter.get("options") or parameter.get("optionsFrom") else "input"
    return "slider" if "range" in parameter else "input"


def _spec(parameter: dict[str, Any], widget: str, label: str) -> ControlSpec:
    value_range = parameter.get("range")
    options = parameter.get("options")
    options_from = parameter.get("optionsFrom")
    if widget == "select" and not options and options_from is None:
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
        # optionsFrom の select は静的な options が無くても候補(Unity の一覧)が後から届くので、空の組で持つ
        options=tuple(options) if options is not None else (() if options_from is not None and widget == "select" else None),
        options_from_address=None if options_from is None else options_from["address"],
        value=parameter.get("value"),
    )


def _width(node: dict[str, Any]) -> int | None:
    # 'auto' は描画側に任せる(None)。数値は 12 分割グリッドの占有幅
    width = node.get("width")
    return None if width in (None, "auto") else int(width)


def _field_parameter(record: dict[str, Any], field: dict[str, Any]) -> dict[str, Any]:
    """フィールドを「kind がレコードの kind・address がレコードの address のパラメータ」とみなす(D-061 の widget 判定と同じ)。"""
    return {**field, "kind": record["kind"], "address": record["address"]}


def _build_record(record: dict[str, Any]) -> RecordSpec:
    fields = []
    for field in record["fields"]:
        parameter = _field_parameter(record, field)
        fields.append(_spec(parameter, default_widget(parameter), field["label"]))
    return RecordSpec(
        record_id=record["id"],
        address=record["address"],
        label=record["label"],
        kind=record["kind"],
        key_label=(record.get("key") or {}).get("label") or "キー",
        keys_from_address=record["keysFrom"]["address"],
        fields=tuple(fields),
    )


def _build_record_node(
    node: dict[str, Any], records: dict[str, RecordSpec], raw_records: dict[str, dict[str, Any]], actions: dict[str, ActionSpec]
) -> RecordNode:
    record = records[node["record"]]
    raw = raw_records[node["record"]]
    raw_fields = {field["id"]: field for field in reversed(raw["fields"])}  # 重複 id は先勝ち(検証と同じ)
    columns_def = node.get("columns") or [{"field": field["id"]} for field in raw["fields"]]
    columns = []
    for column in columns_def:
        parameter = _field_parameter(raw, raw_fields[column["field"]])
        widget = column.get("widget") or default_widget(parameter)
        columns.append(
            RecordColumn(
                field_index=record.field_index(column["field"]),
                spec=_spec(parameter, widget, column.get("label") or parameter["label"]),
                actions=tuple(actions[action_id] for action_id in column.get("actions", [])),
            )
        )
    return RecordNode(
        record=record,
        label=node.get("label") or record.label,
        columns=tuple(columns),
        row_actions=tuple(actions[action_id] for action_id in node.get("rowActions", [])),
        width=_width(node),
    )


def _build_action(action: dict[str, Any], parameters: list[dict[str, Any]], records: dict[str, RecordSpec]) -> ActionSpec:
    if "scope" in action:
        steps = []
        for step in action["steps"]:
            record = records.get(step.get("record", ""))
            if record is None:
                continue  # 検証済みなので通常は無い(未知のレコードは TS と同じく無視する)
            fixed: tuple[tuple[int, Any], ...] = ()
            if record.kind == "state" and "value" in step:
                fixed = tuple((record.field_index(field_id), value) for field_id, value in step["value"].items())
            steps.append(RecordStep(record, fixed))
        return ActionSpec(
            action_id=action["id"], label=action["label"], targets=(), scope=action["scope"], record_steps=tuple(steps)
        )
    targets = tuple(
        ActionTarget(
            spec=_spec(parameter, default_widget(parameter), parameter["label"]),
            has_fixed_value=fixed is not NO_FIXED_VALUE,
            fixed_value=None if fixed is NO_FIXED_VALUE else fixed,
        )
        for parameter, fixed in resolve_action_steps(action, parameters)
    )
    return ActionSpec(action_id=action["id"], label=action["label"], targets=targets)


@dataclass(frozen=True)
class _BuildContext:
    by_id: dict[str, dict[str, Any]]
    actions: dict[str, ActionSpec]
    records: dict[str, RecordSpec]
    raw_records: dict[str, dict[str, Any]]


def _build_nodes(nodes: list[dict[str, Any]], ctx: _BuildContext, out: list[ControlSpec]) -> tuple[LayoutNode, ...]:
    result: list[LayoutNode] = []
    for node in nodes:
        kind = node["kind"]
        width = _width(node)
        if kind == "control":
            parameter = ctx.by_id[node["param"]]
            spec = _spec(
                parameter,
                node.get("widget") or default_widget(parameter),
                node.get("label") or parameter["label"],
            )
            out.append(spec)
            result.append(ControlNode(spec, width))
        elif kind == "action":
            action = ctx.actions[node["action"]]
            if node.get("label"):
                action = replace(action, label=node["label"])
            result.append(ActionNode(action, width))
        elif kind == "record":
            result.append(_build_record_node(node, ctx.records, ctx.raw_records, ctx.actions))
        elif kind == "tabs":
            tabs = tuple(TabModel(tab["label"], _build_nodes(tab["children"], ctx, out)) for tab in node["tabs"])
            result.append(TabsNode(tabs, width))
        elif kind == "group":
            result.append(
                GroupNode(node["label"], bool(node.get("collapsed", False)), _build_nodes(node["children"], ctx, out), width)
            )
        elif kind == "row":
            result.append(RowNode(_build_nodes(node["children"], ctx, out), width))
        else:
            result.append(ColumnNode(_build_nodes(node["children"], ctx, out), width))
    return tuple(result)


def parse_surface(definition: dict[str, Any]) -> SurfaceModel:
    """検証済みの定義から SurfaceModel を作る。未検証の入力は渡さない。"""
    by_id = {parameter["id"]: parameter for parameter in definition["parameters"]}
    parameters = tuple(
        _spec(parameter, default_widget(parameter), parameter["label"]) for parameter in definition["parameters"]
    )
    raw_records = {record["id"]: record for record in definition.get("records", [])}
    records = {record_id: _build_record(record) for record_id, record in raw_records.items()}
    actions = {
        action["id"]: _build_action(action, definition["parameters"], records) for action in definition.get("actions", [])
    }
    ctx = _BuildContext(by_id=by_id, actions=actions, records=records, raw_records=raw_records)
    screens = []
    for screen in definition["screens"]:
        controls: list[ControlSpec] = []
        layout = _build_nodes(screen["children"], ctx, controls)
        screens.append(ScreenModel(id=screen["id"], label=screen["label"], controls=tuple(controls), layout=layout))
    return SurfaceModel(
        name=definition["name"],
        parameters=parameters,
        screens=tuple(screens),
        actions=tuple(actions.values()),
        records=tuple(records.values()),
    )
