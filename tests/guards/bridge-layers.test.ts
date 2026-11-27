import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

// ブリッジの層(D-134)の依存の向きを守るガード。
// - domain/ は I/O を持たない規則と状態。adapters/・app/・src 直下の入口を import せず、外部のモジュールは許可リスト
//   (node:path・node:crypto・zod・@oscdesk/*)のものだけ。process.・fetch( も書かない
// - adapters/ は外の世界に触るもの。app/ と入口を import しない(domain は使ってよい)
// - app/ は起動と配線。src 直下には入口(バンドルの元)だけを置く
// テスト(*.test.ts)は配線を確かめるために adapters の実装や node:fs を使ってよいので見ない。

const bridgeSrc = path.resolve(__dirname, '../../packages/bridge/src')

// src 直下に置いてよいのはバンドルの入口だけ(package.json の build が指す)
const ENTRY_FILES = new Set(['index.ts'])
const LAYERS = ['domain', 'adapters', 'app'] as const
type Layer = typeof LAYERS[number] | 'entry'

// domain が import してよい外部のモジュール(許可リスト)。node の組み込みは I/O でない path と crypto(乱数)だけ。
// 禁止の一覧にすると、新しい I/O のモジュール(node:sqlite など)や外部パッケージが黙って通るため
const DOMAIN_NODE_BUILTINS = new Set(['path', 'crypto'])
const DOMAIN_PACKAGES = new Set(['zod'])
const DOMAIN_PACKAGE_SCOPE = '@oscdesk/'
// domain のソースに書いてはいけないグローバルな I/O(環境変数・プロセスの操作・ネットワーク)。import を通らないので文字列で見る
const DOMAIN_FORBIDDEN_GLOBALS: readonly [RegExp, string][] = [
  [/\bprocess\./, 'process.'],
  [/\bfetch\s*\(/, 'fetch('],
]

// 各層がどの層を import してよいか
const ALLOWED: Record<Layer, readonly Layer[]> = {
  domain: ['domain'],
  adapters: ['domain', 'adapters'],
  app: ['domain', 'adapters', 'app'],
  entry: ['domain', 'adapters', 'app', 'entry'],
}

// import / export 文(複数行の import は閉じ括弧の行の `} from '...'`)、副作用だけの import、動的 import と require。
// 文の頭に限るのは、ログの文言の `... from "${file}"` のような文字列を import と読み違えないため
const IMPORT_PATTERN = /^\s*(?:(?:import|export)\b[^'"\n]*?\bfrom|\}\s*from|import)\s*['"]([^'"]+)['"]|\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]/gm

export function importSpecifiers(source: string): string[] {
  return [...source.matchAll(IMPORT_PATTERN)].map(match => (match[1] ?? match[2])!)
}

/** src からの相対パス(スラッシュ区切り)のファイルが属する層。どこにも属さなければ null */
export function layerOf(relativeFile: string): Layer | null {
  const [head, ...rest] = relativeFile.split('/')
  if (rest.length === 0) return ENTRY_FILES.has(head!) ? 'entry' : null
  return (LAYERS as readonly string[]).includes(head!) ? head as Layer : null
}

/**
 * 相対 import の行き先の層。target は src からの相対パス(正規化済み)。src の外へ出るものは 'outside'、
 * src 直下の入口でも層でもないものは null。拡張子(.ts / .js)・ディレクトリ(層の名前・'.' = src 直下の index)も解く。
 * 解けない行き先を読み飛ばすと、'../adapters' や '../index.js' のような書き方で層の向きをすり抜けられるため
 */
export function targetLayerOf(target: string): Layer | 'outside' | null {
  const bare = target.replace(/\/+$/, '').replace(/\.(?:[cm]?ts|[cm]?js)$/, '')
  if (bare === '..' || bare.startsWith('../')) return 'outside'
  if (bare === '.' || bare === '' || bare === 'index') return 'entry'
  if (!bare.includes('/')) {
    if ((LAYERS as readonly string[]).includes(bare)) return bare as Layer
    return ENTRY_FILES.has(`${bare}.ts`) ? 'entry' : null
  }
  return layerOf(bare)
}

function domainAllows(specifier: string): boolean {
  if (specifier.startsWith('node:')) return DOMAIN_NODE_BUILTINS.has(specifier.slice('node:'.length))
  if (specifier.startsWith(DOMAIN_PACKAGE_SCOPE)) return true
  const packageName = specifier.split('/')[0]!
  return DOMAIN_PACKAGES.has(packageName) || DOMAIN_NODE_BUILTINS.has(specifier)
}

/** 1 ファイルの違反。relativeFile は src からの相対パス */
export function violations(relativeFile: string, source: string): string[] {
  const layer = layerOf(relativeFile)
  if (layer === null) return [`${relativeFile} is outside domain/, adapters/ and app/ (only the bundle entries may sit in src/)`]
  if (relativeFile.endsWith('.test.ts')) return []
  const found: string[] = []
  for (const specifier of importSpecifiers(source)) {
    if (specifier.startsWith('.')) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(relativeFile), specifier))
      const targetLayer = targetLayerOf(target)
      if (targetLayer === 'outside') {
        found.push(`${relativeFile} (${layer}) imports ${specifier} outside src (use the workspace package name)`)
      } else if (targetLayer === null) {
        found.push(`${relativeFile} (${layer}) imports ${specifier}, which is neither a layer nor a bundle entry`)
      } else if (!ALLOWED[layer].includes(targetLayer)) {
        found.push(`${relativeFile} (${layer}) imports ${specifier} (${targetLayer})`)
      }
      continue
    }
    if (layer === 'domain' && !domainAllows(specifier)) found.push(`${relativeFile} (domain) imports ${specifier}, which is not on the domain allowlist`)
  }
  if (layer === 'domain') {
    for (const [pattern, label] of DOMAIN_FORBIDDEN_GLOBALS) {
      if (pattern.test(source)) found.push(`${relativeFile} (domain) uses ${label}`)
    }
  }
  return found
}

function sourceFiles(dir: string, prefix = ''): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) return sourceFiles(path.join(dir, entry.name), relative)
    return entry.name.endsWith('.ts') ? [relative] : []
  })
}

describe('bridge layers (D-134)', () => {
  const files = sourceFiles(bridgeSrc)

  it('finds the layers', () => {
    for (const layer of LAYERS) expect(files.some(file => file.startsWith(`${layer}/`))).toBe(true)
  })

  it('keeps every dependency pointing from app to adapters to domain, and domain free of I/O modules', () => {
    const found = files.flatMap(file => violations(file, fs.readFileSync(path.join(bridgeSrc, file), 'utf8')))
    expect(found).toEqual([])
  })

  it('detects the forbidden directions', () => {
    expect(violations('domain/a.ts', "import { x } from '../adapters/b'")).toHaveLength(1)
    expect(violations('domain/a.ts', "import type { x } from '../app/config'")).toHaveLength(1)
    expect(violations('domain/sub/a.ts', "import { x } from '../../index'")).toHaveLength(1)
    expect(violations('domain/a.ts', "import fs from 'node:fs'")).toHaveLength(1)
    expect(violations('domain/a.ts', "import { WebSocket } from 'ws'")).toHaveLength(1)
    expect(violations('adapters/a.ts', "export { x } from '../app/main'")).toHaveLength(1)
    expect(violations('stray.ts', '')).toHaveLength(1)
  })

  it('resolves directory, extension and entry spellings instead of skipping them', () => {
    // ディレクトリ(層の名前)
    expect(violations('domain/a.ts', "import { x } from '../adapters'")).toHaveLength(1)
    expect(violations('domain/a.ts', "import { x } from '../app/'")).toHaveLength(1)
    expect(violations('adapters/a.ts', "import { x } from '../app'")).toHaveLength(1)
    // src 直下(入口)を '..'・'../index'・拡張子つきで指す
    expect(violations('domain/a.ts', "import { x } from '..'")).toHaveLength(1)
    expect(violations('domain/a.ts', "import { x } from '../'")).toHaveLength(1)
    expect(violations('domain/a.ts', "import { x } from '../index.js'")).toHaveLength(1)
    expect(violations('domain/a.ts', "import { x } from '../index.ts'")).toHaveLength(1)
    expect(violations('adapters/a.ts', "import { x } from '../index.js'")).toHaveLength(1)
    // 拡張子つきの層の中のファイル
    expect(violations('domain/a.ts', "import { x } from '../adapters/udp-transport.js'")).toHaveLength(1)
    // src の外・どの層でもない行き先
    expect(violations('domain/a.ts', "import { x } from '../../../shared/src'")).toHaveLength(1)
    expect(violations('domain/a.ts', "import { x } from '../stray'")).toHaveLength(1)
    expect(targetLayerOf('.')).toBe('entry')
    expect(targetLayerOf('index.js')).toBe('entry')
    expect(targetLayerOf('adapters')).toBe('adapters')
    expect(targetLayerOf('domain/ipv4.js')).toBe('domain')
    expect(targetLayerOf('..')).toBe('outside')
  })

  it('reads import statements, including multi-line ones, but not strings that only look like them', () => {
    expect(importSpecifiers("import {\n  a,\n  b,\n} from '../adapters/x'\nimport type { C } from './c'\nimport './side-effect'\nconst d = await import('./d')"))
      .toEqual(['../adapters/x', './c', './side-effect', './d'])
    expect(importSpecifiers('logWarn(`Restored from "${store.file}"`)')).toEqual([])
  })

  it('keeps domain to the allowlist of modules and away from global I/O', () => {
    for (const specifier of ['node:sqlite', 'node:fs', 'fs', 'node:os', 'node:http', 'ws', 'osc', 'some-package', 'node:timers/promises']) {
      expect(violations('domain/a.ts', `import x from '${specifier}'`)).toHaveLength(1)
    }
    expect(violations('domain/a.ts', 'const home = process.env.HOME')).toHaveLength(1)
    expect(violations('domain/a.ts', "await fetch('http://x')")).toHaveLength(1)
    // adapters と app は I/O を持つ層なので許可リストの対象外
    expect(violations('adapters/a.ts', "import x from 'node:sqlite'\nconst pid = process.pid")).toEqual([])
  })

  it('allows the permitted directions and test files', () => {
    expect(violations('domain/a.ts', "import path from 'node:path'\nimport { randomUUID } from 'node:crypto'\nimport { x } from './b'\nimport { z } from 'zod'\nimport type { Y } from '@oscdesk/shared'")).toEqual([])
    expect(violations('domain/sub/a.ts', "import { x } from '../ipv4'\nimport { y } from '..'\nimport { z } from './index.js'")).toEqual([])
    expect(violations('adapters/a.ts', "import dgram from 'node:dgram'\nimport { x } from '../domain/b'")).toEqual([])
    expect(violations('app/a.ts', "import { x } from '../adapters/b'\nimport { y } from '../domain/c'")).toEqual([])
    expect(violations('index.ts', "import { x } from './app/main'")).toEqual([])
    expect(violations('domain/a.test.ts', "import fs from 'node:fs'\nimport { x } from '../adapters/b'")).toEqual([])
  })
})
