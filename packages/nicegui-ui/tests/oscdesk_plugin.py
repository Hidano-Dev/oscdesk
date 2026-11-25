"""UI のテストで共通に使う fixture とプラグイン。

conftest.py に置いた fixture はその下のテストにしか効かない。フォークのオーバーレイ(D-132)の
テストはリポジトリ直下の別のディレクトリにあるので、scripts/run-python-tests.mjs が
`-p tests.oscdesk_plugin` でこのモジュールをプラグインとして読み、どのテストからも使えるようにする。
"""

from __future__ import annotations

import asyncio

import pytest


pytest_plugins = ("nicegui.testing.user_plugin",)


@pytest.fixture
def run_task():
    """テスト中だけ走らせるバックグラウンドタスクの後始末をまとめる。"""
    tasks: list[asyncio.Task] = []

    def start(coro) -> asyncio.Task:
        task = asyncio.get_running_loop().create_task(coro)
        tasks.append(task)
        return task

    yield start

    for task in tasks:
        task.cancel()
