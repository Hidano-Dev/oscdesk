// @vitest-environment happy-dom
// 画面の枠(D-155〜D-157・D-170)。main.tsx と同じ組み立て(stores.ts)ですべてのパネルを描き、パネルの重なり(同じ要求・同じ通知を
// 2 つのパネルが出す)・タブの切り替え・パッドが無いときの案内を確かめる
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from './app'
import { NO_PAD_TEXT } from './pad-panel'
import { padDocumentFrame, padListFrame } from './pad-test-support'
import { createAppStores } from './stores'
import { createTestLink, wireSample } from './test-support'

function mount() {
  const test = createTestLink()
  const stores = createAppStores({
    link: test.link,
    notices: test.notices,
    now: test.timers.now,
    setTimer: test.timers.setTimer,
    clearTimer: test.timers.clearTimer,
    holder: 'shell-test',
    randomId: () => 'r',
  })
  const container = document.createElement('div')
  document.body.append(container)
  act(() => render(<App link={test.link} notices={test.notices} {...stores} />, container))
  const receive = (frame: unknown) => act(() => test.socket().receive(frame))
  const tab = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('.app-tabs [role="tab"]')].find((item) => item.textContent?.startsWith(label))
  const tabLabels = () => [...container.querySelectorAll<HTMLButtonElement>('.app-tabs [role="tab"]')].map((item) => item.textContent)
  const panel = (id: string) => container.querySelector<HTMLElement>(`#panel-${id}`)
  return { ...test, stores, container, receive, tab, tabLabels, panel }
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('app shell (happy-dom)', () => {
  it('sends the pad request once even with every panel mounted, and says when no pad is adopted', () => {
    const { receive, socket, panel } = mount()
    receive(wireSample('downstream-hello'))
    expect(socket().ofType('osc.padDocumentRequest')).toHaveLength(1)

    receive(padListFrame(null))
    expect(panel('pad')?.querySelector('[data-mark="no-pad"]')?.textContent).toBe(NO_PAD_TEXT)

    receive(padListFrame())
    receive(padDocumentFrame())
    expect(panel('pad')?.querySelector('[data-widget="level"]')).not.toBeNull()
  })

  it('opens on the pad, switches the tabs and keeps the hidden panels mounted', () => {
    const { receive, tab, tabLabels, panel } = mount()
    receive(wireSample('downstream-hello'))
    receive(padDocumentFrame())
    // 撤去したタブ(主画面・OSC パッド・設計図・再送)は出さない。広い画面では送信先は右側に出し続けるので、タブには無い
    expect(tabLabels()).toEqual(['パッド', '同期', 'ネットワーク'])
    expect(panel('pad')?.hidden).toBe(false)
    expect(panel('destinations')?.hidden).toBe(false)

    act(() => tab('同期')?.click())
    expect(panel('sync')?.hidden).toBe(false)
    expect(panel('pad')?.hidden).toBe(true)
    // 隠したタブの部品は作り直さない(操作中の入力欄を壊さない)
    expect(panel('pad')?.querySelector('[data-widget="level"]')).not.toBeNull()
    expect(tab('同期')?.getAttribute('aria-selected')).toBe('true')
  })

  it('makes the destinations a tab of their own on a narrow screen', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }))
    const { receive, tab, tabLabels, panel } = mount()
    receive(wireSample('downstream-hello'))
    expect(tabLabels()).toEqual(['パッド', '同期', '送信先', 'ネットワーク'])
    expect(panel('destinations')?.hidden).toBe(true)
    act(() => tab('送信先')?.click())
    expect(panel('destinations')?.hidden).toBe(false)
    expect(panel('pad')?.hidden).toBe(true)
  })

  it('shows each notice exactly once with every panel mounted', () => {
    const { receive, notices } = mount()
    receive(wireSample('downstream-hello'))
    receive(padDocumentFrame())
    const codes = [
      'locked', 'lock-rejected', 'destinations-rejected', 'destination-alias-rejected', 'destinations-save-failed',
      'destination-aliases-save-failed', 'network-settings-rejected', 'network-settings-save-failed', 'pad-rejected',
      'pad-press-rejected', 'pad-set-rejected', 'pad-action-rejected', 'pad-synced', 'pad-sync-rejected',
      'project-export-rejected', 'project-import-rejected', 'project-imported',
    ]
    for (const code of codes) {
      const before = notices.history.value.length
      receive({ v: 1, type: 'notice', level: 'error', code, detail: 'x' })
      expect({ code, shown: notices.history.value.length - before }).toEqual({ code, shown: 1 })
    }
  })
})
