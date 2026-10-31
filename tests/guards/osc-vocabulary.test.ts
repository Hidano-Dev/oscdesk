import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

// packages/shared の OSC_FRAME_PREFIX と同じ(ガードはリポジトリ直下で動くのでワークスペースのパッケージを import しない)
const OSC_FRAME_PREFIX = 'osc.'

// 共通のフレームに OSC の語(アドレス・型タグ付きの引数)が混ざったら落とすガード(HID-373・D-106)。
// UI ↔ サーバーのプロトコルは、パラメータ ID と JSON の値で書く。OSC の語は osc.* のフレームにだけ置く
// (MIDI などのアダプタを足しても、UI を作り直さずに済むようにするため)。
//
// 判定は protocol/wire-samples.json の受理される見本で行う。見本はプロトコルを変えるときに最初に更新する
// 契約なので(DEVELOPMENT.md)、新しい共通フレームを OSC の語で書くと、ここで落ちる。

// 語彙の移行がまだ済んでいない共通フレーム(HID-389 で移す)。ここへ足してはいけない。移し終えたら消す
// (移し終えたのに残っていると、下の「残っているものは本当に OSC の語を含む」で落ちる)
const PENDING_MIGRATION = new Set([
  'surface', // 定義のパラメータ本体と bindings.osc の分離
  'surfaceSave',
  'desired', // 保持値をパラメータ ID で配る
  'runtimeOptions', // 一覧をパラメータ・レコードの ID で配る
  'runtimeOptionsRefresh',
  'runtimeOptionsApply',
  'project', // プロジェクトファイルの定義・保持値・パッド(projectImport も同じ形を運ぶ)
  'catalog', // 設計図をパラメータの語彙に直してから配る(HID-371 の UI と合わせる)
])

const OSC_TYPE_TAGS = new Set(['i', 'f', 's', 'b'])
// OSC のアドレスを値に持つキー。走査の結果の端末の address(IP アドレス)は '/' で始まらないので当たらない
const ADDRESS_KEYS = new Set(['address', 'request', 'match'])

interface Sample { name: string; direction: string; valid: boolean; frame: unknown }

function oscWords(value: unknown, at = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => oscWords(item, `${at}[${String(index)}]`))
  if (value === null || typeof value !== 'object') return []
  const object = value as Record<string, unknown>
  const found: string[] = []
  const keys = Object.keys(object)
  if (keys.length === 2 && keys.includes('type') && keys.includes('value') && OSC_TYPE_TAGS.has(String(object.type))) {
    found.push(`${at} is a type-tagged OSC argument`)
  }
  for (const [key, child] of Object.entries(object)) {
    if (ADDRESS_KEYS.has(key) && typeof child === 'string' && child.startsWith('/')) found.push(`${at}.${key} is an OSC address`)
    if (key === 'args') found.push(`${at}.args carries OSC arguments`)
    found.push(...oscWords(child, `${at}.${key}`))
  }
  return found
}

const samples = (JSON.parse(fs.readFileSync(path.join(__dirname, '../../protocol/wire-samples.json'), 'utf8')) as { cases: Sample[] }).cases
const frameType = (sample: Sample) => (sample.frame as { type?: unknown } | null)?.type
const commonSamples = samples.filter(sample => sample.valid && typeof frameType(sample) === 'string'
  && !String(frameType(sample)).startsWith(OSC_FRAME_PREFIX))

describe('common frames carry no OSC vocabulary', () => {
  it.each(commonSamples.filter(sample => !PENDING_MIGRATION.has(String(frameType(sample)))).map(sample => [sample.name, sample] as const))(
    '%s',
    (_name, sample) => {
      expect(oscWords(sample.frame)).toEqual([])
    },
  )

  it('every frame on the pending list still carries OSC vocabulary in some sample (remove it once migrated)', () => {
    const stillPending = [...PENDING_MIGRATION].filter(type =>
      commonSamples.some(sample => frameType(sample) === type && oscWords(sample.frame).length > 0))
    expect(stillPending.sort()).toEqual([...PENDING_MIGRATION].sort())
  })

  it('detects an OSC address and a type-tagged argument', () => {
    expect(oscWords({ type: 'set', param: 'a', value: { type: 'f', value: 1 } })).toHaveLength(1)
    expect(oscWords({ type: 'x', address: '/a/b' })).toHaveLength(1)
    expect(oscWords({ type: 'destinations', broadcasts: [{ address: '192.168.1.255' }] })).toEqual([])
  })
})
