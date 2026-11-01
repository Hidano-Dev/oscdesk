from __future__ import annotations

from oscdesk_ui.delivery_lights import FADE_SECONDS, DeliveryLights, fade_script
from oscdesk_ui.protocol import DeliveryEvent


class Clock:
    def __init__(self) -> None:
        self.now = 100.0

    def __call__(self) -> float:
        return self.now


def event(result: str, host: str = "10.0.0.1") -> DeliveryEvent:
    return DeliveryEvent(host, "PC1", result, "a", 5)


def test_event_lights_the_host_and_fades_after_ten_seconds() -> None:
    clock = Clock()
    lights = DeliveryLights(clock)
    assert lights.record(event("ok")) is True
    light, remaining = lights.active()["10.0.0.1"]
    assert (light.result, remaining) == ("ok", 1.0)
    clock.now += FADE_SECONDS / 2
    assert lights.active()["10.0.0.1"][1] == 0.5
    clock.now += FADE_SECONDS
    assert lights.active() == {}


def test_a_later_ok_does_not_hide_a_lit_failure_or_ignore() -> None:
    clock = Clock()
    lights = DeliveryLights(clock)
    lights.record(event("failed"))
    clock.now += 1
    assert lights.record(event("ok")) is False
    assert lights.record(event("ignored")) is False
    assert lights.active()["10.0.0.1"][0].result == "failed"

    other = DeliveryLights(clock)
    other.record(event("ignored"))
    assert other.record(event("ok")) is False
    assert other.record(event("failed")) is True  # 強い結果は点灯し直す
    assert other.active()["10.0.0.1"][0].result == "failed"


def test_same_result_relights_and_a_finished_light_accepts_anything() -> None:
    clock = Clock()
    lights = DeliveryLights(clock)
    lights.record(event("ok"))
    first = lights.active()["10.0.0.1"][0].seq
    clock.now += 3
    assert lights.record(event("ok")) is True
    light, remaining = lights.active()["10.0.0.1"]
    assert light.seq != first and remaining == 1.0

    lights.record(event("failed"))
    clock.now += FADE_SECONDS + 1
    assert lights.record(event("ok")) is True
    assert lights.active()["10.0.0.1"][0].result == "ok"


def test_hosts_are_independent() -> None:
    lights = DeliveryLights(Clock())
    lights.record(event("failed", "10.0.0.1"))
    lights.record(event("ok", "10.0.0.2"))
    assert {host: light.result for host, (light, _r) in lights.active().items()} == {"10.0.0.1": "failed", "10.0.0.2": "ok"}


def test_fade_script_starts_at_the_remaining_alpha_and_fades_for_the_remaining_time() -> None:
    lights = DeliveryLights(Clock())
    lights.record(event("failed"))
    light, _ = lights.active()["10.0.0.1"]
    script = fade_script("10.0.0.1", light, 0.5)
    assert 'data-host=\\"10.0.0.1\\"' in script
    assert "rgba(244,67,54,0.500)" in script
    assert "background-color 5.00s linear" in script
    assert "rgba(244,67,54,0)" in script


def test_flash_lights_a_host_without_a_delivery_event_and_follows_the_same_rule() -> None:
    # 設計図の食い違い(D-118)は到達のイベントではないが、同じ赤で点灯して 10 秒で退色する
    clock = Clock()
    lights = DeliveryLights(clock)
    assert lights.flash("10.0.0.1", "failed") is True
    assert lights.active()["10.0.0.1"][0].result == "failed"
    clock.now += 1
    assert lights.record(event("ok")) is False
    clock.now += FADE_SECONDS
    assert lights.active() == {}