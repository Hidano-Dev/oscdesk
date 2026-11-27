import { execFileSync } from 'node:child_process'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

// @ts-expect-error -- 型定義の無い .mjs(vitest.config.ts とガードテストが使う補助)を直接読む
import { overlayPythonTests, PYTHON_TEST_FILE, resolveOverlays } from '../../scripts/overlays.mjs'

import config from '../../vitest.config'

const repositoryRoot = path.resolve(__dirname, '../..')

// この仕組み自体のテストの見本。tests/scripts/overlays.test.ts が OSCDESK_OVERLAYS で指して走らせる
const SAMPLES = 'tests/fixtures/'

const trackedFiles = (): string[] => execFileSync('git', ['ls-files', '-z'], { cwd: repositoryRoot, encoding: 'buffer' })
  .toString('utf8')
  .split('\0')
  .filter((filePath) => filePath.length > 0)

// include に書く形(** と *)だけを扱う
const globToRegExp = (glob: string): RegExp => new RegExp(`^${glob
  .replace(/[.+^${}()|[\]\\]/g, '\\$&')
  .replace(/\/\*\*$/, '/\u0001')
  .replace(/\*\*\//g, '\u0000')
  .replace(/\*/g, '[^/]*')
  .replaceAll('\u0000', '(?:.*/)?')
  .replaceAll('\u0001', '.*')}$`)

type Project = { test?: { name?: string; include?: string[]; exclude?: string[] } }
const projects = (config.test?.projects ?? []) as Project[]

const runnerOf = (filePath: string): string | undefined => projects.find((project) => {
  const include = project.test?.include ?? []
  const exclude = project.test?.exclude ?? []
  return include.some((glob) => globToRegExp(glob).test(filePath)) && !exclude.some((glob) => globToRegExp(glob).test(filePath))
})?.test?.name

describe('test roots guard (D-132)', () => {
  // フォークがオーバーレイを oscdesk.overlays.json に書き忘れたり、機構のテストを include の外に置いたりすると、
  // テストは緑のまま 1 本も走らない。追跡しているテストは、どれも pnpm test のどこかの段で走ることを確かめる
  it('runs every tracked *.test.ts and *.test.tsx from a vitest project', () => {
    const orphans = trackedFiles()
      .filter((filePath) => /\.test\.tsx?$/.test(filePath) && !filePath.startsWith(SAMPLES))
      .filter((filePath) => runnerOf(filePath) === undefined)
    expect(orphans, `Tests that no vitest project includes (list the overlay in oscdesk.overlays.json?):\n${orphans.join('\n')}`).toEqual([])
  })

  // pytest の経路は撤去した(D-162)。Python のテスト(pytest の既定で集まる test_*.py と *_test.py)を置いたままにすると、
  // 走らないまま全体が緑になる。フォークのオーバーレイに残ったもの(追跡していないものも)を含めて落とし、書き直しを案内する
  it('has no Python tests left, since pytest is no longer part of pnpm test (D-162)', () => {
    const tracked = trackedFiles().filter((filePath) => PYTHON_TEST_FILE.test(filePath))
    const inOverlays = overlayPythonTests(repositoryRoot, resolveOverlays(repositoryRoot)) as string[]
    const leftovers = [...new Set([...tracked, ...inOverlays])].sort()
    expect(leftovers, 'Python tests no longer run (the NiceGUI UI and pytest were removed, D-162). '
      + 'Rewrite them as vitest tests under <overlay>/tests/ (see "フォークの置き場所" in docs/DEVELOPMENT.md) and delete the .py files:\n'
      + leftovers.join('\n')).toEqual([])
  })

  it('recognizes both pytest file name patterns as Python tests', () => {
    expect(['vp/tests/test_a.py', 'vp/tests/a_test.py', 'test_a.py'].filter((filePath) => PYTHON_TEST_FILE.test(filePath))).toHaveLength(3)
    expect(['vp/tests/helper.py', 'vp/tests/test_a.pyc', 'vp/tests/latest.py', 'vp/test_dir/a.py'].filter((filePath) => PYTHON_TEST_FILE.test(filePath))).toEqual([])
  })

  it('places *.e2e.test.ts only in the e2e project', () => {
    const misplaced = trackedFiles()
      .filter((filePath) => filePath.endsWith('.e2e.test.ts') && !filePath.startsWith(SAMPLES))
      .filter((filePath) => runnerOf(filePath) !== 'e2e')
    expect(misplaced).toEqual([])
  })
})
