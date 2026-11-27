import { describe, expect, it } from 'vitest'

import { type PadDocument, type PadDocumentEdit, type PadWidget } from '@oscdesk/shared'

import { applyPadDocumentEdit, relativeAddressProblem } from './pad-document-editor'

// パッドの文書の版 2(D-167)の編集の規則の検査。UI は命令を送って答えを描くだけ

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const newPad = (rows = 4, columns = 4): PadDocument => ({ format: 'oscdesk-pad', version: 2, rows, columns, widgets: [] })

function edit(pad: PadDocument, ...commands: PadDocumentEdit[]): PadDocument {
  return commands.reduce((current, command) => {
    const result = applyPadDocumentEdit(current, command)
    if (!result.ok) throw new Error(`refused ${command.op}: ${result.detail}`)
    return result.pad
  }, pad)
}

function refusal(pad: PadDocument, command: PadDocumentEdit): string {
  const result = applyPadDocumentEdit(pad, command)
  if (result.ok) throw new Error(`accepted ${command.op}`)
  return result.detail
}

const find = (pad: PadDocument, id: string): PadWidget => {
  const widget = pad.widgets.find(candidate => candidate.id === id)
  if (widget === undefined) throw new Error(`no widget ${id}`)
  return widget
}

describe('applyPadDocumentEdit: 部品を置く・動かす', () => {
  it('adds a valid placeholder of every kind and does not change the draft', () => {
    const pad = newPad(3, 3)
    const kinds = ['button', 'toggle', 'slider', 'select', 'number', 'text', 'color', 'composite', 'table'] as const
    const filled = edit(pad, ...kinds.map((kind, index): PadDocumentEdit => ({ op: 'addWidget', kind, row: Math.floor(index / 3), column: index % 3 })))
    expect(pad.widgets).toEqual([])
    expect(filled.widgets.map(widget => [widget.id, widget.kind])).toEqual(kinds.map((kind, index) => [`w${String(index + 1)}`, kind]))
    expect(find(filled, 'w2')).toEqual({ id: 'w2', kind: 'toggle', row: 0, column: 1, label: 'w2', address: '/pad/w2', type: 'T', resend: true })
    expect(refusal(filled, { op: 'addWidget', kind: 'button', row: 0, column: 0 })).toContain('と重なります')
    expect(refusal(filled, { op: 'addWidget', kind: 'button', row: 3, column: 0 })).toBe('格子の外には置けません')
  })

  it('adds a widget from an OSCQuery node with the overrides', () => {
    const pad = edit(newPad(), { op: 'addWidgetFromNode', row: 1, column: 2, node: { address: '/volume', type: 'f', range: [{ MIN: 0, MAX: 1 }], access: 2 } })
    expect(find(pad, 'w1')).toEqual({ id: 'w1', kind: 'slider', row: 1, column: 2, label: 'volume', address: '/volume', type: 'f', min: 0, max: 1, resend: false })
    const overridden = edit(newPad(), { op: 'addWidgetFromNode', row: 0, column: 0, node: { address: '/volume', type: 'f', range: [{ MIN: 0, MAX: 1 }], access: 2 }, kind: 'number', resend: true })
    expect(find(overridden, 'w1')).toMatchObject({ kind: 'number', resend: true })
    expect(refusal(newPad(), { op: 'addWidgetFromNode', row: 0, column: 0, node: { address: '/big', type: 'h' } })).toBe('型 h の部品はありません')
  })

  it('moves and spans a widget without overlapping others', () => {
    let pad = edit(newPad(3, 3), { op: 'addWidget', kind: 'slider', row: 0, column: 0 }, { op: 'addWidget', kind: 'button', row: 2, column: 2 })
    pad = edit(pad, { op: 'spanWidget', widget: 'w1', rowSpan: 1, columnSpan: 3 })
    expect(find(pad, 'w1')).toMatchObject({ row: 0, column: 0, columnSpan: 3 })
    expect(find(pad, 'w1')).not.toHaveProperty('rowSpan')
    expect(refusal(pad, { op: 'spanWidget', widget: 'w1', rowSpan: 3, columnSpan: 3 })).toContain('と重なります')
    expect(refusal(pad, { op: 'moveWidget', widget: 'w1', row: 0, column: 1 })).toBe('格子の外には置けません')
    pad = edit(pad, { op: 'moveWidget', widget: 'w1', row: 1, column: 0 })
    expect(find(pad, 'w1')).toMatchObject({ row: 1, column: 0 })
    expect(refusal(pad, { op: 'resize', rows: 3, columns: 2 })).toContain('格子の外に出る部品があります')
    expect(edit(pad, { op: 'removeWidget', widget: 'w2' }, { op: 'resize', rows: 2, columns: 3 })).toMatchObject({ rows: 2, columns: 3 })
  })

  it('changes the kind, keeping the place, label, color, address and resend', () => {
    let pad = edit(newPad(), { op: 'addWidget', kind: 'toggle', row: 0, column: 0 })
    pad = edit(pad, { op: 'setLabel', widget: 'w1', label: 'Light' }, { op: 'setColor', widget: 'w1', color: '#ff0000' }, { op: 'setAddress', widget: 'w1', address: '/light' }, { op: 'setResend', widget: 'w1', resend: false })
    const slider = edit(pad, { op: 'setKind', widget: 'w1', kind: 'slider' })
    expect(find(slider, 'w1')).toEqual({ id: 'w1', kind: 'slider', row: 0, column: 0, label: 'Light', color: '#FF0000', address: '/light', type: 'f', min: 0, max: 1, resend: false })
    expect(find(edit(slider, { op: 'setKind', widget: 'w1', kind: 'button' }), 'w1')).toEqual({ id: 'w1', kind: 'button', row: 0, column: 0, label: 'Light', color: '#FF0000', address: '/light', args: [] })
  })

  it('pastes copied settings, keeping the id and place', () => {
    let pad = edit(newPad(), { op: 'addWidget', kind: 'button', row: 0, column: 0 }, { op: 'addWidget', kind: 'button', row: 1, column: 1 })
    pad = edit(pad, { op: 'pasteSettings', widget: 'w2', settings: { id: 'zz', row: 3, column: 3, kind: 'toggle', label: 'L', address: '/l', type: 'i' } })
    expect(find(pad, 'w2')).toEqual({ id: 'w2', row: 1, column: 1, kind: 'toggle', label: 'L', address: '/l', type: 'i', resend: true })
    expect(refusal(pad, { op: 'pasteSettings', widget: 'w2', settings: { kind: 'toggle', label: 'L', address: '/l', type: 'f' } })).toMatch(/^パッドとして不正です/)
  })
})

describe('applyPadDocumentEdit: ボタンとアドレス', () => {
  it('edits the fixed values of a button, including T / F', () => {
    let pad = edit(newPad(), { op: 'addWidget', kind: 'button', row: 0, column: 0 })
    pad = edit(pad, { op: 'addArg', widget: 'w1', type: 'i' }, { op: 'addArg', widget: 'w1', type: 'T' }, { op: 'setArgValue', widget: 'w1', index: 0, raw: '42' })
    expect(find(pad, 'w1')).toMatchObject({ args: [{ type: 'i', value: 42 }, { type: 'T' }] })
    expect(refusal(pad, { op: 'setArgValue', widget: 'w1', index: 1, raw: '1' })).toContain('値を持ちません')
    pad = edit(pad, { op: 'setArgType', widget: 'w1', index: 0, type: 'f' }, { op: 'setArgType', widget: 'w1', index: 1, type: 'F' }, { op: 'moveArg', widget: 'w1', index: 0, delta: 1 })
    expect(find(pad, 'w1')).toMatchObject({ args: [{ type: 'F' }, { type: 'f', value: 42 }] })
    expect(refusal(pad, { op: 'setArgValue', widget: 'w1', index: 1, raw: '1e300' })).toContain('float32')
    expect(refusal(edit(pad, { op: 'addWidget', kind: 'toggle', row: 1, column: 0 }), { op: 'addArg', widget: 'w2', type: 'i' })).toContain('ボタンと表のアクションだけ')
  })

  it('sets an image only on a button', () => {
    let pad = edit(newPad(), { op: 'addWidget', kind: 'button', row: 0, column: 0 }, { op: 'addWidget', kind: 'toggle', row: 0, column: 1 })
    pad = edit(pad, { op: 'setImage', widget: 'w1', data: PNG_1PX })
    expect(find(pad, 'w1')).toMatchObject({ image: `data:image/png;base64,${PNG_1PX}` })
    expect(refusal(pad, { op: 'setImage', widget: 'w2', data: PNG_1PX })).toBe('画像はボタンだけに付けられます')
    expect(refusal(pad, { op: 'setImage', widget: 'w1', data: 'PHN2Zy8+' })).toContain('PNG / JPEG / GIF / WebP')
  })

  it('checks absolute and relative addresses', () => {
    const pad = edit(newPad(), { op: 'addWidget', kind: 'toggle', row: 0, column: 0 })
    expect(refusal(pad, { op: 'setAddress', widget: 'w1', address: '/sys/ping' })).toBe('/sys と /oscdesk は予約されています')
    expect(relativeAddressProblem('active')).toBeNull()
    expect(relativeAddressProblem('audio/gain')).toBeNull()
    expect(relativeAddressProblem('/active')).toContain('/ で始めません')
    expect(relativeAddressProblem('a/')).toContain('末尾の /')
    expect(relativeAddressProblem('a*')).toContain('*')
  })
})

describe('applyPadDocumentEdit: 値を持つ部品', () => {
  it('reads ranges and steps typed by the widget and refuses an empty slider range', () => {
    let pad = edit(newPad(), { op: 'addWidget', kind: 'slider', row: 0, column: 0 })
    pad = edit(pad, { op: 'setRange', widget: 'w1', min: '-1.5', max: '2' }, { op: 'setStep', widget: 'w1', step: '0.5' })
    expect(find(pad, 'w1')).toMatchObject({ type: 'f', min: -1.5, max: 2, step: 0.5 })
    expect(refusal(pad, { op: 'setRange', widget: 'w1', min: '1', max: '1' })).toBe('最大は最小より大きくしてください')
    expect(refusal(pad, { op: 'setRange', widget: 'w1', min: null, max: '1' })).toContain('両方が要ります')
    expect(refusal(pad, { op: 'setStep', widget: 'w1', step: '0' })).toContain('0 より大きい')
    // 型を i にすると、範囲は整数へ丸め、整数でない刻みは外す
    const int = edit(pad, { op: 'setValueType', widget: 'w1', type: 'i' })
    expect(find(int, 'w1')).toEqual({ id: 'w1', kind: 'slider', row: 0, column: 0, label: 'w1', address: '/pad/w1', type: 'i', min: -1, max: 2, resend: true })
    expect(refusal(int, { op: 'setValueType', widget: 'w1', type: 's' })).toBe('スライダー の型は i / f です')
    expect(refusal(int, { op: 'setRange', widget: 'w1', min: '0.5', max: '3' })).toBe('整数を入力してください')
  })

  it('allows a one-sided range on a number input', () => {
    let pad = edit(newPad(), { op: 'addWidget', kind: 'number', row: 0, column: 0 })
    pad = edit(pad, { op: 'setRange', widget: 'w1', min: '0', max: null })
    expect(find(pad, 'w1')).toMatchObject({ min: 0 })
    expect(find(pad, 'w1')).not.toHaveProperty('max')
    expect(refusal(pad, { op: 'setRange', widget: 'w1', min: '2', max: '1' })).toBe('最大は最小以上にしてください')
  })

  it('edits the options of a select and converts them with the type', () => {
    let pad = edit(newPad(), { op: 'addWidget', kind: 'select', row: 0, column: 0 })
    pad = edit(pad, { op: 'setOption', widget: 'w1', index: 0, raw: '1', label: 'One' }, { op: 'addOption', widget: 'w1', raw: 'two' }, { op: 'addOption', widget: 'w1', raw: '3' })
    expect(refusal(pad, { op: 'addOption', widget: 'w1', raw: 'two' })).toBe('候補 two は既にあります')
    const int = edit(pad, { op: 'setValueType', widget: 'w1', type: 'i' })
    expect(find(int, 'w1')).toMatchObject({ type: 'i', options: [{ value: 1, label: 'One' }, { value: 3 }] })
    const moved = edit(int, { op: 'moveOption', widget: 'w1', index: 0, delta: 1 }, { op: 'removeOption', widget: 'w1', index: 1 })
    expect(find(moved, 'w1')).toMatchObject({ options: [{ value: 3 }] })
    expect(refusal(moved, { op: 'removeOption', widget: 'w1', index: 0 })).toBe('候補は 1 つ以上要ります')
  })

  it('makes a widget read-only, which never resends', () => {
    let pad = edit(newPad(), { op: 'addWidget', kind: 'number', row: 0, column: 0 })
    pad = edit(pad, { op: 'setReadOnly', widget: 'w1', readOnly: true })
    expect(find(pad, 'w1')).toMatchObject({ readOnly: true, resend: false })
    expect(find(edit(pad, { op: 'setReadOnly', widget: 'w1', readOnly: false }), 'w1')).not.toHaveProperty('readOnly')
    const button = edit(newPad(), { op: 'addWidget', kind: 'button', row: 0, column: 0 })
    expect(refusal(button, { op: 'setResend', widget: 'w1', resend: true })).toContain('送り直しません')
  })

  it('edits the fields of a composite', () => {
    let pad = edit(newPad(), { op: 'addWidget', kind: 'composite', row: 0, column: 0 })
    pad = edit(pad,
      { op: 'addField', widget: 'w1', kind: 'toggle' },
      { op: 'setKind', widget: 'w1', part: { field: 0 }, kind: 'slider' },
      { op: 'setLabel', widget: 'w1', part: { field: 0 }, label: 'X' },
      { op: 'setValueType', widget: 'w1', part: { field: 1 }, type: 'i' },
      { op: 'moveField', widget: 'w1', index: 0, delta: 1 })
    expect(find(pad, 'w1')).toMatchObject({ fields: [{ id: 'a2', label: 'a2', kind: 'toggle', type: 'i' }, { id: 'a1', label: 'X', kind: 'slider', type: 'f', min: 0, max: 1 }] })
    expect(refusal(pad, { op: 'setKind', widget: 'w1', part: { field: 0 }, kind: 'color' })).toContain('置けません')
    expect(refusal(pad, { op: 'setAddress', widget: 'w1', part: { field: 0 }, address: 'x' })).toContain('アドレスを持ちません')
    expect(refusal(pad, { op: 'setValueType', widget: 'w1', type: 'f' })).toContain('引数・欄を選んでください')
    expect(refusal(edit(pad, { op: 'removeField', widget: 'w1', index: 0 }), { op: 'removeField', widget: 'w1', index: 0 })).toContain('1 つ以上要ります')
  })
})

describe('applyPadDocumentEdit: 表', () => {
  const tablePad = () => edit(newPad(), { op: 'addWidget', kind: 'table', row: 0, column: 0 }, { op: 'setAddress', widget: 'w1', address: '/member' })

  it('manages UI rows with ASCII keys and display labels', () => {
    let pad = edit(tablePad(), { op: 'addRow', widget: 'w1', key: 'A1', label: 'メンバーA' }, { op: 'addRow', widget: 'w1', key: 'B2', label: '' })
    expect(refusal(pad, { op: 'addRow', widget: 'w1', key: 'メンバー', label: '' })).toContain('英数字と _ -')
    expect(refusal(pad, { op: 'addRow', widget: 'w1', key: 'A1', label: '' })).toBe('行 A1 は既にあります')
    pad = edit(pad, { op: 'moveRow', widget: 'w1', key: 'B2', delta: -1 }, { op: 'setRowLabel', widget: 'w1', key: 'B2', label: 'メンバーB' })
    expect(find(pad, 'w1')).toMatchObject({ rows: { source: 'ui', keys: [{ key: 'B2', label: 'メンバーB' }, { key: 'A1', label: 'メンバーA' }] } })
    expect(refusal(pad, { op: 'setRowSource', widget: 'w1', source: 'target' })).toContain('先に行を消してください')
    pad = edit(pad, { op: 'removeRow', widget: 'w1', key: 'A1' }, { op: 'removeRow', widget: 'w1', key: 'B2' }, { op: 'setRowSource', widget: 'w1', source: 'target' })
    expect(find(pad, 'w1')).toMatchObject({ rows: { source: 'target' } })
    expect(refusal(pad, { op: 'addRow', widget: 'w1', key: 'A', label: '' })).toContain('ターゲットが持つ行は編集できません')
  })

  it('edits columns with relative addresses, resend and bulk toggles', () => {
    let pad = edit(tablePad(),
      { op: 'addColumn', widget: 'w1', kind: 'slider' },
      { op: 'setAddress', widget: 'w1', part: { column: 'c2' }, address: 'audio/gain' },
      { op: 'setResend', widget: 'w1', part: { column: 'c2' }, resend: false },
      { op: 'setColumnBulk', widget: 'w1', column: 'c1', bulk: true },
      { op: 'setRange', widget: 'w1', part: { column: 'c2' }, min: '0', max: '2' })
    expect(find(pad, 'w1')).toMatchObject({ columns: [
      { id: 'c1', address: 'c1', kind: 'toggle', type: 'T', resend: true, bulk: true },
      { id: 'c2', address: 'audio/gain', kind: 'slider', type: 'f', min: 0, max: 2, resend: false },
    ] })
    expect(refusal(pad, { op: 'setColumnBulk', widget: 'w1', column: 'c2', bulk: true })).toContain('トグルの欄だけ')
    expect(refusal(pad, { op: 'setAddress', widget: 'w1', part: { column: 'c2' }, address: 'c1' })).toContain('ほかの欄かアクションが使っています')
    pad = edit(pad, { op: 'moveColumn', widget: 'w1', column: 'c2', delta: -1 }, { op: 'removeColumn', widget: 'w1', column: 'c1' })
    expect(find(pad, 'w1')).toMatchObject({ columns: [{ id: 'c2' }] })
    expect(refusal(pad, { op: 'removeColumn', widget: 'w1', column: 'c2' })).toContain('1 つ以上要ります')
  })

  it('edits row and all-rows actions and their fixed values', () => {
    let pad = edit(tablePad(), { op: 'addAction', widget: 'w1', scope: 'row' }, { op: 'addAction', widget: 'w1', scope: 'all' })
    pad = edit(pad,
      { op: 'setAddress', widget: 'w1', part: { action: 'act1' }, address: 'reset' },
      { op: 'setLabel', widget: 'w1', part: { action: 'act1' }, label: 'Reset' },
      { op: 'addArg', widget: 'w1', part: { action: 'act1' }, type: 's' },
      { op: 'setArgValue', widget: 'w1', part: { action: 'act1' }, index: 0, raw: 'now' },
      { op: 'setActionScope', widget: 'w1', action: 'act2', scope: 'row' })
    expect(find(pad, 'w1')).toMatchObject({ actions: [
      { id: 'act1', label: 'Reset', scope: 'row', address: 'reset', args: [{ type: 's', value: 'now' }] },
      { id: 'act2', label: 'act2', scope: 'row', address: 'act2', args: [] },
    ] })
    expect(refusal(pad, { op: 'setAddress', widget: 'w1', part: { action: 'act2' }, address: 'c1' })).toContain('ほかの欄かアクションが使っています')
    pad = edit(pad, { op: 'removeAction', widget: 'w1', action: 'act1' }, { op: 'removeAction', widget: 'w1', action: 'act2' })
    expect(find(pad, 'w1')).not.toHaveProperty('actions')
  })
})

describe('applyPadDocumentEdit: 作業コピー', () => {
  it('refuses an invalid draft and a version 1 draft', () => {
    expect(applyPadDocumentEdit({ format: 'oscdesk-pad', version: 1, rows: 1, columns: 1, buttons: [] }, { op: 'resize', rows: 2, columns: 2 }).ok).toBe(false)
    expect(refusal(newPad(), { op: 'removeWidget', widget: 'nope' })).toBe('部品 nope がありません')
  })
})
