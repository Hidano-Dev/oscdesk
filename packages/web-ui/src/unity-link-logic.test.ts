import { describe, expect, it } from 'vitest'

import {
  reconcileRejectedText,
  reconciledText,
  resendRejectedText,
  rttText,
  targetLabel,
  unityLinkLabel,
} from './unity-link-logic'

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

  it('labels each target with its role and reach', () => {
    expect(targetLabel({ name: 'unity', primary: true, reachability: 'reachable', lastRttMs: 4, consecutiveLosses: 0, lastPongSeq: 1 }))
      .toEqual({ badge: '主系 / 接続中', tone: 'ok', detail: 'RTT 4 ms・連続喪失 0 回' })
    expect(targetLabel({ name: 'backup', primary: false, reachability: 'lost', lastRttMs: null, consecutiveLosses: 3, lastPongSeq: 9 }))
      .toEqual({ badge: '副系 / 未接続', tone: 'lost', detail: 'RTT -・連続喪失 3 回' })
    expect(targetLabel({ name: 'b', primary: false, reachability: 'unknown', lastRttMs: null, consecutiveLosses: 0, lastPongSeq: null }).badge).toBe('副系 / 未確認')
  })
})

describe('resend and reconcile notices', () => {
  it('explains the reasons the bridge gives', () => {
    expect(resendRejectedText('unknown-target: nope')).toContain('宛先「nope」が見つからない')
    expect(resendRejectedText('other')).toBe('再送できませんでした: other')
    expect(reconcileRejectedText('unknown-target: nope')).toContain('宛先「nope」が見つからない')
    expect(reconcileRejectedText('unsent-project')).toContain('まだ Unity へ送っていない')
    expect(reconcileRejectedText('other')).toBe('記録に合わせられません: other')
  })

  it('reads the counts of a reconcile and keeps an unexpected detail as is', () => {
    expect(reconciledText('backup: spawned 1, destroyed 2')).toBe('「backup」を生成の記録に合わせました(生成 1 件・削除 2 件)')
    expect(reconciledText('something')).toBe('生成の記録に合わせました(something)')
  })
})
