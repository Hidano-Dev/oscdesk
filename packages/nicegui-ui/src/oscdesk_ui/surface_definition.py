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


def _widget_fits(widget: str, parameter: dict[str, Any]) -> bool:
    kind, type_ = parameter["kind"], parameter["type"]
    if widget == "slider":
        return kind == "state" and type_ in ("i", "f") and "range" in parameter
    if widget == "switch":
        return kind == "state" and type_ == "bool"
    if widget == "button":
        return kind == "trigger"
    if widget == "select":
        return kind == "state" and type_ == "s" and "options" in parameter
    if widget == "input":
        return kind == "state" and type_ in ("s", "i", "f")
    return False


def resolve_action_steps(action: dict[str, Any], parameters: list[dict[str, Any]]) -> list[tuple[dict[str, Any], Any]]:
    """アクションの steps を定義順の (パラメータ, 固定値) へ展開する。固定値が無ければ NO_FIXED_VALUE。

    未知の param は無視する(意味検証が別に報告する)。
    """
    resolved: list[tuple[dict[str, Any], Any]] = []
    # 巨大な定義の総当たりでブロックしないよう、id は事前に索引化し、上限超で展開を打ち切る
    # (TS 側 resolveActionSteps と同じ。超過は意味検証が別に報告する)
    by_id = {candidate["id"]: candidate for candidate in parameters}
    for step in action["steps"]:
        if len(resolved) > OSC_BATCH_MAX_MESSAGES:
            break
        if "param" in step:
            parameter = by_id.get(step["param"])
            if parameter is not None:
                resolved.append((parameter, step.get("value", NO_FIXED_VALUE)))
        else:
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


def _fixed_value_problem(parameter: dict[str, Any], value: Any) -> str | None:
    """step の固定値がパラメータの型・値域・options に収まらなければ理由を返す。"""
    type_ = parameter["type"]
    if type_ == "bool":
        return None if isinstance(value, bool) else "type bool requires a boolean value"
    if type_ == "s":
        if not isinstance(value, str):
            return "type s requires a string value"
        options = parameter.get("options")
        return "value must be one of options" if options is not None and value not in options else None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return f"type {type_} requires a number value"
    if type_ == "i" and not _is_int32(value):
        return "type i requires an int32 value"
    value_range = parameter.get("range")
    if value_range is not None and not value_range[0] <= value <= value_range[1]:
        return "value must be within range"
    return None


def _collect_action_issues(definition: dict[str, Any], issues: list[str]) -> None:
    parameters = definition["parameters"]
    parameters_by_id = {candidate["id"]: candidate for candidate in parameters}
    action_ids: set[str] = set()
    for action_index, action in enumerate(definition.get("actions", [])):
        where = f"actions/{action_index}"
        if action["id"] in action_ids:
            issues.append(f"{where}/id: duplicate action id")
        action_ids.add(action["id"])

        # step は最低 1 件に展開されるので、上限超の steps は展開せず打ち切る(TS 側と同じ)
        if len(action["steps"]) > OSC_BATCH_MAX_MESSAGES:
            issues.append(f"{where}/steps: action has more than {OSC_BATCH_MAX_MESSAGES} steps")
            continue

        total = 0
        for step_index, step in enumerate(action["steps"]):
            at = f"{where}/steps/{step_index}"
            if "param" in step:
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


def collect_semantic_issues(definition: dict[str, Any]) -> list[str]:
    issues: list[str] = []
    by_id: dict[str, dict[str, Any]] = {}
    addresses: set[str] = set()

    for index, parameter in enumerate(definition["parameters"]):
        where = f"parameters/{index}"
        if parameter["id"] in by_id:
            issues.append(f"{where}/id: duplicate parameter id")
        by_id[parameter["id"]] = parameter
        if parameter["address"] in addresses:
            issues.append(f"{where}/address: duplicate parameter address")
        addresses.add(parameter["address"])

        if parameter["kind"] == "state":
            if "value" in parameter:
                issues.append(f"{where}/value: state parameter cannot define value")
        else:
            if "value" not in parameter:
                issues.append(f"{where}/value: trigger parameter requires value")
            for field in ("default", "range", "options", "step"):
                if field in parameter:
                    issues.append(f"{where}/{field}: trigger parameter cannot define {field}")

        type_ = parameter["type"]
        numeric = type_ in ("i", "f")
        value_range = parameter.get("range")
        if numeric and value_range is not None:
            if value_range[0] >= value_range[1]:
                issues.append(f"{where}/range: range minimum must be less than maximum")
            step = parameter.get("step")
            if step is not None and step > value_range[1] - value_range[0]:
                issues.append(f"{where}/step: step must not exceed the range width")
            if type_ == "i" and not all(_is_int32(bound) for bound in value_range):
                issues.append(f"{where}/range: type i requires int32 range bounds")
        if type_ == "i" and "step" in parameter and not float(parameter["step"]).is_integer():
            issues.append(f"{where}/step: type i requires an integer step")
        for field in ("default", "value"):
            current = parameter.get(field)
            if current is None or not numeric:
                continue
            if type_ == "i" and not _is_int32(current):
                issues.append(f"{where}/{field}: type i requires an int32 value")
            if value_range is not None and not value_range[0] <= current <= value_range[1]:
                issues.append(f"{where}/{field}: {field} must be within range")

        options = parameter.get("options")
        if type_ == "s" and options is not None:
            if len(set(options)) != len(options):
                issues.append(f"{where}/options: options must be unique")
            for field in ("default", "value"):
                if field in parameter and parameter[field] not in options:
                    issues.append(f"{where}/{field}: {field} must be one of options")

    _collect_action_issues(definition, issues)
    action_ids = {action["id"] for action in definition.get("actions", [])}
    screen_ids: set[str] = set()

    def visit(nodes: list[dict[str, Any]], where: str) -> None:
        for index, node in enumerate(nodes):
            here = f"{where}/{index}"
            kind = node["kind"]
            if kind == "control":
                parameter = by_id.get(node["param"])
                if parameter is None:
                    issues.append(f"{here}/param: unknown parameter: {node['param']}")
                elif "widget" in node and not _widget_fits(node["widget"], parameter):
                    issues.append(f"{here}/widget: widget {node['widget']} does not fit parameter {node['param']}")
            elif kind == "action":
                if node["action"] not in action_ids:
                    issues.append(f"{here}/action: unknown action: {node['action']}")
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
