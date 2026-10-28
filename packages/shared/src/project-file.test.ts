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

  it('measures the compact UTF-8 JSON size', () => {
    expect(projectSerializedBytes({ a: 'é' })).toBe(new TextEncoder().encode('{"a":"é"}').length)
  })
})
