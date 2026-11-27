import { describe, expect, it } from 'vitest'

import type { PadTableWidget, PadWidget } from '@oscdesk/shared'

import { createPadEditStore } from './pad-edit-store'
import { createPadStore } from './pad-store'
import { PAD_NAME, PAD_VERSION, STAGE_PAD, padDocumentFrame, padListFrame, padValuesFrame } from './pad-test-support'
import { createTestLink, wireSample } from './test-support'
import { HOLD_TIMEOUT_MS, TICK_MS } from './value-channel'

function setup() {
  const test = createTestLink()
  const pad = createPadStore({
    link: test.link, notices: test.notices, now: test.timers.now, setTimer: test.timers.setTimer, clearTimer: test.timers.clearTimer,
    holder: 'me', holderLabel: 'test', randomId: () => 'r', logInfo: () => undefined,
  })
  const receive = (frame: unknown) => test.socket().receive(frame)
  receive(wireSample('downstream-hello'))
  receive(padListFrame())
  receive(padDocumentFrame())
  const widget = (id: string) => pad.adopted.value!.pad.widgets.find((item) => item.id === id) as PadWidget
  return { ...test, pad, receive, widget }
}

describe('pad store (D-170)', () => {
  it('does not apply values of another pad name or version', () => {
    const { pad, receive } = setup()
    receive(padValuesFrame([{ widget: 'level', value: 0.3 }], [], { name: 'other' }))
    receive(padValuesFrame([{ widget: 'level', value: 0.4 }], [], { version: 'old' }))
    expect(pad.channelOf('level').values).toBeNull()
    receive(padValuesFrame([{ widget: 'level', value: 0.5 }, { widget: 'fire', value: 1 }, { widget: 'ghost', value: 1 }]))
    expect(pad.channelOf('level').values).toEqual([0.5])
    // ボタンと知らない部品の値は持たない
    expect(pad.channelOf('fire').values).toBeNull()
  })

  it('refuses to operate a widget another browser is holding, and asks the bridge to lock while this tab holds one', () => {
    const { pad, receive, widget, socket } = setup()
    receive({ v: 1, type: 'locks', locks: [{ ref: { widget: 'level' }, clientId: 'other', holder: 'them', label: 'iPad' }] })
    expect(pad.widgetLockLabel('level')).toBe('iPad')
    expect(pad.setDiscrete(widget('level'), [0.1])).toBe(false)
    expect(socket().ofType('osc.padSet')).toHaveLength(0)
    // 行のロックは行の単位だけ
    receive({ v: 1, type: 'locks', locks: [{ ref: { widget: 'members', key: 'm01' }, clientId: 'other', holder: 'them', label: 'iPad' }] })
    expect(pad.rowLockLabel('members', 'm01')).toBe('iPad')
    expect(pad.rowLockLabel('members', 'm02')).toBeNull()
    expect(pad.widgetLockLabel('members')).toBeNull()
  })

  it('releases the lock of a hold whose pointerup never came', () => {
    const { pad, widget, socket, timers } = setup()
    expect(pad.beginHold(widget('level'), 'slider')).toBe(true)
    expect(socket().ofType('lock')).toHaveLength(1)
    timers.advance(HOLD_TIMEOUT_MS + TICK_MS)
    expect(socket().ofType('unlock').at(-1)).toMatchObject({ ref: { widget: 'level' }, holder: 'me' })
  })

  it('keeps nothing of the old pad when a different pad is adopted (no stale send under the new version)', () => {
    const { pad, receive, widget, socket, timers } = setup()
    const level = widget('level')
    pad.beginHold(level, 'slider')
    pad.setLocal(level, [0.1])
    pad.setLocal(level, [0.2])
    receive(padDocumentFrame({ ...STAGE_PAD, widgets: STAGE_PAD.widgets.filter((item) => item.id !== 'fire') }, { version: 'v2', revision: 2 }))
    timers.advance(TICK_MS)
    pad.endHold(level)
    // 間引いて残っていた 0.2 は、新しい版では送らない
    expect(socket().ofType('osc.padSet').map((frame) => frame.value)).toEqual([0.1])
    expect(socket().ofType('unlock')).toHaveLength(1)
  })

  it('forgets the targets, locks and resend setting on a disconnect', () => {
    const { pad, receive, socket } = setup()
    receive(wireSample('downstream-osc-query-targets'))
    receive({ v: 1, type: 'osc.padResend', auto: true })
    expect(pad.queryTargets.value).toHaveLength(2)
    socket().drop()
    expect(pad.queryTargets.value).toHaveLength(0)
    expect(pad.autoResend.value).toBeNull()
    expect(pad.connected.value).toBe(false)
  })

  it('lists the rows of a target table from the namespace and the held values', () => {
    const { pad, receive } = setup()
    const target: PadTableWidget = { ...(STAGE_PAD.widgets.find((item) => item.id === 'members') as PadTableWidget), rows: { source: 'target' } }
    receive(padDocumentFrame({ ...STAGE_PAD, widgets: STAGE_PAD.widgets.map((item) => item.id === 'members' ? target : item) }, { version: 'v2' }))
    const frame = wireSample('downstream-osc-query-targets')
    if (frame.type !== 'osc.queryTargets') throw new Error('not targets')
    const first = frame.targets[0]!
    receive({ ...frame, targets: [{ ...first, palette: [...first.palette, { ...first.palette[0]!, address: '/member/m07/active' }] }] })
    receive(padValuesFrame([], [{ widget: 'members', key: 'm03', column: 'active', value: true }], { version: 'v2' }))
    const table = pad.adopted.value!.pad.widgets.find((item) => item.id === 'members') as PadTableWidget
    expect(pad.rowsOf(table).map((row) => row.key)).toEqual(['m03', 'm07'])
  })

  it('keeps cell channels to the rows on show: echoes of other rows are dropped and vanished rows are released', () => {
    const { pad, receive } = setup()
    const target: PadTableWidget = { ...(STAGE_PAD.widgets.find((item) => item.id === 'members') as PadTableWidget), rows: { source: 'target' } }
    receive(padDocumentFrame({ ...STAGE_PAD, widgets: STAGE_PAD.widgets.map((item) => item.id === 'members' ? target : item) }, { version: 'v2' }))
    const frame = wireSample('downstream-osc-query-targets')
    if (frame.type !== 'osc.queryTargets') throw new Error('not targets')
    const first = frame.targets[0]!
    const withRow = (key: string) => ({ ...frame, targets: [{ ...first, palette: [{ ...first.palette[0]!, address: `/member/${key}/active` }] }] })
    receive(withRow('m07'))
    // ターゲットが返す、表に出していない行のエコーはチャンネルを作らない
    for (let index = 0; index < 50; index += 1) {
      receive({ v: 1, type: 'osc.padEcho', version: 'v2', widgets: [], rows: [{ widget: 'members', key: `x${String(index)}`, column: 'active', value: true }] })
    }
    receive({ v: 1, type: 'osc.padEcho', version: 'v2', widgets: [], rows: [{ widget: 'members', key: 'm07', column: 'active', value: true }] })
    expect(pad.cellKeyCount()).toBe(1)
    expect(pad.cellChannelOf('members', 'm07', 'active').values).toEqual([true])
    // 名前空間から行が消えたら回収する
    receive(withRow('m08'))
    expect(pad.cellKeyCount()).toBe(0)
  })

  it('ends the hold and the row lock of a cell whose row vanished from the namespace, without waiting for a blur', () => {
    const { pad, receive, socket, timers } = setup()
    const target: PadTableWidget = { ...(STAGE_PAD.widgets.find((item) => item.id === 'members') as PadTableWidget), rows: { source: 'target' } }
    receive(padDocumentFrame({ ...STAGE_PAD, widgets: STAGE_PAD.widgets.map((item) => item.id === 'members' ? target : item) }, { version: 'v2' }))
    const frame = wireSample('downstream-osc-query-targets')
    if (frame.type !== 'osc.queryTargets') throw new Error('not targets')
    const first = frame.targets[0]!
    const withRow = (key: string) => ({ ...frame, targets: [{ ...first, palette: [{ ...first.palette[0]!, address: `/member/${key}/active` }] }] })
    receive(withRow('m07'))
    const table = pad.adopted.value!.pad.widgets.find((item) => item.id === 'members') as PadTableWidget
    // 入力欄のフォーカス中(tick がホールドを延ばし続ける状態)
    expect(pad.beginCellHold(table, 'm07', 'active', 'input')).toBe(true)
    pad.setCellEditing(table, 'm07', 'active', true)
    expect(socket().ofType('lock').at(-1)).toMatchObject({ ref: { widget: 'members', key: 'm07' } })
    receive(withRow('m08'))
    expect(socket().ofType('unlock').at(-1)).toMatchObject({ ref: { widget: 'members', key: 'm07' } })
    expect(pad.cellKeyCount()).toBe(0)
    const locks = socket().ofType('lock').length
    timers.advance(5_000)
    expect(socket().ofType('lock')).toHaveLength(locks)
    // 後から届いた blur の終わりは何もしない
    pad.endCellHold(table, 'm07', 'active')
    expect(socket().ofType('osc.padSetCell')).toHaveLength(0)
  })

  it('names the sync a late answer belongs to, and does not grow the memory without bound', () => {
    const { pad, receive, notices } = setup()
    for (let index = 0; index < 40; index += 1) pad.sync({ label: `PC ${String(index)}`, target: 'unity' })
    receive({ v: 1, type: 'notice', level: 'error', code: 'pad-sync-rejected', detail: 'unknown-target: unity', requestId: 'padsync-40-r' })
    expect(notices.history.value.at(-1)?.text).toBe('「PC 39」へ同期できませんでした: unknown-target: unity')
    // 古い印は忘れている(名前を付けずに知らせる)
    receive({ v: 1, type: 'notice', level: 'info', code: 'pad-synced', detail: 'x', requestId: 'padsync-1-r' })
    expect(notices.history.value.at(-1)?.text).toBe('同期しました: x')
  })
})

describe('pad edit store (D-170)', () => {
  it('follows another browser\'s save while there are no local changes, and keeps the draft when there are', () => {
    const { pad, receive, link, notices, timers, socket } = setup()
    const edit = createPadEditStore({ link, notices, pad, setTimer: timers.setTimer, clearTimer: timers.clearTimer, randomId: () => 'e' })
    edit.setEditing(true)
    expect(edit.session.value?.baseVersion).toBe(PAD_VERSION)
    const smaller = { ...STAGE_PAD, widgets: STAGE_PAD.widgets.slice(1) }
    receive(padDocumentFrame(smaller, { version: 'v2', revision: 2 }))
    expect(edit.draft.value).toEqual(smaller)

    edit.remove('mute')
    const request = socket().ofType('osc.padDocumentEdit').at(-1) as { requestId: string }
    const edited = { ...smaller, widgets: smaller.widgets.filter((item) => item.id !== 'mute') }
    receive({ v: 1, type: 'osc.padDocumentEdited', requestId: request.requestId, result: { ok: true, pad: edited } })
    expect(edit.session.value?.dirty).toBe(true)
    // 未保存の変更があれば、別の端末の保存で作業コピーを上書きしない
    receive(padDocumentFrame(STAGE_PAD, { version: 'v3', revision: 3 }))
    expect(edit.draft.value).toEqual(edited)
    expect(edit.conflicted.value).toBe(true)
    expect(PAD_NAME).toBe('stage')
  })

  it('keeps a rejected typed input instead of following another browser\'s save, and saves with the base version unless overwriting', () => {
    const { pad, receive, link, notices, timers, socket } = setup()
    const edit = createPadEditStore({ link, notices, pad, setTimer: timers.setTimer, clearTimer: timers.clearTimer, randomId: () => 'e' })
    edit.setEditing(true)
    edit.setFieldText('address-key', '')
    edit.editField({ op: 'setAddress', widget: 'level', address: '' })
    const request = socket().ofType('osc.padDocumentEdit').at(-1) as { requestId: string }
    receive({ v: 1, type: 'osc.padDocumentEdited', requestId: request.requestId, result: { ok: false, detail: 'アドレスを入力してください' } })
    expect(edit.session.value?.dirty).toBe(false)
    expect(edit.unsaved.value).toBe(true)
    // 別の端末が同じ内容を保存し直した(版だけが進む)。断られた入力は黙って消さない
    receive(padDocumentFrame(STAGE_PAD, { version: 'v2', revision: 2 }))
    expect(edit.fieldTexts.value.get('address-key')).toBe('')
    expect(edit.fieldErrors.value.size).toBe(1)
    expect(edit.conflicted.value).toBe(true)
    // 上書きを確かめた保存は版を付けない
    edit.save()
    edit.answerConfirm(true)
    expect(socket().ofType('osc.padSave').at(-1)).not.toHaveProperty('baseVersion')

    // 未変更なら、もとにした版を付けて保存する
    const fresh = createPadEditStore({ link, notices, pad, setTimer: timers.setTimer, clearTimer: timers.clearTimer, randomId: () => 'f' })
    fresh.setEditing(true)
    fresh.save()
    expect(socket().ofType('osc.padSave').at(-1)).toMatchObject({ name: PAD_NAME, baseVersion: 'v2' })
  })

  it('drops a rejected input that was discarded by switching pads, and follows the new pad', () => {
    const { pad, receive, link, notices, timers, socket } = setup()
    const edit = createPadEditStore({ link, notices, pad, setTimer: timers.setTimer, clearTimer: timers.clearTimer, randomId: () => 'e' })
    edit.setEditing(true)
    edit.setFieldText('address-key', '')
    edit.editField({ op: 'setAddress', widget: 'level', address: '' })
    const request = socket().ofType('osc.padDocumentEdit').at(-1) as { requestId: string }
    receive({ v: 1, type: 'osc.padDocumentEdited', requestId: request.requestId, result: { ok: false, detail: 'アドレスを入力してください' } })
    edit.load('other')
    // 未反映の入力があるので破棄を確かめる
    expect(edit.confirm.value?.message).toContain('保存していない変更があります')
    edit.answerConfirm(true)
    expect(socket().ofType('osc.padLoad').at(-1)).toMatchObject({ name: 'other' })
    const other = { ...STAGE_PAD, widgets: STAGE_PAD.widgets.slice(0, 2) }
    receive(padDocumentFrame(other, { name: 'other', version: 'o1' }))
    expect(edit.unsaved.value).toBe(false)
    expect(edit.fieldErrors.value.size).toBe(0)
    expect(edit.fieldTexts.value.size).toBe(0)
    expect(edit.draft.value).toEqual(other)
    expect(edit.session.value?.baseName).toBe('other')
  })

  it('holds back structural edits while an answer is pending and keeps only the last text edit per field', () => {
    const { pad, link, notices, timers, socket, receive } = setup()
    const edit = createPadEditStore({ link, notices, pad, setTimer: timers.setTimer, clearTimer: timers.clearTimer, randomId: () => 'e' })
    edit.setEditing(true)
    edit.edit({ op: 'setKind', widget: 'mute', kind: 'button' })
    edit.edit({ op: 'removeWidget', widget: 'level' })
    expect(notices.history.value.at(-1)?.text).toContain('前の変更を反映しています')
    // 構造の命令の答えを待つ間は入力欄も読み取り専用(預かった入力が別の欄に当たらないように)
    expect(edit.formLocked.value).toBe(true)
    const first = socket().ofType('osc.padDocumentEdit').at(-1) as { requestId: string }
    receive({ v: 1, type: 'osc.padDocumentEdited', requestId: first.requestId, result: { ok: true, pad: STAGE_PAD } })
    edit.editField({ op: 'setLabel', widget: 'level', label: 'a' })
    edit.editField({ op: 'setLabel', widget: 'level', label: 'ab' })
    edit.editField({ op: 'setLabel', widget: 'level', label: 'abc' })
    const second = socket().ofType('osc.padDocumentEdit').at(-1) as { requestId: string }
    receive({ v: 1, type: 'osc.padDocumentEdited', requestId: second.requestId, result: { ok: true, pad: STAGE_PAD } })
    expect(socket().ofType('osc.padDocumentEdit').map((frame) => (frame.edit as { label?: string }).label)).toEqual([undefined, 'a', 'abc'])
  })
})
