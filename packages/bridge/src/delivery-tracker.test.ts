import { describe, expect, it } from 'vitest'

import type { DownstreamFrame } from '@oscdesk/shared'

import { createDeliveryTracker } from './delivery-tracker'

function setup(options: { minIntervalMs?: number; capacity?: number; ttlMs?: number } = {}) {
  let clock = 1000
  const frames: DownstreamFrame[] = []
  const tracker = createDeliveryTracker({ publish: frame => frames.push(frame), now: () => clock, ...options })
  const events = () => frames.flatMap(frame => (frame.type === 'delivery' ? frame.events : []))
  return { tracker, events, advance: (ms: number) => { clock += ms } }
}

describe('delivery tracker', () => {
  it('turns an echo for a sent address into an ok event with the elapsed time', () => {
    const { tracker, events, advance } = setup()
    tracker.noteSent('PC1', '/a')
    advance(7)
    tracker.onEcho('PC1', '10.0.0.1', '/a')
    expect(events()).toEqual([{ host: '10.0.0.1', target: 'PC1', result: 'ok', address: '/a', elapsedMs: 7 }])
  })

  it('ignores echoes and reports for addresses that were not sent to that target', () => {
    const { tracker, events } = setup()
    tracker.noteSent('PC1', '/a')
    tracker.onEcho('PC1', '10.0.0.1', '/other')
    tracker.onEcho('PC2', '10.0.0.2', '/a')
    tracker.onReport('PC2', '10.0.0.2', 'failed', ['/a'])
    expect(events()).toEqual([])
  })

  it('reports ignored and failed per address after the echo', () => {
    const { tracker, events } = setup()
    tracker.noteSent('PC2', '/a')
    tracker.noteSent('PC2', '/b')
    tracker.onEcho('PC2', '10.0.0.2', '/a')
    tracker.onReport('PC2', '10.0.0.2', 'ignored', ['/a'])
    tracker.onReport('PC2', '10.0.0.2', 'failed', ['/b', '/never-sent'])
    expect(events().map(e => [e.result, e.address])).toEqual([['ok', '/a'], ['ignored', '/a'], ['failed', '/b']])
  })

  it('reports each host once per send, so a broadcast target gets one event per answering host', () => {
    const { tracker, events } = setup()
    tracker.noteSent('ALL', '/a')
    tracker.onEcho('ALL', '10.0.0.1', '/a')
    tracker.onEcho('ALL', '10.0.0.2', '/a')
    tracker.onEcho('ALL', '10.0.0.1', '/a')
    expect(events().map(e => e.host)).toEqual(['10.0.0.1', '10.0.0.2'])
  })

  it('a new send re-arms the report, and a late echo is reported with its delay', () => {
    const { tracker, events, advance } = setup({ minIntervalMs: 0 })
    tracker.noteSent('PC1', '/a')
    tracker.onEcho('PC1', 'h', '/a')
    advance(50)
    tracker.noteSent('PC1', '/a')
    advance(400)
    tracker.onEcho('PC1', 'h', '/a')
    expect(events().map(e => e.elapsedMs)).toEqual([0, 400])
  })

  it('limits the rate per target, host and result without hiding a failure behind a stream of ok', () => {
    const { tracker, events, advance } = setup({ minIntervalMs: 100 })
    for (let i = 0; i < 20; i++) {
      tracker.noteSent('PC1', '/slider')
      tracker.onEcho('PC1', 'h', '/slider')
      if (i === 10) tracker.onReport('PC1', 'h', 'failed', ['/slider'])
      advance(10)
    }
    const results = events().map(e => e.result)
    expect(results.filter(r => r === 'ok').length).toBeLessThanOrEqual(3)
    expect(results.filter(r => r === 'failed')).toHaveLength(1)
  })

  it('forgets sends after the ttl and beyond the capacity', () => {
    const { tracker, events, advance } = setup({ ttlMs: 1000, capacity: 2 })
    tracker.noteSent('PC1', '/old')
    advance(1500)
    tracker.onEcho('PC1', 'h', '/old')
    tracker.noteSent('PC1', '/a')
    tracker.noteSent('PC1', '/b')
    tracker.noteSent('PC1', '/c')
    tracker.onEcho('PC1', 'h', '/a')
    expect(events()).toEqual([])
    tracker.onEcho('PC1', 'h', '/c')
    expect(events()).toHaveLength(1)
  })
})
