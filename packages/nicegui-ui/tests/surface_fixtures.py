"""テスト用のサーフェス定義とフレームの組み立て。

定義は check_structure(zod から生成した JSON Schema による構造の検査)を通すので、テストが構造として壊れた
定義を前提にしないようにしている(判定の正はブリッジ。D-122・D-123)。

テストの定義は読みやすさのため版 1 の書き方(パラメータに address)で組み、版 2(本体と bindings.osc。D-117)へ
移して使う。保持値・エコーのフレームもテストではアドレスと OSC の引数で書き、直前に組んだ surface_frame の
結び付けでパラメータ id・行へ直す(UI が受けるのはブリッジが直した id の語彙のフレーム。HID-389)。
"""

from __future__ import annotations

import atexit
import copy
import json
import shutil
import subprocess
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft7Validator
from jsonschema.exceptions import best_match

from oscdesk_ui.protocol import DesiredFrame, DesiredRow, DesiredValue, EchoFrame, SurfaceFrame, WireArg
from oscdesk_ui.surface_definition import split_bindings
from oscdesk_ui.surface_model import SurfaceModel, surface_from_view

SURFACE_DEFINITION_VERSION = 2
SCHEMA_PATH = Path(__file__).parents[3] / "protocol" / "surface-definition.schema.json"


@lru_cache(maxsize=1)
def _structure_validator() -> Draft7Validator:
    return Draft7Validator(json.loads(SCHEMA_PATH.read_text(encoding="utf-8")))


def check_structure(defn: dict[str, Any]) -> None:
    """テストの定義が構造として正しいかを、zod から生成した JSON Schema で確かめる(テストが壊れた定義を前提にしないため)。

    判定の正はブリッジ(D-122・D-123)で、UI は検証を持たない。意味の規則(参照・値域)は TS のテストが見る。
    """
    first = best_match(_structure_validator().iter_errors(defn))
    if first is not None:
        raise AssertionError(f"test definition is not a valid surface definition: {'/'.join(map(str, first.absolute_path))}: {first.message}")

def _id_from_address(prefix: str, address: str, taken: set[str]) -> str:
    """アドレスから結び付けの id を作る(packages/shared の idFromAddress と同じ)。"""
    import re

    cleaned = re.sub(r"^_+|_+$", "", re.sub(r"[^A-Za-z0-9]+", "_", address))
    base = f"{prefix}{cleaned}"[:56]
    candidate = f"{prefix}x" if base == prefix else base
    number = 2
    while candidate in taken:
        candidate = f"{base}_{number}"
        number += 1
    taken.add(candidate)
    return candidate


def migrate_surface_definition(source: Any) -> Any:
    """版 1 の定義(パラメータに address を書く形)を版 2(本体と bindings.osc。D-117)へ移す。版 1 でなければそのまま返す。

    packages/shared の migrateSurfaceDefinition と同じ規則(同じアドレスの一覧は 1 つの一覧を共有し、要求は最初に
    書かれたものを使う。match は selector の id と bindings.osc.selectors へ)。テストの定義を版 1 の書き方で組む
    ためのもの(本番の移行はブリッジ。D-123)。
    """
    if not isinstance(source, dict) or source.get("version") != 1 or isinstance(source.get("version"), bool):
        return source
    import copy

    data = copy.deepcopy(source)
    list_taken: set[str] = set()
    lists: dict[str, dict[str, Any]] = {}

    def key_of(value: Any) -> str:
        return value if isinstance(value, str) else json.dumps(value, sort_keys=True)

    def list_ref(value: Any) -> Any:
        if not isinstance(value, dict) or "address" not in value:
            return value
        rest = {k: v for k, v in value.items() if k not in ("address", "request")}
        address = value["address"]
        entry = lists.get(key_of(address))
        if entry is None:
            entry = {"id": _id_from_address("l_", address if isinstance(address, str) else "list", list_taken), "address": address}
            lists[key_of(address)] = entry
        if "request" in value and "request" not in entry:
            entry["request"] = value["request"]
        return {"list": entry["id"], **rest}

    parameter_bindings: list[dict[str, Any]] = []
    record_bindings: list[dict[str, Any]] = []
    selector_taken: set[str] = set()
    selectors: dict[str, dict[str, Any]] = {}
    if isinstance(data.get("parameters"), list):
        for parameter in data["parameters"]:
            if not isinstance(parameter, dict):
                continue
            if "address" in parameter:
                parameter_bindings.append({"id": parameter.get("id"), "address": parameter.pop("address")})
            if "optionsFrom" in parameter:
                parameter["optionsFrom"] = list_ref(parameter["optionsFrom"])
    if isinstance(data.get("records"), list):
        for record in data["records"]:
            if not isinstance(record, dict):
                continue
            if "address" in record:
                record_bindings.append({"id": record.get("id"), "address": record.pop("address")})
            if "keysFrom" in record:
                record["keysFrom"] = list_ref(record["keysFrom"])
            for field in record.get("fields", []) if isinstance(record.get("fields"), list) else []:
                if isinstance(field, dict) and "optionsFrom" in field:
                    field["optionsFrom"] = list_ref(field["optionsFrom"])
    if isinstance(data.get("actions"), list):
        for action in data["actions"]:
            if not isinstance(action, dict) or not isinstance(action.get("steps"), list):
                continue
            for index, step in enumerate(action["steps"]):
                if not isinstance(step, dict) or "match" not in step:
                    continue
                match = step["match"]
                entry = selectors.get(key_of(match))
                if entry is None:
                    entry = {"id": _id_from_address("m_", match if isinstance(match, str) else "match", selector_taken), "match": match}
                    selectors[key_of(match)] = entry
                action["steps"][index] = {"selector": entry["id"], **{k: v for k, v in step.items() if k != "match"}}
    osc: dict[str, Any] = {"parameters": parameter_bindings}
    if record_bindings:
        osc["records"] = record_bindings
    if lists:
        osc["lists"] = list(lists.values())
    if selectors:
        osc["selectors"] = list(selectors.values())
    data["version"] = SURFACE_DEFINITION_VERSION
    if "bindings" not in source:
        data["bindings"] = {"osc": osc}
    return data


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
    check_structure(migrated)
    return migrated


def body_of(defn: dict[str, Any]) -> dict[str, Any]:
    """surface フレームの definition(結び付けを外した本体)。"""
    return split_bindings(v2(defn))[0]


VIEW_TOOL = Path(__file__).parents[3] / "packages" / "bridge" / "dist" / "surface-view-tool.js"
_view_tool: subprocess.Popen[str] | None = None
_views: dict[str, dict[str, Any]] = {}


def _tool() -> subprocess.Popen[str]:
    global _view_tool
    if _view_tool is None or _view_tool.poll() is not None:
        node = shutil.which("node")
        if node is None or not VIEW_TOOL.exists():
            raise RuntimeError(
                f"部品の木を組み立てる道具 {VIEW_TOOL} を実行できません。corepack pnpm -r run build でブリッジをビルドしてください"
            )
        # 道具がソースより古いと、古い規則の木でテストが緑のままになる(写しを置かない狙いが崩れる)ので止める
        sources = [
            path
            for directory in ("shared", "bridge")
            for path in (VIEW_TOOL.parents[2] / directory / "src").glob("*.ts")
            if not path.name.endswith(".test.ts")
        ]
        newest = max(path.stat().st_mtime for path in sources)
        if VIEW_TOOL.stat().st_mtime < newest:
            raise RuntimeError(
                f"部品の木を組み立てる道具 {VIEW_TOOL} がソースより古いです。corepack pnpm -r run build でブリッジをビルドし直してください"
            )
        _view_tool = subprocess.Popen(
            [node, str(VIEW_TOOL)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding="utf-8", bufsize=1
        )
        atexit.register(_view_tool.kill)
    return _view_tool


def view_of(defn: dict[str, Any]) -> dict[str, Any]:
    """定義(版 1 の書き方でもよい)の部品の木を、ブリッジと同じ規則(packages/shared の buildSurfaceView)で得る(D-124)。

    規則を Python に写さず、ビルドしたブリッジの道具(surface-view-tool.js)に組ませる。採用で断られる定義は例外にする。
    """
    line = json.dumps(v2(defn), ensure_ascii=False)
    cached = _views.get(line)
    if cached is not None:
        return copy.deepcopy(cached)
    tool = _tool()
    assert tool.stdin is not None and tool.stdout is not None
    tool.stdin.write(line + "\n")
    tool.stdin.flush()
    reply = json.loads(tool.stdout.readline())
    if "error" in reply:
        raise AssertionError(f"the bridge would not adopt this test definition: {reply['error']}")
    _views[line] = reply["view"]
    return copy.deepcopy(reply["view"])


def model_of(defn: dict[str, Any]) -> SurfaceModel:
    """定義から UI の画面の型を作る(ブリッジが配る部品の木を UI が読んだもの)。"""
    joined = v2(defn)
    return surface_from_view(joined["name"], view_of(joined))


def surface_frame(defn: dict[str, Any], name: str = "test", revision: int = 1) -> SurfaceFrame:
    joined = v2(defn)
    body, bindings = split_bindings(joined)
    _remember(joined)
    return SurfaceFrame(
        type="surface", name=name, revision=revision, at=AT, definition=body, bindings=bindings, view=view_of(joined)
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
