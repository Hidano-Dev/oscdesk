import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { keyListMessageBytes, PAD_DOCUMENT, PadDocumentSchema, PadDocumentStoredSchema, isHoldingWidget, widgetCells, type PadDocument } from './pad-document'

const samples = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../protocol/pad-document-samples.json'), 'utf8'),
) as { cases: Array<{ name: string; valid: boolean; pad: unknown }> }

function imageOf(bytes: number): string {
  const groups = Math.floor(bytes / 3)
  const tail = ['', 'AA==', 'AAA='][bytes % 3]!
  return `data:image/png;base64,${'AAAA'.repeat(groups)}${tail}`
}

const padWithImages = (...sizes: number[]) => ({
  format: 'oscdesk-pad',
  version: 2,
  rows: 12,
  columns: 12,
  widgets: sizes.map((size, index) => ({
    id: `w${String(index)}`, kind: 'button', row: Math.floor(index / 12), column: index % 12, label: '', image: imageOf(size), address: '/x', args: [],
  })),
})

describe('PadDocumentSchema', () => {
  it('judges every shared sample as the sample says', () => {
    expect(samples.cases.length).toBeGreaterThan(20)
    for (const sample of samples.cases) {
      expect(PadDocumentSchema.safeParse(sample.pad).success, sample.name).toBe(sample.valid)
    }
  })

  it('fills resend with true when it is left out (送り直すの既定はオン。D-165)', () => {
    const pad = PadDocumentSchema.parse(samples.cases.find(sample => sample.name === 'full-example')!.pad)
    const resend = Object.fromEntries(pad.widgets.filter(isHoldingWidget).flatMap(widget => widget.kind === 'table'
      ? widget.columns.map(column => [`${widget.id}.${column.id}`, column.resend])
      : [[widget.id, widget.resend]]))
    expect(resend).toEqual({
      light: true, legacyBool: false, volume: true, scene: true, count: true, title: true, tint: true, fps: false, camera: true,
      'members.active': true, 'members.gain': false,
    })
  })

  it('limits each image and the images in total, as version 1 does', () => {
    expect(PadDocumentSchema.safeParse(padWithImages(PAD_DOCUMENT.MAX_IMAGE_BYTES)).success).toBe(true)
    expect(PadDocumentSchema.safeParse(padWithImages(PAD_DOCUMENT.MAX_IMAGE_BYTES + 1)).error?.issues.map(issue => issue.message))
      .toContain(`image of "w0" exceeds ${String(PAD_DOCUMENT.MAX_IMAGE_BYTES)} bytes`)
    const count = PAD_DOCUMENT.MAX_TOTAL_IMAGE_BYTES / PAD_DOCUMENT.MAX_IMAGE_BYTES
    const total = PadDocumentSchema.safeParse(padWithImages(...Array.from({ length: count + 1 }, () => PAD_DOCUMENT.MAX_IMAGE_BYTES)))
    expect(total.error?.issues.map(issue => issue.message)).toContain(`images exceed ${String(PAD_DOCUMENT.MAX_TOTAL_IMAGE_BYTES)} bytes in total`)
  })

  it('names the place of a semantic problem', () => {
    const pad = samples.cases.find(sample => sample.name === 'reject-table-action-on-column-address')!.pad
    expect(PadDocumentSchema.safeParse(pad).error?.issues.map(issue => [issue.path.join('.'), issue.message]))
      .toEqual([['widgets.0.actions.0.address', 'action "off" uses the address of a column']])
  })

  it('refuses dimensions beyond the limits without walking the cells (PR #172 のレビュー)', () => {
    // zod の .max の違反は superRefine を止めないので、上限の外の大きさのままマスを展開すると 10^12 マスを走査する
    const huge = 1_000_000
    const widget = { id: 'w1', kind: 'button', row: 0, column: 0, rowSpan: huge, columnSpan: huge, label: '', address: '/x', args: [] }
    const cases = [
      { format: 'oscdesk-pad', version: 2, rows: huge, columns: huge, widgets: [widget] },
      { format: 'oscdesk-pad', version: 2, rows: 12, columns: 12, widgets: [widget] },
      { format: 'oscdesk-pad', version: 2, rows: huge, columns: huge, widgets: [{ ...widget, rowSpan: 1, columnSpan: 1, row: huge - 1, column: huge - 1 }] },
      { format: 'oscdesk-pad', version: 2, rows: 1.5, columns: 12, widgets: [{ ...widget, rowSpan: 1, columnSpan: 1 }] },
      // 部品の数の上限を超えても 1 部品のマスは上限の内側なので、走査は部品の数に比例するだけ
      { format: 'oscdesk-pad', version: 2, rows: 12, columns: 12, widgets: Array.from({ length: 5000 }, (_, index) => ({ ...widget, id: `w${String(index)}`, rowSpan: 12, columnSpan: 12 })) },
    ]
    const started = performance.now()
    for (const pad of cases) {
      expect(PadDocumentSchema.safeParse(pad).success).toBe(false)
      expect(PadDocumentStoredSchema.safeParse(pad).success).toBe(false)
    }
    expect(performance.now() - started).toBeLessThan(2000)
  })

  it('refuses a pad larger than the stored limit', () => {
    const label = 'x'.repeat(PAD_DOCUMENT.MAX_LABEL_CHARS)
    const options = Array.from({ length: PAD_DOCUMENT.MAX_OPTIONS }, (_, index) => ({ value: `${'v'.repeat(1000)}${String(index)}`, label }))
    const pad: PadDocument = {
      format: 'oscdesk-pad', version: 2, rows: 12, columns: 12,
      widgets: Array.from({ length: 40 }, (_, index) => ({ id: `w${String(index)}`, kind: 'select', row: Math.floor(index / 12), column: index % 12, label, address: '/x', type: 's', options, resend: true })),
    }
    expect(PadDocumentSchema.safeParse(pad).success).toBe(true)
    expect(PadDocumentStoredSchema.safeParse(pad).error?.issues[0]?.message).toMatch(/^pad is \d+ bytes as JSON/)
  })
})

describe('widgetCells', () => {
  it('spans from the top left cell', () => {
    expect(widgetCells({ row: 1, column: 2 })).toEqual({ row: 1, column: 2, rowEnd: 2, columnEnd: 3 })
    expect(widgetCells({ row: 1, column: 2, rowSpan: 3, columnSpan: 2 })).toEqual({ row: 1, column: 2, rowEnd: 4, columnEnd: 4 })
  })
})

describe('row key list sent to keysAddress (D-169)', () => {
  const table = (count: number, keyChars: number) => ({
    format: 'oscdesk-pad', version: 2, rows: 1, columns: 1,
    widgets: [{
      id: 'members', kind: 'table', row: 0, column: 0, label: '', address: '/member',
      rows: { source: 'ui', keysAddress: '/member/keys', keys: Array.from({ length: count }, (_, index) => ({ key: `${String(index).padStart(4, '0')}${'k'.repeat(keyChars - 4)}`, label: '' })) },
      columns: [{ id: 'active', kind: 'toggle', label: '', address: 'active', type: 'i' }],
    }],
  })

  it('measures the OSC message like the encoder pads it', () => {
    // アドレス 12 文字 → 16、型タグ ",ss" → 4、キー 3 文字 → 4 ずつ
    expect(keyListMessageBytes('/member/keys', ['abc', 'def'])).toBe(16 + 4 + 8)
  })

  it('refuses a key list that does not fit one datagram, and keeps one that does', () => {
    expect(PadDocumentSchema.safeParse(table(1000, 64)).success).toBe(false)
    expect(PadDocumentSchema.safeParse(table(1000, 16)).success).toBe(true)
    // keysAddress が無ければ送らないので数えない
    const withoutAddress = table(1000, 64)
    delete (withoutAddress.widgets[0]!.rows as { keysAddress?: string }).keysAddress
    expect(PadDocumentSchema.safeParse(withoutAddress).success).toBe(true)
  })
})

describe('cell addresses that collide (D-169)', () => {
  const table = (id: string, address: string, row: number, rows: unknown = { source: 'target' }) => ({
    id, kind: 'table', row, column: 0, label: '', address, rows, columns: [{ id: 'value', kind: 'number', label: '', address: 'value', type: 'i' }],
  })
  const doc = (widgets: unknown[]) => ({ format: 'oscdesk-pad', version: 2, rows: 4, columns: 2, widgets })
  const number = (address: string) => ({ id: 'n', kind: 'number', row: 3, column: 1, label: '', address, type: 'i' })

  it('refuses a value widget on the address of a table cell', () => {
    const result = PadDocumentSchema.safeParse(doc([table('members', '/member', 0), number('/member/a/value')]))
    expect(result.success).toBe(false)
    expect(result.error?.issues.map(issue => issue.message)).toContain('widget "n" uses the address of a cell of table "members"')
    // UI で管理する行は一覧にあるキーだけを数える。欄に無いアドレスも重ならない
    expect(PadDocumentSchema.safeParse(doc([table('members', '/member', 0, { source: 'ui', keys: [{ key: 'b', label: '' }] }), number('/member/a/value')])).success).toBe(true)
    expect(PadDocumentSchema.safeParse(doc([table('members', '/member', 0), number('/member/a/other')])).success).toBe(true)
  })

  it('refuses two tables whose row roots are the same or nested', () => {
    expect(PadDocumentSchema.safeParse(doc([table('a', '/member', 0), table('b', '/member', 1)])).success).toBe(false)
    expect(PadDocumentSchema.safeParse(doc([table('a', '/member', 0), table('b', '/member/x', 1)])).success).toBe(false)
    expect(PadDocumentSchema.safeParse(doc([table('a', '/member', 0), table('b', '/members', 1)])).success).toBe(true)
  })
})
describe('row key lists that collide with held addresses (HID-501)', () => {
  const uiTable = (id: string, address: string, row: number, keysAddress: string) => ({
    id, kind: 'table', row, column: 0, label: '', address,
    rows: { source: 'ui', keys: [{ key: 'a', label: '' }], keysAddress },
    columns: [{ id: 'value', kind: 'number', label: '', address: 'value', type: 'i' }],
  })
  const doc = (widgets: unknown[]) => ({ format: 'oscdesk-pad', version: 2, rows: 4, columns: 2, widgets })
  const messages = (pad: unknown) => PadDocumentSchema.safeParse(pad).error?.issues.map(issue => [issue.path.join('.'), issue.message])

  it('refuses a keysAddress that is the address of a value widget', () => {
    const number = { id: 'n', kind: 'number', row: 3, column: 1, label: '', address: '/keys', type: 'i' }
    expect(messages(doc([uiTable('members', '/member', 0, '/keys'), number])))
      .toEqual([['widgets.0.rows.keysAddress', 'keysAddress of table "members" is the address of widget "n"']])
    const composite = { id: 'c', kind: 'composite', row: 3, column: 1, label: '', address: '/keys', fields: [{ id: 'x', kind: 'number', label: '', type: 'i' }] }
    expect(PadDocumentSchema.safeParse(doc([uiTable('members', '/member', 0, '/keys'), composite])).success).toBe(false)
    // ボタンは保持値を持たないので重なってよい
    const button = { id: 'b', kind: 'button', row: 3, column: 1, label: '', address: '/keys', args: [] }
    expect(PadDocumentSchema.safeParse(doc([uiTable('members', '/member', 0, '/keys'), button])).success).toBe(true)
  })

  it('refuses a keysAddress that is the address of a table cell, its own or another', () => {
    expect(messages(doc([uiTable('members', '/member', 0, '/member/a/value')])))
      .toEqual([['widgets.0.rows.keysAddress', 'keysAddress of table "members" is the address of a cell of table "members"']])
    const target = { id: 'slots', kind: 'table', row: 1, column: 0, label: '', address: '/slot', rows: { source: 'target' }, columns: [{ id: 'value', kind: 'number', label: '', address: 'value', type: 'i' }] }
    expect(messages(doc([uiTable('members', '/member', 0, '/slot/x/value'), target])))
      .toEqual([['widgets.0.rows.keysAddress', 'keysAddress of table "members" is the address of a cell of table "slots"']])
    // 行のキーの形でない・欄に無いアドレスはマスと重ならない
    expect(PadDocumentSchema.safeParse(doc([uiTable('members', '/member', 0, '/member/keys')])).success).toBe(true)
  })

  it('refuses two tables that send their key lists to the same address', () => {
    expect(messages(doc([uiTable('a', '/member', 0, '/keys'), uiTable('b', '/slot', 1, '/keys')])))
      .toEqual([['widgets.1.rows.keysAddress', 'keysAddress of table "b" is the keysAddress of table "a"']])
    expect(PadDocumentSchema.safeParse(doc([uiTable('a', '/member', 0, '/member/keys'), uiTable('b', '/slot', 1, '/slot/keys')])).success).toBe(true)
  })
})
