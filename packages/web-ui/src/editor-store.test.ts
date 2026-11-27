// 編集モードの状態(D-144)。命令の形・答えを待つ間は次を送らず追従もしない・断られても作業コピーを変えない・
// アップロードは作業コピーを送らない・競合と上書きの確認を、偽の WebSocket で確かめる
import { describe, expect, it } from 'vitest'

import { UpstreamFrameSchema, type SurfaceDefinition } from '@oscdesk/shared'

import { EDIT_TIMEOUT_MS, BUSY_MESSAGE, createEditorStore } from './editor-store'
import { createTestLink, wireSample } from './test-support'

function setup(options: { surface?: boolean } = {}) {
  const test = createTestLink()
  const store = createEditorStore({
    link: test.link,
    notices: test.notices,
    setTimer: test.timers.setTimer,
    clearTimer: test.timers.clearTimer,
    randomId: () => 'abc',
  })
  if (options.surface !== false) {
    test.socket().receive(wireSample('downstream-surface'))
    test.socket().receive({ v: 1, type: 'surfaceList', names: ['stage', 'other'], active: 'stage' })
  }
  const edits = () => test.socket().ofType('surfaceEdit')
  const lastEdit = () => edits().at(-1) as { requestId: string; draft?: SurfaceDefinition; edit: { op: string } }
  const answer = (definition: SurfaceDefinition, requestId = lastEdit().requestId) =>
    test.socket().receive({ v: 1, type: 'surfaceEdited', requestId, result: { ok: true, definition } })
  const refuse = (detail: string, requestId = lastEdit().requestId) =>
    test.socket().receive({ v: 1, type: 'surfaceEdited', requestId, result: { ok: false, detail } })
  const texts = () => test.notices.items.value.map((notice) => notice.text)
  return { ...test, store, edits, lastEdit, answer, refuse, texts }
}

const surfaceFrame = () => {
  const frame = wireSample('downstream-surface')
  if (frame.type !== 'surface') throw new Error('not a surface')
  return frame
}

const adoptedDefinition = (): SurfaceDefinition => {
  const frame = wireSample('downstream-surface')
  if (frame.type !== 'surface') throw new Error('not a surface')
  return { ...frame.definition, bindings: frame.bindings }
}

const moved = (): SurfaceDefinition => ({ ...adoptedDefinition(), name: 'Moved' })

describe('editor store', () => {
  it('opens on the adopted definition with its bindings and sends edits with the working copy', () => {
    const { store, lastEdit } = setup()
    store.open()
    expect(store.draft.value).toEqual(adoptedDefinition())
    expect(store.saveName.value).toBe('stage')
    store.moveNode({ screen: 0, steps: [], index: 0 }, 1)
    const frame = lastEdit()
    expect(UpstreamFrameSchema.safeParse(frame).success).toBe(true)
    expect(frame).toMatchObject({ requestId: 'edit-1-abc', edit: { op: 'moveNode', ref: { screen: 0, steps: [], index: 0 }, delta: 1 } })
    expect(frame.draft).toEqual(adoptedDefinition())
  })

  it('leaves the initial request to the shared link and only receives the answer (D-155)', () => {
    const { socket } = setup({ surface: false })
    socket().receive(wireSample('downstream-hello'))
    // 要求は bridge-link が hello の後に 1 回だけ送る(store が重ねて送らない)
    // 主画面をパッドにしたので、bridge-link は hello の後にこの要求を送らない(D-170。この画面は HID-491 で撤去する)
    expect(socket().ofType('surfaceRequest')).toHaveLength(0)
  })

  it('opens on an empty definition when nothing is adopted', () => {
    const { store } = setup({ surface: false })
    store.open()
    expect(store.draft.value).toMatchObject({ name: 'New', screens: [{ id: 'main' }], bindings: { osc: { parameters: [] } } })
  })

  it('takes the answer as the new working copy and refuses a second edit while waiting', () => {
    const { store, edits, answer, texts } = setup()
    store.open()
    store.removeParameter('master')
    expect(store.busy.value).toBe(true)
    store.removeNode({ screen: 0, steps: [], index: 0 })
    expect(edits()).toHaveLength(1)
    expect(texts()).toContain(BUSY_MESSAGE)
    answer(moved())
    expect(store.busy.value).toBe(false)
    expect(store.draft.value?.name).toBe('Moved')
    expect(store.dirty.value).toBe(true)
  })

  it('keeps the working copy and shows the reason when the bridge refuses', () => {
    const { store, refuse, texts } = setup()
    store.open()
    store.mergeWithNext({ screen: 0, steps: [], index: 0 })
    refuse('後ろに並べる部品がありません')
    expect(store.draft.value).toEqual(adoptedDefinition())
    expect(texts()).toContain('変更できません: 後ろに並べる部品がありません')
    expect(store.busy.value).toBe(false)
  })

  it('gives up after the timeout, on a disconnect and on close, and ignores late answers', () => {
    const { store, answer, lastEdit, timers, socket, texts } = setup()
    store.open()
    store.removeParameter('master')
    const first = lastEdit().requestId
    timers.advance(EDIT_TIMEOUT_MS)
    expect(store.busy.value).toBe(false)
    expect(texts()).toContain('変更できません: ブリッジの応答がありませんでした')
    answer(moved(), first)
    expect(store.draft.value?.name).toBe('Stage')

    store.removeParameter('master')
    socket().drop()
    expect(store.busy.value).toBe(false)
    expect(texts()).toContain('変更できません: ブリッジとの接続が切れました')
  })

  it('does not compare the width or the collapsed switch against a stale copy, and skips an unchanged value', () => {
    const { store, edits } = setup()
    store.open()
    store.setWidth({ screen: 0, steps: [], index: 0 }, '')
    expect(edits()).toHaveLength(0) // 今の値と同じ
    store.setWidth({ screen: 0, steps: [], index: 0 }, '4')
    expect(edits().at(-1)).toMatchObject({ edit: { op: 'setWidth', width: 4 } })
  })

  it('does not follow the adopted definition while waiting or after editing, and follows it otherwise', () => {
    const { store, socket, answer } = setup()
    store.open()
    const other = { ...wireSample('downstream-surface'), revision: 2, definition: { ...adoptedDefinition(), bindings: undefined, name: 'Other' } }
    delete (other.definition as { bindings?: unknown }).bindings
    // 未編集なら追従する
    socket().receive(other)
    expect(store.draft.value?.name).toBe('Other')
    expect(store.conflicted.value).toBe(false)

    // 答えを待つ間は追従しない
    store.removeParameter('master')
    socket().receive({ ...other, revision: 3, definition: { ...other.definition, name: 'Third' } })
    expect(store.draft.value?.name).toBe('Other')
    answer(moved())
    expect(store.draft.value?.name).toBe('Moved')
    // 編集した後に、ほかの端末の保存が届くと競合になる
    expect(store.conflicted.value).toBe(true)
  })

  it('asks before overwriting a definition saved by another browser and sends the body and the bindings in one frame', () => {
    const { store, socket, answer, texts } = setup()
    store.open()
    store.removeParameter('master')
    answer(moved())
    store.setSaveName('stage')
    store.save()
    expect(socket().ofType('surfaceSave')).toHaveLength(1)
    const saved = socket().ofType('surfaceSave')[0] as { name: string; definition: Record<string, unknown>; bindings: unknown; activate: boolean }
    expect(saved).toMatchObject({ name: 'stage', activate: true, bindings: adoptedDefinition().bindings })
    expect(saved.definition.bindings).toBeUndefined()
    expect(texts()).toContain('stage の保存を要求しました')

    // 自分の保存が採用されたら出発点になる(競合にしない)
    socket().receive({ ...wireSample('downstream-surface'), revision: 2, definition: { ...surfaceFrame().definition, name: 'Moved' } })
    expect(store.dirty.value).toBe(false)
    expect(store.conflicted.value).toBe(false)

    // 編集した後にほかの端末が保存したら、保存の前に確かめる
    store.removeParameter('master')
    answer({ ...moved(), name: 'Mine' })
    socket().receive({ ...wireSample('downstream-surface'), revision: 3, definition: { ...surfaceFrame().definition, name: 'Theirs' } })
    expect(store.conflicted.value).toBe(true)
    store.save()
    expect(store.confirm.value).toEqual({ overwrite: 'stage' })
    expect(socket().ofType('surfaceSave')).toHaveLength(1)
    store.confirmOverwrite()
    expect(socket().ofType('surfaceSave')).toHaveLength(2)
  })

  it('refuses an invalid save name, a save while waiting and a load with nothing chosen', () => {
    const { store, socket, texts } = setup()
    store.open()
    store.setSaveName('bad name')
    store.save()
    store.setSaveName('ok')
    store.removeParameter('master')
    store.save()
    store.load()
    expect(socket().ofType('surfaceSave')).toHaveLength(0)
    expect(socket().ofType('surfaceLoad')).toHaveLength(0)
    expect(texts()).toEqual(expect.arrayContaining([
      '保存名は英数字で始まる英数字・_・- の 1〜64 文字にしてください',
      '前の変更を反映しています。反映してから保存してください',
      '読み込む定義を選んでください',
    ]))
    store.setLoadName('other')
    store.load()
    expect(socket().ofType('surfaceLoad').at(-1)).toMatchObject({ name: 'other' })
  })

  it('uploads without the working copy and reports a file that is not JSON', () => {
    const { store, lastEdit, edits, answer, texts } = setup()
    store.open()
    store.upload('{ not json')
    expect(edits()).toHaveLength(0)
    expect(texts().at(-1)).toMatch(/^JSON として読めません: /)
    store.upload(JSON.stringify({ format: 'oscdesk-surface', version: 1 }))
    expect(lastEdit().draft).toBeUndefined()
    expect(lastEdit().edit).toMatchObject({ op: 'replace', definition: { format: 'oscdesk-surface', version: 1 } })
    answer(moved())
    expect(texts().at(-1)).toBe('アップロードした定義を作業コピーに読み込みました。保存すると採用されます')
  })

  it('closes the parameter dialog only when the bridge accepts the form, and keeps composite parameters out of it', () => {
    const { store, lastEdit, answer, refuse, texts } = setup()
    store.open()
    store.openParameter(null)
    expect(store.parameterDialog.value?.fields.id).toBe('param1')
    store.setParameterField('min', 'x')
    store.commitParameter()
    expect(lastEdit().edit).toMatchObject({ op: 'setParameter', original: null, form: { id: 'param1', min: 'x', osc: { address: '/' } } })
    refuse('最小 は数値で入力してください')
    expect(store.parameterDialog.value).not.toBeNull()
    expect(texts()).toContain('保存できません: 最小 は数値で入力してください')
    store.setParameterField('min', '0')
    store.commitParameter()
    answer(moved())
    expect(store.parameterDialog.value).toBeNull()

    store.openParameter({ id: 'c', label: 'C', kind: 'state', type: 'composite', fields: [{ id: 'r', label: 'R', type: 'f', default: 0 }] })
    expect(store.parameterDialog.value).toBeNull()
    expect(texts().at(-1)).toContain('組み合わせの型')
  })

  it('asks before closing with unsaved or pending changes, and forgets the pending edit when discarded', () => {
    const { store, answer } = setup()
    store.open()
    store.requestClose()
    expect(store.editing.value).toBe(false)
    store.open()
    store.removeParameter('master')
    store.requestClose()
    expect(store.confirm.value).toBe('discard')
    store.discard()
    expect(store.editing.value).toBe(false)
    answer(moved())
    expect(store.draft.value).toBeNull()
  })
})
