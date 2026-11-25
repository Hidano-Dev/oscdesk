"""宛先タブ(D-078)の destinations フレームと、走査・選択・リセット・別名の上り。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Final, Sequence

from .common import (
    DecodedFrame,
    FrameDecodeError,
    ProtocolError,
    _bool,
    _dumps,
    _iso_datetime,
    _port,
    _string,
    _strict,
    _strings,
    has_lone_surrogate,
    utf16_length,
)


# bridge 側 (packages/shared/src/limits.ts) の DESTINATIONS.MAX_SELECTED_HOSTS と同じ上限
DESTINATIONS_MAX_SELECTED_HOSTS: Final = 256
# packages/shared の DESTINATIONS.MAX_SCAN_INTERFACES と同じ(ネットワークごとの全てのデバイスで選べる数。D-085)
DESTINATIONS_MAX_NETWORKS: Final = 4
# packages/shared の DESTINATIONS.MAX_ALIAS_CHARS と同じ(端末の別名の文字数。D-092)
DESTINATIONS_MAX_ALIAS_CHARS: Final = 64
# packages/shared の DESTINATIONS.MAX_ALIAS_INPUT_CHARS と同じ(destinationsAlias でフレームとして送れる長さ)
DESTINATIONS_MAX_ALIAS_INPUT_CHARS: Final = 256


@dataclass(frozen=True)
class DestinationDevice:
    """宛先タブの一覧の 1 台(D-078)。found は直近の走査で見つかったか、is_self はこの PC(ブリッジの PC)か。

    hostname はブリッジが引けた端末の名前(この PC は OS のホスト名)。引けなければ None(D-085)。
    alias は UI から付けた別名(ブリッジが MAC か host で覚えたもの)。無ければ None(D-092)。
    """

    host: str
    hostname: str | None
    mac: str | None
    interface: str | None
    is_self: bool
    configured: bool
    found: bool
    alias: str | None = None


@dataclass(frozen=True)
class DestinationBroadcast:
    """「全てのデバイス」で送るブロードキャストアドレス(D-079)。network は CIDR 表記。"""

    address: str
    interface: str
    network: str


@dataclass(frozen=True)
class DestinationTarget:
    """ブリッジが実際に送っている宛先(hello.targets と同じ形 + broadcast)。"""

    name: str
    host: str
    send_port: int
    primary: bool
    broadcast: bool


@dataclass(frozen=True)
class DestinationsFrame(DecodedFrame):
    """宛先タブ(D-078)。毎回全量で、UI は丸ごと置き換える。

    source は config(選択なし。設定ファイルの宛先)/ saved(保存した選択)/ unsaved(選択は効いているがファイルへ書けなかった)。
    networks はネットワークごとの「全てのデバイス」で選んだネットワーク(broadcasts の network。D-085)。
    """

    send_port: int = 0
    scanning: bool = False
    scanned_at: str | None = None
    devices: tuple[DestinationDevice, ...] = ()
    broadcasts: tuple[DestinationBroadcast, ...] = ()
    source: str = "config"
    all_devices: bool = False
    networks: tuple[str, ...] = ()
    hosts: tuple[str, ...] = ()
    targets: tuple[DestinationTarget, ...] = ()
    # 主系の Unity とみなす送信元ホスト(主系がブロードキャスト・この PC のとき host と送信元が一致しないため。D-079)
    primary_hosts: tuple[str, ...] = ()


def _destinations(frame: dict[str, Any]) -> DestinationsFrame:
    keys = {"sendPort", "scanning", "scannedAt", "devices", "broadcasts", "selection", "targets", "primaryHosts"}
    _strict(frame, {"v", "type", *keys}, "frame")
    missing = keys - set(frame)
    if missing:
        raise FrameDecodeError(f"destinations is missing: {', '.join(sorted(missing))}")
    devices = frame["devices"]
    broadcasts = frame["broadcasts"]
    targets = frame["targets"]
    if not isinstance(devices, list) or not isinstance(broadcasts, list) or not isinstance(targets, list):
        raise FrameDecodeError("destinations devices, broadcasts and targets must be arrays")
    if not targets:
        raise FrameDecodeError("destinations targets must not be empty")
    decoded_devices = []
    for item in devices:
        device_keys = {"host", "hostname", "alias", "mac", "interface", "self", "configured", "found"}
        device = _strict(item, device_keys, "destinations device")
        if set(device) != device_keys:
            raise FrameDecodeError("destinations device is missing a key")
        hostname = _string(device["hostname"], "device hostname", nullable=True)
        if hostname == "" or (hostname is not None and len(hostname) > 253):
            raise FrameDecodeError("device hostname must be 1-253 characters or null")
        alias = _string(device["alias"], "device alias", nullable=True)
        if alias == "" or (alias is not None and utf16_length(alias) > DESTINATIONS_MAX_ALIAS_CHARS):
            raise FrameDecodeError(f"device alias must be 1-{DESTINATIONS_MAX_ALIAS_CHARS} characters or null")
        # 孤立サロゲートを含む名前は表示の名前として使わない(無いものとして IP を見せる)。NiceGUI の orjson が描画で
        # 符号化に失敗し、その端末が一覧にある限りページの更新が止まる。フレームごと捨てると宛先一覧を受け取れなくなる
        if hostname is not None and has_lone_surrogate(hostname):
            hostname = None
        if alias is not None and has_lone_surrogate(alias):
            alias = None
        decoded_devices.append(DestinationDevice(
            _string(device["host"], "device host", non_empty=True),
            hostname,
            _string(device["mac"], "device mac", nullable=True),
            _string(device["interface"], "device interface", nullable=True),
            _bool(device["self"], "device self"),
            _bool(device["configured"], "device configured"),
            _bool(device["found"], "device found"),
            alias,
        ))
    decoded_broadcasts = []
    for item in broadcasts:
        broadcast = _strict(item, {"address", "interface", "network"}, "destinations broadcast")
        decoded_broadcasts.append(DestinationBroadcast(
            _string(broadcast.get("address"), "broadcast address", non_empty=True),
            _string(broadcast.get("interface"), "broadcast interface"),
            _string(broadcast.get("network"), "broadcast network"),
        ))
    decoded_targets = []
    for item in targets:
        target = _strict(item, {"name", "host", "sendPort", "primary", "broadcast"}, "destinations target")
        decoded_targets.append(DestinationTarget(
            _string(target.get("name"), "target name"),
            _string(target.get("host"), "target host"),
            _port(target.get("sendPort"), "target sendPort"),
            _bool(target.get("primary"), "target primary"),
            _bool(target.get("broadcast"), "target broadcast"),
        ))
    selection_keys = {"source", "allDevices", "networks", "hosts"}
    selection = _strict(frame["selection"], selection_keys, "destinations selection")
    if set(selection) != selection_keys:
        raise FrameDecodeError("destinations selection is missing a key")
    if selection.get("source") not in ("config", "saved", "unsaved"):
        raise FrameDecodeError("destinations selection source must be config, saved or unsaved")
    scanned_at = frame["scannedAt"]
    return DestinationsFrame(
        "destinations",
        1,
        _port(frame["sendPort"], "destinations sendPort"),
        _bool(frame["scanning"], "destinations scanning"),
        None if scanned_at is None else _iso_datetime(scanned_at, "destinations scannedAt"),
        tuple(decoded_devices),
        tuple(decoded_broadcasts),
        selection["source"],
        _bool(selection.get("allDevices"), "selection allDevices"),
        _strings(selection.get("networks"), "selection networks"),
        _strings(selection.get("hosts"), "selection hosts"),
        tuple(decoded_targets),
        _strings(frame["primaryHosts"], "destinations primaryHosts"),
    )


def encode_destinations_scan() -> str:
    """宛先タブの「更新」。ブリッジに LAN を走査させる(D-078)。"""
    return _dumps({"v": 1, "type": "destinationsScan"})


def encode_destinations_select(all_devices: bool, networks: Sequence[str], hosts: Sequence[str]) -> str:
    """宛先の選択(D-078 / D-085)。all_devices の間も networks と hosts は外したときに戻すために送る。"""
    if not isinstance(all_devices, bool):
        raise ProtocolError("allDevices must be a boolean")
    chosen = list(networks)
    if len(chosen) > DESTINATIONS_MAX_NETWORKS or not all(isinstance(network, str) and 0 < len(network) <= 18 for network in chosen):
        raise ProtocolError(f"networks must be at most {DESTINATIONS_MAX_NETWORKS} CIDR strings")
    selected = list(hosts)
    if len(selected) > DESTINATIONS_MAX_SELECTED_HOSTS or not all(isinstance(host, str) and host for host in selected):
        raise ProtocolError(f"hosts must be at most {DESTINATIONS_MAX_SELECTED_HOSTS} non-empty strings")
    return _dumps({"v": 1, "type": "destinationsSelect", "allDevices": all_devices, "networks": chosen, "hosts": selected})


def encode_destinations_reset() -> str:
    """保存した選択を消して設定ファイルの宛先へ戻す(D-078)。"""
    return _dumps({"v": 1, "type": "destinationsReset"})


def encode_destinations_alias(host: str, alias: str | None) -> str:
    """端末の別名を付ける・消す(D-092)。alias が None なら消す。MAC か host のどちらで覚えるかはブリッジが決める。"""
    if not isinstance(host, str) or not 0 < len(host) <= 253:
        raise ProtocolError("host must be 1-253 characters")
    # フレームとして送れる長さ(別名の上限より広い。上限の判定はブリッジが理由つきで返す)。UTF-16 の単位で数える
    if alias is not None and (not isinstance(alias, str) or utf16_length(alias) > DESTINATIONS_MAX_ALIAS_INPUT_CHARS):
        raise ProtocolError(f"alias must be at most {DESTINATIONS_MAX_ALIAS_INPUT_CHARS} UTF-16 code units or None")
    return _dumps({"v": 1, "type": "destinationsAlias", "host": host, "alias": alias})
