import { describe, expect, it, vi } from 'vitest'

import {
  DiagnosticsSnapshotSchema,
  OSCDESK,
  SYS,
  type DownstreamFrame,
} from '@oscdesk/shared'

import type { PersistedDesiredValue } from './desired-values'
import { OscUiRouter } from './osc-ui-router'
import { createSurfaceCore, type BridgeConfig } from './surface-core'

const BRIDGE_CONFIG: BridgeConfig = {
  unity: { name: 'unity', host: '127.0.0.1', sendPort: 9000, secondary: [] },
  bridge: { oscListenHost: '0.0.0.0', oscListenPort: 9001, wsHost: '0.0.0.0', wsPort: 8080 },
  ui: { host: '0.0.0.0', port: 8080 },
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

    expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'osc', address: SYS.PONG }), expect.anything())
    expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'osc', address: SYS.PONG }))
  })

  it('does not forward /sys/* messages to the UI and publishes external OSC messages', () => {
    const { core, publish } = makeCore()

    core.handleOscIn({ address: '/sys/stats', args: [{ type: 's', value: '{}' }], from: { host: '127.0.0.1', port: 9000 } })
    core.handleOscIn({ address: '/avatar/position', args: [{ type: 'f', value: 1.25 }], from: { host: '127.0.0.1', port: 9000 } })

    expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'osc', address: '/sys/stats' }))
    expect(publish).toHaveBeenCalledWith({
      v: 1, type: 'osc', address: '/avatar/position',
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
    core.handleUiFrame({ v: 1, type: 'osc', address: '/avatar/position', args: [{ type: 'f', value: 1.25 }] }, 'client-1')

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
      type: 'oscBatch',
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
      type: 'oscBatch',
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
      type: 'oscBatch',
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
    })
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

    core.handleUiFrame({ v: 1, type: 'osc', address: '/avatar/position', args: [{ type: 'f', value: 1.25 }] }, 'client-1')

    expect(sendFn).toHaveBeenCalledTimes(1)
    expect(sendFn).toHaveBeenCalledWith('unity.example.test', 9100, '/avatar/position', { type: 'f', value: 1.25 })
  })

  it('blocks UI values in the internal namespace and warns only once', () => {
    const logWarn = vi.fn()
    const { core, sendFn } = makeCore({ logWarn })
    core.start()
    sendFn.mockClear()

    const frame = { v: 1 as const, type: 'osc' as const, address: OSCDESK.STATUS, args: [] }
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
    core.handleUiFrame({ v: 1, type: 'osc', address: message.address, args: message.args }, 'client-1')

    expect(publish).toHaveBeenCalledWith({ v: 1, type: 'osc', address: message.address, args: message.args, from: message.from })
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
    core.handleUiFrame({ v: 1, type: 'osc', address: SYS.PING, args: [{ type: 'i', value: 1 }] }, 'client-1')
    core.handleUiFrame({ v: 1, type: 'osc', address: SYS.PING, args: [{ type: 'i', value: 2 }] }, 'client-1')

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
    const { core, publish } = makeCore({ config: { ...BRIDGE_CONFIG, oscUi: { enabled: false, staticPeers: [], peerTtlMs: 0 } } }); core.start(); core.handleOscIn({ address: OSCDESK.HELLO, args: [], from: { host: '192.168.0.50', port: 54321 } }); expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'osc' }))
  })

  it('stops routing once the runtime is stopped', () => {
    const { core, publish } = makeCore(); core.start(); core.stop(); core.handleOscIn({ address: '/avatar/position', args: [], from: { host: '127.0.0.1', port: 9000 } }); expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'osc' }))
  })

})

describe('desired values (D-045)', () => {
  const DEFINITION = {
    format: 'oscdesk-surface' as const,
    version: 1 as const,
    name: 'T',
    parameters: [
      { id: 'level', address: '/light/level', label: 'Level', type: 'f' as const, kind: 'state' as const, default: 0.5 },
      { id: 'fire', address: '/light/fire', label: 'Fire', type: 'i' as const, kind: 'trigger' as const, value: 1 },
    ],
    screens: [],
  }
  const UNITY = { host: '127.0.0.1', port: 9000 }

  function setup() {
    let tick: (() => void) | undefined
    const setIntervalFn = vi.fn((callback: () => void) => { tick = callback; return 1 as never })
    const logWarn = vi.fn()
    let clock = 10_000
    const made = makeCore({ setIntervalFn, logWarn, logInfo: vi.fn(), now: () => clock })
    made.core.start()
    let seq = 0
    const ping = () => { clock += 2_000; tick?.(); seq += 1 }
    const pong = () => made.core.handleOscIn({ address: SYS.PONG, args: [{ type: 'i', value: seq }], from: UNITY })
    return { ...made, ping, pong, logWarn }
  }

  const levelSends = (sendFn: ReturnType<typeof vi.fn>) =>
    sendFn.mock.calls.filter(call => call[2] === '/light/level')

  it('publishes the full set on adoption and only changes for UI operations, never for triggers', () => {
    const { core, publish } = setup()
    core.setDefinition(DEFINITION)
    expect(publish).toHaveBeenCalledWith({ v: 1, type: 'desired', full: true, values: [{ address: '/light/level', args: [{ type: 'f', value: 0.5 }] }] }, undefined)

    core.handleUiFrame({ v: 1, type: 'osc', address: '/light/level', args: [{ type: 'f', value: 0.9 }] }, 'ui-1')
    expect(publish).toHaveBeenLastCalledWith({ v: 1, type: 'desired', full: false, values: [{ address: '/light/level', args: [{ type: 'f', value: 0.9 }] }] })

    publish.mockClear()
    core.handleUiFrame({ v: 1, type: 'osc', address: '/light/fire', args: [{ type: 'i', value: 1 }] }, 'ui-1')
    expect(publish).not.toHaveBeenCalled()

    core.publishDesired('ui-2')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'desired', full: true }), 'ui-2')
  })

  it('resends held state values on first pong and after recovery, but never triggers', () => {
    const { core, sendFn, ping, pong } = setup()
    core.setDefinition(DEFINITION)
    core.handleUiFrame({ v: 1, type: 'osc', address: '/light/level', args: [{ type: 'f', value: 0.9 }] }, 'ui-1')
    core.handleUiFrame({ v: 1, type: 'osc', address: '/light/fire', args: [{ type: 'i', value: 1 }] }, 'ui-1')
    sendFn.mockClear()

    ping(); pong() // 初回の到達
    expect(levelSends(sendFn)).toEqual([['127.0.0.1', 9000, '/light/level', { type: 'f', value: 0.9 }]])
    expect(sendFn.mock.calls.some(call => call[2] === '/light/fire')).toBe(false)

    sendFn.mockClear()
    ping(); pong() // 通常の pong では再送しない
    expect(levelSends(sendFn)).toHaveLength(0)

    ping(); ping(); ping() // 応答なし(喪失)
    pong() // 回復
    expect(levelSends(sendFn)).toHaveLength(1)
    expect(sendFn.mock.calls.some(call => call[2] === '/light/fire')).toBe(false)
  })

  it('warns once per address when an echo differs, without changing the held value', () => {
    const { core, logWarn, ping, pong } = setup()
    core.setDefinition(DEFINITION)
    ping(); pong()
    const echo = (value: number) => core.handleOscIn({ address: '/light/level', args: [{ type: 'f', value }], from: UNITY })
    echo(0.1); echo(0.2)
    expect(logWarn.mock.calls.filter(call => String(call[1]).includes('/light/level'))).toHaveLength(1)
    echo(0.5); echo(0.3)
    expect(logWarn.mock.calls.filter(call => String(call[1]).includes('/light/level'))).toHaveLength(2)
  })

  it('does not warn for echoes right after a UI operation, nor for non-Unity senders', () => {
    const { core, logWarn, ping, pong } = setup()
    core.setDefinition(DEFINITION)
    ping(); pong()
    core.handleUiFrame({ v: 1, type: 'osc', address: '/light/level', args: [{ type: 'f', value: 0.9 }] }, 'ui-1')
    core.handleOscIn({ address: '/light/level', args: [{ type: 'f', value: 0.2 }], from: UNITY })
    core.handleOscIn({ address: '/light/level', args: [{ type: 'f', value: 0.1 }], from: { host: '192.168.0.9', port: 5000 } })
    expect(logWarn.mock.calls.filter(call => String(call[1]).includes('/light/level'))).toHaveLength(0)
  })

  it('resends only reset values on adoption', () => {
    const { core, sendFn, ping, pong } = setup()
    core.setDefinition(DEFINITION)
    ping(); pong()
    core.handleUiFrame({ v: 1, type: 'osc', address: '/light/level', args: [{ type: 'f', value: 0.9 }] }, 'ui-1')
    sendFn.mockClear()
    // 同じ定義の再採用(レイアウトだけの保存)では何も再送しない
    core.setDefinition({ ...DEFINITION, name: 'T2' })
    expect(levelSends(sendFn)).toHaveLength(0)
    // 新しいパラメータだけが既定値で送られる
    core.setDefinition({
      ...DEFINITION,
      parameters: [...DEFINITION.parameters, { id: 'x', address: '/light/x', label: 'X', type: 'f' as const, kind: 'state' as const, default: 0.1 }],
    })
    expect(sendFn.mock.calls.map(call => call[2])).toEqual(['/light/x'])
  })
})

describe('persisted desired values (D-058)', () => {
  const DEFINITION = {
    format: 'oscdesk-surface' as const,
    version: 1 as const,
    name: 'T',
    parameters: [
      { id: 'level', address: '/light/level', label: 'Level', type: 'f' as const, kind: 'state' as const, range: [0, 1] as [number, number], default: 0.5 },
      { id: 'mode', address: '/light/mode', label: 'Mode', type: 's' as const, kind: 'state' as const, options: ['a', 'b'], default: 'a' },
      { id: 'fire', address: '/light/fire', label: 'Fire', type: 'i' as const, kind: 'trigger' as const, value: 1 },
    ],
    screens: [],
  }
  const UNITY = { host: '127.0.0.1', port: 9000 }

  function setup(saved: readonly PersistedDesiredValue[] | null = null) {
    let tick: (() => void) | undefined
    const store = { load: vi.fn((_name: string) => saved), save: vi.fn() }
    const made = makeCore({
      setIntervalFn: vi.fn((callback: () => void) => { tick = callback; return 1 as never }),
      logInfo: vi.fn(),
      logWarn: vi.fn(),
      desiredValuesStore: store,
    })
    made.core.start()
    const reach = () => {
      tick?.()
      made.core.handleOscIn({ address: SYS.PONG, args: [{ type: 'i', value: 1 }], from: UNITY })
    }
    return { ...made, store, reach }
  }

  it('restores saved values on the first adoption and resends them on first reach', () => {
    const { core, publish, sendFn, store, reach } = setup([
      { id: 'level', address: '/light/level', type: 'f', args: [{ type: 'f', value: 0.875 }] },
      { id: 'mode', address: '/light/mode', type: 's', args: [{ type: 's', value: 'b' }] },
    ])
    core.setDefinition(DEFINITION, 'stage')
    expect(store.load).toHaveBeenCalledWith('stage')
    expect(publish).toHaveBeenCalledWith({
      v: 1, type: 'desired', full: true, values: [
        { address: '/light/level', args: [{ type: 'f', value: 0.875 }] },
        { address: '/light/mode', args: [{ type: 's', value: 'b' }] },
      ],
    }, undefined)
    sendFn.mockClear()
    reach()
    expect(sendFn.mock.calls.filter(call => call[2] !== SYS.PING)).toEqual([
      ['127.0.0.1', 9000, '/light/level', { type: 'f', value: 0.875 }],
      ['127.0.0.1', 9000, '/light/mode', { type: 's', value: 'b' }],
    ])
  })

  it('keeps defaults for saved values whose id, type or range no longer match', () => {
    const { core, publish } = setup([
      { id: 'renamed', address: '/light/level', type: 'f', args: [{ type: 'f', value: 0.9 }] },
      { id: 'mode', address: '/light/mode', type: 's', args: [{ type: 's', value: 'gone' }] },
      { id: 'fire', address: '/light/fire', type: 'i', args: [{ type: 'i', value: 1 }] },
      { id: 'other', address: '/light/other', type: 'f', args: [{ type: 'f', value: 0.1 }] },
    ])
    core.setDefinition(DEFINITION, 'stage')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'desired', full: true, values: [
        { address: '/light/level', args: [{ type: 'f', value: 0.5 }] },
        { address: '/light/mode', args: [{ type: 's', value: 'a' }] },
      ],
    }), undefined)
  })

  it('does not reload the file on later adoptions, so in-memory values keep winning', () => {
    const { core, store } = setup([{ id: 'level', address: '/light/level', type: 'f', args: [{ type: 'f', value: 0.25 }] }])
    core.setDefinition(DEFINITION, 'stage')
    core.handleUiFrame({ v: 1, type: 'osc', address: '/light/level', args: [{ type: 'f', value: 0.75 }] }, 'ui-1')
    core.setDefinition(DEFINITION, 'other')
    expect(store.load).toHaveBeenCalledTimes(1)
    expect(store.save).toHaveBeenLastCalledWith('other', [
      { id: 'level', address: '/light/level', type: 'f', args: [{ type: 'f', value: 0.75 }] },
      { id: 'mode', address: '/light/mode', type: 's', args: [{ type: 's', value: 'a' }] },
    ])
  })

  it('saves on adoption and on held-value changes only, never for triggers', () => {
    const { core, store } = setup()
    core.setDefinition(DEFINITION, 'stage')
    expect(store.save).toHaveBeenCalledTimes(1)
    core.handleUiFrame({ v: 1, type: 'osc', address: '/light/fire', args: [{ type: 'i', value: 1 }] }, 'ui-1')
    core.handleUiFrame({ v: 1, type: 'osc', address: '/light/level', args: [{ type: 'f', value: 2 }] }, 'ui-1') // 値域外
    expect(store.save).toHaveBeenCalledTimes(1)
    core.handleUiFrame({ v: 1, type: 'osc', address: '/light/level', args: [{ type: 'f', value: 0.3 }] }, 'ui-1')
    expect(store.save).toHaveBeenCalledTimes(2)
    expect(store.save).toHaveBeenLastCalledWith('stage', expect.arrayContaining([
      { id: 'level', address: '/light/level', type: 'f', args: [{ type: 'f', value: 0.3 }] },
    ]))
  })

  it('neither loads nor saves without a surface name', () => {
    const { core, store } = setup([{ id: 'level', address: '/light/level', type: 'f', args: [{ type: 'f', value: 0.25 }] }])
    core.setDefinition(DEFINITION)
    core.handleUiFrame({ v: 1, type: 'osc', address: '/light/level', args: [{ type: 'f', value: 0.3 }] }, 'ui-1')
    expect(store.load).not.toHaveBeenCalled()
    expect(store.save).not.toHaveBeenCalled()
  })
})

describe('multiple Unity targets (D-046)', () => {
  const DEFINITION = {
    format: 'oscdesk-surface' as const,
    version: 1 as const,
    name: 'T',
    parameters: [{ id: 'level', address: '/light/level', label: 'Level', type: 'f' as const, kind: 'state' as const, default: 0.5 }],
    screens: [],
  }
  const MAIN = { host: '127.0.0.1', port: 9000 }
  const BACKUP = { host: '10.0.0.2', port: 9100 }

  function setup() {
    let tick: (() => void) | undefined
    const setIntervalFn = vi.fn((callback: () => void) => { tick = callback; return 1 as never })
    const logWarn = vi.fn()
    let clock = 10_000
    const made = makeCore({
      config: { ...BRIDGE_CONFIG, unity: { ...BRIDGE_CONFIG.unity, secondary: [{ name: 'backup', host: BACKUP.host, sendPort: BACKUP.port }] } },
      setIntervalFn, logWarn, logInfo: vi.fn(), now: () => clock,
    })
    made.core.start()
    const ping = () => { clock += 2_000; made.sendFn.mockClear(); tick?.() }
    // 各宛先に送った ping の seq を拾って、その宛先として pong を返す
    const pong = (to: { host: string; port: number }) => {
      const sent = made.sendFn.mock.calls.find(call => call[0] === to.host && call[1] === to.port && call[2] === SYS.PING)
      made.core.handleOscIn({ address: SYS.PONG, args: [sent![3]], from: to })
    }
    const levelSendsTo = (to: { host: string; port: number }) =>
      made.sendFn.mock.calls.filter(call => call[0] === to.host && call[1] === to.port && call[2] === '/light/level')
    return { ...made, ping, pong, logWarn, levelSendsTo }
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

  it('sends UI operations to every target but resends held values only to the target that recovered', () => {
    const { core, sendFn, ping, pong, levelSendsTo } = setup()
    core.setDefinition(DEFINITION)
    ping(); pong(MAIN); pong(BACKUP)
    sendFn.mockClear()
    core.handleUiFrame({ v: 1, type: 'osc', address: '/light/level', args: [{ type: 'f', value: 0.9 }] }, 'ui-1')
    expect(levelSendsTo(MAIN)).toHaveLength(1)
    expect(levelSendsTo(BACKUP)).toHaveLength(1)

    // 副系だけが応答しなくなり、回復する
    ping(); pong(MAIN)
    ping(); pong(MAIN)
    ping(); pong(MAIN); pong(BACKUP)
    expect(levelSendsTo(MAIN)).toHaveLength(0)
    expect(levelSendsTo(BACKUP)).toEqual([[BACKUP.host, BACKUP.port, '/light/level', { type: 'f', value: 0.9 }]])
  })

  it('resends on request to one named target, to all, and rejects unknown names', () => {
    const { core, sendFn, publish, levelSendsTo } = setup()
    core.setDefinition(DEFINITION)
    sendFn.mockClear()
    core.handleUiFrame({ v: 1, type: 'resend', target: 'backup' }, 'ui-1')
    expect(levelSendsTo(MAIN)).toHaveLength(0)
    expect(levelSendsTo(BACKUP)).toHaveLength(1)
    core.handleUiFrame({ v: 1, type: 'resend' }, 'ui-1')
    expect(levelSendsTo(MAIN)).toHaveLength(1)
    core.handleUiFrame({ v: 1, type: 'resend', target: 'nope' }, 'ui-1')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'notice', code: 'resend-rejected' }), 'ui-1')
  })

  it('shows only the primary echo, and warns when a secondary echo differs from the held value', () => {
    const { core, publish, logWarn } = setup()
    core.setDefinition(DEFINITION)
    publish.mockClear()
    core.handleOscIn({ address: '/light/level', args: [{ type: 'f', value: 0.5 }], from: BACKUP })
    core.handleOscIn({ address: '/light/level', args: [{ type: 'f', value: 0.2 }], from: BACKUP })
    expect(publish).not.toHaveBeenCalled()
    expect(logWarn.mock.calls.filter(call => String(call[1]).includes('"backup"'))).toHaveLength(1)
    core.handleOscIn({ address: '/light/level', args: [{ type: 'f', value: 0.5 }], from: MAIN })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'osc', address: '/light/level' }))
  })
})

describe('Unity option lists (D-053)', () => {
  const DEFINITION = {
    format: 'oscdesk-surface' as const,
    version: 1 as const,
    name: 'T',
    parameters: [{
      id: 'segment', address: '/member/1/segment', label: 'Segment', type: 's' as const, kind: 'state' as const,
      options: ['(none)'], default: '(none)', optionsFrom: { address: '/mb/segments', request: '/mb/segments/get' },
    }],
    screens: [],
  }
  const MAIN = { host: '127.0.0.1', port: 9000 }
  const BACKUP = { host: '10.0.0.2', port: 9100 }
  const names = (...values: string[]) => values.map(value => ({ type: 's' as const, value }))

  function setup() {
    let tick: (() => void) | undefined
    const setIntervalFn = vi.fn((callback: () => void) => { tick = callback; return 1 as never })
    const logWarn = vi.fn()
    let clock = 10_000
    const made = makeCore({
      config: { ...BRIDGE_CONFIG, unity: { ...BRIDGE_CONFIG.unity, secondary: [{ name: 'backup', host: BACKUP.host, sendPort: BACKUP.port }] } },
      setIntervalFn, logWarn, logInfo: vi.fn(), now: () => clock,
    })
    made.core.start()
    const ping = () => { clock += 2_000; made.sendFn.mockClear(); tick?.() }
    const pong = (to: { host: string; port: number }) => {
      const sent = made.sendFn.mock.calls.find(call => call[0] === to.host && call[1] === to.port && call[2] === SYS.PING)
      made.core.handleOscIn({ address: SYS.PONG, args: [sent![3]], from: to })
    }
    const requestsTo = (to: { host: string; port: number }) =>
      made.sendFn.mock.calls.filter(call => call[0] === to.host && call[1] === to.port && call[2] === '/mb/segments/get')
    const lastOptions = () => made.publish.mock.calls.map(call => call[0]).filter(frame => frame.type === 'runtimeOptions').at(-1)
    return { ...made, ping, pong, logWarn, requestsTo, lastOptions }
  }

  it('takes lists from every target, even a secondary, and publishes their union instead of osc frames', () => {
    const { core, publish, lastOptions } = setup()
    core.setDefinition(DEFINITION)
    expect(lastOptions()).toEqual({ v: 1, type: 'runtimeOptions', lists: [{ address: '/mb/segments', targets: [] }], choices: [{ param: 'segment', options: ['(none)'] }] })

    publish.mockClear()
    core.handleOscIn({ address: '/mb/segments', args: names('Song B', 'Intro'), from: BACKUP })
    core.handleOscIn({ address: '/mb/segments', args: names('Intro', 'Song A'), from: MAIN })
    expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'osc' }))
    expect(lastOptions()).toEqual({
      v: 1, type: 'runtimeOptions',
      lists: [{ address: '/mb/segments', targets: [{ name: 'unity', options: ['Intro', 'Song A'] }, { name: 'backup', options: ['Song B', 'Intro'] }] }],
      choices: [{ param: 'segment', options: ['(none)', 'Intro', 'Song A', 'Song B'] }],
    })

    // 同じ一覧の繰り返しは配り直さない。要求のエコーと Unity 以外からの一覧は UI へ流さない
    publish.mockClear()
    core.handleOscIn({ address: '/mb/segments', args: names('Intro', 'Song A'), from: MAIN })
    core.handleOscIn({ address: '/mb/segments/get', args: [], from: MAIN })
    core.handleOscIn({ address: '/mb/segments', args: names('Evil'), from: { host: '192.168.0.9', port: 5000 } })
    expect(publish).not.toHaveBeenCalled()

    // 接続した UI には変化が無くても全量を送る
    core.publishRuntimeOptions('ui-2')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'runtimeOptions', choices: [{ param: 'segment', options: ['(none)', 'Intro', 'Song A', 'Song B'] }] }), 'ui-2')

    // 定義の採用では、一覧が変わらなくても surface・desired に続けて全 UI へ配る
    publish.mockClear()
    core.setDefinition({ ...DEFINITION, name: 'T2' })
    expect(publish.mock.calls.map(call => [call[0].type, call[1]])).toEqual([['desired', undefined], ['runtimeOptions', undefined]])
  })

  it('ignores a list with non-string arguments and warns once', () => {
    const { core, publish, logWarn } = setup()
    core.setDefinition(DEFINITION)
    publish.mockClear()
    core.handleOscIn({ address: '/mb/segments', args: [{ type: 'i', value: 1 }], from: MAIN })
    core.handleOscIn({ address: '/mb/segments', args: [{ type: 'i', value: 2 }], from: MAIN })
    expect(publish).not.toHaveBeenCalled()
    expect(logWarn.mock.calls.filter(call => String(call[1]).includes('/mb/segments'))).toHaveLength(1)
  })

  it('requests lists on first reach and recovery per target, on adoption of new addresses, and on refresh', () => {
    const { core, ping, pong, requestsTo, sendFn } = setup()
    core.setDefinition(DEFINITION) // まだ到達していないので要求しない
    ping(); pong(MAIN)
    expect(requestsTo(MAIN)).toEqual([[MAIN.host, MAIN.port, '/mb/segments/get']])
    expect(requestsTo(BACKUP)).toEqual([])
    pong(BACKUP)
    expect(requestsTo(BACKUP)).toHaveLength(1)

    // 副系だけが喪失から回復すると、その台にだけ要求する
    ping(); pong(MAIN)
    ping(); pong(MAIN)
    ping(); pong(MAIN); pong(BACKUP)
    expect(requestsTo(MAIN)).toEqual([])
    expect(requestsTo(BACKUP)).toHaveLength(1)

    // 到達可能な間の採用は、新しいアドレスがあるときだけ要求する
    sendFn.mockClear()
    core.setDefinition({ ...DEFINITION, name: 'T2' })
    expect(requestsTo(MAIN)).toEqual([])
    core.setDefinition({
      ...DEFINITION,
      parameters: [{ ...DEFINITION.parameters[0]!, optionsFrom: { address: '/mb/segments2', request: '/mb/segments/get' } }],
    })
    expect(requestsTo(MAIN)).toHaveLength(1)
    expect(requestsTo(BACKUP)).toHaveLength(1)

    sendFn.mockClear()
    core.handleUiFrame({ v: 1, type: 'runtimeOptionsRefresh' }, 'ui-1')
    expect(requestsTo(MAIN)).toHaveLength(1)
    expect(requestsTo(BACKUP)).toHaveLength(1)
  })

  it('blocks UI frames to a list address, but relays an OSC-native UI request to Unity', () => {
    const { core, sendFn, publish } = setup()
    core.setDefinition(DEFINITION)
    sendFn.mockClear()
    core.handleUiFrame({ v: 1, type: 'osc', address: '/mb/segments', args: names('Injected') }, 'ui-1')
    core.handleUiFrame({ v: 1, type: 'oscBatch', messages: [{ address: '/mb/segments', args: names('Injected') }] }, 'ui-1')
    expect(sendFn.mock.calls.some(call => call[2] === '/mb/segments')).toBe(false)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'notice', code: 'batch-rejected', detail: 'option-list-address: /mb/segments' }), 'ui-1')

    // 名乗った OSC ネイティブ UI の端末が要求のアドレスへ送ったものは、通常の操作として全台へ中継する
    core.handleOscIn({ address: OSCDESK.HELLO, args: [{ type: 'i', value: 9100 }], from: { host: '192.168.0.50', port: 9100 } })
    core.handleOscIn({ address: '/mb/segments/get', args: [], from: { host: '192.168.0.50', port: 9100 } })
    expect(sendFn.mock.calls.filter(call => call[2] === '/mb/segments/get').map(call => call[0])).toEqual([MAIN.host, BACKUP.host])
  })

  it('keeps a list from a target that became unreachable', () => {
    const { core, ping, pong, lastOptions } = setup()
    core.setDefinition(DEFINITION)
    ping(); pong(MAIN); pong(BACKUP)
    core.handleOscIn({ address: '/mb/segments', args: names('Backup only'), from: BACKUP })
    ping(); pong(MAIN)
    ping(); pong(MAIN)
    expect(core.linkSnapshot().targets.find(target => target.name === 'backup')?.reachability).toBe('lost')
    expect(lastOptions()).toMatchObject({ choices: [{ param: 'segment', options: ['(none)', 'Backup only'] }] })
  })

  it('holds and resends a chosen name even after it disappears from every list', () => {
    const { core, ping, pong, sendFn, publish } = setup()
    core.setDefinition(DEFINITION)
    core.handleOscIn({ address: '/mb/segments', args: names('Song A'), from: MAIN })
    core.handleUiFrame({ v: 1, type: 'osc', address: '/member/1/segment', args: [{ type: 's', value: 'Song A' }] }, 'ui-1')
    expect(publish).toHaveBeenCalledWith({ v: 1, type: 'desired', full: false, values: [{ address: '/member/1/segment', args: [{ type: 's', value: 'Song A' }] }] })

    core.handleOscIn({ address: '/mb/segments', args: names('Song B'), from: MAIN })
    ping(); pong(MAIN)
    expect(sendFn.mock.calls.filter(call => call[2] === '/member/1/segment')).toEqual([[MAIN.host, MAIN.port, '/member/1/segment', { type: 's', value: 'Song A' }]])
  })
})
