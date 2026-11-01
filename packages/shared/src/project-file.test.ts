import { describe, expect, it } from 'vitest'

import { HeldSpawnSchema, ProjectFileSchema, projectSerializedBytes } from './project-file'

const DEFINITION = { format: 'oscdesk-surface', version: 1, name: 'Stage', parameters: [], screens: [] }
const PAD = { format: 'oscdesk-pad', version: 1, rows: 1, columns: 1, buttons: [] }
const base = {
  format: 'oscdesk-project',
  version: 1,
  exportedAt: '2026-10-28T10:00:00.000Z',
  surface: { name: 'stage', definition: DEFINITION, values: { values: [], records: [] } },
  pad: { name: 'take-01', pad: PAD },
}

describe('ProjectFileSchema (D-090)', () => {
  it('accepts a surface with values and a pad, or either one alone', () => {
    expect(ProjectFileSchema.safeParse(base).success).toBe(true)
    expect(ProjectFileSchema.safeParse({ ...base, pad: null }).success).toBe(true)
    expect(ProjectFileSchema.safeParse({ ...base, surface: null }).success).toBe(true)
  })

  it('rejects an empty project, unknown keys, other formats and unsafe names', () => {
    expect(ProjectFileSchema.safeParse({ ...base, surface: null, pad: null }).success).toBe(false)
    expect(ProjectFileSchema.safeParse({ ...base, extra: true }).success).toBe(false)
    expect(ProjectFileSchema.safeParse({ ...base, format: 'oscdesk-surface' }).success).toBe(false)
    expect(ProjectFileSchema.safeParse({ ...base, version: 2 }).success).toBe(false)
    expect(ProjectFileSchema.safeParse({ ...base, surface: { ...base.surface, name: '../x' } }).success).toBe(false)
    expect(ProjectFileSchema.safeParse({ ...base, pad: { ...base.pad, name: 'CON' } }).success).toBe(false)
  })

  it('validates the definition, the pad and the held values with their own rules', () => {
    expect(ProjectFileSchema.safeParse({ ...base, surface: { ...base.surface, definition: { ...DEFINITION, format: 'x' } } }).success).toBe(false)
    expect(ProjectFileSchema.safeParse({ ...base, pad: { ...base.pad, pad: { ...PAD, rows: 0 } } }).success).toBe(false)
    const blob = { values: [{ id: 'a', address: '/a', type: 's', args: [{ type: 'b', value: 'AA==' }] }], records: [] }
    expect(ProjectFileSchema.safeParse({ ...base, surface: { ...base.surface, values: blob } }).success).toBe(false)
  })

  it('caps the UI-managed rows and their expansion into held rows before adoption', () => {
    const records = Array.from({ length: 30 }, (_, index) => ({
      id: `r${String(index)}`, address: `/r/${String(index)}`, label: 'R', kind: 'state',
      keysFrom: { address: '/rows', source: 'ui' },
      fields: [{ id: 'v', label: 'V', type: 'i', default: 1 }],
    }))
    const definition = { ...DEFINITION, records }
    const rows = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `id-${String(index)}`, name: `N${String(index)}` }))
    const withRows = (count: number) => ({
      ...base, surface: { name: 'stage', definition, values: { values: [], records: [], keyLists: [{ address: '/rows', rows: rows(count) }] } },
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
    const heldRows = records.flatMap(record => listRows.map(row => ({
      id: record.id, address: record.address, key: row.id, fields: [{ id: 'v', type: 'i', arg: { type: 'i', value: 7 } }],
    })))
    const exported = {
      ...base,
      surface: { name: 'stage', definition: { ...DEFINITION, records }, values: { values: [], records: heldRows, keyLists: [{ address: '/rows', rows: listRows }] } },
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
      surface: { name: 'stage', definition: { ...DEFINITION, records }, values: { values: [], records: [], keyLists: [{ address: '/rows', rows: listRows }] } },
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
    const heldRows = Array.from({ length: 200 }, (_, index) => ({ id: 'member', address: '/vp/member', key: `k${String(index)}`, fields: [] }))
    const project = {
      ...base,
      surface: { name: 'stage', definition: { ...DEFINITION, records }, values: { values: [], records: heldRows } },
    }
    const result = ProjectFileSchema.safeParse(project)
    expect(result.success).toBe(false)
    expect(JSON.stringify(result.error?.issues)).toContain('bytes (limit')
  })

  it('measures the compact UTF-8 JSON size', () => {
    expect(projectSerializedBytes({ a: 'é' })).toBe(new TextEncoder().encode('{"a":"é"}').length)
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