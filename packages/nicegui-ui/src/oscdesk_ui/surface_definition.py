"""サーフェス定義(D-043)の検証。

構造は `protocol/surface-definition.schema.json`(TS の zod から生成)を jsonschema で検証し、
JSON Schema では書けない意味規則(参照・重複・値域)だけをここで実装する。
意味規則は packages/shared/src/surface-definition.ts の collect* と同じ内容で、
`protocol/surface-definition-samples.json` の判定一致テストで乖離を検出する。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from functools import lru_cache

from jsonschema import Draft7Validator
from jsonschema.exceptions import best_match

from .address_pattern import matches_pattern

INT32_MIN = -2147483648
INT32_MAX = 2147483647
# oscBatch 1 フレームの上限(packages/shared の OSC_BATCH.MAX_MESSAGES と同じ値)
OSC_BATCH_MAX_MESSAGES = 512
# 1 データグラムに収める bundle の大きさの目安(packages/shared の OSC_BATCH.PRACTICAL_LIMIT_BYTES と同じ値)
OSC_BATCH_PRACTICAL_LIMIT_BYTES = 60 * 1024

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


def resolve_action_steps(action: dict[str, Any], parameters: list[dict[str, Any]]) -> list[tuple[dict[str, Any], Any]]:
    """アクションの steps を定義順の (パラメータ, 固定値) へ展開する。固定値が無ければ NO_FIXED_VALUE。

    未知の param は無視する(意味検証が別に報告する)。record step は行のキーが要るので扱わない(D-061)。
    """
    resolved: list[tuple[dict[str, Any], Any]] = []
    # 巨大な定義の総当たりでブロックしないよう、id は事前に索引化し、上限超で展開を打ち切る
    # (TS 側 resolveActionSteps と同じ。超過は意味検証が別に報告する)
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
        elif "match" in step:
            for parameter in parameters:
                if matches_pattern(step["match"], parameter["address"]):
                    resolved.append((parameter, NO_FIXED_VALUE))
                    if len(resolved) > OSC_BATCH_MAX_MESSAGES:
                        break
    return resolved


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


def _collect_scoped_action_issues(action: dict[str, Any], where: str, records_by_id: dict[str, dict[str, Any]], issues: list[str]) -> None:
    """scope を持つアクション(D-061)。TS 側 collectScopedActionIssues と同じ規則。

    record step だけを持ち、全レコードが同じ keysFrom.address を持つ。件数の上限は行数で決まるのでここでは見ない。
    """
    keys_address: str | None = None
    for step_index, step in enumerate(action["steps"]):
        at = f"{where}/steps/{step_index}"
        if "record" not in step:
            issues.append(f"{at}: scoped action can only have record steps")
            continue
        record = records_by_id.get(step["record"])
        if record is None:
            issues.append(f"{at}/record: unknown record: {step['record']}")
            continue
        if keys_address is None:
            keys_address = record["keysFrom"]["address"]
        elif record["keysFrom"]["address"] != keys_address:
            issues.append(f"{at}/record: records in a scoped action must share the same keysFrom address")
        if "value" not in step:
            continue
        if record["kind"] == "trigger":
            issues.append(f"{at}/value: trigger record keeps its own values; step cannot override them")
            continue
        fields = {field["id"]: field for field in reversed(record["fields"])}  # 重複 id は先勝ち(TS の find と同じ)
        for field_id, value in step["value"].items():
            field = fields.get(field_id)
            if field is None:
                issues.append(f"{at}/value/{field_id}: unknown field: {field_id}")
                continue
            problem = _fixed_value_problem(field, value)
            if problem is not None:
                issues.append(f"{at}/value/{field_id}: {problem}")


def _collect_action_issues(definition: dict[str, Any], issues: list[str]) -> None:
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
            _collect_scoped_action_issues(action, where, records_by_id, issues)
            continue

        total = 0
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
                if total > OSC_BATCH_MAX_MESSAGES:
                    hits = int(any(matches_pattern(step["match"], parameter["address"]) for parameter in parameters))
                else:
                    hits = sum(1 for parameter in parameters if matches_pattern(step["match"], parameter["address"]))
                if hits == 0:
                    issues.append(f"{at}/match: match hits no parameter: {step['match']}")
                total += hits
        if total > OSC_BATCH_MAX_MESSAGES:
            issues.append(f"{where}/steps: action expands to more than {OSC_BATCH_MAX_MESSAGES} messages")


def _list_sources(definition: dict[str, Any]) -> list[tuple[str, str, dict[str, Any]]]:
    """一覧を受けるアドレスの宣言 (場所, 種類, {address, request?}) を、パラメータ → レコードの順に集める。"""
    sources: list[tuple[str, str, dict[str, Any]]] = []
    for index, parameter in enumerate(definition["parameters"]):
        if parameter["type"] == "s" and "optionsFrom" in parameter:
            sources.append((f"parameters/{index}/optionsFrom", "optionsFrom", parameter["optionsFrom"]))
    for index, record in enumerate(definition.get("records", [])):
        sources.append((f"records/{index}/keysFrom", "keysFrom", record["keysFrom"]))
        for field_index, field in enumerate(record["fields"]):
            if field["type"] == "s" and "optionsFrom" in field:
                sources.append((f"records/{index}/fields/{field_index}/optionsFrom", "optionsFrom", field["optionsFrom"]))
    return sources


def _collect_list_source_issues(definition: dict[str, Any], value_addresses: set[str], issues: list[str]) -> None:
    """一覧・要求のアドレスの衝突(D-054、D-061 でレコードへ拡張)。TS 側 collectListSourceIssues と同じ規則。

    一覧・要求が値のアドレス(パラメータとレコード)と重なると値のエコーと区別できず、要求が一覧のアドレスと
    重なると要求(引数なし)のエコーが空の一覧として届く。同じ一覧・要求の共有は可。
    """
    sources = _list_sources(definition)
    list_addresses = {source["address"] for _where, _label, source in sources}
    for where, label, source in sources:
        if source["address"] in value_addresses:
            issues.append(f"{where}/address: {label} address must not be a parameter or record address")
        request = source.get("request")
        if request is None:
            continue
        if request in value_addresses:
            issues.append(f"{where}/request: {label} request must not be a parameter or record address")
        if request in list_addresses:
            issues.append(f"{where}/request: {label} request must not be a list address (optionsFrom or keysFrom)")


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
        # optionsFrom を持つなら default は Unity の一覧にある名前でもよい(D-053 / D-054)
        for field in ("value",) if "optionsFrom" in spec else ("default", "value"):
            if field in spec and spec[field] not in options:
                issues.append(f"{where}/{field}: {field} must be one of options")


def _collect_record_issues(definition: dict[str, Any], parameter_ids: set[str], value_addresses: set[str], issues: list[str]) -> None:
    """レコード(D-061)。TS 側 collectRecordIssues と同じ規則。id はパラメータ id とも重ねない。"""
    record_ids: set[str] = set()
    for index, record in enumerate(definition.get("records", [])):
        where = f"records/{index}"
        if record["id"] in record_ids:
            issues.append(f"{where}/id: duplicate record id")
        if record["id"] in parameter_ids:
            issues.append(f"{where}/id: record id must not be a parameter id")
        record_ids.add(record["id"])
        if record["address"] in value_addresses:
            issues.append(f"{where}/address: record address must not be a parameter or record address")
        value_addresses.add(record["address"])

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
    issues: list[str],
) -> None:
    """レコード表のノード(D-061)の columns と rowActions。TS 側 collectRecordNodeIssues と同じ規則。"""
    record = records_by_id.get(node["record"])
    if record is None:
        issues.append(f"{here}/record: unknown record: {node['record']}")
    elif "columns" in node:
        fields = {field["id"]: field for field in reversed(record["fields"])}  # 重複 id は先勝ち(TS の find と同じ)
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

    for action_index, action_id in enumerate(node.get("rowActions", [])):
        where = f"{here}/rowActions/{action_index}"
        action = actions_by_id.get(action_id)
        if action is None:
            issues.append(f"{where}: unknown action: {action_id}")
            continue
        if action.get("scope") != "row":
            issues.append(f"{where}: row action must have scope row: {action_id}")
            continue
        if record is None:
            continue
        # 行のキーをそのまま渡すので、アクションのレコードはこの表と同じキー集合(keysFrom.address)でなければならない
        keys_address = record["keysFrom"]["address"]
        for step in action["steps"]:
            target = records_by_id.get(step["record"]) if "record" in step else None
            if target is not None and target["keysFrom"]["address"] != keys_address:
                issues.append(f"{where}: row action records must share the keysFrom address of record {record['id']}")
                break


def collect_semantic_issues(definition: dict[str, Any]) -> list[str]:
    issues: list[str] = []
    by_id: dict[str, dict[str, Any]] = {}
    # 値のアドレス = パラメータの address ∪ レコードの address(D-061)
    value_addresses: set[str] = set()

    for index, parameter in enumerate(definition["parameters"]):
        where = f"parameters/{index}"
        if parameter["id"] in by_id:
            issues.append(f"{where}/id: duplicate parameter id")
        by_id[parameter["id"]] = parameter
        if parameter["address"] in value_addresses:
            issues.append(f"{where}/address: duplicate parameter address")
        value_addresses.add(parameter["address"])
        _collect_value_spec_issues(parameter, parameter["kind"], "parameter", where, issues)

    _collect_record_issues(definition, set(by_id), value_addresses, issues)
    _collect_list_source_issues(definition, value_addresses, issues)
    _collect_action_issues(definition, issues)
    actions_by_id = _index_by_id(definition.get("actions", []))
    records_by_id = _index_by_id(definition.get("records", []))
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
                _collect_record_node_issues(node, here, records_by_id, actions_by_id, issues)
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

    return issues
