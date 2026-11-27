import { describe, expect, it } from 'vitest'

import { PadDocumentStoredSchema } from './pad-document'
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

  it('refuses to repair a problem outside any widget', () => {
    const image = `data:image/png;base64,${'AAAA'.repeat(Math.floor(512 * 1024 / 3))}`
    const buttons = Array.from({ length: 40 }, (_, index) => ({ id: `b${String(index)}`, kind: 'button', row: Math.floor(index / 12), column: index % 12, label: '', image, address: '/x', args: [] }))
    // 画像の合計の上限は部品の外(widgets 全体)の違反なので、どの部品を外すか決められない
    expect(PadDocumentStoredSchema.safeParse(doc(buttons, 12, 12)).success).toBe(false)
    expect(repairPadDocument(doc(buttons, 12, 12))).toBeNull()
  })
})
