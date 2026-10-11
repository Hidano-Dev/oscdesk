"""サーフェス定義の部品(ControlSpec)から NiceGUI のウィジェットを組み立てる。

案件差分はコードでなくデータ(サーフェス定義)で表現する規律に従い、
ここには「型 × ウィジェット種別 → 部品」の対応だけを置く。
"""

from __future__ import annotations

from dataclasses import dataclass, field
import json
from typing import Any, Callable

from nicegui import ui

from .entry_rules import validate_input_confirmation
from .surface_model import ControlSpec

# ポインタ操作の解放イベントを取りこぼしても、いつまでもエコーバックを
# 無視し続けないための保険。
HOLD_TIMEOUT_S = 2.0


@dataclass
class WidgetBinding:
    """1 エントリ分の UI 部品と、表示更新のための状態。"""

    entry: ControlSpec
    apply: Callable[[tuple[Any, ...] | None], None]
    revision: int = -1
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
        on_local: Callable[[ControlSpec, tuple[Any, ...]], None],
        on_discrete: Callable[[ControlSpec, tuple[Any, ...]], None],
        on_trigger_press: Callable[[ControlSpec], None],
        on_draft: Callable[[ControlSpec, Any], None],
        on_hold_begin: Callable[[ControlSpec], None],
        on_hold_end: Callable[[ControlSpec], None],
    ) -> None:
        self._on_local = on_local
        self._on_discrete = on_discrete
        self._on_trigger_press = on_trigger_press
        self._on_draft = on_draft
        self._on_hold_begin = on_hold_begin
        self._on_hold_end = on_hold_end

    def build(self, entry: ControlSpec) -> WidgetBinding:
        if entry.widget == "input":
            return self._build_input(entry)

        if entry.widget == "select":
            return self._build_select(entry)

        if entry.widget == "switch":
            return self._build_switch(entry)

        if entry.widget == "button":
            return self._build_button(entry)

        return self._build_slider(entry)

    # --- 入力欄(確定時のみ送信) ------------------------------------------

    def _build_input(self, entry: ControlSpec) -> WidgetBinding:
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
            self._on_draft(entry, _input_value(input_box, entry))

        input_box.on_value_change(on_value_change)

        def apply(values: tuple[Any, ...] | None) -> None:
            binding = binding_holder["binding"]
            binding.current_values = values
            set_error(None)
            edited["value"] = False
            if values is None:
                # 値なし(再採用で default が供給されなかった等)。旧値を残すと
                # 「見えている値が適用される」前提が崩れるため欄を空にする
                value: Any = "" if entry.type == "s" else None
            else:
                value = _input_display_value(values, entry)
                if value is None:
                    return

            binding._applying = True
            try:
                input_box.value = value
            finally:
                binding._applying = False

        binding = WidgetBinding(entry=entry, apply=apply)
        binding_holder["binding"] = binding
        return binding

    # --- select ----------------------------------------------------------------

    def _build_select(self, entry: ControlSpec) -> WidgetBinding:
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
            if values is None:
                # 値なし。選択とリスト外表示の両方を消す
                binding._applying = True
                try:
                    select.props(remove="display-value")
                    select.value = None
                finally:
                    binding._applying = False
                return
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

        binding = WidgetBinding(entry=entry, apply=apply)
        binding_holder["binding"] = binding
        return binding

    # --- スライダー -------------------------------------------------------

    def _build_slider(self, entry: ControlSpec) -> WidgetBinding:
        low, high = entry.value_range or (0.0, 1.0)
        # 定義の step を優先する。i は小数のまま i タグを付けるとブリッジの int32 検証で
        # 拒否されるため、step 省略時は 1 にする
        if entry.step is not None:
            step = entry.step
        else:
            step = 1 if entry.type == "i" else _fader_step(low, high)
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

            value = round(float(event.value)) if entry.type == "i" else float(event.value)
            self._on_local(entry, (value,))

        slider.on_value_change(on_change)
        self._attach_hold(slider, entry)

        def apply(values: tuple[Any, ...] | None) -> None:
            binding = binding_holder["binding"]
            value_label.text = format_values(values)
            number = _as_number(values)

            if number is None:
                if values is not None:
                    return
                # 値なし。ラベルは "-" になるので、つまみは下限へ戻す
                number = low

            binding._applying = True
            try:
                slider.value = entry.clamp(number)
            finally:
                binding._applying = False

        binding = WidgetBinding(entry=entry, apply=apply)
        binding_holder["binding"] = binding
        return binding

    # --- スイッチ -----------------------------------------------------------

    def _build_switch(self, entry: ControlSpec) -> WidgetBinding:
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
                if values is not None:
                    return
                # 値なし。off 表示へ戻す
                state = False

            binding._applying = True
            try:
                switch.value = state
            finally:
                binding._applying = False

        binding = WidgetBinding(entry=entry, apply=apply)
        binding_holder["binding"] = binding
        return binding

    # --- ボタン(トリガ。押下で定義の値を 1 回送る) ------------------------

    def _build_button(self, entry: ControlSpec) -> WidgetBinding:
        with ui.card().classes("w-full q-pa-sm"):
            button = ui.button(entry.label).classes("w-full").style("touch-action:none")
            if not entry.standalone:
                # 単独では送らない定義。まとめ送り(HID-166)の部品としてのみ使える
                button.disable()

        button.on("pointerdown", lambda _event: self._on_trigger_press(entry))

        # トリガは値を保持・表示しない(D-043)。同期の対象にならない空の apply を持たせる
        return WidgetBinding(entry=entry, apply=lambda _values: None)

    # --- 共通 -------------------------------------------------------------

    def _attach_hold(self, element: Any, entry: ControlSpec) -> None:
        element.on("pointerdown", lambda _: self._on_hold_begin(entry))

        for event_name in ("pointerup", "pointercancel", "pointerleave"):
            element.on(event_name, lambda _: self._on_hold_end(entry))


def _input_default(entry: ControlSpec) -> Any:
    if not entry.has_default:
        return "" if entry.type == "s" else None
    return entry.default


def _select_default(entry: ControlSpec) -> str | None:
    if entry.has_default and isinstance(entry.default, str):
        return entry.default
    return None


def _input_display_value(values: tuple[Any, ...] | None, entry: ControlSpec) -> Any:
    if not values:
        return None
    value = values[0]
    if entry.type == "s":
        return value if isinstance(value, str) else str(value)
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _input_value(input_box: Any, entry: ControlSpec) -> Any:
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
