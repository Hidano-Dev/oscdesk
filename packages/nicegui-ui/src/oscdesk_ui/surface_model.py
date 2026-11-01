"""サーフェス定義(D-043)から、UI が部品を作るための情報を取り出す。

検証は surface_definition.py と protocol.py のデコードで済んでいる前提で、ここでは
パラメータ層(id・型・値域)と画面層(配置)を ControlSpec へ畳み込むだけにする。
ウィジェット生成(widgets.py)・値の調停(state.py)はこの型だけを見る。
部品・行・一覧はパラメータ id・レコード id・一覧の id で指し、OSC のアドレスは持たない(HID-389・D-117)。
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, replace
from typing import Any, Collection, Final, Mapping, Sequence

from .surface_definition import NO_FIXED_VALUE, OSC_BATCH_MAX_MESSAGES, resolve_action_steps, resolve_selectors

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
        """desired・echo の値を表示キャッシュの組にする。組み合わせの型で全フィールドが型と値域に合わなければ None。"""
        if not self.is_composite:
            return None if isinstance(value, dict) else (value,)
        if not isinstance(value, Mapping) or set(value) != {field.param_id for field in self.fields}:
            return None
        if not all(_composite_field_accepts(field, value[field.param_id]) for field in self.fields):
            return None
        # float32 の丸めで範囲の端をわずかに越えた値は端に寄せて持つ(入力欄の確定やスライダーの検査が、受けた値を範囲外としないように)
        return tuple(_snap_to_range(field, value[field.param_id]) for field in self.fields)

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
        """新しい行の値(宣言順)。state はフィールドの default、trigger は value(TS の recordInitialValues)。"""
        return tuple(field.default if self.kind == "state" else field.value for field in self.fields)

    def row_values(self, values: Mapping[str, Any]) -> tuple[Any, ...] | None:
        """届いた行の値(フィールド id → 値)を宣言順に並べる。全フィールドが揃って型と値域に合わなければ None。

        数値は整数・小数のどちらも受け、bool は真偽を受ける(0 / 1 も受ける)。optionsFrom を持つ s は options への所属を問わない
        (ブリッジは定義どおりの行だけを配るが、表示キャッシュへ入れる前にもう一度確かめる)。
        """
        row: list[Any] = []
        for field in self.fields:
            if field.param_id not in values or not _field_accepts(field, values[field.param_id]):
                return None
            row.append(values[field.param_id])
        return tuple(row)


def _float32(value: float) -> float | None:
    try:
        return struct.unpack("<f", struct.pack("<f", value))[0]
    except (OverflowError, struct.error):
        return None


def _composite_field_accepts(field: ControlSpec, value: Any) -> bool:
    """組み合わせの型のフィールドの値(packages/shared の compositeValueOf と同じ規則。HID-398)。

    f は OSC の float32 を経由して届くので、範囲の端も float32 に丸めて比べる(境界値のエコーを捨てない)。
    i は int32 に収まる整数だけ。
    """
    if field.type == "i" and not (
        isinstance(value, (int, float)) and not isinstance(value, bool) and float(value).is_integer() and -2147483648 <= value <= 2147483647
    ):
        return False
    if _field_accepts(field, value):
        return True
    if field.type != "f" or field.value_range is None or isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    rounded, low, high = _float32(float(value)), _float32(field.value_range[0]), _float32(field.value_range[1])
    return rounded is not None and low is not None and high is not None and low <= rounded <= high


def _snap_to_range(field: ControlSpec, value: Any) -> Any:
    if field.type != "f" or field.value_range is None or isinstance(value, bool) or not isinstance(value, (int, float)):
        return value
    low, high = field.value_range
    return low if value < low else high if value > high else value


def json_value(spec: ControlSpec, value: Any) -> Any:
    """基本型の値を型どおりの JSON の値に揃える(bool は true/false のまま。0/1 への直しはブリッジ)。"""
    if spec.type == "bool":
        return bool(value)
    if spec.type == "f":
        return float(value)
    if spec.type == "i":
        return int(value)
    return value


def _field_accepts(field: ControlSpec, value: Any) -> bool:
    if field.type == "s":
        return isinstance(value, str) and (
            field.options is None or field.options_from is not None or value in field.options
        )
    if field.type == "bool":
        return isinstance(value, bool) or (isinstance(value, (int, float)) and value in (0, 1))
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    return field.value_range is None or field.value_range[0] <= value <= field.value_range[1]

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


def default_widget(parameter: dict[str, Any]) -> str:
    """control に widget の指定が無いときの部品。パラメータの表示ヒントがあればそれ、無ければ型と制約から決める(D-103)。"""
    if parameter.get("widget"):
        return parameter["widget"]
    if parameter["type"] == "composite":
        # 知っている表示ヒント(color)で、その部品が表せる形なら専用の部品。そうでなければフィールドごとの部品(D-121)
        return "color" if is_color_composite(parameter) else "composite"
    if parameter["kind"] == "trigger":
        return "button"
    type_ = parameter["type"]
    if type_ == "bool":
        return "switch"
    if type_ == "s":
        # optionsFrom があれば、一覧が届く前でも select(候補は静的な options だけ。D-053)
        return "select" if parameter.get("options") or parameter.get("optionsFrom") else "input"
    return "slider" if "range" in parameter else "input"


def is_color_composite(parameter: Mapping[str, Any]) -> bool:
    """色の選択で表せる組み合わせの型か。ヒント color の state で、範囲 0〜1 の f が 3 つ(RGB)か 4 つ(RGBA)。

    形が合わなければ(範囲が 0〜255 など)ヒントが color でもフィールドごとの部品にする(値を色の選択で壊さないため)。
    """
    if parameter.get("hint") != "color" or parameter.get("kind") != "state":
        return False
    fields = parameter.get("fields") or []
    return len(fields) in (3, 4) and all(
        field.get("type") == "f" and list(field.get("range") or []) == [0, 1] for field in fields
    )


def _composite_spec(parameter: dict[str, Any], widget: str, label: str) -> ControlSpec:
    fields = tuple(
        _spec({**field, "kind": parameter["kind"]}, default_widget({**field, "kind": parameter["kind"]}), field["label"])
        for field in parameter["fields"]
    )
    return ControlSpec(
        param_id=parameter["id"],
        label=label,
        type="composite",
        kind=parameter["kind"],
        # 組み合わせの型には基本型の部品のヒントが合わない(定義の検証で断る)ので、ここで決めた部品だけを使う
        widget=widget if widget in ("color", "composite") else default_widget({**parameter, "widget": None}),
        standalone=parameter.get("standalone", True),
        # state のフィールドは default 必須(定義の検証)。default は組で持つ
        default=tuple(field.default for field in fields) if parameter["kind"] == "state" else None,
        has_default=parameter["kind"] == "state",
        value=tuple(field.value for field in fields) if parameter["kind"] == "trigger" else None,
        fields=fields,
        hint=parameter.get("hint"),
    )


def _spec(parameter: dict[str, Any], widget: str, label: str, syncable: Collection[str] = ()) -> ControlSpec:
    if parameter["type"] == "composite":
        return _composite_spec(parameter, widget, label)
    value_range = parameter.get("range")
    options = parameter.get("options")
    options_from = parameter.get("optionsFrom")
    if widget == "select" and not options and options_from is None:
        widget = "input"
    return ControlSpec(
        param_id=parameter["id"],
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
        options_from=None if options_from is None else options_from["list"],
        options_sync=None if options_from is None or options_from["list"] not in syncable else options_from["list"],
        value=parameter.get("value"),
    )


def _width(node: dict[str, Any]) -> int | None:
    # 'auto' は描画側に任せる(None)。数値は 12 分割グリッドの占有幅
    width = node.get("width")
    return None if width in (None, "auto") else int(width)


def _field_parameter(record: dict[str, Any], field: dict[str, Any]) -> dict[str, Any]:
    """フィールドを「kind がレコードの kind のパラメータ」とみなす(D-061 の widget 判定と同じ)。"""
    return {**field, "kind": record["kind"]}


def _build_record(record: dict[str, Any], syncable: Collection[str]) -> RecordSpec:
    fields = []
    for field in record["fields"]:
        parameter = _field_parameter(record, field)
        fields.append(_spec(parameter, default_widget(parameter), field["label"], syncable))
    keys_list = record["keysFrom"]["list"]
    return RecordSpec(
        record_id=record["id"],
        label=record["label"],
        kind=record["kind"],
        key_label=(record.get("key") or {}).get("label") or "キー",
        keys_from=keys_list,
        fields=tuple(fields),
        keys_source=record["keysFrom"].get("source", "unity"),
        keys_max=record["keysFrom"].get("max"),
        keys_sync=keys_list if keys_list in syncable else None,
    )


def _build_record_node(
    node: dict[str, Any],
    records: dict[str, RecordSpec],
    raw_records: dict[str, dict[str, Any]],
    actions: dict[str, ActionSpec],
    syncable: Collection[str],
) -> RecordNode:
    record = records[node["record"]]
    raw = raw_records[node["record"]]
    raw_fields = {field["id"]: field for field in reversed(raw["fields"])}  # 重複 id は先勝ち(検証と同じ)
    columns_def = node.get("columns") or [{"field": field["id"]} for field in raw["fields"]]
    columns = []
    for column in columns_def:
        parameter = _field_parameter(raw, raw_fields[column["field"]])
        widget = column.get("widget") or default_widget(parameter)
        raw_toggle = column.get("toggle")
        toggle = (
            None
            if raw_toggle is None
            else ColumnToggle(label=raw_toggle["label"], on=actions[raw_toggle["on"]], off=actions[raw_toggle["off"]])
        )
        columns.append(
            RecordColumn(
                field_index=record.field_index(column["field"]),
                spec=_spec(parameter, widget, column.get("label") or parameter["label"], syncable),
                actions=tuple(actions[action_id] for action_id in column.get("actions", [])),
                toggle=toggle,
            )
        )
    return RecordNode(
        record=record,
        label=node.get("label") or record.label,
        columns=tuple(columns),
        row_actions=tuple(actions[action_id] for action_id in node.get("rowActions", [])),
        width=_width(node),
        table_actions=tuple(actions[action_id] for action_id in node.get("tableActions", [])),
        # trigger のレコードは保持値を持たないので、行を作る・消す操作を出さない
        edit_rows=record.kind == "state" and node.get("editRows", record.keys_source == "ui"),
    )


def _build_action(
    action: dict[str, Any],
    parameters: list[dict[str, Any]],
    records: dict[str, RecordSpec],
    selectors: Mapping[str, Sequence[str]],
) -> ActionSpec:
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
        for parameter, fixed in resolve_action_steps(action, parameters, selectors)
    )
    return ActionSpec(action_id=action["id"], label=action["label"], targets=targets)


@dataclass(frozen=True)
class _BuildContext:
    by_id: dict[str, dict[str, Any]]
    actions: dict[str, ActionSpec]
    records: dict[str, RecordSpec]
    raw_records: dict[str, dict[str, Any]]
    syncable: Collection[str] = ()


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
                ctx.syncable,
            )
            out.append(spec)
            result.append(ControlNode(spec, width))
        elif kind == "action":
            action = ctx.actions[node["action"]]
            if node.get("label"):
                action = replace(action, label=node["label"])
            result.append(ActionNode(action, width))
        elif kind == "record":
            result.append(_build_record_node(node, ctx.records, ctx.raw_records, ctx.actions, ctx.syncable))
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


def parse_surface(
    definition: dict[str, Any],
    *,
    selectors: Mapping[str, Sequence[str]] | None = None,
    syncable_lists: Collection[str] = (),
) -> SurfaceModel:
    """ブリッジが採用した定義(本体)から SurfaceModel を作る。判定はブリッジだけが行う(D-122)ので、組み立てられない形は例外になり、呼び出し側(state._on_surface)が直前の画面を保って知らせる。

    selectors は surface フレームの selectors(アクションの selector → 当たるパラメータ id)、syncable_lists は
    取り直せる(要求を持つ)一覧の id。どちらも結び付けから決まるもので、UI は OSC のアドレスを見ずに使う(D-117)。
    定義に bindings が入っていれば(編集中の定義など)、selectors を省いたときはそこから解く。
    """
    if selectors is None:
        selectors = resolve_selectors(definition) if "bindings" in definition else {}
    by_id = {parameter["id"]: parameter for parameter in definition["parameters"]}
    parameters = tuple(
        _spec(parameter, default_widget(parameter), parameter["label"], syncable_lists) for parameter in definition["parameters"]
    )
    raw_records = {record["id"]: record for record in definition.get("records", [])}
    records = {record_id: _build_record(record, syncable_lists) for record_id, record in raw_records.items()}
    actions = {
        action["id"]: _build_action(action, definition["parameters"], records, selectors)
        for action in definition.get("actions", [])
    }
    ctx = _BuildContext(by_id=by_id, actions=actions, records=records, raw_records=raw_records, syncable=syncable_lists)
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
