"""ブリッジが配る「表示する部品の木」(surface フレームの view。D-124)を、UI が描くための型へ読み込む。

部品の種類・ラベル・取り直しのボタン・レコード表の列・アクションの対象の展開は、ブリッジ(packages/shared の
surface-view.ts)が採用した定義から決めて配る。ここはその木を ControlSpec などの型へ写すだけで、規則を持たない。
ウィジェット生成(widgets.py)・値の調停(state.py)はこの型だけを見る。
部品・行・一覧はパラメータ id・レコード id・一覧の id で指し、OSC のアドレスは持たない(HID-389・D-117)。
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any, Final, Mapping, Sequence

from .surface_definition import OSC_BATCH_MAX_MESSAGES

WIDGET_TYPES: Final = ("slider", "switch", "button", "input", "select")


@dataclass(frozen=True)
class ControlSpec:
    """1 つのパラメータを 1 か所に置いたときの、描画と送信に必要な情報。"""

    param_id: str
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
    # 実行時の一覧(optionsFrom の一覧の id。D-053 / D-054)。あれば options は先頭の固定候補にすぎず、値の所属を問わない
    options_from: str | None = None
    # その一覧を取り直せるとき(要求を持つ一覧)の一覧の id。あれば一覧の近くに Sync を出せる(D-077)
    options_sync: str | None = None
    # kind == "trigger" のとき、押下で送る値(定義が必ず明示する)
    value: Any = None
    # 組み合わせの型(type == "composite"。HID-380・D-121)のフィールド(param_id = フィールド id、kind = パラメータの kind)。
    # 値の表示キャッシュはフィールドの値を宣言順に並べた組で持つ(1 つの値の部品は要素 1 個の組)
    fields: tuple["ControlSpec", ...] = ()
    # 組み合わせの型の表示ヒントの名前(color など)。知らない名前ならフィールドごとの部品を並べる
    hint: str | None = None

    @property
    def is_composite(self) -> bool:
        return self.type == "composite"

    @property
    def default_values(self) -> tuple[Any, ...]:
        """default を表示キャッシュの組にしたもの(has_default のときだけ使う)。"""
        if self.is_composite:
            return tuple(field.default for field in self.fields)
        return (self.default,)

    def wire_value(self, values: Sequence[Any]) -> Any:
        """表示キャッシュの組を set・batch の値(JSON の値)にする。組の形が合わなければ ValueError。

        組み合わせの型はフィールド id → 値のオブジェクト(D-121)。ほかは 1 つの値。
        """
        if self.is_composite:
            if len(values) != len(self.fields):
                raise ValueError(f"{self.param_id} expects {len(self.fields)} field values, got {len(values)}")
            return {field.param_id: json_value(field, value) for field, value in zip(self.fields, values)}
        if len(values) != 1:
            raise ValueError(f"{self.param_id} expects a single value, got {len(values)}")
        return json_value(self, values[0])

    def values_from_wire(self, value: Any) -> tuple[Any, ...] | None:
        """desired・echo の値を表示キャッシュの組にする。組の形にできなければ None。

        型と値域の判定はブリッジが配る前に済ませている(float32 の丸めで範囲の端を越えた値の寄せも。D-124)ので、
        ここでは形だけを見る(組み合わせの型はフィールドが揃ったオブジェクト、ほかは 1 つの値)。
        """
        if not self.is_composite:
            return None if isinstance(value, dict) else (value,)
        if not isinstance(value, Mapping) or set(value) != {field.param_id for field in self.fields}:
            return None
        return tuple(value[field.param_id] for field in self.fields)

    @property
    def sync_request(self) -> str | None:
        """この部品の近くに Sync(D-077)を出すなら、取り直す一覧の id。

        候補が見えるのは select だけなので、input などの部品にしたときは出さない(押しても画面が何も変わらない)。
        """
        return self.options_sync if self.widget == "select" else None

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
    """レコード型パラメータ(D-061)。1 行 = キーとフィールドの値(宣言順)。

    fields はフィールドごとの ControlSpec(param_id = フィールド id、kind = レコードの kind)。部品の生成と入力の検証
    (entry_rules)を通常のパラメータと共有するため同じ型にする。行はレコード id と行のキーで指す(HID-389)。
    """

    record_id: str
    label: str
    kind: str
    key_label: str
    # キーの一覧(keysFrom の一覧の id)
    keys_from: str
    fields: tuple[ControlSpec, ...]
    # キーの出どころ(D-075)。"unity" は Unity の一覧、"ui" は通常の画面で追加・削除してブリッジが持つ一覧
    keys_source: str = "unity"
    # "ui" の一覧の上限(None は上限なし)
    keys_max: int | None = None
    # キーの一覧を取り直せるとき(要求を持つ一覧)の一覧の id。あればキーの列の見出しに Sync を出す(D-077)
    keys_sync: str | None = None
    # 新しい行の値(宣言順。state はフィールドの default、trigger は value)。ブリッジが部品の木に入れて配る
    initial: tuple[Any, ...] = ()

    def field_index(self, field_id: str) -> int:
        for index, field in enumerate(self.fields):
            if field.param_id == field_id:
                return index
        raise KeyError(field_id)

    @property
    def has_row_ids(self) -> bool:
        """行が変わらない ID と変えられる Name を持つか(keysFrom.source "ui"。D-087)。このとき行のキーは ID。"""
        return self.keys_source == "ui"

    def initial_values(self) -> tuple[Any, ...]:
        """新しい行の値(宣言順)。ブリッジも同じ値で行を作って desired を配る(D-061)。"""
        return self.initial

    def row_values(self, values: Mapping[str, Any]) -> tuple[Any, ...] | None:
        """届いた行の値(フィールド id → 値)を宣言順に並べる。フィールドが揃わなければ None。

        型と値域の判定はブリッジが配る前に済ませている(D-122・D-124)ので、ここでは形だけを見る。
        """
        if not all(field.param_id in values for field in self.fields):
            return None
        return tuple(values[field.param_id] for field in self.fields)


def json_value(spec: ControlSpec, value: Any) -> Any:
    """基本型の値を型どおりの JSON の値に揃える(bool は true/false のまま。0/1 への直しはブリッジ)。"""
    if spec.type == "bool":
        return bool(value)
    if spec.type == "f":
        return float(value)
    if spec.type == "i":
        return int(value)
    return value


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
    truncated はまとめ送りの上限を超えるアクションの印(ブリッジが付け、targets は空。押すと送らずに知らせる。D-128)。
    """

    action_id: str
    label: str
    targets: tuple[ActionTarget, ...]
    scope: str | None = None
    record_steps: tuple[RecordStep, ...] = ()
    truncated: bool = False

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
    toggle は同じ場所に出す一括トグル(D-073)。
    """

    field_index: int
    spec: ControlSpec
    actions: tuple[ActionSpec, ...] = ()
    toggle: ColumnToggle | None = None


@dataclass(frozen=True)
class ColumnToggle:
    """bool の列の一括トグル(D-073)。オンにすると on、オフにすると off のアクションを押したのと同じに送る。"""

    label: str
    on: ActionSpec
    off: ActionSpec


@dataclass(frozen=True)
class RecordNode:
    record: RecordSpec
    label: str
    columns: tuple[RecordColumn, ...]
    row_actions: tuple[ActionSpec, ...] = ()
    width: int | None = None
    # 表の右側に縦長ボタンで出す scope "all" のアクション(表全体の確定。D-074)
    table_actions: tuple[ActionSpec, ...] = ()
    # 通常の画面で行の追加・削除を出すか(D-075。定義の editRows を、省略時は keysFrom.source から決めたもの)
    edit_rows: bool = False


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

    def spec_for(self, param_id: str) -> ControlSpec | None:
        for spec in self.parameters:
            if spec.param_id == param_id:
                return spec
        return None

    def record(self, record_id: str) -> RecordSpec | None:
        for record in self.records:
            if record.record_id == record_id:
                return record
        return None


def _control(item: Mapping[str, Any]) -> ControlSpec:
    fields = tuple(_control(field) for field in item.get("fields", ()))
    composite = item["type"] == "composite"
    value_range = item.get("range")
    options = item.get("options")
    if composite:
        # 組み合わせの型(D-121)の default・value はフィールドの側にあり、表示キャッシュと同じくフィールドの値の組で持つ
        default: Any = tuple(field.default for field in fields) if item["kind"] == "state" else None
        has_default = item["kind"] == "state"
        value: Any = tuple(field.value for field in fields) if item["kind"] == "trigger" else None
    else:
        default, has_default, value = item.get("default"), "default" in item, item.get("value")
    return ControlSpec(
        param_id=item["param"],
        label=item["label"],
        type=item["type"],
        kind=item["kind"],
        widget=item["widget"],
        standalone=item["standalone"],
        value_range=None if value_range is None else (float(value_range[0]), float(value_range[1])),
        step=item.get("step"),
        default=default,
        has_default=has_default,
        options=None if options is None else tuple(options),
        options_from=item.get("optionsFrom"),
        options_sync=item.get("optionsSync"),
        value=value,
        fields=fields,
        hint=item.get("hint"),
    )


def _record(item: Mapping[str, Any]) -> RecordSpec:
    return RecordSpec(
        record_id=item["record"],
        label=item["label"],
        kind=item["kind"],
        key_label=item["keyLabel"],
        keys_from=item["keysFrom"],
        fields=tuple(_control(field) for field in item["fields"]),
        keys_source=item["keysSource"],
        keys_max=item.get("keysMax"),
        keys_sync=item.get("keysSync"),
        initial=tuple(item["initialValues"]),
    )


def _action(item: Mapping[str, Any], records: Mapping[str, RecordSpec], parameters: Mapping[str, ControlSpec]) -> ActionSpec:
    if "scope" in item:
        steps = tuple(
            RecordStep(records[step["record"]], tuple((fixed["field"], fixed["value"]) for fixed in step["fixed"]))
            for step in item["steps"]
        )
        return ActionSpec(action_id=item["action"], label=item["label"], targets=(), scope=item["scope"], record_steps=steps)
    # 送り先はパラメータ id だけで届く(部品はパラメータの既定の部品を使う。木を膨らませないため。D-124)
    targets = tuple(
        ActionTarget(spec=parameters[target["param"]], has_fixed_value="fixed" in target, fixed_value=target.get("fixed"))
        for target in item["targets"]
    )
    return ActionSpec(action_id=item["action"], label=item["label"], targets=targets, truncated=item.get("truncated") is True)


def _width(node: Mapping[str, Any]) -> int | None:
    width = node.get("width")
    return None if width is None else int(width)


def _nodes(
    nodes: Sequence[Mapping[str, Any]],
    records: Mapping[str, RecordSpec],
    actions: Mapping[str, ActionSpec],
    table: Sequence[ControlSpec],
    out: list[ControlSpec],
) -> tuple[LayoutNode, ...]:
    result: list[LayoutNode] = []
    for node in nodes:
        kind = node["kind"]
        width = _width(node)
        if kind == "control":
            spec = table[node["control"]]
            out.append(spec)
            result.append(ControlNode(spec, width))
        elif kind == "action":
            action = actions[node["action"]]
            # ラベルは画面層が上書きしたときだけ届く(無ければアクションの label。HID-405)
            result.append(ActionNode(replace(action, label=node["label"]) if "label" in node else action, width))
        elif kind == "record":
            columns = tuple(
                RecordColumn(
                    field_index=column["field"],
                    spec=table[column["control"]],
                    actions=tuple(actions[action_id] for action_id in column["actions"]),
                    toggle=None if "toggle" not in column else ColumnToggle(
                        label=column["toggle"]["label"], on=actions[column["toggle"]["on"]], off=actions[column["toggle"]["off"]]
                    ),
                )
                for column in node["columns"]
            )
            result.append(
                RecordNode(
                    record=records[node["record"]],
                    label=node.get("label") or records[node["record"]].label,
                    columns=columns,
                    row_actions=tuple(actions[action_id] for action_id in node["rowActions"]),
                    width=width,
                    table_actions=tuple(actions[action_id] for action_id in node["tableActions"]),
                    edit_rows=node["editRows"],
                )
            )
        elif kind == "tabs":
            result.append(TabsNode(tuple(TabModel(tab["label"], _nodes(tab["children"], records, actions, table, out)) for tab in node["tabs"]), width))
        elif kind == "group":
            result.append(GroupNode(node["label"], node["collapsed"], _nodes(node["children"], records, actions, table, out), width))
        elif kind == "row":
            result.append(RowNode(_nodes(node["children"], records, actions, table, out), width))
        else:
            result.append(ColumnNode(_nodes(node["children"], records, actions, table, out), width))
    return tuple(result)


def surface_from_view(name: str, view: Mapping[str, Any]) -> SurfaceModel:
    """ブリッジが配った部品の木(surface フレームの view)を SurfaceModel にする。

    木の形の判定はブリッジだけが行う(D-122・D-124)ので、読めない形は例外になり、呼び出し側(state._on_surface)が
    直前の画面を保って知らせる。name は定義の名前(画面の見出し)。
    """
    parameters = tuple(_control(item) for item in view["parameters"])
    by_id: dict[str, ControlSpec] = {}
    for spec in parameters:
        by_id.setdefault(spec.param_id, spec)
    records = {item["record"]: _record(item) for item in view["records"]}
    actions = {item["action"]: _action(item, records, by_id) for item in view["actions"]}
    # 画面に置いた部品と列の部品は、同じものが 1 件にまとめて届き、ノードは添字で指す(HID-405)
    table = tuple(_control(item) for item in view["controls"])
    screens = []
    for screen in view["screens"]:
        controls: list[ControlSpec] = []
        layout = _nodes(screen["children"], records, actions, table, controls)
        screens.append(ScreenModel(id=screen["id"], label=screen["label"], controls=tuple(controls), layout=layout))
    return SurfaceModel(
        name=name,
        parameters=parameters,
        screens=tuple(screens),
        actions=tuple(actions.values()),
        records=tuple(records.values()),
    )

