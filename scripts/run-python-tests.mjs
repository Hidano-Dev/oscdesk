import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { pytestArgs, pytestEnv, resolveOverlays } from './overlays.mjs'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const uiRoot = join(repositoryRoot, 'packages', 'nicegui-ui')
const pythonCandidates = process.platform === 'win32'
  ? [join(uiRoot, '.venv', 'Scripts', 'python.exe'), join(uiRoot, '.venv', 'bin', 'python')]
  : [join(uiRoot, '.venv', 'bin', 'python'), join(uiRoot, '.venv', 'Scripts', 'python.exe')]
const python = pythonCandidates.find((candidate) => existsSync(candidate))

// フォークのオーバーレイ(oscdesk.overlays.json)の tests/ も同じ pytest の実行に含める(D-132)。
// 一覧の検査は仮想環境の確認より先に行う。後だと、仮想環境の無い PC では壊れた一覧を黙って見逃し、
// 仮想環境のある PC では生のスタックトレースで落ちる
let args
try {
  args = pytestArgs(repositoryRoot, resolveOverlays(repositoryRoot))
} catch (error) {
  console.error(`[ERROR] Python テストを始められません。理由: オーバーレイの設定に誤りがあります(oscdesk.overlays.json またはオーバーレイの tests/): ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

if (!python) {
  console.warn('[SKIP] Python テストをスキップしました。理由: 仮想環境が未作成です。対処: py -3 -m venv packages/nicegui-ui/.venv && packages/nicegui-ui/.venv/Scripts/python -m pip install -e "packages/nicegui-ui[dev]"')
  process.exit(0)
}

const result = spawnSync(python, [...args, ...process.argv.slice(2)], {
  cwd: repositoryRoot,
  env: pytestEnv(repositoryRoot),
  stdio: 'inherit',
})

if (result.error) {
  console.error(`Python テストの起動に失敗しました: ${result.error.message}`)
  process.exit(1)
}

process.exit(result.status ?? 1)
