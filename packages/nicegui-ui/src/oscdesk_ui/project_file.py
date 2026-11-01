"""プロジェクトファイル(D-090)の形の検査・要約・ダウンロード用の整形。UI を持たない純粋関数。

正典は packages/shared/src/project-file.ts(zod)で、取り込みの可否はブリッジが決める。ここで見るのは、
アップロードされたファイルを確認のダイアログに出す前に、明らかに違うもの(別の種類の JSON・大きすぎる・
定義やパッドとして読めない)をその場で断るための検査と、ダイアログに出す要約だけ。
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final

from .osc_pad import collect_pad_issues
from .surface_definition import SurfaceDefinitionError, validate_surface_definition

PROJECT_FILE_FORMAT: Final = "oscdesk-project"
PROJECT_FILE_VERSION: Final = 2
# 版 1 のファイル(定義が版 1・保持値が OSC のアドレスの形)も取り込める。移すのはブリッジ(D-117)
LEGACY_PROJECT_FILE_VERSION: Final = 1
# packages/shared の PROJECT_FILE.MAX_SERIALIZED_BYTES と同じ(区切りの空白なしの UTF-8 の JSON で数える)。
# この上限の判定はブリッジ(JS の JSON.stringify で数える)だけが行う。Python の json は数値の書き方
# (1e-07 と 1e-7 など)が違い、境界で判定が割れるので、UI は上限で断らない(超えればブリッジの拒否の通知で分かる)
PROJECT_FILE_MAX_BYTES: Final = 12 * 1024 * 1024
# アップロードの受け口の上限(ファイルそのもののバイト数)。ブラウザから UI のサーバへ巨大なファイルを流させない
# ための粗い歯止めで、ブリッジの上限より十分大きくする。書き出すファイルは、字下げしてもこの上限に収まるときだけ
# 字下げし、収まらなければ字下げしない(project_download_bytes)ので、書き出したファイルは必ず受け口を通る
PROJECT_UPLOAD_MAX_BYTES: Final = 2 * PROJECT_FILE_MAX_BYTES
# packages/shared の PROJECT_FILE.MAX_REQUEST_ID_CHARS と同じ
REQUEST_ID_MAX_CHARS: Final = 64

_TOP_KEYS: Final = frozenset({"format", "version", "exportedAt", "surface", "osc"})
_LEGACY_TOP_KEYS: Final = frozenset({"format", "version", "exportedAt", "surface", "pad"})


class ProjectFileError(ValueError):
    """アップロードされたファイルがプロジェクトとして読めない(文言は画面にそのまま出す)。"""


@dataclass(frozen=True)
class ProjectSummary:
    """確認のダイアログに出す中身。"""

    exported_at: str
    surface_name: str | None
    value_count: int
    row_count: int
    pad_name: str | None
    button_count: int
    # 生成の記録(HID-385)の件数(送り先の PC ごとに 1 件)
    spawn_count: int = 0


def _is_legacy(project: dict[str, Any]) -> bool:
    return project.get("version") == LEGACY_PROJECT_FILE_VERSION and not isinstance(project.get("version"), bool)


def _pad_entry_issues(pad: Any, where: str) -> list[str]:
    from .protocol import is_valid_surface_name  # protocol がこのモジュールを import するので遅らせる

    if pad is None:
        return []
    if not isinstance(pad, dict) or set(pad) != {"name", "pad"}:
        return [f"{where} must have exactly name and pad"]
    issues: list[str] = []
    if not is_valid_surface_name(pad["name"]):
        issues.append(f"{where}.name is not a valid name")
    if not isinstance(pad["pad"], dict):
        issues.append(f"{where}.pad must be an object")
    return issues


def project_pad(project: dict[str, Any]) -> dict[str, Any] | None:
    """プロジェクトの OSC パッド({name, pad})。版 2 は osc の欄、版 1 は直下の pad(D-117)。"""
    if _is_legacy(project):
        return project.get("pad")
    osc = project.get("osc")
    return osc.get("pad") if isinstance(osc, dict) else None


def project_shape_issues(project: Any) -> list[str]:
    """プロジェクトの外形の問題を列挙する(空なら外形は正しい)。定義・パッドの中身はここでは見ない。

    版 2(D-117)は保持値が id と JSON の値、OSC パッドと生成の記録が osc の欄。版 1 のファイルも外形が合えば通す
    (定義と保持値を版 2 へ移すのはブリッジ)。
    """
    from .protocol import is_valid_surface_name  # protocol がこのモジュールを import するので遅らせる

    if not isinstance(project, dict):
        return ["project must be an object"]
    issues: list[str] = []
    legacy = _is_legacy(project)
    unknown = set(project) - (_LEGACY_TOP_KEYS if legacy else _TOP_KEYS)
    if unknown:
        issues.append(f"unknown key(s): {', '.join(sorted(unknown))}")
    if project.get("format") != PROJECT_FILE_FORMAT:
        issues.append(f"format must be {PROJECT_FILE_FORMAT!r}")
    if not legacy and (project.get("version") != PROJECT_FILE_VERSION or isinstance(project.get("version"), bool)):
        issues.append(f"version must be {PROJECT_FILE_VERSION} (or {LEGACY_PROJECT_FILE_VERSION})")
    if not isinstance(project.get("exportedAt"), str):
        issues.append("exportedAt must be a string")
    if legacy and ("surface" not in project or "pad" not in project):
        issues.append("surface and pad are required (null when absent)")
        return issues
    if not legacy and "surface" not in project:
        issues.append("surface is required (null when absent)")
        return issues
    osc = project.get("osc")
    if not legacy and osc is not None and (not isinstance(osc, dict) or set(osc) != {"pad"}):
        issues.append("osc must have exactly pad")
        return issues
    surface, pad = project["surface"], project_pad(project)
    if surface is None and pad is None:
        issues.append("project must contain a surface or a pad")
    if surface is not None:
        surface_keys = {"name", "definition", "values"}
        allowed = surface_keys if legacy else surface_keys | {"osc"}
        if not isinstance(surface, dict) or not surface_keys <= set(surface) or set(surface) - allowed:
            issues.append("surface must have name, definition and values" + ("" if legacy else " (and optional osc)"))
        else:
            if not is_valid_surface_name(surface["name"]):
                issues.append("surface.name is not a valid name")
            if not isinstance(surface["definition"], dict):
                issues.append("surface.definition must be an object")
            values = surface["values"]
            if legacy:
                if (
                    not isinstance(values, dict)
                    or not isinstance(values.get("values"), list)
                    or not isinstance(values.get("records"), list)
                    or not isinstance(values.get("keyLists", []), list)
                    or not isinstance(values.get("spawns", []), list)
                    or set(values) - {"values", "records", "keyLists", "spawns"}
                ):
                    issues.append("surface.values must have values and records arrays (and optional keyLists and spawns)")
            else:
                if (
                    not isinstance(values, dict)
                    or not isinstance(values.get("values"), list)
                    or not isinstance(values.get("rows"), list)
                    or not isinstance(values.get("keyLists", []), list)
                    or set(values) - {"values", "rows", "keyLists"}
                ):
                    issues.append("surface.values must have values and rows arrays (and optional keyLists)")
                surface_osc = surface.get("osc", {})
                if not isinstance(surface_osc, dict) or set(surface_osc) - {"spawns"} or not isinstance(surface_osc.get("spawns", []), list):
                    issues.append("surface.osc must have only an optional spawns array")
    issues.extend(_pad_entry_issues(pad, "pad" if legacy else "osc.pad"))
    return issues


def parse_project_upload(raw: bytes) -> dict[str, Any]:
    """アップロードされたファイルをプロジェクトとして読む。読めなければ ProjectFileError(理由つき)。"""
    if len(raw) > PROJECT_UPLOAD_MAX_BYTES:
        raise ProjectFileError(f"ファイルが大きすぎます({len(raw):,} バイト)")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ProjectFileError("UTF-8 のテキストとして読めません") from error
    try:
        project = json.loads(text.removeprefix("﻿"))
    except json.JSONDecodeError as error:
        raise ProjectFileError(f"JSON として読めません: {error}") from error
    issues = project_shape_issues(project)
    if issues:
        if isinstance(project, dict) and project.get("format") == "oscdesk-surface":
            raise ProjectFileError("これはサーフェス定義のファイルです。定義は編集モードの「アップロード」で読み込んでください")
        raise ProjectFileError(f"プロジェクトファイルではありません: {'; '.join(issues[:3])}")
    # 版 1 の定義はブリッジが版 2 へ移してから検証する(UI は版 2 の規則しか持たない)
    if project["surface"] is not None and not _is_legacy(project):
        try:
            validate_surface_definition(project["surface"]["definition"])
        except SurfaceDefinitionError as error:
            raise ProjectFileError(f"定義が不正です: {error}") from error
    pad = project_pad(project)
    if pad is not None:
        pad_issues = collect_pad_issues(pad["pad"])
        if pad_issues:
            raise ProjectFileError(f"パッドが不正です: {'; '.join(pad_issues[:3])}")
    # 大きさの上限(12 MiB)はブリッジが判定する(PROJECT_FILE_MAX_BYTES の注記)
    return project


def summarize_project(project: dict[str, Any]) -> ProjectSummary:
    surface = project.get("surface")
    pad = project_pad(project)
    values = surface["values"] if isinstance(surface, dict) else {}
    legacy = _is_legacy(project)
    if legacy:
        spawns = values.get("spawns", [])
    else:
        surface_osc = surface.get("osc", {}) if isinstance(surface, dict) else {}
        spawns = surface_osc.get("spawns", []) if isinstance(surface_osc, dict) else []
    return ProjectSummary(
        exported_at=str(project.get("exportedAt", "")),
        surface_name=surface["name"] if isinstance(surface, dict) else None,
        value_count=len(values.get("values", [])),
        row_count=len(values.get("records" if legacy else "rows", [])),
        pad_name=pad["name"] if isinstance(pad, dict) else None,
        button_count=len(pad["pad"].get("buttons", [])) if isinstance(pad, dict) else 0,
        spawn_count=len(spawns),
    )


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
    summary = summarize_project(project)
    base = summary.surface_name or summary.pad_name or "project"
    safe = re.sub(r"[^A-Za-z0-9_-]", "_", base)
    return f"{safe}-{now.strftime('%Y%m%d-%H%M%S')}.oscdesk-project.json"
