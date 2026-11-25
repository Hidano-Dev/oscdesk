import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

// ブリッジの層(D-134)の依存の向きを守るガード。
// - domain/ は I/O を持たない規則と状態。adapters/・app/・src 直下の入口を import せず、I/O のモジュールも import しない
// - adapters/ は外の世界に触るもの。app/ と入口を import しない(domain は使ってよい)
// - app/ は起動と配線。src 直下には入口(バンドルの元)だけを置く
// テスト(*.test.ts)は配線を確かめるために adapters の実装や node:fs を使ってよいので見ない。

const bridgeSrc = path.resolve(__dirname, '../../packages/bridge/src')

// src 直下に置いてよいのはバンドルの入口だけ(package.json の build が指す)
const ENTRY_FILES = new Set(['index.ts', 'surface-view-tool.ts'])
const LAYERS = ['domain', 'adapters', 'app'] as const
type Layer = typeof LAYERS[number] | 'entry'

// domain が import してはいけない I/O のモジュール。node:path と node:crypto(乱数)は I/O ではないので許す
const IO_MODULES = new Set([
  'fs', 'fs/promises', 'net', 'dgram', 'child_process', 'os', 'http', 'https', 'http2', 'dns', 'dns/promises',
  'readline', 'readline/promises', 'tls', 'cluster', 'worker_threads', 'timers', 'timers/promises', 'process', 'stream',
  'ws', 'osc',
])

// 各層がどの層を import してよいか
const ALLOWED: Record<Layer, readonly Layer[]> = {
  domain: ['domain'],
  adapters: ['domain', 'adapters'],
  app: ['domain', 'adapters', 'app'],
  entry: ['domain', 'adapters', 'app', 'entry'],
}

const IMPORT_PATTERN = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"]([^'"]+)['"]/g

export function importSpecifiers(source: string): string[] {
  return [...source.matchAll(IMPORT_PATTERN)].map(match => match[1]!)
}

/** src からの相対パス(スラッシュ区切り)のファイルが属する層。どこにも属さなければ null */
export function layerOf(relativeFile: string): Layer | null {
  const [head, ...rest] = relativeFile.split('/')
  if (rest.length === 0) return ENTRY_FILES.has(head!) ? 'entry' : null
  return (LAYERS as readonly string[]).includes(head!) ? head as Layer : null
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
      if (target.startsWith('..')) continue
      const targetLayer = layerOf(target.includes('/') ? target : `${target}.ts`)
      if (targetLayer !== null && !ALLOWED[layer].includes(targetLayer)) found.push(`${relativeFile} (${layer}) imports ${specifier} (${targetLayer})`)
      continue
    }
    const moduleName = specifier.replace(/^node:/, '')
    if (layer === 'domain' && IO_MODULES.has(moduleName)) found.push(`${relativeFile} (domain) imports the I/O module ${specifier}`)
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

  it('allows the permitted directions and test files', () => {
    expect(violations('domain/a.ts', "import path from 'node:path'\nimport { randomUUID } from 'node:crypto'\nimport { x } from './b'\nimport { z } from 'zod'")).toEqual([])
    expect(violations('domain/sub/a.ts', "import { x } from '../ipv4'")).toEqual([])
    expect(violations('adapters/a.ts', "import dgram from 'node:dgram'\nimport { x } from '../domain/b'")).toEqual([])
    expect(violations('app/a.ts', "import { x } from '../adapters/b'\nimport { y } from '../domain/c'")).toEqual([])
    expect(violations('index.ts', "import { x } from './app/main'")).toEqual([])
    expect(violations('domain/a.test.ts', "import fs from 'node:fs'\nimport { x } from '../adapters/b'")).toEqual([])
  })
})
