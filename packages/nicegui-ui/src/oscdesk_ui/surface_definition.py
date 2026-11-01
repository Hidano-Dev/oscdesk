"""サーフェス定義(D-043。版 2 は D-117)を画面で使うための読み取り。

定義の判定(構造・参照・値域)はブリッジ(packages/shared の zod)だけが行い、UI は写しを持たない(D-122・D-123)。
ここに残すのは、ブリッジが採用した定義から画面の部品・まとめ送りを組み立てるための読み取りだけ。
"""

from __future__ import annotations

from typing import Any, Mapping, Sequence

from .address_pattern import matches_pattern

# まとめ送り 1 回の上限(packages/shared の OSC_BATCH.MAX_MESSAGES と同じ値)
OSC_BATCH_MAX_MESSAGES = 512


def split_bindings(definition: Mapping[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """定義を本体(bindings を外したもの)と結び付けに分ける(D-117)。結び付けが無ければ空。"""
    body = {key: value for key, value in definition.items() if key != "bindings"}
    bindings = definition.get("bindings")
    return body, dict(bindings) if isinstance(bindings, dict) else {}


def join_bindings(body: Mapping[str, Any], bindings: Mapping[str, Any] | None) -> dict[str, Any]:
    """本体と結び付けを 1 つの定義にする(編集の作業コピー用)。結び付けが空なら本体だけ。"""
    joined = {key: value for key, value in body.items() if key != "bindings"}
    if bindings:
        joined["bindings"] = dict(bindings)
    return joined

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


def _selector_references(definition: Mapping[str, Any]) -> list[str]:
    """アクションの selector step が指す結び付けの id(定義順・重複なし)。"""
    ids: dict[str, None] = {}
    for action in definition.get("actions", []):
        for step in action["steps"]:
            if "selector" in step:
                ids.setdefault(step["selector"], None)
    return list(ids)


class _NoFixedValue:
    def __repr__(self) -> str:
        return "NO_FIXED_VALUE"


NO_FIXED_VALUE: Any = _NoFixedValue()
