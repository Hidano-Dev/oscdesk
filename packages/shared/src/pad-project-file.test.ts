import { describe, expect, it } from 'vitest'

import { migrateProjectFileToV3, PadProjectFileSchema } from './pad-project-file'

const PAD_V1 = { format: 'oscdesk-pad', version: 1, rows: 1, columns: 2, buttons: [{ id: 'b1', row: 0, column: 1, label: 'Go', address: '/go', args: [] }] }
const PAD_V2 = { format: 'oscdesk-pad', version: 2, rows: 1, columns: 2, widgets: [{ id: 'b1', kind: 'button', row: 0, column: 1, label: 'Go', address: '/go', args: [] }] }
const DEFINITION = { format: 'oscdesk-surface', version: 2, name: 'Stage', parameters: [], screens: [], bindings: { osc: { parameters: [] } } }
const EXPORTED_AT = '2026-10-28T10:00:00.000Z'

describe('PadProjectFileSchema', () => {
  it('holds a pad, its held values and destinations only', () => {
    const project = {
      format: 'oscdesk-project', version: 3, exportedAt: EXPORTED_AT,
      pad: { name: 'take-01', pad: PAD_V2 },
      values: { widgets: [{ widget: 'light', value: true }, { widget: 'pose', value: [0.5, 1, 'x'] }], rows: [{ widget: 'members', key: 'A1', column: 'active', value: false }] },
      destinations: [{ host: '192.168.0.10', port: 7090, name: 'Stage PC' }],
    }
    expect(PadProjectFileSchema.safeParse(project).success).toBe(true)
    expect(PadProjectFileSchema.safeParse({ ...project, surface: null }).success).toBe(false)
    expect(PadProjectFileSchema.safeParse({ ...project, pad: { name: 'take-01', pad: PAD_V1 } }).success).toBe(false)
    expect(PadProjectFileSchema.safeParse({ ...project, values: { ...project.values, rows: [{ widget: 'members', key: 'メンバー', column: 'active', value: false }] } }).success).toBe(false)
  })
})

describe('migrateProjectFileToV3', () => {
  it('moves the pad of a version 2 project and drops the surface', () => {
    const result = migrateProjectFileToV3({
      format: 'oscdesk-project', version: 2, exportedAt: EXPORTED_AT,
      surface: { name: 'stage', definition: DEFINITION, values: { values: [], rows: [] } },
      osc: { pad: { name: 'take-01', pad: PAD_V1 } },
    })
    expect(result).toEqual({
      ok: true,
      dropped: { surface: true },
      project: { format: 'oscdesk-project', version: 3, exportedAt: EXPORTED_AT, pad: { name: 'take-01', pad: PAD_V2 }, values: { widgets: [], rows: [] }, destinations: [] },
    })
    expect(result.ok && PadProjectFileSchema.safeParse(result.project).success).toBe(true)
  })

  it('moves the pad of a version 1 project', () => {
    const result = migrateProjectFileToV3({ format: 'oscdesk-project', version: 1, exportedAt: EXPORTED_AT, surface: null, pad: { name: 'take-01', pad: PAD_V1 } })
    expect(result).toMatchObject({ ok: true, dropped: { surface: false }, project: { pad: { name: 'take-01', pad: PAD_V2 } } })
  })

  it('returns the reason for a file it cannot read', () => {
    expect(migrateProjectFileToV3({ format: 'oscdesk-project', version: 2 })).toMatchObject({ ok: false })
    expect(migrateProjectFileToV3({ format: 'oscdesk-project', version: 1, exportedAt: EXPORTED_AT, surface: null, pad: null })).toMatchObject({ ok: false, detail: expect.stringContaining('surface or a pad') })
  })
})
