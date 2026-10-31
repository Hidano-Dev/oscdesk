"""接続してよいブラウザの範囲(D-104)を UI の HTTP で判定する。

許可リストはブリッジが持ち、networkSettings フレームで届く(UI のプロセスは設定ファイルを読まない。D-029)。
判定の規則はブリッジ(packages/bridge/src/network-settings.ts)と揃える:

- この PC の localhost(127.0.0.1 / ::1)は常に許可する。どんな設定にしても、サーバー PC のブラウザから戻せるようにするため
- 許可リストがまだ届いていない間(UI の起動直後・ブリッジに一度もつながっていない間)は localhost だけを通す。
  届く前に全部を通すと、狭めた許可リストが起動のたびに一瞬だけ素通しになるため。一度届いた許可リストは、
  ブリッジとの接続が切れても最後に届いたものを使い続ける

許可リストは認証の代わりではない(信頼できる LAN 内で使う前提は変わらない)。
"""

from __future__ import annotations

import ipaddress
from typing import Any, Awaitable, Callable, Iterable, MutableMapping, Sequence

LOCALHOST_ADDRESSES = frozenset({"127.0.0.1", "::1"})

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
AsgiApp = Callable[[Scope, Receive, Send], Awaitable[None]]


def normalize_address(address: str) -> str:
    """接続元のアドレスを比較用に揃える(IPv4 射影の IPv6 は IPv4 に、IPv6 は小文字に)。"""
    text = address.strip()
    try:
        parsed = ipaddress.ip_address(text)
    except ValueError:
        return text.lower()
    if isinstance(parsed, ipaddress.IPv6Address) and parsed.ipv4_mapped is not None:
        return str(parsed.ipv4_mapped)
    return str(parsed)


def is_localhost(address: str) -> bool:
    return normalize_address(address) in LOCALHOST_ADDRESSES


def parse_networks(entries: Iterable[str]) -> tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...]:
    """許可リストの CIDR(1 台のアドレスも可)を読む。読めない項目は飛ばす(ブリッジが検査済みの値しか届かない)。"""
    networks: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = []
    for entry in entries:
        try:
            networks.append(ipaddress.ip_network(entry.strip(), strict=False))
        except ValueError:
            continue
    return tuple(networks)


def split_entries(text: str) -> list[str]:
    """入力欄の文字列を項目に分ける(改行・カンマ・空白区切り。空は捨て、重なりは先の 1 つだけ残す)。"""
    entries: list[str] = []
    for part in text.replace(",", " ").split():
        if part not in entries:
            entries.append(part)
    return entries


def is_browser_allowed(address: str, allowed: Sequence[str] | None) -> bool:
    """その接続元を受けてよいか。allowed が None(まだ届いていない)なら localhost だけ。"""
    if is_localhost(address):
        return True
    if allowed is None:
        return False
    try:
        parsed = ipaddress.ip_address(normalize_address(address))
    except ValueError:
        return False
    return any(parsed.version == network.version and parsed in network for network in parse_networks(allowed))


FORBIDDEN_BODY = (
    "このブラウザ(接続元 {address})からは OSCDesk に接続できません。"
    "サーバー PC の http://localhost から「ネットワーク」タブで、接続してよいブラウザの範囲を確かめてください。\n"
    "This browser ({address}) is not in the allowed browser range of OSCDesk.\n"
)
WAITING_BODY = (
    "OSCDesk がブリッジから接続してよいブラウザの範囲を受け取るまで、localhost 以外からは接続できません。"
    "しばらくしてから読み込み直してください。\n"
    "OSCDesk has not received the allowed browser range from the bridge yet. Reload in a moment.\n"
)


class BrowserAccessMiddleware:
    """HTTP と WebSocket(NiceGUI の画面の更新に使う socket.io を含む)の両方で接続元を判定する ASGI ミドルウェア。

    allowed は呼ぶたびに今の許可リスト(未着なら None)を返す。範囲の外は HTTP なら 403、WebSocket ならハンドシェイクで断る。
    """

    def __init__(self, app: AsgiApp, allowed: Callable[[], Sequence[str] | None]) -> None:
        self._app = app
        self._allowed = allowed

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        kind = scope.get("type")
        if kind not in ("http", "websocket"):
            await self._app(scope, receive, send)
            return
        client = scope.get("client")
        address = client[0] if client else ""
        allowed = self._allowed()
        if is_browser_allowed(address, allowed):
            await self._app(scope, receive, send)
            return
        if kind == "websocket":
            # ハンドシェイクを受けずに閉じる(ASGI サーバーは 403 を返す)
            await send({"type": "websocket.close", "code": 1008})
            return
        status = 503 if allowed is None else 403
        body = (WAITING_BODY if allowed is None else FORBIDDEN_BODY.format(address=normalize_address(address))).encode("utf-8")
        await send({
            "type": "http.response.start",
            "status": status,
            "headers": [(b"content-type", b"text/plain; charset=utf-8"), (b"content-length", str(len(body)).encode("ascii"))],
        })
        await send({"type": "http.response.body", "body": body})
