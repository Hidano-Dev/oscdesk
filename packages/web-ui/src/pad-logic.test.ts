import { describe, expect, it } from 'vitest'

import { PAD_DOCUMENT, type PadTableWidget } from '@oscdesk/shared'

import {
  bulkState,
  defaultControlValue,
  fieldKey,
  firstEmptyCell,
  occupancy,
  optionIndex,
  padValueOf,
  tableRows,
  targetRowKeys,
  validateControlInput,
  widgetSettings,
} from './pad-logic'
import { STAGE_PAD } from './pad-test-support'

const table = STAGE_PAD.widgets.find((widget) => widget.id === 'members') as PadTableWidget

describe('pad logic (D-170)', () => {
  it('lays out spanning widgets and finds the first empty cell', () => {
    const cells = occupancy(STAGE_PAD)
    expect(cells.get('0,3')?.id).toBe('level')
    expect(cells.get('2,3')?.id).toBe('members')
    expect(firstEmptyCell(STAGE_PAD)).toEqual({ row: 1, column: 3 })
    expect(firstEmptyCell({ ...STAGE_PAD, rows: 1, columns: 1, widgets: [STAGE_PAD.widgets[0]!] })).toBeNull()
  })

  it('stops laying out a widget at the grid edge (a span past the grid does not loop past it)', () => {
    const wide = { ...STAGE_PAD.widgets[0]!, columnSpan: PAD_DOCUMENT.MAX_COLUMNS }
    expect(occupancy({ ...STAGE_PAD, rows: 1, columns: 2, widgets: [wide] }).size).toBe(2)
  })

  it('makes the osc.padSet value from the shown tuple, and refuses a tuple of the wrong shape', () => {
    const pose = STAGE_PAD.widgets.find((widget) => widget.id === 'pose')!
    const level = STAGE_PAD.widgets.find((widget) => widget.id === 'level')!
    expect(padValueOf(pose, [1, true])).toEqual([1, true])
    expect(padValueOf(pose, [1])).toBeNull()
    expect(padValueOf(level, [0.5])).toBe(0.5)
    expect(padValueOf({ id: 'c', kind: 'color', row: 0, column: 0, label: '', address: '/c', type: 'ffff', resend: true }, [1, 0, 0, 1])).toEqual([1, 0, 0, 1])
  })

  it('checks an input before sending it (the bridge still decides)', () => {
    expect(validateControlInput({ kind: 'number', type: 'i', min: 0, max: 10 }, '3')).toEqual({ ok: true, value: 3 })
    expect(validateControlInput({ kind: 'number', type: 'i' }, '1.5')).toMatchObject({ ok: false })
    expect(validateControlInput({ kind: 'number', type: 'i' }, '3000000000')).toMatchObject({ ok: false })
    expect(validateControlInput({ kind: 'number', type: 'f' }, '1e300')).toMatchObject({ ok: false })
    expect(validateControlInput({ kind: 'number', type: 'f', max: 1 }, '2')).toMatchObject({ ok: false })
    expect(validateControlInput({ kind: 'text', type: 's', maxLength: 3 }, 'abcd')).toMatchObject({ ok: false })
    expect(validateControlInput({ kind: 'text', type: 's' }, 'a\u0000b')).toMatchObject({ ok: false })
    expect(validateControlInput({ kind: 'text', type: 's' }, '')).toEqual({ ok: true, value: '' })
  })

  it('fills an untouched composite field with a value inside its range', () => {
    expect(defaultControlValue({ kind: 'number', type: 'i', min: 5 })).toBe(5)
    expect(defaultControlValue({ kind: 'number', type: 'f', max: -1 })).toBe(-1)
    expect(defaultControlValue({ kind: 'select', type: 'i', options: [{ value: 3 }] })).toBe(3)
    expect(defaultControlValue({ kind: 'toggle', type: 'T' })).toBe(false)
  })

  it('matches a select value to its option, numbers by value', () => {
    expect(optionIndex({ kind: 'select', type: 'f', options: [{ value: 0.5 }, { value: 1 }] }, 1)).toBe(1)
    expect(optionIndex({ kind: 'select', type: 's', options: [{ value: 'a' }] }, 'b')).toBe(-1)
    expect(optionIndex({ kind: 'select', type: 'i', options: [{ value: 1 }] }, true)).toBe(-1)
  })

  it('picks target rows from the namespace under the table address, and bounds the count', () => {
    const addresses = ['/member/m01/active', '/member/m01/name', '/member/m02/active', '/member/bad key/active', '/member/m03', '/other/m04/active', '/memberx/m05/a']
    expect(targetRowKeys(table, addresses)).toEqual(['m01', 'm02'])
    const many = Array.from({ length: PAD_DOCUMENT.MAX_TABLE_ROWS + 50 }, (_, index) => `/member/k${String(index)}/active`)
    expect(targetRowKeys(table, many)).toHaveLength(PAD_DOCUMENT.MAX_TABLE_ROWS)
    const target: PadTableWidget = { ...table, rows: { source: 'target' } }
    expect(tableRows(target, ['m09', 'm01'], ['m01', 'm02']).map((row) => row.key)).toEqual(['m09', 'm01', 'm02'])
    expect(tableRows(table, ['zz'], []).map((row) => [row.key, row.label])).toEqual([['m01', 'Alice'], ['m02', 'Bob']])
  })

  it('reads a bulk toggle as on only when every row is on', () => {
    expect(bulkState([[true], [true]])).toEqual({ on: true, mixed: false })
    expect(bulkState([[true], null])).toEqual({ on: false, mixed: true })
    expect(bulkState([])).toEqual({ on: false, mixed: false })
  })

  it('keys the input edits by field so only the last one of each is kept while waiting', () => {
    expect(fieldKey({ op: 'setLabel', widget: 'w1', label: 'a' })).toBe(fieldKey({ op: 'setLabel', widget: 'w1', label: 'b' }))
    expect(fieldKey({ op: 'setLabel', widget: 'w1', part: { field: 0 }, label: 'a' })).not.toBe(fieldKey({ op: 'setLabel', widget: 'w1', part: { field: 1 }, label: 'a' }))
    expect(fieldKey({ op: 'setRowLabel', widget: 't', key: 'm01', label: 'a' })).not.toBe(fieldKey({ op: 'setRowLabel', widget: 't', key: 'm02', label: 'a' }))
    expect(fieldKey({ op: 'addWidget', kind: 'button', row: 0, column: 0 })).toBeNull()
  })

  it('copies the settings without the id and place', () => {
    const settings = widgetSettings(STAGE_PAD.widgets.find((widget) => widget.id === 'level')!)
    expect(settings).not.toHaveProperty('id')
    expect(settings).not.toHaveProperty('columnSpan')
    expect(settings).toMatchObject({ kind: 'slider', address: '/mix/level' })
  })
})
