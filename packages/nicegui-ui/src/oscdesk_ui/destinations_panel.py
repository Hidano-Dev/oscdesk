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
"""

from __future__ import annotations

import ipaddress
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Callable, Sequence

import regex
from nicegui import ui

from .notify_history import notify
from .protocol import DestinationBroadcast, DestinationDevice, DestinationsFrame
from .state import SurfaceState


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
    """一覧の見出し。IP と MAC では端末を見分けられないので、名前が引けていれば名前を出す(D-085)。"""
    return device.hostname or device.host


def device_caption(device: DestinationDevice) -> str:
    """端末の行の補足。名前を見出しにしたときの IP と、この PC・設定の宛先・見つからなかったことを文字で出す。

    MAC は見ても端末を特定できないので出さない(行のツールチップにだけ残す)。
    """
    parts: list[str] = []
    if device.hostname:
        parts.append(device.host)
    if device.is_self:
        parts.append("この PC")
    if device.configured:
        parts.append("設定の宛先")
    if not device.found:
        parts.append("直近の走査で見つかりません")
    return " / ".join(parts)


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
    return [field for field in (device.hostname, device.host, device.mac, device.interface) if field]


@dataclass(frozen=True)
class QueryResult:
    """一覧 1 回分の照合結果。fallback は文字どおりの部分一致に落とした理由("invalid" / "slow")、落としていなければ None。"""

    matched: tuple[bool, ...]
    fallback: str | None


def match_devices(
    devices: Sequence[DestinationDevice], query: str, budget_s: float = QUERY_BUDGET_S, clock: Callable[[], float] = time.monotonic
) -> QueryResult:
    """検索欄の正規表現が、各端末の名前・IP・MAC・インタフェース名のどれかの一部に一致するか(D-086)。

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


def group_devices(frame: DestinationsFrame) -> list[DeviceGroup]:
    """端末をネットワークごとにまとめる。ネットワークが重なるときは先に並ぶネットワークに入れる(1 台を 2 か所に出さない)。"""
    remaining = list(frame.devices)
    groups: list[DeviceGroup] = []
    for broadcast in frame.broadcasts:
        inside = [device for device in remaining if _in_network(device.host, broadcast.network)]
        remaining = [device for device in remaining if device not in inside]
        groups.append(DeviceGroup(broadcast, tuple(inside)))
    if remaining:
        groups.append(DeviceGroup(None, tuple(remaining)))
    return groups


def covering_network(host: str, networks: Sequence[str]) -> str | None:
    """選んだネットワークのうち、そのホストを含むもの(ブロードキャストで届くので個別には送らない。D-085)。"""
    return next((network for network in networks if _in_network(host, network)), None)


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


def is_covered(device: DestinationDevice, all_devices: bool, networks: Sequence[str]) -> bool:
    """全てのデバイス・選んだネットワークで届く端末か。

    設定の宛先はポートが unity.sendPort と違えばブロードキャストで届かず、ブリッジが個別に送り続ける。UI は設定の宛先の
    ポートを知らないので、ネットワークで届くとはみなさず個別の選択に任せる(同じポートならブリッジが個別には送らない)。
    この PC はブロードキャストが自分にも届くので、どのネットワークを選んでも届く(ブリッジも個別には送らない)
    """
    if all_devices:
        return True
    if device.configured:
        return False
    return covering_network(device.host, networks) is not None or (device.is_self and bool(networks))


def is_checked(device: DestinationDevice, selection: Selection) -> bool:
    """一覧のチェックの見た目。親(全てのデバイス・ネットワーク)で届く端末にもチェックを付ける(D-089)。"""
    all_devices, networks, hosts = selection
    return device.host in hosts or is_covered(device, all_devices, networks)


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
    dropped = set() if network_off is None else {network_off}
    released: set[str] = set()
    network_of: dict[str, str] = {}
    for group in groups:
        if group.broadcast is None:
            continue
        for device in group.devices:
            network_of[device.host] = group.broadcast.network
            if device.host in off and not device.configured:
                dropped.add(group.broadcast.network)
            if group.broadcast.network == network_off:
                released.add(device.host)
    base = [broadcast.network for broadcast in frame.broadcasts] if all_devices else list(networks)
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
        in_parent = all_devices or network_of.get(device.host) in dropped
        expanded = (
            in_parent and device.host not in released and is_checked(device, selection) and not is_covered(device, False, kept)
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
        self._built = True
        # 作ったばかりの一覧を、持ち越した状態のまま描く(同じ key でも描き直す)
        self._key = None
        self.sync()

    def sync(self) -> None:
        if not self._built:
            return
        state = self._state
        key = (state.destinations_revision, state.link_status.connected, state.destinations_rejections)
        self._settle_pending(key)
        if key == self._key:
            return
        self._key = key
        self._render()

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
        # チェックはブリッジから届いた選択で描く(応答待ちの選択で描くと、断られた選択が画面に残る)
        selection: Selection = (frame.all_devices, frame.networks, frame.hosts)
        groups = group_devices(frame)
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
                    value=bool(visible) and all(is_checked(device, selection) for device in visible),
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
                    self._render_network(group.broadcast, devices, selection, filtering, connected)
                for device in devices:
                    self._render_device(device, is_checked(device, selection), connected)
        self._show_query_hint(result.fallback)

    def _render_network(
        self, broadcast: DestinationBroadcast, devices: Sequence[DestinationDevice], selection: Selection, filtering: bool, connected: bool
    ) -> None:
        ui.label(f"{broadcast.network}({broadcast.interface})").classes("text-caption text-weight-bold text-grey-8")
        if filtering:
            box = ui.checkbox(
                network_label(filtering=True),
                value=bool(devices) and all(is_checked(device, selection) for device in devices),
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
        with ui.row().classes("w-full items-center no-wrap q-pl-md").style("gap:8px") as row:
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

    def _on_scan(self) -> None:
        if not self._state.request_destinations_scan():
            notify("ブリッジに接続していないため走査できませんでした", type="warning")

    def _on_reset(self) -> None:
        # 設定ファイルの宛先へ戻すので、それより前に送った未確定の選択は土台にしない
        self._pending = None
        if not self._state.reset_destinations():
            notify("ブリッジに接続していないため戻せませんでした", type="warning")
