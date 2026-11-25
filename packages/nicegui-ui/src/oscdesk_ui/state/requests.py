"""要求と答えの組: OSC パッド(D-080・D-126)、プロジェクトファイル(D-090・D-122)、定義の編集命令(D-123)。

UI のプロセスはブリッジへの接続を 1 本だけ持ち、複数のページの要求が乗るので、答えは要求の印ごとに置く。
"""

from __future__ import annotations

import uuid
from typing import Any

from ..protocol import ProjectSummary
from .models import _MAX_PENDING_PROJECT_EXPORTS


class RequestsMixin:
    """パッド・プロジェクト・編集命令の要求と答え。

    状態(属性)はすべて SurfaceState.__init__ が持つ。ここは振る舞いだけで、UI 要素には触れない(D-021)。
    """

    # --- OSC パッド(D-080) ------------------------------------------------

    def press_pad(self, button_id: str, version: str) -> bool:
        """採用中のパッドのボタンを押す。保持値にも表示値にも触れない(きっかけを撃つだけ)。送れなければ False。

        version は押した画面が描いたパッドの版(pad フレームの version)。描いた後に上書き保存されたり
        ブリッジが再起動したりしていればブリッジが断る(同じ id の別のボタンを撃たない)。
        """
        if self.pad.name is None or not version:
            return False
        return self.link.press_pad(self.pad.name, version, button_id)

    def save_pad(self, name: str, pad: dict[str, Any]) -> bool:
        """保存と採用を求める。結果は pad フレームで戻る(UI は保存成功を自分で確定しない)。"""
        return self.link.save_pad(name, pad)

    def load_pad(self, name: str) -> bool:
        return self.link.load_pad(name)

    def request_pad_edit(self, draft: dict[str, Any], edit: dict[str, Any]) -> str | None:
        """パッドの編集命令を送り(D-126)、答えを受け取るための印を返す。未接続なら None。規則と検証はブリッジ。"""
        self._pad_edit_seq += 1
        request_id = f"padedit-{self._pad_edit_seq}-{uuid.uuid4().hex[:12]}"
        if not self.link.edit_pad(request_id, draft, edit):
            return None
        self._pad_edits_in_flight.add(request_id)
        return request_id

    def take_pad_edit(self, request_id: str) -> dict[str, Any] | str | None:
        """パッドの編集命令の答えを受け取る(1 回だけ)。編集後の作業コピー、断られた理由、切断なら "disconnected"、まだなら None。"""
        return self._pad_edits.pop(request_id, None)

    def cancel_pad_edit(self, request_id: str) -> None:
        """待つのをやめた命令を忘れる。後から答えが届いても溜めない。"""
        self._pad_edits_in_flight.discard(request_id)
        self._pad_edits.pop(request_id, None)

    def _settle_pad_edit(self, request_id: str, result: dict[str, Any] | str) -> None:
        if request_id not in self._pad_edits_in_flight:
            return
        self._pad_edits_in_flight.discard(request_id)
        self._pad_edits[request_id] = result
        # 受け取らずに消えたページ(閉じたタブ)の分を溜め込まない(1 件はパッドの全体で、最大 8 MiB)
        while len(self._pad_edits) > _MAX_PENDING_PROJECT_EXPORTS:
            self._pad_edits.pop(next(iter(self._pad_edits)))

    # --- プロジェクトファイル(D-090) -------------------------------------

    def request_project_export(self) -> str | None:
        """書き出しを求め、応答を受け取るための印を返す。未接続なら None。"""
        self._project_request_seq += 1
        request_id = f"export-{self._project_request_seq}-{uuid.uuid4().hex[:12]}"
        if not self.link.export_project(request_id):
            return None
        self._project_requests_in_flight.append(request_id)
        return request_id

    def take_project_export(self, request_id: str) -> dict[str, Any] | str | None:
        """書き出しの結果を受け取る(1 回だけ)。届いた中身(dict)、断られた・届かなかった理由(str)、まだなら None。

        理由の通知は state が別に出しているので、ページは保留を消すだけでよい。
        """
        return self._project_exports.pop(request_id, None)

    def _settle_project_export(self, request_id: str, result: dict[str, Any] | str) -> None:
        if request_id in self._project_requests_in_flight:
            self._project_requests_in_flight.remove(request_id)
        self._project_exports[request_id] = result
        # 受け取らずに消えたページの分を溜め込まない(1 件は最大 12 MiB)
        while len(self._project_exports) > _MAX_PENDING_PROJECT_EXPORTS:
            self._project_exports.pop(next(iter(self._project_exports)))

    def request_surface_edit(self, draft: dict[str, Any] | None, edit: dict[str, Any]) -> str | None:
        """編集命令を送り(D-123)、答えを受け取るための印を返す。未接続なら None。規則と検証はブリッジ。"""
        self._surface_edit_seq += 1
        request_id = f"edit-{self._surface_edit_seq}-{uuid.uuid4().hex[:12]}"
        if not self.link.edit_surface(request_id, draft, edit):
            return None
        self._surface_edits_in_flight.add(request_id)
        return request_id

    def take_surface_edit(self, request_id: str) -> dict[str, Any] | str | None:
        """編集命令の答えを受け取る(1 回だけ)。編集後の作業コピー、断られた理由、切断なら "disconnected"、まだなら None。"""
        return self._surface_edits.pop(request_id, None)

    def cancel_surface_edit(self, request_id: str) -> None:
        """待つのをやめた命令を忘れる。後から答えが届いても溜めない。"""
        self._surface_edits_in_flight.discard(request_id)
        self._surface_edits.pop(request_id, None)

    def _settle_surface_edit(self, request_id: str, result: dict[str, Any] | str) -> None:
        if request_id not in self._surface_edits_in_flight:
            return
        self._surface_edits_in_flight.discard(request_id)
        self._surface_edits[request_id] = result
        # 受け取らずに消えたページ(閉じたタブ)の分を溜め込まない(1 件は定義の全体)
        while len(self._surface_edits) > _MAX_PENDING_PROJECT_EXPORTS:
            self._surface_edits.pop(next(iter(self._surface_edits)))

    def request_project_inspection(self, project: dict[str, Any]) -> str | None:
        """読み込む前の検査を求め(D-122)、答えを受け取るための印を返す。未接続なら None。

        取り込めるかの判定と確認のダイアログに出す要約はブリッジが作る(UI は判定の写しを持たない)。
        """
        self._project_request_seq += 1
        request_id = f"inspect-{self._project_request_seq}-{uuid.uuid4().hex[:12]}"
        if not self.link.inspect_project(request_id, project):
            return None
        self._project_inspections_in_flight.add(request_id)
        return request_id

    def take_project_inspection(self, request_id: str) -> ProjectSummary | str | None:
        """検査の答えを受け取る(1 回だけ)。通れば要約、断られれば理由(str)、切断で失われれば "disconnected"、まだなら None。"""
        return self._project_inspections.pop(request_id, None)

    def cancel_project_inspection(self, request_id: str) -> None:
        """待つのをやめた検査(ページの期限切れ)を忘れる。後から答えが届いても溜めない。"""
        self._project_inspections_in_flight.discard(request_id)
        self._project_inspections.pop(request_id, None)

    def _settle_project_inspection(self, request_id: str, result: ProjectSummary | str) -> None:
        # 問い合わせていない印の答えは受け取らない(受け取り手がおらず溜まるだけ)
        if request_id not in self._project_inspections_in_flight:
            return
        self._project_inspections_in_flight.discard(request_id)
        self._project_inspections[request_id] = result
        while len(self._project_inspections) > _MAX_PENDING_PROJECT_EXPORTS:
            self._project_inspections.pop(next(iter(self._project_inspections)))

    def import_project(self, project: dict[str, Any]) -> bool:
        """取り込みを求める。結果は surface・pad・desired と notice で戻る(画面は先に変えない)。未接続なら False。"""
        return self.link.import_project(project)

    @property
    def desired_unsent_since(self) -> str | None:
        """取り込んだプロジェクトの保持値をまだ Unity へ送っていなければ、取り込んだ時刻(ISO 8601)。"""
        return self._desired_unsent_since
