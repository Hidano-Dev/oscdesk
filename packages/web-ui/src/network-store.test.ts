import { describe, expect, it } from 'vitest'

import { createNetworkStore, APPLY_TIMEOUT_MS } from './network-store'
import type { NetworkSettingsFrame } from './network-logic'
import { createTestLink, wireSample } from './test-support'

const base = wireSample('downstream-network-settings') as NetworkSettingsFrame
const hello = { ...wireSample('downstream-hello-with-peer') }

function setup() {
  const test = createTestLink()
  const store = createNetworkStore({ link: test.link, notices: test.notices, setTimer: test.timers.setTimer, clearTimer: test.timers.clearTimer })
  const receive = (frame: unknown) => test.socket().receive(frame)
  const sets = () => test.socket().ofType('networkSettingsSet')
  return { ...test, store, receive, sets }
}

describe('network store (D-153)', () => {
  it('sends the settings without naming a browser, with the revision the edit started from, and clears the draft once applied', () => {
    const { store, receive, sets, notices } = setup()
    receive(hello)
    receive(base)
    expect(store.peer.value).toBe('192.168.1.30')
    store.addThisBrowser()
    expect(store.inputs.value?.allowedBrowsers).toBe('192.168.1.0/24\n10.0.0.5/32\n192.168.1.30')

    // 編集中にほかのブラウザが保存しても、下書きは残り、送る版は入力を始めたときの版のまま
    receive({ ...base, revision: 4, targetRanges: ['10.0.0.0/24'] })
    expect(store.inputs.value?.allowedBrowsers).toContain('192.168.1.30')
    store.apply()
    expect(sets()).toEqual([{
      v: 1, type: 'networkSettingsSet', revision: 3, targetInterface: '192.168.1.10',
      targetRanges: ['192.168.1.0/24'], allowedBrowsers: ['192.168.1.0/24', '10.0.0.5/32', '192.168.1.30'],
    }])
    expect(sets()[0]).not.toHaveProperty('browser')
    expect(store.canApply.value).toBe(false)

    // 断られたら入力を残し、次の保存は今の版での上書きにする
    receive({ v: 1, type: 'notice', level: 'error', code: 'network-settings-rejected', detail: 'stale-revision: 3 (current 4)' })
    receive({ ...base, revision: 4, targetRanges: ['10.0.0.0/24'] })
    expect(notices.items.value.at(-1)?.text).toContain('ほかのブラウザが先に設定を変えました')
    expect(store.inputs.value?.allowedBrowsers).toContain('192.168.1.30')
    expect(store.canApply.value).toBe(true)
    store.apply()
    expect(sets()[1]).toMatchObject({ revision: 4 })

    // 自分の変更が通った(要求元にだけ届く applied)ら下書きを消し、入力欄はブリッジの設定(正規形)に追従する
    receive({ ...base, revision: 5, allowedBrowsers: ['192.168.1.0/24', '10.0.0.5/32', '192.168.1.30/32'] })
    // 応答待ちの間は送った値を見せる
    expect(store.inputs.value?.allowedBrowsers).toBe('192.168.1.0/24\n10.0.0.5/32\n192.168.1.30')
    receive({ v: 1, type: 'notice', level: 'info', code: 'network-settings-applied', detail: 'revision: 5' })
    expect(store.draft.value).toBeNull()
    expect(store.inputs.value?.allowedBrowsers).toBe('192.168.1.0/24\n10.0.0.5/32\n192.168.1.30/32')
    expect(store.canApply.value).toBe(true)
  })

  it('keeps the pending draft and the typing made while waiting when another browser saves first (Codex P2 on #155)', () => {
    const { store, receive, sets, notices } = setup()
    receive(base)
    store.edit({ allowedBrowsers: '192.168.1.0/24' })
    store.apply()
    expect(sets()).toHaveLength(1)
    // 応答待ちの間に打ち足す
    store.edit({ targetRanges: '192.168.1.0/25' })

    // ほかのブラウザの変更が先に通り、その配信が届く。自分の下書きも打ち足した入力も消えない
    receive({ ...base, revision: 4, targetRanges: ['10.0.0.0/24'] })
    expect(store.inputs.value).toMatchObject({ targetRanges: '192.168.1.0/25', allowedBrowsers: '192.168.1.0/24' })
    expect(store.pending.value).not.toBeNull()

    // 自分の要求は古い版として断られる。入力は残り、直して送り直せる(今の版で)
    receive({ v: 1, type: 'notice', level: 'error', code: 'network-settings-rejected', detail: 'stale-revision: 3 (current 4)' })
    receive({ ...base, revision: 4, targetRanges: ['10.0.0.0/24'] })
    expect(notices.items.value.at(-1)?.text).toContain('ほかのブラウザが先に')
    expect(store.inputs.value).toMatchObject({ targetRanges: '192.168.1.0/25', allowedBrowsers: '192.168.1.0/24' })
    store.apply()
    expect(sets()[1]).toMatchObject({ revision: 4, targetRanges: ['192.168.1.0/25'], allowedBrowsers: ['192.168.1.0/24'] })
  })

  it('keeps the typing made while waiting even when its own save is applied', () => {
    const { store, receive, sets } = setup()
    receive(base)
    store.edit({ allowedBrowsers: '192.168.1.0/24' })
    store.apply()
    store.edit({ targetRanges: '' })
    receive({ ...base, revision: 4, allowedBrowsers: ['192.168.1.0/24'] })
    receive({ v: 1, type: 'notice', level: 'info', code: 'network-settings-applied', detail: 'revision: 4' })
    expect(store.pending.value).toBeNull()
    expect(store.inputs.value).toMatchObject({ targetRanges: '', allowedBrowsers: '192.168.1.0/24' })
    // 打ち足した入力は、通った版の上の編集として送る
    store.apply()
    expect(sets()[1]).toMatchObject({ revision: 4, targetRanges: [] })
  })

  it('keeps an input changed back to the old settings while waiting, and lets it be saved after the change is applied (Codex P2 on #155)', () => {
    const { store, receive, sets } = setup()
    receive(wireSample('downstream-network-settings-default'))
    store.edit({ targetInterface: '127.0.0.1' })
    store.apply()
    // 応答の前に「すべてのネットワーク」へ戻す(届いている設定は変更前のまま)
    store.edit({ targetInterface: '' })
    expect(store.inputs.value?.targetInterface).toBe('')
    receive({ ...wireSample('downstream-network-settings-default'), revision: 1, targetInterface: '127.0.0.1', source: 'saved' })
    receive({ v: 1, type: 'notice', level: 'info', code: 'network-settings-applied', detail: 'revision: 1' })
    // 通った版の上の下書きとして残り、もう一度保存できる
    expect(store.inputs.value?.targetInterface).toBe('')
    expect(store.draft.value).not.toBeNull()
    store.apply()
    expect(sets()[1]).toMatchObject({ revision: 1, targetInterface: null })
  })

  it('shows the sent values while waiting and keeps them when the save is refused', () => {
    const { store, receive } = setup()
    receive(base)
    store.edit({ targetRanges: '10.0.0.0/24' })
    store.apply()
    // 送った値と同じ入力に戻すのは「未編集」、送った値から変えたものが下書き
    store.edit({ targetRanges: '10.0.0.0/25' })
    store.edit({ targetRanges: '10.0.0.0/24' })
    expect(store.draft.value).toBeNull()
    expect(store.inputs.value?.targetRanges).toBe('10.0.0.0/24')
    receive({ v: 1, type: 'notice', level: 'error', code: 'network-settings-rejected', detail: 'invalid-target-range: x' })
    receive(base)
    expect(store.inputs.value?.targetRanges).toBe('10.0.0.0/24')
  })

  it('drops the draft when the inputs match the bridge again, and on discard', () => {
    const { store, receive } = setup()
    receive(base)
    store.edit({ targetRanges: '' })
    expect(store.draft.value).not.toBeNull()
    store.edit({ targetRanges: '192.168.1.0/24' })
    expect(store.draft.value).toBeNull()
    store.allowAll()
    expect(store.inputs.value?.allowedBrowsers).toBe('0.0.0.0/0\n::/0')
    store.discard()
    expect(store.inputs.value?.allowedBrowsers).toBe('192.168.1.0/24\n10.0.0.5/32')
  })

  it('gives up waiting after the timeout and when the connection drops', () => {
    const { store, receive, timers, socket, notices } = setup()
    receive(base)
    store.apply()
    expect(store.pending.value).not.toBeNull()
    timers.advance(APPLY_TIMEOUT_MS + 1)
    expect(store.pending.value).toBeNull()
    expect(notices.items.value.at(-1)?.text).toContain('応答がブリッジから届きませんでした')

    store.apply()
    expect(store.pending.value).not.toBeNull()
    socket().drop()
    expect(store.pending.value).toBeNull()
    expect(store.canApply.value).toBe(false)
    store.apply()
    expect(notices.items.value.at(-1)?.text).toContain('ブリッジに接続していないため')
  })

  it('does not know this browser without hello.peer', () => {
    const { store, receive } = setup()
    receive(wireSample('downstream-hello'))
    receive(base)
    expect(store.peer.value).toBeNull()
    store.addThisBrowser()
    expect(store.draft.value).toBeNull()
  })
})
