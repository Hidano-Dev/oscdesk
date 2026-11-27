import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// フォークが自分のファイルを置くディレクトリ(オーバーレイ)の一覧を解決する(D-132)。
// vitest.config.ts とガードテストが同じ答えを使うよう、解決はここ 1 か所に置く。
// 一覧はリポジトリ直下の oscdesk.overlays.json に明示する。直下の */tests/** を広く拾う案は、
// node_modules/ のような無関係のディレクトリのテストまで拾うので退けた。

export const OVERLAYS_FILE = 'oscdesk.overlays.json'
// 一覧ファイルの代わりに使う一覧(カンマ区切り)。空文字ならオーバーレイなし。オーバーレイの仕組み自体のテストで使う
export const OVERLAYS_ENV = 'OSCDESK_OVERLAYS'

// 機構のディレクトリをオーバーレイにすると、機構のテストを二重に走らせたり、include の外の機構のファイルを
// フォークのものとして扱ったりする。フォークのファイルは機構と別の 1 か所に集める
// 比べるときは小文字にそろえる。Windows のファイルシステムは大文字小文字を区別しないので、
// 「Packages/bridge」のような書き方でも機構のディレクトリを指せてしまう
const MECHANISM_DIRS = new Set(['packages', 'tests', 'scripts', 'launchers', 'protocol', 'config', 'docs', 'surfaces', 'logs', 'node_modules'].map((dir) => dir.toLowerCase()))
// 末尾の「.」は許さない。Windows はパスの末尾の「.」を落とすので、「packages.」が packages/ を指せてしまう
const SEGMENT = /^[A-Za-z0-9_-](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?$/

function validate(entry, source) {
  if (typeof entry !== 'string' || entry.length === 0) {
    throw new Error(`${source}: オーバーレイはリポジトリ直下からの相対パスの文字列で書いてください(${JSON.stringify(entry)})`)
  }
  const normalized = entry.replaceAll('\\', '/').replace(/\/+$/, '')
  const segments = normalized.split('/')
  // 「..」や絶対パスを許すと、リポジトリの外のテストを pnpm test が走らせる
  if (segments.some((segment) => !SEGMENT.test(segment) || segment === '..' || segment === '.')) {
    throw new Error(`${source}: オーバーレイ ${JSON.stringify(entry)} はリポジトリの中の相対パスにしてください(「..」・絶対パス・空の区切りは使えません)`)
  }
  // 例外は tests/fixtures/ の下だけ(この仕組み自体のテストの見本を置く)
  // 見本の例外は小文字の綴りだけ(ガードテストの SAMPLES と同じ綴り)。機構かどうかは大文字小文字をそろえて比べる
  const isSample = segments[0] === 'tests' && segments[1] === 'fixtures'
  if (MECHANISM_DIRS.has(segments[0].toLowerCase()) && !isSample) {
    throw new Error(`${source}: ${JSON.stringify(entry)} は機構のディレクトリです。フォークのファイルは別のディレクトリ(例: vp/)に置いてください`)
  }
  return normalized
}

function fromFile(root) {
  const file = join(root, OVERLAYS_FILE)
  if (!existsSync(file)) return []
  let parsed
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''))
  } catch (error) {
    throw new Error(`${OVERLAYS_FILE} を JSON として読めません: ${error.message}`)
  }
  const keys = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed) : null
  if (!keys || !Array.isArray(parsed.overlays) || keys.some((key) => key !== 'overlays' && key !== '$comment')) {
    throw new Error(`${OVERLAYS_FILE} は { "overlays": ["vp"] } の形で書いてください`)
  }
  return parsed.overlays.map((entry) => validate(entry, OVERLAYS_FILE))
}

/**
 * オーバーレイのディレクトリ(リポジトリ直下からの相対パス、区切りは /)を一覧の順に返す。
 * 一覧ファイルが無ければ空。書いたディレクトリが無いときは例外にする(打ち間違いでフォークのテストが黙って消えるのを防ぐ)。
 */
export function resolveOverlays(root, env = process.env) {
  const raw = env[OVERLAYS_ENV]
  const entries = raw === undefined
    ? fromFile(root)
    : raw.split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0).map((entry) => validate(entry, OVERLAYS_ENV))
  // 大文字小文字だけが違う書き方は同じディレクトリとみなし、最初の書き方を残す(Windows で同じテストを 2 回走らせない)
  const seen = new Set()
  const unique = entries.filter((entry) => {
    const key = entry.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  for (const dir of unique) {
    const absolute = join(root, dir)
    if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
      throw new Error(`オーバーレイ ${dir} がありません(${raw === undefined ? OVERLAYS_FILE : OVERLAYS_ENV} を確かめてください)`)
    }
  }
  return unique
}

/** vitest の unit / e2e に足す include。テストはオーバーレイの tests/ の下に置く */
export function overlayVitestIncludes(overlays) {
  return {
    unit: overlays.flatMap((dir) => [`${dir}/tests/**/*.test.ts`, `${dir}/tests/**/*.test.tsx`]),
    e2e: overlays.map((dir) => `${dir}/tests/**/*.e2e.test.ts`),
  }
}

// pytest の既定(python_files)で集まる 2 つの形。pytest の経路は撤去した(D-161)ので、この形のファイルはもう走らない
export const PYTHON_TEST_FILE = /(^|\/)(test_[^/]*|[^/]*_test)\.py$/

/**
 * オーバーレイの tests/ の下に残っている Python のテスト(リポジトリ直下からの相対パス、区切りは /)。
 * 以前は pytest が UI のテストと一緒に走らせていた。黙って走らないまま緑にしないよう、ガード(tests/guards/test-roots.test.ts)が
 * これを見て落とし、vitest への書き直し(docs/DEVELOPMENT.md「フォークの置き場所」)を案内する。追跡していないファイルも拾う
 */
export function overlayPythonTests(root, overlays) {
  const found = []
  const walk = (relative) => {
    const absolute = join(root, relative)
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const child = `${relative}/${entry.name}`
      if (entry.isDirectory()) walk(child)
      else if (PYTHON_TEST_FILE.test(child)) found.push(child)
    }
  }
  for (const dir of overlays) {
    const tests = join(root, dir, 'tests')
    if (existsSync(tests) && statSync(tests).isDirectory()) walk(`${dir}/tests`)
  }
  return found.sort()
}
