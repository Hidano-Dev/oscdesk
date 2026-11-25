import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// @ts-expect-error -- 型定義の無い .mjs(vitest.config.ts と run-python-tests.mjs が使う補助)を直接読む
import { overlayPythonTestDirs, overlayVitestIncludes, pytestArgs, resolveOverlays } from '../../scripts/overlays.mjs'

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
    ['OscSurface'],
    // Windows は大文字小文字を区別しないので、書き方を変えても機構のディレクトリを指せてしまう
    ['Packages/nicegui-ui'],
    ['oscsurface'],
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
    expect(overlayVitestIncludes(['vp'])).toEqual({ unit: ['vp/tests/**/*.test.ts'], e2e: ['vp/tests/**/*.e2e.test.ts'] })
  })

  it('passes only existing tests/ directories to pytest and refuses a package there', () => {
    fs.mkdirSync(path.join(root, 'vp', 'tests'), { recursive: true })
    fs.mkdirSync(path.join(root, 'docs-only'))
    expect(overlayPythonTestDirs(root, ['vp', 'docs-only'])).toEqual([path.join(root, 'vp', 'tests')])
    expect(pytestArgs(root, ['vp']).at(-1)).toBe(path.join(root, 'vp', 'tests'))

    // UI のテストのパッケージ tests と名前がぶつかる
    fs.writeFileSync(path.join(root, 'vp', 'tests', '__init__.py'), '')
    expect(() => overlayPythonTestDirs(root, ['vp'])).toThrow(/__init__\.py/)
  })
})

// 完了条件(HID-437): 空のオーバーレイにテストを 1 本置くと pnpm test の各段で走ることを、実際に vitest と pytest を起動して確かめる
describe('a test placed in an overlay runs from the test entry (D-132)', () => {
  // 外側の vitest のワーカーの環境(VITEST_* など)を子の vitest に引き継ぐと、子が自分をワーカーだと誤認する
  // 色付けも止める。外側の実行が色を強制していると(FORCE_COLOR・pytest の PY_COLORS など)、子の出力に色の制御文字が混ざって
  // 「Tests  1 passed」や「PASSED」の照合が外れる
  const childEnv = (overlays: string): NodeJS.ProcessEnv => ({
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST') && key !== 'NODE_OPTIONS' && key !== 'FORCE_COLOR' && key !== 'PY_COLORS')),
    NO_COLOR: '1',
    PY_COLORS: '0',
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

  it.each([
    ['unit', 'overlay sample unit test runs'],
    ['e2e', 'overlay sample e2e test runs'],
  ] as const)('runs the overlay sample in the %s project only when it is listed', (project, testName) => {
    const listed = runVitest(project, SAMPLE)
    expect(listed.status, listed.stdout + listed.stderr).toBe(0)
    expect(listed.stdout).toContain(testName)
    expect(listed.stdout).toMatch(/Tests\s+1 passed/)

    const unlisted = runVitest(project, '')
    expect(unlisted.status, unlisted.stdout + unlisted.stderr).toBe(0)
    expect(unlisted.stdout).not.toContain(testName)
  }, 120_000)

  // 仮想環境の有無で結果が変わらないこと(無い PC で壊れた一覧を見逃さない・ある PC で生のスタックトレースにしない)
  it('fails with a clear message on a broken overlay list before looking for the virtual environment', () => {
    const result = spawnSync(
      process.execPath,
      [path.join(repositoryRoot, 'scripts', 'run-python-tests.mjs')],
      { cwd: repositoryRoot, env: childEnv('../outside'), encoding: 'utf8', timeout: 30_000 },
    )
    expect(result.status, result.stdout + result.stderr).toBe(1)
    expect(result.stderr).toContain('[ERROR] Python テストを始められません')
    expect(result.stderr).toContain('オーバーレイの設定に誤りがあります')
    expect(result.stderr).toContain('../outside')
    expect(result.stderr).not.toMatch(/^\s+at /m)
    expect(result.stdout + result.stderr).not.toContain('[SKIP]')
  })

  const python = [
    path.join(repositoryRoot, 'packages', 'nicegui-ui', '.venv', 'Scripts', 'python.exe'),
    path.join(repositoryRoot, 'packages', 'nicegui-ui', '.venv', 'bin', 'python'),
  ].find((candidate) => fs.existsSync(candidate))

  // 仮想環境が無ければ run-python-tests.mjs 自体がスキップするので、ここも同じ条件で飛ばす
  it.skipIf(!python)('runs the overlay sample in pytest with the UI fixtures', () => {
    const result = spawnSync(
      process.execPath,
      [path.join(repositoryRoot, 'scripts', 'run-python-tests.mjs'), '-k', 'overlay_sample', '-v', '-p', 'no:cacheprovider'],
      { cwd: repositoryRoot, env: childEnv(SAMPLE), encoding: 'utf8', timeout: 110_000 },
    )
    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(result.stdout).toContain('tests/fixtures/overlay-sample/tests/test_overlay_sample.py::test_overlay_sample_uses_ui_fixtures PASSED')
    expect(result.stdout).toContain('tests/fixtures/overlay-sample/tests/test_overlay_sample.py::test_overlay_sample_sees_nicegui_user_plugin PASSED')
  }, 120_000)
})
