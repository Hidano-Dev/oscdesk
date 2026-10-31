"""宛先パネル(D-078 / D-079 / D-085 / D-086)。

画面の右側に常に出し(狭い画面では上)、どのタブを開いていても送り先を切り替えられるようにする。
LAN の走査・宛先の選択・選択の保存・端末の名前の解決はブリッジが受け持ち、このパネルは destinations の表示と、
チェックの付け外しを destinationsSelect として送るだけにする(ブリッジと UI の責務分離)。
チェックの状態はブリッジから届いた選択で毎回描き直す。手元で先に変えないのは、ブリッジが断った選択
(空の選択など)を画面に残さないため。

端末はネットワーク(broadcasts)ごとにまとめ、ネットワークごとの「全てのデバイス」を見出しに置く。親(全てのデバイス・
ネットワーク)を選んでいる間は子の端末にもチェックを付けて見せ、子も操作できる(子を外すと親を外し、残りを個別の選択へ
展開する。D-089)。検索欄の正規表現に一致しない端末は隠し(選択そのものは消さない)、絞り込んでいる間の「全てのデバイス」は
「表示中の全てのデバイス」として表示中の端末を個別に付け外しする。

端末には行の鉛筆ボタンから名前(別名)を付けられる(D-092)。別名はブリッジが MAC(分からなければ host)で覚えて
destinations で配り直すので、このパネルは destinationsAlias を送るだけで、手元では表示を変えない。
"""

from __future__ import annotations

import ipaddress
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Callable, Sequence

import regex
from nicegui import ui

from .delivery_lights import fade_script
from .notify_history import notify
from .protocol import DESTINATIONS_MAX_ALIAS_CHARS, DestinationBroadcast, DestinationDevice, DestinationsFrame, has_lone_surrogate, utf16_length
from .state import SurfaceState

# 端末の行の補足で、ブリッジの PC を指す語(D-094)
SELF_CAPTION = "サーバー PC"


def toggled_hosts(selected: Sequence[str], host: str, checked: bool, order: Sequence[str]) -> list[str]:
    """チェックの付け外しを反映した選択。一覧の並び(order)に揃え、一覧に無い選択は後ろにそのまま残す。"""
    chosen = set(selected)
    if checked:
        chosen.add(host)
    else:
        chosen.discard(host)
    listed = [item for item in order if item in chosen]
    rest = [item for item in selected if item in chosen and item not in order]
    return listed + rest


def device_name(device: DestinationDevice) -> str:
    """一覧の見出し。IP と MAC では端末を見分けられないので、別名(D-092)、引けた名前(D-085)、IP の順に出す。

    別名を引けた名前より先にするのは、利用者が自分で付けた名前の方が、その現場で端末を見分ける意図に合うため
    """
    return device.alias or device.hostname or device.host


def device_caption(device: DestinationDevice) -> str:
    """端末の行の補足。名前を見出しにしたときの IP と、この PC・設定の宛先・見つからなかったことを文字で出す。

    別名を見出しにしたときは、引けた名前も補足に残す(別名を付けても機械の名前で探せるように)。
    MAC は見ても端末を特定できないので出さない(行のツールチップにだけ残す)。
    """
    parts: list[str] = []
    if device.alias and device.hostname:
        parts.append(device.hostname)
    if device.alias or device.hostname:
        parts.append(device.host)
    if device.is_self:
        # ブリッジの PC。スマホなどから開いていると「この PC」は手元の端末と紛らわしいので、サーバーと書く
        parts.append(SELF_CAPTION)
    if device.configured:
        parts.append("設定の宛先")
    if not device.found:
        parts.append("直近の走査で見つかりません")
    return " / ".join(parts)


def alias_from_input(text: str | None) -> str | None:
    """別名の入力欄の文字列を、ブリッジへ送る別名にする(D-092)。前後の空白を外し、空なら None(名前を消す)。

    長すぎる・制御文字や孤立サロゲートを含む名前は ValueError(ブリッジも同じ規則で断るが、送る前に入力欄で知らせる)。
    """
    alias = (text or "").strip()
    if not alias:
        return None
    # ブリッジ(String.length)・ブラウザの maxlength と同じく UTF-16 の単位で数える(len だと絵文字を 1 と数えてずれる)
    if utf16_length(alias) > DESTINATIONS_MAX_ALIAS_CHARS:
        raise ValueError(f"名前は {DESTINATIONS_MAX_ALIAS_CHARS} 文字までです")
    if any(ord(char) < 0x20 or ord(char) == 0x7F for char in alias):
        raise ValueError("名前に制御文字は使えません")
    if has_lone_surrogate(alias):
        raise ValueError("名前に使えない文字が含まれています")
    return alias


ALIAS_ENTER_JS = "(e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) emit(); }"
"""名前の入力欄の Enter を、IME の変換確定でないときだけサーバーへ送る(ブラウザ側で判定する)。"""


def alias_key_hint(device: DestinationDevice) -> str:
    """別名をどのキーで覚えるか(ブリッジの規則と同じ。D-092)。MAC で覚えられない端末は IP が変わると名前が外れることを伝える。"""
    if device.mac:
        return f"MAC {device.mac} で覚えます(IP が変わっても同じ名前で出ます)"
    return f"MAC が分からないため {device.host} で覚えます(IP が変わると名前は外れます)"


def compile_query(query: str) -> regex.Pattern[str] | None:
    """検索欄の文字列を正規表現として読む(大文字小文字を区別しない)。正規表現として読めなければ None。"""
    try:
        return regex.compile(query.strip(), regex.IGNORECASE)
    except regex.error:
        return None


# 一覧 1 回分の正規表現の照合に使ってよい時間。照合は UI のイベントループの上で走るので、`^(.*)+z$` のような
# バックトラックの爆発する式で全ブラウザの操作と表示が止まらないよう、これを過ぎたら文字どおりの部分一致に切り替える
QUERY_BUDGET_S = 0.05


def _search_fields(device: DestinationDevice) -> list[str]:
    return [field for field in (device.alias, device.hostname, device.host, device.mac, device.interface) if field]


@dataclass(frozen=True)
class QueryResult:
    """一覧 1 回分の照合結果。fallback は文字どおりの部分一致に落とした理由("invalid" / "slow")、落としていなければ None。"""

    matched: tuple[bool, ...]
    fallback: str | None


def match_devices(
    devices: Sequence[DestinationDevice], query: str, budget_s: float = QUERY_BUDGET_S, clock: Callable[[], float] = time.monotonic
) -> QueryResult:
    """検索欄の正規表現が、各端末の別名・名前・IP・MAC・インタフェース名のどれかの一部に一致するか(D-086 / D-092)。

    一覧の部品を作る前に全端末をまとめて照合し、時間の上限には照合に使った時間だけを数える(部品を作る時間で
    上限を使い切ると、軽い式でも後半の端末だけ打ち切られる)。正規表現として読めない入力(「192.168.(」など
    打っている途中)と、上限を超えた式は、全端末を文字どおりの部分一致で探し直す。「一致なし」にすると打っている
    途中で一覧が全部薄くなってちらつき、途中から切り替えると端末ごとに判定がまちまちになるため
    """
    needle = query.strip()
    if not needle:
        return QueryResult(tuple(True for _ in devices), None)
    pattern = compile_query(needle)
    fallback: str | None = "invalid" if pattern is None else None
    if pattern is not None:
        remaining = budget_s
        matched: list[bool] = []
        try:
            for device in devices:
                started = clock()
                # 0 を渡すと regex は打ち切らない扱いになりうるので、使い切っていても最小の正の値を渡して即座に打ち切らせる
                matched.append(any(pattern.search(field, timeout=max(remaining, 1e-6)) for field in _search_fields(device)))
                remaining -= clock() - started
                if remaining <= 0:
                    raise TimeoutError
            return QueryResult(tuple(matched), None)
        except TimeoutError:
            fallback = "slow"
    folded = needle.casefold()
    return QueryResult(tuple(any(folded in field.casefold() for field in _search_fields(device)) for device in devices), fallback)


def matches_query(device: DestinationDevice, query: str) -> bool:
    """1 台だけの照合(match_devices の 1 台版)。"""
    return match_devices([device], query).matched[0]


@dataclass(frozen=True)
class DeviceGroup:
    """一覧の 1 まとまり。broadcast が None なら、どのネットワークにも入らない端末(設定の宛先のホスト名など)。"""

    broadcast: DestinationBroadcast | None
    devices: tuple[DestinationDevice, ...]


def _in_network(host: str, network: str) -> bool:
    try:
        return ipaddress.ip_address(host) in ipaddress.ip_network(network, strict=False)
    except ValueError:
        return False


def _prefix_length(network: str) -> int:
    try:
        return ipaddress.ip_network(network, strict=False).prefixlen
    except ValueError:
        return -1


def narrowest_network(host: str, networks: Sequence[str]) -> str | None:
    """そのホストを含むネットワークのうち最も狭いもの(プレフィックスが最長。同じ長さなら先に並ぶもの)。

    ネットワークが重なると OS は狭い経路で送るので、広い方のブロードキャストは狭い方の端末に届かない(ブリッジと同じ規則)。
    """
    best: str | None = None
    for network in networks:
        if _in_network(host, network) and (best is None or _prefix_length(network) > _prefix_length(best)):
            best = network
    return best


def group_devices(frame: DestinationsFrame) -> list[DeviceGroup]:
    """端末をネットワークごとにまとめる。ネットワークが重なるときは最も狭いネットワークに入れる(1 台を 2 か所に出さない)。"""
    networks = [broadcast.network for broadcast in frame.broadcasts]
    placed = {device.host: narrowest_network(device.host, networks) for device in frame.devices}
    groups = [
        DeviceGroup(broadcast, tuple(device for device in frame.devices if placed[device.host] == broadcast.network))
        for broadcast in frame.broadcasts
    ]
    remaining = [device for device in frame.devices if placed[device.host] is None]
    if remaining:
        groups.append(DeviceGroup(None, tuple(remaining)))
    return groups


def _broadcast_of(network: str) -> str | None:
    try:
        return str(ipaddress.ip_network(network, strict=False).broadcast_address)
    except ValueError:
        return None


def covering_network(host: str, networks: Sequence[str], scanned: Sequence[str] | None = None) -> str | None:
    """選んだネットワークのうち、そのホストをブロードキャストで届けるもの(個別には送らない。D-085)。

    ホストを含む走査ネットワーク(scanned。省くと選んだネットワークだけ)の中で最も狭いものが選んだネットワークのとき、
    またはその最も狭いネットワークのブロードキャストアドレスが選んだネットワークのものと同じとき(同じ宛先へ出る)に届く。
    ブリッジの判定と同じ規則
    """
    narrowest = narrowest_network(host, list(scanned) if scanned is not None else networks)
    if narrowest is None:
        return None
    narrowest_broadcast = _broadcast_of(narrowest)
    # 共通のブロードキャストで届くのは、選んだネットワークの中の端末だけ(狭いネットワークの外の端末には、そのブロードキャストは狭い側へ出て届かない)
    return next(
        (
            network
            for network in networks
            if network == narrowest or (_broadcast_of(network) == narrowest_broadcast and _in_network(host, network))
        ),
        None,
    )


def toggled_networks(selected: Sequence[str], network: str, checked: bool, order: Sequence[str]) -> list[str]:
    """ネットワークの付け外しを反映した選択。一覧の並び(order)に揃える。"""
    chosen = set(selected)
    if checked:
        chosen.add(network)
    else:
        chosen.discard(network)
    return [item for item in order if item in chosen]


Selection = tuple[bool, tuple[str, ...], tuple[str, ...]]
"""(全てのデバイス, ネットワーク, 端末)。ブリッジの destinationsSelect と同じ 3 つ組。"""


def is_covered(
    device: DestinationDevice, all_devices: bool, networks: Sequence[str], scanned: Sequence[str] | None = None
) -> bool:
    """全てのデバイス・選んだネットワークで届く端末か(scanned は走査ネットワーク。重なるときは最も狭いものだけが届く。D-093)。

    設定の宛先はポートが unity.sendPort と違えばブロードキャストで届かず、ブリッジが個別に送り続ける。UI は設定の宛先の
    ポートを知らないので、ネットワークで届くとはみなさず個別の選択に任せる(同じポートならブリッジが個別には送らない)。
    この PC はブロードキャストが自分にも届くので、どのネットワークを選んでも届く(ブリッジも個別には送らない)
    """
    if all_devices:
        return True
    if device.configured:
        return False
    return covering_network(device.host, networks, scanned) is not None or (device.is_self and bool(networks))


def is_checked(device: DestinationDevice, selection: Selection, scanned: Sequence[str] | None = None) -> bool:
    """一覧のチェックの見た目。親(全てのデバイス・ネットワーク)で届く端末にもチェックを付ける(D-089)。"""
    all_devices, networks, hosts = selection
    return device.host in hosts or is_covered(device, all_devices, networks, scanned)


def selection_with(frame: DestinationsFrame, selection: Selection, hosts_on: Sequence[str]) -> Selection:
    """端末を個別の選択に足す。一覧の並びに揃え、一覧に無い選択は後ろにそのまま残す。"""
    all_devices, networks, hosts = selection
    chosen = list(hosts)
    for host in hosts_on:
        chosen = toggled_hosts(chosen, host, True, [device.host for device in frame.devices])
    return all_devices, networks, tuple(chosen)


def selection_without(
    frame: DestinationsFrame, selection: Selection, hosts_off: Sequence[str] = (), network_off: str | None = None
) -> Selection:
    """端末(またはネットワーク)を選択から外す。親で届いていた端末を外すときは親を外し、残りを個別の選択へ展開する(D-089)。

    親を残したまま子だけを外すことはできない(ブロードキャストは見つかった端末を選んで届けられない)ので、外す端末を含む
    ネットワーク(全てのデバイスなら全体)を外し、それまで親で届いていた他の端末は個別に選び直す。ネットワークそのものを
    外すとき(network_off)は、その中の端末は個別に選んでいたものだけを残す(ネットワークの「全てのデバイス」を外す操作なので)
    """
    all_devices, networks, hosts = selection
    off = set(hosts_off)
    groups = group_devices(frame)
    scanned = [broadcast.network for broadcast in frame.broadcasts]
    dropped = set() if network_off is None else {network_off}
    released: set[str] = set()
    network_of: dict[str, str] = {}
    for group in groups:
        if group.broadcast is None:
            continue
        for device in group.devices:
            network_of[device.host] = group.broadcast.network
            # 設定の宛先も、外したらそのネットワークを外す。設定の宛先は UI ではネットワークで届く扱いにしないが、
            # ポートが unity.sendPort と同じならブロードキャストで届くので、残すとチェックを外した端末へ送り続ける
            if device.host in off:
                dropped.add(group.broadcast.network)
                # 共通のブロードキャストで届く親(狭いネットワークと同じアドレスの広いネットワーク)も外さないと送り続ける
                parent = covering_network(device.host, networks, scanned)
                if parent is not None:
                    dropped.add(parent)
            if group.broadcast.network == network_off:
                released.add(device.host)
    if network_off is not None:
        # 共通のブロードキャストで届いていた端末(別のグループに置かれる)も、ネットワークを外せば個別選択へ展開しない
        released.update(
            device.host for device in frame.devices if covering_network(device.host, [network_off], scanned) == network_off
        )
    base = scanned if all_devices else list(networks)
    kept = tuple(network for network in base if network not in dropped)
    # 並びは toggled_hosts と同じく一覧(frame.devices)の順にそろえる
    order = [device.host for device in frame.devices]
    keep: list[str] = []
    for device in frame.devices:
        if device.host in off or device.host in keep:
            continue
        explicit = device.host in hosts
        # 展開するのは外した親の中で届いていた端末だけ。この PC は別のネットワークのブロードキャストでも届く扱いだが、
        # 親として選んだものではないので、別のネットワークのアドレスを個別の選択へ足さない
        in_parent = all_devices or network_of.get(device.host) in dropped or covering_network(device.host, networks, scanned) in dropped
        expanded = (
            in_parent
            and device.host not in released
            and is_checked(device, selection, scanned)
            and not is_covered(device, False, kept, scanned)
        )
        if explicit or expanded:
            keep.append(device.host)
    rest = [host for host in hosts if host not in order and host not in off]
    still_all = all_devices and not off and network_off is None
    return still_all, kept, tuple(keep + rest)


def is_empty(selection: Selection) -> bool:
    return not selection[0] and not selection[1] and not selection[2]


def all_devices_label(frame: DestinationsFrame, filtering: bool = False) -> str:
    if filtering:
        return "表示中の全てのデバイス"
    if not frame.broadcasts:
        return "全てのデバイス(IPv4 のネットワークが見つかりません)"
    return "全てのデバイス"


def all_devices_tooltip(frame: DestinationsFrame) -> str:
    """全てのデバイスの送り先(ブロードキャストアドレス)。一覧の文字を詰めるため、マウスオーバーのときだけ出す。"""
    return "送り先: " + ", ".join(broadcast.address for broadcast in frame.broadcasts)


def network_label(filtering: bool = False) -> str:
    return "このネットワークの表示中のデバイス" if filtering else "このネットワークの全てのデバイス"


def scan_status(frame: DestinationsFrame) -> str:
    if frame.scanning:
        return "走査中…"
    if frame.scanned_at is None:
        return "未走査"
    at = datetime.fromisoformat(frame.scanned_at.replace("Z", "+00:00")).astimezone()
    return f"最終走査 {at:%H:%M:%S}"


# 未確定の選択を持つ上限。応答は LAN 内なら一瞬で届くので、これを過ぎても自分の選択が反映されないのは
# 他の画面の変更が後から勝ったか、ブリッジ側で選択が変わった(ネットワークの変化で落ちた)ときで、届いた選択に従い直す
PENDING_TIMEOUT_S = 3.0


class DestinationsPanel:
    def __init__(self, state: SurfaceState, clock: Callable[[], float] = time.monotonic) -> None:
        self._state = state
        self._clock = clock
        self._key: tuple[int, bool, int] | None = None
        self._auto_scan_requested = False
        self._built = False
        # 送ったがまだブリッジの応答(次の destinations)を受けていない選択。続けて押されたチェックはここから作る。
        # 届いた frame から作ると、応答の前に 2 台を続けて変えたとき、後の送信が先の変更を消すため(D-078)。
        # 応答が届くまでチェックを無効にする案は、応答の遅い回線で操作が止まって見えるので採らない。
        # (全てのデバイス, ネットワーク, 端末, 送った時刻)
        self._pending: tuple[bool, tuple[str, ...], tuple[str, ...], float] | None = None
        # 検索欄の文字列。画面の作り直し(定義の再配信)をまたいで保つ
        self._query = ""
        # 別名の編集中の端末(D-092)
        self._alias_host: str | None = None
        # 送ってブリッジの確認を待っている名前(host, 名前)。確認(destinations に反映)まではダイアログを開いたままにし、
        # 断られたら入力を残したまま待つのをやめる(送った時点で閉じると、断られたときに入力が消えるため)
        self._alias_pending: tuple[str, str | None] | None = None
        self._alias_rejections_seen = 0
        # 点灯をこのページへ反映済みの番号(ホスト → 点灯の通し番号)。ページごとに持ち、描き直すと消して続きから描く
        self._lit: dict[str, int] = {}

    def build(self) -> None:
        """パネルの中身を作る。ページの組み立てで 1 回呼ばれる(作り直しても未確定の選択などの状態は持ち越す)。"""
        with ui.column().classes("w-full items-stretch q-pa-sm").style("gap:8px"):
            with ui.row().classes("w-full items-center justify-between no-wrap"):
                ui.label("送信先").classes("text-subtitle1")
                with ui.row().classes("items-center no-wrap gap-2"):
                    self._scan_label = ui.label("").classes("text-caption text-grey-7")
                    self._scan_button = ui.button("更新", icon="refresh", on_click=self._on_scan).props(
                        "flat dense no-caps"
                    )
            self._summary = ui.label("").classes("text-caption text-grey-7 break-all")
            # 一覧を描き直しても入力中の文字とフォーカスが消えないよう、検索欄は一覧の外に置く
            self._search = ui.input(
                placeholder="名前・IP で絞り込む(正規表現)", value=self._query, on_change=self._on_query
            ).props("dense outlined clearable").classes("w-full")
            with self._search.add_slot("prepend"):
                ui.icon("search")
            self._query_hint = ui.label("").classes("text-caption text-grey-7")
            self._show_query_hint(None)
            self._list = ui.column().classes("w-full items-stretch").style("gap:0")
            with ui.row().classes("w-full items-center justify-between"):
                self._source_label = ui.label("").classes("text-caption text-grey-7")
                self._reset_button = ui.button("設定ファイルの宛先に戻す", on_click=self._on_reset).props(
                    "flat dense no-caps"
                )
            ui.label(
                "OscDesk には認証がありません。信頼できる LAN の中だけで使ってください。"
            ).classes("text-caption text-grey-7")
            self._build_alias_dialog()
        self._built = True
        # 作ったばかりの一覧を、持ち越した状態のまま描く(同じ key でも描き直す)
        self._key = None
        self.sync()

    def _build_alias_dialog(self) -> None:
        """端末の別名(D-092)を付けるダイアログ。一覧を描き直しても入力中の文字が消えないよう、一覧の外に 1 つだけ作る。"""
        with ui.dialog() as self._alias_dialog, ui.card().classes("q-pa-md").style("min-width:280px"):
            self._alias_title = ui.label("").classes("text-subtitle2")
            self._alias_input = ui.input("名前", placeholder="例: ステージ左 iPad").props(
                f"dense outlined clearable counter maxlength={DESTINATIONS_MAX_ALIAS_CHARS}"
            ).classes("w-full")
            # Enter で決定する。ただし IME の変換を確定する Enter は無視する(日本語入力の確定でダイアログが閉じないように)。
            # Safari は確定の keydown で isComposing を false にすることがあるので、keyCode 229(IME 処理中)も見る
            self._alias_input.on("keydown", self._on_alias_save, js_handler=ALIAS_ENTER_JS)
            self._alias_hint = ui.label("").classes("text-caption text-grey-7")
            with ui.row().classes("w-full justify-end items-center").style("gap:4px"):
                self._alias_clear_button = ui.button("名前を消す", on_click=self._on_alias_clear).props(
                    "flat dense no-caps color=negative"
                )
                ui.button("キャンセル", on_click=self._on_alias_cancel).props("flat dense no-caps")
                # 「保存」にしないのは、編集モードの定義の「保存」ボタンと文字で取り違えないため
                ui.button("決定", on_click=self._on_alias_save).props("dense no-caps color=primary")

    def sync(self) -> None:
        if not self._built:
            return
        state = self._state
        key = (state.destinations_revision, state.link_status.connected, state.destinations_rejections)
        self._settle_pending(key)
        self._settle_alias()
        if key != self._key:
            self._key = key
            self._render()
        self._apply_lights()

    def _apply_lights(self) -> None:
        """届いた到達のイベントを、送り先に選んでいるブロックの点灯にする(D-106)。

        退色はブラウザの CSS の transition に任せ、ここは点灯の開始だけを送る(途中経過は送らない)。
        送り先に選んでいないブロックは光らせない。20Hz の同期から呼ばれ、新しい点灯があるときだけ JavaScript を送る
        """
        frame = self._state.destinations
        if frame is None:
            return
        active = self._state.delivery_lights.active()
        for host in [host for host in self._lit if host not in active]:
            del self._lit[host]
        if not active:
            return
        selection: Selection = (frame.all_devices, frame.networks, frame.hosts)
        scanned = [broadcast.network for broadcast in frame.broadcasts]
        devices = {device.host: device for device in frame.devices}
        for host, (light, remaining) in active.items():
            if self._lit.get(host) == light.seq:
                continue
            device = devices.get(host)
            if device is None or not is_checked(device, selection, scanned):
                continue
            self._lit[host] = light.seq
            ui.run_javascript(fade_script(host, light, remaining))

    def _settle_pending(self, key: tuple[int, bool, int]) -> None:
        """未確定の選択を捨てるか決める。選択と関係の無い destinations(走査の完了・応答者の追加)では捨てない。

        捨てるのは、届いた選択が未確定の選択と一致した(反映された)とき、ブリッジが断ったとき、切断したとき、上限の時間が過ぎたとき。
        どの destinations でも捨てると、走査の完了などで消えた後の変更が、応答前の先の変更を上書きするため
        """
        pending = self._pending
        if pending is None:
            return
        frame = self._state.destinations
        rejected = self._key is not None and key[2] != self._key[2]
        applied = frame is not None and (frame.all_devices, tuple(frame.networks), tuple(frame.hosts)) == pending[:3]
        expired = self._clock() - pending[3] > PENDING_TIMEOUT_S
        if not key[1] or rejected or applied or expired:
            self._pending = None

    def _render(self) -> None:
        frame = self._state.destinations
        connected = self._state.link_status.connected
        self._list.clear()
        if frame is None:
            self._scan_label.text = ""
            self._summary.text = ""
            self._source_label.text = ""
            self._scan_button.disable()
            self._reset_button.disable()
            with self._list:
                ui.label("ブリッジから宛先の情報を待っています。").classes("text-grey-7")
            return

        # ブリッジは起動時に走査しない(UI を使わない起動で LAN へ撒かないため)。未走査のまま開いたら 1 回だけ走査を頼む。
        # 「頼んだ」印は、切断(ブリッジの再起動を含む)と走査済みの受信で戻す。戻さないと、再起動した新しいブリッジの
        # 未走査の destinations を受けても頼まず、一覧が空のままになる
        if not connected or frame.scanned_at is not None:
            self._auto_scan_requested = False
        if connected and frame.scanned_at is None and not frame.scanning and not self._auto_scan_requested:
            self._auto_scan_requested = self._state.request_destinations_scan()
        self._scan_label.text = scan_status(frame)
        if frame.scanning:
            self._scan_button.props("loading")
        else:
            self._scan_button.props(remove="loading")
        self._scan_button.set_enabled(connected and not frame.scanning)
        self._reset_button.set_enabled(connected and frame.source != "config")
        targets = ", ".join(f"{target.host}:{target.send_port}" for target in frame.targets)
        self._summary.text = f"いま送っている宛先: {targets}"
        self._source_label.text = {
            "saved": "保存した選択を使っています",
            "unsaved": "選択を使っています(保存できなかったため、ブリッジを再起動すると設定ファイルの宛先に戻ります)",
        }.get(frame.source, "設定ファイルの宛先を使っています")

        self._render_list()

    def _render_list(self) -> None:
        frame = self._state.destinations
        if frame is None:
            return
        connected = self._state.link_status.connected
        self._list.clear()
        self._lit.clear()  # 描き直した新しいブロックには、光っているものを続きから描き直す
        # チェックはブリッジから届いた選択で描く(応答待ちの選択で描くと、断られた選択が画面に残る)
        selection: Selection = (frame.all_devices, frame.networks, frame.hosts)
        groups = group_devices(frame)
        scanned = [broadcast.network for broadcast in frame.broadcasts]
        ordered = [device for group in groups for device in group.devices]
        result = match_devices(ordered, self._query)
        matched = iter(result.matched)
        # 一致しない端末は隠す(選択は残す)。絞り込んでいる間の親のチェックは、表示中の端末の個別の選択として働く
        filtering = bool(self._query.strip())
        visible_groups = [(group, tuple(device for device in group.devices if next(matched))) for group in groups]
        visible = [device for _group, devices in visible_groups for device in devices]
        with self._list:
            if filtering:
                everyone = ui.checkbox(
                    all_devices_label(frame, filtering=True),
                    value=bool(visible) and all(is_checked(device, selection, scanned) for device in visible),
                    on_change=lambda event, hosts=tuple(d.host for d in visible): self._on_visible(hosts, bool(event.value)),
                ).props("dense")
                everyone.set_enabled(connected and bool(visible))
            else:
                everyone = ui.checkbox(
                    all_devices_label(frame),
                    value=frame.all_devices,
                    on_change=lambda event: self._on_all_devices(bool(event.value)),
                ).props("dense")
                if frame.broadcasts:
                    everyone.tooltip(all_devices_tooltip(frame))
                # ネットワークが無いときは選べないが、既に選んでいれば外せるようにしておく
                everyone.set_enabled(connected and (bool(frame.broadcasts) or frame.all_devices))
            if not frame.devices:
                ui.label("端末が見つかっていません。「更新」で走査します。").classes("text-grey-7")
            elif filtering and not visible:
                ui.label("検索に一致する端末がありません。").classes("text-grey-7")
            for group, devices in visible_groups:
                if filtering and not devices:
                    continue
                ui.separator().classes("q-my-xs")
                if group.broadcast is None:
                    ui.label("その他の宛先").classes("text-caption text-weight-bold text-grey-8")
                else:
                    self._render_network(group.broadcast, devices, selection, scanned, filtering, connected)
                for device in devices:
                    self._render_device(device, is_checked(device, selection, scanned), connected)
        self._show_query_hint(result.fallback)

    def _render_network(
        self, broadcast: DestinationBroadcast, devices: Sequence[DestinationDevice], selection: Selection, scanned: Sequence[str],
        filtering: bool, connected: bool,
    ) -> None:
        ui.label(f"{broadcast.network}({broadcast.interface})").classes("text-caption text-weight-bold text-grey-8")
        if filtering:
            box = ui.checkbox(
                network_label(filtering=True),
                value=bool(devices) and all(is_checked(device, selection, scanned) for device in devices),
                on_change=lambda event, hosts=tuple(d.host for d in devices): self._on_visible(hosts, bool(event.value)),
            ).props("dense")
        else:
            # 全てのデバイスの間はネットワークにもチェックを付けて見せる(D-089)
            box = ui.checkbox(
                network_label(),
                value=selection[0] or broadcast.network in selection[1],
                on_change=lambda event, network=broadcast.network: self._on_network(network, bool(event.value)),
            ).props("dense")
            box.tooltip(f"送り先: {broadcast.address}")
        box.set_enabled(connected)

    def _render_device(self, device: DestinationDevice, checked: bool, connected: bool) -> None:
        # ブロック(D-106)。到達のイベントで背景が緑・黄・赤に光り、10 秒かけて元に戻る。data-host で光らせる相手を引く
        with ui.row().classes("w-full items-center no-wrap q-pl-md q-my-xs").style(
            "gap:8px; border:1px solid rgba(128,128,128,0.35); border-radius:6px; padding-top:2px; padding-bottom:2px"
        ).props(f'data-host="{device.host}"') as row:
            # 親で届く端末もチェックを付けたまま操作できる。外すと親を外して残りを個別の選択へ展開する(D-089)
            box = ui.checkbox(
                device_name(device),
                value=checked,
                on_change=lambda event, host=device.host: self._on_toggle(host, bool(event.value)),
            ).props("dense")
            box.set_enabled(connected)
            caption = device_caption(device)
            if caption:
                ui.label(caption).classes("text-caption text-grey-7")
            # 名前の引けない LAN でも端末を見分けられるよう、端末に名前を付けられる(D-092)
            rename = ui.button(icon="edit", on_click=lambda _event, d=device: self._open_alias_editor(d)).props(
                "flat dense round size=sm"
            ).classes("q-ml-auto")
            rename.tooltip("名前を付ける")
            rename.set_enabled(connected)
        if device.mac:
            row.tooltip(f"MAC {device.mac}")

    def _redraw(self) -> None:
        # チェックボックスは押した時点で見た目が変わっているので、ブリッジが持つ選択で描き直す
        self._key = None
        self.sync()

    def _current(self, frame: DestinationsFrame) -> tuple[bool, tuple[str, ...], tuple[str, ...]]:
        """次の変更の土台。応答待ちの選択があればそれ、無ければブリッジから届いた選択。"""
        return self._pending[:3] if self._pending is not None else (frame.all_devices, frame.networks, frame.hosts)

    def _send(self, all_devices: bool, networks: Sequence[str], hosts: Sequence[str]) -> bool:
        if not self._state.select_destinations(all_devices, list(networks), list(hosts)):
            return False
        self._pending = (all_devices, tuple(networks), tuple(hosts), self._clock())
        return True

    def _send_or_reset(self, all_devices: bool, networks: Sequence[str], hosts: Sequence[str]) -> None:
        # 何も残らない選択は送れない(ブリッジが断る)。全てのデバイス・ネットワークを外して戻す先が無いときは、
        # 設定ファイルの宛先へ戻す
        sent = self._send(all_devices, networks, hosts) if all_devices or networks or hosts else self._reset_quietly()
        if not sent:
            notify("ブリッジに接続していないため変更できませんでした", type="warning")
            self._redraw()

    def _reset_quietly(self) -> bool:
        self._pending = None
        return self._state.reset_destinations()

    def _on_toggle(self, host: str, checked: bool) -> None:
        frame = self._state.destinations
        if frame is None:
            return
        current = self._current(frame)
        selection = selection_with(frame, current, [host]) if checked else selection_without(frame, current, hosts_off=[host])
        if is_empty(selection):
            notify("送信先を 1 台以上選んでください", type="warning")
            self._redraw()
            return
        if not self._send(*selection):
            notify("ブリッジに接続していないため変更できませんでした", type="warning")
            self._redraw()

    def _on_network(self, network: str, checked: bool) -> None:
        frame = self._state.destinations
        if frame is None:
            return
        current = self._current(frame)
        all_devices, networks, hosts = current
        if (all_devices or network in networks) == checked:
            return
        if checked:
            self._send_or_reset(all_devices, toggled_networks(networks, network, True, [b.network for b in frame.broadcasts]), hosts)
            return
        self._send_or_reset(*selection_without(frame, current, network_off=network))

    def _on_visible(self, hosts: Sequence[str], checked: bool) -> None:
        """絞り込んでいる間の「表示中の全てのデバイス」。表示中の端末だけを個別の選択として付け外しする。"""
        frame = self._state.destinations
        if frame is None or not hosts:
            return
        current = self._current(frame)
        selection = selection_with(frame, current, hosts) if checked else selection_without(frame, current, hosts_off=hosts)
        self._send_or_reset(*selection)

    def _on_all_devices(self, checked: bool) -> None:
        frame = self._state.destinations
        if frame is None:
            return
        all_devices, networks, hosts = self._current(frame)
        if checked == all_devices:
            return
        self._send_or_reset(checked, networks, hosts)

    def _on_query(self, event: object) -> None:
        self._query = str(getattr(event, "value", "") or "")
        if self._state.destinations is None:
            # 一覧が無い間は照合しないが、読めない式であることは先に伝える
            self._show_query_hint(match_devices([], self._query).fallback)
        self._render_list()

    def _show_query_hint(self, fallback: str | None) -> None:
        # 文字どおりの部分一致に落としたことを伝える(match_devices)。黙って落とすと、意図した絞り込みと違う理由が分からない
        text = {
            "invalid": "正規表現として読めないため、文字どおりに探しています",
            "slow": "正規表現の照合に時間がかかりすぎるため、文字どおりに探しています",
        }.get(fallback or "", "")
        self._query_hint.text = text
        self._query_hint.set_visibility(bool(text))

    def _settle_alias(self) -> None:
        """名前の確認待ちを片付ける。届いた destinations に送った名前が出たら閉じ、断られた・切断したら開いたまま待つのをやめる。"""
        rejections = self._state.destination_alias_rejections
        rejected = rejections != self._alias_rejections_seen
        self._alias_rejections_seen = rejections
        pending = self._alias_pending
        if pending is None:
            return
        if rejected or not self._state.link_status.connected:
            # 入力はそのまま残し、直して送り直せるようにする(理由は通知に出る)
            self._alias_pending = None
            return
        frame = self._state.destinations
        host, alias = pending
        device = None if frame is None else next((item for item in frame.devices if item.host == host), None)
        if device is not None and device.alias == alias:
            self._alias_pending = None
            self._alias_host = None
            self._alias_dialog.close()

    def _open_alias_editor(self, device: DestinationDevice) -> None:
        self._alias_pending = None
        self._alias_host = device.host
        self._alias_title.text = f"{device.hostname or device.host} の名前"
        self._alias_input.value = device.alias or ""
        self._alias_hint.text = alias_key_hint(device)
        self._alias_clear_button.set_visibility(bool(device.alias))
        self._alias_dialog.open()

    def _send_alias(self, alias: str | None) -> None:
        host = self._alias_host
        if host is None:
            return
        # 表示は変えずにブリッジへ送り、ブリッジが配り直す destinations で描き直す(別名の正はブリッジ)。
        # ダイアログは、送った名前が destinations に出るまで閉じない(_settle_alias)
        if not self._state.set_destination_alias(host, alias):
            notify("ブリッジに接続していないため名前を変更できませんでした", type="warning")
            return
        self._alias_pending = (host, alias)

    def _on_alias_save(self) -> None:
        try:
            alias = alias_from_input(str(self._alias_input.value or ""))
        except ValueError as error:
            notify(str(error), type="warning")
            return
        self._send_alias(alias)

    def _on_alias_clear(self) -> None:
        self._send_alias(None)

    def _on_alias_cancel(self) -> None:
        # 送った名前の確認は待たない(ブリッジが受ければ一覧はそのまま変わる)
        self._alias_pending = None
        self._alias_host = None
        self._alias_dialog.close()

    def _on_scan(self) -> None:
        if not self._state.request_destinations_scan():
            notify("ブリッジに接続していないため走査できませんでした", type="warning")

    def _on_reset(self) -> None:
        # 設定ファイルの宛先へ戻すので、それより前に送った未確定の選択は土台にしない
        self._pending = None
        if not self._state.reset_destinations():
            notify("ブリッジに接続していないため戻せませんでした", type="warning")
