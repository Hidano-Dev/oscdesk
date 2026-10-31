import { describe, expect, it, vi } from 'vitest'

import { SYS, type DownstreamFrame, type SurfaceDefinition } from '@oscdesk/shared'

import type { PersistedDesired } from './desired-values'
import { createSurfaceCore, type BridgeConfig } from './surface-core'

// 生成の記録と復元(HID-385・D-115)。

const CONFIG: BridgeConfig = {
  unity: { name: 'unity', host: '10.0.0.1', sendPort: 9000, secondary: [{ name: 'backup', host: '10.0.0.2', sendPort: 9000 }] },
  bridge: { oscListenHost: '0.0.0.0', oscListenPort: 9001, wsHost: '0.0.0.0', wsPort: 8080 },
  ui: { host: '0.0.0.0', port: 8080 },
  debug: false,
  boolFallbackToInt: false,
  diagnostics: { ringBufferSize: 200, lossRateWindow: 30, ndjsonDir: 'logs/diagnostics', ndjsonMaxTotalBytes: 52_428_800 },
  oscUi: { enabled: false, staticPeers: [], peerTtlMs: 0 },
  surfaces: { dir: 'surfaces' },
  destinations: { scanTimeoutMs: 8_000 },
}

const DEFINITION: SurfaceDefinition = {
  format: 'oscdesk-surface',
  version: 1,
  name: 'T',
  parameters: [
    { id: 'level', address: '/light/level', label: 'Level', type: 'f', kind: 'state', default: 0.5 },
    { id: 'spawn', address: '/effect/spawner/spawn', label: 'Spawn', type: 's', kind: 'trigger', value: 'spark' },
    { id: 'destroy', address: '/effect/spawner/destroy', label: 'Destroy', type: 's', kind: 'trigger', value: 'spark1' },
  ],
  screens: [],
}

function setup(options: { catalog?: { host: string; items: { address: string }[] }[]; saved?: PersistedDesired } = {}) {
  let tick: (() => void) | undefined
  const timers: (() => void)[] = []
  let clock = 10_000
  const sendFn = vi.fn()
  const publish = vi.fn<(frame: DownstreamFrame, target?: string) => void>()
  const save = vi.fn<(name: string, values: PersistedDesired) => void>()
  const catalog = options.catalog ?? []
  const core = createSurfaceCore({
    config: CONFIG, sendFn, publish, logInfo: vi.fn(), logWarn: vi.fn(), now: () => clock,
    setIntervalFn: callback => { tick = callback; return 1 as never },
    setTimeoutFn: callback => timers.push(callback),
    catalogPcs: () => catalog,
    desiredValuesStore: { load: () => options.saved ?? null, save },
  })
  core.start()
  core.setDefinition(DEFINITION, 'fx')
  let seq = 0
  const ping = () => { clock += 2_000; tick?.(); seq += core.currentTargets().length }
  const pongAll = () => {
    const base = seq - core.currentTargets().length + 1
    core.currentTargets().forEach((target, index) =>
      core.handleOscIn({ address: SYS.PONG, args: [{ type: 'i', value: base + index }], from: { host: target.host, port: 9000 } }))
  }
  const spawnSends = () => sendFn.mock.calls
    .filter(call => String(call[2]).startsWith('/effect/spawner/'))
    .map(call => `${String(call[0])} ${String(call[2]).split('/').pop()} ${String((call[3] as { value: string }).value)}`)
  const set = (param: string, value?: string) =>
    core.handleUiFrame({ v: 1, type: 'set', param, ...(value === undefined ? {} : { value }) }, 'ui-1')
  const lastSaved = () => save.mock.calls.at(-1)?.[1]
  return { core, sendFn, publish, ping, pongAll, spawnSends, set, lastSaved, catalog, timers }
}

describe('spawning from the UI', () => {
  it('names the spawn on the bridge, sends it to every target and records it per PC', () => {
    const { set, spawnSends, publish, lastSaved, sendFn } = setup({ catalog: [{ host: '10.0.0.2', items: [{ address: '/effect/spark1/stop' }] }] })
    sendFn.mockClear()
    set('spawn')
    // spark1 はほかの PC の設計図にあるので使わない
    expect(spawnSends()).toEqual(['10.0.0.1 spawn spark2', '10.0.0.2 spawn spark2'])
    expect(publish).toHaveBeenCalledWith({ v: 1, type: 'notice', level: 'info', code: 'spawned', detail: 'spark2' }, 'ui-1')
    expect(lastSaved()?.spawns).toEqual([
      { param: 'spawn', address: '/effect/spawner/spawn', name: 'spark2', host: '10.0.0.1' },
      { param: 'spawn', address: '/effect/spawner/spawn', name: 'spark2', host: '10.0.0.2' },
    ])
    set('spawn')
    expect(spawnSends().at(-1)).toBe('10.0.0.2 spawn spark3')
  })

  it('removes the record when the UI destroys, and rejects an invalid name', () => {
    const { set, lastSaved, publish } = setup()
    set('spawn')
    set('destroy', 'spark1')
    expect(lastSaved()?.spawns).toBeUndefined()
    set('spawn', 'bad name')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'notice', code: 'set-rejected', detail: 'invalid-name: spawn' }), 'ui-1')
  })
})

describe('restoring on a target that started', () => {
  it('spawns again and resends values only on the PC that started', () => {
    const { core, set, spawnSends, sendFn, ping, pongAll } = setup()
    ping(); pongAll()
    set('spawn')
    core.handleUiFrame({ v: 1, type: 'set', param: 'level', value: 0.9 }, 'ui-1')
    sendFn.mockClear()
    core.onTargetStarted('10.0.0.2')
    expect(spawnSends()).toEqual(['10.0.0.2 spawn spark1'])
    expect(sendFn.mock.calls.filter(call => call[2] === '/light/level').map(call => call[0])).toEqual(['10.0.0.2'])
    // 生成を先に送り、値を後に送る
    const order = sendFn.mock.calls.map(call => String(call[2]))
    expect(order.indexOf('/effect/spawner/spawn')).toBeLessThan(order.indexOf('/light/level'))
  })

  it('does not restore on other PCs what was spawned only on some PCs', () => {
    const { core, set, spawnSends, sendFn } = setup()
    // 宛先を 1 台に絞ってから生成し、2 台に戻す
    core.setTargets([{ name: 'unity', host: '10.0.0.1', sendPort: 9000, primary: true }])
    set('spawn')
    core.setTargets([
      { name: 'unity', host: '10.0.0.1', sendPort: 9000, primary: true },
      { name: 'backup', host: '10.0.0.2', sendPort: 9000, primary: false },
    ])
    sendFn.mockClear()
    core.onTargetStarted('10.0.0.2')
    expect(spawnSends()).toEqual([])
    core.onTargetStarted('10.0.0.1')
    expect(spawnSends()).toEqual(['10.0.0.1 spawn spark1'])
  })

  it('drops what another PC removed while the PC was down instead of restoring it', () => {
    const { core, set, spawnSends, sendFn, ping, pongAll, lastSaved } = setup()
    ping(); pongAll()
    set('spawn')
    // backup が落ちる(ping を 1 周取りこぼす)
    ping()
    core.handleOscIn({ address: SYS.PONG, args: [{ type: 'i', value: 3 }], from: { host: '10.0.0.1', port: 9000 } })
    ping()
    // 動いている unity から削除通知が来る(シーンの切り替えなど)
    core.onCatalogItemRemoved('10.0.0.1', '/effect/spark1/stop')
    sendFn.mockClear()
    core.onTargetStarted('10.0.0.2')
    expect(spawnSends()).toEqual([])
    expect(lastSaved()?.spawns).toBeUndefined()
  })

  it('does not restore while an imported project has not been sent, and restores on the send to every target', () => {
    const { core, spawnSends, sendFn } = setup()
    core.setDefinition(DEFINITION, 'fx', {
      values: [], records: [], keyLists: [],
      spawns: [{ param: 'spawn', address: '/effect/spawner/spawn', name: 'spark7', host: '10.0.0.2' }],
    })
    sendFn.mockClear()
    core.onTargetStarted('10.0.0.2')
    expect(spawnSends()).toEqual([])
    core.handleUiFrame({ v: 1, type: 'resend' }, 'ui-1')
    expect(spawnSends()).toEqual(['10.0.0.2 spawn spark7'])
  })

  it('restores the saved record after a bridge restart and drops PCs removed from the destinations', () => {
    const saved: PersistedDesired = {
      values: [], records: [],
      spawns: [
        { param: 'spawn', address: '/effect/spawner/spawn', name: 'spark1', host: '10.0.0.1' },
        { param: 'spawn', address: '/effect/spawner/spawn', name: 'spark1', host: '10.0.0.2' },
      ],
    }
    const { core, spawnSends, lastSaved } = setup({ saved })
    core.onTargetStarted('10.0.0.1')
    expect(spawnSends()).toEqual(['10.0.0.1 spawn spark1'])
    core.setTargets([{ name: 'unity', host: '10.0.0.1', sendPort: 9000, primary: true }])
    expect(lastSaved()?.spawns?.map(entry => entry.host)).toEqual(['10.0.0.1'])
  })
  it('restores more than the per-frame limit of a spawner in steps, and sends the values after the last step', () => {
    const saved: PersistedDesired = {
      values: [], records: [],
      spawns: Array.from({ length: 10 }, (_, index) => ({ param: 'spawn', address: '/effect/spawner/spawn', name: `spark${String(index + 1)}`, host: '10.0.0.1' })),
    }
    const { core, spawnSends, sendFn, timers } = setup({ saved })
    sendFn.mockClear()
    core.onTargetStarted('10.0.0.1')
    expect(spawnSends()).toHaveLength(8)
    expect(sendFn.mock.calls.some(call => call[2] === '/light/level')).toBe(false)
    timers.shift()!()
    expect(spawnSends()).toHaveLength(10)
    expect(sendFn.mock.calls.filter(call => call[2] === '/light/level').map(call => call[0])).toEqual(['10.0.0.1'])
  })
})

describe('reconcile (HID-385)', () => {
  it('spawns what the PC lacks, destroys extras, and resends values to that PC only', () => {
    const catalog = [{ host: '10.0.0.2', items: [{ address: '/effect/spark9/stop' }, { address: '/effect/lamp/level' }] }]
    const { core, set, spawnSends, sendFn, publish } = setup({ catalog })
    set('spawn')
    sendFn.mockClear()
    core.handleUiFrame({ v: 1, type: 'reconcile', target: 'backup' }, 'ui-1')
    expect(spawnSends()).toEqual(['10.0.0.2 destroy spark9', '10.0.0.2 spawn spark1'])
    expect(sendFn.mock.calls.every(call => call[0] === '10.0.0.2')).toBe(true)
    expect(publish).toHaveBeenCalledWith({ v: 1, type: 'notice', level: 'info', code: 'reconciled', detail: 'backup: spawned 1, destroyed 1' }, 'ui-1')
    core.handleUiFrame({ v: 1, type: 'reconcile', target: 'nope' }, 'ui-1')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ code: 'reconcile-rejected' }), 'ui-1')
  })
})
