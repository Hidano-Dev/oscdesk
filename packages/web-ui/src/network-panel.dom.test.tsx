// @vitest-environment happy-dom
// ネットワークのタブの結線(D-139・D-153)。打った値と押したボタンで送るフレーム、届き直した設定で入力が消えないことを確かめる
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import { App } from './app'
import { createDestinationsStore } from './destinations-store'
import type { NetworkSettingsFrame } from './network-logic'
import { createNetworkStore } from './network-store'
import { createTestLink, wireSample } from './test-support'

function mount() {
  const test = createTestLink()
  const destinations = createDestinationsStore({ link: test.link, notices: test.notices, setTimer: test.timers.setTimer, clearTimer: test.timers.clearTimer })
  const network = createNetworkStore({ link: test.link, notices: test.notices, setTimer: test.timers.setTimer, clearTimer: test.timers.clearTimer, randomId: () => 'x' })
  const container = document.createElement('div')
  document.body.append(container)
  act(() => render(<App link={test.link} notices={test.notices} destinations={destinations} network={network} />, container))
  const receive = (frame: unknown) => act(() => test.socket().receive(frame))
  const panel = () => container.querySelector<HTMLElement>('section[aria-label="ネットワーク"]')
  const button = (text: string) => [...(panel()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((item) => item.textContent === text)
  const textareas = () => [...(panel()?.querySelectorAll<HTMLTextAreaElement>('textarea') ?? [])]
  return { ...test, container, receive, panel, button, textareas }
}

const type = (element: HTMLTextAreaElement, value: string) => act(() => {
  element.focus()
  element.value = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('network panel wiring (happy-dom)', () => {
  it('shows this browser, sends the typed allowlist without a browser field, and keeps the typing across a redraw', () => {
    const { panel, receive, button, textareas, socket, container } = mount()
    expect(panel()?.textContent).toContain('ブリッジから設定が届くのを待っています')
    receive(wireSample('downstream-hello-with-peer'))
    const settings = wireSample('downstream-network-settings') as NetworkSettingsFrame
    receive(settings)
    expect(panel()?.textContent).toContain('このブラウザ: 192.168.1.30')
    expect(panel()?.textContent).toContain('状態: 保存済み')
    const checked = panel()?.querySelector<HTMLInputElement>('input[type="radio"]:checked')
    expect(checked?.value).toBe('192.168.1.10')

    const [, browsers] = textareas()
    if (browsers === undefined) throw new Error('no allowlist field')
    type(browsers, '10.0.0.0/8')
    act(() => button('このブラウザを足す')?.click())
    expect(browsers.value).toBe('10.0.0.0/8\n192.168.1.30')

    // ほかのブラウザの保存で設定が届き直しても、打った値とフォーカスは残る
    receive({ ...settings, revision: 4 })
    expect(browsers.value).toBe('10.0.0.0/8\n192.168.1.30')
    expect(document.activeElement).toBe(browsers)

    act(() => button('保存して適用')?.click())
    const sent = socket().ofType('networkSettingsSet')
    expect(sent).toEqual([{ v: 1, type: 'networkSettingsSet', revision: 3, targetInterface: '192.168.1.10', targetRanges: ['192.168.1.0/24'], allowedBrowsers: ['10.0.0.0/8', '192.168.1.30'], requestId: 'net-1-x' }])
    expect(button('適用中…')?.disabled).toBe(true)

    receive({ v: 1, type: 'notice', level: 'error', code: 'network-settings-rejected', detail: 'would-lock-out: 192.168.1.30', requestId: 'net-1-x' })
    expect(container.querySelector('.notices')?.textContent).toContain('操作しているブラウザ(192.168.1.30)が接続できなくなります')
    expect(button('保存して適用')?.disabled).toBe(false)
    expect(browsers.value).toBe('10.0.0.0/8\n192.168.1.30')

    act(() => button('元に戻す')?.click())
    expect(browsers.value).toBe('192.168.1.0/24\n10.0.0.5/32')
  })

  it('chooses the target network with the radio buttons', () => {
    const { panel, receive, button, socket } = mount()
    receive(wireSample('downstream-network-settings-default'))
    const radios = [...(panel()?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? [])]
    expect(radios.map((radio) => radio.value)).toEqual(['', '127.0.0.1'])
    act(() => radios[1]?.click())
    act(() => button('保存して適用')?.click())
    expect(socket().ofType('networkSettingsSet').at(-1)).toMatchObject({ revision: 0, targetInterface: '127.0.0.1', targetRanges: [], allowedBrowsers: ['0.0.0.0/0', '::/0'] })
  })
})
