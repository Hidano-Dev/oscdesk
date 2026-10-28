"""プロジェクトファイル(D-090)の書き出し・読み込みと、「まだ Unity へ送っていない」の表示。

書き出しはブリッジがまとめた内容をブラウザへダウンロードさせるだけ。読み込みはアップロードしたファイルを確かめて
確認のダイアログを出し、ブリッジへ渡す(画面と保持値はブリッジの surface・pad・desired で揃う)。読み込んでも
Unity へは送らず、送るのは「Unity へ送る」(全宛先への resend)だけ。読み込みは定義の切り替えと同じ重さなので、
編集モードにだけ出す(D-049 / D-081 と揃える)。
"""

from __future__ import annotations

import time
from collections.abc import Callable
from datetime import datetime

from nicegui import events, ui

from .notify_history import notify
from .project_file import (
    PROJECT_UPLOAD_MAX_BYTES,
    ProjectFileError,
    parse_project_upload,
    project_download_bytes,
    project_download_name,
    summarize_project,
)
from .state import SurfaceState

# 書き出しの応答を待つ長さ。LAN 内で 12 MiB を運ぶのに十分で、届かなかったことに気づける長さ
EXPORT_TIMEOUT_S = 15.0


def unsent_message(since: str) -> str:
    """未送信の帯の文言。時刻はブラウザの時計でなくブリッジが記録した取り込み時刻(ISO 8601)を、分まで見せる。"""
    try:
        shown = datetime.fromisoformat(since.replace("Z", "+00:00")).astimezone().strftime("%m/%d %H:%M")
    except ValueError:
        shown = since
    return (
        f"読み込んだプロジェクトの保持値を、まだ Unity へ送っていません({shown} に読み込み)。"
        "画面の値と Unity の実際の状態は違うことがあります。Unity の再起動・再接続でも自動では送りません。"
    )


class ProjectPanel:
    """ページに 1 つ。画面の作り直し(定義の再配信)の外に置き、書き出しの待ちを作り直しで失わない。"""

    def __init__(
        self,
        state: SurfaceState,
        *,
        editing: Callable[[], bool],
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._state = state
        self._editing = editing
        self._clock = clock
        # 書き出しの要求の印 → 期限
        self._pending_exports: dict[str, float] = {}
        self._import_row: ui.element | None = None
        self._banner: ui.element | None = None
        self._banner_label: ui.label | None = None
        self._upload: ui.upload | None = None
        self._card: ui.card | None = None

    def build(self) -> None:
        with ui.card().classes("w-full q-pa-sm") as card:
            self._card = card
            with ui.row().classes("w-full items-center q-gutter-x-sm"):
                ui.label("プロジェクト").classes("text-subtitle2")
                ui.button("書き出す", icon="download", on_click=self._on_export).props("flat dense no-caps")
                with ui.row().classes("items-center q-gutter-x-sm") as import_row:
                    self._import_row = import_row
                    self._upload = ui.upload(
                        label="読み込む",
                        auto_upload=True,
                        max_files=1,
                        max_file_size=PROJECT_UPLOAD_MAX_BYTES,
                        on_upload=self._on_upload,
                        on_rejected=lambda _event=None: notify("ファイルが大きすぎるため読み込めません", type="negative"),
                    ).props("flat dense accept=.json").classes("max-w-48")
            ui.label(
                "定義・保持値(UI で管理する行を含む)・OSC パッドを 1 つのファイルにまとめます。読み込みは編集モードで行えます。"
            ).classes("text-caption text-grey-7")
            with ui.row().classes("w-full items-center no-wrap q-pa-sm bg-orange-1 rounded-borders q-mt-xs") as banner:
                self._banner = banner
                ui.icon("warning", color="warning")
                self._banner_label = ui.label("").classes("col text-body2")
                ui.button("Unity へ送る", icon="send", on_click=self._confirm_send).props("dense no-caps color=warning")
        # 表示の切り替えはページの同期タイマーの sync に任せる(組み立ての時点では編集モードのスイッチがまだ無い)
        import_row.set_visibility(False)
        banner.set_visibility(False)

    def sync(self) -> None:
        """ページの同期タイマーから呼ぶ(D-021)。表示の切り替えと、届いた書き出しのダウンロードを行う。"""
        if self._import_row is not None:
            editing = bool(self._editing())
            if self._import_row.visible != editing:
                self._import_row.set_visibility(editing)
        since = self._state.desired_unsent_since
        if self._banner is not None and self._banner_label is not None:
            if since is None:
                if self._banner.visible:
                    self._banner.set_visibility(False)
            else:
                text = unsent_message(since)
                if self._banner_label.text != text:
                    self._banner_label.text = text
                if not self._banner.visible:
                    self._banner.set_visibility(True)
        self._collect_exports()

    # --- 書き出し ----------------------------------------------------------

    def _on_export(self) -> None:
        request_id = self._state.request_project_export()
        if request_id is None:
            notify("ブリッジに接続していないため書き出せません", type="negative")
            return
        self._pending_exports[request_id] = self._clock() + EXPORT_TIMEOUT_S

    def _collect_exports(self) -> None:
        if not self._pending_exports or self._card is None:
            return
        # ダウンロードと通知はこのページ(クライアント)に出す。同期タイマーの外から呼ばれても宛先が決まるよう、枠に入る
        with self._card:
            self._collect_exports_in_context()

    def _collect_exports_in_context(self) -> None:
        now = self._clock()
        for request_id, deadline in list(self._pending_exports.items()):
            project = self._state.take_project_export(request_id)
            if isinstance(project, str):
                # 断られた(理由は state が notice で出している)か、切断で応答が失われた
                del self._pending_exports[request_id]
                if project == "disconnected":
                    notify("ブリッジとの接続が切れたため、プロジェクトを書き出せませんでした", type="warning")
                continue
            if project is not None:
                del self._pending_exports[request_id]
                ui.download(project_download_bytes(project), project_download_name(project, datetime.now()))
                summary = summarize_project(project)
                notify(f"プロジェクトを書き出しました({_describe(summary.surface_name, summary.pad_name)})", type="positive")
            elif now > deadline:
                # 断られたときは notice が別に届く。ここは応答そのものが来なかった(切断など)場合
                del self._pending_exports[request_id]
                notify("プロジェクトの書き出しの応答がありませんでした", type="warning")

    # --- 読み込み ----------------------------------------------------------

    async def _on_upload(self, event: events.UploadEventArguments) -> None:
        try:
            project = parse_project_upload(await _read_upload(event))
        except ProjectFileError as error:
            notify(f"プロジェクトを読み込めません: {error}", type="negative")
            return
        finally:
            # 同じファイルを続けて選び直せるように、受け口を空に戻す
            if self._upload is not None:
                self._upload.reset()
        self._confirm_import(project)

    def _confirm_import(self, project: dict) -> None:
        summary = summarize_project(project)
        state = self._state
        with ui.dialog() as dialog, ui.card().classes("w-[32rem] max-w-full"):
            ui.label("プロジェクトを読み込みますか?").classes("text-subtitle1")
            ui.label(f"書き出した日時: {summary.exported_at}").classes("text-body2")
            if summary.surface_name is not None:
                ui.label(
                    f"定義「{summary.surface_name}」と保持値(値 {summary.value_count} 件・行 {summary.row_count} 件)"
                ).classes("text-body2")
                ui.label(
                    f"採用中の定義「{state.active_surface or 'なし'}」とその保持値を置き換えます。"
                    f"保存済みの定義「{summary.surface_name}」は上書きされます(直前の内容はブリッジの .backups に残ります)。"
                ).classes("text-caption")
            else:
                ui.label("定義は含まれていないので、採用中の定義と保持値はそのままです。").classes("text-caption")
            if summary.pad_name is not None:
                ui.label(f"OSC パッド「{summary.pad_name}」(ボタン {summary.button_count} 個)").classes("text-body2")
                ui.label(
                    f"採用中のパッド「{state.pad.name or 'なし'}」を置き換え、保存済みのパッド「{summary.pad_name}」を上書きします。"
                ).classes("text-caption")
            else:
                ui.label("OSC パッドは含まれていないので、採用中のパッドはそのままです。").classes("text-caption")
            ui.label(
                "読み込んでも Unity へは送りません。画面で確かめてから「Unity へ送る」で送ってください。"
                "それまでは Unity の再起動・再接続でも自動では送りません。ほかの端末の画面も読み込んだ内容に替わります。"
            ).classes("text-caption text-warning")
            with ui.row().classes("w-full justify-end"):
                ui.button("やめる", on_click=dialog.close).props("flat no-caps")

                def confirm() -> None:
                    dialog.close()
                    if not state.import_project(project):
                        notify("ブリッジに接続していないため読み込めません", type="negative")
                        return
                    notify("プロジェクトの読み込みを要求しました", type="info")

                ui.button("読み込む", on_click=confirm).props("no-caps color=negative")
        dialog.open()

    # --- Unity へ送る -------------------------------------------------------

    def _confirm_send(self) -> None:
        with ui.dialog() as dialog, ui.card():
            ui.label("保持値をすべての Unity の宛先へ送りますか?").classes("text-subtitle1")
            ui.label("読み込んだプロジェクトの値が Unity に入ります。以後は再起動・再接続のときにも自動で送ります。").classes("text-caption")
            with ui.row().classes("w-full justify-end"):
                ui.button("やめる", on_click=dialog.close).props("flat no-caps")

                def send() -> None:
                    dialog.close()
                    if not self._state.link_status.connected:
                        notify("ブリッジに接続していないため送れません", type="negative")
                        return
                    self._state.request_resend()
                    notify("保持値の送信を要求しました", type="info")

                ui.button("送る", on_click=send).props("no-caps color=warning")
        dialog.open()


def _describe(surface: str | None, pad: str | None) -> str:
    parts = []
    if surface is not None:
        parts.append(f"定義「{surface}」")
    if pad is not None:
        parts.append(f"パッド「{pad}」")
    return "・".join(parts)


async def _read_upload(event: events.UploadEventArguments) -> bytes:
    # NiceGUI 3 は event.file(非同期 read)、2.x は event.content(同期ストリーム)。editor_panel と同じ扱い
    file = getattr(event, "file", None)
    if file is not None:
        return await file.read()
    return event.content.read()  # type: ignore[attr-defined]
