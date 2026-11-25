"""フォークのオーバーレイ(D-132)の Python のテストの見本。

tests/scripts/overlays.test.ts が OSCDESK_OVERLAYS でこのディレクトリを指して scripts/run-python-tests.mjs を実行し、
UI のテストの補助(tests.surface_fixtures)と fixture(run_task・nicegui の user)がここから使えることを確かめる。
"""

from __future__ import annotations

import asyncio

from tests.surface_fixtures import definition, param

from oscdesk_ui.surface_definition import split_bindings


async def test_overlay_sample_uses_ui_fixtures(run_task) -> None:
    done = asyncio.Event()

    async def finish() -> None:
        done.set()

    run_task(finish())
    await asyncio.wait_for(done.wait(), timeout=5)

    body, _bindings = split_bindings(definition([param("gain", "/mixer/gain", "f", range=[0, 1])]))
    assert body["parameters"][0]["id"] == "gain"


def test_overlay_sample_sees_nicegui_user_plugin(request) -> None:
    # nicegui の user fixture のプラグインが、conftest.py の外のテストにも読まれている
    assert request.config.pluginmanager.has_plugin("nicegui.testing.user_plugin")
