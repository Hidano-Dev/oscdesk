import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// ランチャーの後始末(launchers/lib/launcher-guard.ps1)を PowerShell で実際に動かして確かめる(D-135)。
// 孤立プロセスの回収がチェックアウトの外(別の worktree など)へ及ぶと、そちらで動いているブリッジや UI を止めてしまう

const guardScript = path.resolve(__dirname, '../../launchers/lib/launcher-guard.ps1')
const isWindows = process.platform === 'win32'

const runPowerShell = (script: string): string => {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    encoding: 'utf8',
    timeout: 60000,
  })
  if (result.status !== 0) {
    throw new Error(`powershell exited ${result.status}: ${result.stderr}\n${result.stdout}`)
  }
  return result.stdout
}

// PowerShell の単一引用符の文字列にする
const quote = (value: string): string => `'${value.replaceAll("'", "''")}'`

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const waitUntil = async (condition: () => boolean, timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return condition()
}

describe.skipIf(!isWindows)('launcher-guard.ps1 (D-135)', () => {
  it('Test-LauncherProcessInRoot は同じ root の packages\\ の下だけを当てる', () => {
    const root = 'C:\\Work\\oscdesk'
    const cases: Array<{ commandLine: string; executablePath: string; root: string; expected: boolean }> = [
      // ブリッジ: node <root>\packages\bridge\dist\oscdesk-bridge.js
      { commandLine: `"node.exe" C:\\Work\\oscdesk\\packages\\bridge\\dist\\oscdesk-bridge.js --config x`, executablePath: 'C:\\Program Files\\nodejs\\node.exe', root, expected: true },
      // UI: venv の python。本体の python はコマンドラインに venv のパスを持つ
      { commandLine: `"C:\\Work\\oscdesk\\packages\\nicegui-ui\\.venv\\Scripts\\python.exe" -m oscdesk_ui --ui-port 8080`, executablePath: 'C:\\Python313\\python.exe', root, expected: true },
      // コマンドラインに無くても実行ファイルが venv なら当てる
      { commandLine: 'python -m oscdesk_ui', executablePath: 'C:\\Work\\oscdesk\\packages\\nicegui-ui\\.venv\\Scripts\\python.exe', root, expected: true },
      // 区切りの向き・大文字小文字・末尾の区切りの違いは無視する
      { commandLine: 'node c:/work/OSCDESK/packages/mock-unity/dist/mock-unity.js', executablePath: '', root: 'C:\\Work\\oscdesk\\', expected: true },
      { commandLine: 'node C:\\Work\\oscdesk\\packages\\bridge\\dist\\oscdesk-bridge.js', executablePath: '', root: 'c:/work/oscdesk/', expected: true },
      // 別のチェックアウト
      { commandLine: 'node D:\\Other\\oscdesk\\packages\\bridge\\dist\\oscdesk-bridge.js', executablePath: '', root, expected: false },
      // 名前が root で始まる別のフォルダ
      { commandLine: 'node C:\\Work\\oscdesk-old\\packages\\bridge\\dist\\oscdesk-bridge.js', executablePath: '', root, expected: false },
      // root の下に置いた worktree
      { commandLine: 'node C:\\Work\\oscdesk\\.claude\\worktrees\\hid-1\\packages\\bridge\\dist\\oscdesk-bridge.js', executablePath: '', root, expected: false },
      // 相対パスで起動したもの(どのチェックアウトか分からないので止めない)
      { commandLine: 'node packages/bridge/dist/oscdesk-bridge.js', executablePath: 'C:\\Program Files\\nodejs\\node.exe', root, expected: false },
      { commandLine: '', executablePath: '', root, expected: false },
    ]
    const calls = cases.map((entry) =>
      `[string](Test-LauncherProcessInRoot -CommandLine ${quote(entry.commandLine)} -ExecutablePath ${quote(entry.executablePath)} -Root ${quote(entry.root)})`)
    const output = runPowerShell(`. ${quote(guardScript)}; ${calls.join('; ')}`)
    const actual = output.trim().split(/\r?\n/).map((line) => line.trim() === 'True')
    expect(actual).toEqual(cases.map((entry) => entry.expected))
  })

  describe('孤立プロセスと出力ファイルの片付け', () => {
    let workDir = ''
    const pids: number[] = []

    beforeAll(() => {
      workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-launcher-guard-'))
    })

    afterAll(() => {
      for (const pid of pids) {
        if (isAlive(pid)) spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'])
      }
      fs.rmSync(workDir, { recursive: true, force: true })
    })

    it('Stop-OrphanedLauncherProcesses は -Root のチェックアウトの孤立プロセスだけを止める', async () => {
      // 同じ名前のブリッジを 3 つのチェックアウトに置く: 回収する root、別の root、root の下の worktree
      const rootA = path.join(workDir, 'rootA')
      const roots = [rootA, path.join(workDir, 'rootB'), path.join(rootA, '.claude', 'worktrees', 'wt')]
      const scripts = roots.map((root) => {
        const script = path.join(root, 'packages', 'bridge', 'dist', 'oscdesk-bridge.js')
        fs.mkdirSync(path.dirname(script), { recursive: true })
        fs.writeFileSync(script, 'setInterval(() => {}, 1000)\n')
        return script
      })

      // 間の PowerShell が node を起動して終わるので、node は親の消えた孤立プロセスになる
      const starts = scripts.map((script) =>
        `(Start-Process -FilePath 'node.exe' -ArgumentList ${quote(`"${script}"`)} -WindowStyle Hidden -PassThru).Id`)
      const started = runPowerShell(starts.join('; ')).trim().split(/\r?\n/).map((line) => Number(line.trim()))
      pids.push(...started)
      expect(started).toHaveLength(3)
      expect(await waitUntil(() => started.every(isAlive), 5000)).toBe(true)

      runPowerShell(`. ${quote(guardScript)}; Stop-OrphanedLauncherProcesses -CommandLinePatterns @('oscdesk-bridge.js') -Root ${quote(rootA)}`)

      const [inRoot, otherRoot, worktree] = started
      expect(await waitUntil(() => !isAlive(inRoot), 5000)).toBe(true)
      expect(isAlive(otherRoot)).toBe(true)
      expect(isAlive(worktree)).toBe(true)
    }, 60000)

    it('Clear-LauncherOutputFiles は持ち主のランチャーが消えた出力ファイルだけを消す', () => {
      const root = path.join(workDir, 'rootC')
      const directory = path.join(root, 'logs', 'launcher')
      fs.mkdirSync(directory, { recursive: true })
      // Windows の PID は 4 の倍数なので、奇数の PID のプロセスは存在しない
      const stale = path.join(directory, '2147483647-bridge-stdout-deadbeef.log')
      const live = path.join(directory, `${process.pid}-bridge-stdout-cafebabe.log`)
      const other = path.join(directory, 'notes.txt')
      for (const file of [stale, live, other]) fs.writeFileSync(file, 'x')

      const created = runPowerShell(`. ${quote(guardScript)}; Clear-LauncherOutputFiles -Root ${quote(root)}; New-LauncherOutputFile -Name 'ui-stdout' -Root ${quote(root)}`).trim()

      expect(fs.existsSync(stale)).toBe(false)
      expect(fs.existsSync(live)).toBe(true)
      expect(fs.existsSync(other)).toBe(true)
      expect(path.dirname(created)).toBe(directory)
      expect(path.basename(created)).toMatch(/^\d+-ui-stdout-[0-9a-f]{8}\.log$/)
      expect(fs.existsSync(created)).toBe(true)
    }, 60000)
  })
})
