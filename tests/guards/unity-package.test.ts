import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { SurfaceDefinitionSchema } from '../../packages/shared/src/index'

// Unity の受け口の UPM パッケージ(D-096)の約束。C# は corepack pnpm test の対象外なので、
// ファイルの並びと写しの一致だけをここで機械的に縛る(振る舞いは EditMode テスト)
const repositoryRoot = resolve(__dirname, '../..')
const packageRoot = join(repositoryRoot, 'OscSurface', 'Packages', 'com.hidano.oscdesk')

const readText = (path: string): string => readFileSync(path, 'utf8').replaceAll('\r\n', '\n')

const walk = (directory: string): string[] => readdirSync(directory).flatMap((name) => {
  const path = join(directory, name)
  return statSync(path).isDirectory() ? [path, ...walk(path)] : [path]
})

const toPackagePath = (path: string): string => relative(packageRoot, path).replaceAll('\\', '/')

// Unity は名前が ~ で終わるフォルダ(Samples~)を取り込まない。その下のフォルダはサンプルの取り込みで
// Assets/Samples/ の下に作り直されるので .meta は要らないが、ファイルは写されるので、シーンからの参照
// (GUID)を保つため .meta を持たせる
const isHiddenFolder = (path: string, isDirectory: boolean): boolean =>
  isDirectory && path.split('/').some((segment) => segment.endsWith('~'))

describe('Unity receiver package (com.hidano.oscdesk)', () => {
  it('ships a copy of the OSC binary samples identical to protocol/', () => {
    // 利用側のプロジェクトにはリポジトリの protocol/ が無いので、EditMode テストはこの写しを読む
    const original = readText(join(repositoryRoot, 'protocol', 'osc-binary-samples.json'))
    const copy = readText(join(packageRoot, 'Tests', 'Editor', 'osc-binary-samples.json'))
    expect(copy, 'protocol/osc-binary-samples.json を変えたら Tests/Editor/osc-binary-samples.json へ写す').toBe(original)
  })

  it('gives every file and folder a .meta and leaves no orphan .meta', () => {
    // レジストリから入れたパッケージは読み取り専用で Unity が .meta を作れず、.meta の無いファイルは無視される
    const entries = walk(packageRoot)
    const missing: string[] = []
    const orphans: string[] = []
    for (const path of entries) {
      const name = toPackagePath(path)
      if (name.endsWith('.meta')) {
        if (!existsSync(path.slice(0, -'.meta'.length))) orphans.push(name)
        continue
      }
      if (isHiddenFolder(name, statSync(path).isDirectory())) continue
      if (!existsSync(`${path}.meta`)) missing.push(name)
    }
    expect(missing, 'Unity で開いて .meta を作らせる').toEqual([])
    expect(orphans).toEqual([])
  })

  it('records the package version at the top of the CHANGELOG', () => {
    const manifest = JSON.parse(readText(join(packageRoot, 'package.json'))) as { name: string, version: string }
    expect(manifest.name).toBe('com.hidano.oscdesk')
    const latest = /^## \[(\d+\.\d+\.\d+)\]/m.exec(readText(join(packageRoot, 'CHANGELOG.md')))
    expect(latest?.[1]).toBe(manifest.version)
  })

  it('ships a sample surface definition that OscDesk accepts', () => {
    const definition: unknown = JSON.parse(readText(join(packageRoot, 'Samples~', 'MinimalReceiver', 'MinimalReceiver.surface.json')))
    const result = SurfaceDefinitionSchema.safeParse(definition)
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true)
  })
})
