"""OSC パッド(D-080)のフレーム(osc.pad・osc.padList・osc.padEdited)と、パッドの要求・切り替え・保存・押下・編集命令の上り。"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from .common import (
    DecodedFrame,
    FrameDecodeError,
    ProtocolError,
    _dumps,
    _exact,
    _int_at_least,
    _iso_datetime,
    _object,
    _request_id,
    _string,
    _strict,
    _surface_name,
)


@dataclass(frozen=True)
class PadFrame(DecodedFrame):
    """採用中の OSC パッド(D-080)。pad は外形だけを確かめた生の dict(中身の判定はブリッジが採用の前に済ませている。D-122)。"""

    name: str = ""
    revision: int = 0
    at: str = ""
    pad: dict[str, Any] | None = None
    # 採用ごとに一意な版の印(起動ごとのエポック + revision)。押下に載せ、ブリッジが照合する
    version: str = ""


@dataclass(frozen=True)
class PadListFrame(DecodedFrame):
    names: tuple[str, ...] = ()
    active: str | None = None


@dataclass(frozen=True)
class PadEditedFrame(DecodedFrame):
    """パッドの編集命令の答え(D-126)。通れば pad(編集後の作業コピー)、断られれば detail だけを持つ。"""

    request_id: str = ""
    pad: dict[str, Any] | None = None
    detail: str | None = None


def _pad_version(value: Any) -> str:
    # packages/shared の PadVersionSchema と同じ(1〜64 文字の文字列)
    if not isinstance(value, str) or not 1 <= len(value) <= 64:
        raise FrameDecodeError("pad version must be a string of 1 to 64 characters")
    return value


def _decode_pad(frame: dict[str, Any]) -> PadFrame:
    _strict(frame, {"v", "type", "name", "revision", "version", "at", "pad"}, "frame")
    # パッドの検証はブリッジだけが行う(採用したパッドしか配らない。D-122)
    pad = _object(frame.get("pad"), "pad")
    return PadFrame(
        "osc.pad", 1,
        _surface_name(frame.get("name"), "pad name"),
        _int_at_least(frame.get("revision"), 1, "pad revision"),
        _iso_datetime(frame.get("at"), "pad at"),
        pad,
        _pad_version(frame.get("version")),
    )


def _decode_pad_list(frame: dict[str, Any]) -> PadListFrame:
    _strict(frame, {"v", "type", "names", "active"}, "frame")
    names = frame.get("names")
    if not isinstance(names, list):
        raise FrameDecodeError("padList names must be an array")
    active = frame.get("active")
    return PadListFrame(
        "osc.padList", 1,
        tuple(_surface_name(name, "padList name") for name in names),
        None if active is None else _surface_name(active, "padList active"),
    )


def _decode_pad_edited(frame: dict[str, Any]) -> PadEditedFrame:
    _strict(frame, {"v", "type", "requestId", "result"}, "frame")
    ok = _object(frame.get("result"), "padEdited result").get("ok")
    if ok is True:
        # 中身の判定はブリッジが保存と同じ検査で済ませている(D-122・D-126)。UI は外形だけを見る
        result = _exact(frame["result"], {"ok", "pad"}, "padEdited result")
        return PadEditedFrame("osc.padEdited", 1, _request_id(frame.get("requestId")), _object(result["pad"], "padEdited pad"), None)
    if ok is False:
        result = _exact(frame["result"], {"ok", "detail"}, "padEdited result")
        return PadEditedFrame("osc.padEdited", 1, _request_id(frame.get("requestId")), None, _string(result["detail"], "padEdited detail"))
    raise FrameDecodeError("padEdited result ok must be a boolean")


def encode_pad_request() -> str:
    """採用中の OSC パッドと保存済みの一覧を求める(D-080)。"""
    return '{"v":1,"type":"osc.padRequest"}'


def encode_pad_load(name: str) -> str:
    _surface_name(name, "pad name")
    return json.dumps({"v": 1, "type": "osc.padLoad", "name": name}, separators=(",", ":"))


def encode_pad_save(name: str, pad: dict[str, Any]) -> str:
    """パッドの保存と採用。中身はブリッジが検証して、不正なら pad-rejected で理由を返す。"""
    _surface_name(name, "pad name")
    payload = {"v": 1, "type": "osc.padSave", "name": name, "pad": _object(pad, "pad")}
    return _dumps(payload)


def encode_pad_press(name: str, version: str, button_id: str) -> str:
    """押下。アドレスと引数は送らず、ブリッジが採用中のパッドから引く(D-080)。

    version は表示中のパッドの pad フレームの version。同じ名前で上書き保存された後や、ブリッジの再起動の前に
    描いた古い表示からの押下を、ブリッジが版の食い違いで断れるように必ず載せる。
    """
    _surface_name(name, "pad name")
    _pad_version(version)
    if not isinstance(button_id, str) or not button_id:
        raise ProtocolError("pad button id must be a non-empty string")
    payload = {"v": 1, "type": "osc.padPress", "name": name, "version": version, "button": button_id}
    return _dumps(payload)


def encode_pad_edit(request_id: str, draft: dict[str, Any], edit: dict[str, Any]) -> str:
    """パッドの編集命令(D-126)。draft は作業コピー(パッドの全体)。答えは osc.padEdited(この request_id)。"""
    try:
        _request_id(request_id)
    except FrameDecodeError as error:
        raise ProtocolError(str(error)) from error
    return _dumps({"v": 1, "type": "osc.padEdit", "requestId": request_id, "draft": _object(draft, "draft"), "edit": _object(edit, "edit")})
