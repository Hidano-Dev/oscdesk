import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { OscPadSchema } from './osc-pad'
import { PadDocumentSchema } from './pad-document'
import { loadPadDocument, migrateOscPadV1, PadDocumentLoadSchema, upgradePadDocument } from './pad-migration'

const v1Samples = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../protocol/osc-pad-samples.json'), 'utf8'),
) as { cases: Array<{ name: string; valid: boolean; pad: unknown }> }

describe('migrateOscPadV1', () => {
  it('moves every button to a button widget, keeping its settings', () => {
    const v1 = OscPadSchema.parse(v1Samples.cases.find(sample => sample.name === 'full-example')!.pad)
    const v2 = migrateOscPadV1(v1)
    expect(v2).toEqual({
      format: 'oscdesk-pad', version: 2, rows: 2, columns: 3,
      widgets: v1.buttons.map(button => ({ ...button, kind: 'button' })),
    })
    expect(v2.widgets[1]).toEqual({ id: 'b2', kind: 'button', row: 0, column: 2, label: 'Fire', address: '/fx/fire', args: [{ type: 'i', value: 1 }, { type: 'f', value: 0.5 }, { type: 's', value: 'メンバーA' }] })
    // 元のパッドの引数を共有しない(移した後の編集が元を書き換えない)
    expect(v2.widgets[1]).not.toHaveProperty('color')
    expect((v2.widgets[1] as { args: unknown[] }).args[0]).not.toBe(v1.buttons[1]!.args[0])
  })

  it('accepts every valid version 1 sample as version 2 after the migration, and nothing else', () => {
    for (const sample of v1Samples.cases) {
      expect(PadDocumentLoadSchema.safeParse(sample.pad).success, sample.name).toBe(sample.valid)
      if (sample.valid) expect(PadDocumentSchema.safeParse(upgradePadDocument(sample.pad)).success, sample.name).toBe(true)
    }
  })
})

describe('loadPadDocument', () => {
  it('tells whether the pad was migrated', () => {
    const v1 = { format: 'oscdesk-pad', version: 1, rows: 1, columns: 1, buttons: [] }
    expect(loadPadDocument(v1)).toEqual({ ok: true, migrated: true, pad: { format: 'oscdesk-pad', version: 2, rows: 1, columns: 1, widgets: [] } })
    expect(loadPadDocument({ format: 'oscdesk-pad', version: 2, rows: 1, columns: 1, widgets: [] })).toMatchObject({ ok: true, migrated: false })
  })

  it('leaves an invalid version 1 pad as it is, so the reason points at the original problem', () => {
    const broken = { format: 'oscdesk-pad', version: 1, rows: 0, columns: 1, buttons: [] }
    expect(upgradePadDocument(broken)).toBe(broken)
    const result = loadPadDocument(broken)
    expect(result.ok).toBe(false)
  })
})
