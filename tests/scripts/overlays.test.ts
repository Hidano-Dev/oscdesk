import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// @ts-expect-error -- 型定義の無い .mjs(vitest.config.ts とガードテストが使う補助)を直接読む
import { overlayPythonTests, overlayVitestIncludes, resolveOverlays } from '../../scripts/overlays.mjs'

const repositoryRoot = path.resolve(__dirname, '../..')
const SAMPLE = 'tests/fixtures/overlay-sample'

describe('resolveOverlays (D-132)', () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-overlays-'))
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  const writeList = (value: unknown) => fs.writeFileSync(path.join(root, 'oscdesk.overlays.json'), JSON.stringify(value))

  it('has no overlays without the list file', () => {
    expect(resolveOverlays(root, {})).toEqual([])
  })

  it('reads the listed directories in order', () => {
    fs.mkdirSync(path.join(root, 'vp'))
    fs.mkdirSync(path.join(root, 'site', 'extra'), { recursive: true })
    writeList({ overlays: ['vp', 'site/extra/', 'vp'] })
    expect(resolveOverlays(root, {})).toEqual(['vp', 'site/extra'])
  })

  // 存在しないから落ちるのではなく、書き方そのものを断ることを確かめる(Linux では「vp.」というディレクトリを作れる)
  it('rejects a trailing dot even when such a directory exists', () => {
    fs.mkdirSync(path.join(root, 'vp.'))
    writeList({ overlays: ['vp.'] })
    expect(() => resolveOverlays(root, {})).toThrow(/相対パス/)
  })

  it('treats entries that differ only in case as one overlay', () => {
    fs.mkdirSync(path.join(root, 'vp'))
    writeList({ overlays: ['vp', 'VP'] })
    // 大文字小文字を区別するファイルシステムでは VP が無いが、重複として先に落とすので存在の確認まで行かない
    expect(resolveOverlays(root, {})).toEqual(['vp'])
  })

  it('reads the list file saved with a BOM', () => {
    fs.mkdirSync(path.join(root, 'vp'))
    fs.writeFileSync(path.join(root, 'oscdesk.overlays.json'), `\uFEFF${JSON.stringify({ overlays: ['vp'] })}`)
    expect(resolveOverlays(root, {})).toEqual(['vp'])
  })

  // 打ち間違いでフォークのテストが黙って走らなくなるのを防ぐ
  it('fails loudly on a listed directory that does not exist', () => {
    writeList({ overlays: ['vp'] })
    expect(() => resolveOverlays(root, {})).toThrow(/vp/)
  })

  it.each([
    ['../outside'],
    ['C:/abs'],
    ['/abs'],
    ['a//b'],
    ['packages'],
    ['tests/e2e'],
    ['protocol'],
    // Windows は大文字小文字を区別しないので、書き方を変えても機構のディレクトリを指せてしまう
    ['Packages/bridge'],
    ['PROTOCOL'],
    ['TESTS/e2e'],
    // Windows はパスの末尾の「.」を落とすので、packages/ を指せてしまう
    ['packages.'],
    ['packages./bridge'],
    ['vp.'],
    ['Tests/Fixtures/overlay-sample'],
    [''],
    [42],
  ])('rejects %j', (entry) => {
    fs.mkdirSync(path.join(root, 'packages'))
    expect(() => {
      writeList({ overlays: [entry] })
      return resolveOverlays(root, {})
    }).toThrow()
  })

  it('rejects a list file of the wrong shape', () => {
    writeList(['vp'])
    expect(() => resolveOverlays(root, {})).toThrow(/overlays/)
    writeList({ overlays: ['vp'], extra: true })
    expect(() => resolveOverlays(root, {})).toThrow(/overlays/)
  })

  it('lets the environment variable replace the list file', () => {
    fs.mkdirSync(path.join(root, 'vp'))
    fs.mkdirSync(path.join(root, 'other'))
    writeList({ overlays: ['vp'] })
    expect(resolveOverlays(root, { OSCDESK_OVERLAYS: 'other' })).toEqual(['other'])
    expect(resolveOverlays(root, { OSCDESK_OVERLAYS: '' })).toEqual([])
  })

  it('builds the vitest includes from the overlays', () => {
    expect(overlayVitestIncludes(['vp'])).toEqual({ unit: ['vp/tests/**/*.test.ts', 'vp/tests/**/*.test.tsx'], e2e: ['vp/tests/**/*.e2e.test.ts'] })
  })

  // pytest の経路は撤去した(D-161)。残った Python のテストは、追跡していなくても見つけてガードが落とす
  it('finds Python tests left in the overlay tests/ directories', () => {
    fs.mkdirSync(path.join(root, 'vp', 'tests', 'sub'), { recursive: true })
    fs.mkdirSync(path.join(root, 'vp', 'tests', '.venv', 'lib'), { recursive: true })
    fs.mkdirSync(path.join(root, 'docs-only'))
    for (const file of ['test_a.py', 'sub/b_test.py', 'helper.py', 'a.test.ts', '.venv/lib/test_site.py']) {
      fs.writeFileSync(path.join(root, 'vp', 'tests', file), '')
    }
    expect(overlayPythonTests(root, ['vp', 'docs-only'])).toEqual(['vp/tests/sub/b_test.py', 'vp/tests/test_a.py'])
    expect(overlayPythonTests(root, [])).toEqual([])
  })
})

// 完了条件(HID-437): 空のオーバーレイにテストを 1 本置くと pnpm test の各段で走ることを、実際に vitest を起動して確かめる
describe('a test placed in an overlay runs from the test entry (D-132)', () => {
  // 外側の vitest のワーカーの環境(VITEST_* など)を子の vitest に引き継ぐと、子が自分をワーカーだと誤認する
  // 色付けも止める。外側の実行が色を強制していると(FORCE_COLOR など)、子の出力に色の制御文字が混ざって
  // 「Tests  1 passed」の照合が外れる
  const childEnv = (overlays: string): NodeJS.ProcessEnv => ({
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST') && key !== 'NODE_OPTIONS' && key !== 'FORCE_COLOR')),
    NO_COLOR: '1',
    OSCDESK_OVERLAYS: overlays,
  })

  // フォークの Git Bash で色の制御文字が混ざり照合が外れた報告がある。NO_COLOR だけに頼らず、照合の前に取り除く。
  // FORCE_COLOR=0 は渡さない(vitest の色付け tinyrainbow は FORCE_COLOR の値でなく有無を見るので、0 でも色が付く)
  const stripAnsi = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '')
  const runVitest = (project: 'unit' | 'e2e', overlays: string) => {
    const result = spawnSync(
      process.execPath,
      [path.join(repositoryRoot, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--config', 'vitest.config.ts', '--project', project, '--reporter', 'verbose', SAMPLE],
      { cwd: repositoryRoot, env: childEnv(overlays), encoding: 'utf8', timeout: 110_000 },
    )
    return { ...result, stdout: stripAnsi(result.stdout), stderr: stripAnsi(result.stderr) }
  }

  // unit には SPA を happy-dom に描く画面のテストの見本(D-161)も入る
  it.each([
    ['unit', ['overlay sample unit test runs', 'overlay sample ui test runs']],
    ['e2e', ['overlay sample e2e test runs']],
  ] as const)('runs the overlay sample in the %s project only when it is listed', (project, testNames) => {
    const listed = runVitest(project, SAMPLE)
    expect(listed.status, listed.stdout + listed.stderr).toBe(0)
    for (const testName of testNames) expect(listed.stdout).toContain(testName)
    expect(listed.stdout).toMatch(new RegExp(`Tests\\s+${testNames.length} passed`))

    const unlisted = runVitest(project, '')
    expect(unlisted.status, unlisted.stdout + unlisted.stderr).toBe(0)
    for (const testName of testNames) expect(unlisted.stdout).not.toContain(testName)
  }, 120_000)
})
