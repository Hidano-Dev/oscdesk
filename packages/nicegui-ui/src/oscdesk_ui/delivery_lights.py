"""送り先の PC の点灯(到達のイベント。D-106)。

ブリッジが配る delivery フレーム(送ったものが届いた ok / 届いたが対象がいない ignored / 処理できなかった failed)を、
ホストごとの「いま光っている色」に畳む表示キャッシュ。色の退色(10 秒かけて元の色に戻す)はブラウザの CSS の transition に任せ、
ここは「いつ・何色で光り始めたか」だけを持つ。状態はプロセスに 1 つで、どのブラウザから送った場合も同じに光る。

規則(HID-376): 点灯中の赤・黄を、後から来た緑で上書きして消さない(スライダーを動かし続けている間の 1 回の失敗を隠さないため)。
赤は黄より強く、同じか強い結果は点灯し直す(退色をやり直す)。点灯が終われば、次の結果は何でも点灯する。
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Callable, Final, Mapping

from .protocol import DeliveryEvent

FADE_SECONDS: Final = 10.0
"""点灯してから元の色に戻るまでの秒数。"""

_RANK: Final = {"ok": 1, "ignored": 2, "failed": 3}
# 緑・黄・赤(Material の色)。ブラウザ側で透明度を掛けて退色させる
COLORS: Final = {"ok": (76, 175, 80), "ignored": (255, 193, 7), "failed": (244, 67, 54)}


@dataclass(frozen=True)
class Light:
    result: str
    at: float
    seq: int


class DeliveryLights:
    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._lights: dict[str, Light] = {}
        self._seq = 0

    def record(self, event: DeliveryEvent) -> bool:
        """イベントを点灯に反映する。点灯を変えたら True(強い点灯が残っていて無視したら False)。"""
        now = self._clock()
        current = self._lights.get(event.host)
        if current is not None and now - current.at < FADE_SECONDS and _RANK[event.result] < _RANK[current.result]:
            return False
        self._seq += 1
        self._lights[event.host] = Light(event.result, now, self._seq)
        return True

    def active(self) -> Mapping[str, tuple[Light, float]]:
        """いま光っているホストと、残りの割合(1.0 = 点灯したて、0 に近いほど退色済み)。退色し終えたものは捨てる。"""
        now = self._clock()
        expired = [host for host, light in self._lights.items() if now - light.at >= FADE_SECONDS]
        for host in expired:
            del self._lights[host]
        return {host: (light, max(0.0, 1.0 - (now - light.at) / FADE_SECONDS)) for host, light in self._lights.items()}


def fade_script(host: str, light: Light, remaining: float) -> str:
    """ホストのブロックを点灯して退色させる JavaScript。残りの割合から始めて、残りの秒数で透明にする(描き直しても続きから)。"""
    red, green, blue = COLORS[light.result]
    seconds = max(0.0, remaining * FADE_SECONDS)
    selector = json.dumps(f'[data-host="{host}"]')
    start = f"rgba({red},{green},{blue},{remaining:.3f})"
    end = f"rgba({red},{green},{blue},0)"
    return (
        "(() => { for (const el of document.querySelectorAll(" + selector + ")) {"
        " el.style.transition = 'none';"
        " el.style.backgroundColor = '" + start + "';"
        " void el.offsetWidth;"
        " el.style.transition = 'background-color " + f"{seconds:.2f}" + "s linear';"
        " el.style.backgroundColor = '" + end + "'; } })()"
    )
