// OSC パッドのタブの状態(D-080・D-126・D-147)。偽の WebSocket にフレームを流し、送ったフレームと signal を確かめる。
// NiceGUI 版の test_osc_pad.py・test_osc_pad_panel.py の振る舞い(編集命令の往復・答えを待つ間の命令・保存と切り替えの照合・
// 他の端末の保存への追従・押下の版)に当たる。画面との結線は osc-pad.dom.test.tsx
import { describe, expect, it } from 'vitest'

import type { OscPad } from '@oscdesk/shared'

import { BUSY_MESSAGE, EDIT_TIMEOUT_MS, newPad } from './osc-pad-logic'
import { createOscPadStore } from './osc-pad-store'
import { createTestLink, wireSample } from './test-support'

const PAD: OscPad = {
  format: 'oscdesk-pad', version: 1, rows: 1, columns: 2,
  buttons: [{ id: 'b1', row: 0, column: 0, label: 'Fire', address: '/fx/fire', args: [{ type: 'i', value: 1 }] }],
}

function setup() {
  const test = createTestLink()
  const store = createOscPadStore({
    link: test.link,
    notices: test.notices,
    setTimer: test.timers.setTimer,
    clearTimer: test.timers.clearTimer,
    randomId: () => 'r',
  })
  const socket = test.socket
  const hello = () => socket().receive(wireSample('downstream-hello'))
  const adopt = (pad: OscPad, version: string, name = 'take-01') =>
    socket().receive({ v: 1, type: 'osc.pad', name, revision: 1, version, at: '2026-10-18T10:00:00.000Z', pad })
  const edits = () => socket().ofType('osc.padEdit') as { requestId: string; draft: OscPad; edit: Record<string, unknown> }[]
  const answer = (pad: OscPad, index = -1) => socket().receive({ v: 1, type: 'osc.padEdited', requestId: edits().at(index)!.requestId, result: { ok: true, pad } })
  const refuse = (detail: string, index = -1) => socket().receive({ v: 1, type: 'osc.padEdited', requestId: edits().at(index)!.requestId, result: { ok: false, detail } })
  const texts = () => test.notices.items.value.map((notice) => notice.text)
  return { ...test, store, hello, adopt, edits, answer, refuse, texts }
}

const withLabel = (pad: OscPad, label: string): OscPad => ({ ...pad, buttons: pad.buttons.map((button) => ({ ...button, label })) })

describe('osc pad store', () => {
  it('requests the pad on every hello, including after reconnecting (the bridge does not send it by itself)', () => {
    const { store, socket, hello, timers } = setup()
    hello()
    expect(socket().ofType('osc.padRequest')).toHaveLength(1)
    expect(store.oscAvailable.value).toBe(true)
    socket().drop()
    timers.advance(1_000)
    socket().open()
    hello()
    expect(socket().ofType('osc.padRequest')).toHaveLength(1)
  })

  it('presses with the drawn version and warns when it cannot send', () => {
    const { store, socket, adopt, texts } = setup()
    adopt(PAD, 'e-1')
    store.press('b1', 'e-1')
    expect(socket().ofType('osc.padPress')).toEqual([{ v: 1, type: 'osc.padPress', name: 'take-01', version: 'e-1', button: 'b1' }])
    socket().drop()
    store.press('b1', 'e-1')
    expect(texts()).toContain('ブリッジに接続していないため送れませんでした')
  })

  it('changes only this screen when the grid is resized outside the edit mode (D-084)', () => {
    const { store, socket, adopt } = setup()
    adopt(PAD, 'e-1')
    store.resize(3, null)
    expect(store.gridSize.value).toEqual({ rows: 3, columns: 2 })
    expect(socket().ofType('osc.padEdit')).toHaveLength(0)
    store.resize(1, null)
    expect(store.viewSize.value).toBeNull()
  })

  it('sends edits with the working copy and takes the answer as the new working copy', () => {
    const { store, adopt, edits, answer, refuse, texts } = setup()
    adopt(PAD, 'e-1')
    store.setEditing(true)
    store.add(0, 1)
    expect(edits()[0]).toMatchObject({ requestId: 'padedit-1-r', draft: PAD, edit: { op: 'addButton', row: 0, column: 1 } })
    const added: OscPad = { ...PAD, buttons: [...PAD.buttons, { id: 'b2', row: 0, column: 1, label: 'b2', address: '/pad/b2', args: [] }] }
    answer(added)
    expect(store.session.value).toMatchObject({ draft: added, dirty: true })
    // 足したボタンを選ぶ(id はブリッジが振る)
    expect(store.selected.value).toBe('b2')

    store.removeArg('b1', 3)
    refuse('その引数はありません')
    expect(store.session.value?.draft).toEqual(added)
    expect(texts()).toContain('その引数はありません')
  })

  it('refuses structural edits while an answer is pending, and queues only the last input per field', () => {
    const { store, adopt, edits, answer, texts } = setup()
    adopt(PAD, 'e-1')
    store.setEditing(true)
    store.setLabel('b1', 'F')
    store.setLabel('b1', 'Fi')
    store.setLabel('b1', 'Fir')
    store.setAddress('b1', '/x')
    store.addArg('b1')
    expect(texts()).toContain(BUSY_MESSAGE)
    expect(store.busy.value).toBe(true)
    expect(edits()).toHaveLength(1)

    answer(withLabel(PAD, 'F'))
    // 答えの後に、預かった欄ごとの最後の入力を答えの作業コピーへ当てて送る
    expect(edits()).toHaveLength(2)
    expect(edits()[1]).toMatchObject({ draft: withLabel(PAD, 'F'), edit: { op: 'setLabel', label: 'Fir' } })
    answer(withLabel(PAD, 'Fir'))
    expect(edits()[2]).toMatchObject({ edit: { op: 'setAddress', address: '/x' } })
    expect(store.busy.value).toBe(true)
  })

  it('shows a field error under the field instead of a notice', () => {
    const { store, adopt, refuse, answer, texts } = setup()
    adopt(PAD, 'e-1')
    store.setEditing(true)
    store.setAddress('b1', '/sys/ping')
    refuse('/sys/* と /oscdesk/* は使えません')
    expect([...store.fieldErrors.value.values()]).toEqual(['/sys/* と /oscdesk/* は使えません'])
    expect(texts()).toEqual([])
    store.setAddress('b1', '/ok')
    answer(PAD)
    expect(store.fieldErrors.value.size).toBe(0)
  })

  it('gives up waiting after the timeout and on a disconnect, so the session is not stuck busy', () => {
    const { store, adopt, socket, timers, texts } = setup()
    adopt(PAD, 'e-1')
    store.setEditing(true)
    store.addArg('b1')
    timers.advance(EDIT_TIMEOUT_MS + 1)
    expect(store.busy.value).toBe(false)
    expect(texts()).toContain('ブリッジの応答がありませんでした')

    store.addArg('b1')
    store.setLabel('b1', 'queued')
    socket().drop()
    expect(store.busy.value).toBe(false)
    expect(texts()).toContain('ブリッジとの接続が切れました')
  })

  it('marks the draft saved only when the adoption of the requested save arrives', () => {
    const { store, adopt, socket, answer } = setup()
    adopt(PAD, 'e-1')
    store.setEditing(true)
    store.setLabel('b1', 'Saved')
    answer(withLabel(PAD, 'Saved'))
    store.setSaveName('take-02')
    store.save()
    expect(socket().ofType('osc.padSave').at(-1)).toMatchObject({ name: 'take-02', pad: withLabel(PAD, 'Saved') })
    // 別の端末がたまたま同じ内容を別名で採用しても、頼んだ保存とはみなさない
    adopt(withLabel(PAD, 'Saved'), 'e-2', 'other')
    expect(store.session.value?.dirty).toBe(true)
    adopt(withLabel(PAD, 'Saved'), 'e-3', 'take-02')
    expect(store.session.value).toMatchObject({ dirty: false, baseVersion: 'e-3', baseName: 'take-02' })
  })

  it('follows another device when unedited, and keeps the draft with a conflict warning when edited', () => {
    const { store, adopt, answer } = setup()
    adopt(PAD, 'e-1')
    store.setEditing(true)
    adopt(withLabel(PAD, 'Other'), 'e-2')
    expect(store.session.value).toMatchObject({ draft: withLabel(PAD, 'Other'), dirty: false, baseVersion: 'e-2' })

    store.setLabel('b1', 'Mine')
    answer(withLabel(PAD, 'Mine'))
    adopt(withLabel(PAD, 'Third'), 'e-3')
    expect(store.session.value?.draft).toEqual(withLabel(PAD, 'Mine'))
    expect(store.conflicted.value).toBe(true)
  })

  it('defers matching an adoption that arrives while an answer is pending', () => {
    const { store, adopt, answer } = setup()
    adopt(PAD, 'e-1')
    store.setEditing(true)
    store.addArg('b1')
    adopt(withLabel(PAD, 'Other'), 'e-2')
    // 答えを待つ間は追従しない(届いた答えが追従した作業コピーを上書きしないため)
    expect(store.session.value?.baseVersion).toBe('e-1')
    answer(PAD)
    // 答えが作業コピーを変えなかった(dirty でない)ので、答えの後に追従する
    expect(store.session.value).toMatchObject({ draft: withLabel(PAD, 'Other'), baseVersion: 'e-2' })
  })

  it('asks before discarding unsaved changes, and discards the draft when the requested load arrives', () => {
    const { store, adopt, answer, socket, texts } = setup()
    adopt(PAD, 'e-1')
    store.setEditing(true)
    store.setLabel('b1', 'Mine')
    answer(withLabel(PAD, 'Mine'))
    store.setEditing(false)
    expect(store.confirm.value?.okLabel).toBe('破棄する')
    store.answerConfirm(false)
    expect(store.session.value).not.toBeNull()

    store.load('take-02')
    store.answerConfirm(true)
    expect(socket().ofType('osc.padLoad').at(-1)).toMatchObject({ name: 'take-02' })
    expect(texts()).toContain('take-02 への切り替えを要求しました')
    // 下書きは届くまで捨てない
    expect(store.session.value?.dirty).toBe(true)
    adopt(withLabel(PAD, 'Loaded'), 'e-2', 'take-02')
    expect(store.session.value).toMatchObject({ draft: withLabel(PAD, 'Loaded'), dirty: false, baseName: 'take-02' })
  })

  it('starts a new empty pad and refuses an invalid save name', () => {
    const { store, adopt, socket, texts } = setup()
    adopt(PAD, 'e-1')
    store.setEditing(true)
    store.startNew()
    expect(store.session.value).toMatchObject({ draft: newPad(), dirty: true })
    store.setSaveName('../x')
    store.save()
    expect(socket().ofType('osc.padSave')).toHaveLength(0)
    expect(texts()).toContain('保存名は英数字で始まる英数字・_・- の 1〜64 文字にしてください')
  })

  it('copies a button and pastes its settings into another', () => {
    const { store, adopt, edits } = setup()
    adopt({ ...PAD, buttons: [...PAD.buttons, { id: 'b2', row: 0, column: 1, label: '', address: '/b', args: [] }] }, 'e-1')
    store.setEditing(true)
    store.copy('b1')
    expect(store.clipboard.value?.label).toBe('Fire')
    store.paste('b2')
    expect(edits()[0].edit).toEqual({ op: 'pasteSettings', button: 'b2', settings: { label: 'Fire', address: '/fx/fire', args: [{ type: 'i', value: 1 }] } })
  })

  it('refuses an image larger than the limit before reading it, and sends the bytes as base64', async () => {
    const { store, adopt, edits, texts } = setup()
    adopt(PAD, 'e-1')
    store.setEditing(true)
    await store.setImage('b1', new Blob([new Uint8Array(256 * 1024 + 1)]))
    expect(texts()).toContain('画像は 256 KiB までです')
    await store.setImage('b1', new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])]))
    expect(edits()[0].edit).toEqual({ op: 'setImage', button: 'b1', data: 'iVBORw==' })
  })

  it('reports rejected adoptions and presses from the bridge', () => {
    const { socket, texts } = setup()
    socket().receive({ v: 1, type: 'notice', level: 'error', code: 'pad-press-rejected', detail: 'stale version' })
    expect(texts()).toContain('パッドのボタンを送れませんでした: stale version')
  })
})
