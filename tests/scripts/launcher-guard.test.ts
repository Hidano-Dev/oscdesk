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
    // 片付けで止めるかもしれない、このテストが起動した孤立プロセス。止まったと確かめたものは外す
    const expectedAlive = new Set<number>()

    beforeAll(() => {
      workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-launcher-guard-'))
    })

    afterAll(() => {
      // PID が再利用されて無関係なプロセスを止めないよう、コマンドラインがまだ workDir を指すものだけを止める
      for (const pid of expectedAlive) {
        if (!isAlive(pid)) continue
        const commandLine = runPowerShell(`[string](Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CommandLine`).trim()
        if (commandLine.toLowerCase().includes(workDir.toLowerCase())) {
          spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'])
        }
      }
      fs.rmSync(workDir, { recursive: true, force: true })
    })

    const makeBridge = (root: string): string => {
      const script = path.join(root, 'packages', 'bridge', 'dist', 'oscdesk-bridge.js')
      fs.mkdirSync(path.dirname(script), { recursive: true })
      fs.writeFileSync(script, 'setInterval(() => {}, 1000)\n')
      return script
    }

    // 間の PowerShell が node を起動して終わるので、node は親の消えた孤立プロセスになる
    const startOrphans = async (scripts: string[]): Promise<number[]> => {
      const starts = scripts.map((script) =>
        `(Start-Process -FilePath 'node.exe' -ArgumentList ${quote(`"${script}"`)} -WindowStyle Hidden -PassThru).Id`)
      const started = runPowerShell(starts.join('; ')).trim().split(/\r?\n/).map((line) => Number(line.trim()))
      for (const pid of started) expectedAlive.add(pid)
      expect(started).toHaveLength(scripts.length)
      expect(await waitUntil(() => started.every(isAlive), 5000)).toBe(true)
      return started
    }

    const stopOrphans = (root: string): string =>
      runPowerShell(`. ${quote(guardScript)}; Stop-OrphanedLauncherProcesses -CommandLinePatterns @('oscdesk-bridge.js') -Root ${quote(root)}`)

    it('Stop-OrphanedLauncherProcesses は -Root のチェックアウトの孤立プロセスだけを止め、残したものを知らせる', async () => {
      // 同じ名前のブリッジを 3 つのチェックアウトに置く: 回収する root、別の root、root の下の worktree
      const rootA = path.join(workDir, 'rootA')
      const roots = [rootA, path.join(workDir, 'rootB'), path.join(rootA, '.claude', 'worktrees', 'wt')]
      const [inRoot, otherRoot, worktree] = await startOrphans(roots.map(makeBridge))

      const output = stopOrphans(rootA)

      expect(await waitUntil(() => !isAlive(inRoot), 5000)).toBe(true)
      expectedAlive.delete(inRoot)
      expect(isAlive(otherRoot)).toBe(true)
      expect(isAlive(worktree)).toBe(true)
      // bind に失敗したときに探せるよう、止めなかった孤立プロセスを PID 付きで出す
      expect(output).toContain(`PID ${otherRoot}:`)
      expect(output).toContain(`PID ${worktree}:`)
    }, 60000)

    it('ジャンクション越しの root でも、実体のパスで起動した孤立プロセスを当てる', async () => {
      const realRoot = path.join(workDir, 'realRoot')
      const [orphan] = await startOrphans([makeBridge(realRoot)])
      const link = path.join(workDir, 'linkRoot')
      fs.symlinkSync(realRoot, link, 'junction')

      const spellings = runPowerShell(`. ${quote(guardScript)}; Get-LauncherRootSpellings -Root ${quote(link)}`)
      expect(spellings.toLowerCase()).toContain(realRoot.toLowerCase())

      stopOrphans(link)
      expect(await waitUntil(() => !isAlive(orphan), 5000)).toBe(true)
      expectedAlive.delete(orphan)
    }, 60000)

    it('root が空なら関数名を付けて断る', () => {
      const output = runPowerShell(`. ${quote(guardScript)}; try { Get-LauncherOutputDirectory -Root '' } catch { $_.Exception.Message }`)
      expect(output).toContain('Get-LauncherOutputDirectory:')
    }, 60000)

    it('logs\\launcher を作れなければ %TEMP%\\oscdesk-launcher に同じ名前の付け方で作り、片付けもそこを見る', () => {
      const root = path.join(workDir, 'readonlyRoot')
      fs.mkdirSync(root, { recursive: true })
      // logs をファイルにしておくと logs\launcher を作れない
      fs.writeFileSync(path.join(root, 'logs'), 'x')
      const fallback = path.join(os.tmpdir(), 'oscdesk-launcher')
      fs.mkdirSync(fallback, { recursive: true })
      const stale = path.join(fallback, '2147483647-launcher-guard-test-deadbeef.log')
      fs.writeFileSync(stale, 'x')

      const output = runPowerShell(`. ${quote(guardScript)}; Clear-LauncherOutputFiles -Root ${quote(root)}; New-LauncherOutputFile -Name 'bridge-stdout' -Root ${quote(root)}`)
      const created = output.trim().split(/\r?\n/).at(-1)?.trim() ?? ''
      try {
        expect(fs.existsSync(stale)).toBe(false)
        expect(path.dirname(created).toLowerCase()).toBe(fallback.toLowerCase())
        expect(path.basename(created)).toMatch(/^\d+-bridge-stdout-[0-9a-f]{8}\.log$/)
        expect(fs.existsSync(created)).toBe(true)
      } finally {
        fs.rmSync(created, { force: true })
      }
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
