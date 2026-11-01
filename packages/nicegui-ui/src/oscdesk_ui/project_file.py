"""プロジェクトファイル(D-090)の読み込みの受け口とダウンロード用の整形。UI を持たない純粋関数。

正典は packages/shared/src/project-file.ts(zod)で、取り込めるかの判定と確認のダイアログに出す要約はブリッジが作る
(上り projectInspect・下り projectInspection。D-122)。ここで見るのは、アップロードされたバイト列を JSON のオブジェクト
として読めるかだけ(読めなければブリッジへ問い合わせようがない)。形・定義・パッドの検査の写しは持たない。
"""

from __future__ import annotations

import codecs
import json
import math
import re
from datetime import datetime
from typing import Any, Final

# packages/shared の PROJECT_FILE.MAX_SERIALIZED_BYTES と同じ(区切りの空白なしの UTF-8 の JSON で数える)。
# この上限の判定はブリッジ(JS の JSON.stringify で数える)だけが行う。Python の json は数値の書き方
# (1e-07 と 1e-7 など)が違い、境界で判定が割れるので、UI は上限で断らない(超えればブリッジの検査の答えで分かる)
PROJECT_FILE_MAX_BYTES: Final = 12 * 1024 * 1024
# アップロードの受け口の上限(ファイルそのもののバイト数)。ブラウザから UI のサーバへ巨大なファイルを流させない
# ための粗い歯止めで、ブリッジの上限より十分大きくする。書き出すファイルは、字下げしてもこの上限に収まるときだけ
# 字下げし、収まらなければ字下げしない(project_download_bytes)ので、書き出したファイルは必ず受け口を通る
PROJECT_UPLOAD_MAX_BYTES: Final = 2 * PROJECT_FILE_MAX_BYTES
# packages/shared の PROJECT_FILE.MAX_REQUEST_ID_CHARS と同じ
REQUEST_ID_MAX_CHARS: Final = 64

# UTF-8 の BOM(メモ帳などで保存し直したファイルの先頭に付く)
_BOM: Final = codecs.BOM_UTF8.decode("utf-8")


class ProjectFileError(ValueError):
    """アップロードされたファイルを JSON のオブジェクトとして読めない(文言は画面にそのまま出す)。"""


def parse_project_upload(raw: bytes) -> dict[str, Any]:
    """アップロードされたファイルを JSON のオブジェクトとして読む。読めなければ ProjectFileError(理由つき)。

    プロジェクトとして取り込めるかはブリッジへ問い合わせる(D-122)。
    """
    if len(raw) > PROJECT_UPLOAD_MAX_BYTES:
        raise ProjectFileError(f"ファイルが大きすぎます({len(raw):,} バイト)")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ProjectFileError("UTF-8 のテキストとして読めません") from error
    try:
        project = json.loads(text.removeprefix(_BOM), parse_float=_finite_float, parse_constant=_reject_constant)
    except json.JSONDecodeError as error:
        raise ProjectFileError(f"JSON として読めません: {error}") from error
    except ValueError as error:
        raise ProjectFileError(str(error)) from error
    if not isinstance(project, dict):
        raise ProjectFileError("プロジェクトファイルではありません(JSON のオブジェクトではありません)")
    return project


def _finite_float(text: str) -> float:
    # 1e400 などは Python の json では inf になり、上りの JSON に Infinity と書かれてブリッジが読めない(答えが返らず
    # 期限切れになる)。ブリッジ(JSON.parse)も有限の数しか持てないので、その場で理由を出して断る(PR #118 のレビュー)
    value = float(text)
    if not math.isfinite(value):
        raise ValueError(f"有限の数として読めない数値があります: {text[:32]}")
    return value


def _reject_constant(name: str) -> float:
    # NaN / Infinity / -Infinity は JSON の外の書き方で、ブリッジは読めない
    raise ValueError(f"JSON に使えない数値があります: {name}")


def describe_inspection_failure(detail: str) -> str:
    """検査で断られた理由(ブリッジの detail)を、そのまま出せる通知の文言にする。判定はブリッジが済ませていて、ここは言い換えだけ。"""
    if detail.startswith("surface-file:"):
        return "これはサーフェス定義のファイルです。定義は編集モードの「アップロード」で読み込んでください"
    if detail.startswith("too-large:"):
        return f"プロジェクトが大きすぎるため読み込めません: {detail.removeprefix('too-large:').strip()}"
    return f"プロジェクトを読み込めません: {detail or '理由は届きませんでした'}"


def project_download_bytes(project: dict[str, Any]) -> bytes:
    """ダウンロードするファイルの中身。非 ASCII はそのまま UTF-8 で書く。

    人が開いて見られるよう字下げするが、字下げで膨らんで(行の多いレコードでは数倍になる)アップロードの受け口の上限を
    超えるときは字下げしない。ブリッジが書き出せた(12 MiB 以下の)プロジェクトは、字下げしなければ必ず受け口に収まる。
    """
    indented = _utf8_json(json.dumps(project, ensure_ascii=False, indent=2))
    if len(indented) <= PROJECT_UPLOAD_MAX_BYTES:
        return indented
    return _utf8_json(json.dumps(project, ensure_ascii=False, separators=(",", ":")))


# Python の文字列に残るサロゲート(U+D800〜U+DFFF)は、対になったものは json.loads で 1 文字に戻っているので、すべて孤立したもの
_SURROGATE: Final = re.compile("[\ud800-\udfff]")


def _utf8_json(text: str) -> bytes:
    """JSON の本文を UTF-8 にする。孤立サロゲート(JS では正しい文字列で、パッドのラベルなどに入りうる)は UTF-8 で表せないので、
    生のまま書かず \\uXXXX のエスケープにする(生のまま書くと、書き出したファイルを読み込めなくなる)。"""
    return (_SURROGATE.sub(lambda match: f"\\u{ord(match.group()):04x}", text) + "\n").encode("utf-8")


def project_download_name(project: dict[str, Any], now: datetime) -> str:
    """ダウンロードのファイル名。定義名(無ければパッド名)と書き出した時刻を入れ、保管したファイルを見分けやすくする。"""
    safe = re.sub(r"[^A-Za-z0-9_-]", "_", _download_base(project))
    return f"{safe}-{now.strftime('%Y%m%d-%H%M%S')}.oscdesk-project.json"


def project_names(project: dict[str, Any]) -> tuple[str | None, str | None]:
    """書き出したプロジェクトの定義名とパッド名(無ければ None)。書き出しはブリッジが版 2 で作るので、版 2 の欄だけを見る。"""
    surface = project.get("surface")
    surface_name = surface.get("name") if isinstance(surface, dict) else None
    osc = project.get("osc")
    pad = osc.get("pad") if isinstance(osc, dict) else None
    pad_name = pad.get("name") if isinstance(pad, dict) else None
    return (
        surface_name if isinstance(surface_name, str) else None,
        pad_name if isinstance(pad_name, str) else None,
    )


def _download_base(project: dict[str, Any]) -> str:
    surface_name, pad_name = project_names(project)
    return surface_name or pad_name or "project"
