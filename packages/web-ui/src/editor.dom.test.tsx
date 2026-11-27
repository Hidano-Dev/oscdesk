// @vitest-environment happy-dom
// 編集モードの画面との結線(D-139・D-144)。押したボタンが送る編集命令と、答えで描き直された木・断られたときの戻りを確かめる
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import type { SurfaceDefinition } from '@oscdesk/shared'

import { LegacyApp as App } from './legacy-app'
import { createDestinationsStore } from './destinations-store'
import { createEditMode } from './edit-mode'
import { createEditorStore } from './editor-store'
import { createTestLink, wireSample } from './test-support'

function mount() {
  const test = createTestLink()
  const destinations = createDestinationsStore({ link: test.link, notices: test.notices, now: test.timers.now, setTimer: test.timers.setTimer, clearTimer: test.timers.clearTimer })
  const editor = createEditorStore({ link: test.link, notices: test.notices, setTimer: test.timers.setTimer, clearTimer: test.timers.clearTimer, randomId: () => 'dom' })
  const container = document.createElement('div')
  document.body.append(container)
  // 編集モードの入り切りはページ全体の 1 つ(D-156)。画面上部のスイッチが editor-store に任せる
  const editMode = createEditMode(editor)
  act(() => render(<App link={test.link} notices={test.notices} destinations={destinations} editor={editor} editMode={editMode} />, container))
  const receive = (frame: unknown) => act(() => test.socket().receive(frame))
  const headerSwitch = () => container.querySelector<HTMLInputElement>('.app-head input[type="checkbox"]')
  const section = () => container.querySelector<HTMLElement>('section[aria-label="定義の編集"]') as HTMLElement
  const button = (text: string) => [...section().querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === text)
  const nodeRows = () => [...section().querySelectorAll<HTMLElement>('[data-node]')]
  const lastEdit = () => test.socket().ofType('surfaceEdit').at(-1) as { requestId: string; edit: Record<string, unknown> }
  return { ...test, container, receive, headerSwitch, section, button, nodeRows, lastEdit }
}

afterEach(() => {
  document.body.innerHTML = ''
})

const twoControls = (): SurfaceDefinition => {
  const frame = wireSample('downstream-surface')
  if (frame.type !== 'surface') throw new Error('not a surface')
  return {
    ...frame.definition,
    parameters: [...frame.definition.parameters, { id: 'gain', label: 'Gain', type: 'f', kind: 'state', default: 0 }],
    screens: [{ id: 'main', label: 'Main', children: [{ kind: 'control', param: 'master' }, { kind: 'control', param: 'gain' }] }],
    bindings: { osc: { parameters: [{ id: 'master', address: '/mix/master' }, { id: 'gain', address: '/mix/gain' }] } },
  }
}

describe('editor panel (happy-dom)', () => {
  it('is opened and closed only by the page-wide switch, which stays on while the discard is being confirmed (D-156)', () => {
    const { container, receive, headerSwitch, section, lastEdit } = mount()
    receive(wireSample('downstream-surface'))
    // 編集モードのパネルは独自の切り替えを持たない
    expect(section()).toBeNull()
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(1)
    act(() => headerSwitch()?.click())
    expect(section()).not.toBeNull()
    expect(headerSwitch()?.checked).toBe(true)

    act(() => section().querySelector<HTMLButtonElement>('button[aria-label="部品: master (master) を下へ"]')?.click())
    receive({ v: 1, type: 'surfaceEdited', requestId: lastEdit().requestId, result: { ok: true, definition: twoControls() } })
    // 保存していない変更があれば、切っても確かめるまでは編集モードのまま
    act(() => headerSwitch()?.click())
    expect(headerSwitch()?.checked).toBe(true)
    const dialog = container.querySelector<HTMLElement>('[role="dialog"][aria-label="確認"]')
    expect(dialog?.textContent).toContain('破棄して編集モードを閉じますか')
    act(() => [...(dialog?.querySelectorAll('button') ?? [])].find((item) => item.textContent === '破棄する')?.click())
    expect(headerSwitch()?.checked).toBe(false)
    expect(section()).toBeNull()
  })

  it('opens the working copy, sends a move and redraws the tree from the answer', () => {
    const { section, receive, nodeRows, lastEdit, headerSwitch } = mount()
    receive(wireSample('downstream-surface'))
    receive({ v: 1, type: 'surfaceList', names: ['stage'], active: 'stage' })
    const toggle = headerSwitch()
    act(() => toggle?.click())
    expect(nodeRows().map((row) => row.textContent)).toEqual([expect.stringContaining('部品: master (master)')])
    expect(section().textContent).toContain('/mix/master')

    const down = section().querySelector<HTMLButtonElement>('button[aria-label="部品: master (master) を下へ"]')
    act(() => down?.click())
    expect(lastEdit().edit).toEqual({ op: 'moveNode', ref: { screen: 0, steps: [], index: 0 }, delta: 1 })
    receive({ v: 1, type: 'surfaceEdited', requestId: lastEdit().requestId, result: { ok: true, definition: twoControls() } })
    expect(nodeRows().map((row) => row.textContent?.split('↑')[0])).toEqual(['部品: master (master)', '部品: gain (gain)'])
    expect(section().textContent).toContain('保存していない変更があります')
  })

  it('puts back the width when the bridge refuses it and shows the reason', () => {
    const { container, section, receive, lastEdit, headerSwitch } = mount()
    receive(wireSample('downstream-surface'))
    act(() => headerSwitch()?.click())
    const width = () => section().querySelector<HTMLSelectElement>('select[aria-label="部品: master (master) の幅"]') as HTMLSelectElement
    act(() => {
      width().value = '4'
      width().dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(lastEdit().edit).toMatchObject({ op: 'setWidth', width: 4 })
    receive({ v: 1, type: 'surfaceEdited', requestId: lastEdit().requestId, result: { ok: false, detail: '幅は 1〜12 です' } })
    expect(width().value).toBe('')
    expect(container.querySelector('.notices')?.textContent).toContain('変更できません: 幅は 1〜12 です')
  })

  it('places an unplaced parameter and edits a parameter through the dialog', () => {
    const { section, receive, button, lastEdit, container, warnings, headerSwitch } = mount()
    const { bindings, ...body } = twoControls()
    receive({ ...wireSample('downstream-surface'), definition: { ...body, screens: [{ id: 'main', label: 'Main', children: [] }] }, bindings })
    expect(warnings).toEqual([])
    act(() => headerSwitch()?.click())
    act(() => button('gain を置く')?.click())
    expect(lastEdit().edit).toEqual({ op: 'addControl', screen: 0, steps: [], param: 'gain' })
    receive({ v: 1, type: 'surfaceEdited', requestId: lastEdit().requestId, result: { ok: true, definition: twoControls() } })

    const edit = section().querySelector<HTMLElement>('[data-param="gain"]')?.querySelector('button')
    act(() => edit?.click())
    const dialog = container.querySelector<HTMLElement>('[role="dialog"][aria-label="パラメータ"]') as HTMLElement
    const labelInput = [...dialog.querySelectorAll<HTMLLabelElement>('label.field')].find((label) => label.textContent?.startsWith('表示名'))?.querySelector('input') as HTMLInputElement
    expect(labelInput.value).toBe('Gain')
    act(() => {
      labelInput.value = 'Gain 2'
      labelInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => [...dialog.querySelectorAll('button')].find((item) => item.textContent === 'OK')?.click())
    expect(warnings).toEqual([])
    expect(lastEdit().edit).toMatchObject({ op: 'setParameter', original: 'gain', form: { label: 'Gain 2', id: 'gain' } })
    receive({ v: 1, type: 'surfaceEdited', requestId: lastEdit().requestId, result: { ok: true, definition: twoControls() } })
    expect(container.querySelector('[role="dialog"][aria-label="パラメータ"]')).toBeNull()
  })
})
