import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

// @ts-expect-error -- 型定義の無い .mjs(テストの入口の補助スクリプト)を直接読む
import { argumentError, changedPlan, formatSummary, isMainModule, lineFromStack, messageHead, summarizeVitest, typecheckErrors } from '../../scripts/run-tests.mjs'

const scriptsDir = path.resolve(__dirname, '../../scripts')

const root = path.resolve('/repo')
const testFile = path.join(root, 'packages', 'shared', 'src', 'value.test.ts')

describe('run-tests の要約 (HID-438)', () => {
  it('vitest の json から件数と、落ちた行・スタックを除いたメッセージを取る', () => {
    const summary = summarizeVitest({
      testResults: [{
        name: testFile,
        status: 'failed',
        message: '',
        assertionResults: [
          { status: 'passed', fullName: 'ok' },
          { status: 'skipped', fullName: 'later' },
          {
            status: 'failed',
            fullName: 'value > rejects',
            location: { line: 10, column: 3 },
            failureMessages: [`AssertionError: expected 1 to be 2\n- Expected\n+ Received\n\n    at ${testFile}:14:5\n    at runTest (node_modules/x.js:1:1)`],
          },
        ],
      }],
    }, root)
    expect(summary).toMatchObject({ passed: 1, failed: 1, skipped: 1 })
    expect(summary.failures).toEqual([{
      name: 'value > rejects',
      file: 'packages/shared/src/value.test.ts',
      line: 14,
      message: ['AssertionError: expected 1 to be 2', '- Expected', '+ Received'],
    }])
  })

  it('スタックに自分のファイルが無ければテストの宣言の行に戻る', () => {
    const summary = summarizeVitest({
      testResults: [{ name: testFile, status: 'failed', assertionResults: [{ status: 'failed', fullName: 't', location: { line: 7, column: 1 }, failureMessages: ['Error: boom'] }] }],
    }, root)
    expect(summary.failures[0].line).toBe(7)
  })

  it('読み込みに失敗したファイルを失敗 1 件として数える(数えないと「失敗 0 件」のまま NG になる)', () => {
    const summary = summarizeVitest({ testResults: [{ name: testFile, status: 'failed', message: 'Error: cannot import', assertionResults: [] }] }, root)
    expect(summary.failed).toBe(1)
    expect(summary.failures[0]).toMatchObject({ name: '(ファイル全体)', message: ['Error: cannot import'] })
  })

  it('メッセージからはスタックのフレームだけを除き、"at " で始まる本文は残す', () => {
    expect(messageHead('\u001b[31mError: a\u001b[39m\n\n  ❯ src/x.ts:1:1\n    at y (C:\\r\\a.ts:3:4)\nline2\nat least one row\n    at async run (node:internal/x:1:2)\n    at <anonymous>\nline4\nline5'))
      .toEqual(['Error: a', 'line2', 'at least one row', 'line4'])
    expect(messageHead('- Expected\n+ Received\n  at 3 places')).toEqual(['- Expected', '+ Received', '  at 3 places'])
  })

  it('補助の関数', () => {
    expect(lineFromStack('at C:\\repo\\value.test.ts:21:9', 'D:/other/value.test.ts')).toBe(21)
    expect(typecheckErrors('noise\npackages/shared typecheck: src/a.ts(3,7): error TS2322: bad\nDone')).toEqual(['packages/shared typecheck: src/a.ts(3,7): error TS2322: bad'])
  })

  it('test:changed は、モジュールでないファイルが変わったら unit を全部回し、そうでなければ関係するテストとガードを回す', () => {
    expect(changedPlan(['packages/bridge/src/adapters/ui-hub.ts'])).toEqual({ unit: 'changed', guards: true })
    expect(changedPlan(['tests/scripts/run-tests.test.ts'])).toEqual({ unit: 'changed', guards: true })
    // fs で読むデータ・git ls-files を走査するガード・設定は import の繋がりに出ない
    for (const file of ['protocol/wire-samples.json', 'launchers/start-oscdesk.ps1', 'docs/DEVELOPMENT.md', 'package.json', 'vitest.config.ts', 'oscdesk.overlays.json']) {
      expect(changedPlan([file]).unit, file).toBe('all')
      expect(changedPlan([file]).guards, file).toBe(false)
    }
    // Python の UI は撤去した(D-162)。.py はモジュールでないファイルとして unit を全部回す
    expect(changedPlan(['vp/tests/test_old.py']).unit).toBe('all')
  })

  it('追加の引数を受け取れないモードでは断る(黙って捨てると、絞ったつもりで別のものを回す)', () => {
    expect(argumentError('unit', ['a.test.ts'])).toBeUndefined()
    expect(argumentError('all', [])).toBeUndefined()
    expect(argumentError('all', ['-k', 'x'])).toMatch(/受け取りません/)
    expect(argumentError('fast', ['x'])).toMatch(/受け取りません/)
    expect(argumentError('changed', ['origin/main'])).toBeUndefined()
    expect(argumentError('changed', ['a', 'b'])).toMatch(/1 つ/)
  })

  it('ジャンクション・シンボリックリンク越しに起動しても main を走らせる', () => {
    const script = path.join(scriptsDir, 'run-tests.mjs')
    expect(isMainModule(script, pathToFileURL(script).href)).toBe(true)
    expect(isMainModule(path.join(scriptsDir, 'overlays.mjs'), pathToFileURL(script).href)).toBe(false)
    expect(isMainModule(undefined, pathToFileURL(script).href)).toBe(false)

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-run-tests-'))
    const link = path.join(dir, 'scripts')
    try {
      fs.symlinkSync(scriptsDir, link, process.platform === 'win32' ? 'junction' : 'dir')
      // 引数なしは使い方を出して 2 で終わる。main が走らなければ 0 で終わる
      const result = spawnSync(process.execPath, [path.join(link, 'run-tests.mjs')], { encoding: 'utf8' })
      expect(result.status).toBe(2)
      expect(result.stderr).toMatch(/使い方/)
    } finally {
      // 再帰の削除はリンクの先(scripts/ の実体)をたどり得るので、リンクだけを外してから空のフォルダを消す
      if (fs.existsSync(link)) {
        try {
          fs.unlinkSync(link)
        } catch {
          fs.rmdirSync(link)
        }
      }
      fs.rmdirSync(dir)
    }
  })

  it('要約は件数の行と、失敗ごとに場所・名前・メッセージだけを出す', () => {
    const lines = formatSummary([
      { label: 'typecheck', ok: false, notes: ['src/a.ts(1,1): error TS1: x'], logs: ['logs/test-results/typecheck.log'] },
      { label: 'unit', ok: false, counts: { passed: 5, failed: 1, skipped: 0 }, failures: [{ name: 'a > b', file: 'x.test.ts', line: 3, message: ['Error: e'] }], logs: ['logs/test-results/vitest-unit.json'] },
      { label: 'e2e', ok: true, counts: { passed: 2, failed: 0, skipped: 1 }, logs: ['logs/test-results/vitest-e2e.json'] },
    ], 1234)
    expect(lines).toEqual([
      'FAIL [unit] x.test.ts:3',
      '  a > b',
      '    Error: e',
      'FAIL [typecheck]',
      '    src/a.ts(1,1): error TS1: x',
      'NG: 通過 7 件、失敗 1 件、スキップ 1 件、失敗した段: typecheck(1.2s)',
      '全文: logs/test-results/typecheck.log logs/test-results/vitest-unit.json',
    ])
    expect(formatSummary([{ label: 'unit', ok: true, counts: { passed: 1, failed: 0, skipped: 0 } }], 10)).toEqual(['OK: 通過 1 件、失敗 0 件、スキップ 0 件(0.0s)'])
  })
})
