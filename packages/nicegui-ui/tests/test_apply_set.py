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
    ))

    assert [item.address for item in resolve_apply_scope(manifest, trigger)] == [
        "/member/01/name", "/member/01/enabled", "/member/02/name",
    ]


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
