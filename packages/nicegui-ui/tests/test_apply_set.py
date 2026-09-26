from __future__ import annotations

from dataclasses import dataclass

from oscdesk_ui.apply_set import build_apply_set, resolve_apply_scope
from oscdesk_ui.manifest import Manifest, ManifestEntry


def entry(address: str, type_: str, widget: str, *, staged: bool = True, applies_to=None, default=None):
    return ManifestEntry(
        address=address,
        label=address,
        type=type_,
        widget=widget,
        staged=staged,
        applies_to=applies_to,
        default=default,
        has_default=default is not None,
    )


@dataclass
class Source:
    values: dict[str, tuple[object, ...] | None]
    holding: set[str]
    drafts: dict[str, object]

    def values_of(self, address):
        return self.values.get(address)

    def is_holding(self, address):
        return address in self.holding

    def draft_of(self, address):
        return (True, self.drafts[address]) if address in self.drafts else (False, None)


def test_resolve_scope_keeps_definition_order_and_filters_entries():
    trigger = entry("/member/all/update", "i", "button", applies_to=("/member/*/*",))
    manifest = Manifest(1, "test", (
        entry("/member/01/name", "s", "input"),
        trigger,
        entry("/member/01/enabled", "bool", "toggle"),
        entry("/member/02/name", "s", "input"),
        entry("/member/02/blob", "b", "text"),
        entry("/member/02/status", "s", "text"),
        entry("/member/all/enabled", "bool", "toggle", staged=False),
        entry("/member/02/other-update", "i", "button"),
        # xy は 2 引数。Unity のステージングは最初の引数しか記録しないため範囲に含めない
        entry("/member/02/position", "f", "xy"),
    ))

    assert [item.address for item in resolve_apply_scope(manifest, trigger)] == [
        "/member/01/name", "/member/01/enabled", "/member/02/name",
    ]


def test_build_apply_set_skips_cached_values_that_do_not_match_the_entry_type():
    """Unity は受信引数をそのままエコーするため、外部コントローラが型違いの値を送ると
    表示キャッシュに型違いの値が残る。例外で落とさず type-mismatch として除外する。"""
    trigger = entry("/member/all/update", "i", "button", applies_to=("/member/*/*",))
    targets = (
        entry("/member/01/gain", "f", "fader"),
        entry("/member/01/count", "i", "input"),
        entry("/member/01/name", "s", "input"),
        entry("/member/01/level", "i", "fader"),
        entry("/member/01/enabled", "bool", "toggle"),
        entry("/member/02/gain", "f", "fader"),
        entry("/member/02/level", "i", "fader"),
        entry("/member/02/enabled", "bool", "toggle"),
        entry("/member/03/enabled", "bool", "toggle"),
        entry("/member/03/level", "i", "fader"),
    )
    plan = build_apply_set(
        trigger,
        targets,
        Source(
            {
                "/member/01/gain": ("loud",),
                "/member/01/count": ("3",),
                "/member/01/name": (7,),
                # i / bool エントリに小数の f エコーが入った場合は切り捨てずに除外する
                "/member/01/level": (1.9,),
                "/member/01/enabled": (0.5,),
                "/member/02/gain": (0.5,),
                # 整数値の f エコー(1.0)は i として送れる
                "/member/02/level": (1.0,),
                # bool は 0 / 1 の領域へ正規化する(toggle の表示は非ゼロ = on)
                "/member/02/enabled": (2,),
                "/member/03/enabled": (-1.0,),
                # int32 範囲外は 1 件だけ除外する(送るとブリッジがバッチ全体を拒否する)
                "/member/03/level": (2147483648.0,),
            },
            set(),
            {},
        ),
    )

    assert [message.address for message in plan.messages] == [
        "/member/02/gain", "/member/02/level", "/member/02/enabled", "/member/03/enabled", "/member/all/update",
    ]
    assert [(arg.type, arg.value) for arg in plan.messages[1].args] == [("i", 1)]
    assert [(arg.type, arg.value) for arg in plan.messages[2].args] == [("i", 1)]
    assert [(arg.type, arg.value) for arg in plan.messages[3].args] == [("i", 1)]
    assert [(item.address, item.reason) for item in plan.skipped] == [
        ("/member/01/gain", "type-mismatch"),
        ("/member/01/count", "type-mismatch"),
        ("/member/01/name", "type-mismatch"),
        ("/member/01/level", "type-mismatch"),
        ("/member/01/enabled", "type-mismatch"),
        ("/member/03/level", "type-mismatch"),
    ]
    assert all(item.detail for item in plan.skipped)


def test_build_apply_set_uses_drafts_skips_invalid_and_normalizes_bool_defaults():
    trigger = entry("/member/all/update", "i", "button", applies_to=("/member/*/*",))
    targets = (
        entry("/member/01/name", "s", "input"),
        entry("/member/01/enabled", "bool", "toggle"),
        entry("/member/02/enabled", "bool", "toggle"),
        entry("/member/03/name", "s", "input"),
    )
    source = Source(
        values={
            "/member/01/name": ("edited",),
            "/member/01/enabled": (False,),
            "/member/02/enabled": (True,),
            "/member/03/name": None,
        },
        holding={"/member/01/name", "/member/03/name"},
        drafts={"/member/01/name": "draft"},
    )

    plan = build_apply_set(trigger, targets, source)

    assert [message.address for message in plan.messages] == [
        "/member/01/name", "/member/01/enabled", "/member/02/enabled", "/member/all/update",
    ]
    assert [(arg.type, arg.value) for arg in plan.messages[1].args] == [("i", 0)]
    assert [(arg.type, arg.value) for arg in plan.messages[2].args] == [("i", 1)]
    assert all(not isinstance(arg.value, bool) for message in plan.messages for arg in message.args)
    assert plan.skipped[0].address == "/member/03/name"
    assert plan.skipped[0].reason == "no-value"


def test_invalid_holding_draft_is_skipped():
    trigger = entry("/apply", "i", "button", applies_to=("/input",))
    target = entry("/input", "i", "input")
    plan = build_apply_set(trigger, (target,), Source({"/input": (1,)}, {"/input"}, {"/input": "bad"}))

    assert plan.value_count == 0
    assert plan.skipped[0].reason == "invalid-draft"
