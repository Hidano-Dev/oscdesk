// @vitest-environment happy-dom
// 画面の枠(D-155〜D-157)。main.tsx と同じ組み立て(stores.ts)ですべてのパネルを描き、パネルの重なり(同じ要求・同じ通知を
// 2 つのパネルが出す)・タブの切り替え・定義が無いときの案内・「新しい一覧があります」への経路を確かめる
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from './app'
import { NO_SURFACE_TEXT } from './surface-panel'
import { createAppStores } from './stores'
import { surfaceFrame } from './surface-test-support'
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
  it('sends each initial request once even with every panel mounted, and says when no definition is adopted', () => {
    const { container, receive, socket, panel } = mount()
    receive(wireSample('downstream-hello'))
    expect(socket().ofType('surfaceRequest')).toHaveLength(1)
    expect(socket().ofType('osc.padRequest')).toHaveLength(1)

    // 既定の定義が無いブリッジ(作業フォルダに surfaces/ が無いなど)は一覧だけを返す。「定義待ち」のまま待たせない
    receive({ v: 1, type: 'surfaceList', names: [], active: null })
    expect(panel('surface')?.querySelector('[data-mark="no-surface"]')?.textContent).toBe(NO_SURFACE_TEXT)

    // 定義が採用されれば、主画面と編集モードが同じ定義を見る(どちらか片方だけが受けることはない)
    receive({ v: 1, type: 'surfaceList', names: ['stage'], active: 'stage' })
    receive(surfaceFrame())
    expect(panel('surface')?.querySelector('[data-param="master"]')).not.toBeNull()
    act(() => container.querySelector<HTMLInputElement>('.app-head input[type="checkbox"]')?.click())
    expect(panel('surface')?.querySelector('section[aria-label="定義の編集"]')?.textContent).toContain('画面: Main')
    expect(panel('surface')?.querySelector('section[aria-label="定義の編集"]')?.textContent).toContain('master')
  })

  it('switches the tabs and keeps the hidden panels mounted', () => {
    const { receive, tab, tabLabels, panel } = mount()
    receive(wireSample('downstream-hello'))
    receive(surfaceFrame())
    // 広い画面では送信先は右側に出し続けるので、タブには無い
    expect(tabLabels()).toEqual(['主画面', 'OSC パッド', '設計図', '再送', 'ネットワーク'])
    expect(panel('destinations')?.hidden).toBe(false)
    expect(panel('surface')?.hidden).toBe(false)

    act(() => tab('OSC パッド')?.click())
    expect(panel('pad')?.hidden).toBe(false)
    expect(panel('surface')?.hidden).toBe(true)
    // 隠したタブの部品は作り直さない(操作中の入力欄を壊さない)
    expect(panel('surface')?.querySelector('[data-param="master"]')).not.toBeNull()
    expect(tab('OSC パッド')?.getAttribute('aria-selected')).toBe('true')

    act(() => tab('ネットワーク')?.click())
    expect(panel('network')?.hidden).toBe(false)
    expect(panel('pad')?.hidden).toBe(true)
  })

  it('makes the destinations a tab of their own on a narrow screen', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }))
    const { receive, tab, tabLabels, panel } = mount()
    receive(wireSample('downstream-hello'))
    expect(tabLabels()).toEqual(['主画面', 'OSC パッド', '設計図', '再送', '送信先', 'ネットワーク'])
    expect(panel('destinations')?.hidden).toBe(true)
    act(() => tab('送信先')?.click())
    expect(panel('destinations')?.hidden).toBe(false)
    expect(panel('surface')?.hidden).toBe(true)
  })

  it('shows each notice exactly once with every panel mounted', () => {
    const { receive, notices } = mount()
    receive(wireSample('downstream-hello'))
    receive(surfaceFrame())
    const codes = [
      'surface-rejected', 'set-rejected', 'row-rejected', 'locked', 'lock-rejected', 'record-key-rejected', 'batch-rejected',
      'runtime-options-refresh-rejected', 'runtime-options-apply-rejected', 'spawned', 'catalog-adopt-rejected', 'catalog-adopted',
      'destinations-rejected', 'destination-alias-rejected', 'destinations-scan-failed', 'destinations-save-failed',
      'destination-aliases-save-failed', 'network-settings-rejected', 'network-settings-save-failed', 'pad-rejected',
      'pad-press-rejected', 'project-export-rejected', 'project-import-rejected', 'project-imported',
      'resend-rejected', 'reconcile-rejected', 'reconciled',
    ]
    for (const code of codes) {
      const before = notices.history.value.length
      receive({ v: 1, type: 'notice', level: 'error', code, detail: 'x' })
      expect({ code, shown: notices.history.value.length - before }).toEqual({ code, shown: 1 })
    }
  })

  it('brings a list that differs from the first report after "一覧を更新" to the main tab, and applies it from there', () => {
    const { container, receive, tab, socket, panel } = mount()
    receive(wireSample('downstream-hello'))
    receive(surfaceFrame())
    const refresh = [...(panel('surface')?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((item) => item.textContent === '一覧を更新')
    act(() => refresh?.click())
    expect(socket().ofType('runtimeOptionsRefresh')).toHaveLength(1)

    act(() => tab('設計図')?.click())
    // 答えの一覧は初報と違うので、反映待ち(pending)として届く(D-088)
    receive({
      v: 1, type: 'runtimeOptions', lists: [], choices: [],
      pending: [{ list: 'segments', target: 'unity', added: ['Outro'], removed: [] }],
    })
    // 別のタブを見ていても、主画面のタブの印で気づける
    expect(tab('主画面')?.querySelector('.tab-badge')).not.toBeNull()
    act(() => tab('主画面')?.click())
    const pending = panel('surface')?.querySelector<HTMLElement>('section[aria-label="新しい一覧があります"]')
    expect(pending?.textContent).toContain('Segment の選択肢')
    act(() => pending?.querySelector<HTMLButtonElement>('[data-mark="pending-apply"]')?.click())
    expect(socket().ofType('runtimeOptionsApply').at(-1)).toEqual({ v: 1, type: 'runtimeOptionsApply', list: 'segments' })
    expect(container.textContent).toContain('Unity に一覧を要求しました')
  })
})
