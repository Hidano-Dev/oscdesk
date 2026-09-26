"""Matching for the OSC address-pattern subset used by manifest staging."""

from __future__ import annotations

import re


def is_valid_address_shape(address: str) -> bool:
    """Return whether *address* has the supported OSC address shape."""
    if not isinstance(address, str):
        return False
    return (
        address.startswith("/")
        and len(address) > 1
        and not address.endswith("/")
        and "//" not in address
        and all(part for part in address.split("/")[1:])
        and not any(character in "?[]{}," for character in address)
    )


def matches_pattern(pattern: str, address: str) -> bool:
    """Match an address against the supported OSC address-pattern subset."""
    if not is_valid_address_shape(pattern) or not is_valid_address_shape(address):
        return False

    pattern_parts = pattern.split("/")
    address_parts = address.split("/")
    if len(pattern_parts) != len(address_parts):
        return False

    return all(
        _part_pattern_matches(pattern_part, address_part)
        for pattern_part, address_part in zip(pattern_parts, address_parts)
    )


def matches_any_pattern(patterns: list[str] | tuple[str, ...], address: str) -> bool:
    """Return whether at least one pattern matches the address."""
    return any(matches_pattern(pattern, address) for pattern in patterns)


def _part_pattern_matches(pattern: str, value: str) -> bool:
    expression = "".join(".*" if character == "*" else re.escape(character) for character in pattern)
    return re.fullmatch(expression, value) is not None
