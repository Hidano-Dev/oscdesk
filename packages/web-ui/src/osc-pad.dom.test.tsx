// @vitest-environment happy-dom
// OSC パッドのタブと送信ログ・通知履歴のドロワーの画面との結線(D-139・D-147)。happy-dom の DOM に App を描き、
// 偽の WebSocket にフレームを流して、押した・打ったときに送るフレームと描き直された DOM を確かめる
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import { App } from './app'
import { createDestinationsStore } from './destinations-store'
import { createOscPadStore } from './osc-pad-store'
import { createSentLogStore } from './sent-log-store'
import { createTestLink, wireSample } from './test-support'

function mount() {
  const test = createTestLink()
  const timers = { setTimer: test.timers.setTimer, clearTimer: test.timers.clearTimer }
  const destinations = createDestinationsStore({ link: test.link, notices: test.notices, now: test.timers.now, ...timers })
  const pad = createOscPadStore({ link: test.link, notices: test.notices, ...timers, randomId: () => 'r' })
  const sentLog = createSentLogStore({ link: test.link, notices: test.notices })
  const container = document.createElement('div')
  document.body.append(container)
  act(() => render(<App link={test.link} notices={test.notices} destinations={destinations} pad={pad} sentLog={sentLog} />, container))
  const receive = (frame: unknown) => act(() => test.socket().receive(frame))
  const $ = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector)
  const buttonNamed = (text: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.trim() === text)
  const type = (input: HTMLInputElement, value: string) => act(() => {
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  receive(wireSample('downstream-hello'))
  return { ...test, container, receive, $, buttonNamed, type }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('OSC pad (happy-dom)', () => {
  it('draws the adopted pad and sends a press on pointerdown with the drawn version', () => {
    const { $, receive, socket } = mount()
    expect(socket().ofType('osc.padRequest')).toHaveLength(1)
    receive(wireSample('downstream-pad'))
    const fire = $('[data-button="b1"]')
    expect(fire?.textContent).toContain('Fire')
    expect(fire?.style.backgroundColor).not.toBe('')
    act(() => {
      fire?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
      // 右クリック(button 2)では送らない
      fire?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 2 }))
    })
    expect(socket().ofType('osc.padPress')).toEqual([{ v: 1, type: 'osc.padPress', name: 'take-03', version: '3f9a1c0b7e2d-2', button: 'b1' }])
  })

  it('edits a button in the Inspector, keeps a refused address in the field and shows the reason below it', () => {
    const { $, receive, socket, type } = mount()
    receive(wireSample('downstream-pad'))
    act(() => $<HTMLInputElement>('input[role="switch"]')?.click())
    expect($('input[role="switch"]')?.closest('section')?.textContent).toContain('編集中: take-03')

    act(() => $('[data-button="b1"]')?.click())
    const address = $<HTMLInputElement>('input[aria-label="アドレス"]')
    if (address === null) throw new Error('no address field')
    expect(address.value).toBe('/fx/fire')
    type(address, '/sys/x')
    const edit = socket().ofType('osc.padEdit').at(-1) as { requestId: string; edit: unknown }
    expect(edit.edit).toEqual({ op: 'setAddress', button: 'b1', address: '/sys/x' })
    receive({ v: 1, type: 'osc.padEdited', requestId: edit.requestId, result: { ok: false, detail: '/sys/* は使えません' } })
    expect(address.value).toBe('/sys/x')
    expect(address.closest('.field')?.textContent).toContain('/sys/* は使えません')
  })

  it('adds a button on an empty cell and selects the button the bridge returned', () => {
    const { $, receive, socket, container } = mount()
    receive(wireSample('downstream-pad'))
    act(() => $<HTMLInputElement>('input[role="switch"]')?.click())
    act(() => $<HTMLButtonElement>('button[aria-label="1 行 2 列にボタンを足す"]')?.click())
    const edit = socket().ofType('osc.padEdit').at(-1) as { requestId: string; draft: { buttons: unknown[] }; edit: unknown }
    expect(edit.edit).toEqual({ op: 'addButton', row: 0, column: 1 })
    const draft = { ...edit.draft, buttons: [...edit.draft.buttons, { id: 'b3', row: 0, column: 1, label: 'b3', address: '/pad/b3', args: [] }] }
    receive({ v: 1, type: 'osc.padEdited', requestId: edit.requestId, result: { ok: true, pad: draft } })
    expect($('[data-button="b3"]')?.classList.contains('selected')).toBe(true)
    expect(container.textContent).toContain('ボタン (b3)')
    expect(container.textContent).toContain('未保存の変更があります')
  })
})

describe('log drawer (happy-dom)', () => {
  it('shows the sent log newest first, and every notice of every panel in the history', () => {
    const { $, receive, buttonNamed, notices, container } = mount()
    receive(wireSample('downstream-sent-log'))
    act(() => $<HTMLButtonElement>('.drawer-toggle')?.click())
    const rows = [...container.querySelectorAll<HTMLElement>('.sent-log tbody tr')].map((row) => row.dataset.seq)
    expect(rows).toEqual(['44', '43', '42', '41'])
    expect($('.sent-log')?.textContent).toContain('×12')

    // 別のパネル(宛先パネル)の通知も、パネルが何もしなくても履歴に載る
    receive({ v: 1, type: 'notice', level: 'error', code: 'destinations-rejected', detail: 'x' })
    act(() => notices.notify('info', '直接の通知'))
    act(() => buttonNamed('通知履歴')?.click())
    const history = [...container.querySelectorAll('.notice-log tbody tr')].map((row) => row.textContent)
    expect(history[0]).toContain('直接の通知')
    expect(history[1]).toContain('宛先を変更できません: x')
    act(() => buttonNamed('消去')?.click())
    expect($('.notice-log')?.textContent).toContain('通知はありません')
  })
})
