"""ネットワークの設定(D-113)の networkSettings フレームと、設定の変更の上り。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Final, Sequence

from .common import DecodedFrame, FrameDecodeError, ProtocolError, _dumps, _strict


# packages/shared の NETWORK_SETTINGS と同じ上限(D-113)
NETWORK_MAX_TARGET_RANGES: Final = 8
NETWORK_MAX_ALLOWED_BROWSERS: Final = 32
NETWORK_MAX_CIDR_CHARS: Final = 49
NETWORK_MAX_REQUESTER_CHARS: Final = 64
# networkSettings.revision の上限(JavaScript の Number.MAX_SAFE_INTEGER。packages/shared の wire.ts と同じ)
NETWORK_MAX_REVISION: Final = 2**53 - 1


@dataclass(frozen=True)
class NetworkInterfaceChoice:
    address: str
    name: str


@dataclass(frozen=True)
class NetworkSettingsFrame(DecodedFrame):
    """ネットワークの設定(D-113)。target_interface が None ならすべてのネットワーク、target_ranges が空なら自動。

    allowed_browsers が空ならこの PC の localhost だけ(localhost は常に許可)。UI のプロセスはこれで HTTP の接続元を判定する
    (設定ファイルは読まない。D-029)。
    """

    target_interface: str | None = None
    target_ranges: tuple[str, ...] = ()
    allowed_browsers: tuple[str, ...] = ()
    interfaces: tuple[NetworkInterfaceChoice, ...] = ()
    source: str = "default"
    # 設定の版(ブリッジの起動ごとに 0 から、変えるたびに進む)。変更の要求に添え、ブリッジが今の版と照合する
    revision: int = 0


def _network_settings(frame: dict[str, Any]) -> NetworkSettingsFrame:
    _strict(frame, {"v", "type", "revision", "targetInterface", "targetRanges", "allowedBrowsers", "interfaces", "source"}, "frame")
    for key in ("revision", "targetInterface", "targetRanges", "allowedBrowsers", "interfaces", "source"):
        if key not in frame:
            raise FrameDecodeError(f"networkSettings {key} is required")
    revision = frame["revision"]
    if isinstance(revision, bool) or not isinstance(revision, int) or not 0 <= revision <= NETWORK_MAX_REVISION:
        raise FrameDecodeError("networkSettings revision must be a non-negative integer")
    target_interface = frame["targetInterface"]
    if target_interface is not None and (not isinstance(target_interface, str) or not target_interface):
        raise FrameDecodeError("networkSettings targetInterface must be a non-empty string or null")

    def cidrs(key: str, limit: int) -> tuple[str, ...]:
        value = frame[key]
        if not isinstance(value, list) or len(value) > limit:
            raise FrameDecodeError(f"networkSettings {key} must be an array of at most {limit} items")
        if not all(isinstance(item, str) and 0 < len(item) <= NETWORK_MAX_CIDR_CHARS for item in value):
            raise FrameDecodeError(f"networkSettings {key} items must be CIDR strings")
        return tuple(value)

    interfaces = frame["interfaces"]
    if not isinstance(interfaces, list):
        raise FrameDecodeError("networkSettings interfaces must be an array")
    choices: list[NetworkInterfaceChoice] = []
    for item in interfaces:
        entry = _strict(item, {"address", "name"}, "networkSettings interface")
        if not isinstance(entry.get("address"), str) or not entry["address"] or not isinstance(entry.get("name"), str):
            raise FrameDecodeError("networkSettings interface must have an address and a name")
        choices.append(NetworkInterfaceChoice(entry["address"], entry["name"]))
    source = frame["source"]
    if source not in ("default", "saved", "unsaved"):
        raise FrameDecodeError("networkSettings source must be default, saved, or unsaved")
    return NetworkSettingsFrame(
        "networkSettings", 1, target_interface,
        cidrs("targetRanges", NETWORK_MAX_TARGET_RANGES), cidrs("allowedBrowsers", NETWORK_MAX_ALLOWED_BROWSERS),
        tuple(choices), source, revision,
    )


def encode_network_settings_set(
    target_interface: str | None,
    target_ranges: Sequence[str],
    allowed_browsers: Sequence[str],
    browser: str | None = None,
    *,
    revision: int,
) -> str:
    """ネットワークの設定を置き換える(D-113)。browser は操作元のブラウザのアドレスで、ブリッジが締め出しの判定に使う。

    revision は操作した画面が持っていた設定の版(networkSettings の revision)。ブリッジは今の版と違えば断る。
    """
    if isinstance(revision, bool) or not isinstance(revision, int) or not 0 <= revision <= NETWORK_MAX_REVISION:
        raise ProtocolError("revision must be a non-negative integer")
    if target_interface is not None and (not isinstance(target_interface, str) or not 0 < len(target_interface) <= NETWORK_MAX_CIDR_CHARS):
        raise ProtocolError("targetInterface must be a short non-empty string or None")

    def cidrs(values: Sequence[str], limit: int, label: str) -> list[str]:
        items = list(values)
        if len(items) > limit or not all(isinstance(item, str) and 0 < len(item) <= NETWORK_MAX_CIDR_CHARS for item in items):
            raise ProtocolError(f"{label} must be at most {limit} CIDR strings of up to {NETWORK_MAX_CIDR_CHARS} characters")
        return items

    payload: dict[str, Any] = {
        "v": 1,
        "type": "networkSettingsSet",
        "revision": revision,
        "targetInterface": target_interface,
        "targetRanges": cidrs(target_ranges, NETWORK_MAX_TARGET_RANGES, "targetRanges"),
        "allowedBrowsers": cidrs(allowed_browsers, NETWORK_MAX_ALLOWED_BROWSERS, "allowedBrowsers"),
    }
    if browser is not None:
        if not isinstance(browser, str) or not 0 < len(browser) <= NETWORK_MAX_REQUESTER_CHARS:
            raise ProtocolError("browser must be 1-64 characters")
        payload["browser"] = browser
    return _dumps(payload)
