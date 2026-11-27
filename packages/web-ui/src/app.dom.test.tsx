// @vitest-environment happy-dom
// 画面との結線(D-139)。happy-dom の DOM に App を描き、偽の WebSocket にフレームを流して、押した・打ったときに
// 送るフレームと描き直された DOM を確かめる(実ブラウザは起動しない)
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import { App, STATUS_TEXT } from './app'
import { CLOSE_NOT_ALLOWED } from './bridge-link'
import { createDestinationsStore } from './destinations-store'
import { createTestLink, destinationsSample } from './test-support'

function mount() {
  const test = createTestLink()
  const destinations = createDestinationsStore({
    link: test.link,
    notices: test.notices,
    now: test.timers.now,
    setTimer: test.timers.setTimer,
    clearTimer: test.timers.clearTimer,
  })
  const container = document.createElement('div')
  document.body.append(container)
  act(() => render(<App link={test.link} notices={test.notices} destinations={destinations} />, container))
  const receive = (frame: unknown) => act(() => test.socket().receive(frame))
  const checkboxOf = (host: string) => container.querySelector<HTMLInputElement>(`[data-host="${host}"] input[type="checkbox"]`)
  const rows = () => [...container.querySelectorAll<HTMLElement>('[data-host]')].map((row) => row.dataset.host)
  return { ...test, container, receive, checkboxOf, rows }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('SPA wiring (happy-dom)', () => {
  it('draws the destinations, sends a click and rolls the check back when the bridge refuses it', () => {
    const { container, receive, checkboxOf, socket } = mount()
    expect(container.textContent).toContain('ブリッジから宛先の情報を待っています')

    receive(destinationsSample('downstream-destinations'))
    const box = checkboxOf('192.168.1.21')
    expect(box?.checked).toBe(false)
    expect(checkboxOf('192.168.1.20')?.checked).toBe(true)

    act(() => box?.click())
    expect(socket().ofType('destinationsSelect').at(-1)).toMatchObject({ hosts: ['192.168.1.20', '192.168.1.21', '192.168.1.30'] })
    // 応答を待たずに手元で先に付ける(D-140)
    expect(checkboxOf('192.168.1.21')?.checked).toBe(true)

    receive({ v: 1, type: 'notice', level: 'error', code: 'destinations-rejected', detail: 'invalid-host: x' })
    expect(checkboxOf('192.168.1.21')?.checked).toBe(false)
    expect(container.querySelector('.notices')?.textContent).toContain('宛先を変更できません: invalid-host: x')
  })

  it('filters the list as the search box is typed in, without losing the typed text on a redraw', () => {
    const { container, receive, rows } = mount()
    const sample = destinationsSample('downstream-destinations')
    receive(sample)
    expect(rows()).toHaveLength(sample.devices.length)

    const search = container.querySelector<HTMLInputElement>('input[type="search"]')
    if (search === null) throw new Error('no search box')
    act(() => {
      search.focus()
      search.value = '\\.21$'
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(rows()).toEqual(['192.168.1.21'])

    // 一覧が配り直されても、打った文字とフォーカスは残る(全体を組み直さない)
    receive({ ...sample, primaryHosts: [...sample.primaryHosts] })
    expect(search.value).toBe('\\.21$')
    expect(document.activeElement).toBe(search)
    expect(rows()).toEqual(['192.168.1.21'])
  })

  it('shows the connection state, including a browser outside the allowed range (D-113)', () => {
    const { container, socket } = mount()
    expect(container.textContent).toContain(STATUS_TEXT.open)
    act(() => socket().drop(CLOSE_NOT_ALLOWED))
    expect(container.textContent).toContain(STATUS_TEXT['not-allowed'])
    // 切れている間は操作できない
    expect([...container.querySelectorAll<HTMLButtonElement>('button')].every((button) => button.disabled || button.textContent?.trim() !== '探し直す')).toBe(true)
  })
})
