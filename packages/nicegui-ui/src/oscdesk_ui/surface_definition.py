"""サーフェス定義(D-043。版 2 は D-117)の検証。

構造は `protocol/surface-definition.schema.json`(TS の zod から生成)を jsonschema で検証し、
JSON Schema では書けない意味規則(参照・重複・値域)だけをここで実装する。
意味規則は packages/shared/src/surface-definition.ts の collect* と同じ内容で、
`protocol/surface-definition-samples.json` の判定一致テストで乖離を検出する。

版 2 では本体(id・型・制約・表示ヒント)と通信の結び付け(bindings.osc)を分けた。本体の規則は id と一覧の id で
書き、OSC のアドレスの規則は結び付けがあるときだけ見る(UI は OSC のアダプタがあるときだけ結び付けを受け取る)。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from functools import lru_cache

from jsonschema import Draft7Validator
from jsonschema.exceptions import best_match

from .address_pattern import matches_pattern

INT32_MIN = -2147483648
INT32_MAX = 2147483647
# まとめ送り 1 回の上限(packages/shared の OSC_BATCH.MAX_MESSAGES と同じ値)
OSC_BATCH_MAX_MESSAGES = 512
# 1 データグラムに収める bundle の大きさの目安(packages/shared の OSC_BATCH.PRACTICAL_LIMIT_BYTES と同じ値)
OSC_BATCH_PRACTICAL_LIMIT_BYTES = 60 * 1024
SURFACE_DEFINITION_VERSION = 2

# 開発用の既定(リポジトリ直下の protocol/)。配布物に載せる場合は schema_path を渡す
DEFAULT_SCHEMA_PATH = Path(__file__).parents[4] / "protocol" / "surface-definition.schema.json"


class SurfaceDefinitionError(ValueError):
    """定義が構造または意味の検証に失敗した。"""


def load_schema(schema_path: Path | None = None) -> dict[str, Any]:
    path = schema_path or DEFAULT_SCHEMA_PATH
    return json.loads(path.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _default_validator() -> Draft7Validator:
    schema = load_schema()
    Draft7Validator.check_schema(schema)
    return Draft7Validator(schema)


def validate_surface_definition(definition: Any, schema: dict[str, Any] | None = None) -> None:
    """有効なら何も返さず、無効なら SurfaceDefinitionError を送出する。"""
    validator = Draft7Validator(schema) if schema is not None else _default_validator()
    # 判別ユニオンは anyOf になるため、best_match で「どの枝がなぜ外れたか」まで掘り下げる
    first = best_match(validator.iter_errors(definition))
    if first is not None:
        location = "/".join(str(part) for part in first.absolute_path) or "(root)"
        raise SurfaceDefinitionError(f"{location}: {first.message}")

    issues = collect_semantic_issues(definition)
    if issues:
        raise SurfaceDefinitionError("; ".join(issues))


def split_bindings(definition: Mapping[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """定義を本体(bindings を外したもの)と結び付けに分ける(D-117)。結び付けが無ければ空。"""
    body = {key: value for key, value in definition.items() if key != "bindings"}
    bindings = definition.get("bindings")
    return body, dict(bindings) if isinstance(bindings, dict) else {}


def join_bindings(body: Mapping[str, Any], bindings: Mapping[str, Any] | None) -> dict[str, Any]:
    """本体と結び付けを 1 つの定義にする(検証と編集用)。結び付けが空なら本体だけ。"""
    joined = {key: value for key, value in body.items() if key != "bindings"}
    if bindings:
        joined["bindings"] = dict(bindings)
    return joined


def _id_from_address(prefix: str, address: str, taken: set[str]) -> str:
    """アドレスから結び付けの id を作る(packages/shared の idFromAddress と同じ)。"""
    import re

    cleaned = re.sub(r"^_+|_+$", "", re.sub(r"[^A-Za-z0-9]+", "_", address))
    base = f"{prefix}{cleaned}"[:56]
    candidate = f"{prefix}x" if base == prefix else base
    number = 2
    while candidate in taken:
        candidate = f"{base}_{number}"
        number += 1
    taken.add(candidate)
    return candidate


def migrate_surface_definition(source: Any) -> Any:
    """版 1 の定義(パラメータに address を書く形)を版 2(本体と bindings.osc。D-117)へ移す。版 1 でなければそのまま返す。

    packages/shared の migrateSurfaceDefinition と同じ規則(同じアドレスの一覧は 1 つの一覧を共有し、要求は最初に
    書かれたものを使う。match は selector の id と bindings.osc.selectors へ)。編集モードで版 1 のファイルを
    アップロードしたときに使う(保存の前の検証は版 2 の規則で行う)。
    """
    if not isinstance(source, dict) or source.get("version") != 1 or isinstance(source.get("version"), bool):
        return source
    import copy

    data = copy.deepcopy(source)
    list_taken: set[str] = set()
    lists: dict[str, dict[str, Any]] = {}

    def key_of(value: Any) -> str:
        return value if isinstance(value, str) else json.dumps(value, sort_keys=True)

    def list_ref(value: Any) -> Any:
        if not isinstance(value, dict) or "address" not in value:
            return value
        rest = {k: v for k, v in value.items() if k not in ("address", "request")}
        address = value["address"]
        entry = lists.get(key_of(address))
        if entry is None:
            entry = {"id": _id_from_address("l_", address if isinstance(address, str) else "list", list_taken), "address": address}
            lists[key_of(address)] = entry
        if "request" in value and "request" not in entry:
            entry["request"] = value["request"]
        return {"list": entry["id"], **rest}

    parameter_bindings: list[dict[str, Any]] = []
    record_bindings: list[dict[str, Any]] = []
    selector_taken: set[str] = set()
    selectors: dict[str, dict[str, Any]] = {}
    if isinstance(data.get("parameters"), list):
        for parameter in data["parameters"]:
            if not isinstance(parameter, dict):
                continue
            if "address" in parameter:
                parameter_bindings.append({"id": parameter.get("id"), "address": parameter.pop("address")})
            if "optionsFrom" in parameter:
                parameter["optionsFrom"] = list_ref(parameter["optionsFrom"])
    if isinstance(data.get("records"), list):
        for record in data["records"]:
            if not isinstance(record, dict):
                continue
            if "address" in record:
                record_bindings.append({"id": record.get("id"), "address": record.pop("address")})
            if "keysFrom" in record:
                record["keysFrom"] = list_ref(record["keysFrom"])
            for field in record.get("fields", []) if isinstance(record.get("fields"), list) else []:
                if isinstance(field, dict) and "optionsFrom" in field:
                    field["optionsFrom"] = list_ref(field["optionsFrom"])
    if isinstance(data.get("actions"), list):
        for action in data["actions"]:
            if not isinstance(action, dict) or not isinstance(action.get("steps"), list):
                continue
            for index, step in enumerate(action["steps"]):
                if not isinstance(step, dict) or "match" not in step:
                    continue
                match = step["match"]
                entry = selectors.get(key_of(match))
                if entry is None:
                    entry = {"id": _id_from_address("m_", match if isinstance(match, str) else "match", selector_taken), "match": match}
                    selectors[key_of(match)] = entry
                action["steps"][index] = {"selector": entry["id"], **{k: v for k, v in step.items() if k != "match"}}
    osc: dict[str, Any] = {"parameters": parameter_bindings}
    if record_bindings:
        osc["records"] = record_bindings
    if lists:
        osc["lists"] = list(lists.values())
    if selectors:
        osc["selectors"] = list(selectors.values())
    data["version"] = SURFACE_DEFINITION_VERSION
    if "bindings" not in source:
        data["bindings"] = {"osc": osc}
    return data

def _is_int32(value: Any) -> bool:
    # JSON の `1.0` / `1e3` は Python では float になるが、TS の Number.isInteger は整数とみなす
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return isinstance(value, int) and not isinstance(value, bool) and INT32_MIN <= value <= INT32_MAX


def _widget_fits(widget: str, target: dict[str, Any]) -> bool:
    """部品のヒントの適合。レコードのフィールドは「kind = レコードの kind」のパラメータとして渡す(D-061)。"""
    kind, type_ = target["kind"], target["type"]
    if widget == "slider":
        return kind == "state" and type_ in ("i", "f") and "range" in target
    if widget == "switch":
        return kind == "state" and type_ == "bool"
    if widget == "button":
        return kind == "trigger"
    if widget == "select":
        return kind == "state" and type_ == "s" and ("options" in target or "optionsFrom" in target)
    if widget == "input":
        return kind == "state" and type_ in ("s", "i", "f")
    return False


def resolve_action_steps(
    action: dict[str, Any],
    parameters: list[dict[str, Any]],
    selectors: Mapping[str, Sequence[str]] | None = None,
) -> list[tuple[dict[str, Any], Any]]:
    """アクションの steps を定義順の (パラメータ, 固定値) へ展開する。固定値が無ければ NO_FIXED_VALUE。

    selector の step は surface フレームの selectors(selector → 当たるパラメータ id。ブリッジが結び付けから解く)で展開する
    (UI は OSC のアドレスを見ない。D-117)。未知の param・selector は無視する(意味検証が別に報告する)。
    record step は行のキーが要るので扱わない(D-061)。
    """
    resolved: list[tuple[dict[str, Any], Any]] = []
    # 巨大な定義の総当たりでブロックしないよう、id は事前に索引化し、上限超で展開を打ち切る
    by_id: dict[str, dict[str, Any]] = {}
    for candidate in parameters:
        by_id.setdefault(candidate["id"], candidate)  # 重複 id は従来どおり先勝ち
    for step in action["steps"]:
        if len(resolved) > OSC_BATCH_MAX_MESSAGES:
            break
        if "param" in step:
            parameter = by_id.get(step["param"])
            if parameter is not None:
                resolved.append((parameter, step.get("value", NO_FIXED_VALUE)))
        elif "selector" in step:
            for param_id in (selectors or {}).get(step["selector"], ()):
                parameter = by_id.get(param_id)
                if parameter is not None:
                    resolved.append((parameter, NO_FIXED_VALUE))
                    if len(resolved) > OSC_BATCH_MAX_MESSAGES:
                        break
    return resolved


def resolve_selectors(definition: Mapping[str, Any]) -> dict[str, list[str]]:
    """結び付け(bindings.osc の selectors)から、selector → 当たるパラメータ id(定義順)を作る。

    ブリッジの resolveSelectors と同じ。編集中の定義をその場で描き直すときに使う(UI はふだん surface.selectors を使う)。
    """
    osc = (definition.get("bindings") or {}).get("osc") or {}
    address_of = {binding["id"]: binding["address"] for binding in osc.get("parameters", [])}
    matches = {binding["id"]: binding["match"] for binding in osc.get("selectors", [])}
    result: dict[str, list[str]] = {}
    for selector in _selector_references(definition):
        match = matches.get(selector)
        result[selector] = [] if match is None else [
            parameter["id"] for parameter in definition["parameters"]
            if parameter["id"] in address_of and matches_pattern(match, address_of[parameter["id"]])
        ]
    return result


class _NoFixedValue:
    def __repr__(self) -> str:
        return "NO_FIXED_VALUE"


NO_FIXED_VALUE: Any = _NoFixedValue()


def _fixed_value_problem(spec: dict[str, Any], value: Any) -> str | None:
    """step の固定値が値の宣言(パラメータまたはレコードのフィールド)の型・値域・options に収まらなければ理由を返す。"""
    type_ = spec["type"]
    if type_ == "bool":
        return None if isinstance(value, bool) else "type bool requires a boolean value"
    if type_ == "s":
        if not isinstance(value, str):
            return "type s requires a string value"
        # optionsFrom の候補は実行時にしか分からないので、静的な options への所属を問わない(D-054)
        options = spec.get("options")
        if options is not None and "optionsFrom" not in spec and value not in options:
            return "value must be one of options"
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return f"type {type_} requires a number value"
    if type_ == "i" and not _is_int32(value):
        return "type i requires an int32 value"
    value_range = spec.get("range")
    if value_range is not None and not value_range[0] <= value <= value_range[1]:
        return "value must be within range"
    return None


def _index_by_id(items: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """id で索引化する。重複 id は従来どおり先勝ち(重複自体は別の検証が報告する)。"""
    index: dict[str, dict[str, Any]] = {}
    for item in items:
        index.setdefault(item["id"], item)
    return index


class _FieldIndex:
    """レコードのフィールドの索引(重複 id は先勝ち。TS の createFieldIndex と同じ)。

    columns・step の value の照合のたびに fields から dict を作り直すと、列・step の数 × フィールド数で
    1 MiB の定義でも数秒ブロックするため、1 回の検証の中でレコードごとに 1 回だけ作る。
    """

    def __init__(self) -> None:
        self._cache: dict[int, tuple[dict[str, Any], dict[str, dict[str, Any]]]] = {}

    def of(self, record: dict[str, Any]) -> dict[str, dict[str, Any]]:
        # id() のキーが別オブジェクトに再利用されないよう、record 自体も保持する
        entry = self._cache.get(id(record))
        if entry is None:
            entry = (record, _index_by_id(record["fields"]))
            self._cache[id(record)] = entry
        return entry[1]


def _collect_scoped_action_issues(
    action: dict[str, Any],
    where: str,
    records_by_id: dict[str, dict[str, Any]],
    field_index: _FieldIndex,
    issues: list[str],
) -> None:
    """scope を持つアクション(D-061)。TS 側 collectScopedActionIssues と同じ規則。

    record step だけを持ち、全レコードが同じ keysFrom の一覧を持つ。件数の上限は行数で決まるのでここでは見ない。
    """
    keys_list: str | None = None
    for step_index, step in enumerate(action["steps"]):
        at = f"{where}/steps/{step_index}"
        if "record" not in step:
            issues.append(f"{at}: scoped action can only have record steps")
            continue
        record = records_by_id.get(step["record"])
        if record is None:
            issues.append(f"{at}/record: unknown record: {step['record']}")
            continue
        if keys_list is None:
            keys_list = record["keysFrom"]["list"]
        elif record["keysFrom"]["list"] != keys_list:
            issues.append(f"{at}/record: records in a scoped action must share the same keysFrom list")
        if "value" not in step:
            continue
        if record["kind"] == "trigger":
            issues.append(f"{at}/value: trigger record keeps its own values; step cannot override them")
            continue
        fields = field_index.of(record)
        for field_id, value in step["value"].items():
            field = fields.get(field_id)
            if field is None:
                issues.append(f"{at}/value/{field_id}: unknown field: {field_id}")
                continue
            problem = _fixed_value_problem(field, value)
            if problem is not None:
                issues.append(f"{at}/value/{field_id}: {problem}")


def _collect_action_issues(definition: dict[str, Any], field_index: _FieldIndex, issues: list[str]) -> None:
    parameters = definition["parameters"]
    parameters_by_id = _index_by_id(parameters)
    records_by_id = _index_by_id(definition.get("records", []))
    action_ids: set[str] = set()
    for action_index, action in enumerate(definition.get("actions", [])):
        where = f"actions/{action_index}"
        if action["id"] in action_ids:
            issues.append(f"{where}/id: duplicate action id")
        action_ids.add(action["id"])

        # step は最低 1 件に展開されるので、上限超の steps は展開せず打ち切る(TS 側と同じ。scope 付きも 1 行で steps 件)
        if len(action["steps"]) > OSC_BATCH_MAX_MESSAGES:
            issues.append(f"{where}/steps: action has more than {OSC_BATCH_MAX_MESSAGES} steps")
            continue

        if "scope" in action:
            _collect_scoped_action_issues(action, where, records_by_id, field_index, issues)
            continue

        total = 0
        has_selector = False
        for step_index, step in enumerate(action["steps"]):
            at = f"{where}/steps/{step_index}"
            if "record" in step:
                # どの行のメッセージか決まらないので、scope の無いアクションには置けない
                issues.append(f"{at}/record: record step requires action scope (row or all)")
            elif "param" in step:
                parameter = parameters_by_id.get(step["param"])
                if parameter is None:
                    issues.append(f"{at}/param: unknown parameter: {step['param']}")
                    continue
                total += 1
                if "value" in step:
                    if parameter["kind"] == "trigger":
                        issues.append(f"{at}/value: trigger parameter keeps its own value; step cannot override it")
                    else:
                        problem = _fixed_value_problem(parameter, step["value"])
                        if problem is not None:
                            issues.append(f"{at}/value: {problem}")
            else:
                # selector が何件に展開されるかは結び付けで決まるので、件数の上限は結び付けの検証で見る
                has_selector = True
        if not has_selector and total > OSC_BATCH_MAX_MESSAGES:
            issues.append(f"{where}/steps: action expands to more than {OSC_BATCH_MAX_MESSAGES} messages")


def list_references(definition: Mapping[str, Any]) -> list[tuple[str, str, str]]:
    """実行時の一覧の参照 (場所, 種類, 一覧の id) を、パラメータ → レコード(keysFrom → フィールドの optionsFrom)の順に集める。"""
    references: list[tuple[str, str, str]] = []
    for index, parameter in enumerate(definition["parameters"]):
        if parameter["type"] == "s" and "optionsFrom" in parameter:
            references.append((f"parameters/{index}/optionsFrom", "optionsFrom", parameter["optionsFrom"]["list"]))
    for index, record in enumerate(definition.get("records", [])):
        references.append((f"records/{index}/keysFrom", "keysFrom", record["keysFrom"]["list"]))
        for field_index, field in enumerate(record["fields"]):
            if field["type"] == "s" and "optionsFrom" in field:
                references.append((f"records/{index}/fields/{field_index}/optionsFrom", "optionsFrom", field["optionsFrom"]["list"]))
    return references


def _selector_references(definition: Mapping[str, Any]) -> list[str]:
    """アクションの selector step が指す結び付けの id(定義順・重複なし)。"""
    ids: dict[str, None] = {}
    for action in definition.get("actions", []):
        for step in action["steps"]:
            if "selector" in step:
                ids.setdefault(step["selector"], None)
    return list(ids)


def _collect_key_source_issues(definition: dict[str, Any], issues: list[str]) -> None:
    """UI で管理するキー(keysFrom.source "ui"。D-075)。TS 側 collectKeySourceIssues と同じ規則。

    同じ一覧を共有するレコードは同じ行の集合なので source と max も揃える。max は "ui" の一覧にだけ書ける。
    UI で管理する一覧はターゲットから受ける一覧(optionsFrom)と共有できない。
    """
    by_list: dict[str, tuple[str, int | None]] = {}
    for index, record in enumerate(definition.get("records", [])):
        where = f"records/{index}/keysFrom"
        keys_from = record["keysFrom"]
        source = keys_from.get("source", "unity")
        if source != "ui" and "max" in keys_from:
            issues.append(f"{where}/max: keysFrom max needs source ui")
        seen = by_list.get(keys_from["list"])
        if seen is None:
            by_list[keys_from["list"]] = (source, keys_from.get("max"))
        elif seen != (source, keys_from.get("max")):
            issues.append(f"{where}: records sharing a keysFrom list must agree on source and max")
    for where, label, list_id in list_references(definition):
        if label == "optionsFrom" and by_list.get(list_id, ("unity", None))[0] == "ui":
            issues.append(f"{where}/list: optionsFrom list must not be a keysFrom list with source ui")


def _collect_value_spec_issues(spec: dict[str, Any], kind: str, owner: str, where: str, issues: list[str]) -> None:
    """値の宣言の検証。パラメータとレコードのフィールドで同じ規則(TS 側 collectValueSpecIssues)。

    違いは state レコードのフィールドが default 必須であることだけ(行の生成でその値を使う。D-061)。
    """
    if kind == "state":
        if "value" in spec:
            issues.append(f"{where}/value: state {owner} cannot define value")
        if owner == "record field" and "default" not in spec:
            issues.append(f"{where}/default: state record field requires default")
    else:
        if "value" not in spec:
            issues.append(f"{where}/value: trigger {owner} requires value")
        for field in ("default", "range", "options", "step", "optionsFrom"):
            if field in spec:
                issues.append(f"{where}/{field}: trigger {owner} cannot define {field}")

    type_ = spec["type"]
    numeric = type_ in ("i", "f")
    value_range = spec.get("range")
    if numeric and value_range is not None:
        if value_range[0] >= value_range[1]:
            issues.append(f"{where}/range: range minimum must be less than maximum")
        step = spec.get("step")
        if step is not None and step > value_range[1] - value_range[0]:
            issues.append(f"{where}/step: step must not exceed the range width")
        if type_ == "i" and not all(_is_int32(bound) for bound in value_range):
            issues.append(f"{where}/range: type i requires int32 range bounds")
    if type_ == "i" and "step" in spec and not float(spec["step"]).is_integer():
        issues.append(f"{where}/step: type i requires an integer step")
    for field in ("default", "value"):
        current = spec.get(field)
        if current is None or not numeric:
            continue
        if type_ == "i" and not _is_int32(current):
            issues.append(f"{where}/{field}: type i requires an int32 value")
        if value_range is not None and not value_range[0] <= current <= value_range[1]:
            issues.append(f"{where}/{field}: {field} must be within range")

    options = spec.get("options")
    if type_ == "s" and options is not None:
        if len(set(options)) != len(options):
            issues.append(f"{where}/options: options must be unique")
        # optionsFrom を持つなら default は実行時の一覧にある名前でもよい(D-053 / D-054)
        for field in ("value",) if "optionsFrom" in spec else ("default", "value"):
            if field in spec and spec[field] not in options:
                issues.append(f"{where}/{field}: {field} must be one of options")


def _collect_record_issues(definition: dict[str, Any], parameter_ids: set[str], issues: list[str]) -> None:
    """レコード(D-061)。TS 側 collectRecordIssues と同じ規則。id はパラメータ id とも重ねない。"""
    record_ids: set[str] = set()
    for index, record in enumerate(definition.get("records", [])):
        where = f"records/{index}"
        if record["id"] in record_ids:
            issues.append(f"{where}/id: duplicate record id")
        if record["id"] in parameter_ids:
            issues.append(f"{where}/id: record id must not be a parameter id")
        record_ids.add(record["id"])

        if record["kind"] == "state" and not record["fields"]:
            issues.append(f"{where}/fields: state record requires at least one field")
        field_ids: set[str] = set()
        for field_index, field in enumerate(record["fields"]):
            if field["id"] in field_ids:
                issues.append(f"{where}/fields/{field_index}/id: duplicate field id")
            field_ids.add(field["id"])
            _collect_value_spec_issues(field, record["kind"], "record field", f"{where}/fields/{field_index}", issues)


def _collect_record_node_issues(
    node: dict[str, Any],
    here: str,
    records_by_id: dict[str, dict[str, Any]],
    actions_by_id: dict[str, dict[str, Any]],
    keys_lists_of: Callable[[dict[str, Any]], set[str]],
    field_index: _FieldIndex,
    issues: list[str],
) -> None:
    """レコード表のノード(D-061)の columns(列のアクション D-066・一括トグル D-073 を含む)・rowActions・tableActions(D-074)。

    TS 側 collectRecordNodeIssues と同じ規則。
    """
    record = records_by_id.get(node["record"])

    def check_table_action(action_id: str, scope: str, where: str, owner: str | None = None) -> None:
        _check_table_action(action_id, scope, where, record, actions_by_id, keys_lists_of, issues, owner)
    if record is None:
        issues.append(f"{here}/record: unknown record: {node['record']}")
    elif "columns" in node:
        fields = field_index.of(record)
        seen: set[str] = set()
        for column_index, column in enumerate(node["columns"]):
            where = f"{here}/columns/{column_index}"
            if column["field"] in seen:
                issues.append(f"{where}/field: duplicate column field: {column['field']}")
            seen.add(column["field"])
            field = fields.get(column["field"])
            if field is None:
                issues.append(f"{where}/field: unknown field: {column['field']}")
            elif "widget" in column and not _widget_fits(column["widget"], {**field, "kind": record["kind"]}):
                issues.append(f"{where}/widget: widget {column['widget']} does not fit field {column['field']}")
            for action_index, action_id in enumerate(column.get("actions", [])):
                check_table_action(action_id, "all", f"{where}/actions/{action_index}")
            toggle = column.get("toggle")
            if toggle is not None:
                # 一括トグルは全行のオン・オフを 1 つのスイッチで表すので、bool の列にだけ置ける(D-073)
                if field is not None and field["type"] != "bool":
                    issues.append(f"{where}/toggle: column toggle needs a bool field: {column['field']}")
                check_table_action(toggle["on"], "all", f"{where}/toggle/on", "column toggle")
                check_table_action(toggle["off"], "all", f"{where}/toggle/off", "column toggle")

    for action_index, action_id in enumerate(node.get("rowActions", [])):
        check_table_action(action_id, "row", f"{here}/rowActions/{action_index}")
    for action_index, action_id in enumerate(node.get("tableActions", [])):
        check_table_action(action_id, "all", f"{here}/tableActions/{action_index}", "table action")
    # 行の追加・削除は保持値の行を作る・消す操作なので、trigger のレコードの表には置けない(D-075)
    if node.get("editRows") is True and record is not None and record["kind"] != "state":
        issues.append(f"{here}/editRows: editRows needs a state record: {record['id']}")


def _check_table_action(
    action_id: str,
    scope: str,
    where: str,
    record: dict[str, Any] | None,
    actions_by_id: dict[str, dict[str, Any]],
    keys_lists_of: Callable[[dict[str, Any]], set[str]],
    issues: list[str],
    owner: str | None = None,
) -> None:
    """表の中に置くアクション(rowActions は scope "row"、列の actions・一括トグル・tableActions は scope "all"。D-066)。

    TS 側 checkTableAction と同じ規則。表の行と同じキー集合を対象にしないと、押した行・見えている行と送る行が
    食い違うので keysFrom の一覧も揃える。
    """
    if owner is None:
        owner = "row action" if scope == "row" else "column action"
    action = actions_by_id.get(action_id)
    if action is None:
        issues.append(f"{where}: unknown action: {action_id}")
        return
    if action.get("scope") != scope:
        issues.append(f"{where}: {owner} must have scope {scope}: {action_id}")
        return
    if record is None:
        return
    if keys_lists_of(action) - {record["keysFrom"]["list"]}:
        issues.append(f"{where}: {owner} records must share the keysFrom list of record {record['id']}")


def _collect_osc_binding_issues(definition: dict[str, Any], osc: dict[str, Any], issues: list[str]) -> None:
    """OSC の結び付け(D-117)。TS 側 collectOscBindingIssues と同じ規則。

    本体の id と結び付けが 1 対 1 で、アドレスの規則(D-054・D-061 の衝突、D-075 の UI で管理する一覧、HID-166 の match)を守る。
    """
    base = "bindings/osc"

    def check_bound(section: str, label: str, expected: list[str], bound: list[dict[str, Any]]) -> None:
        wanted = set(expected)
        seen: set[str] = set()
        for index, binding in enumerate(bound):
            if binding["id"] in seen:
                issues.append(f"{base}/{section}/{index}/id: duplicate {label} binding: {binding['id']}")
            elif binding["id"] not in wanted:
                issues.append(f"{base}/{section}/{index}/id: unknown {label}: {binding['id']}")
            seen.add(binding["id"])
        for item in dict.fromkeys(expected):
            if item not in seen:
                issues.append(f"{base}/{section}: {label} has no osc binding: {item}")

    list_ids = list(dict.fromkeys(list_id for _where, _label, list_id in list_references(definition)))
    check_bound("parameters", "parameter", [parameter["id"] for parameter in definition["parameters"]], osc["parameters"])
    check_bound("records", "record", [record["id"] for record in definition.get("records", [])], osc.get("records", []))
    check_bound("lists", "list", list_ids, osc.get("lists", []))
    check_bound("selectors", "selector", _selector_references(definition), osc.get("selectors", []))

    # 値のアドレス = パラメータの address ∪ レコードの address(D-061)
    value_addresses: set[str] = set()
    for index, binding in enumerate(osc["parameters"]):
        if binding["address"] in value_addresses:
            issues.append(f"{base}/parameters/{index}/address: duplicate parameter address")
        value_addresses.add(binding["address"])
    for index, binding in enumerate(osc.get("records", [])):
        if binding["address"] in value_addresses:
            issues.append(f"{base}/records/{index}/address: record address must not be a parameter or record address")
        value_addresses.add(binding["address"])

    # 一覧・要求のアドレスの衝突(D-054)。一覧どうしでアドレスを共有すると届いた一覧がどちらのものか決まらない
    lists = osc.get("lists", [])
    list_addresses = {binding["address"] for binding in lists}
    ui_lists = {record["keysFrom"]["list"] for record in definition.get("records", []) if record["keysFrom"].get("source") == "ui"}
    seen_list_addresses: set[str] = set()
    for index, binding in enumerate(lists):
        where = f"{base}/lists/{index}"
        if binding["address"] in seen_list_addresses:
            issues.append(f"{where}/address: duplicate list address")
        seen_list_addresses.add(binding["address"])
        if binding["address"] in value_addresses:
            issues.append(f"{where}/address: list address must not be a parameter or record address")
        request = binding.get("request")
        if request is None:
            continue
        if binding["id"] in ui_lists:
            issues.append(f"{where}/request: list of a keysFrom with source ui must not have a request")
        if request in value_addresses:
            issues.append(f"{where}/request: list request must not be a parameter or record address")
        if request in list_addresses:
            issues.append(f"{where}/request: list request must not be a list address")

    # selector は少なくとも 1 件に当たり、展開後のまとめ送りは上限(512)以内
    parameter_addresses: dict[str, str] = {}
    for binding in osc["parameters"]:
        parameter_addresses.setdefault(binding["id"], binding["address"])
    addresses_in_order = [parameter_addresses.get(parameter["id"]) for parameter in definition["parameters"]]
    selectors_by_id = _index_by_id(osc.get("selectors", []))
    hits_of: dict[str, int] = {}

    def count_hits(match: str, cap: int) -> int:
        hits = 0
        for address in addresses_in_order:
            if address is not None and matches_pattern(match, address):
                hits += 1
            if hits > cap:
                break
        return hits

    for index, binding in enumerate(osc.get("selectors", [])):
        hits = count_hits(binding["match"], OSC_BATCH_MAX_MESSAGES)
        hits_of[binding["id"]] = hits
        if hits == 0:
            issues.append(f"{base}/selectors/{index}/match: match hits no parameter: {binding['match']}")
    for action_index, action in enumerate(definition.get("actions", [])):
        if "scope" in action or len(action["steps"]) > OSC_BATCH_MAX_MESSAGES:
            continue
        if not any("selector" in step for step in action["steps"]):
            continue
        total = 0
        for step in action["steps"]:
            if "param" in step:
                total += 1
            elif "selector" in step and step["selector"] in selectors_by_id:
                total += hits_of.get(step["selector"], 0)
            if total > OSC_BATCH_MAX_MESSAGES:
                break
        if total > OSC_BATCH_MAX_MESSAGES:
            issues.append(f"actions/{action_index}/steps: action expands to more than {OSC_BATCH_MAX_MESSAGES} messages")


def collect_semantic_issues(definition: dict[str, Any]) -> list[str]:
    issues: list[str] = []
    by_id: dict[str, dict[str, Any]] = {}

    for index, parameter in enumerate(definition["parameters"]):
        where = f"parameters/{index}"
        if parameter["id"] in by_id:
            issues.append(f"{where}/id: duplicate parameter id")
        by_id[parameter["id"]] = parameter
        _collect_value_spec_issues(parameter, parameter["kind"], "parameter", where, issues)
        if "widget" in parameter and not _widget_fits(parameter["widget"], parameter):
            issues.append(f"{where}/widget: widget {parameter['widget']} does not fit parameter {parameter['id']}")

    _collect_record_issues(definition, set(by_id), issues)
    _collect_key_source_issues(definition, issues)
    field_index = _FieldIndex()
    _collect_action_issues(definition, field_index, issues)
    actions_by_id = _index_by_id(definition.get("actions", []))
    records_by_id = _index_by_id(definition.get("records", []))
    # 同じアクションを多数の rowActions が参照しても steps を毎回走査しないよう、アクションごとに 1 回だけ集める
    # (rowActions 数 × steps 数の総当たりは 1 MiB 未満の定義でも数十秒ブロックする。TS 側と同じ)
    keys_list_cache: dict[int, tuple[dict[str, Any], set[str]]] = {}

    def keys_lists_of(action: dict[str, Any]) -> set[str]:
        entry = keys_list_cache.get(id(action))
        if entry is None:
            lists: set[str] = set()
            for step in action["steps"]:
                target = records_by_id.get(step["record"]) if "record" in step else None
                if target is not None:
                    lists.add(target["keysFrom"]["list"])
            entry = (action, lists)
            keys_list_cache[id(action)] = entry
        return entry[1]

    screen_ids: set[str] = set()

    def visit(nodes: list[dict[str, Any]], where: str) -> None:
        for index, node in enumerate(nodes):
            here = f"{where}/{index}"
            kind = node["kind"]
            if kind == "control":
                # control はパラメータ id だけを参照する(レコード id は record ノードで置く)
                parameter = by_id.get(node["param"])
                if parameter is None:
                    issues.append(f"{here}/param: unknown parameter: {node['param']}")
                elif "widget" in node and not _widget_fits(node["widget"], parameter):
                    issues.append(f"{here}/widget: widget {node['widget']} does not fit parameter {node['param']}")
            elif kind == "action":
                action = actions_by_id.get(node["action"])
                if action is None:
                    issues.append(f"{here}/action: unknown action: {node['action']}")
                elif action.get("scope") == "row":
                    # 行が決まらないので、行のアクションは record ノードの rowActions にだけ置ける
                    issues.append(f"{here}/action: row-scoped action must be placed in rowActions: {node['action']}")
            elif kind == "record":
                _collect_record_node_issues(node, here, records_by_id, actions_by_id, keys_lists_of, field_index, issues)
            elif kind == "tabs":
                for tab_index, tab in enumerate(node["tabs"]):
                    visit(tab["children"], f"{here}/tabs/{tab_index}/children")
            else:
                visit(node["children"], f"{here}/children")

    for index, screen in enumerate(definition["screens"]):
        if screen["id"] in screen_ids:
            issues.append(f"screens/{index}/id: duplicate screen id")
        screen_ids.add(screen["id"])
        visit(screen["children"], f"screens/{index}/children")

    osc = (definition.get("bindings") or {}).get("osc")
    if osc is not None:
        _collect_osc_binding_issues(definition, osc, issues)

    return issues
