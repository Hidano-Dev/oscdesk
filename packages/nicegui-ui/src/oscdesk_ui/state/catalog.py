"""設計図(D-104・HID-386)の表示キャッシュの参照。取り込みは core の _on_frame。"""

from __future__ import annotations

from typing import Any

from ..surface_model import ControlSpec


class CatalogMixin:
    """設計図の参照。

    状態(属性)はすべて SurfaceState.__init__ が持つ。ここは振る舞いだけで、UI 要素には触れない(D-021)。
    """

    # --- 設計図(D-104・HID-386) ---------------------------------------------

    @property
    def catalog_pcs(self) -> tuple[dict[str, Any], ...]:
        """ブリッジが持つ PC ごとの設計図(host・name・receivedAt・verified・items)。"""
        return self._catalog_pcs

    @property
    def catalog_mismatched_hosts(self) -> frozenset[str]:
        """設計図が送り元と一致していない PC の送信元ホスト(verified が false。要約値の食い違いと、大きすぎて受け取れなかったときの
        両方。catalog はこの 2 つを区別しない)。一致・未照合に戻るか、切断すると外れる(D-118)。"""
        return self._catalog_mismatched

    @property
    def blueprint_pc(self) -> dict[str, str] | None:
        """採用中の画面を作った設計図の PC。設計図から作った画面でなければ None。"""
        return self._blueprint_pc

    def is_absent(self, entry: ControlSpec) -> bool:
        """設計図から作った画面で、その PC の設計図に無いパラメータか(「この PC には無い」として薄く出す)。"""
        return entry.param_id in self._absent_params
