"""Pure apply-scope resolution and apply-set construction."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Protocol, Sequence

from .address_pattern import matches_any_pattern
from .entry_rules import button_values, is_apply_trigger, is_display_only, validate_input_confirmation
from .manifest import Manifest, ManifestEntry
from .protocol import OscMessage, WireArg


class ApplyValueSource(Protocol):
    def values_of(self, address: str) -> tuple[Any, ...] | None: ...

    def is_holding(self, address: str) -> bool: ...

    def draft_of(self, address: str) -> tuple[bool, Any]: ...


@dataclass(frozen=True)
class SkippedEntry:
    address: str
    reason: Literal["no-value", "invalid-draft", "type-mismatch"]
    detail: str = ""


@dataclass(frozen=True)
class ApplySetPlan:
    trigger: ManifestEntry
    messages: tuple[OscMessage, ...]
    skipped: tuple[SkippedEntry, ...]

    @property
    def value_count(self) -> int:
        return len(self.messages) - 1


def resolve_apply_scope(manifest: Manifest, trigger: ManifestEntry) -> tuple[ManifestEntry, ...]:
    """Return staged, writable entries selected by an apply trigger."""
    if not is_apply_trigger(trigger):
        return ()

    patterns = trigger.applies_to or ()
    return tuple(
        entry
        for entry in manifest.entries
        if entry is not trigger
        and matches_any_pattern(patterns, entry.address)
        and entry.widget != "button"
        and entry.type != "b"
        and not is_display_only(entry)
        and entry.staged is True
    )


def to_wire_args(entry: ManifestEntry, values: Sequence[Any]) -> tuple[WireArg, ...]:
    """Normalize values to the strict wire representation for an entry.

    Unity は受信引数をそのままエコーバックするため(UNITY_PROTOCOL R2 / R4)、
    表示キャッシュにはエントリ型と合わない値が入りうる。合わない値は
    ``TypeError`` / ``ValueError`` にし、呼び出し側で除外する。
    """
    tag = entry.type_tag
    normalized: list[WireArg] = []
    for value in values:
        if isinstance(value, str) and tag in ("i", "f"):
            raise TypeError(f"{entry.address}: expected a number for tag {tag}, got str")
        if tag == "i":
            normalized.append(WireArg("i", int(value)))
        elif tag == "f":
            normalized.append(WireArg("f", float(value)))
        elif tag == "s":
            if not isinstance(value, str):
                raise TypeError(f"{entry.address}: expected str for tag s, got {type(value).__name__}")
            normalized.append(WireArg("s", value))
        else:
            normalized.append(WireArg(tag, value))
    return tuple(normalized)


def build_apply_set(
    trigger: ManifestEntry,
    targets: Sequence[ManifestEntry],
    source: ApplyValueSource,
) -> ApplySetPlan:
    """Build value messages in target order followed by the trigger on message."""
    if not is_apply_trigger(trigger):
        raise ValueError("trigger must be an apply trigger")

    messages: list[OscMessage] = []
    skipped: list[SkippedEntry] = []
    for entry in targets:
        values: tuple[Any, ...] | None
        if source.is_holding(entry.address):
            has_draft, draft = source.draft_of(entry.address)
            if has_draft:
                confirmation = validate_input_confirmation(entry, draft)
                if confirmation.values is None:
                    skipped.append(SkippedEntry(entry.address, "invalid-draft", confirmation.error or "invalid draft"))
                    continue
                values = confirmation.values
            else:
                values = source.values_of(entry.address)
        else:
            values = source.values_of(entry.address)

        if values is None:
            skipped.append(SkippedEntry(entry.address, "no-value"))
            continue
        try:
            args = to_wire_args(entry, values)
        except (TypeError, ValueError) as error:
            skipped.append(SkippedEntry(entry.address, "type-mismatch", str(error)))
            continue
        messages.append(OscMessage(entry.address, args))

    on_value, _ = button_values(trigger)
    messages.append(OscMessage(trigger.address, to_wire_args(trigger, (on_value,))))
    return ApplySetPlan(trigger, tuple(messages), tuple(skipped))
