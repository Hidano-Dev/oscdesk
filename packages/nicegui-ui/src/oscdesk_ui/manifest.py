"""マニフェスト(/sys/manifest)の解釈。

packages/shared/src/schemas.ts の ManifestSchema (zod) を Python 側で写したもの。
スキーマの正はあくまで TypeScript 側なので、変更時は両方を揃える。
"""

from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any, Final

from .address_pattern import is_valid_address_shape

VALUE_TYPES: Final = ("i", "f", "s", "b", "bool")
WIDGET_TYPES: Final = ("fader", "button", "toggle", "xy", "text", "input", "select")

# 送信を伴わない表示専用ウィジェット。widget-catalog.ts の interaction: false に対応する。
DISPLAY_ONLY_WIDGETS: Final = ("text",)

_MISSING: Final = object()


class ManifestError(ValueError):
    """マニフェストが契約を満たしていないときに送出する。"""


@dataclass(frozen=True)
class ManifestEntry:
    address: str
    label: str
    type: str
    widget: str
    value_range: tuple[float, float] | None = None
    default: Any = None
    has_default: bool = False
    group: str | None = None
    options: tuple[str, ...] | None = None
    options_ref: str | None = None
    pattern: str | None = None
    staged: bool = False
    applies_to: tuple[str, ...] | None = None

    @property
    def type_tag(self) -> str:
        """OSC 型タグ。bool は 0/1 の int として送る(DESIGN.md D-017)。"""
        if self.type == "bool":
            return "i"
        return self.type

    def clamp(self, value: float) -> float:
        if self.value_range is None:
            return value
        low, high = self.value_range
        return min(max(value, low), high)


@dataclass(frozen=True)
class Manifest:
    version: int
    project_id: str
    entries: tuple[ManifestEntry, ...]
    option_lists: dict[str, tuple[str, ...]] | None = None

    def groups(self) -> list[tuple[str | None, list[ManifestEntry]]]:
        """マニフェストの出現順を保ったままグループ分けする。未指定は先頭の None グループ。"""
        ordered: list[str | None] = []
        buckets: dict[str | None, list[ManifestEntry]] = {}

        for entry in self.entries:
            key = entry.group
            if key not in buckets:
                buckets[key] = []
                ordered.append(key)
            buckets[key].append(entry)

        return [(key, buckets[key]) for key in ordered]


def parse_manifest(payload: Any) -> Manifest:
    """dict もしくは JSON 文字列からマニフェストを組み立てる。"""
    if isinstance(payload, (str, bytes, bytearray)):
        import json

        try:
            payload = json.loads(payload)
        except ValueError as error:
            raise ManifestError(f"JSON として解釈できません: {error}") from error

    if not isinstance(payload, dict):
        raise ManifestError("マニフェストはオブジェクトである必要があります。")

    version = payload.get("version")
    if version != 1:
        raise ManifestError(f'version は 1 である必要があります (受信値: {version!r})。')

    project_id = payload.get("projectId")
    if not isinstance(project_id, str) or project_id == "":
        raise ManifestError("projectId は空でない文字列である必要があります。")

    option_lists = _parse_option_lists(payload.get("optionLists", _MISSING))

    raw_entries = payload.get("entries")
    if not isinstance(raw_entries, list):
        raise ManifestError("entries は配列である必要があります。")

    entries = tuple(_parse_entry(raw, index, option_lists) for index, raw in enumerate(raw_entries))

    return Manifest(version=1, project_id=project_id, entries=entries, option_lists=option_lists)


def _parse_entry(
    raw: Any,
    index: int,
    option_lists: dict[str, tuple[str, ...]] | None = None,
) -> ManifestEntry:
    where = f"entries[{index}]"

    if not isinstance(raw, dict):
        raise ManifestError(f"{where} はオブジェクトである必要があります。")

    address = raw.get("address")
    if not isinstance(address, str) or not address.startswith("/"):
        raise ManifestError(f"{where}.address は / で始まる文字列である必要があります。")

    label = raw.get("label")
    if not isinstance(label, str):
        raise ManifestError(f"{where}.label は文字列である必要があります。")

    value_type = raw.get("type")
    if value_type not in VALUE_TYPES:
        raise ManifestError(f"{where}.type は {VALUE_TYPES} のいずれかである必要があります。")

    widget = raw.get("widget")
    if widget not in WIDGET_TYPES:
        raise ManifestError(f"{where}.widget は {WIDGET_TYPES} のいずれかである必要があります。")

    if widget == "input" and value_type not in ("s", "i", "f"):
        raise ManifestError(f"{address}: input widget requires type s, i, or f")
    if widget == "select" and value_type != "s":
        raise ManifestError(f"{address}: select widget requires type s")

    raw_options = raw.get("options", _MISSING)
    if raw_options is not _MISSING and (
        not isinstance(raw_options, list) or not all(isinstance(item, str) for item in raw_options)
    ):
        raise ManifestError(f"{address}: options must be an array of strings")

    raw_options_ref = raw.get("optionsRef", _MISSING)
    if raw_options_ref is not _MISSING and not isinstance(raw_options_ref, str):
        raise ManifestError(f"{address}: optionsRef must be a string")

    if widget == "select" and raw_options is not _MISSING and raw_options_ref is not _MISSING:
        raise ManifestError(f"{address}: select widget cannot define both options and optionsRef")
    if widget == "select" and raw_options is _MISSING and raw_options_ref is _MISSING:
        raise ManifestError(f"{address}: select widget requires options or optionsRef")

    options_ref = None if raw_options_ref is _MISSING else raw_options_ref
    if options_ref is not None:
        if option_lists is None or options_ref not in option_lists:
            raise ManifestError(f'{address}: optionsRef "{options_ref}" was not found in optionLists')

    raw_pattern = raw.get("pattern", _MISSING)
    if raw_pattern is not _MISSING and not isinstance(raw_pattern, str):
        raise ManifestError(f"{address}: pattern must be a string")
    pattern = None if raw_pattern is _MISSING else raw_pattern
    if pattern is not None:
        if value_type != "s":
            raise ManifestError(f"{address}: pattern requires type s (pattern: {pattern!r})")
        try:
            re.compile(pattern)
        except re.error as error:
            raise ManifestError(
                f"{address}: invalid pattern {pattern!r}: {error}"
            ) from error

    value_range = _parse_range(raw.get("range", _MISSING), where)
    default = raw.get("default", _MISSING)
    group = _parse_group(raw.get("group", _MISSING), where)

    raw_staged = raw.get("staged", _MISSING)
    if raw_staged is not _MISSING and raw_staged is not True:
        raise ManifestError(f"{where}.staged must be true when present")

    raw_applies_to = raw.get("appliesTo", _MISSING)
    if raw_applies_to is not _MISSING:
        if widget != "button":
            raise ManifestError(f"{where}.appliesTo requires a button widget")
        if (
            not isinstance(raw_applies_to, list)
            or len(raw_applies_to) < 1
            or not all(isinstance(pattern, str) for pattern in raw_applies_to)
        ):
            raise ManifestError(f"{where}.appliesTo must be a non-empty array of strings")
        for pattern in raw_applies_to:
            if not is_valid_address_shape(pattern):
                raise ManifestError(f"{where}.appliesTo contains an invalid address pattern: {pattern!r}")

    if default is not _MISSING and not isinstance(default, (int, float, str, bool)):
        raise ManifestError(f"{where}.default は数値・文字列・真偽値のいずれかである必要があります。")

    return ManifestEntry(
        address=address,
        label=label,
        type=value_type,
        widget=widget,
        value_range=value_range,
        default=None if default is _MISSING else default,
        has_default=default is not _MISSING,
        group=group,
        options=(
            tuple(raw_options)
            if widget == "select" and raw_options is not _MISSING
            else option_lists[options_ref]
            if widget == "select" and options_ref is not None and option_lists is not None
            else None
        ),
        options_ref=options_ref,
        pattern=pattern,
        staged=raw_staged is True,
        applies_to=None if raw_applies_to is _MISSING else tuple(raw_applies_to),
    )


def _parse_option_lists(raw: Any) -> dict[str, tuple[str, ...]] | None:
    if raw is _MISSING:
        return None
    if not isinstance(raw, dict):
        raise ManifestError("optionLists must be an object of string arrays")

    result: dict[str, tuple[str, ...]] = {}
    for key, values in raw.items():
        if not isinstance(key, str) or not isinstance(values, list) or not all(
            isinstance(item, str) for item in values
        ):
            raise ManifestError("optionLists must be an object of string arrays")
        result[key] = tuple(values)
    return result


def _parse_range(raw: Any, where: str) -> tuple[float, float] | None:
    if raw is _MISSING:
        return None

    if (
        not isinstance(raw, list)
        or len(raw) != 2
        or not all(isinstance(item, (int, float)) and not isinstance(item, bool) for item in raw)
    ):
        raise ManifestError(f"{where}.range は数値 2 個の配列である必要があります。")

    return (float(raw[0]), float(raw[1]))


def _parse_group(raw: Any, where: str) -> str | None:
    if raw is _MISSING:
        return None

    if not isinstance(raw, str):
        raise ManifestError(f"{where}.group は文字列である必要があります。")

    trimmed = raw.strip()
    return trimmed if trimmed else None
