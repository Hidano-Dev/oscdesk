"""マニフェストのエントリから NiceGUI のウィジェットを組み立てる。

案件差分はコードでなくデータ(マニフェスト)で表現する規律に従い、
ここには「型 × ウィジェット種別 → 部品」の対応だけを置く。
"""

from __future__ import annotations

from dataclasses import dataclass, field
import json
from typing import Any, Callable

from nicegui import ui

from .entry_rules import validate_input_confirmation
from .manifest import ManifestEntry

# 送信を伴う既存ウィジェットに使える値型。input は別途 s も受理する。
INTERACTIVE_VALUE_TYPES = ("i", "f", "bool")

XY_PAD_SIZE_PX = 240
XY_MARKER_SIZE_PX = 18

# ポインタ操作の解放イベントを取りこぼしても、いつまでもエコーバックを
# 無視し続けないための保険。
HOLD_TIMEOUT_S = 2.0


@dataclass
class WidgetBinding:
    """1 エントリ分の UI 部品と、表示更新のための状態。"""

    entry: ManifestEntry
    apply: Callable[[tuple[Any, ...] | None], None]
    revision: int = -1
    is_display_only: bool = True
    _applying: bool = field(default=False, repr=False)
    current_values: tuple[Any, ...] | None = field(default=None, repr=False)
    # input がこのページ由来のホールドを持っている間 True(フォーカス〜確定/blur)。
    # ページの同期タイマーがこれを見てホールドを延長するため、キー入力が止まって
    # いてもフォーカス中は期限切れしない。Enter で確定したあとはフォーカスが残って
    # いても False に戻り、エコーバックで表示が確定する。
    is_editing: bool = field(default=False, repr=False)

    def request_reapply(self) -> None:
        """次回同期で、値の改訂が変わらなくても表示を再適用する。"""
        self.revision = -1


class WidgetFactory:
    """UI 操作を SurfaceState へ橋渡ししながらウィジェットを作る。"""

    def __init__(
        self,
        on_local: Callable[[ManifestEntry, tuple[Any, ...]], None],
        on_discrete: Callable[[ManifestEntry, tuple[Any, ...]], None],
        on_hold_begin: Callable[[ManifestEntry], None],
        on_hold_end: Callable[[ManifestEntry], None],
    ) -> None:
        self._on_local = on_local
        self._on_discrete = on_discrete
        self._on_hold_begin = on_hold_begin
        self._on_hold_end = on_hold_end

    def build(self, entry: ManifestEntry) -> WidgetBinding:
        if is_display_only(entry):
            return self._build_display(entry)

        if entry.widget == "input":
            return self._build_input(entry)

        if entry.widget == "select":
            return self._build_select(entry)

        if entry.widget == "toggle":
            return self._build_toggle(entry)

        if entry.widget == "button":
            return self._build_button(entry)

        if entry.widget == "xy":
            return self._build_xy(entry)

        return self._build_fader(entry)

    # --- 表示専用 ---------------------------------------------------------

    def _build_display(self, entry: ManifestEntry) -> WidgetBinding:
        with ui.card().classes("w-full q-pa-sm"):
            ui.label(entry.label).classes("text-caption text-grey-7")
            value_label = ui.label("-").classes("text-body1 break-all")

        def apply(values: tuple[Any, ...] | None) -> None:
            value_label.text = format_values(values)

        binding = WidgetBinding(entry=entry, apply=apply, is_display_only=True)
        return binding

    # --- 入力欄(確定時のみ送信) ------------------------------------------

    def _build_input(self, entry: ManifestEntry) -> WidgetBinding:
        binding_holder: dict[str, WidgetBinding] = {}
        confirmed_by_enter = {"value": False}
        # 直近の表示値(エコーバック / default / 確定送信)からユーザーが編集したか。
        # 未編集のまま blur しても同じ値を送り直さないための目印。
        edited = {"value": False}

        with ui.card().classes("w-full q-pa-sm"):
            input_box = ui.input(entry.label, value=_input_default(entry))
            if entry.type in ("i", "f"):
                input_box.props("type=number")
            input_box.classes("w-full")

        def set_error(message: str | None) -> None:
            if message is None:
                input_box.props(remove="error error-message")
                return
            input_box.props(f"error error-message={json.dumps(message, ensure_ascii=False)}")

        def begin_hold() -> None:
            binding_holder["binding"].is_editing = True
            self._on_hold_begin(entry)

        def end_hold() -> None:
            binding_holder["binding"].is_editing = False
            self._on_hold_end(entry)

        def confirm(_event: Any, *, from_blur: bool = False) -> bool:
            result = validate_input_confirmation(entry, _input_value(input_box, entry))
            if result.values is None:
                set_error(result.error or "入力値を確定できません")
                if from_blur:
                    binding = binding_holder["binding"]
                    # 拒否した値は送信していないためエコーバックを待たず、
                    # 直近の Unity 値へ戻す。次回同期でも再適用できるようにする。
                    binding.apply(binding.current_values)
                    binding.request_reapply()
                    end_hold()
                    ui.notify("形式不正のため送信しませんでした", type="negative")
                return False
            set_error(None)
            edited["value"] = False
            self._on_discrete(entry, result.values)
            end_hold()
            return True

        def on_enter(event: Any) -> None:
            # 確定できたときだけ blur 側の二重送信を抑止する。拒否されたときは
            # 何も送っていないので、blur 側の復元とホールド解除を走らせる。
            confirmed_by_enter["value"] = confirm(event)

        def on_focus(_event: Any) -> None:
            confirmed_by_enter["value"] = False
            # フォーカスした時点から編集中とみなす。最初の 1 文字を打つ前に届いた
            # エコーバックで、これから編集する内容を書き換えられないようにする。
            begin_hold()

        def on_blur(event: Any) -> None:
            # ブラウザによっては Enter の後に blur も発火するため、同じ
            # 確定を二重送信しない。次の focus で通常状態へ戻す。
            if confirmed_by_enter["value"]:
                confirmed_by_enter["value"] = False
                return
            if not edited["value"]:
                # 入力欄を通り抜けただけ(Tab 移動・クリックして離れた)。同じ値を
                # 送り直さず、フォーカス時に始めたホールドだけ解除する。
                set_error(None)
                end_hold()
                return
            confirm(event, from_blur=True)

        input_box.on("keydown.enter", on_enter)
        input_box.on("blur", on_blur)
        input_box.on("focus", on_focus)

        def on_value_change(_event: Any) -> None:
            binding = binding_holder["binding"]
            # エコーバックや初期値の反映など、プログラム的な設定では
            # 編集中保護を開始しない。ユーザーの編集ごとに begin_hold
            # を呼ぶことで、入力欄のホールド期限も延長する。
            if binding._applying:
                return
            # Enter 確定のあとに続けて編集した場合、その次の blur は新しい確定。
            # ここで抑止フラグを戻さないと blur が素通りしてホールドも残る。
            confirmed_by_enter["value"] = False
            edited["value"] = True
            begin_hold()

        input_box.on_value_change(on_value_change)

        def apply(values: tuple[Any, ...] | None) -> None:
            binding = binding_holder["binding"]
            binding.current_values = values
            set_error(None)
            edited["value"] = False
            value = _input_display_value(values, entry)
            if value is None:
                return

            binding._applying = True
            try:
                input_box.value = value
            finally:
                binding._applying = False

        binding = WidgetBinding(entry=entry, apply=apply, is_display_only=False)
        binding_holder["binding"] = binding
        return binding

    # --- select ----------------------------------------------------------------

    def _build_select(self, entry: ManifestEntry) -> WidgetBinding:
        """Build a dropdown from the parser's already-resolved options."""
        binding_holder: dict[str, WidgetBinding] = {}
        options = list(entry.options or ())
        default = _select_default(entry)

        with ui.card().classes("w-full q-pa-sm"):
            select = ui.select(
                options=options,
                label=entry.label,
                value=default if default in options else None,
            ).classes("w-full")

            # QSelect values must remain in the option list. Keep an initial
            # out-of-list default visible via display-value instead.
            if default is not None and default not in options:
                select.props(f"display-value={json.dumps(default, ensure_ascii=False)}")

            if not options:
                select.disable()
                ui.label("選択肢なし").classes("text-caption text-grey-7")

        def on_change(event: Any) -> None:
            binding = binding_holder["binding"]
            if binding._applying:
                return

            value = event.value
            if isinstance(value, str):
                self._on_discrete(entry, (value,))

        select.on_value_change(on_change)

        def apply(values: tuple[Any, ...] | None) -> None:
            binding = binding_holder["binding"]
            binding.current_values = values
            if not values or not isinstance(values[0], str):
                return

            value = values[0]
            binding._applying = True
            try:
                if value in options:
                    select.props(remove="display-value")
                    select.value = value
                else:
                    select.value = None
                    # json.dumps safely preserves quotes and newlines.
                    select.props(f"display-value={json.dumps(value, ensure_ascii=False)}")
            finally:
                binding._applying = False

        binding = WidgetBinding(entry=entry, apply=apply, is_display_only=False)
        binding_holder["binding"] = binding
        return binding

    # --- フェーダー -------------------------------------------------------

    def _build_fader(self, entry: ManifestEntry) -> WidgetBinding:
        low, high = entry.value_range or (0.0, 1.0)
        # bool は OSC タグ i(0/1)で送るため(D-017)、i と同様に整数ステップで扱う。
        # 小数のまま i タグを付けるとブリッジの int32 検証で拒否される
        step = 1 if entry.type in ("i", "bool") else _fader_step(low, high)
        binding_holder: dict[str, WidgetBinding] = {}

        with ui.card().classes("w-full q-pa-sm"):
            with ui.row().classes("w-full items-center justify-between no-wrap"):
                ui.label(entry.label).classes("text-caption text-grey-7")
                value_label = ui.label("-").classes("text-caption text-grey-8")

            slider = ui.slider(min=low, max=high, step=step, value=low).classes("w-full")

        def on_change(event: Any) -> None:
            binding = binding_holder["binding"]
            if binding._applying:
                return

            value = round(float(event.value)) if entry.type in ("i", "bool") else float(event.value)
            self._on_local(entry, (value,))

        slider.on_value_change(on_change)
        self._attach_hold(slider, entry)

        def apply(values: tuple[Any, ...] | None) -> None:
            binding = binding_holder["binding"]
            value_label.text = format_values(values)
            number = _as_number(values)

            if number is None:
                return

            binding._applying = True
            try:
                slider.value = entry.clamp(number)
            finally:
                binding._applying = False

        binding = WidgetBinding(entry=entry, apply=apply, is_display_only=False)
        binding_holder["binding"] = binding
        return binding

    # --- トグル -----------------------------------------------------------

    def _build_toggle(self, entry: ManifestEntry) -> WidgetBinding:
        binding_holder: dict[str, WidgetBinding] = {}

        with ui.card().classes("w-full q-pa-sm"):
            switch = ui.switch(entry.label, value=False)

        def on_change(event: Any) -> None:
            binding = binding_holder["binding"]
            if binding._applying:
                return

            self._on_discrete(entry, (1 if event.value else 0,))

        switch.on_value_change(on_change)

        def apply(values: tuple[Any, ...] | None) -> None:
            binding = binding_holder["binding"]
            state = _as_bool(values)

            if state is None:
                return

            binding._applying = True
            try:
                switch.value = state
            finally:
                binding._applying = False

        binding = WidgetBinding(entry=entry, apply=apply, is_display_only=False)
        binding_holder["binding"] = binding
        return binding

    # --- ボタン(押している間 on) ----------------------------------------

    def _build_button(self, entry: ManifestEntry) -> WidgetBinding:
        on_value, off_value = _button_values(entry)
        pressed: dict[str, bool] = {"value": False}

        with ui.card().classes("w-full q-pa-sm"):
            button = ui.button(entry.label).classes("w-full").style("touch-action:none")
            state_label = ui.label("-").classes("text-caption text-grey-8")

        def press(_event: Any) -> None:
            pressed["value"] = True
            self._on_discrete(entry, (on_value,))

        def release(_event: Any) -> None:
            # 押していないのに離脱イベントで off を送らない。
            if not pressed["value"]:
                return

            pressed["value"] = False
            self._on_discrete(entry, (off_value,))

        button.on("pointerdown", press)

        for event_name in ("pointerup", "pointercancel", "pointerleave"):
            button.on(event_name, release)

        def apply(values: tuple[Any, ...] | None) -> None:
            state_label.text = format_values(values)

        binding = WidgetBinding(entry=entry, apply=apply, is_display_only=False)
        return binding

    # --- XY パッド --------------------------------------------------------

    def _build_xy(self, entry: ManifestEntry) -> WidgetBinding:
        low, high = entry.value_range or (0.0, 1.0)
        span = high - low or 1.0
        pressed: dict[str, bool] = {"value": False}

        with ui.card().classes("w-full q-pa-sm"):
            with ui.row().classes("w-full items-center justify-between no-wrap"):
                ui.label(entry.label).classes("text-caption text-grey-7")
                value_label = ui.label("-").classes("text-caption text-grey-8")

            pad = (
                ui.element("div")
                .classes("relative bg-grey-3 rounded-borders")
                .style(
                    f"width:{XY_PAD_SIZE_PX}px;height:{XY_PAD_SIZE_PX}px;"
                    "touch-action:none;max-width:100%"
                )
            )

            with pad:
                marker = (
                    ui.element("div")
                    .classes("absolute bg-primary rounded-full")
                    .style(
                        f"width:{XY_MARKER_SIZE_PX}px;height:{XY_MARKER_SIZE_PX}px;"
                        f"margin-left:-{XY_MARKER_SIZE_PX // 2}px;margin-top:-{XY_MARKER_SIZE_PX // 2}px;"
                        "left:0;top:0;pointer-events:none"
                    )
                )

        def to_value(offset: float) -> float:
            ratio = min(max(offset / XY_PAD_SIZE_PX, 0.0), 1.0)
            return low + ratio * span

        def handle(event: Any, *, is_down: bool) -> None:
            args = event.args or {}
            offset_x = args.get("offsetX")
            offset_y = args.get("offsetY")

            if offset_x is None or offset_y is None:
                return

            if is_down:
                pressed["value"] = True
                self._on_hold_begin(entry)
            elif not pressed["value"]:
                return

            # 画面の上が Y の最大になるよう反転する(コントロールサーフェスの慣習)。
            x = to_value(float(offset_x))
            y = to_value(float(XY_PAD_SIZE_PX - float(offset_y)))

            # type "i" / "bool" のエントリは整数へ丸めてから送る。小数のまま i タグを
            # 付けるとブリッジの WireArgSchema(int32 のみ受理)で拒否され Unity へ届かない
            if entry.type in ("i", "bool"):
                self._on_local(entry, (round(x), round(y)))
            else:
                self._on_local(entry, (x, y))

        def release(_event: Any) -> None:
            if not pressed["value"]:
                return

            pressed["value"] = False
            self._on_hold_end(entry)

        pad.on("pointerdown", lambda event: handle(event, is_down=True), args=["offsetX", "offsetY"])
        pad.on(
            "pointermove",
            lambda event: handle(event, is_down=False),
            args=["offsetX", "offsetY"],
            throttle=0.03,
        )

        for event_name in ("pointerup", "pointercancel", "pointerleave"):
            pad.on(event_name, release)

        def apply(values: tuple[Any, ...] | None) -> None:
            value_label.text = format_values(values)

            if values is None or len(values) < 2:
                return

            x, y = _as_number((values[0],)), _as_number((values[1],))

            if x is None or y is None:
                return

            left = (min(max(x, low), high) - low) / span * XY_PAD_SIZE_PX
            top = XY_PAD_SIZE_PX - (min(max(y, low), high) - low) / span * XY_PAD_SIZE_PX
            marker.style(f"left:{left:.1f}px;top:{top:.1f}px")

        return WidgetBinding(entry=entry, apply=apply, is_display_only=False)

    # --- 共通 -------------------------------------------------------------

    def _attach_hold(self, element: Any, entry: ManifestEntry) -> None:
        element.on("pointerdown", lambda _: self._on_hold_begin(entry))

        for event_name in ("pointerup", "pointercancel", "pointerleave"):
            element.on(event_name, lambda _: self._on_hold_end(entry))


def is_display_only(entry: ManifestEntry) -> bool:
    """表示専用として扱うべきエントリか。

    text ウィジェットに加え、送信できない値型(文字列 / blob)を割り当てられた
    操作系ウィジェットも表示専用に落とす。誤った型の OSC を Unity に投げるより
    表示だけに留めるほうが安全。
    """
    if entry.is_display_only:
        return True

    if entry.widget == "input":
        return entry.type not in ("s", "i", "f")

    if entry.widget == "select":
        return entry.type != "s"

    return entry.type not in INTERACTIVE_VALUE_TYPES


def _input_default(entry: ManifestEntry) -> Any:
    if not entry.has_default:
        return "" if entry.type == "s" else None
    return entry.default


def _select_default(entry: ManifestEntry) -> str | None:
    if entry.has_default and isinstance(entry.default, str):
        return entry.default
    return None


def _input_display_value(values: tuple[Any, ...] | None, entry: ManifestEntry) -> Any:
    if not values:
        return None
    value = values[0]
    if entry.type == "s":
        return value if isinstance(value, str) else str(value)
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _input_value(input_box: Any, entry: ManifestEntry) -> Any:
    value = input_box.value
    if entry.type == "s":
        return value if isinstance(value, str) else str(value)
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value
    try:
        return float(value)
    except (TypeError, ValueError):
        return value


def format_values(values: tuple[Any, ...] | None) -> str:
    if values is None:
        return "-"

    return ", ".join(_format_value(value) for value in values)


def _format_value(value: Any) -> str:
    if isinstance(value, bool):
        return "on" if value else "off"

    if isinstance(value, float):
        return f"{value:.3f}".rstrip("0").rstrip(".")

    if isinstance(value, (bytes, bytearray)):
        return f"blob:{len(value)}"

    return str(value)


def _fader_step(low: float, high: float) -> float:
    span = abs(high - low)

    if span == 0:
        return 0.01

    return span / 1000.0


def _as_number(values: tuple[Any, ...] | None) -> float | None:
    if not values:
        return None

    value = values[0]

    if isinstance(value, bool):
        return 1.0 if value else 0.0

    if isinstance(value, (int, float)):
        return float(value)

    return None


def _as_bool(values: tuple[Any, ...] | None) -> bool | None:
    number = _as_number(values)

    if number is None:
        return None

    return number != 0


def _button_values(entry: ManifestEntry) -> tuple[Any, Any]:
    """押下時 / 解放時に送る値。widget-catalog.ts の on: 1 / off: 0 に合わせる。"""
    if entry.type == "f":
        return (1.0, 0.0)

    return (1, 0)
