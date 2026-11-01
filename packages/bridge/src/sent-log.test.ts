import { describe, expect, it, vi } from 'vitest'

import { DownstreamFrameSchema, SENT_LOG, SurfaceDefinitionSchema, SYS, type DownstreamFrame } from '@oscdesk/shared'

import { clipArgs, createSentLog } from './sent-log'
import { createSurfaceCore, type BridgeConfig } from './surface-core'
import { SAMPLE_DEFINITION } from './surface-fixture'

function makeLog(capacity?: number) {
  let clock = Date.parse('2026-10-14T00:00:00.000Z')
  let flush: (() => void) | undefined
  const publish = vi.fn<(frame: DownstreamFrame, target?: string) => void>()
  const setTimeoutFn = vi.fn((cb: () => void, ms: number) => {
    expect(ms).toBe(SENT_LOG.FLUSH_INTERVAL_MS)
    flush = cb
    return 1 as never
  })
  const log = createSentLog({ publish, now: () => clock, setTimeoutFn, clearTimeoutFn: vi.fn(), capacity })
  return {
    log,
    publish,
    setTimeoutFn,
    advance: (ms: number) => { clock += ms },
    flush: () => { const run = flush; flush = undefined; run?.() },
  }
}

const sentFrames = (publish: ReturnType<typeof makeLog>['publish']) =>
  publish.mock.calls.map(([frame]) => frame).filter(frame => frame.type === 'osc.sentLog')

describe('createSentLog', () => {
  it('batches records into one frame per flush interval and validates against the wire schema', () => {
    const { log, publish, setTimeoutFn, flush } = makeLog()
    log.record({ origin: 'ui', targets: ['unity'], messages: [{ address: '/a', args: [{ type: 'f', value: 0.5 }] }] })
    log.record({ origin: 'resend', targets: ['unity'], messages: [{ address: '/b', args: [] }] })
    expect(setTimeoutFn).toHaveBeenCalledTimes(1)
    expect(publish).not.toHaveBeenCalled()

    flush()
    expect(publish).toHaveBeenCalledTimes(1)
    const [frame, target] = publish.mock.calls[0]!
    expect(target).toBeUndefined()
    expect(DownstreamFrameSchema.safeParse(frame).success).toBe(true)
    expect(frame).toMatchObject({
      type: 'osc.sentLog', full: false,
      records: [
        { seq: 1, origin: 'ui', targets: ['unity'], address: '/a', args: [{ type: 'f', value: 0.5 }], count: 1, batch: null, clipped: false },
        { seq: 2, origin: 'resend', address: '/b', count: 1 },
      ],
    })
  })

  it('coalesces consecutive UI sends to the same address within the window and re-sends the same seq', () => {
    const { log, publish, advance, flush } = makeLog()
    const send = (value: number) => log.record({ origin: 'ui', targets: ['unity'], messages: [{ address: '/fader', args: [{ type: 'f', value }] }] })
    send(0.1); advance(100); send(0.2); advance(100); send(0.3)
    flush()
    expect(sentFrames(publish)[0]).toMatchObject({ records: [{ seq: 1, count: 3, args: [{ type: 'f', value: 0.3 }] }] })

    advance(100); send(0.4)
    flush()
    expect(sentFrames(publish)[1]).toMatchObject({ records: [{ seq: 1, count: 4 }] })

    // 窓(最初の送信から COALESCE_WINDOW_MS)を過ぎたら新しい記録にする
    advance(SENT_LOG.COALESCE_WINDOW_MS); send(0.5)
    flush()
    expect(sentFrames(publish)[2]).toMatchObject({ records: [{ seq: 2, count: 1 }] })
  })

  it('does not coalesce different record keys, other origins, or batches', () => {
    const { log } = makeLog()
    const row = (key: string) => log.record({ origin: 'ui', targets: ['unity'], messages: [{ address: '/vp/member', args: [{ type: 's', value: key }, { type: 'i', value: 1 }] }] })
    row('A'); row('B'); row('B')
    log.record({ origin: 'resend', targets: ['unity'], messages: [{ address: '/x', args: [] }] })
    log.record({ origin: 'resend', targets: ['unity'], messages: [{ address: '/x', args: [] }] })
    expect(log.snapshot().map(record => [record.address, record.count])).toEqual([
      ['/vp/member', 1], ['/vp/member', 2], ['/x', 1], ['/x', 1],
    ])
  })

  it('marks every message of a batch with the batch id, index and size', () => {
    const { log } = makeLog()
    const messages = [{ address: '/a', args: [] }, { address: '/a', args: [] }, { address: '/b', args: [] }]
    log.record({ origin: 'action', targets: ['unity', 'backup'], messages, batch: true })
    log.record({ origin: 'action', targets: ['unity'], messages: [{ address: '/c', args: [] }], batch: true })
    expect(log.snapshot().map(record => record.batch)).toEqual([
      { id: 1, index: 0, size: 3 }, { id: 1, index: 1, size: 3 }, { id: 1, index: 2, size: 3 }, { id: 2, index: 0, size: 1 },
    ])
    expect(log.snapshot()[0]!.targets).toEqual(['unity', 'backup'])
  })

  it('keeps only the newest records up to the capacity', () => {
    const { log, publish, flush } = makeLog(3)
    for (let index = 0; index < 5; index += 1) {
      log.record({ origin: 'resend', targets: ['unity'], messages: [{ address: `/v/${String(index)}`, args: [] }] })
    }
    expect(log.snapshot().map(record => record.seq)).toEqual([3, 4, 5])
    flush()
    // 上限で押し出された記録は配らない
    expect(sentFrames(publish)[0]).toMatchObject({ records: [{ seq: 3 }, { seq: 4 }, { seq: 5 }] })
  })

  it('sends the backlog to one client in chunks, the first one full', () => {
    const { log, publish } = makeLog()
    log.publishBacklog('c1')
    expect(publish).toHaveBeenLastCalledWith({ v: 1, type: 'osc.sentLog', full: true, records: [] }, 'c1')

    publish.mockClear()
    const total = SENT_LOG.MAX_RECORDS_PER_FRAME + 5
    for (let index = 0; index < total; index += 1) {
      log.record({ origin: 'request', targets: ['unity'], messages: [{ address: `/req/${String(index)}`, args: [] }] })
    }
    log.publishBacklog('c2')
    const frames = sentFrames(publish)
    expect(frames.map(frame => frame.type === 'osc.sentLog' && [frame.full, frame.records.length])).toEqual([
      [true, SENT_LOG.MAX_RECORDS_PER_FRAME], [false, 5],
    ])
    for (const frame of frames) expect(DownstreamFrameSchema.safeParse(frame).success).toBe(true)
    expect(publish.mock.calls.every(([, target]) => target === 'c2')).toBe(true)
  })

  it('stops scheduling after close', () => {
    const { log, setTimeoutFn } = makeLog()
    log.close()
    log.record({ origin: 'ui', targets: ['unity'], messages: [{ address: '/a', args: [] }] })
    expect(setTimeoutFn).not.toHaveBeenCalled()
  })
})

describe('clipArgs', () => {
  it('clips long strings, long blobs, too many arguments and non-finite floats', () => {
    const long = 'x'.repeat(SENT_LOG.MAX_STRING_CHARS + 10)
    expect(clipArgs([{ type: 's', value: long }])).toEqual({ args: [{ type: 's', value: 'x'.repeat(SENT_LOG.MAX_STRING_CHARS) }], clipped: true })
    const blob = clipArgs([{ type: 'b', value: new Uint8Array(SENT_LOG.MAX_BLOB_BYTES + 1) }])
    expect(blob.clipped).toBe(true)
    expect(Buffer.from(blob.args[0]!.value as string, 'base64').length).toBe(SENT_LOG.MAX_BLOB_BYTES)
    const many = clipArgs(Array.from({ length: SENT_LOG.MAX_ARGS + 1 }, () => ({ type: 'i' as const, value: 1 })))
    expect([many.args.length, many.clipped]).toEqual([SENT_LOG.MAX_ARGS, true])
    expect(clipArgs([{ type: 'f', value: Number.NaN }])).toEqual({ args: [{ type: 's', value: 'NaN' }], clipped: true })
    expect(clipArgs([{ type: 'b', value: new Uint8Array([0, 1, 2, 3]) }, { type: 'i', value: 7 }])).toEqual({
      args: [{ type: 'b', value: 'AAECAw==' }, { type: 'i', value: 7 }], clipped: false,
    })
  })
})

describe('surface-core send events (D-067)', () => {
  const CONFIG: BridgeConfig = {
    unity: { name: 'unity', host: '127.0.0.1', sendPort: 9000, secondary: [{ name: 'backup', host: '127.0.0.2', sendPort: 9000 }] },
    bridge: { oscListenHost: '0.0.0.0', oscListenPort: 9001, wsHost: '0.0.0.0', wsPort: 8080 },
    ui: { host: '0.0.0.0', port: 8080 },
    debug: false,
    boolFallbackToInt: false,
    diagnostics: { ringBufferSize: 200, lossRateWindow: 30, ndjsonDir: 'logs/diagnostics', ndjsonMaxTotalBytes: 52_428_800 },
    oscUi: { enabled: false, staticPeers: [], peerTtlMs: 0 },
    surfaces: { dir: 'surfaces' },
    destinations: { scanTimeoutMs: 8_000 },
    network: {},
  }

  it('reports UI sends, batches and resends but not pings', () => {
    const onSent = vi.fn()
    let tick: (() => void) | undefined
    const core = createSurfaceCore({
      config: CONFIG,
      sendFn: vi.fn(),
      sendBundleFn: () => ({ ok: true, bytes: 32, messageCount: 1 }),
      publish: vi.fn(),
      onSent,
      setIntervalFn: (cb) => { tick = cb; return 1 as never },
      clearIntervalFn: vi.fn(),
      logInfo: vi.fn(),
      logWarn: vi.fn(),
    })
    core.start()
    tick?.()
    expect(onSent).not.toHaveBeenCalled()

    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/a', args: [{ type: 'i', value: 1 }] }, 'c1')
    expect(onSent).toHaveBeenLastCalledWith({ origin: 'ui', targets: ['unity', 'backup'], messages: [{ address: '/a', args: [{ type: 'i', value: 1 }] }] })

    core.handleUiFrame({ v: 1, type: 'osc.batch', messages: [{ address: '/b', args: [] }, { address: '/c', args: [] }] }, 'c1')
    expect(onSent).toHaveBeenLastCalledWith({
      origin: 'action', targets: ['unity', 'backup'], batch: true,
      messages: [{ address: '/b', args: [] }, { address: '/c', args: [] }],
    })

    core.handleUiFrame({ v: 1, type: 'osc.message', address: SYS.PING, args: [] }, 'c1')
    expect(onSent).toHaveBeenCalledTimes(2)

    // 保持値の再送は宛先ごとに 1 件ずつ
    core.setDefinition(SurfaceDefinitionSchema.parse(SAMPLE_DEFINITION), 'stage')
    onSent.mockClear()
    core.handleUiFrame({ v: 1, type: 'resend', target: 'backup' }, 'c1')
    expect(onSent.mock.calls).toEqual([[{ origin: 'resend', targets: ['backup'], messages: [{ address: '/mix/master', args: [{ type: 'f', value: 0.5 }] }] }]])
    core.stop()
  })
})
