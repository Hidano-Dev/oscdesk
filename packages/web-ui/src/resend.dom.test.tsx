// @vitest-environment happy-dom
// 「再送」タブとヘッダーの Unity の接続状態(D-158)。stores.ts と同じ組み立てで描き、link の到達・喪失の表示と、
// 宛先ごとの「再送」「記録に合わせる」・「全台へ再送」の送信を確かめる
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import { App } from './app'
import { createAppStores } from './stores'
import { createTestLink, wireSample } from './test-support'

function mount() {
  const test = createTestLink()
  const stores = createAppStores({
    link: test.link, notices: test.notices, now: test.timers.now, setTimer: test.timers.setTimer, clearTimer: test.timers.clearTimer,
    holder: 'resend-test', randomId: () => 'r',
  })
  const container = document.createElement('div')
  document.body.append(container)
  act(() => render(<App link={test.link} notices={test.notices} {...stores} />, container))
  const receive = (frame: unknown) => act(() => test.socket().receive(frame))
  const panel = () => container.querySelector<HTMLElement>('#panel-resend')
  const unityLink = () => container.querySelector<HTMLElement>('.app-head [data-mark="unity-link"]')
  const row = (name: string) => panel()?.querySelector<HTMLElement>(`[data-target="${name}"]`)
  const click = (element: HTMLElement | null | undefined) => act(() => element?.click())
  return { ...test, container, receive, panel, unityLink, row, click }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('resend tab and Unity link status (happy-dom)', () => {
  it('shows the reach of Unity in the header and follows losses', () => {
    const { receive, unityLink, socket } = mount()
    expect(unityLink()?.textContent).toBe('Unity 未確認')
    receive(wireSample('downstream-link'))
    expect(unityLink()?.textContent).toBe('Unity 接続中 (4 ms, 連続喪失 0 回)')
    expect(unityLink()?.dataset.tone).toBe('ok')

    const lost = wireSample('downstream-link')
    if (lost.type !== 'link') throw new Error('not a link frame')
    receive({ ...lost, unity: { ...lost.unity, reachability: 'lost', consecutiveLosses: 3 } })
    expect(unityLink()?.textContent).toBe('Unity 未接続 (RTT 4 ms, 連続喪失 3 回)')
    expect(unityLink()?.dataset.tone).toBe('lost')

    act(() => socket().drop())
    expect(unityLink()?.textContent).toBe('Unity 未確認')
  })

  it('lists each target on its own row and sends resend for it', () => {
    const { container, receive, panel, row, click, socket } = mount()
    const tab = [...container.querySelectorAll<HTMLButtonElement>('.app-tabs [role="tab"]')].find((item) => item.textContent === '再送')
    click(tab)
    expect(panel()?.hidden).toBe(false)
    expect(panel()?.textContent).toContain('宛先がまだありません')

    receive(wireSample('downstream-link'))
    expect(row('unity')?.querySelector('[data-mark="target-state"]')?.textContent).toBe('主系 / 接続中')
    expect(row('backup')?.querySelector('[data-mark="target-state"]')?.textContent).toBe('副系 / 未接続')
    expect(row('backup')?.textContent).toContain('連続喪失 3 回')

    click(row('backup')?.querySelector<HTMLButtonElement>('[data-mark="resend"]'))
    click(panel()?.querySelector<HTMLButtonElement>('[data-mark="resend-all"]'))
    expect(socket().ofType('resend')).toEqual([{ v: 1, type: 'resend', target: 'backup' }, { v: 1, type: 'resend' }])
    // 生成の記録に合わせるボタンは撤去した(D-166)
    expect(row('backup')?.querySelector('[data-mark="reconcile"]')).toBeNull()
  })

  it('empties the tab while the bridge connection is lost', () => {
    const { receive, panel, socket } = mount()
    receive(wireSample('downstream-link'))
    expect(panel()?.querySelectorAll('[data-target]')).toHaveLength(2)
    act(() => socket().drop())
    expect(panel()?.querySelectorAll('[data-target]')).toHaveLength(0)
    expect(panel()?.querySelector('[data-mark="resend-all"]')).toBeNull()
  })
})
