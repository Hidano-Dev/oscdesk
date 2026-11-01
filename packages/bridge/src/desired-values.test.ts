import { describe, expect, it } from 'vitest'

import {
  compositeValueOf,
  heldToProjectValues,
  projectValuesToHeld,
  resolveOscSurface,
  SurfaceDefinitionSchema,
  type OscSurfaceDefinition,
  type OscSurfaceRecord,
} from '@oscdesk/shared'

import { createDesiredValues } from './desired-values'
import { fromHeldValues, toHeldValues } from './desired-values-file'
import { parameterArgs } from './surface-core'

function definition(parameters: OscSurfaceDefinition['parameters']): OscSurfaceDefinition {
  return { format: 'oscdesk-surface', version: 1, name: 'T', parameters, screens: [] }
}

const LEVEL = { id: 'level', address: '/light/level', label: 'Level', type: 'f', kind: 'state', default: 0.5 } as const
const ON = { id: 'on', address: '/light/on', label: 'On', type: 'bool', kind: 'state', default: true } as const
const NAME = { id: 'name', address: '/light/name', label: 'Name', type: 's', kind: 'state' } as const
const FIRE = { id: 'fire', address: '/light/fire', label: 'Fire', type: 'i', kind: 'trigger', value: 1 } as const

describe('createDesiredValues', () => {
  it('seeds state parameters from defaults, maps bool to i 0/1, and skips triggers and default-less parameters', () => {
    const desired = createDesiredValues()
    desired.setDefinition(definition([LEVEL, ON, NAME, FIRE]))
    expect(desired.snapshot()).toEqual([
      { address: '/light/level', args: [{ type: 'f', value: 0.5 }] },
      { address: '/light/on', args: [{ type: 'i', value: 1 }] },
    ])
  })

  it('records UI operations only for tracked state addresses', () => {
    const desired = createDesiredValues()
    desired.setDefinition(definition([LEVEL, FIRE]))
    expect(desired.record('/light/level', [{ type: 'f', value: 0.9 }])).toBe(true)
    expect(desired.record('/light/fire', [{ type: 'i', value: 1 }])).toBe(false)
    expect(desired.record('/other', [{ type: 'i', value: 1 }])).toBe(false)
    expect(desired.snapshot()).toEqual([{ address: '/light/level', args: [{ type: 'f', value: 0.9 }] }])
  })

  it('records a value for a parameter that has no default', () => {
    const desired = createDesiredValues()
    desired.setDefinition(definition([NAME]))
    desired.record('/light/name', [{ type: 's', value: 'a' }])
    expect(desired.snapshot()).toEqual([{ address: '/light/name', args: [{ type: 's', value: 'a' }] }])
  })

  it('carries composite fields by id and type, not by position, on re-adoption and restore (HID-398)', () => {
    const field = (id: string, type: 'f' | 'i' = 'f') => ({ id, label: id, type, range: [0, 1] as [number, number], default: 0 })
    const point = (fields: ReturnType<typeof field>[]) => definition([
      { id: 'point', address: '/fx/point', label: 'Point', kind: 'state', type: 'composite', fields },
    ])
    const desired = createDesiredValues()
    desired.setDefinition(point([field('x'), field('y')]))
    desired.record('/fx/point', [{ type: 'f', value: 0.25 }, { type: 'f', value: 0.75 }])
    const saved = desired.persistable()
    expect(saved.values[0]?.fields).toEqual([{ id: 'x', type: 'f' }, { id: 'y', type: 'f' }])

    // 並べ替えても x は x のまま。並べ替えで位置が変わるので送り直す
    expect(desired.setDefinition(point([field('y'), field('x')]))).toEqual(['/fx/point'])
    expect(desired.snapshot()).toEqual([{ address: '/fx/point', args: [{ type: 'f', value: 0.75 }, { type: 'f', value: 0.25 }] }])
    // 型の変わったフィールド・消えたフィールドは default に戻り、残りは引き継ぐ
    desired.setDefinition(point([field('x'), field('y', 'i'), field('z')]))
    expect(desired.snapshot()).toEqual([{ address: '/fx/point', args: [{ type: 'f', value: 0.25 }, { type: 'i', value: 0 }, { type: 'f', value: 0 }] }])

    // ファイルからの復元も id で読む。フィールドの並びを持たない保存(PR #116 の形)は位置で読まずに default のまま
    const restoring = createDesiredValues()
    restoring.setDefinition(point([field('y'), field('x')]))
    expect(restoring.restore(saved)).toEqual(['/fx/point'])
    expect(restoring.snapshot()).toEqual([{ address: '/fx/point', args: [{ type: 'f', value: 0.75 }, { type: 'f', value: 0.25 }] }])
    const legacy = createDesiredValues()
    legacy.setDefinition(point([field('y'), field('x')]))
    expect(legacy.restore({ ...saved, values: saved.values.map(({ fields: _fields, ...value }) => value) })).toEqual([])
    expect(legacy.snapshot()).toEqual([{ address: '/fx/point', args: [{ type: 'f', value: 0 }, { type: 'f', value: 0 }] }])
  })

  it('carries values over a re-adoption only when id, address and type match', () => {
    const desired = createDesiredValues()
    desired.setDefinition(definition([LEVEL, ON]))
    desired.record('/light/level', [{ type: 'f', value: 0.9 }])
    desired.record('/light/on', [{ type: 'i', value: 0 }])
    desired.setDefinition(definition([LEVEL, { ...ON, id: 'power' }]))
    expect(desired.snapshot()).toEqual([
      { address: '/light/level', args: [{ type: 'f', value: 0.9 }] },
      { address: '/light/on', args: [{ type: 'i', value: 1 }] },
    ])
    desired.setDefinition(null)
    expect(desired.snapshot()).toEqual([])
  })

  it('compares echoes with float32 tolerance and ignores untracked addresses', () => {
    const desired = createDesiredValues()
    desired.setDefinition(definition([LEVEL, NAME]))
    expect(desired.differsFromEcho('/light/level', [{ type: 'f', value: Math.fround(0.5) }])).toBe(false)
    expect(desired.differsFromEcho('/light/level', [{ type: 'f', value: 0.7 }])).toBe(true)
    expect(desired.differsFromEcho('/light/name', [{ type: 's', value: 'x' }])).toBe(false)
    expect(desired.differsFromEcho('/nope', [{ type: 'f', value: 1 }])).toBe(false)
  })

  it('rejects operations whose arity, type or range does not fit the parameter', () => {
    const desired = createDesiredValues()
    desired.setDefinition(definition([{ ...LEVEL, range: [0, 1] }, ON, { ...NAME, options: ['a', 'b'] }]))
    expect(desired.record('/light/level', [{ type: 's', value: 'x' }])).toBe(false)
    expect(desired.record('/light/level', [])).toBe(false)
    expect(desired.record('/light/level', [{ type: 'f', value: 1 }, { type: 'f', value: 1 }])).toBe(false)
    expect(desired.record('/light/level', [{ type: 'f', value: 2 }])).toBe(false)
    expect(desired.record('/light/on', [{ type: 'i', value: 2 }])).toBe(false)
    expect(desired.record('/light/name', [{ type: 's', value: 'c' }])).toBe(false)
    expect(desired.record('/light/name', [{ type: 's', value: 'b' }])).toBe(true)
  })

  it('never holds non-finite numbers, even without a range', () => {
    const desired = createDesiredValues()
    desired.setDefinition(definition([LEVEL, { id: 'count', address: '/light/count', label: 'Count', type: 'i', kind: 'state', default: 0 }]))
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(desired.record('/light/level', [{ type: 'f', value }])).toBe(false)
      expect(desired.record('/light/count', [{ type: 'i', value }])).toBe(false)
    }
    expect(desired.restore({ values: [{ id: 'level', address: '/light/level', type: 'f', args: [{ type: 'f', value: Number.NaN }] }], records: [] })).toEqual([])
    expect(desired.snapshot()).toEqual([
      { address: '/light/level', args: [{ type: 'f', value: 0.5 }] },
      { address: '/light/count', args: [{ type: 'i', value: 0 }] },
    ])
  })

  it('holds names outside the static options when the parameter has optionsFrom (D-053)', () => {
    const segment = { ...NAME, options: ['(none)'], default: 'Intro', optionsFrom: { address: '/mb/segments' } }
    const desired = createDesiredValues()
    desired.setDefinition(definition([segment]))
    expect(desired.snapshot()).toEqual([{ address: '/light/name', args: [{ type: 's', value: 'Intro' }] }])
    expect(desired.record('/light/name', [{ type: 's', value: 'Verse' }])).toBe(true)
    expect(desired.record('/light/name', [{ type: 'i', value: 1 }])).toBe(false)
    // 再採用でも default に戻さず、選んだ名前を引き継ぐ
    expect(desired.setDefinition(definition([segment]))).toEqual([])
    expect(desired.snapshot()).toEqual([{ address: '/light/name', args: [{ type: 's', value: 'Verse' }] }])
  })

  it('does not track standalone:false parameters', () => {
    const desired = createDesiredValues()
    desired.setDefinition(definition([{ ...LEVEL, standalone: false }]))
    expect(desired.snapshot()).toEqual([])
  })

  it('reports reset addresses and drops carried values that no longer fit the new range', () => {
    const desired = createDesiredValues()
    desired.setDefinition(definition([LEVEL, ON]))
    desired.record('/light/level', [{ type: 'f', value: 0.9 }])
    expect(desired.setDefinition(definition([{ ...LEVEL, range: [0, 0.6] }, ON]))).toEqual(['/light/level'])
    expect(desired.snapshot()[0]).toEqual({ address: '/light/level', args: [{ type: 'f', value: 0.5 }] })
  })

  it('lists persistable values with id and type, skipping value-less, trigger and standalone:false parameters', () => {
    const desired = createDesiredValues()
    desired.setDefinition(definition([LEVEL, ON, NAME, FIRE, { ...LEVEL, id: 'hidden', address: '/light/hidden', standalone: false }]))
    expect(desired.persistable()).toEqual({
      values: [
        { id: 'level', address: '/light/level', type: 'f', args: [{ type: 'f', value: 0.5 }] },
        { id: 'on', address: '/light/on', type: 'bool', args: [{ type: 'i', value: 1 }] },
      ],
      records: [],
    })
  })

  it('restores saved values with the same rule as a re-adoption (D-058)', () => {
    const segment = { ...NAME, id: 'segment', address: '/mb/segment', options: ['(none)'], optionsFrom: { address: '/mb/segments' } }
    const desired = createDesiredValues()
    desired.setDefinition(definition([{ ...LEVEL, range: [0, 1] }, ON, { ...NAME, options: ['a', 'b'] }, segment, FIRE]))
    const restored = desired.restore({
      values: [
        { id: 'level', address: '/light/level', type: 'f', args: [{ type: 'f', value: 0.25 }] },
        { id: 'on', address: '/light/on', type: 'i', args: [{ type: 'i', value: 0 }] }, // 型が変わった
        { id: 'name', address: '/light/name', type: 's', args: [{ type: 's', value: 'c' }] }, // options 外
        { id: 'segment', address: '/mb/segment', type: 's', args: [{ type: 's', value: 'Verse' }] }, // optionsFrom は所属を問わない
        { id: 'fire', address: '/light/fire', type: 'i', args: [{ type: 'i', value: 1 }] }, // trigger は保持しない
        { id: 'gone', address: '/light/gone', type: 'f', args: [{ type: 'f', value: 1 }] },
      ],
      records: [],
    })
    expect(restored).toEqual(['/light/level', '/mb/segment'])
    expect(desired.snapshot()).toEqual([
      { address: '/light/level', args: [{ type: 'f', value: 0.25 }] },
      { address: '/light/on', args: [{ type: 'i', value: 1 }] },
      { address: '/mb/segment', args: [{ type: 's', value: 'Verse' }] },
    ])
  })

  it('does not restore over a range that no longer contains the saved value (records ignored when absent)', () => {
    const desired = createDesiredValues()
    desired.setDefinition(definition([{ ...LEVEL, range: [0, 0.6] }]))
    expect(desired.restore({ values: [{ id: 'level', address: '/light/level', type: 'f', args: [{ type: 'f', value: 0.9 }] }], records: [] })).toEqual([])
    expect(desired.snapshot()).toEqual([{ address: '/light/level', args: [{ type: 'f', value: 0.5 }] }])
  })
})

describe('createDesiredValues: record rows (D-062)', () => {
  const MEMBER: OscSurfaceRecord = {
    id: 'member', address: '/vp/member', label: 'Member', kind: 'state',
    keysFrom: { address: '/vp/members/list', request: '/vp/members/request' },
    fields: [
      { id: 'active', label: 'Active', type: 'bool', default: false },
      { id: 'slot', label: 'Slot', type: 'i', range: [1, 64], default: 1 },
      { id: 'segment', label: 'Segment', type: 's', options: ['(none)'], optionsFrom: { address: '/vp/segments/list' }, default: '(none)' },
    ],
  }
  const UPDATE: OscSurfaceRecord = {
    id: 'memberUpdate', address: '/vp/member/update', label: 'Update', kind: 'trigger',
    keysFrom: { address: '/vp/members/list' }, fields: [],
  }
  const withRecords = (records: OscSurfaceRecord[], parameters: OscSurfaceDefinition['parameters'] = []): OscSurfaceDefinition =>
    ({ ...definition(parameters), records })
  const s = (value: string) => ({ type: 's' as const, value })
  const i = (value: number) => ({ type: 'i' as const, value })
  const row = (key: string, active: number, slot: number, segment: string) =>
    ({ address: '/vp/member', args: [s(key), i(active), i(slot), s(segment)] })

  it('creates default rows for new keys once, skipping empty keys and trigger records', () => {
    const desired = createDesiredValues()
    desired.setDefinition(withRecords([MEMBER, UPDATE], [LEVEL]))
    expect(desired.snapshot()).toEqual([{ address: '/light/level', args: [{ type: 'f', value: 0.5 }] }])

    const created = desired.addKeys([{ record: 'member', keys: ['A', '', 'B'] }, { record: 'memberUpdate', keys: ['A'] }])
    expect(created).toEqual([row('A', 0, 1, '(none)'), row('B', 0, 1, '(none)')])
    expect(desired.addKeys([{ record: 'member', keys: ['B', 'A', 'C'] }])).toEqual([row('C', 0, 1, '(none)')])
    // パラメータ → レコードの行(作られた順)
    expect(desired.snapshot()).toEqual([
      { address: '/light/level', args: [{ type: 'f', value: 0.5 }] },
      row('A', 0, 1, '(none)'), row('B', 0, 1, '(none)'), row('C', 0, 1, '(none)'),
    ])
  })

  it('replaces one key row only for a well-formed row', () => {
    const desired = createDesiredValues()
    desired.setDefinition(withRecords([MEMBER, UPDATE]))
    desired.addKeys([{ record: 'member', keys: ['A', 'B'] }])
    expect(desired.record('/vp/member', row('A', 1, 3, 'Song X').args)).toBe(true) // optionsFrom は所属を問わない
    expect(desired.record('/vp/member', [s('A'), i(1), i(3)])).toBe(false) // フィールドが足りない
    expect(desired.record('/vp/member', [i(1), i(1), i(3), s('x')])).toBe(false) // 先頭が s でない
    expect(desired.record('/vp/member', row('A', 2, 3, 'x').args)).toBe(false) // bool の値域外
    expect(desired.record('/vp/member', row('A', 1, 65, 'x').args)).toBe(false) // range 外
    expect(desired.record('/vp/member', row('', 1, 3, 'x').args)).toBe(false) // 空のキー
    expect(desired.record('/vp/member', [s('A'), i(1), { type: 'f', value: Number.NaN }, s('x')])).toBe(false) // 有限でない
    expect(desired.record('/vp/member', [s('A'), { type: 'b', value: new Uint8Array([1]) }, i(3), s('x')])).toBe(false)
    expect(desired.record('/vp/member/update', [s('A')])).toBe(false) // trigger は保持しない
    // 一覧に無いキーも、正しい行なら保持する
    expect(desired.record('/vp/member', row('Z', 0, 2, '(none)').args)).toBe(true)
    expect(desired.snapshot()).toEqual([row('A', 1, 3, 'Song X'), row('B', 0, 1, '(none)'), row('Z', 0, 2, '(none)')])
  })

  it('compares echoes per key and identifies rows by address and key', () => {
    const desired = createDesiredValues()
    desired.setDefinition(withRecords([MEMBER], [LEVEL]))
    desired.addKeys([{ record: 'member', keys: ['A'] }])
    expect(desired.differsFromEcho('/vp/member', row('A', 0, 1, '(none)').args)).toBe(false)
    expect(desired.differsFromEcho('/vp/member', row('A', 1, 1, '(none)').args)).toBe(true)
    expect(desired.differsFromEcho('/vp/member', row('Nope', 1, 1, '(none)').args)).toBe(false)
    expect(desired.differsFromEcho('/vp/member', [])).toBe(false)
    expect(desired.entryId('/vp/member', row('A', 0, 1, '').args)).not.toBe(desired.entryId('/vp/member', row('B', 0, 1, '').args))
    expect(desired.entryId('/light/level', [{ type: 'f', value: 1 }])).toBe('/light/level')
  })

  it('carries rows over a re-adoption field by field and reports only rows that changed', () => {
    const desired = createDesiredValues()
    desired.setDefinition(withRecords([MEMBER]))
    desired.addKeys([{ record: 'member', keys: ['A', 'B'] }])
    desired.record('/vp/member', row('A', 1, 40, 'Song X').args)
    const idOf = (key: string) => desired.entryId('/vp/member', [s(key)])

    // 同じ定義(レイアウトだけの保存)では何も送り直さない
    expect(desired.setDefinition(withRecords([MEMBER]))).toEqual([])

    // slot の range が縮んで A の 40 は収まらない → slot だけ default。B は変わらない
    const narrowed: OscSurfaceRecord = { ...MEMBER, fields: [MEMBER.fields[0]!, { ...MEMBER.fields[1]!, range: [1, 32] } as OscSurfaceRecord['fields'][number], MEMBER.fields[2]!] }
    expect(desired.setDefinition(withRecords([narrowed]))).toEqual([idOf('A')])
    expect(desired.snapshot()).toEqual([row('A', 1, 1, 'Song X'), row('B', 0, 1, '(none)')])

    // フィールドの並べ替えと追加は全行を送り直す(Unity へ届く形が変わる)
    const reordered: OscSurfaceRecord = { ...MEMBER, fields: [MEMBER.fields[2]!, MEMBER.fields[0]!, { id: 'ip', label: 'IP', type: 's', default: '' }] }
    expect(desired.setDefinition(withRecords([reordered]))).toEqual([idOf('A'), idOf('B')])
    expect(desired.snapshot()).toEqual([
      { address: '/vp/member', args: [s('A'), s('Song X'), i(1), s('')] },
      { address: '/vp/member', args: [s('B'), s('(none)'), i(0), s('')] },
    ])

    // id が変わったレコードは引き継がない
    desired.setDefinition(withRecords([{ ...reordered, id: 'renamed' }]))
    expect(desired.snapshot()).toEqual([])
  })

  it('persists rows by field id and restores matching fields, keeping keys absent from any list', () => {
    const desired = createDesiredValues()
    desired.setDefinition(withRecords([MEMBER]))
    desired.addKeys([{ record: 'member', keys: ['A'] }])
    desired.record('/vp/member', row('A', 1, 7, 'Song X').args)
    expect(desired.persistable().records).toEqual([{
      id: 'member', address: '/vp/member', key: 'A',
      fields: [{ id: 'active', type: 'bool', arg: i(1) }, { id: 'slot', type: 'i', arg: i(7) }, { id: 'segment', type: 's', arg: s('Song X') }],
    }])

    const fresh = createDesiredValues()
    fresh.setDefinition(withRecords([MEMBER]))
    const restored = fresh.restore({
      values: [],
      records: [
        // slot は型が変わり、segment は保存に無い → default
        { id: 'member', address: '/vp/member', key: 'Gone', fields: [{ id: 'active', type: 'bool', arg: i(1) }, { id: 'slot', type: 'f', arg: { type: 'f', value: 7 } }] },
        { id: 'member', address: '/vp/member', key: 'A', fields: [{ id: 'slot', type: 'i', arg: i(99) }, { id: 'segment', type: 's', arg: s('Song X') }] },
        { id: 'other', address: '/vp/member', key: 'B', fields: [] }, // レコード id が違う
        { id: 'member', address: '/vp/other', key: 'C', fields: [] }, // アドレスが違う
        { id: 'member', address: '/vp/member', key: '', fields: [] }, // 空のキー
      ],
    })
    expect(restored).toEqual([fresh.entryId('/vp/member', [s('Gone')]), fresh.entryId('/vp/member', [s('A')])])
    expect(fresh.snapshot()).toEqual([row('Gone', 1, 1, '(none)'), row('A', 0, 1, 'Song X')])
    // 復元した行は一覧に現れても作り直さない
    expect(fresh.addKeys([{ record: 'member', keys: ['A', 'New'] }])).toEqual([row('New', 0, 1, '(none)')])
  })
})

describe('composite float range bounds through every path (HID-398)', () => {
  it('keeps a float32-rounded bound from receive through hold, persist, restore, export, import and send', () => {
    const body = SurfaceDefinitionSchema.parse({
      format: 'oscdesk-surface', version: 2, name: 'T', screens: [],
      parameters: [{
        id: 'p', label: 'P', kind: 'state', type: 'composite',
        fields: [{ id: 'x', label: 'X', type: 'f', range: [0, 0.1], default: 0 }, { id: 'n', label: 'N', type: 'i', default: 0 }],
      }],
      bindings: { osc: { parameters: [{ id: 'p', address: '/fx/p' }] } },
    })
    const resolved = resolveOscSurface(body)
    const parameter = resolved.parameters[0]!
    if (parameter.type !== 'composite') throw new Error('unexpected parameter')
    const bound = Math.fround(0.1)
    // 受信: 0.1 を float32 で送ったエコー
    const received = compositeValueOf(parameter.fields, [{ type: 'f', value: bound }, { type: 'i', value: 2 }])
    // 範囲の端を float32 の丸めで越えた値は端に寄せて持つ(D-124)
    expect(received).toEqual({ x: 0.1, n: 2 })
    // 送信: UI がその値をそのまま送り返す
    const sent = parameterArgs(parameter, received)
    expect(sent.ok).toBe(true)
    if (!sent.ok) return
    // 保持と再採用
    const desired = createDesiredValues()
    desired.setDefinition(resolved)
    expect(desired.record('/fx/p', sent.args)).toBe(true)
    expect(desired.setDefinition(resolved)).toEqual([])
    expect(desired.snapshot()).toEqual([{ address: '/fx/p', args: sent.args }])
    // 永続化と復元(ブリッジの再起動)
    const restarted = createDesiredValues()
    restarted.setDefinition(resolved)
    expect(restarted.restore(fromHeldValues(toHeldValues(desired.persistable())))).toEqual(['/fx/p'])
    expect(restarted.snapshot()).toEqual([{ address: '/fx/p', args: sent.args }])
    // プロジェクトの書き出しと取り込み
    const exported = heldToProjectValues(body, toHeldValues(restarted.persistable()))
    expect(exported.values).toEqual([{ param: 'p', value: { x: 0.1, n: 2 } }])
    const imported = projectValuesToHeld(body, exported)
    expect(imported.values.map(value => value.args)).toEqual([sent.args])
  })
})
