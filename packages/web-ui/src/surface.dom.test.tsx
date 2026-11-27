// @vitest-environment happy-dom
// 主画面と結線(HID-464)。happy-dom の DOM に App を描き、偽の WebSocket にフレームを流して、押した・打ったときに送るフレームと
// 描き直された DOM を確かめる(NiceGUI 版の test_browser_* の主画面の部分に当たる。実ブラウザは起動しない)
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import { App } from './app'
import { createDestinationsStore } from './destinations-store'
import { EMPTY_TEXT, NO_SURFACE_TEXT, WAITING_TEXT } from './surface-panel'
import { createSurfaceStore } from './surface-store'
import { STAGE_DEFINITION, surfaceFrame } from './surface-test-support'
import { createTestLink } from './test-support'

const HOLDER = 'spa-dom-holder'

function mount() {
  const test = createTestLink()
  const timers = { now: test.timers.now, setTimer: test.timers.setTimer, clearTimer: test.timers.clearTimer }
  const destinations = createDestinationsStore({ link: test.link, notices: test.notices, ...timers })
  const surface = createSurfaceStore({ link: test.link, notices: test.notices, ...timers, holder: HOLDER, holderLabel: 'テスト', logInfo: () => undefined })
  const container = document.createElement('div')
  document.body.append(container)
  act(() => render(<App link={test.link} notices={test.notices} destinations={destinations} surface={surface} />, container))
  const receive = (frame: unknown) => act(() => test.socket().receive(frame))
  const card = (param: string) => {
    const found = container.querySelector<HTMLElement>(`[data-param="${param}"]`)
    if (found === null) throw new Error(`no control ${param}`)
    return found
  }
  const input = (param: string, selector = 'input') => {
    const found = card(param).querySelector<HTMLInputElement>(selector)
    if (found === null) throw new Error(`no ${selector} in ${param}`)
    return found
  }
  const fire = (element: Element, event: Event) => act(() => { element.dispatchEvent(event) })
  const type = (element: HTMLInputElement, text: string) => {
    element.value = text
    fire(element, new Event('input', { bubbles: true }))
  }
  const sent = (frameType: string) => test.socket().ofType(frameType)
  const notices = () => container.querySelector('.notices')?.textContent ?? ''
  return { ...test, surface, container, receive, card, input, fire, type, sent, notices }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('surface panel (happy-dom)', () => {
  it('waits for a surface, then draws the screens from the view', () => {
    const { container, receive } = mount()
    expect(container.textContent).toContain(WAITING_TEXT)
    receive(surfaceFrame())
    expect(container.textContent).toContain('Stage')
    expect([...container.querySelectorAll('.surface [role="tab"]')].map((tab) => tab.textContent)).toEqual(['Main', 'Cues'])
    // 行の中の部品は 12 分割の幅を比で分け合う
    expect(container.querySelector<HTMLElement>('.s-row > div')?.style.flexGrow).toBe('8')
    expect(container.querySelector('details.s-group')?.hasAttribute('open')).toBe(true)

    receive(surfaceFrame({ ...STAGE_DEFINITION, screens: [] }, 2))
    expect(container.textContent).toContain(EMPTY_TEXT)
  })

  it('says there is no adopted definition instead of waiting forever when the bridge has none (D-155)', () => {
    const { container, receive } = mount()
    // 既定の定義が無いブリッジは、surfaceRequest に一覧(active: null)だけを返し、surface を送らない
    receive({ v: 1, type: 'surfaceList', names: [], active: null })
    expect(container.textContent).not.toContain(WAITING_TEXT)
    expect(container.querySelector('[data-mark="no-surface"]')?.textContent).toBe(NO_SURFACE_TEXT)
    receive(surfaceFrame())
    expect(container.querySelector('[data-mark="no-surface"]')).toBeNull()
  })

  it('switches the screen tabs without dropping the other screen', () => {
    const { container, receive } = mount()
    receive(surfaceFrame())
    const panels = () => [...container.querySelectorAll<HTMLElement>('.surface > .s-tabs > [role="tabpanel"]')]
    expect(panels().map((panel) => panel.hidden)).toEqual([false, true])
    act(() => container.querySelectorAll<HTMLButtonElement>('.surface [role="tab"]')[1]?.click())
    expect(panels().map((panel) => panel.hidden)).toEqual([true, false])
  })

  it('sends a slider while held and locks it for the time being', () => {
    const { receive, input, fire, type, sent, card } = mount()
    receive(surfaceFrame())
    const slider = input('master', 'input[type="range"]')
    expect(slider.value).toBe('0.5')
    fire(slider, new PointerEvent('pointerdown', { bubbles: true }))
    type(slider, '0.7')
    expect(sent('set').at(-1)).toEqual({ v: 1, type: 'set', param: 'master', value: 0.7, holder: HOLDER, revision: 1 })
    expect(sent('lock').at(-1)).toMatchObject({ ref: { param: 'master' }, holder: HOLDER })
    // 操作中のエコーで、つまみは動かない
    receive({ v: 1, type: 'echo', values: [{ param: 'master', value: 0.2 }], rows: [] })
    expect(slider.value).toBe('0.7')
    fire(slider, new PointerEvent('pointerup', { bubbles: true }))
    expect(sent('unlock').at(-1)).toMatchObject({ ref: { param: 'master' } })
    expect(card('master').textContent).toContain('0.2')
  })

  it('toggles a switch and presses a trigger', () => {
    const { receive, input, fire, sent, card } = mount()
    receive(surfaceFrame())
    act(() => input('mute', 'input[type="checkbox"]').click())
    expect(sent('set').at(-1)).toMatchObject({ param: 'mute', value: true })
    expect(input('mute', 'input[type="checkbox"]').checked).toBe(true)
    const go = card('go').querySelector('button')!
    fire(go, new PointerEvent('pointerdown', { bubbles: true }))
    expect(sent('set').at(-1)).toMatchObject({ param: 'go', value: 1 })
    // 単独で送らない trigger は押せない
    expect(card('part').querySelector('button')?.disabled).toBe(true)
  })

  it('starts neither a send nor a hold on a non-primary press (right, middle, pen button) (PR #158)', () => {
    const { receive, input, fire, sent, card } = mount()
    receive(surfaceFrame())
    const go = card('go').querySelector('button')!
    const slider = input('master', 'input[type="range"]')
    const scene = input('scene', 'select')
    for (const button of [1, 2, 5]) {
      fire(go, new PointerEvent('pointerdown', { bubbles: true, button }))
      fire(slider, new PointerEvent('pointerdown', { bubbles: true, button }))
      fire(scene, new PointerEvent('pointerdown', { bubbles: true, button }))
    }
    expect(sent('set')).toHaveLength(0)
    expect(sent('lock')).toHaveLength(0)
    // タッチとペンの主の接触(button 0)は従来どおり
    fire(go, new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'touch' }))
    fire(slider, new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'pen' }))
    expect(sent('set')).toHaveLength(1)
    expect(sent('lock').at(-1)).toMatchObject({ ref: { param: 'master' } })
  })

  it('keeps the typed text while focused, sends on Enter and refuses an invalid value on blur', () => {
    const { receive, input, fire, type, sent, notices } = mount()
    receive(surfaceFrame())
    const count = input('count')
    expect(count.value).toBe('3')
    fire(count, new FocusEvent('focus'))
    type(count, '7')
    receive({ v: 1, type: 'desired', full: false, values: [{ param: 'count', value: 4 }], rows: [] })
    expect(count.value).toBe('7')
    fire(count, new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(sent('set').at(-1)).toMatchObject({ param: 'count', value: 7 })
    fire(count, new FocusEvent('blur'))

    fire(count, new FocusEvent('focus'))
    type(count, '99')
    fire(count, new FocusEvent('blur'))
    expect(sent('set').filter((frame) => frame.param === 'count')).toHaveLength(1)
    expect(count.value).toBe('7')
    expect(notices()).toContain('形式不正のため送信しませんでした')
  })

  it('selects from the options and shows a value that is not in the Unity list', () => {
    const { receive, input, fire, sent, card, container } = mount()
    receive(surfaceFrame())
    const scene = input('scene', 'select') as unknown as HTMLSelectElement
    scene.value = 'B'
    fire(scene, new Event('change', { bubbles: true }))
    expect(sent('set').at(-1)).toMatchObject({ param: 'scene', value: 'B' })

    receive({ v: 1, type: 'runtimeOptions', lists: [{ list: 'segments', targets: [{ name: 'unity', options: ['Intro'] }] }], choices: [{ param: 'segment', options: ['Intro'] }] })
    receive({ v: 1, type: 'desired', full: false, values: [{ param: 'segment', value: 'Gone' }], rows: [] })
    const segment = card('segment').querySelector('select')!
    expect([...segment.options].map((option) => option.textContent)).toEqual(['Gone(一覧に無い)', 'Intro'])
    // 取り直せる一覧の select には Sync を出す(D-077)
    act(() => card('segment').querySelector<HTMLButtonElement>('button')?.click())
    expect(sent('runtimeOptionsRefresh').at(-1)).toEqual({ v: 1, type: 'runtimeOptionsRefresh', list: 'segments' })
    act(() => [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '一覧を更新')?.click())
    expect(sent('runtimeOptionsRefresh').at(-1)).toEqual({ v: 1, type: 'runtimeOptionsRefresh' })
  })

  it('disables a control another browser holds and shows who holds it', () => {
    const { receive, card, input } = mount()
    receive(surfaceFrame())
    receive({ v: 1, type: 'locks', locks: [{ ref: { param: 'master' }, clientId: 'other', holder: 'h', label: 'iPad の Safari' }] })
    expect(input('master', 'input[type="range"]').disabled).toBe(true)
    expect(card('master').textContent).toContain('操作中: iPad の Safari')
    receive({ v: 1, type: 'locks', locks: [] })
    expect(input('master', 'input[type="range"]').disabled).toBe(false)
  })

  it('sends an action button as one batch', () => {
    const { receive, container, sent } = mount()
    receive(surfaceFrame())
    receive({ v: 1, type: 'desired', full: true, values: [{ param: 'master', value: 0.5 }, { param: 'mute', value: true }], rows: [] })
    act(() => [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Send all')?.click())
    expect(sent('batch').at(-1)?.items).toEqual([{ param: 'master', value: 0.5 }, { param: 'mute', value: true }, { param: 'go' }])
  })

  it('draws record rows, edits a cell, toggles a column and adds a row', () => {
    const { receive, container, sent, fire, type } = mount()
    receive(surfaceFrame())
    const table = () => container.querySelector<HTMLElement>('[data-record="member"]')!
    expect(table().textContent).toContain('行がありません(下の欄から追加してください)')
    receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: ['id-1', 'id-2'], names: ['Alice', 'Bob'] }] })
    receive({ v: 1, type: 'desired', full: false, values: [], rows: [{ record: 'member', key: 'id-1', values: { active: true, slot: 2 } }] })
    const rows = () => [...table().querySelectorAll<HTMLElement>('[data-row]')]
    expect(rows().map((row) => row.querySelector<HTMLInputElement>('input.s-row-name')?.value)).toEqual(['Alice', 'Bob'])
    // 一括トグルは混在を注記つきのオフで見せる(D-094)
    expect(table().textContent).toContain('一部オン')

    const slot = rows()[1]!.querySelector<HTMLInputElement>('input[type="number"]')!
    fire(slot, new FocusEvent('focus'))
    type(slot, '9')
    fire(slot, new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(sent('setRow').at(-1)).toMatchObject({ record: 'member', key: 'id-2', values: { active: false, slot: 9 } })

    act(() => table().querySelector<HTMLInputElement>('.s-grid-row input[type="checkbox"]')?.click())
    expect(sent('batch').at(-1)?.items).toEqual([
      { record: 'member', key: 'id-1', values: { active: true, slot: 2 } },
      { record: 'member', key: 'id-2', values: { active: true, slot: 9 } },
    ])
    // 次のまとめは、前のまとめの対象がすべて片付いてから送る
    receive({ v: 1, type: 'echo', values: [], rows: [{ record: 'member', key: 'id-1', values: { active: true, slot: 2 } }, { record: 'member', key: 'id-2', values: { active: true, slot: 9 } }] })

    const add = table().querySelector<HTMLInputElement>('.s-add input')!
    type(add, 'Carol')
    act(() => table().querySelector<HTMLButtonElement>('.s-add button')?.click())
    expect(sent('recordKeyAdd').at(-1)).toEqual({ v: 1, type: 'recordKeyAdd', record: 'member', key: 'Carol' })
    expect(add.value).toBe('')

    act(() => rows()[1]!.querySelector<HTMLButtonElement>('[aria-label="この行を削除"]')?.click())
    // メニューは描いたあとに画面上の位置を決めて見せる(表のスクロール領域で切れないように。HID-478)
    const menu = rows()[1]!.querySelector<HTMLElement>('[role="menu"]')!
    expect(menu.style.visibility).toBe('')
    expect(menu.style.top).toMatch(/px$/)
    act(() => rows()[1]!.querySelector<HTMLButtonElement>('[role="menuitem"]')?.click())
    expect(sent('recordKeyRemove').at(-1)).toEqual({ v: 1, type: 'recordKeyRemove', record: 'member', key: 'id-2' })

    act(() => [...rows()[0]!.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Send')?.click())
    expect(sent('batch').at(-1)?.items).toEqual([{ record: 'member', key: 'id-1', values: { active: true, slot: 2 } }])
  })
})
