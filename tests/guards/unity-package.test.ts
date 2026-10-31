import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, posix, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { SurfaceDefinitionSchema } from '../../packages/shared/src/index'

// Unity の受け口の UPM パッケージ(D-096)の約束。C# は corepack pnpm test の対象外なので、
// ファイルの並びと写しの一致だけをここで機械的に縛る(振る舞いは EditMode テスト)
const repositoryRoot = resolve(__dirname, '../..')
const packagePath = 'OscSurface/Packages/com.hidano.oscdesk'
const packageRoot = join(repositoryRoot, packagePath)

const readText = (path: string): string => readFileSync(path, 'utf8').replaceAll('\r\n', '\n')

// 公開はクリーンな checkout から行うので、手元にだけある .meta で緑にならないよう追跡中のファイルを見る
const trackedPackageFiles = (): string[] => execFileSync(
  'git',
  ['ls-files', '-z', '--', packagePath],
  { cwd: repositoryRoot, encoding: 'buffer' },
).toString('utf8')
  .split('\0')
  .filter((filePath) => filePath.length > 0)
  .map((filePath) => posix.relative(packagePath, filePath))

// Unity が取り込まない名前(. で始まる、~ で終わる)。その中のフォルダはサンプルの取り込みで
// Assets/Samples/ の下に作り直されるので .meta は要らないが、Samples~ の中のファイルは写されるので、
// シーンからの参照(GUID)を保つため .meta を持たせる
const isIgnoredByUnity = (segment: string): boolean => segment.startsWith('.') || segment.endsWith('~')

describe('Unity receiver package (com.hidano.oscdesk)', () => {
  it('ships a copy of the OSC binary samples identical to protocol/', () => {
    // 利用側のプロジェクトにはリポジトリの protocol/ が無いので、EditMode テストはこの写しを読む
    const original = readText(join(repositoryRoot, 'protocol', 'osc-binary-samples.json'))
    const copy = readText(join(packageRoot, 'Tests', 'Editor', 'osc-binary-samples.json'))
    expect(copy, 'protocol/osc-binary-samples.json を変えたら Tests/Editor/osc-binary-samples.json へ写す').toBe(original)
  })

  it('gives every tracked file and folder a .meta and leaves no orphan .meta', () => {
    // レジストリから入れたパッケージは読み取り専用で Unity が .meta を作れず、.meta の無いファイルは無視される
    const tracked = new Set(trackedPackageFiles())
    const assets = new Set<string>()
    for (const file of tracked) {
      if (file.endsWith('.meta')) continue
      const segments = file.split('/')
      if (isIgnoredByUnity(segments[segments.length - 1])) continue
      assets.add(file)
      for (let depth = 1; depth < segments.length; depth += 1) {
        const folder = segments.slice(0, depth)
        if (!folder.some(isIgnoredByUnity)) assets.add(folder.join('/'))
      }
    }

    const missing = [...assets].filter((asset) => !tracked.has(`${asset}.meta`)).sort()
    const orphans = [...tracked]
      .filter((file) => file.endsWith('.meta') && !assets.has(file.slice(0, -'.meta'.length)))
      .sort()
    expect(missing, 'Unity で開いて .meta を作らせ、git add する').toEqual([])
    expect(orphans).toEqual([])
  })

  it('records the package version at the top of the CHANGELOG', () => {
    const manifest = JSON.parse(readText(join(packageRoot, 'package.json'))) as { name: string, version: string }
    expect(manifest.name).toBe('com.hidano.oscdesk')
    // 先頭の版の見出しをそのまま比べる(プレリリースやビルドメタデータの版も飛ばさない)
    const latest = /^## \[([^\]]+)\]/m.exec(readText(join(packageRoot, 'CHANGELOG.md')))
    expect(latest?.[1]).toBe(manifest.version)
  })

  it('ships a sample surface definition that OscDesk accepts', () => {
    const definition: unknown = JSON.parse(readText(join(packageRoot, 'Samples~', 'MinimalReceiver', 'MinimalReceiver.surface.json')))
    const result = SurfaceDefinitionSchema.safeParse(definition)
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true)
  })
})
