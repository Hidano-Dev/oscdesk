import { describe, expect, it } from 'vitest'

import { rttText, unityLinkLabel } from './unity-link-logic'

describe('unity link labels', () => {
  it('formats the RTT without a trailing .0 for whole numbers', () => {
    expect(rttText(null)).toBe('-')
    expect(rttText(4)).toBe('4 ms')
    expect(rttText(4.26)).toBe('4.3 ms')
  })

  it('shows reach, RTT and consecutive losses of the primary target', () => {
    expect(unityLinkLabel(null)).toEqual({ text: 'Unity 未確認', tone: 'unknown' })
    expect(unityLinkLabel({ reachability: 'unknown', lastRttMs: null, consecutiveLosses: 0, lastPongSeq: null }).tone).toBe('unknown')
    expect(unityLinkLabel({ reachability: 'reachable', lastRttMs: 4, consecutiveLosses: 0, lastPongSeq: 12 }))
      .toEqual({ text: 'Unity 接続中 (4 ms, 連続喪失 0 回)', tone: 'ok' })
    expect(unityLinkLabel({ reachability: 'lost', lastRttMs: 4, consecutiveLosses: 3, lastPongSeq: 12 }))
      .toEqual({ text: 'Unity 未接続 (RTT 4 ms, 連続喪失 3 回)', tone: 'lost' })
  })
})
