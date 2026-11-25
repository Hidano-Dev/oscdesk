"""設計図(D-104・HID-386)のフレーム(catalog・blueprintStatus)と、設計図の要求・採用の上り。"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Final

from .common import (
    DecodedFrame,
    FrameDecodeError,
    ProtocolError,
    _bool,
    _dumps,
    _is_identifier,
    _iso_datetime,
    _string,
    _strict,
)


# packages/shared の CATALOG と同じ上限
CATALOG_MAX_PCS: Final = 64
CATALOG_MAX_PROPS_PER_ITEM: Final = 32
CATALOG_MAX_STRING_CHARS: Final = 1024


@dataclass(frozen=True)
class BlueprintStatusFrame(DecodedFrame):
    """採用中の画面と設計図の突き合わせ(HID-386)。pc は設計図から作った画面の取得元(無ければ None)。"""

    pc: dict[str, str] | None = None
    absent: tuple[str, ...] = ()


@dataclass(frozen=True)
class CatalogFrame(DecodedFrame):
    """ターゲットから受けた設計図(D-104)。1 フレームは変わった PC の全量(D-131)。

    pcs は形だけを確かめた生の dict の並びで、host が同じ PC を丸ごと置き換える。hosts は今ある PC の host の全部(並び順)で、
    ここに無い PC は捨てる。"""

    pcs: tuple[dict[str, Any], ...] = ()
    hosts: tuple[str, ...] = ()


def _catalog_pc(value: Any) -> dict[str, Any]:
    pc = _strict(value, {"host", "name", "receivedAt", "verified", "items"}, "catalog pc")
    _string(pc.get("host"), "catalog host", non_empty=True)
    _string(pc.get("name"), "catalog name", non_empty=True)
    _iso_datetime(pc.get("receivedAt"), "catalog receivedAt")
    if pc.get("verified") is not None:
        _bool(pc.get("verified"), "catalog verified")
    items = pc.get("items")
    if not isinstance(items, list):
        raise FrameDecodeError("catalog items must be an array")
    for item in items:
        # 項目はパラメータの語彙(param と型タグを付けない値。HID-389)。どのアドレスで届いたかは載らない
        item = _strict(item, {"param", "kind", "type", "props"}, "catalog item")
        if not _is_identifier(item.get("param")):
            raise FrameDecodeError("catalog item param must be an identifier")
        for key in ("kind", "type"):
            value = _string(item.get(key), f"catalog item {key}", non_empty=True)
            if len(value) > 32:
                raise FrameDecodeError(f"catalog item {key} must be at most 32 characters")
        props = item.get("props")
        if not isinstance(props, list) or len(props) > CATALOG_MAX_PROPS_PER_ITEM:
            raise FrameDecodeError(f"catalog item props must be an array of at most {CATALOG_MAX_PROPS_PER_ITEM}")
        for prop in props:
            prop = _strict(prop, {"key", "value"}, "catalog prop")
            key = _string(prop.get("key"), "catalog prop key", non_empty=True)
            if len(key) > 32:
                raise FrameDecodeError("catalog prop key must be at most 32 characters")
            value = prop.get("value")
            if isinstance(value, str):
                if len(value) > CATALOG_MAX_STRING_CHARS:
                    raise FrameDecodeError("catalog prop value is too long")
            elif isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise FrameDecodeError("catalog prop value must be a finite number or a string")
    return pc


def _decode_blueprint_status(frame: dict[str, Any]) -> BlueprintStatusFrame:
    _strict(frame, {"v", "type", "pc", "absent"}, "frame")
    pc = frame.get("pc")
    if pc is not None and not (
        isinstance(pc, dict) and set(pc) == {"host", "name"} and all(isinstance(pc[name], str) for name in ("host", "name"))
    ):
        raise FrameDecodeError("blueprintStatus pc must be null or {host, name}")
    absent = frame.get("absent")
    if not isinstance(absent, list) or not all(isinstance(param, str) for param in absent):
        raise FrameDecodeError("blueprintStatus absent must be an array of strings")
    return BlueprintStatusFrame("blueprintStatus", 1, None if pc is None else dict(pc), tuple(absent))


def _decode_catalog(frame: dict[str, Any]) -> CatalogFrame:
    _strict(frame, {"v", "type", "hosts", "pcs"}, "frame")
    pcs = frame.get("pcs")
    hosts = frame.get("hosts")
    if not isinstance(pcs, list) or len(pcs) > CATALOG_MAX_PCS:
        raise FrameDecodeError(f"catalog pcs must be an array of at most {CATALOG_MAX_PCS}")
    if not isinstance(hosts, list) or len(hosts) > CATALOG_MAX_PCS:
        raise FrameDecodeError(f"catalog hosts must be an array of at most {CATALOG_MAX_PCS}")
    decoded_hosts = tuple(_string(host, "catalog hosts entry", non_empty=True) for host in hosts)
    decoded_pcs = tuple(_catalog_pc(pc) for pc in pcs)
    return CatalogFrame("catalog", 1, decoded_pcs, decoded_hosts)


def encode_catalog_request() -> str:
    """ターゲットに設計図を送り直させる(Sync。D-104)。ブリッジが全宛先へ /sys/catalog/request を送る。"""
    return _dumps({"v": 1, "type": "catalogRequest"})


def encode_catalog_adopt(host: str) -> str:
    """その PC の設計図から既定の画面を作って採用させる(HID-386)。画面を作るのはブリッジ。"""
    if not isinstance(host, str) or not 1 <= len(host) <= 253:
        raise ProtocolError("catalogAdopt host must be a string of 1 to 253 characters")
    return _dumps({"v": 1, "type": "catalogAdopt", "host": host})
