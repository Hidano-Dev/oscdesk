from __future__ import annotations


# fixture の本体は oscdesk_plugin に置く。pytest を packages/nicegui-ui で直接実行したときもここから読む
# (scripts/run-python-tests.mjs は -p で先に読むので、二重には登録されない。D-132)
pytest_plugins = ("tests.oscdesk_plugin",)
