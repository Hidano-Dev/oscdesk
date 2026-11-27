import { describe, expect, it } from 'vitest'

import { PAD_DOCUMENT, PadDocumentSchema, type PadDocument } from '@oscdesk/shared'

import { createPadValues, holderArgs, MAX_HELD_CELLS } from './pad-values'

const pad = (widgets: unknown[], rows = 4, columns = 4): PadDocument =>
  PadDocumentSchema.parse({ format: 'oscdesk-pad', version: 2, rows, columns, widgets })

const SLIDER = { id: 'level', kind: 'slider', row: 0, column: 0, label: 'Level', address: '/mixer/level', type: 'f', min: 0, max: 1 }
const NUMBER = { id: 'levelNumber', kind: 'number', row: 0, column: 1, label: 'Level', address: '/mixer/level', type: 'i', min: 0, max: 10 }
const TOGGLE = { id: 'mute', kind: 'toggle', row: 0, column: 2, label: 'Mute', address: '/mixer/mute', type: 'i', resend: false }
const TOGGLE_T = { id: 'live', kind: 'toggle', row: 0, column: 3, label: 'Live', address: '/scene/live', type: 'T' }
const SELECT = { id: 'scene', kind: 'select', row: 1, column: 0, label: 'Scene', address: '/scene/name', type: 's', options: [{ value: 'a' }, { value: 'b' }] }
const COMPOSITE = {
  id: 'pose', kind: 'composite', row: 1, column: 1, label: 'Pose', address: '/cam/pose',
  fields: [{ id: 'x', kind: 'number', label: 'x', type: 'f' }, { id: 'name', kind: 'text', label: 'n', type: 's', maxLength: 4 }],
}
const COLOR = { id: 'tint', kind: 'color', row: 1, column: 2, label: 'Tint', address: '/light/tint', type: 'ffff' }
const READ_ONLY = { id: 'meter', kind: 'number', row: 1, column: 3, label: 'Meter', address: '/meter', type: 'f', readOnly: true }
const TABLE = {
  id: 'members', kind: 'table', row: 2, column: 0, columnSpan: 4, label: 'Members', address: '/member',
  rows: { source: 'ui', keys: [{ key: 'm01', label: 'A' }, { key: 'm02', label: 'B' }], keysAddress: '/member/keys' },
  columns: [
    { id: 'active', kind: 'toggle', label: 'Active', address: 'active', type: 'i' },
    { id: 'slot', kind: 'number', label: 'Slot', address: 'slot', type: 'i', resend: false },
  ],
  actions: [{ id: 'reset', label: 'Reset', scope: 'all', address: 'reset', args: [{ type: 'i', value: 1 }] }],
}
const TARGET_TABLE = {
  id: 'lights', kind: 'table', row: 3, column: 0, label: 'Lights', address: '/light',
  rows: { source: 'target' }, columns: [{ id: 'on', kind: 'toggle', label: 'On', address: 'on', type: 'i' }],
}

const ALL = pad([SLIDER, NUMBER, TOGGLE, TOGGLE_T, SELECT, COMPOSITE, COLOR, READ_ONLY, TABLE, TARGET_TABLE])

function adopted(document = ALL) {
  const values = createPadValues()
  values.adopt(document, { widgets: [], rows: [] })
  return values
}

const commit = (result: ReturnType<ReturnType<typeof createPadValues>['set']>) => {
  if (!result.ok) throw new Error(result.reason)
  return { address: result.address, args: result.args, ...result.commit() }
}

describe('pad held values (D-169)', () => {
  it('converts each value widget by its type and range, and refuses what does not fit', () => {
    const values = adopted()
    expect(commit(values.set('level', 0.5))).toMatchObject({ address: '/mixer/level', args: [{ type: 'f', value: 0.5 }], changed: true })
    expect(commit(values.set('mute', true))).toMatchObject({ args: [{ type: 'i', value: 1 }] })
    expect(commit(values.set('scene', 'b'))).toMatchObject({ args: [{ type: 's', value: 'b' }] })
    expect(commit(values.set('pose', [1.5, 'ab']))).toMatchObject({ args: [{ type: 'f', value: 1.5 }, { type: 's', value: 'ab' }] })
    expect(commit(values.set('tint', [1, 0.5, 0, 1]))).toMatchObject({ args: [{ type: 'f', value: 1 }, { type: 'f', value: 0.5 }, { type: 'f', value: 0 }, { type: 'f', value: 1 }] })
    expect(values.set('level', 2)).toEqual({ ok: false, reason: 'out-of-range: 2 (level)' })
    expect(values.set('level', 'x')).toMatchObject({ ok: false })
    expect(values.set('scene', 'c')).toEqual({ ok: false, reason: 'not-an-option (scene)' })
    expect(values.set('pose', [1, 'toolong'])).toEqual({ ok: false, reason: 'invalid-text (pose.name)' })
    expect(values.set('pose', [1])).toMatchObject({ ok: false })
    expect(values.set('tint', [2, 0, 0, 0])).toMatchObject({ ok: false })
    // T / F の型タグはまだ送れない(HID-492)
    expect(values.set('live', true)).toEqual({ ok: false, reason: 'unsupported-type: T (live)' })
    expect(values.set('meter', 1)).toEqual({ ok: false, reason: 'read-only: meter' })
    expect(values.set('members', 1)).toEqual({ ok: false, reason: 'not-a-value-widget: members' })
    expect(values.set('ghost', 1)).toEqual({ ok: false, reason: 'unknown-widget: ghost' })
  })

  it('does not hold a value until it is committed', () => {
    const values = adopted()
    const prepared = values.set('level', 0.5)
    expect(prepared.ok).toBe(true)
    expect(values.snapshot().widgets).toEqual([])
    if (prepared.ok) prepared.commit()
    expect(values.snapshot().widgets).toEqual([{ widget: 'level', address: '/mixer/level', value: 0.5 }])
    expect(commit(values.set('level', 0.5)).changed).toBe(false)
  })

  it('lets the widget placed first own an address shared by two value widgets', () => {
    const values = adopted()
    // 後の部品(i の数値)の操作は自分の値域で確かめ、持ち主(f のスライダー)の型で送って持ち主の値にする
    const sent = commit(values.set('levelNumber', 1))
    expect(sent.args).toEqual([{ type: 'f', value: 1 }])
    expect(sent.entries.widgets).toEqual([{ widget: 'level', value: 1 }, { widget: 'levelNumber', value: 1 }])
    expect(values.snapshot().widgets).toEqual([{ widget: 'level', address: '/mixer/level', value: 1 }])
    // 持ち主の値域に入らない値は通さない
    expect(values.set('levelNumber', 5)).toMatchObject({ ok: false, reason: expect.stringContaining('owner-mismatch: level') })
    expect(values.lockWidgetsOf('levelNumber')).toEqual(['levelNumber', 'level'])
    expect(values.lockWidgetsOf('level')).toEqual(['level'])
  })

  it('holds table cells per row and column, only for known rows', () => {
    const values = adopted()
    expect(commit(values.setCell('members', 'm01', 'active', true))).toMatchObject({ address: '/member/m01/active', args: [{ type: 'i', value: 1 }] })
    expect(values.setCell('members', 'm09', 'active', true)).toEqual({ ok: false, reason: 'unknown-row: members[m09]' })
    expect(values.setCell('members', 'm01', 'ghost', true)).toEqual({ ok: false, reason: 'unknown-column: members.ghost' })
    // ターゲットが持つ行のキーは形だけを見る
    expect(commit(values.setCell('lights', 'L1', 'on', false))).toMatchObject({ address: '/light/L1/on' })
    expect(values.setCell('lights', 'bad key', 'on', false)).toMatchObject({ ok: false })
    expect(values.isLockable('members', 'm01')).toBe(true)
    expect(values.isLockable('members', 'm09')).toBe(false)
    expect(values.isLockable('level')).toBe(true)
    expect(values.isLockable('members')).toBe(false)
  })

  it('refuses new target rows beyond the per-table limit and new cells beyond the held cell limit', () => {
    const values = adopted(pad([TARGET_TABLE]))
    for (let index = 0; index < PAD_DOCUMENT.MAX_TABLE_ROWS; index += 1) commit(values.setCell('lights', `k${String(index)}`, 'on', true))
    expect(values.setCell('lights', 'extra', 'on', true)).toMatchObject({ ok: false, reason: expect.stringContaining('per table') })
    // 持っている行の書き換えは通す
    expect(values.setCell('lights', 'k0', 'on', false).ok).toBe(true)

    // 全体の上限: 16 欄の表を 2 つ並べ、合計のマスを上限まで埋める
    const columns = Array.from({ length: 16 }, (_, index) => ({ id: `c${String(index)}`, kind: 'toggle', label: '', address: `c${String(index)}`, type: 'i' }))
    const wide = (id: string, row: number) => ({ id, kind: 'table', row, column: 0, label: '', address: `/${id}`, rows: { source: 'target' }, columns })
    const many = adopted(pad([wide('a', 0), wide('b', 1)]))
    let filled = 0
    for (const table of ['a', 'b']) {
      for (let row = 0; row < PAD_DOCUMENT.MAX_TABLE_ROWS && filled < MAX_HELD_CELLS; row += 1) {
        for (let column = 0; column < 16 && filled < MAX_HELD_CELLS; column += 1) {
          commit(many.setCell(table, `r${String(row)}`, `c${String(column)}`, true))
          filled += 1
        }
      }
    }
    expect(many.setCell('b', 'r999', 'c15', true)).toMatchObject({ ok: false, reason: `too-many-rows: limit ${String(MAX_HELD_CELLS)}` })
  })

  it('resends the key list first and then only the widgets and columns that are resent', () => {
    const values = adopted()
    commit(values.set('level', 0.25))
    commit(values.set('mute', true))
    commit(values.setCell('members', 'm01', 'active', true))
    commit(values.setCell('members', 'm01', 'slot', 3))
    expect(values.resendMessages()).toEqual([
      { address: '/member/keys', args: [{ type: 's', value: 'm01' }, { type: 's', value: 'm02' }] },
      { address: '/mixer/level', args: [{ type: 'f', value: 0.25 }] },
      { address: '/member/m01/active', args: [{ type: 'i', value: 1 }] },
    ])
  })

  it('restores only values that still fit the adopted pad', () => {
    const values = createPadValues()
    const dropped = values.adopt(ALL, {
      widgets: [
        { widget: 'level', address: '/mixer/level', value: 0.5 },
        // 持ち主の部品の id が変わっていても、アドレスの持ち主の型で読めれば戻す
        { widget: 'old', address: '/scene/name', value: 'a' },
        { widget: 'gone', address: '/gone', value: 1 },
        { widget: 'scene', address: '/scene/name', value: 'b' },
        { widget: 'mute', address: '/mixer/mute', value: 3 },
      ],
      rows: [
        { widget: 'members', key: 'm01', column: 'active', address: '/member/m01/active', value: true },
        { widget: 'members', key: 'm09', column: 'active', address: '/member/m09/active', value: true },
        { widget: 'members', key: 'm02', column: 'active', address: '/other/m02/active', value: true },
      ],
    })
    expect(dropped).toBe(5)
    expect(values.snapshot()).toEqual({
      widgets: [{ widget: 'level', address: '/mixer/level', value: 0.5 }, { widget: 'scene', address: '/scene/name', value: 'a' }],
      rows: [{ widget: 'members', key: 'm01', column: 'active', address: '/member/m01/active', value: true }],
    })
  })

  it('reads echoes in the widget vocabulary and tells whether they differ from the held value', () => {
    const values = adopted()
    commit(values.set('level', 0.5))
    expect(values.echo('/mixer/level', [{ type: 'f', value: 0.5 }])).toEqual({
      widgets: [{ widget: 'level', value: 0.5 }, { widget: 'levelNumber', value: 0.5 }],
      rows: [],
      checked: [{ unit: 'level', mismatch: false }],
    })
    expect(values.echo('/mixer/level', [{ type: 'f', value: 0.75 }]).checked).toEqual([{ unit: 'level', mismatch: true }])
    // 部品の型として読めないエコーは値を付けない
    expect(values.echo('/mixer/level', [{ type: 's', value: 'x' }]).widgets).toEqual([{ widget: 'level' }, { widget: 'levelNumber' }])
    commit(values.setCell('members', 'm01', 'active', true))
    expect(values.echo('/member/m01/active', [{ type: 'i', value: 0 }])).toEqual({
      widgets: [],
      rows: [{ widget: 'members', key: 'm01', column: 'active', value: false }],
      checked: [{ unit: 'members[m01].active', mismatch: true }],
    })
    expect(values.echo('/unknown', [])).toEqual({ widgets: [], rows: [], checked: [] })
  })

  it('plans table actions for one row or for every row', () => {
    const values = adopted()
    expect(values.actionMessages('members', 'reset', undefined)).toEqual({
      ok: true,
      messages: [
        { address: '/member/m01/reset', args: [{ type: 'i', value: 1 }] },
        { address: '/member/m02/reset', args: [{ type: 'i', value: 1 }] },
      ],
    })
    expect(values.actionMessages('members', 'ghost', undefined)).toEqual({ ok: false, reason: 'unknown-action: members.ghost' })
  })

  it('converts a value for a widget without a pad (used by the owner check)', () => {
    expect(holderArgs(PadDocumentSchema.parse({ format: 'oscdesk-pad', version: 2, rows: 1, columns: 1, widgets: [SLIDER] }).widgets[0] as never, 0.1))
      .toEqual({ ok: true, args: [{ type: 'f', value: 0.1 }] })
  })
})
