import { describe, expect, it, vi } from 'vitest'

import {
  DiagnosticsSnapshotSchema,
  OSCDESK,
  SYS,
  type DownstreamFrame,
} from '@oscdesk/shared'

import { OscUiRouter } from '../osc-ui-router'
import { createSurfaceCore, type BridgeConfig } from './'

const BRIDGE_CONFIG: BridgeConfig = {
  unity: { name: 'unity', host: '127.0.0.1', sendPort: 9000, secondary: [] },
  bridge: { oscListenHost: '0.0.0.0', oscListenPort: 9001, wsHost: '0.0.0.0', wsPort: 8080 },
  debug: false,
  boolFallbackToInt: false,
  diagnostics: {
    ringBufferSize: 200,
    lossRateWindow: 30,
    ndjsonDir: 'logs/diagnostics',
    ndjsonMaxTotalBytes: 52_428_800,
  },
  oscUi: { enabled: true, staticPeers: [], peerTtlMs: 0 },
  surfaces: { dir: 'surfaces' },
  destinations: {},
  network: {}, webUi: { enabled: true },
  oscQuery: { mdns: false, targets: [], queryIntervalMs: 30_000, fetchTimeoutMs: 5_000, refreshDebounceMs: 250 },
}

const DIAGNOSTICS_SNAPSHOT = DiagnosticsSnapshotSchema.parse({
  reachability: 'reachable', lastRttMs: 12, consecutiveLosses: 0,
  lossRate: { windowSize: 30, observed: 1, lost: 0, rate: 0 },
  subnet: { kind: 'sameHost' }, logUsage: { totalBytes: 128, limitBytes: 1024, overLimit: false }, recentMessages: [],
})


function makeCore(overrides: Partial<Parameters<typeof createSurfaceCore>[0]> = {}) {
  const sendFn = vi.fn()
  const publish = vi.fn<(frame: DownstreamFrame, target?: string) => void>()
  const core = createSurfaceCore({ config: BRIDGE_CONFIG, sendFn, publish, ...overrides })
  return { core, sendFn, publish }
}


describe('createSurfaceCore', () => {
  it('starts a 2 second loop for ping', () => {
    const setIntervalFn = vi.fn<(callback: () => void, intervalMs: number) => ReturnType<typeof setInterval>>()
    let tick: (() => void) | undefined
    setIntervalFn.mockImplementation((callback, intervalMs) => { expect(intervalMs).toBe(2000); tick = callback; return 1 as never })
    const { core, sendFn } = makeCore({ setIntervalFn })
    core.start()
    expect(sendFn).not.toHaveBeenCalled()
    tick?.()
    expect(sendFn).toHaveBeenCalledWith('127.0.0.1', 9000, SYS.PING, { type: 'i', value: 1 })
  })

  it('swallows pong messages and publishes no pong frame while updating link state', () => {
    const now = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(100)
    const setIntervalFn = vi.fn<(callback: () => void, intervalMs: number) => ReturnType<typeof setInterval>>()
    let tick: (() => void) | undefined
    setIntervalFn.mockImplementation((callback) => { tick = callback; return 1 as never })
    const { core, publish } = makeCore({ now, setIntervalFn })

    core.start(); tick?.()
    core.handleOscIn({ address: SYS.PONG, args: [{ type: 'i', value: 1 }], from: { host: '127.0.0.1', port: 9000 } })
    core.handleOscIn({ address: SYS.PONG, args: [{ type: 's', value: '1' }], from: { host: '127.0.0.1', port: 9000 } })

    expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'osc.message', address: SYS.PONG }), expect.anything())
    expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'osc.message', address: SYS.PONG }))
  })

  it('does not forward /sys/* messages to the UI and publishes external OSC messages', () => {
    const { core, publish } = makeCore()

    core.handleOscIn({ address: '/sys/stats', args: [{ type: 's', value: '{}' }], from: { host: '127.0.0.1', port: 9000 } })
    core.handleOscIn({ address: '/avatar/position', args: [{ type: 'f', value: 1.25 }], from: { host: '127.0.0.1', port: 9000 } })

    expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'osc.message', address: '/sys/stats' }))
    expect(publish).toHaveBeenCalledWith({
      v: 1, type: 'osc.message', address: '/avatar/position',
      args: [{ type: 'f', value: 1.25 }], from: { host: '127.0.0.1', port: 9000 },
    })
  })

  it('keeps diagnostics fully disabled when debug is false', () => {
    const createDiagnosticsEngine = vi.fn()
    const { core } = makeCore({ createDiagnosticsEngine })
    core.start()
    expect(createDiagnosticsEngine).not.toHaveBeenCalled()
  })

  it('enables diagnostics hooks in debug mode and records bridge traffic and ping state', () => {
    const recordIncoming = vi.fn(); const recordOutgoing = vi.fn(); const onPingCycle = vi.fn(); const onPongAccepted = vi.fn()
    const createDiagnosticsEngine = vi.fn().mockReturnValue({ recordIncoming, recordOutgoing, onPingCycle, onPongAccepted, dispose: vi.fn() })
    const setIntervalFn = vi.fn<(callback: () => void, intervalMs: number) => ReturnType<typeof setInterval>>()
    let tick: (() => void) | undefined
    setIntervalFn.mockImplementation((callback) => { tick = callback; return 7 as never })
    const { core } = makeCore({
      config: { ...BRIDGE_CONFIG, debug: true }, createDiagnosticsEngine, setIntervalFn,
    })

    core.start(); tick?.()
    core.handleOscIn({ address: SYS.PONG, args: [{ type: 'i', value: 1 }], from: { host: '127.0.0.1', port: 9000 } })

    expect(createDiagnosticsEngine).toHaveBeenCalledTimes(1)
    expect(recordOutgoing).toHaveBeenCalledWith(SYS.PING, [{ type: 'i', value: 1 }], '127.0.0.1', 9000)
    expect(onPingCycle).toHaveBeenCalledWith({ previousLost: false })
    expect(recordIncoming).toHaveBeenCalledWith(SYS.PONG, [{ type: 'i', value: 1 }], '127.0.0.1', 9000)
    expect(onPongAccepted).toHaveBeenCalledTimes(1)
  })

  it('records UI-originated OSC traffic before sending it to Unity', () => {
    const recordOutgoing = vi.fn()
    const { core, sendFn } = makeCore({
      config: { ...BRIDGE_CONFIG, debug: true },
      createDiagnosticsEngine: vi.fn().mockReturnValue({ recordOutgoing, dispose: vi.fn() }),
    })
    core.start()
    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/avatar/position', args: [{ type: 'f', value: 1.25 }] }, 'client-1')

    expect(sendFn).toHaveBeenCalledWith('127.0.0.1', 9000, '/avatar/position', { type: 'f', value: 1.25 })
    expect(recordOutgoing).toHaveBeenCalledWith('/avatar/position', [{ type: 'f', value: 1.25 }], '127.0.0.1', 9000)
  })

  it('sends an oscBatch as one bundle and records each message after success', () => {
    const sendBundleFn = vi.fn().mockReturnValue({ ok: true, bytes: 128, messageCount: 2 })
    const recordOutgoing = vi.fn()
    const { core, sendFn, publish } = makeCore({
      config: { ...BRIDGE_CONFIG, debug: true },
      sendBundleFn,
      createDiagnosticsEngine: vi.fn().mockReturnValue({ recordOutgoing, dispose: vi.fn() }),
    })
    core.start()
    recordOutgoing.mockClear()
    sendFn.mockClear(); publish.mockClear()

    core.handleUiFrame({
      v: 1,
      type: 'osc.batch',
      messages: [
        { address: '/value', args: [{ type: 'f', value: 0.5 }] },
        { address: '/update', args: [{ type: 'i', value: 1 }] },
      ],
    }, 'client-1')

    expect(sendBundleFn).toHaveBeenCalledTimes(1)
    expect(sendBundleFn).toHaveBeenCalledWith('127.0.0.1', 9000, [
      { address: '/value', args: [{ type: 'f', value: 0.5 }] },
      { address: '/update', args: [{ type: 'i', value: 1 }] },
    ])
    expect(sendFn).not.toHaveBeenCalled()
    expect(recordOutgoing).toHaveBeenCalledTimes(2)
    expect(publish).not.toHaveBeenCalled()
  })

  it('rejects a batch containing an internal address without sending or recording it', () => {
    const sendBundleFn = vi.fn()
    const recordOutgoing = vi.fn()
    const { core, publish } = makeCore({
      config: { ...BRIDGE_CONFIG, debug: true },
      sendBundleFn,
      createDiagnosticsEngine: vi.fn().mockReturnValue({ recordOutgoing, dispose: vi.fn() }),
    })
    core.start(); recordOutgoing.mockClear(); publish.mockClear()

    core.handleUiFrame({
      v: 1,
      type: 'osc.batch',
      messages: [{ address: '/sys/ping', args: [] }, { address: '/value', args: [] }],
    }, 'client-1')

    expect(sendBundleFn).not.toHaveBeenCalled()
    expect(recordOutgoing).not.toHaveBeenCalled()
    expect(publish).toHaveBeenCalledWith({
      v: 1, type: 'notice', level: 'error', code: 'batch-rejected', detail: 'internal-address: /sys/ping',
    }, 'client-1')
  })

  it('rejects an oversized bundle with a client-only notice', () => {
    const sendBundleFn = vi.fn().mockReturnValue({ ok: false, reason: 'too-large', bytes: 61_440, limitBytes: 61_440 })
    const recordOutgoing = vi.fn()
    const { core, publish } = makeCore({
      config: { ...BRIDGE_CONFIG, debug: true },
      sendBundleFn,
      createDiagnosticsEngine: vi.fn().mockReturnValue({ recordOutgoing, dispose: vi.fn() }),
    })
    core.start(); recordOutgoing.mockClear(); publish.mockClear()

    core.handleUiFrame({
      v: 1,
      type: 'osc.batch',
      messages: [{ address: '/value', args: [] }],
    }, 'client-1')

    expect(recordOutgoing).not.toHaveBeenCalled()
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'notice', level: 'error', code: 'batch-rejected', detail: 'too-large: 61440 bytes (limit 61440)',
    }), 'client-1')
  })

  it('publishes hello then link, and nothing else, when a UI connects', () => {
    const { core, publish } = makeCore()
    core.start()
    publish.mockClear()

    core.onUiConnected('client-1')

    expect(publish.mock.calls.map(([frame, target]) => [frame.type, target])).toEqual([
      ['hello', 'client-1'],
      ['link', 'client-1'],
    ])
  })

  it('puts the resolved Unity, bridge, heartbeat, and debug settings in hello', () => {
    const { core } = makeCore({
      config: {
        ...BRIDGE_CONFIG,
        debug: true,
        unity: { name: 'unity', host: 'unity.example.test', sendPort: 9100, secondary: [] },
        bridge: { oscListenHost: '0.0.0.0', oscListenPort: 9200, wsHost: '0.0.0.0', wsPort: 9300 },
      },
    })

    expect(core.helloFrame('client-1')).toEqual({
      v: 1,
      type: 'hello',
      clientId: 'client-1',
      protocolVersion: 1,
      server: { name: 'oscdesk-bridge', version: '0.1.0' },
      unity: { host: 'unity.example.test', sendPort: 9100 },
      targets: [{ name: 'unity', host: 'unity.example.test', sendPort: 9100, primary: true }],
      bridge: { oscListenPort: 9200, wsPort: 9300 },
      heartbeat: { intervalMs: 15_000, timeoutMs: 30_000 },
      pingIntervalMs: 2_000,
      debug: true,
      adapters: ['osc'],
    })
  })

  it('puts the connection peer in hello only when it is known (D-153)', () => {
    const { core, publish } = makeCore()
    core.start()
    publish.mockClear()
    core.onUiConnected('client-1', '192.168.1.30')
    expect(publish.mock.calls[0]?.[0]).toMatchObject({ type: 'hello', peer: '192.168.1.30' })
    expect(core.helloFrame('client-2', '')).not.toHaveProperty('peer')
    expect(core.helloFrame('client-3')).not.toHaveProperty('peer')
    expect(core.helloFrame('client-4', `fe80::1%${'x'.repeat(80)}`)).not.toHaveProperty('peer')
  })


  it('sends a UI value only to the configured Unity destination', () => {
    const { core, sendFn } = makeCore({
      config: {
        ...BRIDGE_CONFIG,
        unity: { name: 'unity', host: 'unity.example.test', sendPort: 9100, secondary: [] },
      },
    })
    core.start()
    sendFn.mockClear()

    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/avatar/position', args: [{ type: 'f', value: 1.25 }] }, 'client-1')

    expect(sendFn).toHaveBeenCalledTimes(1)
    expect(sendFn).toHaveBeenCalledWith('unity.example.test', 9100, '/avatar/position', { type: 'f', value: 1.25 })
  })

  it('blocks UI values in the internal namespace and warns only once', () => {
    const logWarn = vi.fn()
    const { core, sendFn } = makeCore({ logWarn })
    core.start()
    sendFn.mockClear()

    const frame = { v: 1 as const, type: 'osc.message' as const, address: OSCDESK.STATUS, args: [] }
    core.handleUiFrame(frame, 'client-1')
    core.handleUiFrame(frame, 'client-1')

    expect(sendFn).not.toHaveBeenCalled()
    expect(logWarn).toHaveBeenCalledTimes(1)
    expect(logWarn).toHaveBeenCalledWith('(WARN, BRIDGE)', expect.stringContaining(OSCDESK.STATUS))
  })

  it('throttles link-state frames to at most one per ping period', () => {
    let nowMs = 0
    let tick: (() => void) | undefined
    const setIntervalFn = vi.fn<(callback: () => void, intervalMs: number) => ReturnType<typeof setInterval>>()
    setIntervalFn.mockImplementation((callback) => { tick = callback; return 1 as never })
    const { core, publish } = makeCore({ now: () => nowMs, setIntervalFn })
    core.start()
    core.onUiConnected('client-1')
    publish.mockClear()

    nowMs = 1_000; tick?.()
    nowMs = 1_999; tick?.()
    nowMs = 2_000; tick?.()

    expect(publish.mock.calls.filter(([frame]) => frame.type === 'link')).toHaveLength(1)
  })

  it('clears the ping timer only once when stop is called repeatedly', () => {
    const clearIntervalFn = vi.fn(); const { core } = makeCore({
      clearIntervalFn, setIntervalFn: () => 99 as never,
    })
    core.start(); core.stop(); core.stop()
    expect(clearIntervalFn).toHaveBeenCalledTimes(1)
    expect(clearIntervalFn).toHaveBeenCalledWith(99)
  })

  it('swallows the announcement and registers the UI peer', () => {
    const router = new OscUiRouter({ unity: { host: '127.0.0.1', port: 9000 }, config: BRIDGE_CONFIG.oscUi })
    expect(router.registerPeer('192.168.0.50', 9100, 0)).toEqual({ added: true, peer: { host: '192.168.0.50', port: 9100 } })
  })

  it('publishes registered-peer OSC frames and sends the same UI message to Unity', () => {
    const { core, publish, sendFn } = makeCore()
    const message = { address: '/avatar/position', args: [{ type: 'f' as const, value: 0.5 }], from: { host: '192.168.0.50', port: 9100 } }
    core.handleOscIn(message)
    core.handleUiFrame({ v: 1, type: 'osc.message', address: message.address, args: message.args }, 'client-1')

    expect(publish).toHaveBeenCalledWith({ v: 1, type: 'osc.message', address: message.address, args: message.args, from: message.from })
    expect(sendFn).toHaveBeenCalledWith('127.0.0.1', 9000, message.address, ...message.args)
  })

  it('falls back to the source port when the announcement carries no port', () => {
    const router = new OscUiRouter({ unity: { host: '127.0.0.1', port: 9000 }, config: BRIDGE_CONFIG.oscUi })
    router.registerPeer('192.168.0.50', 54321, 0); expect(router.activePeers(0)).toContainEqual({ host: '192.168.0.50', port: 54321 })
  })

  it('matches Unity echoes against resolved addresses when unity.host is a hostname', () => {
    const router = new OscUiRouter({
      unity: { host: 'localhost', port: 9000 },
      unityAddresses: ['127.0.0.1', '::1'],
      config: BRIDGE_CONFIG.oscUi,
    })
    router.registerPeer('192.168.0.50', 9100, 0)
    // UDP の送信元は常に数値アドレスで届く
    expect(router.route({ host: '127.0.0.1', port: 51234 }, 0)).toEqual({
      kind: 'to-ui', targets: [{ host: '192.168.0.50', port: 9100 }],
    })
  })

  it('ignores pongs from non-Unity sources and warns once per host', () => {
    const logWarn = vi.fn()
    const { core, publish } = makeCore({ logWarn })
    core.handleOscIn({ address: SYS.PONG, args: [{ type: 'i', value: 1 }], from: { host: '192.168.0.99', port: 9000 } })

    expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'link' }))
    expect(logWarn).toHaveBeenCalledTimes(1)
  })

  it('blocks UI frames addressed to /sys/* and warns only once', () => {
    const logWarn = vi.fn()
    const { core, sendFn } = makeCore({ logWarn })
    core.handleUiFrame({ v: 1, type: 'osc.message', address: SYS.PING, args: [{ type: 'i', value: 1 }] }, 'client-1')
    core.handleUiFrame({ v: 1, type: 'osc.message', address: SYS.PING, args: [{ type: 'i', value: 2 }] }, 'client-1')

    expect(sendFn).not.toHaveBeenCalled()
    expect(logWarn).toHaveBeenCalledTimes(1)
  })

  it('routes Unity replies sent from an ephemeral source port to registered UI peers', () => {
    const router = new OscUiRouter({ unity: { host: '10.0.0.5', port: 9000 }, config: BRIDGE_CONFIG.oscUi })
    router.registerPeer('192.168.0.50', 9100, 0)
    // uOsc 系実装は返信を別ソケットから送るため、送信元ポートは待受ポートと一致しない
    expect(router.route({ host: '10.0.0.5', port: 51234 }, 0)).toEqual({
      kind: 'to-ui', targets: [{ host: '192.168.0.50', port: 9100 }],
    })
  })

  it('registers a portless hello using the datagram source port', () => {
    const { core, sendFn } = makeCore()
    core.handleOscIn({ address: OSCDESK.HELLO, args: [], from: { host: '192.168.0.50', port: 54321 } })
    // 登録されたピア(送信元ポート)からの OSC が Unity へ中継されることが登録の証左
    const message = { address: '/avatar/position', args: [{ type: 'f' as const, value: 0.5 }], from: { host: '192.168.0.50', port: 54321 } }
    core.handleOscIn(message)
    expect(sendFn).toHaveBeenCalledWith('127.0.0.1', 9000, message.address, ...message.args)
  })

  it('answers a UDP status request with the link snapshot', () => {
    const { core, sendFn } = makeCore()
    core.handleOscIn({ address: OSCDESK.STATUS_REQUEST, args: [], from: { host: '192.168.0.60', port: 4000 } })
    expect(sendFn).toHaveBeenCalledTimes(1)
    const [host, port, address, arg] = sendFn.mock.calls[0] as [string, number, string, { type: string; value: string }]
    expect([host, port, address, arg.type]).toEqual(['192.168.0.60', 4000, OSCDESK.STATUS, 's'])
    expect(JSON.parse(arg.value)).toMatchObject({ unity: { reachability: 'unknown' } })
  })

  it('fans Unity echo-back out to the registered UI peer', () => {
    const router = new OscUiRouter({ unity: { host: '127.0.0.1', port: 9000 }, config: BRIDGE_CONFIG.oscUi }); router.registerPeer('192.168.0.50', 9100, 0)
    expect(router.route({ host: '127.0.0.1', port: 9000 }, 0)).toEqual({ kind: 'to-ui', targets: [{ host: '192.168.0.50', port: 9100 }] })
  })

  it('drops traffic from peers that never announced themselves', () => {
    const router = new OscUiRouter({ unity: { host: '127.0.0.1', port: 9000 }, config: BRIDGE_CONFIG.oscUi }); expect(router.route({ host: '10.0.0.9', port: 5000 }, 0)).toEqual({ kind: 'ignore', reason: 'unknown-peer' })
  })

  it('does not route at all while oscUi is disabled', () => {
    const { core, publish } = makeCore({ config: { ...BRIDGE_CONFIG, oscUi: { enabled: false, staticPeers: [], peerTtlMs: 0 } } }); core.start(); core.handleOscIn({ address: OSCDESK.HELLO, args: [], from: { host: '192.168.0.50', port: 54321 } }); expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'osc.message' }))
  })

  it('stops routing once the runtime is stopped', () => {
    const { core, publish } = makeCore(); core.start(); core.stop(); core.handleOscIn({ address: '/avatar/position', args: [], from: { host: '127.0.0.1', port: 9000 } }); expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'osc.message' }))
  })

  it('turns the adapter results for a sent address into delivery events without the address (D-116)', () => {
    const { core, publish } = makeCore()
    const from = { host: '127.0.0.1', port: 9000 }
    const deliveries = () => publish.mock.calls.map(([frame]) => frame).flatMap(frame => frame.type === 'delivery' ? frame.events : [])

    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/set/level', args: [{ type: 'f', value: 0.25 }] }, 'c1')
    core.handleOscIn({ address: '/set/level', args: [{ type: 'f', value: 0.25 }], from })
    core.handleUndelivered(from, 'failed', ['/set/level'])
    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/set/count', args: [{ type: 'i', value: 3 }] }, 'c1')
    core.handleUndelivered(from, 'ignored', ['/set/count', '/never/sent'])
    // 送り先でないホストの報告は突き合わせない
    core.handleUndelivered({ host: '10.9.9.9', port: 9000 }, 'failed', ['/set/count'])

    expect(deliveries().map(event => [event.host, event.target, event.result])).toEqual([
      ['127.0.0.1', 'unity', 'ok'],
      ['127.0.0.1', 'unity', 'failed'],
      ['127.0.0.1', 'unity', 'ignored'],
    ])
    expect(deliveries().every(event => !('address' in event))).toBe(true)
  })

  it('rejects a raw OSC message and a batch that touch a pad widget another browser holds (HID-378・D-169)', () => {
    const lockedBy = vi.fn((refs: readonly unknown[], _clientId: string, holder: string | undefined) =>
      holder === 'page-a' ? null : JSON.stringify(refs[0]) === JSON.stringify({ widget: 'level' }) ? '192.168.1.10' : null)
    const sendBundleFn = vi.fn(() => ({ ok: true as const, bytes: 0, messageCount: 0 }))
    const padLockRefs = (address: string) => (address === '/set/level' ? [{ widget: 'level' }] : [])
    const { core, sendFn, publish } = makeCore({ lockedBy, sendBundleFn, padLockRefs })

    core.handleUiFrame({ v: 1, type: 'osc.batch', holder: 'page-b', messages: [
      { address: '/set/count', args: [{ type: 'i', value: 1 }] },
      { address: '/set/level', args: [{ type: 'f', value: 0.1 }] },
    ] }, 'c1')
    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/set/level', args: [{ type: 'f', value: 0.2 }] }, 'c1')
    expect(sendFn).not.toHaveBeenCalled()
    expect(sendBundleFn).not.toHaveBeenCalled()
    expect(publish.mock.calls.map(([frame]) => frame.type === 'notice' ? `${frame.code} ${frame.detail}` : frame.type)).toEqual([
      'batch-rejected locked: level by 192.168.1.10',
      'locked locked: level by 192.168.1.10',
    ])

    // 持ち主のページからの変更と、ロックの無いアドレスは通す
    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/set/level', args: [{ type: 'f', value: 0.5 }], holder: 'page-a' }, 'c1')
    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/set/count', args: [{ type: 'i', value: 2 }], holder: 'page-b' }, 'c1')
    expect(sendFn.mock.calls.map(([, , address]) => address)).toEqual(['/set/level', '/set/count'])
  })
})

describe('multiple Unity targets (D-046)', () => {
  const MAIN = { host: '127.0.0.1', port: 9000 }
  const BACKUP = { host: '10.0.0.2', port: 9100 }

  function setup(overrides: Partial<Parameters<typeof createSurfaceCore>[0]> = {}) {
    let tick: (() => void) | undefined
    const setIntervalFn = vi.fn((callback: () => void) => { tick = callback; return 1 as never })
    let clock = 10_000
    const made = makeCore({
      config: { ...BRIDGE_CONFIG, unity: { ...BRIDGE_CONFIG.unity, secondary: [{ name: 'backup', host: BACKUP.host, sendPort: BACKUP.port }] } },
      setIntervalFn, logWarn: vi.fn(), logInfo: vi.fn(), now: () => clock, ...overrides,
    })
    made.core.start()
    const ping = () => { clock += 2_000; made.sendFn.mockClear(); tick?.() }
    // 各宛先に送った ping の seq を拾って、その宛先として pong を返す
    const pong = (to: { host: string; port: number }, bootId?: string) => {
      const sent = made.sendFn.mock.calls.find(call => call[0] === to.host && call[1] === to.port && call[2] === SYS.PING)
      made.core.handleOscIn({ address: SYS.PONG, args: [sent![3], ...(bootId === undefined ? [] : [{ type: 's' as const, value: bootId }])], from: to })
    }
    return { ...made, ping, pong }
  }

  it('pings every target with a distinct seq and reports each in the link and hello frames', () => {
    const { core, sendFn, ping, pong } = setup()
    ping()
    const seqs = sendFn.mock.calls.filter(call => call[2] === SYS.PING).map(call => call[3].value)
    expect(new Set(seqs).size).toBe(2)
    pong(BACKUP)
    expect(core.linkSnapshot().targets.map(t => [t.name, t.primary, t.reachability])).toEqual([['unity', true, 'unknown'], ['backup', false, 'reachable']])
    expect(core.helloFrame('c')).toMatchObject({ targets: [{ name: 'unity', primary: true }, { name: 'backup', primary: false }] })
  })

  it('sends UI operations to every target and reports the boot id of each accepted pong (D-164・D-169)', () => {
    const onBootId = vi.fn()
    const { core, sendFn, ping, pong } = setup({ onBootId })
    ping(); pong(MAIN, 'boot-a'); pong(BACKUP)
    expect(onBootId.mock.calls).toEqual([
      [{ name: 'unity', host: MAIN.host, port: MAIN.port }, 'boot-a'],
      [{ name: 'backup', host: BACKUP.host, port: BACKUP.port }, null],
    ])
    sendFn.mockClear()
    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/light/level', args: [{ type: 'f', value: 0.9 }] }, 'ui-1')
    expect(sendFn.mock.calls.map(call => [call[0], call[1]])).toEqual([[MAIN.host, MAIN.port], [BACKUP.host, BACKUP.port]])
  })

  it('shows only the primary echo, and hands echoes of both to the pads', () => {
    const onTargetEcho = vi.fn()
    const { core, publish } = setup({ onTargetEcho })
    publish.mockClear()
    core.handleOscIn({ address: '/light/level', args: [{ type: 'f', value: 0.5 }], from: BACKUP })
    expect(publish).not.toHaveBeenCalled()
    core.handleOscIn({ address: '/light/level', args: [{ type: 'f', value: 0.5 }], from: MAIN })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'osc.message', address: '/light/level' }))
    expect(onTargetEcho.mock.calls.map(call => call[2])).toEqual([{ name: 'backup', primary: false }, { name: 'unity', primary: true }])
  })
})

describe('OSC pad presses (D-080)', () => {
  it('sends one message to every target and logs it as a pad press', () => {
    const onSent = vi.fn()
    const { core, sendFn, publish } = makeCore({ onSent, logInfo: vi.fn() })

    expect(core.firePad('/light/level', [{ type: 'f', value: 0.9 }, { type: 's', value: 'x' }])).toEqual({ ok: true })
    expect(sendFn.mock.calls).toEqual([['127.0.0.1', 9000, '/light/level', { type: 'f', value: 0.9 }, { type: 's', value: 'x' }]])
    expect(onSent).toHaveBeenLastCalledWith({
      origin: 'pad', targets: ['unity'], messages: [{ address: '/light/level', args: [{ type: 'f', value: 0.9 }, { type: 's', value: 'x' }] }],
    })
    expect(publish).not.toHaveBeenCalled()
  })

  it('refuses reserved addresses without sending', () => {
    const { core, sendFn } = makeCore({ logInfo: vi.fn() })
    expect(core.firePad('/sys/ping', [])).toEqual({ ok: false, reason: 'internal-address: /sys/ping' })
    expect(sendFn).not.toHaveBeenCalled()
  })
})
