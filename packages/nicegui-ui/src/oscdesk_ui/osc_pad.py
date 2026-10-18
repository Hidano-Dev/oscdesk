"""OSC パッド(D-080)の形式・検証と、編集規則の純粋関数。

パッドはサーフェス定義とは別の、ユーザーが自由にアドレスと引数を書いて撃つボタンの格子。正はブリッジが持ち、
UI は採用中のパッドを表示キャッシュとして持つ。検証の規則は bridge 側の packages/shared/src/osc-pad.ts と同じで、
protocol/osc-pad-samples.json を両言語のテストが読んで判定の一致を確かめる。

編集は surface_editor.py と同じく作業コピー方式で、操作のたびに複製した新しい dict を返す(UI を持たない)。
"""

from __future__ import annotations

import base64
import copy
import hashlib
import json
import math
import re
import struct
from collections import deque
from dataclasses import dataclass
from typing import Any, Final

OSC_PAD_FORMAT: Final = "oscdesk-pad"
OSC_PAD_VERSION: Final = 1

MAX_ROWS: Final = 12
MAX_COLUMNS: Final = 12
# 送信ログ(D-067)が切り詰めずに見せられる個数(packages/shared の SENT_LOG.MAX_ARGS)に揃える
MAX_ARGS: Final = 16
MAX_LABEL_CHARS: Final = 64
MAX_STRING_ARG_CHARS: Final = 1024
MAX_IMAGE_BYTES: Final = 256 * 1024
MAX_TOTAL_IMAGE_BYTES: Final = 4 * 1024 * 1024
# packages/shared の OSC_PAD.MAX_ADDRESS_CHARS / MAX_SERIALIZED_BYTES と同じ
MAX_ADDRESS_CHARS: Final = 256
MAX_SERIALIZED_BYTES: Final = 8 * 1024 * 1024
ARG_TYPES: Final = ("i", "f", "s")

_INT32_MIN: Final = -2147483648
_INT32_MAX: Final = 2147483647

# packages/shared/src/surface-definition.ts の PARAMETER_ADDRESS_PATTERN と同じ(予約名前空間・パターン文字・空白・空パートを拒否)
ADDRESS_PATTERN: Final = re.compile(r"^(?!/(?:sys|oscdesk)(?:/|(?![\s\S])))(?:/[^\s/?\[\]{},*]+)+(?![\s\S])")
_IDENTIFIER: Final = re.compile(r"[A-Za-z][A-Za-z0-9_-]{0,63}\Z")
_COLOR: Final = re.compile(r"#[0-9A-Fa-f]{6}\Z")
# SVG は受けない(スクリプトを含められる)
_IMAGE_DATA_URL: Final = re.compile(
    r"data:image/(?:png|jpeg|gif|webp);base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)\Z"
)
_PAD_KEYS: Final = frozenset({"format", "version", "rows", "columns", "buttons"})
_BUTTON_REQUIRED: Final = frozenset({"id", "row", "column", "label", "address", "args"})
_BUTTON_KEYS: Final = _BUTTON_REQUIRED | {"color", "image"}

# 画像の先頭バイトで種類を決める(ブラウザが付ける content type は当てにしない)
_IMAGE_SIGNATURES: Final = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
)

DEFAULT_ROWS: Final = 4
DEFAULT_COLUMNS: Final = 4


class PadEditError(ValueError):
    """編集の操作が規則に合わない(理由は画面にそのまま出す日本語)。"""


def image_data_url_bytes(data_url: str) -> int | None:
    """data URL の base64 部分から元のバイト数を出す(TS の imageDataUrlBytes と同じ数え方)。"""
    match = _IMAGE_DATA_URL.match(data_url) if isinstance(data_url, str) else None
    if match is None:
        return None
    body = match.group(1)
    padding = 2 if body.endswith("==") else 1 if body.endswith("=") else 0
    return len(body) // 4 * 3 - padding


def fits_float32(value: float) -> bool:
    """float32 へ丸めて有限か(TS の Number.isFinite(Math.fround(v)) と同じ境界)。

    OSC の f は float32 なので、有限でも 1e300 のような値は Unity で +Inf になる。struct の pack は C の
    float への丸め(最近接)と同じで、丸めた結果が無限大になる値だけを OverflowError にする。
    """
    if not math.isfinite(value):
        return False
    try:
        struct.pack("<f", value)
    except OverflowError:
        return False
    return True


def utf16_length(text: str) -> int:
    """JS の string.length と同じ数え方(zod の max と判定を揃える。絵文字などは 2 と数える)。

    surrogatepass: JSON の "\\ud800" のような孤立サロゲートは JS では 1 文字の正しい文字列で、zod も通す。
    既定の strict では UnicodeEncodeError になり、ブリッジが採用したパッドを UI が捨ててしまう。
    """
    return len(text.encode("utf-16-le", "surrogatepass")) // 2


def has_lone_surrogate(text: str) -> bool:
    """孤立サロゲートを含むか。OSC の UTF-8 化で U+FFFD に置き換わり、保存した内容と違うものが届く(TS の hasLoneSurrogate と同じ判定)。"""
    return any("\ud800" <= char <= "\udfff" for char in text)


def is_valid_color(color: Any) -> bool:
    return isinstance(color, str) and _COLOR.match(color) is not None


def is_valid_address(address: Any) -> bool:
    # NUL は正規表現(空白・パターン文字の除外)では弾けないので別に拒否する(OSC の文字列の終端と衝突する)
    return isinstance(address, str) and "\x00" not in address and not has_lone_surrogate(address) and ADDRESS_PATTERN.match(address) is not None


def _is_int(value: Any) -> bool:
    # JSON の 1.0 は JS では整数として読まれる。bool は int の部分型なので除く
    if isinstance(value, bool):
        return False
    return isinstance(value, int) or (isinstance(value, float) and value.is_integer())


def _int_in(value: Any, low: int, high: int) -> bool:
    return _is_int(value) and low <= value <= high


def _arg_issue(arg: Any, where: str) -> str | None:
    if not isinstance(arg, dict) or set(arg) != {"type", "value"}:
        return f"{where}: argument must be {{type, value}}"
    kind, value = arg["type"], arg["value"]
    if kind == "i":
        return None if _int_in(value, _INT32_MIN, _INT32_MAX) else f"{where}: i must be an int32"
    if kind == "f":
        ok = not isinstance(value, bool) and isinstance(value, (int, float)) and fits_float32(value)
        return None if ok else f"{where}: f must be a finite number that fits in float32"
    if kind == "s":
        ok = isinstance(value, str) and utf16_length(value) <= MAX_STRING_ARG_CHARS
        if not ok:
            return f"{where}: s must be a string of at most {MAX_STRING_ARG_CHARS} characters"
        # OSC の文字列は NUL で終わるので、途中の NUL は受け側で切れる(TS の zod と同じく拒否)
        if "\x00" in value:
            return f"{where}: s must not contain NUL"
        # 孤立サロゲートは OSC の UTF-8 化で U+FFFD に置き換わる(表示だけのラベルは許す)
        return f"{where}: s must not contain lone surrogates" if has_lone_surrogate(value) else None
    return f"{where}: unsupported argument type {kind!r}"


def _structure_issues(pad: Any) -> list[str]:
    if not isinstance(pad, dict):
        return ["<root>: pad must be an object"]
    issues: list[str] = []
    unknown = set(pad) - _PAD_KEYS
    missing = _PAD_KEYS - set(pad)
    if unknown:
        issues.append(f"<root>: unknown key(s) {', '.join(sorted(unknown))}")
    if missing:
        issues.append(f"<root>: missing key(s) {', '.join(sorted(missing))}")
        return issues
    if pad["format"] != OSC_PAD_FORMAT or pad["version"] != OSC_PAD_VERSION or isinstance(pad["version"], bool):
        issues.append("<root>: not an oscdesk-pad version 1 document")
    if not _int_in(pad["rows"], 1, MAX_ROWS):
        issues.append(f"rows: must be 1 to {MAX_ROWS}")
    if not _int_in(pad["columns"], 1, MAX_COLUMNS):
        issues.append(f"columns: must be 1 to {MAX_COLUMNS}")
    buttons = pad["buttons"]
    if not isinstance(buttons, list) or len(buttons) > MAX_ROWS * MAX_COLUMNS:
        issues.append(f"buttons: must be an array of at most {MAX_ROWS * MAX_COLUMNS}")
        return issues
    for index, button in enumerate(buttons):
        where = f"buttons/{index}"
        if not isinstance(button, dict):
            issues.append(f"{where}: button must be an object")
            continue
        if set(button) - _BUTTON_KEYS or _BUTTON_REQUIRED - set(button):
            issues.append(f"{where}: button keys must be {', '.join(sorted(_BUTTON_REQUIRED))} (+ color, image)")
            continue
        if not isinstance(button["id"], str) or _IDENTIFIER.match(button["id"]) is None:
            issues.append(f"{where}/id: invalid identifier")
        if not _int_in(button["row"], 0, MAX_ROWS - 1):
            issues.append(f"{where}/row: must be 0 to {MAX_ROWS - 1}")
        if not _int_in(button["column"], 0, MAX_COLUMNS - 1):
            issues.append(f"{where}/column: must be 0 to {MAX_COLUMNS - 1}")
        if not isinstance(button["label"], str) or utf16_length(button["label"]) > MAX_LABEL_CHARS:
            issues.append(f"{where}/label: must be a string of at most {MAX_LABEL_CHARS} characters")
        if "color" in button and (not isinstance(button["color"], str) or _COLOR.match(button["color"]) is None):
            issues.append(f"{where}/color: must be #rrggbb")
        if "image" in button and image_data_url_bytes(button["image"]) is None:
            issues.append(f"{where}/image: must be a png / jpeg / gif / webp data URL")
        if isinstance(button["address"], str) and utf16_length(button["address"]) > MAX_ADDRESS_CHARS:
            issues.append(f"{where}/address: must be at most {MAX_ADDRESS_CHARS} characters")
        elif not is_valid_address(button["address"]):
            issues.append(f"{where}/address: invalid or reserved OSC address")
        args = button["args"]
        if not isinstance(args, list) or len(args) > MAX_ARGS:
            issues.append(f"{where}/args: must be an array of at most {MAX_ARGS}")
            continue
        for arg_index, arg in enumerate(args):
            issue = _arg_issue(arg, f"{where}/args/{arg_index}")
            if issue is not None:
                issues.append(issue)
    return issues


def collect_pad_issues(pad: Any) -> list[str]:
    """パッドの問題を列挙する(空なら正しい)。構造の問題があれば意味の検査はしない(TS の zod と同じ順)。"""
    issues = _structure_issues(pad)
    if issues:
        return issues
    ids: set[str] = set()
    cells: set[tuple[int, int]] = set()
    total_image_bytes = 0
    for index, button in enumerate(pad["buttons"]):
        if button["id"] in ids:
            issues.append(f'buttons/{index}/id: duplicate button id "{button["id"]}"')
        ids.add(button["id"])
        if button["row"] >= pad["rows"] or button["column"] >= pad["columns"]:
            issues.append(f'buttons/{index}: button "{button["id"]}" is outside the {pad["rows"]}x{pad["columns"]} grid')
        cell = (int(button["row"]), int(button["column"]))
        if cell in cells:
            issues.append(f'buttons/{index}: button "{button["id"]}" overlaps another button')
        cells.add(cell)
        if "image" in button:
            size = image_data_url_bytes(button["image"]) or 0
            total_image_bytes += size
            if size > MAX_IMAGE_BYTES:
                issues.append(f'buttons/{index}/image: image of "{button["id"]}" exceeds {MAX_IMAGE_BYTES} bytes')
    if total_image_bytes > MAX_TOTAL_IMAGE_BYTES:
        issues.append(f"buttons: images exceed {MAX_TOTAL_IMAGE_BYTES} bytes in total")
    return issues


def serialized_bytes(pad: dict[str, Any]) -> int:
    """パッドの JSON(区切りの空白なし)の UTF-8 のバイト数(TS の oscPadSerializedBytes と同じ数え方の目安)。

    上限を超えるパッドはブリッジが保存・採用しない。UI は送る前にこれで確かめ、理由をその場で出す。
    """
    text = json.dumps(pad, ensure_ascii=False, separators=(",", ":"))
    return len(text.encode("utf-8", "surrogatepass"))


def validate_pad(pad: Any) -> None:
    issues = collect_pad_issues(pad)
    if issues:
        raise PadEditError("; ".join(issues[:5]))


# --- 編集規則(純粋関数。引数の dict は変更せず、新しい dict を返す) -------------------


def new_pad(rows: int = DEFAULT_ROWS, columns: int = DEFAULT_COLUMNS) -> dict[str, Any]:
    return {"format": OSC_PAD_FORMAT, "version": OSC_PAD_VERSION, "rows": rows, "columns": columns, "buttons": []}


def find_button(pad: dict[str, Any], button_id: str) -> dict[str, Any] | None:
    return next((button for button in pad["buttons"] if button["id"] == button_id), None)


def button_at(pad: dict[str, Any], row: int, column: int) -> dict[str, Any] | None:
    return next((button for button in pad["buttons"] if button["row"] == row and button["column"] == column), None)


def next_button_id(pad: dict[str, Any]) -> str:
    existing = {button["id"] for button in pad["buttons"]}
    number = 1
    while f"b{number}" in existing:
        number += 1
    return f"b{number}"


def _replace_button(pad: dict[str, Any], button_id: str, button: dict[str, Any] | None) -> dict[str, Any]:
    result = copy.deepcopy(pad)
    buttons = [] if button is None else [copy.deepcopy(button)]
    result["buttons"] = [
        replacement
        for current in pad["buttons"]
        for replacement in ([copy.deepcopy(current)] if current["id"] != button_id else buttons)
    ]
    return result


def _require(pad: dict[str, Any], button_id: str) -> dict[str, Any]:
    button = find_button(pad, button_id)
    if button is None:
        raise PadEditError(f"ボタン {button_id} がありません")
    return button


def add_button(pad: dict[str, Any], row: int, column: int) -> tuple[dict[str, Any], str]:
    """空きマスにボタンを足す。アドレスは仮の正しい値(/pad/<id>)で始め、Inspector で書き換えてもらう。"""
    if not (0 <= row < pad["rows"] and 0 <= column < pad["columns"]):
        raise PadEditError("格子の外にはボタンを置けません")
    if button_at(pad, row, column) is not None:
        raise PadEditError("このマスには既にボタンがあります")
    button_id = next_button_id(pad)
    result = copy.deepcopy(pad)
    result["buttons"].append(
        {"id": button_id, "row": row, "column": column, "label": button_id, "address": f"/pad/{button_id}", "args": []}
    )
    return result, button_id


def remove_button(pad: dict[str, Any], button_id: str) -> dict[str, Any]:
    _require(pad, button_id)
    return _replace_button(pad, button_id, None)


def set_label(pad: dict[str, Any], button_id: str, label: str) -> dict[str, Any]:
    if utf16_length(label) > MAX_LABEL_CHARS:
        raise PadEditError(f"ラベルは {MAX_LABEL_CHARS} 文字までです")
    return _replace_button(pad, button_id, {**_require(pad, button_id), "label": label})


def set_color(pad: dict[str, Any], button_id: str, color: str | None) -> dict[str, Any]:
    """背景色(#rrggbb)。None か空で既定の色に戻す。"""
    button = dict(_require(pad, button_id))
    if not color:
        button.pop("color", None)
    else:
        normalized = color.strip()
        if _COLOR.match(normalized) is None:
            raise PadEditError("色は #rrggbb の形で指定してください")
        button["color"] = normalized.upper()
    return _replace_button(pad, button_id, button)


def set_address(pad: dict[str, Any], button_id: str, address: str) -> dict[str, Any]:
    problem = address_problem(address)
    if problem is not None:
        raise PadEditError(problem)
    return _replace_button(pad, button_id, {**_require(pad, button_id), "address": address})


def address_problem(address: str) -> str | None:
    """アドレスの入力欄に出す理由(正しければ None)。"""
    if not address.startswith("/"):
        return "/ で始めてください"
    if address == "/sys" or address.startswith("/sys/") or address == "/oscdesk" or address.startswith("/oscdesk/"):
        return "/sys と /oscdesk は予約されています"
    if utf16_length(address) > MAX_ADDRESS_CHARS:
        return f"{MAX_ADDRESS_CHARS} 文字までです"
    if "\x00" in address:
        return "NUL 文字は使えません"
    if has_lone_surrogate(address):
        return "孤立サロゲートは使えません"
    if not is_valid_address(address):
        return "空白・* ? [ ] { } , と空のパート・末尾の / は使えません"
    return None


def image_data_url(content: bytes) -> str:
    """アップロードされた画像を data URL にする。種類は先頭バイトで決め、大きさの上限を確かめる。"""
    mime = sniff_image_mime(content)
    if mime is None:
        raise PadEditError("PNG / JPEG / GIF / WebP の画像だけを登録できます")
    if len(content) > MAX_IMAGE_BYTES:
        raise PadEditError(f"画像は {MAX_IMAGE_BYTES // 1024} KiB までです({len(content) // 1024} KiB)")
    return f"data:{mime};base64,{base64.b64encode(content).decode('ascii')}"


def sniff_image_mime(content: bytes) -> str | None:
    for signature, mime in _IMAGE_SIGNATURES:
        if content.startswith(signature):
            return mime
    if len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp"
    return None


def set_image(pad: dict[str, Any], button_id: str, data_url: str | None) -> dict[str, Any]:
    button = dict(_require(pad, button_id))
    if data_url is None:
        button.pop("image", None)
        return _replace_button(pad, button_id, button)
    size = image_data_url_bytes(data_url)
    if size is None or size > MAX_IMAGE_BYTES:
        raise PadEditError(f"画像は PNG / JPEG / GIF / WebP の {MAX_IMAGE_BYTES // 1024} KiB までです")
    others = sum(image_data_url_bytes(other["image"]) or 0 for other in pad["buttons"] if other["id"] != button_id and "image" in other)
    if others + size > MAX_TOTAL_IMAGE_BYTES:
        raise PadEditError(f"パッド全体の画像が {MAX_TOTAL_IMAGE_BYTES // (1024 * 1024)} MiB を超えます")
    button["image"] = data_url
    return _replace_button(pad, button_id, button)


def move_button(pad: dict[str, Any], button_id: str, row: int, column: int) -> dict[str, Any]:
    """ボタンを別のマスへ動かす。行き先にボタンがあれば入れ替える(空きマスを作らずに並べ替えられるように)。"""
    button = _require(pad, button_id)
    if not (0 <= row < pad["rows"] and 0 <= column < pad["columns"]):
        raise PadEditError("格子の外には動かせません")
    occupant = button_at(pad, row, column)
    result = _replace_button(pad, button_id, {**button, "row": row, "column": column})
    if occupant is not None and occupant["id"] != button_id:
        result = _replace_button(result, occupant["id"], {**occupant, "row": button["row"], "column": button["column"]})
    return result


def resize_pad(pad: dict[str, Any], rows: int, columns: int) -> dict[str, Any]:
    """格子の大きさを変える。はみ出すボタンがあれば、黙って消さずに断る(先に動かすか消してもらう)。"""
    if not (1 <= rows <= MAX_ROWS and 1 <= columns <= MAX_COLUMNS):
        raise PadEditError(f"行数は 1〜{MAX_ROWS}、列数は 1〜{MAX_COLUMNS} です")
    outside = [button for button in pad["buttons"] if button["row"] >= rows or button["column"] >= columns]
    if outside:
        names = ", ".join(button["label"] or button["id"] for button in outside)
        raise PadEditError(f"格子の外に出るボタンがあります: {names}")
    result = copy.deepcopy(pad)
    result["rows"], result["columns"] = rows, columns
    return result


_DEFAULT_ARG_VALUES: Final = {"i": 0, "f": 0.0, "s": ""}


def add_arg(pad: dict[str, Any], button_id: str, arg_type: str = "i") -> dict[str, Any]:
    button = _require(pad, button_id)
    if len(button["args"]) >= MAX_ARGS:
        raise PadEditError(f"引数は {MAX_ARGS} 個までです")
    if arg_type not in ARG_TYPES:
        raise PadEditError(f"引数の型は {' / '.join(ARG_TYPES)} です")
    args = [*copy.deepcopy(button["args"]), {"type": arg_type, "value": _DEFAULT_ARG_VALUES[arg_type]}]
    return _replace_button(pad, button_id, {**button, "args": args})


def remove_arg(pad: dict[str, Any], button_id: str, index: int) -> dict[str, Any]:
    button = _require(pad, button_id)
    args = copy.deepcopy(button["args"])
    if not 0 <= index < len(args):
        raise PadEditError("その引数はありません")
    del args[index]
    return _replace_button(pad, button_id, {**button, "args": args})


def move_arg(pad: dict[str, Any], button_id: str, index: int, delta: int) -> dict[str, Any]:
    button = _require(pad, button_id)
    args = copy.deepcopy(button["args"])
    target = index + delta
    if not (0 <= index < len(args) and 0 <= target < len(args)):
        raise PadEditError("これ以上動かせません")
    args[index], args[target] = args[target], args[index]
    return _replace_button(pad, button_id, {**button, "args": args})


def set_arg_type(pad: dict[str, Any], button_id: str, index: int, arg_type: str) -> dict[str, Any]:
    """引数の型を変える。いまの値が新しい型として読めれば引き継ぎ、読めなければ既定値にする。"""
    button = _require(pad, button_id)
    if arg_type not in ARG_TYPES:
        raise PadEditError(f"引数の型は {' / '.join(ARG_TYPES)} です")
    args = copy.deepcopy(button["args"])
    if not 0 <= index < len(args):
        raise PadEditError("その引数はありません")
    try:
        value = parse_arg_value(arg_type, format_arg_value(args[index]))
    except PadEditError:
        value = _DEFAULT_ARG_VALUES[arg_type]
    args[index] = {"type": arg_type, "value": value}
    return _replace_button(pad, button_id, {**button, "args": args})


def set_arg_value(pad: dict[str, Any], button_id: str, index: int, raw: str) -> dict[str, Any]:
    button = _require(pad, button_id)
    args = copy.deepcopy(button["args"])
    if not 0 <= index < len(args):
        raise PadEditError("その引数はありません")
    args[index] = {"type": args[index]["type"], "value": parse_arg_value(args[index]["type"], raw)}
    return _replace_button(pad, button_id, {**button, "args": args})


def parse_arg_value(arg_type: str, raw: str) -> int | float | str:
    """入力欄の文字列を型どおりの値にする。i は int32、f は有限の数(OSC の float32 への丸めは送信側)。"""
    if arg_type == "s":
        if utf16_length(raw) > MAX_STRING_ARG_CHARS:
            raise PadEditError(f"文字列は {MAX_STRING_ARG_CHARS} 文字までです")
        if "\x00" in raw:
            raise PadEditError("文字列に NUL 文字は使えません(OSC の文字列の終わりと見分けられないため)")
        if has_lone_surrogate(raw):
            raise PadEditError("文字列に孤立サロゲートは使えません(OSC の UTF-8 化で別の文字に置き換わるため)")
        return raw
    text = raw.strip()
    if arg_type == "i":
        try:
            value = int(text)
        except ValueError as error:
            raise PadEditError("整数を入力してください") from error
        if not _INT32_MIN <= value <= _INT32_MAX:
            raise PadEditError("int32(-2147483648〜2147483647)の範囲で入力してください")
        return value
    if arg_type == "f":
        try:
            number = float(text)
        except ValueError as error:
            raise PadEditError("数値を入力してください") from error
        if not math.isfinite(number):
            raise PadEditError("有限の数値を入力してください")
        if not fits_float32(number):
            raise PadEditError("float32 の範囲(±3.4028235e38 まで)で入力してください")
        return number
    raise PadEditError(f"引数の型は {' / '.join(ARG_TYPES)} です")


def format_arg_value(arg: dict[str, Any]) -> str:
    value = arg["value"]
    if arg["type"] == "f" and isinstance(value, float) and value.is_integer():
        return f"{value:.1f}"
    return str(value)


def describe_args(args: list[dict[str, Any]]) -> str:
    """ボタンの補助表示用(例: `i:1 f:0.5 s:"A"`)。"""
    parts = []
    for arg in args:
        value = f'"{arg["value"]}"' if arg["type"] == "s" else format_arg_value(arg)
        parts.append(f"{arg['type']}:{value}")
    return " ".join(parts)


# --- 作業コピー -------------------------------------------------------------------


@dataclass
class PadEditSession:
    """編集中のパッドの作業コピー。採用中のパッド(ブリッジが正)は直接いじらない(D-049 と同じ考え方)。

    base_version はブリッジが採用したときの版の印(pad フレームの version)、base_name は保存名。保存の結果は pad フレームで戻る。
    """

    draft: dict[str, Any]
    base_version: str
    base_name: str | None
    dirty: bool = False

    @classmethod
    def start(cls, pad: dict[str, Any] | None, version: str, name: str | None) -> "PadEditSession":
        return cls(copy.deepcopy(pad) if pad is not None else new_pad(), version, name)

    def apply(self, updated: dict[str, Any]) -> str | None:
        """検証に通った変更だけを取り込む。通らなければ理由を返し、作業コピーは変えない。"""
        issues = collect_pad_issues(updated)
        if issues:
            return "; ".join(issues[:3])
        if updated != self.draft:
            self.draft = updated
            self.dirty = True
        return None

    def follow(self, pad: dict[str, Any] | None, version: str, name: str | None) -> bool:
        """未編集なら、他の端末の保存・切り替えへ追従する。追従したら True。"""
        if self.dirty:
            return False
        self.draft = copy.deepcopy(pad) if pad is not None else new_pad()
        self.base_version, self.base_name = version, name
        return True

    def mark_saved(self, version: str, name: str | None) -> None:
        self.base_version, self.base_name = version, name
        self.dirty = False

    def is_conflicted(self, current_version: str) -> bool:
        """編集を始めた後に、採用中のパッドが他から変わったか(未保存の変更があるときだけ意味を持つ)。"""
        return self.dirty and current_version != self.base_version


# --- 表示キャッシュ ---------------------------------------------------------------


ADOPTION_HISTORY = 32
# 読み手が止まったままでも履歴が無制限に増えないための絶対の上限(切断の取りこぼしへの保険)
ADOPTION_HISTORY_HARD_LIMIT = 1024


def _canonical(value: Any) -> Any:
    # 整数値の float(1.0)は、ブリッジが JSON.stringify で 1 として返し、辞書比較でも同値。表記の違いで別物にしない
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, dict):
        return {key: _canonical(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_canonical(item) for item in value]
    return value


def pad_digest(pad: dict[str, Any]) -> str:
    """パッドの内容の同一性を見る小さな識別子(キーの並びと数値の表記に依らない)。surrogatepass は孤立サロゲートを含む表示用ラベルのため。"""
    text = json.dumps(_canonical(pad), sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(text.encode("utf-8", "surrogatepass")).hexdigest()


@dataclass(frozen=True)
class PadAdoption:
    """ブリッジが pad フレームで配った採用 1 件(保存・切り替えの確認用)。"""

    seq: int
    name: str
    version: str
    # 内容のダイジェスト。パッド全体(上限 8 MiB)を履歴に持つと、画像の多いパッドの保存を重ねるだけで
    # 表示キャッシュのメモリが履歴の長さ倍に膨らむため、照合に要る同一性だけを小さく残す
    digest: str


class PadCache:
    """ブリッジが採用中のパッドと保存済みの一覧(D-080)。表示キャッシュで、受けるたびに置き換える。

    revision は内容か名前か一覧が変わったときだけ増える(同じ内容の再配信では画面を作り直さない)。
    """

    def __init__(self) -> None:
        self.pad: dict[str, Any] | None = None
        self.name: str | None = None
        # ブリッジが採用したときの版の印(pad フレームの version)。押下・編集の競合の検知・保存の確認に使う
        self.version = ""
        self.names: tuple[str, ...] = ()
        self.revision = 0
        # 採用の履歴(新しい順に末尾へ)。画面の同期(50ms)より前に複数の採用が届いても、保存・切り替えの確認が
        # 最新だけを見て取りこぼさないように、照合に使う採用を列で残す。seq は採用ごとに増える通し番号
        self.adoptions: deque[PadAdoption] = deque()
        self.adoption_seq = 0
        # 照合する側(編集中のパネル。ページごとに 1 つ)が読み終えた位置の seq。全員が読み終えた採用だけを
        # 履歴の上限で捨てる。固定長で古い順に捨てると、同期(50ms)の前に大量の pad フレームが届いたとき
        # 保存・切り替えの応答の採用が消えて照合されず dirty が残る
        self._readers: dict[object, int] = {}
        # 履歴から捨てた採用の最大の seq。読み手の既読位置より大きければ、その読み手は未読の採用を失っている
        # (絶対上限での切り捨て)。保留中の保存・切り替えの応答がその中にあっても照合できないので、失敗扱いにさせる
        self.dropped_seq = 0

    def lost_since(self, seq: int) -> bool:
        """seq まで読んだ読み手が、履歴の上限で未読の採用を捨てられたか。"""
        return self.dropped_seq > seq

    def set_reader(self, reader: object, seq: int) -> None:
        self._readers[reader] = seq
        self._trim()

    def drop_reader(self, reader: object) -> None:
        # 編集を閉じた・切断したページを残すと、その位置より先の履歴を溜め続けるので、必ず外す
        self._readers.pop(reader, None)
        self._trim()

    def _trim(self) -> None:
        keep_after = min(self._readers.values(), default=None)
        while len(self.adoptions) > ADOPTION_HISTORY_HARD_LIMIT or (
            len(self.adoptions) > ADOPTION_HISTORY and (keep_after is None or self.adoptions[0].seq <= keep_after)
        ):
            self.dropped_seq = self.adoptions.popleft().seq

    def adoptions_since(self, seq: int) -> list["PadAdoption"]:
        return [adoption for adoption in self.adoptions if adoption.seq > seq]

    def apply_pad(self, name: str, version: str, pad: dict[str, Any]) -> None:
        changed = (name, pad) != (self.name, self.pad)
        self.name, self.pad, self.version = name, pad, version
        self.adoption_seq += 1
        self.adoptions.append(PadAdoption(self.adoption_seq, name, version, pad_digest(pad)))
        self._trim()
        if changed:
            self.revision += 1

    def apply_list(self, names: tuple[str, ...], active: str | None) -> None:
        changed = names != self.names
        self.names = names
        if active is None and self.pad is not None:
            self.pad, self.name = None, None
            changed = True
        if changed:
            self.revision += 1