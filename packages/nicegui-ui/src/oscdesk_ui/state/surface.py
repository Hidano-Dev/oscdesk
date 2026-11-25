"""採用中のサーフェス定義(surface・surfaceList)の取り込みと参照。"""

from __future__ import annotations

import logging
from dataclasses import replace
from typing import Any

from ..protocol import SurfaceFrame
from ..surface_definition import join_bindings
from ..surface_model import ControlSpec, SurfaceModel, surface_from_view
from .models import SurfaceStatus

# 分ける前と同じロガー名(oscdesk_ui.state)を使う(ログの絞り込みの設定を変えずに済むように)
logger = logging.getLogger(__package__)


class SurfaceMixin:
    """採用中の定義と画面の部品(D-117・D-124)。

    状態(属性)はすべて SurfaceState.__init__ が持つ。ここは振る舞いだけで、UI 要素には触れない(D-021)。
    """

    @property
    def surface(self) -> SurfaceModel | None:
        return self._surface

    @property
    def surface_revision(self) -> int:
        """画面の作り直しが必要になるたびに増える。ページはこれを見て再構築する。"""
        return self._surface_revision

    @property
    def definition(self) -> dict[str, Any] | None:
        """採用中の定義の本体(検証済みの生の dict。結び付けを含まない)。呼び出し側は変更しないこと。"""
        return self._definition

    @property
    def bindings(self) -> dict[str, Any]:
        """採用中の定義の結び付け(D-117)。ブリッジが OSC のアダプタを持つときだけ osc を持つ。"""
        return self._bindings

    @property
    def editable_definition(self) -> dict[str, Any] | None:
        """編集の出発点(本体に結び付けを添えたもの)。編集モードはこれを複製して変える(呼び出し側は変更しないこと)。"""
        if self._definition is None:
            return None
        return join_bindings(self._definition, self._bindings)

    @property
    def surface_status(self) -> SurfaceStatus:
        return self._surface_status

    @property
    def surface_names(self) -> tuple[str, ...]:
        return self._surface_names

    @property
    def active_surface(self) -> str | None:
        return self._active_surface

    def load_surface(self, name: str) -> None:
        self.link.load_surface(name)

    def save_surface(self, name: str, definition: dict[str, Any], *, activate: bool = True) -> bool:
        """検証済みの定義の保存を求める。採用の結果は surface フレームで戻る(値の確定と同じく Unity/ブリッジが正)。

        definition に bindings が入っていれば(編集した定義)本体と結び付けに分けて 1 フレームで送る(D-117)。
        """
        body = {key: value for key, value in definition.items() if key != "bindings"}
        bindings = definition.get("bindings")
        return self.link.save_surface(name, body, bindings=bindings if isinstance(bindings, dict) else None, activate=activate)

    def entry_for(self, param_id: str) -> ControlSpec | None:
        return self._entry_index.get(param_id)

    def _on_surface(self, frame: SurfaceFrame) -> None:
        definition = frame.definition
        if definition is None:
            return
        bindings = frame.bindings or {}
        try:
            # 部品の木はブリッジが組み立てて配る(D-124)。UI は読むだけ
            surface = surface_from_view(str(definition.get("name", frame.name)), frame.view or {})
        except Exception as error:  # noqa: BLE001 - 判定はブリッジだけが行う(D-122)ので、読めない形はここで受け止める
            # ブリッジが採用した定義を UI が描けない(UI の読み方が古いなど)。直前の画面を保ち、黙って捨てずに知らせる
            logger.error("サーフェス定義を取り込めません: %r", error)
            self._surface_status = replace(self._surface_status, detail="不正")
            self._add_notice("error", f"定義「{frame.name}」を画面にできません: {error!r}")
            return

        changed = (
            definition != self._definition
            or bindings != self._bindings
            or frame.view != self._view
            or frame.name != self._surface_status.name
        )
        self._surface_status = SurfaceStatus(
            detail="採用済み",
            name=frame.name,
            revision=frame.revision,
            parameter_count=len(surface.parameters),
        )
        if not changed:
            # 同じ内容の再配信(ブリッジは再採用のたびに revision を増やす)では画面を作り直さない
            return

        self._definition = definition
        self._bindings = dict(bindings)
        self._view = frame.view
        self._surface = surface
        # 古い定義への押下は、エコーが捨てられて「確認できません」と誤報になるので待たない
        self._action_batches = []
        self._entry_index = {spec.param_id: spec for spec in surface.parameters}
        self._current_specs = {
            id(spec): spec for spec in [*surface.parameters, *(spec for screen in surface.screens for spec in screen.controls)]
        }
        self._surface_revision += 1

        # 再描画で編集中のコントロールは破棄されるため、ホールドは送信せずに打ち切り
        # (保留中の間引き値も下書きも破棄)、見えなくなった値が後から送られないようにする
        cancelled = self.values.cancel_all_holds()
        if cancelled:
            logger.info("surface changed: cancelled %d hold(s) without sending: %s", len(cancelled), ", ".join(cancelled))

        # 続く desired(full) が届くまでの表示として default を入れる。OSC は送らない
        self.values.seed_defaults([spec for spec in surface.parameters if spec.kind == "state"])
        self._reset_records(surface)

    def _clear_surface(self) -> None:
        """採用中の定義が無くなったとき、古いコントロールを残さない。

        ブリッジ再起動後に有効な既定サーフェスが無いと surfaceList(active: null) だけが届く。
        ここで消さないと旧コントロールが残り、旧アドレスへ OSC を送り続けられる。
        """
        self.values.cancel_all_holds()
        self._action_batches = []
        self._definition = None
        self._bindings = {}
        self._view = None
        self._surface = None
        self._entry_index = {}
        self._current_specs = {}
        self._reset_records(None)
        self._surface_status = SurfaceStatus(detail="待機中")
        self._surface_revision += 1

    def _current_revision(self) -> int | None:
        """操作した画面が描いた定義の版(surface の revision)。ブリッジは採用中の版と違えば断る。"""
        revision = self._surface_status.revision
        return revision if isinstance(revision, int) and revision > 0 else None
