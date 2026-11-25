"""エコーの値が送った値と同じかの判定(まとめ送りの確認。float32 の往復の揺れだけを許す)。"""

from __future__ import annotations

import struct
from typing import Any


# Unity は float32 で受けて返すので、期待値も float32 へ丸めてから比べる。
# 丸めの揺れ(往復での 1〜2 ULP)だけを許し、値の大きさに比例して緩む相対許容差は使わない
_FLOAT32_MAX_ULP = 2
# 0 付近は ULP が極小で、表示の丸め(0 → 1e-5 など)まで落とすため、絶対許容差だけ残す
_FLOAT_TOLERANCE = 1e-4


def _same_values(expected: tuple[Any, ...], actual: tuple[Any, ...]) -> bool:
    if len(expected) != len(actual):
        return False
    for want, got in zip(expected, actual):
        # どちらかが文字列なら厳密比較のみ。数値タグのエコーを float() に通すと、
        # "auto" で ValueError、"1" が数値 1 で誤って確認される
        if isinstance(want, str) or isinstance(got, str):
            if want != got:
                return False
        # 整数同士は厳密比較(int32 は 2^24 超で float32 に丸めると別の値が同じになる)
        elif isinstance(want, int) and isinstance(got, int):
            if want != got:
                return False
        elif not _same_float32(float(want), float(got)):
            return False
    return True


def _float32_order(value: float) -> int | None:
    """float32 を、大小順と整数の大小順が一致する整数へ写す(隣り合う float32 は 1 違う)。"""
    try:
        bits = struct.unpack("<i", struct.pack("<f", value))[0]
    except OverflowError:
        return None
    return bits if bits >= 0 else -0x80000000 - bits


def _same_float32(want: float, got: float) -> bool:
    want_order = _float32_order(want)
    got_order = _float32_order(got)
    if want_order is None or got_order is None:
        return want == got
    if abs(want - got) <= _FLOAT_TOLERANCE:
        return True
    return abs(want_order - got_order) <= _FLOAT32_MAX_ULP
