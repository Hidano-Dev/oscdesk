import { describe, expect, it } from 'vitest'

import {
  heldToProjectValues,
  HeldSpawnSchema,
  LegacyProjectFileSchema,
  ProjectFileSchema,
  projectSerializedBytes,
  projectValuesToHeld,
} from './project-file'
import { SurfaceDefinitionSchema } from './surface-definition'
import { migrateSurfaceDefinition } from './surface-migration'

const LEGACY_DEFINITION = { format: 'oscdesk-surface', version: 1, name: 'Stage', parameters: [], screens: [] }
const DEFINITION = { format: 'oscdesk-surface', version: 2, name: 'Stage', parameters: [], screens: [], bindings: { osc: { parameters: [] } } }
const PAD = { format: 'oscdesk-pad', version: 1, rows: 1, columns: 1, buttons: [] }
const base = {
  format: 'oscdesk-project',
  version: 2,
  exportedAt: '2026-10-28T10:00:00.000Z',
  surface: { name: 'stage', definition: DEFINITION, values: { values: [], rows: [] } },
  osc: { pad: { name: 'take-01', pad: PAD } },
}
const legacyBase = {
  format: 'oscdesk-project',
  version: 1,
  exportedAt: '2026-10-28T10:00:00.000Z',
  surface: { name: 'stage', definition: LEGACY_DEFINITION, values: { values: [], records: [] } },
  pad: { name: 'take-01', pad: PAD },
}
// 版 1 の書き方で組んだ定義を版 2 へ移して使う(レコードの並びを数で作る見本を短く書くため)
const v2 = (legacy: Record<string, unknown>) => migrateSurfaceDefinition({ ...LEGACY_DEFINITION, ...legacy })

describe('ProjectFileSchema (D-090・D-117)', () => {
  it('accepts a surface with values and a pad, or either one alone', () => {
    expect(ProjectFileSchema.safeParse(base).success).toBe(true)
    expect(ProjectFileSchema.safeParse({ ...base, osc: { pad: null } }).success).toBe(true)
    expect(ProjectFileSchema.safeParse({ ...base, osc: undefined }).success).toBe(true)
    expect(ProjectFileSchema.safeParse({ ...base, surface: null }).success).toBe(true)
  })

  it('rejects an empty project, unknown keys, other formats and unsafe names', () => {
    expect(ProjectFileSchema.safeParse({ ...base, surface: null, osc: { pad: null } }).success).toBe(false)
    expect(ProjectFileSchema.safeParse({ ...base, surface: null, osc: undefined }).success).toBe(false)
    expect(ProjectFileSchema.safeParse({ ...base, extra: true }).success).toBe(false)
    expect(ProjectFileSchema.safeParse({ ...base, format: 'oscdesk-surface' }).success).toBe(false)
    expect(ProjectFileSchema.safeParse({ ...base, version: 1 }).success).toBe(false)
    expect(ProjectFileSchema.safeParse({ ...base, surface: { ...base.surface, name: '../x' } }).success).toBe(false)
    expect(ProjectFileSchema.safeParse({ ...base, osc: { pad: { ...base.osc.pad, name: 'CON' } } }).success).toBe(false)
  })

  it('validates the definition, the pad and the held values with their own rules', () => {
    expect(ProjectFileSchema.safeParse({ ...base, surface: { ...base.surface, definition: { ...DEFINITION, format: 'x' } } }).success).toBe(false)
    expect(ProjectFileSchema.safeParse({ ...base, osc: { pad: { ...base.osc.pad, pad: { ...PAD, rows: 0 } } } }).success).toBe(false)
    // 型タグ付きの値(版 1 の保持値の形)は受けない
    const tagged = { values: [{ param: 'a', value: { type: 'f', value: 1 } }], rows: [] }
    expect(ProjectFileSchema.safeParse({ ...base, surface: { ...base.surface, values: tagged } }).success).toBe(false)
    const proto = { values: [], rows: [{ record: 'r', key: 'k', values: { __proto__x: 1 } }] }
    expect(ProjectFileSchema.safeParse({ ...base, surface: { ...base.surface, values: proto } }).success).toBe(false)
  })

  it('needs osc bindings in the surface (the bridge adopts it as it is)', () => {
    const { bindings: _bindings, ...body } = DEFINITION
    const result = ProjectFileSchema.safeParse({ ...base, surface: { ...base.surface, definition: body } })
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toContain('surface needs osc bindings')
  })

  it('caps the UI-managed rows and their expansion into held rows before adoption', () => {
    const records = Array.from({ length: 30 }, (_, index) => ({
      id: `r${String(index)}`, address: `/r/${String(index)}`, label: 'R', kind: 'state',
      keysFrom: { address: '/rows', source: 'ui' },
      fields: [{ id: 'v', label: 'V', type: 'i', default: 1 }],
    }))
    const definition = v2({ records })
    const rows = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `id-${String(index)}`, name: `N${String(index)}` }))
    const withRows = (count: number) => ({
      ...base, surface: { name: 'stage', definition, values: { values: [], rows: [], keyLists: [{ list: 'l_rows', rows: rows(count) }] } },
    })
    expect(ProjectFileSchema.safeParse(withRows(100)).success).toBe(true)
    // 1 一覧の行数の上限
    expect(ProjectFileSchema.safeParse(withRows(1001)).success).toBe(false)
    // 1000 行 × 30 レコード = 30,000 行に展開されるので断る
    const expanded = ProjectFileSchema.safeParse(withRows(1000))
    expect(expanded.success).toBe(false)
    expect(JSON.stringify(expanded.error?.issues)).toContain('expand to 30000 record rows')
  })

  it('counts the rows an export already holds only once, so an exported project near the limit reads back', () => {
    const records = Array.from({ length: 12 }, (_, index) => ({
      id: `r${String(index)}`, address: `/r/${String(index)}`, label: 'R', kind: 'state',
      keysFrom: { address: '/rows', source: 'ui' },
      fields: [{ id: 'v', label: 'V', type: 'i', default: 1 }],
    }))
    const listRows = Array.from({ length: 1000 }, (_, index) => ({ id: `id-${String(index)}`, name: `N${String(index)}` }))
    // 書き出しは一覧の行と、それを展開した各レコードの行の両方を持つ
    const heldRows = records.flatMap(record => listRows.map(row => ({ record: record.id, key: row.id, values: { v: 7 } })))
    const exported = {
      ...base,
      surface: { name: 'stage', definition: v2({ records }), values: { values: [], rows: heldRows, keyLists: [{ list: 'l_rows', rows: listRows }] } },
    }
    expect(ProjectFileSchema.safeParse(exported).success).toBe(true)
  })

  it('counts the runtime options that every record sharing a UI-managed list repeats, triggers included', () => {
    const records = Array.from({ length: 1100 }, (_, index) => ({
      id: `t${String(index)}`, address: `/t/${String(index)}`, label: 'T', kind: 'trigger',
      keysFrom: { address: '/rows', source: 'ui' }, fields: [],
    }))
    const listRows = Array.from({ length: 1000 }, (_, index) => ({ id: `id-${String(index)}`, name: `N${String(index)}` }))
    const project = {
      ...base,
      surface: { name: 'stage', definition: v2({ records }), values: { values: [], rows: [], keyLists: [{ list: 'l_rows', rows: listRows }] } },
    }
    const result = ProjectFileSchema.safeParse(project)
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toContain('runtime options')
  })

  it('counts the defaults that restoring fills into Unity-managed rows', () => {
    const records = [{
      id: 'member', address: '/vp/member', label: 'M', kind: 'state',
      keysFrom: { address: '/vp/members' },
      fields: [{ id: 'big', label: 'Big', type: 's', default: 'x'.repeat(100_000) }],
    }]
    const heldRows = Array.from({ length: 200 }, (_, index) => ({ record: 'member', key: `k${String(index)}`, values: {} }))
    const project = {
      ...base,
      surface: { name: 'stage', definition: v2({ records }), values: { values: [], rows: heldRows } },
    }
    const result = ProjectFileSchema.safeParse(project)
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toContain('bytes (limit')
  })

  it('measures the compact UTF-8 JSON size', () => {
    expect(projectSerializedBytes({ a: 'é' })).toBe(new TextEncoder().encode('{"a":"é"}').length)
  })
})

describe('LegacyProjectFileSchema (version 1)', () => {
  it('reads a version 1 project and moves its definition to version 2', () => {
    const legacy = {
      ...legacyBase,
      surface: {
        ...legacyBase.surface,
        definition: { ...LEGACY_DEFINITION, parameters: [{ id: 'level', address: '/light/level', label: 'L', type: 'f', kind: 'state', default: 0 }] },
        values: { values: [{ id: 'level', address: '/light/level', type: 'f', args: [{ type: 'f', value: 0.5 }] }], records: [] },
      },
    }
    const parsed = LegacyProjectFileSchema.parse(legacy)
    expect(parsed.surface?.definition.version).toBe(2)
    expect(parsed.surface?.definition.bindings?.osc?.parameters).toEqual([{ id: 'level', address: '/light/level' }])
    expect(parsed.surface?.values.values[0]?.address).toBe('/light/level')
    expect(ProjectFileSchema.safeParse(legacy).success).toBe(false)
  })
})

describe('project values ↔ held values (D-117)', () => {
  const definition = SurfaceDefinitionSchema.parse(v2({
    parameters: [
      { id: 'level', address: '/light/level', label: 'L', type: 'f', kind: 'state', default: 0 },
      { id: 'on', address: '/light/on', label: 'On', type: 'bool', kind: 'state', default: false },
    ],
    records: [{
      id: 'mb', address: '/mb/row', label: 'MB', kind: 'state', keysFrom: { address: '/mb/rows', source: 'ui' },
      fields: [{ id: 'port', label: 'Port', type: 'i', default: 1 }, { id: 'live', label: 'Live', type: 'bool', default: false }],
    }],
  }))

  it('turns ids and JSON values into the address-based held values and back', () => {
    const values = {
      values: [{ param: 'level', value: 0.25 }, { param: 'on', value: true }],
      rows: [{ record: 'mb', key: 'id-1', values: { port: 22000, live: true } }],
      keyLists: [{ list: 'l_mb_rows', rows: [{ id: 'id-1', name: 'MB 1' }] }],
    }
    const held = projectValuesToHeld(definition, values)
    expect(held).toEqual({
      values: [
        { id: 'level', address: '/light/level', type: 'f', args: [{ type: 'f', value: 0.25 }] },
        { id: 'on', address: '/light/on', type: 'bool', args: [{ type: 'i', value: 1 }] },
      ],
      records: [{ id: 'mb', address: '/mb/row', key: 'id-1', fields: [{ id: 'port', type: 'i', arg: { type: 'i', value: 22000 } }, { id: 'live', type: 'bool', arg: { type: 'i', value: 1 } }] }],
      keyLists: [{ address: '/mb/rows', rows: [{ id: 'id-1', name: 'MB 1' }] }],
    })
    expect(heldToProjectValues(definition, held)).toEqual(values)
  })

  it('drops unknown ids and values of the wrong type', () => {
    const held = projectValuesToHeld(definition, {
      values: [{ param: 'ghost', value: 1 }, { param: 'level', value: 'loud' }, { param: 'on', value: 1 }],
      rows: [{ record: 'ghost', key: 'k', values: {} }, { record: 'mb', key: 'k', values: { port: 1.5, other: 1 } }],
      keyLists: [{ list: 'l_ghost', rows: [] }],
    })
    expect(held).toEqual({ values: [], records: [{ id: 'mb', address: '/mb/row', key: 'k', fields: [] }] })
  })
})

describe('HeldSpawnSchema (HID-385)', () => {
  it('accepts only spawner addresses outside the reserved namespaces', () => {
    const spawn = (address: string) => HeldSpawnSchema.safeParse({ param: 'p', address, name: 'spark1', host: '10.0.0.1' }).success
    expect(spawn('/effect/spawner/spawn')).toBe(true)
    expect(spawn('/sys/catalog/request')).toBe(false)
    expect(spawn('/sys/catalog/spawn')).toBe(false)
    expect(spawn('/oscdesk/x/spawn')).toBe(false)
    expect(spawn('/effect/spawner/destroy')).toBe(false)
    expect(spawn('/cue/go')).toBe(false)
    expect(spawn('/a/*/spawn')).toBe(false)
  })
})
