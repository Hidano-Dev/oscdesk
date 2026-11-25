import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

// @ts-expect-error -- 型定義の無い .mjs(vitest.config.ts と run-python-tests.mjs が使う補助)を直接読む
import { pytestArgs, resolveOverlays } from '../../scripts/overlays.mjs'

import config from '../../vitest.config'

const repositoryRoot = path.resolve(__dirname, '../..')

// この仕組み自体のテストの見本。tests/scripts/overlays.test.ts が OSCDESK_OVERLAYS で指して走らせる
const SAMPLES = 'tests/fixtures/'

// pytest の python_files の既定値(test_*.py と *_test.py)。UI の pyproject.toml は python_files を変えていない
const PYTHON_TEST_FILE = /(^|\/)(test_[^/]*|[^/]*_test)\.py$/

// pytest の norecursedirs の既定値。UI の pyproject.toml は norecursedirs を変えていない(下のテストが確かめる)。
// 引数に渡したディレクトリ(UI のパッケージとオーバーレイの tests/)より下で、名前がこれに当たるディレクトリには pytest が入らない。
// そこに置いたテストは走らないので、根の下にあっても取りこぼしとして扱う(HID-448)
const PYTEST_NORECURSEDIRS = ['*.egg', '.*', '_darcs', 'build', 'CVS', 'dist', 'node_modules', 'venv', '{arch}']
// fnmatch の * だけを扱う。Windows の fnmatch は大文字小文字を区別しないので、区別せずに比べて厳しい側に倒す
const NORECURSE = PYTEST_NORECURSEDIRS.map((pattern) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i'))

// pytest は仮想環境のディレクトリにも入らない(--collect-in-virtualenv を渡さない限り)。pytest 8 は pyvenv.cfg を持つディレクトリを、
// 7 までは bin/ か Scripts/ に activate スクリプトを持つディレクトリを仮想環境とみなす。UI は pytest>=8 だが、両方を見て厳しい側に倒す。
// 仮想環境は普通は追跡しないので、追跡中のファイルに目印があるものだけを拾う(HID-453)
const VENV_MARKER = /^((?:.*\/)?)(?:pyvenv\.cfg|(?:bin|scripts)\/activate[^/]*)$/i
const venvDirsOf = (files: string[]): string[] => [...new Set(files.flatMap((filePath) => {
  const match = VENV_MARKER.exec(filePath)
  return match ? [match[1].toLowerCase()] : []
}))]

// filePath を集める pytest の根を返す。根の下でも norecursedirs に当たるディレクトリや仮想環境のディレクトリを通るなら、その根では集めない。
// 根が入れ子になる(オーバーレイの中のオーバーレイ)と、内側の根は引数として渡るので外側の根の norecursedirs に関わらず集まる。
// そのため最初に当たった根だけでなく、集める根が 1 つでもあるかを見る。
// 根の接頭辞は大文字小文字を区別せずに比べる。oscdesk.overlays.json に VP と書いて git が vp/tests/test_a.py を追跡していても、
// Windows の pytest は走らせるので、取りこぼしと誤って報告しない(HID-453)。
// collect_ignore・--ignore による除外は写さず、使っていないことを下のテストが確かめる
const pytestRootOf = (filePath: string, roots: string[], venvDirs: string[] = []): string | undefined => {
  const lowerPath = filePath.toLowerCase()
  return roots.find((root) => {
    if (!lowerPath.startsWith(root.toLowerCase())) return false
    const dirs = filePath.slice(root.length).split('/').slice(0, -1)
    return !dirs.some((dir, index) => NORECURSE.some((pattern) => pattern.test(dir))
      || venvDirs.includes(`${lowerPath.slice(0, root.length)}${dirs.slice(0, index + 1).join('/').toLowerCase()}/`))
  })
}

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
    const files = trackedFiles()
    const venvDirs = venvDirsOf(files)
    const orphans = files
      .filter((filePath) => PYTHON_TEST_FILE.test(filePath) && !filePath.startsWith(SAMPLES))
      .filter((filePath) => pytestRootOf(filePath, roots, venvDirs) === undefined)
    expect(orphans, `Python tests outside the pytest roots, under pytest's norecursedirs or in a virtualenv (list the overlay in oscdesk.overlays.json? rename build/, dist/, venv/, .*/ ...? move out of the directory with pyvenv.cfg?):\n${orphans.join('\n')}`).toEqual([])
  })

  it('recognizes both pytest file name patterns', () => {
    expect(['vp/tests/test_a.py', 'vp/tests/a_test.py', 'test_a.py'].filter((filePath) => PYTHON_TEST_FILE.test(filePath))).toHaveLength(3)
    expect(['vp/tests/helper.py', 'vp/tests/test_a.pyc', 'vp/tests/latest.py', 'vp/test_dir/a.py'].filter((filePath) => PYTHON_TEST_FILE.test(filePath))).toEqual([])
  })

  // vitest 側が exclude を見るのと同じく、pytest 側も入らないディレクトリを見る(HID-448)
  it('treats Python tests under pytest norecursedirs as not collected', () => {
    const roots = ['packages/nicegui-ui/tests/', 'vp/tests/']
    expect(['vp/tests/test_a.py', 'vp/tests/sub/test_a.py', 'packages/nicegui-ui/tests/test_a.py', 'vp/tests/builder/test_a.py']
      .filter((filePath) => pytestRootOf(filePath, roots) === undefined)).toEqual([])
    expect(['vp/tests/build/test_a.py', 'vp/tests/sub/dist/a_test.py', 'vp/tests/.cache/test_a.py', 'vp/tests/x.egg/test_a.py',
      'vp/tests/Venv/test_a.py', 'packages/nicegui-ui/tests/node_modules/test_a.py', 'other/tests/test_a.py']
      .filter((filePath) => pytestRootOf(filePath, roots) !== undefined)).toEqual([])
    // 内側の根(引数として渡る)の下なら、外側の根から見て build/ を通っても集まる
    expect(pytestRootOf('a/tests/build/tests/test_a.py', ['a/tests/', 'a/tests/build/tests/'])).toBe('a/tests/build/tests/')
  })

  // 仮想環境のディレクトリには pytest が入らない(HID-453)
  it('treats Python tests in a virtualenv as not collected', () => {
    const venvDirs = venvDirsOf(['vp/tests/env/pyvenv.cfg', 'vp/tests/old/Scripts/Activate.ps1', 'vp/tests/py7/bin/activate', 'vp/tests/sub/test_a.py'])
    expect(venvDirs.sort()).toEqual(['vp/tests/env/', 'vp/tests/old/', 'vp/tests/py7/'])
    const roots = ['vp/tests/']
    expect(['vp/tests/env/test_a.py', 'vp/tests/env/lib/a_test.py', 'vp/tests/OLD/test_a.py', 'vp/tests/py7/test_a.py']
      .filter((filePath) => pytestRootOf(filePath, roots, venvDirs) !== undefined)).toEqual([])
    // 名前が似ているだけのディレクトリ・仮想環境の外は集まる
    expect(['vp/tests/sub/test_a.py', 'vp/tests/envs/test_a.py', 'vp/tests/test_a.py']
      .filter((filePath) => pytestRootOf(filePath, roots, venvDirs) === undefined)).toEqual([])
  })

  // Windows では oscdesk.overlays.json の綴りと git の綴りの大文字小文字が違っても pytest は走らせる(HID-453)
  it('matches pytest roots case-insensitively', () => {
    expect(pytestRootOf('vp/tests/test_a.py', ['VP/tests/'])).toBe('VP/tests/')
    expect(pytestRootOf('Packages/NiceGUI-UI/Tests/test_a.py', ['packages/nicegui-ui/tests/'])).toBe('packages/nicegui-ui/tests/')
    expect(pytestRootOf('vp/tests/Build/test_a.py', ['VP/tests/'])).toBeUndefined()
  })

  // collect_ignore / collect_ignore_glob(conftest.py)と --ignore / --ignore-glob(引数・設定)はガードが写していない。
  // 使い始めたら、ガードにその除外を写すまでここで止める(HID-453)
  it('does not exclude tests with collect_ignore or --ignore', () => {
    const conftests = trackedFiles().filter((filePath) => /(^|\/)conftest\.py$/.test(filePath))
      .filter((filePath) => /collect_ignore/.test(readFileSync(path.join(repositoryRoot, filePath), 'utf8')))
    expect(conftests, 'conftest.py with collect_ignore: teach tests/guards/test-roots.test.ts the exclusion').toEqual([])
    const pyproject = readFileSync(path.join(repositoryRoot, 'packages/nicegui-ui/pyproject.toml'), 'utf8')
    expect(pyproject).not.toMatch(/--ignore|addopts/)
    expect(pytestArgs(repositoryRoot, []).join(' ')).not.toMatch(/--ignore/)
  })

  // 既定値を写した PYTEST_NORECURSEDIRS が実際の設定とずれないよう、設定で変えていないことを確かめる
  it('keeps pytest norecursedirs at its default', () => {
    const pyproject = readFileSync(path.join(repositoryRoot, 'packages/nicegui-ui/pyproject.toml'), 'utf8')
    expect(pyproject).not.toMatch(/norecursedirs/)
    // pytest の呼び方(scripts/overlays.mjs)が -o norecursedirs=… で上書きしても、既定値の写しは食い違う
    expect(pytestArgs(repositoryRoot, []).join(' ')).not.toMatch(/norecursedirs/)
  })

  it('places *.e2e.test.ts only in the e2e project', () => {
    const misplaced = trackedFiles()
      .filter((filePath) => filePath.endsWith('.e2e.test.ts') && !filePath.startsWith(SAMPLES))
      .filter((filePath) => runnerOf(filePath) !== 'e2e')
    expect(misplaced).toEqual([])
  })
})
