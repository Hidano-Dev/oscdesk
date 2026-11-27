// @vitest-environment happy-dom
// 右の列の幅のつまみ(D-159)と、OSC パッドの Inspector を右の列に出す配置(D-091・D-160)。happy-dom の DOM に App を描いて確かめる
// (happy-dom は配置を計算しないので、枠の大きさは getBoundingClientRect を差し替えて与える)
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from './app'
import { ASIDE_WIDTH_KEY, ASIDE_KEY_STEP } from './aside-width-logic'
import { createDestinationsStore } from './destinations-store'
import { createOscPadStore } from './osc-pad-store'
import { createTestLink, wireSample } from './test-support'

function narrow() {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }))
}

function mount() {
  const test = createTestLink()
  const timers = { setTimer: test.timers.setTimer, clearTimer: test.timers.clearTimer }
  const destinations = createDestinationsStore({ link: test.link, notices: test.notices, now: test.timers.now, ...timers })
  const pad = createOscPadStore({ link: test.link, notices: test.notices, ...timers, randomId: () => 'r' })
  const container = document.createElement('div')
  document.body.append(container)
  act(() => render(<App link={test.link} notices={test.notices} destinations={destinations} pad={pad} />, container))
  act(() => test.socket().receive(wireSample('downstream-hello')))
  act(() => test.socket().receive(wireSample('downstream-pad')))
  const $ = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector)
  const body = $('.app-body')
  if (body === null) throw new Error('no body')
  // 枠は 20px から 1300px まで(幅 1280px)
  body.getBoundingClientRect = () => ({ x: 20, y: 0, left: 20, top: 0, right: 1300, bottom: 800, width: 1280, height: 800, toJSON: () => ({}) })
  const handle = () => $('[role="separator"]')
  const tab = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('.app-tabs [role="tab"]')].find((item) => item.textContent === label)
  const unmount = () => act(() => render(null, container))
  return { ...test, container, $, body, handle, tab, unmount }
}

afterEach(() => {
  document.body.innerHTML = ''
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('resizable destinations column (happy-dom)', () => {
  it('drags the handle, keeps the width within the limits and remembers it in this browser', () => {
    const { body, handle, unmount } = mount()
    const grip = handle()
    expect(grip?.getAttribute('aria-valuenow')).toBe('380')
    act(() => {
      grip?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 920 }))
      grip?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 900 }))
    })
    expect(body.style.getPropertyValue('--aside-width')).toBe('400px')
    expect(grip?.classList.contains('dragging')).toBe(true)
    // 本体に 360px(+つまみ)を残す幅までしか広がらない
    const drag = (type: string, clientX: number) => act(() => {
      grip?.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX }))
    })
    drag('pointermove', 30)
    expect(body.style.getPropertyValue('--aside-width')).toBe(`${String(1280 - 360 - 12)}px`)
    drag('pointermove', 860)
    // 覚えるのは離したとき
    expect(localStorage.getItem(ASIDE_WIDTH_KEY)).toBeNull()
    drag('pointerup', 860)
    expect(localStorage.getItem(ASIDE_WIDTH_KEY)).toBe('440')
    expect(grip?.classList.contains('dragging')).toBe(false)

    // 開き直すと覚えた幅で出す
    unmount()
    document.body.innerHTML = ''
    const again = mount()
    expect(again.body.style.getPropertyValue('--aside-width')).toBe('440px')
    expect(again.handle()?.getAttribute('aria-valuenow')).toBe('440')
  })

  it('ignores a non-primary button and moves with the arrow keys', () => {
    const { body, handle } = mount()
    const grip = handle()
    act(() => {
      grip?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 2, clientX: 920 }))
      grip?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 700 }))
    })
    expect(body.style.getPropertyValue('--aside-width')).toBe('')
    const key = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowLeft' })
    act(() => {
      grip?.dispatchEvent(key)
    })
    expect(key.defaultPrevented).toBe(true)
    expect(body.style.getPropertyValue('--aside-width')).toBe(`${String(380 + ASIDE_KEY_STEP)}px`)
    expect(localStorage.getItem(ASIDE_WIDTH_KEY)).toBe(String(380 + ASIDE_KEY_STEP))
  })

  it('has no handle on a narrow screen', () => {
    narrow()
    const { handle } = mount()
    expect(handle()).toBeNull()
  })
})

describe('side Inspector of the OSC pad (happy-dom)', () => {
  it('lends the destinations column to the Inspector while the pad tab is shown, and gives it back', () => {
    const { $, tab } = mount()
    const aside = $('#panel-destinations')
    const destinationsView = $('#panel-destinations .aside-view')
    act(() => tab('OSC パッド')?.click())
    act(() => $<HTMLInputElement>('input[role="switch"]')?.click())
    expect($('#panel-pad')?.textContent).toContain('送信先の場所(Inspector)')
    // ボタンを選ぶまでは送信先を出したまま
    expect(destinationsView?.hidden).toBe(false)

    act(() => $('[data-button="b1"]')?.click())
    expect(aside?.querySelector<HTMLInputElement>('input[aria-label="アドレス"]')?.value).toBe('/fx/fire')
    expect($('#panel-pad .inspector')).toBeNull()
    // 送信先パネルは作り直さず隠すだけ
    expect(destinationsView?.hidden).toBe(true)
    expect($('#panel-destinations .aside-view')).toBe(destinationsView)

    // ほかのタブを見ている間は送信先を出す(選択は保つ)
    act(() => tab('主画面')?.click())
    expect(aside?.querySelector('.inspector')).toBeNull()
    expect(destinationsView?.hidden).toBe(false)
    act(() => tab('OSC パッド')?.click())
    expect(aside?.querySelector('.inspector')).not.toBeNull()

    // 閉じると選択を外して送信先へ戻す
    act(() => aside?.querySelector<HTMLButtonElement>('.inspector-head button')?.click())
    expect(aside?.querySelector('.inspector')).toBeNull()
    expect(destinationsView?.hidden).toBe(false)
    expect($('[data-button="b1"]')?.classList.contains('selected')).toBe(false)
  })

  it('keeps the Inspector under the grid on a narrow screen', () => {
    narrow()
    const { $, tab } = mount()
    act(() => tab('OSC パッド')?.click())
    act(() => $<HTMLInputElement>('input[role="switch"]')?.click())
    expect($('#panel-pad')?.textContent).toContain('格子の下(Inspector)')
    act(() => $('[data-button="b1"]')?.click())
    expect($('#panel-pad .inspector input[aria-label="アドレス"]')).not.toBeNull()
    expect($('#panel-destinations .inspector')).toBeNull()
  })
})
