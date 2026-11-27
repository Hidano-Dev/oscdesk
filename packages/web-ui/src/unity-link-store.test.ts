import { describe, expect, it } from 'vitest'

import { createTestLink, wireSample } from './test-support'
import { createUnityLinkStore, OFFLINE_MESSAGE } from './unity-link-store'

function setup() {
  const test = createTestLink()
  const store = createUnityLinkStore({ link: test.link, notices: test.notices })
  const texts = () => test.notices.items.value.map((notice) => `${notice.level}: ${notice.text}`)
  return { ...test, store, texts }
}

describe('unity link store', () => {
  it('keeps the latest link frame and drops it when the bridge connection is lost', () => {
    const { store, socket } = setup()
    expect(store.unity.value).toBeNull()
    socket().receive(wireSample('downstream-link'))
    expect(store.unity.value?.reachability).toBe('reachable')
    expect(store.targets.value.map((target) => target.name)).toEqual(['unity', 'backup'])

    // ブリッジにつながっていなければ Unity に届いているかは分からないので、古い到達を出し続けない
    socket().drop()
    expect(store.unity.value).toBeNull()
    expect(store.targets.value).toEqual([])
  })

  it('sends resend to one target or all, and reconcile to one target', () => {
    const { store, socket } = setup()
    expect(store.resend('backup')).toBe(true)
    expect(store.resend()).toBe(true)
    expect(store.reconcile('backup')).toBe(true)
    expect(socket().ofType('resend')).toEqual([{ v: 1, type: 'resend', target: 'backup' }, { v: 1, type: 'resend' }])
    expect(socket().ofType('reconcile')).toEqual([{ v: 1, type: 'reconcile', target: 'backup' }])
  })

  it('warns instead of sending while the bridge is not connected', () => {
    const { store, socket, texts } = setup()
    socket().drop()
    expect(store.resend()).toBe(false)
    expect(store.reconcile('unity')).toBe(false)
    expect(texts()).toEqual([`warn: ${OFFLINE_MESSAGE}`, `warn: ${OFFLINE_MESSAGE}`])
  })

  it('shows the results and rejections of resend and reconcile', () => {
    const { socket, texts } = setup()
    socket().receive({ v: 1, type: 'notice', level: 'info', code: 'reconciled', detail: 'backup: spawned 1, destroyed 0' })
    socket().receive({ v: 1, type: 'notice', level: 'error', code: 'reconcile-rejected', detail: 'unsent-project' })
    socket().receive({ v: 1, type: 'notice', level: 'error', code: 'resend-rejected', detail: 'unknown-target: nope' })
    socket().receive({ v: 1, type: 'notice', level: 'error', code: 'pad-rejected', detail: 'x' })
    expect(texts()).toEqual([
      'info: 「backup」を生成の記録に合わせました(生成 1 件・削除 0 件)',
      expect.stringContaining('error: 読み込んだプロジェクトをまだ Unity へ送っていない'),
      expect.stringContaining('error: 宛先「nope」が見つからない'),
    ])
  })
})
