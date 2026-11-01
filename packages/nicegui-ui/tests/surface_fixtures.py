"""テスト用のサーフェス定義とフレームの組み立て。

定義は validate_surface_definition(UI に残る編集モードの検証。中身の判定の正はブリッジ。D-122)を通すので、
テストが検証に通らない定義を前提にしないようにしている。

テストの定義は読みやすさのため版 1 の書き方(パラメータに address)で組み、版 2(本体と bindings.osc。D-117)へ
移して使う。保持値・エコーのフレームもテストではアドレスと OSC の引数で書き、直前に組んだ surface_frame の
結び付けでパラメータ id・行へ直す(UI が受けるのはブリッジが直した id の語彙のフレーム。HID-389)。
"""

from __future__ import annotations

from typing import Any

from oscdesk_ui.protocol import DesiredFrame, DesiredRow, DesiredValue, EchoFrame, SurfaceFrame, WireArg
from oscdesk_ui.surface_definition import (
    migrate_surface_definition,
    resolve_selectors,
    split_bindings,
    validate_surface_definition,
)

AT = "2026-10-10T00:00:00Z"

# 直前に組んだ surface_frame の結び付け(アドレス → パラメータ・レコード)。保持値・エコーのフレームを直すのに使う
_ADDRESSES: dict[str, tuple[str, dict[str, Any]]] = {}


def param(id: str, address: str, type: str, label: str | None = None, kind: str = "state", **fields: Any) -> dict[str, Any]:
    return {"id": id, "address": address, "label": label or id, "type": type, "kind": kind, **fields}


def control(param_id: str, **fields: Any) -> dict[str, Any]:
    return {"kind": "control", "param": param_id, **fields}


def v2(defn: dict[str, Any]) -> dict[str, Any]:
    """版 1 の書き方の定義を版 2 へ移す(版 2 ならそのまま)。"""
    return migrate_surface_definition(defn)


def definition(
    parameters: list[dict[str, Any]],
    controls: list[dict[str, Any]] | None = None,
    name: str = "Test",
    actions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """controls を省くと、全パラメータを既定の部品で 1 画面に並べる。版 2(結び付けつき)で返す。"""
    if controls is None:
        controls = [control(p["id"]) for p in parameters]
    result: dict[str, Any] = {
        "format": "oscdesk-surface",
        "version": 1,
        "name": name,
        "parameters": parameters,
        "screens": [{"id": "main", "label": "Main", "children": controls}],
    }
    if actions is not None:
        result["actions"] = actions
    migrated = v2(result)
    validate_surface_definition(migrated)
    return migrated


def body_of(defn: dict[str, Any]) -> dict[str, Any]:
    """surface フレームの definition(結び付けを外した本体)。"""
    return split_bindings(v2(defn))[0]


def surface_frame(defn: dict[str, Any], name: str = "test", revision: int = 1) -> SurfaceFrame:
    joined = v2(defn)
    body, bindings = split_bindings(joined)
    _remember(joined)
    selectors = tuple((selector, tuple(params)) for selector, params in resolve_selectors(joined).items())
    return SurfaceFrame(
        type="surface", name=name, revision=revision, at=AT, definition=body, bindings=bindings, selectors=selectors
    )


def _remember(joined: dict[str, Any]) -> None:
    _ADDRESSES.clear()
    osc = (joined.get("bindings") or {}).get("osc") or {}
    parameters = {parameter["id"]: parameter for parameter in joined["parameters"]}
    records = {record["id"]: record for record in joined.get("records", [])}
    for binding in osc.get("parameters", []):
        if binding["id"] in parameters:
            _ADDRESSES[binding["address"]] = ("param", parameters[binding["id"]])
    for binding in osc.get("records", []):
        if binding["id"] in records:
            _ADDRESSES[binding["address"]] = ("record", records[binding["id"]])


def _value(type_: str, raw: Any) -> Any:
    # OSC の引数をパラメータの型どおりの JSON の値にする(bool は 0/1 → 真偽。ブリッジの heldArgToValue と同じ)
    if type_ == "bool" and not isinstance(raw, bool) and raw in (0, 1):
        return raw == 1
    return raw


def _lookup(key: str) -> tuple[str, dict[str, Any]] | None:
    """アドレスか、パラメータ・レコードの id で引く(テストはどちらでも書ける)。"""
    found = _ADDRESSES.get(key)
    if found is not None:
        return found
    for kind, spec in _ADDRESSES.values():
        if spec["id"] == key:
            return kind, spec
    return None


def _entries(address: str, args: list[WireArg]) -> tuple[list[DesiredValue], list[DesiredRow]]:
    found = _lookup(address)
    if found is None:
        # 定義に無いアドレスはブリッジが id に直せないので、知らないパラメータとして届ける
        return [DesiredValue(f"unknown_{abs(hash(address))}", args[0].value if args else None, has_value=bool(args))], []
    kind, spec = found
    if kind == "param":
        if len(args) != 1:
            return [DesiredValue(spec["id"], None, has_value=False)], []
        return [DesiredValue(spec["id"], _value(spec["type"], args[0].value))], []
    head = 2 if spec["keysFrom"].get("source") == "ui" else 1
    if not args:
        return [], []
    key = args[0].value
    values = {field["id"]: _value(field["type"], arg.value) for field, arg in zip(spec["fields"], args[head:])}
    return [], [DesiredRow(spec["id"], key, values)]


def desired_frame(values: dict[str, list[tuple[str, Any]]], full: bool = True) -> DesiredFrame:
    params: list[DesiredValue] = []
    rows: list[DesiredRow] = []
    for address, args in values.items():
        found_params, found_rows = _entries(address, [WireArg(type=tag, value=value) for tag, value in args])
        params.extend(item for item in found_params if item.has_value)
        rows.extend(found_rows)
    return DesiredFrame(type="desired", full=full, values=tuple(params), rows=tuple(rows))


def desired_rows(address: str, rows: list[list[tuple[str, Any]]], full: bool = False) -> DesiredFrame:
    """同じレコードの複数の行の保持値(テストでは OSC の引数の並びで書く)。"""
    found: list[DesiredRow] = []
    for args in rows:
        found.extend(_entries(address, [WireArg(type=tag, value=value) for tag, value in args])[1])
    return DesiredFrame(type="desired", full=full, values=(), rows=tuple(found))


def echo_frame(address: str, *args: tuple[str, Any]) -> EchoFrame:
    params, rows = _entries(address, [WireArg(type=tag, value=value) for tag, value in args])
    return EchoFrame(type="echo", values=tuple(params), rows=tuple(rows))
