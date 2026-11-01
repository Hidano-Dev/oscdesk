"""サーフェス定義(D-043。版 2 は D-117)の本体と結び付けの出し入れ。

定義の判定(構造・参照・値域)はブリッジ(packages/shared の zod)だけが行い、UI は写しを持たない(D-122・D-123)。
画面の部品の木もブリッジが組み立てて配る(D-124)。ここに残すのは、編集モードの作業コピーのために本体と
結び付けを分けたりまとめたりする読み取りと、まとめ送りの上限だけ。
"""

from __future__ import annotations

from typing import Any, Mapping

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
