import { describe, expect, it } from 'vitest'

import { PAD_DOCUMENT, PadDocumentStoredSchema } from './pad-document'
import { repairPadDocument } from './pad-repair'

const doc = (widgets: unknown[], rows = 4, columns = 2) => ({ format: 'oscdesk-pad', version: 2, rows, columns, widgets })
const number = (id: string, address: string, row: number, column = 1) => ({ id, kind: 'number', row, column, label: '', address, type: 'i' })
const uiTable = (id: string, address: string, row: number, keysAddress?: string) => ({
  id, kind: 'table', row, column: 0, label: '', address,
  rows: { source: 'ui', keys: [{ key: 'a', label: '' }], ...(keysAddress === undefined ? {} : { keysAddress }) },
  columns: [{ id: 'value', kind: 'number', label: '', address: 'value', type: 'i' }],
})

describe('repairPadDocument (D-174)', () => {
  it('leaves a pad that already fits alone, and a pad of the wrong shape to be refused', () => {
    expect(repairPadDocument(doc([number('n', '/n', 0)]))).toBeNull()
    expect(repairPadDocument(doc([{ id: 'n', kind: 'number' }]))).toBeNull()
    expect(repairPadDocument({ format: 'oscdesk-pad', version: 2, rows: 1, columns: 1, widgets: [], extra: true })).toBeNull()
  })

  it('drops only the keysAddress of a table whose key list collides with a value widget (HID-501)', () => {
    const repaired = repairPadDocument(doc([uiTable('members', '/member', 0, '/keys'), number('n', '/keys', 3)]))
    expect(repaired?.repairs).toEqual(['removed keysAddress of table "members" (keysAddress of table "members" is the address of widget "n")'])
    expect(repaired?.pad.widgets.map(widget => widget.id)).toEqual(['members', 'n'])
    const table = repaired?.pad.widgets[0]
    expect(table?.kind === 'table' && table.rows).toEqual({ source: 'ui', keys: [{ key: 'a', label: '' }] })
    expect(PadDocumentStoredSchema.safeParse(repaired?.pad).success).toBe(true)
  })

  it('removes the later widget of a collision and keeps the one placed first', () => {
    const repaired = repairPadDocument(doc([uiTable('members', '/member', 0), number('n', '/member/a/value', 3), number('ok', '/ok', 2)]))
    expect(repaired?.repairs).toEqual(['removed widget "n" (widget "n" uses the address of a cell of table "members")'])
    expect(repaired?.pad.widgets.map(widget => widget.id)).toEqual(['members', 'ok'])
    // 重なった部品・表どうしも後ろを外す
    expect(repairPadDocument(doc([number('a', '/a', 0), number('b', '/b', 0)]))?.pad.widgets.map(widget => widget.id)).toEqual(['a'])
    expect(repairPadDocument(doc([uiTable('t1', '/member', 0), uiTable('t2', '/member/x', 1)]))?.pad.widgets.map(widget => widget.id)).toEqual(['t1'])
  })

  it('drops only the keysAddress of a table whose key list does not fit one datagram', () => {
    const keys = Array.from({ length: 1000 }, (_, index) => ({ key: `${String(index).padStart(4, '0')}${'k'.repeat(60)}`, label: '' }))
    const table = { ...uiTable('members', '/member', 0, '/member/keys'), rows: { source: 'ui', keys, keysAddress: '/member/keys' } }
    const repaired = repairPadDocument(doc([table]))
    expect(repaired?.repairs).toHaveLength(1)
    expect(repaired?.repairs[0]).toMatch(/^removed keysAddress of table "members" \(the row key list sent to keysAddress is/)
    const kept = repaired?.pad.widgets[0]
    expect(kept?.kind === 'table' && kept.rows.source === 'ui' && kept.rows.keys).toHaveLength(1000)
  })

  it('does not also remove a widget whose only conflict was with a widget removed first', () => {
    // 表 t は a と同じマスに重なり、n は t のマスのアドレスを使う。t を外せば n は規則に合う
    const table = { ...uiTable('t', '/member', 0), row: 0, column: 0 }
    const repaired = repairPadDocument(doc([number('a', '/a', 0, 0), table, number('n', '/member/a/value', 1)]))
    expect(repaired?.repairs).toEqual(['removed widget "t" (widget "t" overlaps another widget)'])
    expect(repaired?.pad.widgets.map(widget => widget.id)).toEqual(['a', 'n'])
  })

  it('refuses to repair a problem outside any widget', () => {
    const image = `data:image/png;base64,${'AAAA'.repeat(PAD_DOCUMENT.MAX_IMAGE_BYTES / 3)}`
    const count = PAD_DOCUMENT.MAX_TOTAL_IMAGE_BYTES / PAD_DOCUMENT.MAX_IMAGE_BYTES + 1
    const buttons = Array.from({ length: count }, (_, index) => ({ id: `b${String(index)}`, kind: 'button', row: Math.floor(index / 12), column: index % 12, label: '', image, address: '/x', args: [] }))
    // 画像の合計の上限は部品の外(widgets 全体)の違反なので、どの部品を外すか決められない
    expect(PadDocumentStoredSchema.safeParse(doc(buttons, 12, 12)).success).toBe(false)
    expect(repairPadDocument(doc(buttons, 12, 12))).toBeNull()
  })
})
