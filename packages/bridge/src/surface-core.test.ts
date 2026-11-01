import { describe, expect, it, vi } from 'vitest'

import {
  DiagnosticsSnapshotSchema,
  OSCDESK,
  SYS,
  type DownstreamFrame,
} from '@oscdesk/shared'

import type { PersistedDesired, PersistedDesiredValue } from './desired-values'
import { ipv4ToInt } from './ipv4'
import { OscUiRouter } from './osc-ui-router'
import { createSurfaceCore, type BridgeConfig } from './surface-core'
import { v2 } from './surface-fixture'

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
  destinations: { scanTimeoutMs: 8_000 },
  network: {},
}

const DIAGNOSTICS_SNAPSHOT = DiagnosticsSnapshotSchema.parse({
  reachability: 'reachable', lastRttMs: 12, consecutiveLosses: 0,
  lossRate: { windowSize: 30, observed: 1, lost: 0, rate: 0 },
  subnet: { kind: 'sameHost' }, logUsage: { totalBytes: 128, limitBytes: 1024, overLimit: false }, recentMessages: [],
})

// set フレーム(HID-373)の検査に使う定義。型ごとのパラメータと、trigger・単独で送らないパラメータを持つ
const SET_LEGACY = {
  format: 'oscdesk-surface',
  version: 1,
  name: 'Set',
  parameters: [
    { id: 'level', address: '/set/level', label: 'Level', type: 'f', kind: 'state', range: [0, 1], default: 0 },
    { id: 'mute', address: '/set/mute', label: 'Mute', type: 'bool', kind: 'state', default: false },
    { id: 'count', address: '/set/count', label: 'Count', type: 'i', kind: 'state', default: 0 },
    { id: 'go', address: '/set/go', label: 'Go', type: 'i', kind: 'trigger', value: 7 },
    { id: 'part', address: '/set/part', label: 'Part', type: 'bool', kind: 'trigger', value: true, standalone: false },
  ],
  screens: [{ id: 'main', label: 'Main', children: [{ kind: 'control', param: 'level', widget: 'slider' }] }],
}
const SET_DEFINITION = v2(SET_LEGACY)

// 組み合わせの型(HID-380・D-121)。state の色と、trigger の位置
const COMPOSITE_LEGACY = {
  format: 'oscdesk-surface',
  version: 1,
  name: 'Composite',
  parameters: [
    {
      id: 'tint', address: '/fx/tint', label: 'Tint', type: 'composite', kind: 'state', hint: 'color',
      fields: [
        ...['r', 'g', 'b'].map(id => ({ id, label: id, type: 'f', range: [0, 1], default: 1 })),
        { id: 'on', label: 'On', type: 'bool', default: true },
      ],
    },
    {
      id: 'spawnAt', address: '/fx/spawn', label: 'Spawn at', type: 'composite', kind: 'trigger',
      fields: [{ id: 'x', label: 'X', type: 'f', value: 2 }, { id: 'y', label: 'Y', type: 'f', value: 3 }],
    },
  ],
  screens: [{ id: 'main', label: 'Main', children: [{ kind: 'control', param: 'tint' }] }],
}

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

  it('sends a set frame as the parameter address and type from the adopted definition (HID-373)', () => {
    const { core, sendFn, publish } = makeCore()
    core.setDefinition(v2(SET_DEFINITION), 'set')
    sendFn.mockClear()
    publish.mockClear()

    core.handleUiFrame({ v: 1, type: 'set', param: 'level', value: 0.25 }, 'c1')
    core.handleUiFrame({ v: 1, type: 'set', param: 'mute', value: true }, 'c1')
    core.handleUiFrame({ v: 1, type: 'set', param: 'count', value: 3 }, 'c1')
    core.handleUiFrame({ v: 1, type: 'set', param: 'go' }, 'c1')

    expect(sendFn.mock.calls.map(([, , address, ...args]) => [address, ...args])).toEqual([
      ['/set/level', { type: 'f', value: 0.25 }],
      ['/set/mute', { type: 'i', value: 1 }],
      ['/set/count', { type: 'i', value: 3 }],
      ['/set/go', { type: 'i', value: 7 }],
    ])
    // state は保持値に入り、trigger は入らない(D-045)
    const desired = publish.mock.calls.map(([frame]) => frame).filter(frame => frame.type === 'desired')
    expect(desired.flatMap(frame => frame.type === 'desired' ? frame.values.map(value => value.param) : [])).not.toContain('go')
  })

  it('sends a composite parameter as its fields in declaration order and reads the echo back as an object (D-121)', () => {
    const { core, sendFn, publish } = makeCore()
    core.setDefinition(v2(COMPOSITE_LEGACY), 'composite')
    // 採用で既定(フィールドの default)が保持値に入り、全量の desired でオブジェクトとして配る
    const firstDesired = publish.mock.calls.map(([frame]) => frame).filter(frame => frame.type === 'desired').at(-1)
    expect(firstDesired?.type === 'desired' ? firstDesired.values : []).toEqual([{ param: 'tint', value: { r: 1, g: 1, b: 1, on: true } }])
    sendFn.mockClear()
    publish.mockClear()

    core.handleUiFrame({ v: 1, type: 'set', param: 'tint', value: { r: 1, g: 0.5, b: 0, on: false } }, 'c1')
    core.handleUiFrame({ v: 1, type: 'set', param: 'spawnAt' }, 'c1')
    expect(sendFn.mock.calls.map(([, , address, ...args]) => [address, ...args])).toEqual([
      ['/fx/tint', { type: 'f', value: 1 }, { type: 'f', value: 0.5 }, { type: 'f', value: 0 }, { type: 'i', value: 0 }],
      ['/fx/spawn', { type: 'f', value: 2 }, { type: 'f', value: 3 }],
    ])
    const desired = publish.mock.calls.map(([frame]) => frame).filter(frame => frame.type === 'desired').at(-1)
    expect(desired?.type === 'desired' ? desired.values : []).toEqual([{ param: 'tint', value: { r: 1, g: 0.5, b: 0, on: false } }])

    // 欠けたフィールド・値域外・入れ子でない単独の値は送らずに断る
    sendFn.mockClear()
    core.handleUiFrame({ v: 1, type: 'set', param: 'tint', value: { r: 1, g: 0.5, b: 0 } }, 'c1')
    core.handleUiFrame({ v: 1, type: 'set', param: 'tint', value: { r: 2, g: 0.5, b: 0, on: true } }, 'c1')
    core.handleUiFrame({ v: 1, type: 'set', param: 'tint', value: 0.5 }, 'c1')
    core.handleUiFrame({ v: 1, type: 'set', param: 'spawnAt', value: { x: 1, y: 'a' } }, 'c1')
    expect(sendFn).not.toHaveBeenCalled()

    publish.mockClear()
    const from = { host: '127.0.0.1', port: 9000 }
    core.handleOscIn({ address: '/fx/tint', args: [{ type: 'f', value: 0.25 }, { type: 'f', value: 0.5 }, { type: 'f', value: 0 }, { type: 'i', value: 1 }], from })
    // 引数の数が合わないエコーは値を付けない(届いた確認には使える)
    core.handleOscIn({ address: '/fx/tint', args: [{ type: 'f', value: 0.25 }], from })
    const echoes = publish.mock.calls.map(([frame]) => frame).filter(frame => frame.type === 'echo')
    expect(echoes.map(frame => frame.type === 'echo' ? frame.values : [])).toEqual([
      [{ param: 'tint', value: { r: 0.25, g: 0.5, b: 0, on: true } }],
      [{ param: 'tint' }],
    ])
  })

  it('turns the adapter results for a sent parameter into delivery events with the parameter id, not the address (D-116)', () => {
    const { core, publish } = makeCore()
    core.setDefinition(v2(SET_DEFINITION), 'set')
    publish.mockClear()
    const from = { host: '127.0.0.1', port: 9000 }
    const deliveries = () => publish.mock.calls.map(([frame]) => frame).flatMap(frame => frame.type === 'delivery' ? frame.events : [])

    core.handleUiFrame({ v: 1, type: 'set', param: 'level', value: 0.25 }, 'c1')
    core.handleOscIn({ address: '/set/level', args: [{ type: 'f', value: 0.25 }], from })
    core.handleUndelivered(from, 'failed', ['/set/level'])
    core.handleUiFrame({ v: 1, type: 'set', param: 'count', value: 3 }, 'c1')
    core.handleUndelivered(from, 'ignored', ['/set/count', '/never/sent'])
    // 送り先でないホストの報告は突き合わせない
    core.handleUndelivered({ host: '10.9.9.9', port: 9000 }, 'failed', ['/set/count'])

    expect(deliveries().map(event => [event.host, event.target, event.result, event.param])).toEqual([
      ['127.0.0.1', 'unity', 'ok', 'level'],
      ['127.0.0.1', 'unity', 'failed', 'level'],
      ['127.0.0.1', 'unity', 'ignored', 'count'],
    ])
    expect(deliveries().every(event => !('address' in event))).toBe(true)
  })

  it('rejects set frames that do not fit the parameter (unknown, wrong type, out of range, not standalone)', () => {
    const { core, sendFn, publish } = makeCore()
    core.setDefinition(v2(SET_DEFINITION), 'set')
    sendFn.mockClear()
    publish.mockClear()

    core.handleUiFrame({ v: 1, type: 'set', param: 'nope', value: 1 }, 'c1')
    core.handleUiFrame({ v: 1, type: 'set', param: 'level', value: 'loud' }, 'c1')
    core.handleUiFrame({ v: 1, type: 'set', param: 'level', value: 2 }, 'c1')
    core.handleUiFrame({ v: 1, type: 'set', param: 'count', value: 1.5 }, 'c1')
    core.handleUiFrame({ v: 1, type: 'set', param: 'mute', value: 1 }, 'c1')
    core.handleUiFrame({ v: 1, type: 'set', param: 'part', value: true }, 'c1')
    core.handleUiFrame({ v: 1, type: 'set', param: 'level' }, 'c1')

    expect(sendFn).not.toHaveBeenCalled()
    expect(publish.mock.calls.map(([frame, target]) => [frame.type === 'notice' ? `${frame.code} ${frame.detail}` : frame.type, target])).toEqual([
      ['set-rejected unknown-param: nope', 'c1'],
      ['set-rejected type-mismatch: level expects a number', 'c1'],
      ['set-rejected out-of-range: level', 'c1'],
      ['set-rejected type-mismatch: count expects an int32', 'c1'],
      ['set-rejected type-mismatch: mute expects a boolean', 'c1'],
      ['set-rejected not-standalone: part', 'c1'],
      ['set-rejected missing-value: level', 'c1'],
    ])
  })

  it('rejects a set and a batch that touch a control another browser holds (HID-378)', () => {
    const lockedBy = vi.fn((refs: readonly unknown[], _clientId: string, holder: string | undefined) =>
      holder === 'page-a' ? null : JSON.stringify(refs[0]) === JSON.stringify({ param: 'level' }) ? '192.168.1.10' : null)
    const sendBundleFn = vi.fn(() => ({ ok: true as const, bytes: 0, messageCount: 0 }))
    const { core, sendFn, publish } = makeCore({ lockedBy, sendBundleFn })
    core.setDefinition(v2(SET_DEFINITION), 'set')
    sendFn.mockClear()
    publish.mockClear()

    core.handleUiFrame({ v: 1, type: 'set', param: 'level', value: 0.5, holder: 'page-b' }, 'c1')
    core.handleUiFrame({ v: 1, type: 'osc.batch', holder: 'page-b', messages: [
      { address: '/set/count', args: [{ type: 'i', value: 1 }] },
      { address: '/set/level', args: [{ type: 'f', value: 0.1 }] },
    ] }, 'c1')
    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/set/level', args: [{ type: 'f', value: 0.2 }] }, 'c1')
    expect(sendFn).not.toHaveBeenCalled()
    expect(sendBundleFn).not.toHaveBeenCalled()
    expect(publish.mock.calls.map(([frame]) => frame.type === 'notice' ? `${frame.code} ${frame.detail}` : frame.type)).toEqual([
      'set-rejected locked: level by 192.168.1.10',
      'batch-rejected locked: level by 192.168.1.10',
      'locked locked: level by 192.168.1.10',
    ])

    // 持ち主のページからの変更と、ロックの無い部品は通す
    core.handleUiFrame({ v: 1, type: 'set', param: 'level', value: 0.5, holder: 'page-a' }, 'c1')
    core.handleUiFrame({ v: 1, type: 'set', param: 'count', value: 2, holder: 'page-b' }, 'c1')
    expect(sendFn.mock.calls.map(([, , address]) => address)).toEqual(['/set/level', '/set/count'])
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
    core.setDefinition(v2(DEFINITION))
    expect(publish).toHaveBeenCalledWith({ v: 1, type: 'desired', full: true, values: [{ param: 'level', value: 0.5 }], rows: [] }, undefined)

    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/light/level', args: [{ type: 'f', value: 0.9 }] }, 'ui-1')
    expect(publish).toHaveBeenLastCalledWith({ v: 1, type: 'desired', full: false, values: [{ param: 'level', value: 0.9 }], rows: [] })

    publish.mockClear()
    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/light/fire', args: [{ type: 'i', value: 1 }] }, 'ui-1')
    expect(publish).not.toHaveBeenCalled()

    core.publishDesired('ui-2')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'desired', full: true }), 'ui-2')
  })

  it('resends held state values on first pong and after recovery, but never triggers', () => {
    const { core, sendFn, ping, pong } = setup()
    core.setDefinition(v2(DEFINITION))
    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/light/level', args: [{ type: 'f', value: 0.9 }] }, 'ui-1')
    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/light/fire', args: [{ type: 'i', value: 1 }] }, 'ui-1')
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
    core.setDefinition(v2(DEFINITION))
    ping(); pong()
    const echo = (value: number) => core.handleOscIn({ address: '/light/level', args: [{ type: 'f', value }], from: UNITY })
    echo(0.1); echo(0.2)
    expect(logWarn.mock.calls.filter(call => String(call[1]).includes('/light/level'))).toHaveLength(1)
    echo(0.5); echo(0.3)
    expect(logWarn.mock.calls.filter(call => String(call[1]).includes('/light/level'))).toHaveLength(2)
  })

  it('does not warn for echoes right after a UI operation, nor for non-Unity senders', () => {
    const { core, logWarn, ping, pong } = setup()
    core.setDefinition(v2(DEFINITION))
    ping(); pong()
    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/light/level', args: [{ type: 'f', value: 0.9 }] }, 'ui-1')
    core.handleOscIn({ address: '/light/level', args: [{ type: 'f', value: 0.2 }], from: UNITY })
    core.handleOscIn({ address: '/light/level', args: [{ type: 'f', value: 0.1 }], from: { host: '192.168.0.9', port: 5000 } })
    expect(logWarn.mock.calls.filter(call => String(call[1]).includes('/light/level'))).toHaveLength(0)
  })

  it('resends only reset values on adoption', () => {
    const { core, sendFn, ping, pong } = setup()
    core.setDefinition(v2(DEFINITION))
    ping(); pong()
    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/light/level', args: [{ type: 'f', value: 0.9 }] }, 'ui-1')
    sendFn.mockClear()
    // 同じ定義の再採用(レイアウトだけの保存)では何も再送しない
    core.setDefinition(v2({ ...DEFINITION, name: 'T2' }))
    expect(levelSends(sendFn)).toHaveLength(0)
    // 新しいパラメータだけが既定値で送られる
    core.setDefinition(v2({
      ...DEFINITION,
      parameters: [...DEFINITION.parameters, { id: 'x', address: '/light/x', label: 'X', type: 'f' as const, kind: 'state' as const, default: 0.1 }],
    }))
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

  function setup(savedValues: readonly PersistedDesiredValue[] | null = null) {
    let tick: (() => void) | undefined
    const saved: PersistedDesired | null = savedValues === null ? null : { values: savedValues, records: [] }
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
    core.setDefinition(v2(DEFINITION), 'stage')
    expect(store.load).toHaveBeenCalledWith('stage')
    expect(publish).toHaveBeenCalledWith({
      v: 1, type: 'desired', full: true, values: [{ param: 'level', value: 0.875 }, { param: 'mode', value: 'b' }], rows: [],
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
    core.setDefinition(v2(DEFINITION), 'stage')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'desired', full: true, values: [{ param: 'level', value: 0.5 }, { param: 'mode', value: 'a' }],
    }), undefined)
  })

  it('does not reload the file on later adoptions, so in-memory values keep winning', () => {
    const { core, store } = setup([{ id: 'level', address: '/light/level', type: 'f', args: [{ type: 'f', value: 0.25 }] }])
    core.setDefinition(v2(DEFINITION), 'stage')
    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/light/level', args: [{ type: 'f', value: 0.75 }] }, 'ui-1')
    core.setDefinition(v2(DEFINITION), 'other')
    expect(store.load).toHaveBeenCalledTimes(1)
    expect(store.save).toHaveBeenLastCalledWith('other', {
      values: [
        { id: 'level', address: '/light/level', type: 'f', args: [{ type: 'f', value: 0.75 }] },
        { id: 'mode', address: '/light/mode', type: 's', args: [{ type: 's', value: 'a' }] },
      ],
      records: [],
    })
  })

  it('saves on adoption and on held-value changes only, never for triggers', () => {
    const { core, store } = setup()
    core.setDefinition(v2(DEFINITION), 'stage')
    expect(store.save).toHaveBeenCalledTimes(1)
    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/light/fire', args: [{ type: 'i', value: 1 }] }, 'ui-1')
    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/light/level', args: [{ type: 'f', value: 2 }] }, 'ui-1') // 値域外
    expect(store.save).toHaveBeenCalledTimes(1)
    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/light/level', args: [{ type: 'f', value: 0.3 }] }, 'ui-1')
    expect(store.save).toHaveBeenCalledTimes(2)
    expect(store.save).toHaveBeenLastCalledWith('stage', expect.objectContaining({ values: expect.arrayContaining([
      { id: 'level', address: '/light/level', type: 'f', args: [{ type: 'f', value: 0.3 }] },
    ]) }))
  })

  it('neither loads nor saves without a surface name', () => {
    const { core, store } = setup([{ id: 'level', address: '/light/level', type: 'f', args: [{ type: 'f', value: 0.25 }] }])
    core.setDefinition(v2(DEFINITION))
    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/light/level', args: [{ type: 'f', value: 0.3 }] }, 'ui-1')
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
    core.setDefinition(v2(DEFINITION))
    ping(); pong(MAIN); pong(BACKUP)
    sendFn.mockClear()
    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/light/level', args: [{ type: 'f', value: 0.9 }] }, 'ui-1')
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
    core.setDefinition(v2(DEFINITION))
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
    core.setDefinition(v2(DEFINITION))
    publish.mockClear()
    core.handleOscIn({ address: '/light/level', args: [{ type: 'f', value: 0.5 }], from: BACKUP })
    core.handleOscIn({ address: '/light/level', args: [{ type: 'f', value: 0.2 }], from: BACKUP })
    expect(publish).not.toHaveBeenCalled()
    expect(logWarn.mock.calls.filter(call => String(call[1]).includes('"backup"'))).toHaveLength(1)
    core.handleOscIn({ address: '/light/level', args: [{ type: 'f', value: 0.5 }], from: MAIN })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'osc.message', address: '/light/level' }))
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
    core.setDefinition(v2(DEFINITION))
    expect(lastOptions()).toEqual({ v: 1, type: 'runtimeOptions', lists: [{ list: 'l_mb_segments', targets: [] }], choices: [{ param: 'segment', options: ['(none)'] }], keys: [], fieldChoices: [], pending: [] })

    publish.mockClear()
    core.handleOscIn({ address: '/mb/segments', args: names('Song B', 'Intro'), from: BACKUP })
    core.handleOscIn({ address: '/mb/segments', args: names('Intro', 'Song A'), from: MAIN })
    expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'osc.message' }))
    expect(lastOptions()).toEqual({
      v: 1, type: 'runtimeOptions',
      lists: [{ list: 'l_mb_segments', targets: [{ name: 'unity', options: ['Intro', 'Song A'] }, { name: 'backup', options: ['Song B', 'Intro'] }] }],
      choices: [{ param: 'segment', options: ['(none)', 'Intro', 'Song A', 'Song B'] }],
      keys: [],
      fieldChoices: [],
      pending: [],
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

    // 定義の採用では、一覧が変わらなくても surface・desired に続けて全 UI へ配る(未送信の印 D-090 はその後)
    publish.mockClear()
    core.setDefinition(v2({ ...DEFINITION, name: 'T2' }))
    expect(publish.mock.calls.map(call => [call[0].type, call[1]])).toEqual([
      ['desired', undefined], ['runtimeOptions', undefined], ['desiredStatus', undefined],
    ])
  })

  it('holds a changed list until applied, publishing only the pending state, and rejects unknown lists (D-088)', () => {
    const { core, publish, lastOptions } = setup()
    core.setDefinition(v2(DEFINITION))
    core.handleOscIn({ address: '/mb/segments', args: names('Intro'), from: MAIN })
    publish.mockClear()
    core.handleOscIn({ address: '/mb/segments', args: names('Intro', 'Wrong project'), from: MAIN })
    expect(lastOptions()).toMatchObject({
      choices: [{ param: 'segment', options: ['(none)', 'Intro'] }],
      pending: [{ list: 'l_mb_segments', target: 'unity', added: ['Wrong project'], removed: [] }],
    })

    // 反映待ちが無いときの反映は何も配らない。Unity から受ける一覧でないアドレスは要求元だけへ断る
    publish.mockClear()
    core.handleUiFrame({ v: 1, type: 'runtimeOptionsApply', list: 'l_member_1_segment' }, 'ui-2')
    expect(publish.mock.calls).toEqual([
      [{ v: 1, type: 'notice', level: 'error', code: 'runtime-options-apply-rejected', detail: 'unknown-list: l_member_1_segment' }, 'ui-2'],
    ])

    publish.mockClear()
    core.handleUiFrame({ v: 1, type: 'runtimeOptionsApply' }, 'ui-1')
    // 反映は全 UI へ配る(ある画面で反映したら、ほかの画面も揃う)
    expect(publish.mock.calls.map(call => [call[0].type, call[1]])).toEqual([['runtimeOptions', undefined]])
    expect(lastOptions()).toMatchObject({ choices: [{ param: 'segment', options: ['(none)', 'Intro', 'Wrong project'] }], pending: [] })
    publish.mockClear()
    core.handleUiFrame({ v: 1, type: 'runtimeOptionsApply' }, 'ui-1')
    expect(publish).not.toHaveBeenCalled()
  })

  it('applies the first list of a newly selected target and keeps lists per answering host of a broadcast target (D-088)', () => {
    const { core, lastOptions, ping, sendFn } = setup()
    core.setDefinition(v2(DEFINITION))
    core.handleOscIn({ address: '/mb/segments', args: names('Intro'), from: MAIN })
    const network = { networkInt: ipv4ToInt('192.168.0.0')!, maskInt: ipv4ToInt('255.255.255.0')! }
    core.setTargets([{ name: 'all-devices', host: '192.168.0.255', sendPort: 9000, primary: true, broadcast: network }])
    // 宛先の切り替えは即反映する(外した宛先の一覧を捨てて配り直す)
    expect(lastOptions()).toMatchObject({ choices: [{ param: 'segment', options: ['(none)'] }], pending: [] })

    // pong を返したホストだけが Unity。宛先の初報だけを反映し、後から答えたホストの一覧は答えたホストつきで反映を待つ
    ping()
    const seq = sendFn.mock.calls.find(call => call[2] === SYS.PING)![3]
    const answer = (host: string, ...values: string[]) => {
      core.handleOscIn({ address: SYS.PONG, args: [seq], from: { host, port: 9000 } })
      core.handleOscIn({ address: '/mb/segments', args: names(...values), from: { host, port: 9000 } })
    }
    answer('192.168.0.10', 'A')
    answer('192.168.0.20', 'Evil')
    expect(lastOptions()).toMatchObject({
      choices: [{ param: 'segment', options: ['(none)', 'A'] }],
      pending: [{ list: 'l_mb_segments', target: 'all-devices', host: '192.168.0.20', added: ['Evil'], removed: [] }],
    })
    // 正しい PC の一覧と交互に上書きし合わない
    answer('192.168.0.10', 'A')
    expect(lastOptions()).toMatchObject({ choices: [{ param: 'segment', options: ['(none)', 'A'] }] })
  })

  it('reports delivery per answering host of a broadcast target, including the unicast request sent to a responder (D-116)', () => {
    const { core, ping, sendFn, publish } = setup()
    core.setDefinition(v2(DEFINITION))
    const network = { networkInt: ipv4ToInt('192.168.0.0')!, maskInt: ipv4ToInt('255.255.255.0')! }
    core.setTargets([{ name: 'all-devices', host: '192.168.0.255', sendPort: 9000, primary: true, broadcast: network }])
    ping()
    const seq = sendFn.mock.calls.find(call => call[2] === SYS.PING)![3]
    core.handleOscIn({ address: SYS.PONG, args: [seq], from: { host: '192.168.0.10', port: 9000 } })
    publish.mockClear()

    // 答えたホストへの個別の送信(初回の要求)も、宛先 all-devices への送信として記録するので、そのエコーが到達になる
    core.handleOscIn({ address: '/mb/segments/get', args: [], from: { host: '192.168.0.10', port: 9000 } })
    const deliveries = publish.mock.calls.map(call => call[0]).filter(frame => frame.type === 'delivery')
    expect(deliveries).toEqual([{ v: 1, type: 'delivery', events: [expect.objectContaining({ host: '192.168.0.10', target: 'all-devices', result: 'ok', param: null })] }])
  })

  it('ignores a list with non-string arguments and warns once', () => {
    const { core, publish, logWarn } = setup()
    core.setDefinition(v2(DEFINITION))
    publish.mockClear()
    core.handleOscIn({ address: '/mb/segments', args: [{ type: 'i', value: 1 }], from: MAIN })
    core.handleOscIn({ address: '/mb/segments', args: [{ type: 'i', value: 2 }], from: MAIN })
    expect(publish).not.toHaveBeenCalled()
    expect(logWarn.mock.calls.filter(call => String(call[1]).includes('/mb/segments'))).toHaveLength(1)
  })

  it('requests lists on first reach and recovery per target, on adoption of new addresses, and on refresh', () => {
    const { core, ping, pong, requestsTo, sendFn } = setup()
    core.setDefinition(v2(DEFINITION)) // まだ到達していないので要求しない
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
    core.setDefinition(v2({ ...DEFINITION, name: 'T2' }))
    expect(requestsTo(MAIN)).toEqual([])
    core.setDefinition(v2({
      ...DEFINITION,
      parameters: [{ ...DEFINITION.parameters[0]!, optionsFrom: { address: '/mb/segments2', request: '/mb/segments/get' } }],
    }))
    expect(requestsTo(MAIN)).toHaveLength(1)
    expect(requestsTo(BACKUP)).toHaveLength(1)

    sendFn.mockClear()
    core.handleUiFrame({ v: 1, type: 'runtimeOptionsRefresh' }, 'ui-1')
    expect(requestsTo(MAIN)).toHaveLength(1)
    expect(requestsTo(BACKUP)).toHaveLength(1)
  })

  it('sends only the named request to every target on a sync, and rejects a request the definition does not declare (D-077)', () => {
    const { core, sendFn, publish } = setup()
    core.setDefinition(v2({
      ...DEFINITION,
      parameters: [
        DEFINITION.parameters[0]!,
        {
          id: 'scene', address: '/scene', label: 'Scene', type: 's' as const, kind: 'state' as const,
          optionsFrom: { address: '/mb/scenes', request: '/mb/scenes/get' },
        },
      ],
    }))
    // 到達前(到達不能の台を含む)でも全宛先へ送る。要求した 1 件だけで、他の一覧の要求は送らない
    sendFn.mockClear()
    core.handleUiFrame({ v: 1, type: 'runtimeOptionsRefresh', list: 'l_mb_scenes' }, 'ui-1')
    expect(sendFn.mock.calls.map(call => [call[0], call[2], call.length])).toEqual([
      [MAIN.host, '/mb/scenes/get', 3],
      [BACKUP.host, '/mb/scenes/get', 3],
    ])

    // 定義に無い一覧(パラメータの id を含む)は送らず、要求元だけへ断る。アドレスでは指せない(HID-389)
    sendFn.mockClear()
    publish.mockClear()
    core.handleUiFrame({ v: 1, type: 'runtimeOptionsRefresh', list: 'segment' }, 'ui-1')
    core.handleUiFrame({ v: 1, type: 'runtimeOptionsRefresh', list: '/mb/scenes/get' }, 'ui-2')
    expect(sendFn).not.toHaveBeenCalled()
    expect(publish.mock.calls).toEqual([
      [{ v: 1, type: 'notice', level: 'error', code: 'runtime-options-refresh-rejected', detail: 'unknown-request: segment' }, 'ui-1'],
      [{ v: 1, type: 'notice', level: 'error', code: 'runtime-options-refresh-rejected', detail: 'unknown-request: /mb/scenes/get' }, 'ui-2'],
    ])
  })

  it('rejects a sync while no definition is adopted', () => {
    const { core, sendFn, publish } = setup()
    sendFn.mockClear()
    core.handleUiFrame({ v: 1, type: 'runtimeOptionsRefresh', list: 'l_mb_segments' }, 'ui-1')
    expect(sendFn.mock.calls.some(call => call[2] === '/mb/segments/get')).toBe(false)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'notice', code: 'runtime-options-refresh-rejected' }), 'ui-1')
  })

  it('blocks UI frames to a list address, but relays an OSC-native UI request to Unity', () => {
    const { core, sendFn, publish } = setup()
    core.setDefinition(v2(DEFINITION))
    sendFn.mockClear()
    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/mb/segments', args: names('Injected') }, 'ui-1')
    core.handleUiFrame({ v: 1, type: 'osc.batch', messages: [{ address: '/mb/segments', args: names('Injected') }] }, 'ui-1')
    expect(sendFn.mock.calls.some(call => call[2] === '/mb/segments')).toBe(false)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'notice', code: 'batch-rejected', detail: 'option-list-address: /mb/segments' }), 'ui-1')

    // 名乗った OSC ネイティブ UI の端末が要求のアドレスへ送ったものは、通常の操作として全台へ中継する
    core.handleOscIn({ address: OSCDESK.HELLO, args: [{ type: 'i', value: 9100 }], from: { host: '192.168.0.50', port: 9100 } })
    core.handleOscIn({ address: '/mb/segments/get', args: [], from: { host: '192.168.0.50', port: 9100 } })
    expect(sendFn.mock.calls.filter(call => call[2] === '/mb/segments/get').map(call => call[0])).toEqual([MAIN.host, BACKUP.host])
  })

  it('keeps a list from a target that became unreachable', () => {
    const { core, ping, pong, lastOptions } = setup()
    core.setDefinition(v2(DEFINITION))
    ping(); pong(MAIN); pong(BACKUP)
    core.handleOscIn({ address: '/mb/segments', args: names('Backup only'), from: BACKUP })
    ping(); pong(MAIN)
    ping(); pong(MAIN)
    expect(core.linkSnapshot().targets.find(target => target.name === 'backup')?.reachability).toBe('lost')
    expect(lastOptions()).toMatchObject({ choices: [{ param: 'segment', options: ['(none)', 'Backup only'] }] })
  })

  it('holds and resends a chosen name even after it disappears from every list', () => {
    const { core, ping, pong, sendFn, publish } = setup()
    core.setDefinition(v2(DEFINITION))
    core.handleOscIn({ address: '/mb/segments', args: names('Song A'), from: MAIN })
    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/member/1/segment', args: [{ type: 's', value: 'Song A' }] }, 'ui-1')
    expect(publish).toHaveBeenCalledWith({ v: 1, type: 'desired', full: false, values: [{ param: 'segment', value: 'Song A' }], rows: [] })

    core.handleOscIn({ address: '/mb/segments', args: names('Song B'), from: MAIN })
    ping(); pong(MAIN)
    expect(sendFn.mock.calls.filter(call => call[2] === '/member/1/segment')).toEqual([[MAIN.host, MAIN.port, '/member/1/segment', { type: 's', value: 'Song A' }]])
  })
})

describe('record rows (D-062)', () => {
  const DEFINITION = {
    format: 'oscdesk-surface' as const,
    version: 1 as const,
    name: 'T',
    parameters: [],
    records: [
      {
        id: 'member', address: '/vp/member', label: 'Member', kind: 'state' as const,
        keysFrom: { address: '/vp/members', request: '/vp/members/get' },
        fields: [
          { id: 'active', label: 'Active', type: 'bool' as const, default: false },
          { id: 'slot', label: 'Slot', type: 'i' as const, range: [1, 64] as [number, number], default: 1 },
        ],
      },
      {
        id: 'memberUpdate', address: '/vp/member/update', label: 'Update', kind: 'trigger' as const,
        keysFrom: { address: '/vp/members', request: '/vp/members/get' }, fields: [],
      },
    ],
    screens: [],
  }
  const MAIN = { host: '127.0.0.1', port: 9000 }
  const BACKUP = { host: '10.0.0.2', port: 9100 }
  const s = (value: string) => ({ type: 's' as const, value })
  const i = (value: number) => ({ type: 'i' as const, value })
  const rowArgs = (key: string, active: number, slot: number) => [s(key), i(active), i(slot)]
  // 保持値のフレームの行(HID-389)。行のキーとフィールド id ごとの値
  const row = (key: string, active: number, slot: number) => ({ record: 'member', key, values: { active: active === 1, slot } })
  const desiredRows = (full: boolean, ...rows: ReturnType<typeof row>[]) => ({ v: 1, type: 'desired', full, values: [], rows })

  function setup(saved: PersistedDesired | null = null) {
    let tick: (() => void) | undefined
    const logWarn = vi.fn()
    const store = { load: vi.fn((_name: string) => saved), save: vi.fn() }
    let clock = 10_000
    const made = makeCore({
      config: { ...BRIDGE_CONFIG, unity: { ...BRIDGE_CONFIG.unity, secondary: [{ name: 'backup', host: BACKUP.host, sendPort: BACKUP.port }] } },
      setIntervalFn: vi.fn((callback: () => void) => { tick = callback; return 1 as never }),
      logWarn, logInfo: vi.fn(), now: () => clock, desiredValuesStore: store,
    })
    made.core.start()
    const ping = () => { clock += 2_000; made.sendFn.mockClear(); tick?.() }
    const pong = (to: { host: string; port: number }) => {
      const sent = made.sendFn.mock.calls.find(call => call[0] === to.host && call[1] === to.port && call[2] === SYS.PING)
      made.core.handleOscIn({ address: SYS.PONG, args: [sent![3]], from: to })
    }
    const keys = (from: { host: string; port: number }, ...names: string[]) =>
      made.core.handleOscIn({ address: '/vp/members', args: names.map(s), from })
    const rowSendsTo = (to: { host: string; port: number }) =>
      made.sendFn.mock.calls.filter(call => call[0] === to.host && call[1] === to.port && call[2] === '/vp/member').map(call => call.slice(3))
    const frames = (type: DownstreamFrame['type']) => made.publish.mock.calls.map(call => call[0]).filter(frame => frame.type === type)
    return { ...made, ping, pong, keys, rowSendsTo, frames, logWarn, store, advance: (ms: number) => { clock += ms } }
  }

  it('treats only the defined records and their listed rows as lockable (HID-392)', () => {
    const { core, ping, pong, keys } = setup()
    core.setDefinition(v2({ ...DEFINITION, parameters: SET_LEGACY.parameters }), 'stage')
    ping(); pong(MAIN)
    keys(MAIN, 'A')

    expect(core.isLockableRef({ param: 'level' })).toBe(true)
    expect(core.isLockableRef({ param: 'ghost' })).toBe(false)
    expect(core.isLockableRef({ record: 'member', key: 'A' })).toBe(true)
    // trigger の Record は保持値の行を持たないが、キーの一覧にあれば行として出る
    expect(core.isLockableRef({ record: 'memberUpdate', key: 'A' })).toBe(true)
    expect(core.isLockableRef({ record: 'member', key: 'Z' })).toBe(false)
    expect(core.isLockableRef({ record: 'ghost', key: 'A' })).toBe(false)

    core.setDefinition(null)
    expect(core.isLockableRef({ param: 'level' })).toBe(false)
  })

  it('creates a default row for each new key, sends it to reachable targets and publishes the diff', () => {
    const { core, ping, pong, keys, rowSendsTo, frames, publish, sendFn, store } = setup()
    core.setDefinition(v2(DEFINITION), 'stage')
    expect(frames('desired').at(-1)).toEqual(desiredRows(true))
    expect(frames('runtimeOptions').at(-1)).toMatchObject({ keys: [{ record: 'member', keys: [] }, { record: 'memberUpdate', keys: [] }] })

    ping(); pong(MAIN) // 副系は未到達
    expect(sendFn.mock.calls.filter(call => call[2] === '/vp/members/get').map(call => call[0])).toEqual([MAIN.host])
    sendFn.mockClear(); publish.mockClear()
    keys(MAIN, 'A', 'B')
    expect(rowSendsTo(MAIN)).toEqual([rowArgs('A', 0, 1), rowArgs('B', 0, 1)])
    expect(rowSendsTo(BACKUP)).toEqual([])
    // 一覧(全量)→ 作った行の差分の順。一覧のアドレスは osc フレームとして流さない
    expect(publish.mock.calls.map(call => call[0])).toEqual([
      expect.objectContaining({ type: 'runtimeOptions', keys: [{ record: 'member', keys: ['A', 'B'] }, { record: 'memberUpdate', keys: ['A', 'B'] }] }),
      desiredRows(false, row('A', 0, 1), row('B', 0, 1)),
    ])
    expect(store.save).toHaveBeenLastCalledWith('stage', expect.objectContaining({ records: [
      expect.objectContaining({ id: 'member', key: 'A' }), expect.objectContaining({ id: 'member', key: 'B' }),
    ] }))

    // 同じ一覧の繰り返し、既にある行のキーでは何もしない
    sendFn.mockClear(); publish.mockClear()
    keys(MAIN, 'A', 'B')
    keys(BACKUP, 'B')
    expect(sendFn).not.toHaveBeenCalled()
    expect(frames('desired')).toEqual([])
    // 初報の後の変化は反映するまで行を作らない(D-088)。反映したら副系にしか無いキーの行を作る
    keys(BACKUP, 'B', 'C')
    expect(rowSendsTo(MAIN)).toEqual([])
    expect(frames('desired')).toEqual([])
    expect(frames('runtimeOptions').at(-1)).toMatchObject({
      keys: [{ record: 'member', keys: ['A', 'B'] }, { record: 'memberUpdate', keys: ['A', 'B'] }],
      pending: [{ list: 'l_vp_members', target: 'backup', added: ['C'], removed: [] }],
    })
    core.handleUiFrame({ v: 1, type: 'runtimeOptionsApply', list: 'l_vp_members' }, 'ui-1')
    expect(rowSendsTo(MAIN)).toEqual([rowArgs('C', 0, 1)])
    expect(frames('desired')).toEqual([desiredRows(false, row('C', 0, 1))])
    expect(frames('runtimeOptions').at(-1)).toMatchObject({
      keys: [{ record: 'member', keys: ['A', 'B', 'C'] }, { record: 'memberUpdate', keys: ['A', 'B', 'C'] }],
      pending: [],
    })

    // 後から到達した副系には、初回到達の再送で全行がキーごとに 1 メッセージずつ届く
    ping(); pong(MAIN); pong(BACKUP)
    expect(rowSendsTo(BACKUP)).toEqual([rowArgs('A', 0, 1), rowArgs('B', 0, 1), rowArgs('C', 0, 1)])
  })

  it('holds a UI row per key, ignores malformed rows and trigger records, and keeps rows that left the list', () => {
    const { core, ping, pong, keys, rowSendsTo, frames, publish, sendFn } = setup()
    core.setDefinition(v2(DEFINITION))
    keys(MAIN, 'A', 'B')
    publish.mockClear()

    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/vp/member', args: rowArgs('B', 1, 7) }, 'ui-1')
    expect(frames('desired')).toEqual([desiredRows(false, row('B', 1, 7))])
    // 値域外の行は送るが保持しない(パラメータと同じ扱い)。trigger のレコードは保持しない
    publish.mockClear(); sendFn.mockClear()
    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/vp/member', args: rowArgs('A', 1, 99) }, 'ui-1')
    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/vp/member/update', args: [s('A')] }, 'ui-1')
    expect(rowSendsTo(MAIN)).toEqual([rowArgs('A', 1, 99)])
    expect(sendFn.mock.calls.filter(call => call[2] === '/vp/member/update')).toHaveLength(2)
    expect(frames('desired')).toEqual([])

    // 一覧から消えたキーの行も残り、再送も続ける
    keys(MAIN, 'A')
    core.handleUiFrame({ v: 1, type: 'runtimeOptionsApply' }, 'ui-1')
    expect(frames('desired')).toEqual([])
    ping(); pong(MAIN)
    expect(rowSendsTo(MAIN)).toEqual([rowArgs('A', 0, 1), rowArgs('B', 1, 7)])
    sendFn.mockClear()
    core.handleUiFrame({ v: 1, type: 'resend', target: 'unity' }, 'ui-1')
    expect(rowSendsTo(MAIN)).toEqual([rowArgs('A', 0, 1), rowArgs('B', 1, 7)])
    expect(sendFn.mock.calls.some(call => call[2] === '/vp/member/update')).toBe(false)
  })

  it('holds rows sent in an oscBatch', () => {
    const sendBundleFn = vi.fn().mockReturnValue({ ok: true, bytes: 64, messageCount: 2 })
    const made = makeCore({ sendBundleFn, logInfo: vi.fn(), logWarn: vi.fn() })
    made.core.setDefinition(v2(DEFINITION))
    made.core.handleOscIn({ address: '/vp/members', args: [s('A')], from: MAIN })
    made.publish.mockClear()
    made.core.handleUiFrame({ v: 1, type: 'osc.batch', messages: [{ address: '/vp/member', args: rowArgs('A', 1, 2) }, { address: '/vp/member/update', args: [s('A')] }] }, 'ui-1')
    expect(made.publish).toHaveBeenCalledWith(desiredRows(false, row('A', 1, 2)))
  })

  it('warns about echo mismatches per key', () => {
    const { core, keys, logWarn, advance } = setup()
    core.setDefinition(v2(DEFINITION))
    keys(MAIN, 'A', 'B')
    advance(5_000)
    const echo = (...args: ReturnType<typeof rowArgs>) => core.handleOscIn({ address: '/vp/member', args, from: MAIN })
    const warnings = () => logWarn.mock.calls.filter(call => String(call[1]).includes('/vp/member')).map(call => String(call[1]))
    echo(...rowArgs('A', 1, 1))
    echo(...rowArgs('B', 0, 1)) // B は一致しても A の警告は解除しない
    echo(...rowArgs('A', 1, 1))
    expect(warnings()).toEqual(['Unity echo differs from desired value for "/vp/member" key "A".'])
  })

  it('restores saved rows on the first adoption, including keys missing from every list', () => {
    const { core, keys, ping, pong, rowSendsTo, frames } = setup({
      values: [],
      records: [
        { id: 'member', address: '/vp/member', key: 'Gone', fields: [{ id: 'active', type: 'bool', arg: i(1) }, { id: 'slot', type: 'i', arg: i(5) }] },
        { id: 'member', address: '/vp/member', key: 'A', fields: [{ id: 'slot', type: 'i', arg: i(99) }] }, // 値域外 → default
      ],
    })
    core.setDefinition(v2(DEFINITION), 'stage')
    expect(frames('desired').at(-1)).toEqual(desiredRows(true, row('Gone', 1, 5), row('A', 0, 1)))
    keys(MAIN, 'A', 'B')
    expect(frames('desired').at(-1)).toEqual(desiredRows(false, row('B', 0, 1)))
    ping(); pong(MAIN)
    expect(rowSendsTo(MAIN)).toEqual([rowArgs('Gone', 1, 5), rowArgs('A', 0, 1), rowArgs('B', 0, 1)])
  })

  it('keeps rows over a layout-only re-adoption and creates rows from lists carried into a new record', () => {
    const { core, keys, ping, pong, rowSendsTo, frames, sendFn } = setup()
    core.setDefinition(v2({ ...DEFINITION, records: [DEFINITION.records[1]!] })) // まだ state のレコードが無い
    ping(); pong(MAIN)
    keys(MAIN, 'A')
    expect(frames('desired').at(-1)).toEqual(desiredRows(true))

    // 引き継いだ一覧から、採用した state のレコードの行を作り、採用時に到達可能な台へ送る
    sendFn.mockClear()
    core.setDefinition(v2(DEFINITION))
    expect(frames('desired').at(-1)).toEqual(desiredRows(true, row('A', 0, 1)))
    expect(rowSendsTo(MAIN)).toEqual([rowArgs('A', 0, 1)])

    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/vp/member', args: rowArgs('A', 1, 3) }, 'ui-1')
    sendFn.mockClear()
    core.setDefinition(v2({ ...DEFINITION, name: 'T2' }))
    expect(rowSendsTo(MAIN)).toEqual([])
    expect(frames('desired').at(-1)).toEqual(desiredRows(true, row('A', 1, 3)))
  })

  it('requests key lists on refresh and blocks UI frames to the key list address', () => {
    const { core, sendFn, publish } = setup()
    core.setDefinition(v2(DEFINITION))
    sendFn.mockClear()
    core.handleUiFrame({ v: 1, type: 'runtimeOptionsRefresh' }, 'ui-1')
    expect(sendFn.mock.calls.filter(call => call[2] === '/vp/members/get').map(call => call[0])).toEqual([MAIN.host, BACKUP.host])
    sendFn.mockClear()
    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/vp/members', args: [s('Injected')] }, 'ui-1')
    core.handleUiFrame({ v: 1, type: 'osc.batch', messages: [{ address: '/vp/members', args: [s('Injected')] }] }, 'ui-1')
    expect(sendFn).not.toHaveBeenCalled()
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'notice', code: 'batch-rejected', detail: 'option-list-address: /vp/members' }), 'ui-1')
  })
})
describe('record keys added and removed from the UI (D-075)', () => {
  const UI_KEYS = { address: '/mb/keys', source: 'ui' as const, max: 2 }
  const DEFINITION = {
    format: 'oscdesk-surface' as const,
    version: 1 as const,
    name: 'T',
    parameters: [],
    records: [
      {
        id: 'member', address: '/vp/member', label: 'Member', kind: 'state' as const,
        keysFrom: { address: '/vp/members' },
        fields: [{ id: 'active', label: 'Active', type: 'bool' as const, default: false }],
      },
      {
        id: 'mb', address: '/mb/values', label: 'MB', kind: 'state' as const, keysFrom: { ...UI_KEYS },
        fields: [{ id: 'port', label: 'Port', type: 'i' as const, range: [1, 65535] as [number, number], default: 22000 }],
      },
      { id: 'mbUpdate', address: '/mb/update', label: 'Update', kind: 'trigger' as const, keysFrom: { ...UI_KEYS }, fields: [] },
    ],
    screens: [],
  }
  const MAIN = { host: '127.0.0.1', port: 9000 }
  const s = (value: string) => ({ type: 's' as const, value })
  const i = (value: number) => ({ type: 'i' as const, value })

  function setup(saved: PersistedDesired | null = null) {
    let tick: (() => void) | undefined
    const store = { load: vi.fn((_name: string) => saved), save: vi.fn() }
    let clock = 10_000
    let nextId = 0
    const made = makeCore({
      setIntervalFn: vi.fn((callback: () => void) => { tick = callback; return 1 as never }),
      logWarn: vi.fn(), logInfo: vi.fn(), now: () => clock, desiredValuesStore: store,
      newRowId: () => `r${String(++nextId)}`,
    })
    made.core.start()
    const reach = () => {
      clock += 2_000; made.sendFn.mockClear(); tick?.()
      const sent = made.sendFn.mock.calls.find(call => call[2] === SYS.PING)
      made.core.handleOscIn({ address: SYS.PONG, args: [sent![3]], from: MAIN })
    }
    const sendsTo = (address: string) => made.sendFn.mock.calls.filter(call => call[2] === address).map(call => call.slice(3))
    const frames = (type: DownstreamFrame['type']) => made.publish.mock.calls.map(call => call[0]).filter(frame => frame.type === type)
    const add = (record: string, key: string) => made.core.handleUiFrame({ v: 1, type: 'recordKeyAdd', record, key }, 'ui-1')
    const remove = (record: string, key: string) => made.core.handleUiFrame({ v: 1, type: 'recordKeyRemove', record, key }, 'ui-1')
    const rename = (record: string, key: string, name: string) =>
      made.core.handleUiFrame({ v: 1, type: 'recordKeyRename', record, key, name }, 'ui-1')
    return { ...made, reach, sendsTo, frames, add, remove, rename, store }
  }

  it('appends a UI key with a new row ID, sends the ID list and a default row to Unity, and stops at max', () => {
    const { core, reach, sendsTo, frames, add, publish, sendFn, store } = setup()
    core.setDefinition(v2(DEFINITION), 'stage')
    reach()
    sendFn.mockClear(); publish.mockClear()

    add('mbUpdate', 'MB 1')
    // 一覧(追加順の ID の全量)→ 行([ID, Name, フィールド])の順に送る。一覧を共有する trigger のレコードから足しても state の行ができる
    expect(sendFn.mock.calls.map(call => call[2])).toEqual(['/mb/keys', '/mb/values'])
    expect(sendsTo('/mb/keys')).toEqual([[s('r1')]])
    expect(sendsTo('/mb/values')).toEqual([[s('r1'), s('MB 1'), i(22000)]])
    expect(frames('runtimeOptions').at(-1)).toMatchObject({ keys: expect.arrayContaining([{ record: 'mb', keys: ['r1'], names: ['MB 1'] }]) })
    expect(frames('desired')).toEqual([{ v: 1, type: 'desired', full: false, values: [], rows: [{ record: 'mb', key: 'r1', values: { port: 22000 } }] }])
    expect(store.save).toHaveBeenLastCalledWith('stage', expect.objectContaining({
      keyLists: [{ address: '/mb/keys', rows: [{ id: 'r1', name: 'MB 1' }] }],
      records: [{ id: 'mb', address: '/mb/values', key: 'r1', fields: [{ id: 'port', type: 'i', arg: i(22000) }] }],
    }))

    add('mb', 'MB 0')
    expect(sendsTo('/mb/keys').at(-1)).toEqual([s('r1'), s('r2')])
    publish.mockClear()
    add('mb', 'MB 2')
    add('mb', 'MB 1')
    add('mb', '')
    expect(publish.mock.calls.map(call => call[0].type === 'notice' ? call[0].detail : call[0].type)).toEqual([
      'full: MB 2', 'exists: MB 1', 'empty-key',
    ])
  })

  it('removes a UI key from the list and every record sharing it, and publishes the full desired set', () => {
    const { core, reach, sendsTo, frames, add, remove, publish, sendFn } = setup()
    core.setDefinition(v2(DEFINITION), 'stage')
    reach()
    add('mb', 'MB 1')
    add('mb', 'MB 2')
    sendFn.mockClear(); publish.mockClear()

    remove('mb', 'r1')
    expect(sendsTo('/mb/keys')).toEqual([[s('r2')]])
    expect(frames('desired')).toEqual([{ v: 1, type: 'desired', full: true, values: [], rows: [{ record: 'mb', key: 'r2', values: { port: 22000 } }] }])
    expect(frames('runtimeOptions').at(-1)).toMatchObject({ keys: expect.arrayContaining([{ record: 'mbUpdate', keys: ['r2'], names: ['MB 2'] }]) })

    // 消したキーへの古い画面からの書き込みは保持しない。再送では一覧が行より先に届く
    publish.mockClear()
    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/mb/values', args: [s('r1'), s('MB 1'), i(1)] }, 'ui-2')
    expect(frames('desired')).toEqual([])
    sendFn.mockClear()
    core.handleUiFrame({ v: 1, type: 'resend' }, 'ui-1')
    expect(sendFn.mock.calls.map(call => call[2])).toEqual(['/mb/keys', '/mb/values'])

    publish.mockClear()
    remove('mb', 'r1')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'notice', code: 'record-key-rejected', detail: 'not-found: r1' }), 'ui-1')
  })

  it('renames a UI row without changing its ID or values, and resends its rows with the new name (D-087)', () => {
    const { core, reach, sendsTo, frames, add, rename, publish, sendFn, store } = setup()
    core.setDefinition(v2(DEFINITION), 'stage')
    reach()
    add('mb', 'MB 1')
    add('mb', 'MB 2')
    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/mb/values', args: [s('r1'), s('MB 1'), i(1234)] }, 'ui-1')
    sendFn.mockClear(); publish.mockClear()

    rename('mb', 'r1', 'MB A')
    // 一覧は ID の並びなので送り直さない。行だけを同じ ID・値・新しい Name で送る
    expect(sendsTo('/mb/keys')).toEqual([])
    expect(sendsTo('/mb/values')).toEqual([[s('r1'), s('MB A'), i(1234)]])
    expect(frames('runtimeOptions').at(-1)).toMatchObject({ keys: expect.arrayContaining([{ record: 'mb', keys: ['r1', 'r2'], names: ['MB A', 'MB 2'] }]) })
    expect(frames('desired')).toEqual([{ v: 1, type: 'desired', full: false, values: [], rows: [{ record: 'mb', key: 'r1', values: { port: 1234 } }] }])
    expect(store.save).toHaveBeenLastCalledWith('stage', expect.objectContaining({
      keyLists: [{ address: '/mb/keys', rows: [{ id: 'r1', name: 'MB A' }, { id: 'r2', name: 'MB 2' }] }],
    }))

    // 改名の前の画面が古い Name で値を送っても、Unity と保持値には今の Name で届く
    sendFn.mockClear(); publish.mockClear()
    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/mb/values', args: [s('r1'), s('MB 1'), i(99)] }, 'ui-2')
    expect(sendsTo('/mb/values')).toEqual([[s('r1'), s('MB A'), i(99)]])
    expect(frames('desired')).toEqual([{ v: 1, type: 'desired', full: false, values: [], rows: [{ record: 'mb', key: 'r1', values: { port: 99 } }] }])

    publish.mockClear(); sendFn.mockClear()
    rename('mb', 'r1', 'MB A') // 同じ Name は何もしない
    rename('mb', 'r1', 'MB 2')
    rename('mb', 'r1', '')
    rename('mb', 'gone', 'X')
    rename('member', 'A', 'B')
    expect(sendFn).not.toHaveBeenCalled()
    expect(publish.mock.calls.map(call => call[0].type === 'notice' ? call[0].detail : call[0].type)).toEqual([
      'exists: MB 2', 'empty-key', 'not-found: gone', 'not-renamable: member',
    ])
  })

  it('migrates a version 2 key list (names as keys) by giving each row an ID and keeping its values (D-087)', () => {
    const saved: PersistedDesired = {
      values: [],
      records: [{ id: 'mb', address: '/mb/values', key: 'MB 1', fields: [{ id: 'port', type: 'i', arg: i(1234) }] }],
      keyLists: [{ address: '/mb/keys', rows: [{ name: 'MB 1' }, { name: 'MB 2' }] }],
    }
    const { core, frames, store } = setup(saved)
    core.setDefinition(v2(DEFINITION), 'stage')
    expect(frames('desired').at(-1)).toEqual({ v: 1, type: 'desired', full: true, values: [], rows: [
      { record: 'mb', key: 'r1', values: { port: 1234 } },
      { record: 'mb', key: 'r2', values: { port: 22000 } },
    ] })
    expect(store.save).toHaveBeenLastCalledWith('stage', expect.objectContaining({
      keyLists: [{ address: '/mb/keys', rows: [{ id: 'r1', name: 'MB 1' }, { id: 'r2', name: 'MB 2' }] }],
    }))
  })

  it('adds and removes a row of a Unity key list, keeping the row while Unity still lists it', () => {
    const { core, reach, frames, add, remove, publish, sendFn, sendsTo } = setup()
    core.setDefinition(v2(DEFINITION), 'stage')
    reach()
    core.handleOscIn({ address: '/vp/members', args: [s('A')], from: MAIN })
    publish.mockClear()

    add('member', 'Guest')
    expect(frames('desired')).toEqual([{ v: 1, type: 'desired', full: false, values: [], rows: [{ record: 'member', key: 'Guest', values: { active: false } }] }])
    // Unity の一覧は書き換えない
    expect(frames('runtimeOptions')).toEqual([])

    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/vp/member', args: [s('A'), i(1)] }, 'ui-1')
    publish.mockClear(); sendFn.mockClear()
    // 一覧にある A は行が残り、default で作り直して Unity にも送る。一覧に無い Guest は行ごと消える
    remove('member', 'A')
    expect(sendsTo('/vp/member')).toEqual([[s('A'), i(0)]])
    remove('member', 'Guest')
    expect(frames('desired').at(-1)).toEqual({ v: 1, type: 'desired', full: true, values: [], rows: [{ record: 'member', key: 'A', values: { active: false } }] })
  })

  it('restores the saved UI key list and drops saved rows whose key is not in it', () => {
    const saved: PersistedDesired = {
      values: [],
      records: [
        { id: 'mb', address: '/mb/values', key: 'id-1', fields: [{ id: 'port', type: 'i', arg: i(1234) }] },
        { id: 'mb', address: '/mb/values', key: 'Gone', fields: [{ id: 'port', type: 'i', arg: i(1) }] },
      ],
      keyLists: [{ address: '/mb/keys', rows: [{ id: 'id-1', name: 'MB 1' }, { id: 'id-2', name: 'MB 2' }, { id: 'id-3', name: 'MB 3' }] }],
    }
    const { core, reach, sendsTo, frames } = setup(saved)
    core.setDefinition(v2(DEFINITION), 'stage')
    // 上限(2)を超えた分は後ろから落とす。一覧にあって行の無いキーは default の行になる
    expect(frames('desired').at(-1)).toEqual({ v: 1, type: 'desired', full: true, values: [], rows: [
      { record: 'mb', key: 'id-1', values: { port: 1234 } },
      { record: 'mb', key: 'id-2', values: { port: 22000 } },
    ] })
    reach()
    expect(sendsTo('/mb/keys')).toEqual([[s('id-1'), s('id-2')]])
  })
})
describe('OSC pad presses (D-080)', () => {
  const DEFINITION = {
    format: 'oscdesk-surface' as const,
    version: 1 as const,
    name: 'T',
    parameters: [
      { id: 'level', address: '/light/level', label: 'Level', type: 'f' as const, kind: 'state' as const, range: [0, 1] as [number, number], default: 0.5 },
      { id: 'segment', address: '/segment', label: 'Segment', type: 's' as const, kind: 'state' as const, default: 'a', optionsFrom: { address: '/segment/list' } },
    ],
    screens: [],
  }

  it('sends one message to every target, logs it as a pad press and leaves the held values alone', () => {
    const onSent = vi.fn()
    const { core, sendFn, publish } = makeCore({ onSent, logInfo: vi.fn() })
    core.setDefinition(v2(DEFINITION))
    sendFn.mockClear()
    publish.mockClear()

    expect(core.firePad('/light/level', [{ type: 'f', value: 0.9 }, { type: 's', value: 'x' }])).toEqual({ ok: true })
    expect(sendFn.mock.calls).toEqual([['127.0.0.1', 9000, '/light/level', { type: 'f', value: 0.9 }, { type: 's', value: 'x' }]])
    expect(onSent).toHaveBeenLastCalledWith({
      origin: 'pad', targets: ['unity'], messages: [{ address: '/light/level', args: [{ type: 'f', value: 0.9 }, { type: 's', value: 'x' }] }],
    })
    // 保持値(desired)は変わらない
    expect(publish).not.toHaveBeenCalled()
    core.publishDesired('ui-1')
    expect(publish).toHaveBeenCalledWith({ v: 1, type: 'desired', full: true, values: [
      { param: 'level', value: 0.5 },
      { param: 'segment', value: 'a' },
    ], rows: [] }, 'ui-1')
  })

  it('refuses reserved and option list addresses without sending', () => {
    const { core, sendFn } = makeCore({ logInfo: vi.fn() })
    core.setDefinition(v2(DEFINITION))
    sendFn.mockClear()
    expect(core.firePad('/sys/ping', [])).toEqual({ ok: false, reason: 'internal-address: /sys/ping' })
    expect(core.firePad('/segment/list', [])).toEqual({ ok: false, reason: 'option-list-address: /segment/list' })
    expect(sendFn).not.toHaveBeenCalled()
  })
})

describe('parameter-ID vocabulary for echoes, rows and batches (HID-389)', () => {
  const DEFINITION = {
    format: 'oscdesk-surface' as const,
    version: 1 as const,
    name: 'T',
    parameters: [
      { id: 'level', address: '/light/level', label: 'Level', type: 'f' as const, kind: 'state' as const, range: [0, 1] as [number, number], default: 0.5 },
      { id: 'on', address: '/light/on', label: 'On', type: 'bool' as const, kind: 'state' as const, default: false },
      { id: 'go', address: '/light/go', label: 'Go', type: 'i' as const, kind: 'trigger' as const, value: 7 },
      { id: 'part', address: '/light/part', label: 'Part', type: 'f' as const, kind: 'state' as const, default: 0, standalone: false },
      { id: 'spawn', address: '/fx/spark/spawn', label: 'Spawn', type: 's' as const, kind: 'trigger' as const, value: 'spark' },
    ],
    records: [
      {
        id: 'member', address: '/vp/member', label: 'Member', kind: 'state' as const, keysFrom: { address: '/vp/members' },
        fields: [{ id: 'active', label: 'Active', type: 'bool' as const, default: false }, { id: 'slot', label: 'Slot', type: 'i' as const, range: [1, 64] as [number, number], default: 1 }],
      },
      {
        id: 'mb', address: '/mb/values', label: 'MB', kind: 'state' as const, keysFrom: { address: '/mb/keys', source: 'ui' as const },
        fields: [{ id: 'port', label: 'Port', type: 'i' as const, default: 22000 }],
      },
    ],
    screens: [],
  }
  const MAIN = { host: '127.0.0.1', port: 9000 }
  const BACKUP = { host: '10.0.0.2', port: 9100 }
  const s = (value: string) => ({ type: 's' as const, value })
  const i = (value: number) => ({ type: 'i' as const, value })

  function setup() {
    const sendBundleFn = vi.fn().mockReturnValue({ ok: true, bytes: 64, messageCount: 2 })
    const made = makeCore({
      config: { ...BRIDGE_CONFIG, unity: { ...BRIDGE_CONFIG.unity, secondary: [{ name: 'backup', host: BACKUP.host, sendPort: BACKUP.port }] } },
      sendBundleFn, logInfo: vi.fn(), logWarn: vi.fn(), newRowId: () => 'row-1',
    })
    made.core.setDefinition(v2(DEFINITION))
    made.core.handleOscIn({ address: '/vp/members', args: [s('A')], from: MAIN })
    made.core.handleUiFrame({ v: 1, type: 'recordKeyAdd', record: 'mb', key: 'MB 1' }, 'ui-1')
    made.publish.mockClear()
    made.sendFn.mockClear()
    const frames = (type: DownstreamFrame['type']) => made.publish.mock.calls.map(call => call[0]).filter(frame => frame.type === type)
    const notices = () => made.publish.mock.calls.map(call => call[0]).flatMap(frame => frame.type === 'notice' ? [`${frame.code}: ${frame.detail}`] : [])
    return { ...made, sendBundleFn, frames, notices }
  }

  it('publishes the echoes of the primary target by parameter id and row, without addresses', () => {
    const { core, frames } = setup()
    core.handleOscIn({ address: '/light/level', args: [{ type: 'f', value: 0.25 }], from: MAIN })
    core.handleOscIn({ address: '/light/on', args: [i(1)], from: MAIN })
    core.handleOscIn({ address: '/light/go', args: [], from: MAIN })
    core.handleOscIn({ address: '/vp/member', args: [s('A'), i(1), i(3)], from: MAIN })
    core.handleOscIn({ address: '/mb/values', args: [s('row-1'), s('MB 1'), i(7000)], from: MAIN })
    expect(frames('echo')).toEqual([
      { v: 1, type: 'echo', values: [{ param: 'level', value: 0.25 }], rows: [] },
      { v: 1, type: 'echo', values: [{ param: 'on', value: true }], rows: [] },
      { v: 1, type: 'echo', values: [{ param: 'go' }], rows: [] },
      { v: 1, type: 'echo', values: [], rows: [{ record: 'member', key: 'A', values: { active: true, slot: 3 } }] },
      { v: 1, type: 'echo', values: [], rows: [{ record: 'mb', key: 'row-1', values: { port: 7000 } }] },
    ])
  })

  it('leaves out echoes of a secondary target, of another sender, of malformed rows and of unknown addresses', () => {
    const { core, frames } = setup()
    core.handleOscIn({ address: '/light/level', args: [{ type: 'f', value: 0.25 }], from: BACKUP })
    core.handleOscIn({ address: '/light/level', args: [{ type: 'f', value: 0.25 }], from: { host: '192.168.0.9', port: 5000 } })
    core.handleOscIn({ address: '/vp/member', args: [s('A'), i(1)], from: MAIN })
    core.handleOscIn({ address: '/other', args: [i(1)], from: MAIN })
    expect(frames('echo')).toEqual([])
  })

  it('leaves out echoed rows whose fields are out of range or not of their type, since the UI no longer re-checks them (D-124)', () => {
    const { core, frames } = setup()
    core.handleOscIn({ address: '/vp/member', args: [s('A'), i(1), i(65)], from: MAIN })
    core.handleOscIn({ address: '/vp/member', args: [s('A'), i(2), i(3)], from: MAIN })
    core.handleOscIn({ address: '/vp/member', args: [s('A'), i(1), s('3')], from: MAIN })
    expect(frames('echo')).toEqual([])
  })

  it('sends a row by record id, key and field values, adding the current name of a UI row', () => {
    const { core, sendFn, frames } = setup()
    core.handleUiFrame({ v: 1, type: 'setRow', record: 'member', key: 'A', values: { active: true, slot: 5 } }, 'ui-1')
    core.handleUiFrame({ v: 1, type: 'setRow', record: 'mb', key: 'row-1', values: { port: 7000 } }, 'ui-1')
    expect(sendFn.mock.calls.filter(call => call[0] === MAIN.host).map(call => [call[2], ...call.slice(3)])).toEqual([
      ['/vp/member', s('A'), i(1), i(5)],
      ['/mb/values', s('row-1'), s('MB 1'), i(7000)],
    ])
    expect(frames('desired')).toEqual([
      { v: 1, type: 'desired', full: false, values: [], rows: [{ record: 'member', key: 'A', values: { active: true, slot: 5 } }] },
      { v: 1, type: 'desired', full: false, values: [], rows: [{ record: 'mb', key: 'row-1', values: { port: 7000 } }] },
    ])
  })

  it('refuses a row that does not fit the definition, without sending it', () => {
    const { core, sendFn, notices } = setup()
    core.handleUiFrame({ v: 1, type: 'setRow', record: 'ghost', key: 'A', values: {} }, 'ui-1')
    core.handleUiFrame({ v: 1, type: 'setRow', record: 'member', key: 'A', values: { active: true } }, 'ui-1')
    core.handleUiFrame({ v: 1, type: 'setRow', record: 'member', key: 'A', values: { active: 1, slot: 5 } }, 'ui-1')
    core.handleUiFrame({ v: 1, type: 'setRow', record: 'member', key: 'A', values: { active: true, slot: 99 } }, 'ui-1')
    core.handleUiFrame({ v: 1, type: 'setRow', record: 'member', key: 'A', values: { active: true, slot: 5, extra: 1 } }, 'ui-1')
    core.handleUiFrame({ v: 1, type: 'setRow', record: 'mb', key: 'gone', values: { port: 1 } }, 'ui-1')
    expect(sendFn).not.toHaveBeenCalled()
    expect(notices()).toEqual([
      'row-rejected: unknown-record: ghost',
      'row-rejected: missing-field: member.slot',
      'row-rejected: type-mismatch: member.active',
      'row-rejected: out-of-range: member[A]',
      'row-rejected: unknown-field: member.extra',
      'row-rejected: unknown-row: mb[gone]',
    ])
  })

  it('sends a batch of parameters and rows as one bundle, including parameters that are never sent alone', () => {
    const { core, sendBundleFn, frames } = setup()
    core.handleUiFrame({ v: 1, type: 'batch', items: [
      { param: 'part', value: 0.5 },
      { param: 'go' },
      { record: 'member', key: 'A', values: { active: false, slot: 2 } },
    ] }, 'ui-1')
    expect(sendBundleFn).toHaveBeenCalledTimes(2)
    expect(sendBundleFn.mock.calls[0]).toEqual([MAIN.host, MAIN.port, [
      { address: '/light/part', args: [{ type: 'f', value: 0.5 }] },
      { address: '/light/go', args: [i(7)] },
      { address: '/vp/member', args: [s('A'), i(0), i(2)] },
    ]])
    // standalone: false のパラメータは保持しない(まとめ送りの一部としてだけ送る)。行は保持する
    expect(frames('desired')).toEqual([{ v: 1, type: 'desired', full: false, values: [], rows: [{ record: 'member', key: 'A', values: { active: false, slot: 2 } }] }])
  })

  it('refuses the whole batch when one item does not fit, and does not send spawner commands in a batch', () => {
    const { core, sendBundleFn, notices } = setup()
    core.handleUiFrame({ v: 1, type: 'batch', items: [{ param: 'level', value: 0.5 }, { param: 'ghost' }] }, 'ui-1')
    core.handleUiFrame({ v: 1, type: 'batch', items: [{ param: 'level', value: 2 }] }, 'ui-1')
    core.handleUiFrame({ v: 1, type: 'batch', items: [{ param: 'level', value: 0.5 }, { record: 'member', key: 'A', values: { active: true } }] }, 'ui-1')
    core.handleUiFrame({ v: 1, type: 'batch', items: [{ param: 'spawn' }] }, 'ui-1')
    expect(sendBundleFn).not.toHaveBeenCalled()
    expect(notices()).toEqual([
      'batch-rejected: unknown-param: ghost',
      'batch-rejected: out-of-range: level',
      'batch-rejected: missing-field: member.slot',
      'batch-rejected: spawner-in-batch: spawn',
    ])
  })

  it('sends a sync only for a list that has a request, and applies only lists taken from the target, by list id', () => {
    const { core, notices } = setup()
    core.handleUiFrame({ v: 1, type: 'runtimeOptionsRefresh', list: 'l_vp_members' }, 'ui-1')
    core.handleUiFrame({ v: 1, type: 'runtimeOptionsApply', list: 'l_vp_members' }, 'ui-1')
    // UI で管理する一覧(D-075)はターゲットから受けないので反映するものが無い
    core.handleUiFrame({ v: 1, type: 'runtimeOptionsApply', list: 'l_mb_keys' }, 'ui-1')
    expect(notices()).toEqual([
      'runtime-options-refresh-rejected: unknown-request: l_vp_members',
      'runtime-options-apply-rejected: unknown-list: l_mb_keys',
    ])
  })
})