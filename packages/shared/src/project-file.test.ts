import { describe, expect, it } from 'vitest'

import { ProjectFileSchema, projectSerializedBytes } from './project-file'

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

  it('measures the compact UTF-8 JSON size', () => {
    expect(projectSerializedBytes({ a: 'é' })).toBe(new TextEncoder().encode('{"a":"é"}').length)
  })
})
