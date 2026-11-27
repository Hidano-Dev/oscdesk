import { describe, expect, it } from 'vitest'

import { createTestLink, wireSample } from './test-support'
import { createUnityLinkStore } from './unity-link-store'

function setup() {
  const test = createTestLink()
  const store = createUnityLinkStore({ link: test.link, notices: test.notices })
  return { ...test, store }
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
})
