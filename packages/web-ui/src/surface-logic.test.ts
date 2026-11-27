import { describe, expect, it } from 'vitest'

import type { ViewControl } from '@oscdesk/shared'

import {
  HOLD_TIMEOUT_MS,
  MIN_SEND_INTERVAL_MS,
  ValueChannel,
  ValueStore,
  colorHex,
  formatValues,
  holderLabel,
  itemStyle,
  parseColorHex,
  recordRows,
  resolveRecordActionSteps,
  sameValues,
  selectView,
  sliderStep,
  toggleState,
  validateInput,
  valuesFromWire,
  wireValue,
} from './surface-logic'

// 値の手触り(操作中の保護・送信の間引き・エコーの照合・入力欄の確定)

const control = (parts: Partial<ViewControl>): ViewControl => ({ param: 'p', label: 'P', type: 'f', kind: 'state', widget: 'slider', standalone: true, ...parts })

describe('ValueChannel', () => {
  it('keeps the own value while held and lets the echo win after release', () => {
    const channel = new ValueChannel('p')
    channel.onEcho([0.1])
    channel.beginHold(0)
    expect(channel.onLocal([0.5], 0)).toEqual([0.5])
    // 操作中のエコーは表示を変えず、離したときに戻る値だけを差し替える
    expect(channel.onEcho([0.2])).toBe(false)
    expect(channel.values).toEqual([0.5])
    expect(channel.preEditValues).toEqual([0.2])
    expect(channel.endHold(10)).toBeNull()
    // 送った値は確定せず、届いたエコーの値に戻る(送った値のエコーは後から届く)
    expect(channel.values).toEqual([0.2])
    expect(channel.onEcho([0.5])).toBe(true)
  })

  it('thins continuous sends and always sends the last value on release', () => {
    const channel = new ValueChannel('p')
    channel.beginHold(0)
    expect(channel.onLocal([0.1], 0)).toEqual([0.1])
    expect(channel.onLocal([0.2], 5)).toBeNull()
    expect(channel.onLocal([0.3], 10)).toBeNull()
    expect(channel.hasPending).toBe(true)
    expect(channel.flushDue(20)).toBeNull()
    expect(channel.flushDue(MIN_SEND_INTERVAL_MS + 1)).toEqual([0.3])
    expect(channel.onLocal([0.4], MIN_SEND_INTERVAL_MS + 2)).toBeNull()
    // 離したら間隔を待たずに最後の値を送る
    expect(channel.endHold(MIN_SEND_INTERVAL_MS + 3)).toEqual([0.4])
    expect(channel.hasPending).toBe(false)
  })

  it('expires a hold whose release was lost, and ignores a late release', () => {
    const channel = new ValueChannel('p')
    channel.onEcho([1])
    channel.beginHold(0)
    channel.onEcho([2])
    expect(channel.expireHold(HOLD_TIMEOUT_MS - 1)).toBeNull()
    expect(channel.holding).toBe(true)
    channel.expireHold(HOLD_TIMEOUT_MS)
    expect(channel.holding).toBe(false)
    expect(channel.values).toEqual([2])
    // 期限切れの後に届いた pointerup で、表示を消さない
    expect(channel.endHold(HOLD_TIMEOUT_MS + 1)).toBeNull()
    expect(channel.values).toEqual([2])
  })

  it('confirms a discrete operation without falling back to the pre-edit value', () => {
    const channel = new ValueChannel('p')
    channel.onEcho(['A'])
    channel.beginHold(0)
    channel.onLocalImmediate(['B'], 0)
    channel.endHold(1)
    expect(channel.values).toEqual(['B'])
  })

  it('cancels a hold without sending and restores the pre-edit value', () => {
    const channel = new ValueChannel('p')
    channel.onEcho([1])
    channel.beginHold(0)
    channel.onLocal([5], 0)
    channel.onLocal([6], 1)
    channel.setDraft('6')
    channel.cancelHold()
    expect(channel.values).toEqual([1])
    expect(channel.hasPending).toBe(false)
    expect(channel.draft).toBeNull()
  })
})

describe('ValueStore', () => {
  it('replaces the display with the full desired values and clears the ones without a value', () => {
    const store = new ValueStore()
    store.channel('a').onEcho([1])
    store.channel('b').onEcho([2])
    store.channel('c').onEcho([3])
    store.channel('c').beginHold(0)
    store.replaceAll(['a', 'b', 'c'], new Map([['a', [10]]]))
    expect(store.valuesOf('a')).toEqual([10])
    expect(store.valuesOf('b')).toBeNull()
    // 操作中は表示を据え置き、離したときに消える
    expect(store.valuesOf('c')).toEqual([3])
    store.channel('c').endHold(1)
    expect(store.valuesOf('c')).toBeNull()
  })
})

describe('wire values', () => {
  const tint = control({
    param: 'tint', type: 'composite', widget: 'color',
    fields: [control({ param: 'r' }), control({ param: 'g' }), control({ param: 'b' })],
  })

  it('writes and reads composite values as field objects (D-121)', () => {
    expect(wireValue(tint, [1, 0.5, 0])).toEqual({ r: 1, g: 0.5, b: 0 })
    expect(wireValue(tint, [1, 0.5])).toBeNull()
    expect(valuesFromWire(tint, { r: 1, g: 0.5, b: 0 })).toEqual([1, 0.5, 0])
    expect(valuesFromWire(tint, { r: 1, g: 0.5 })).toBeNull()
    expect(valuesFromWire(control({}), { r: 1 })).toBeNull()
    expect(wireValue(control({ type: 'bool' }), [1])).toBe(true)
    expect(wireValue(control({ type: 'i' }), [3.7])).toBe(3)
  })
})

describe('sameValues (echo matching)', () => {
  it('allows only the float32 round trip', () => {
    expect(sameValues([0.1], [Math.fround(0.1)], ['f'])).toBe(true)
    expect(sameValues([0.1], [0.1003], ['f'])).toBe(false)
    expect(sameValues([0], [0.00001], ['f'])).toBe(true)
  })

  it('compares integers and strings strictly', () => {
    expect(sameValues([16_777_217], [16_777_216], ['i'])).toBe(false)
    // f の値は整数に見えても float32 で比べる(16777217 は float32 で 16777216 になる)
    expect(sameValues([16_777_217], [16_777_216], ['f'])).toBe(true)
    expect(sameValues(['1'], [1])).toBe(false)
    expect(sameValues(['auto'], ['auto'])).toBe(true)
    expect(sameValues([true], [1], ['bool'])).toBe(true)
    expect(sameValues([1, 2], [1])).toBe(false)
  })
})

describe('validateInput', () => {
  it('rejects values outside the type and range instead of clamping', () => {
    const count = control({ type: 'i', widget: 'input', range: [0, 10] })
    expect(validateInput(count, '3')).toEqual({ ok: true, value: 3 })
    expect(validateInput(count, '3.5')).toMatchObject({ ok: false })
    expect(validateInput(count, '11')).toEqual({ ok: false, error: 'value is outside the declared range' })
    expect(validateInput(count, '')).toMatchObject({ ok: false })
    expect(validateInput(control({ type: 'f', widget: 'input' }), 'abc')).toMatchObject({ ok: false })
    expect(validateInput(control({ type: 'f', widget: 'input' }), ' 1.25 ')).toEqual({ ok: true, value: 1.25 })
    expect(validateInput(control({ type: 's', widget: 'input', options: ['A'] }), 'B')).toMatchObject({ ok: false })
    // 実行時の一覧の欄は、固定の候補に無い値も通す(値の所属を問わない)
    expect(validateInput(control({ type: 's', widget: 'input', options: ['A'], optionsFrom: 'list' }), 'B')).toEqual({ ok: true, value: 'B' })
  })
})

describe('display helpers', () => {
  it('formats values, steps, colors and the selection outside the list', () => {
    expect(formatValues(null)).toBe('-')
    expect(formatValues([0.5, true, 'x', 3])).toBe('0.5, on, x, 3')
    expect(sliderStep(control({ range: [0, 2] }))).toBe(0.002)
    expect(sliderStep(control({ type: 'i', range: [0, 100] }))).toBe(1)
    expect(colorHex([1, 0.5, 0])).toBe('#ff8000')
    expect(parseColorHex('#f80')).toEqual([1, 0x88 / 255, 0])
    expect(parseColorHex('red')).toBeNull()
    expect(selectView('X', ['A'], true)).toEqual({ selected: null, display: 'X(一覧に無い)' })
    expect(selectView('X', ['A'], false)).toEqual({ selected: null, display: 'X' })
    expect(selectView('A', ['A'], true)).toEqual({ selected: 'A', display: null })
    expect(itemStyle(undefined)).toContain('flex:1 1 160px')
    expect(itemStyle(8)).toContain('flex:8 1 0')
  })

  it('names the page for other browsers from the user agent (D-142)', () => {
    expect(holderLabel('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1')).toBe('iPad の Safari')
    expect(holderLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0')).toBe('Windows の Edge')
    expect(holderLabel('')).toBe('ブラウザ')
  })
})

describe('records', () => {
  it('orders rows by the key list, then by desired, and marks unlisted rows once a list arrived', () => {
    const rows = recordRows(['b', 'a'], ['a', 'c'], new Map([['b', 'Bee']]), true)
    expect(rows).toEqual([
      { key: 'b', name: 'Bee', listed: true, marked: false },
      { key: 'a', name: 'a', listed: true, marked: false },
      { key: 'c', name: 'c', listed: false, marked: true },
    ])
    expect(recordRows([], ['c'], new Map(), false)[0]?.marked).toBe(false)
  })

  it('expands record actions row by row and stops past the batch limit', () => {
    const action = { action: 'x', label: 'X', scope: 'all' as const, steps: [{ record: 'r', fixed: [] }, { record: 's', fixed: [] }] }
    expect(resolveRecordActionSteps(action, ['k1', 'k2']).map((target) => `${target.record}:${target.key}`)).toEqual(['r:k1', 's:k1', 'r:k2', 's:k2'])
    expect(resolveRecordActionSteps(action, Array.from({ length: 300 }, (_, index) => `k${String(index)}`))).toHaveLength(513)
  })

  it('shows a column toggle on only when every row is on', () => {
    expect(toggleState([[true], [true]], 0)).toEqual({ on: true, mixed: false })
    expect(toggleState([[true], [false]], 0)).toEqual({ on: false, mixed: true })
    expect(toggleState([[true], null], 0)).toEqual({ on: false, mixed: true })
    expect(toggleState([], 0)).toEqual({ on: false, mixed: false })
  })
})
