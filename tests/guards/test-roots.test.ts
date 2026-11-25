import { execFileSync } from 'node:child_process'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

// @ts-expect-error -- 型定義の無い .mjs(vitest.config.ts と run-python-tests.mjs が使う補助)を直接読む
import { resolveOverlays } from '../../scripts/overlays.mjs'

import config from '../../vitest.config'

const repositoryRoot = path.resolve(__dirname, '../..')

// この仕組み自体のテストの見本。tests/scripts/overlays.test.ts が OSCDESK_OVERLAYS で指して走らせる
const SAMPLES = 'tests/fixtures/'

// pytest の python_files の既定値(test_*.py と *_test.py)。UI の pyproject.toml は python_files を変えていない
const PYTHON_TEST_FILE = /(^|\/)(test_[^/]*|[^/]*_test)\.py$/

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
  it('runs every tracked *.test.ts from a vitest project', () => {
    const orphans = trackedFiles()
      .filter((filePath) => filePath.endsWith('.test.ts') && !filePath.startsWith(SAMPLES))
      .filter((filePath) => runnerOf(filePath) === undefined)
    expect(orphans, `Tests that no vitest project includes (list the overlay in oscdesk.overlays.json?):\n${orphans.join('\n')}`).toEqual([])
  })

  // pytest は既定(python_files)で test_*.py と *_test.py の両方を集める。片方だけを見ると、もう片方の形のテストが黙って漏れる
  it('runs every tracked test_*.py and *_test.py from pytest', () => {
    const roots = ['packages/nicegui-ui/tests/', ...resolveOverlays(repositoryRoot).map((dir: string) => `${dir}/tests/`)]
    const orphans = trackedFiles()
      .filter((filePath) => PYTHON_TEST_FILE.test(filePath) && !filePath.startsWith(SAMPLES))
      .filter((filePath) => !roots.some((root) => filePath.startsWith(root)))
    expect(orphans, `Python tests outside the pytest roots (list the overlay in oscdesk.overlays.json?):\n${orphans.join('\n')}`).toEqual([])
  })

  it('recognizes both pytest file name patterns', () => {
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
