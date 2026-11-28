import { describe, expect, it, vi } from 'vitest'

import { SYS, type DownstreamFrame } from '@oscdesk/shared'

import { ipv4ToInt, maskOf } from '../ipv4'
import { createSurfaceCore, type BridgeConfig } from './'
import { MAX_SYNC_RESEND_STEPS, SYNC_MESSAGES_PER_STEP } from './context'

// 宛先の差し替え(宛先タブ。D-078)とブロードキャストの宛先(D-079)。

const CONFIG: BridgeConfig = {
  unity: { name: 'unity', host: '127.0.0.1', sendPort: 9000, secondary: [] },
  bridge: { oscListenHost: '0.0.0.0', oscListenPort: 9001, wsHost: '0.0.0.0', wsPort: 8080 },
  debug: false,
  boolFallbackToInt: false,
  diagnostics: { ringBufferSize: 200, lossRateWindow: 30, ndjsonDir: 'logs/diagnostics', ndjsonMaxTotalBytes: 52_428_800 },
  oscUi: { enabled: false, staticPeers: [], peerTtlMs: 0 },
  surfaces: { dir: 'surfaces' },
  destinations: {},
  network: {}, webUi: { enabled: true },
  oscQuery: { mdns: false, targets: [], queryIntervalMs: 30_000, fetchTimeoutMs: 5_000, refreshDebounceMs: 250 },
}

const BROADCAST = { networkInt: ipv4ToInt('192.168.1.0')!, maskInt: maskOf(24) }

function setup() {
  let tick: (() => void) | undefined
  let clock = 10_000
  const sendFn = vi.fn()
  const publish = vi.fn<(frame: DownstreamFrame, target?: string) => void>()
  const onRespondersChanged = vi.fn()
  const core = createSurfaceCore({
    config: CONFIG, sendFn, publish, onRespondersChanged, logInfo: vi.fn(), logWarn: vi.fn(), now: () => clock,
    setIntervalFn: callback => { tick = callback; return 1 as never },
  })
  core.start()
  let seq = 0
  const ping = () => { clock += 2_000; tick?.(); seq += core.currentTargets().length }
  // seq は全宛先で一意に振られる(1 周で宛先の数だけ進む)。index は今の周回での宛先の位置
  const pong = (host: string, port = 9000, index = 0) =>
    core.handleOscIn({ address: SYS.PONG, args: [{ type: 'i', value: seq - core.currentTargets().length + 1 + index }], from: { host, port } })
  const levelSends = () => sendFn.mock.calls.filter(call => call[2] === '/light/level').map(call => `${String(call[0])}:${String(call[1])}`)
  return { core, sendFn, publish, onRespondersChanged, ping, pong, levelSends }
}

describe('setTargets (D-078)', () => {
  it('sends UI operations only to the new targets', () => {
    const { core, sendFn, publish, levelSends } = setup()
    core.setTargets([
      { name: 'ip-10-0-0-2', host: '10.0.0.2', sendPort: 9000, primary: false },
      { name: 'ip-10-0-0-3', host: '10.0.0.3', sendPort: 9000, primary: true },
    ])

    // 主系が先頭に並び直り、hello と link が新しい宛先を指す
    expect(core.currentTargets().map(target => target.name)).toEqual(['ip-10-0-0-3', 'ip-10-0-0-2'])
    expect(core.helloFrame('ui-1')).toMatchObject({ unity: { host: '10.0.0.3', sendPort: 9000 }, targets: [{ name: 'ip-10-0-0-3', primary: true }, { name: 'ip-10-0-0-2', primary: false }] })
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'link', targets: [expect.objectContaining({ name: 'ip-10-0-0-3' }), expect.objectContaining({ name: 'ip-10-0-0-2' })] }), undefined)

    sendFn.mockClear()
    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/light/level', args: [{ type: 'f', value: 0.25 }] }, 'ui-1')
    expect(levelSends()).toEqual(['10.0.0.3:9000', '10.0.0.2:9000'])
  })

  it('keeps the link state of an unchanged target', () => {
    const { core, sendFn, ping, pong, levelSends } = setup()
    ping(); pong('127.0.0.1')
    sendFn.mockClear()
    core.setTargets([
      { name: 'unity', host: '127.0.0.1', sendPort: 9000, primary: true },
      { name: 'ip-10-0-0-2', host: '10.0.0.2', sendPort: 9000, primary: false },
    ])
    ping(); pong('127.0.0.1', 9000, 0)
    expect(levelSends()).toEqual([])
    expect(core.linkSnapshot().targets[0]).toMatchObject({ name: 'unity', reachability: 'reachable' })
  })

  it('accepts pongs and echoes from the loopback alias of a target on this PC (a re-picked config secondary)', () => {
    const { core, sendFn, publish, ping, pong, levelSends } = setup()
    core.setTargets([{ name: 'local', host: '192.168.1.10', sendPort: 9002, primary: true, addresses: ['127.0.0.1'] }])
    sendFn.mockClear()
    ping(); pong('127.0.0.1', 9002)
    // 到達可能になる(保持値の自動の再送は撤去した。パッドの同期は起動 ID の変化で。D-175)
    expect(levelSends()).toEqual([])
    expect(core.linkSnapshot().unity.reachability).toBe('reachable')
    // ループバックからのエコーは主系のエコーで、UI もこの出所を Unity とみなせる
    expect(core.primaryHosts()).toEqual(['192.168.1.10', '127.0.0.1'])
    publish.mockClear()
    core.handleOscIn({ address: '/light/level', args: [{ type: 'f', value: 0.9 }], from: { host: '127.0.0.1', port: 9002 } })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'osc.message', from: { host: '127.0.0.1', port: 9002 } }))
  })

  it('fires OSC pad presses to the replaced set of targets (D-080)', () => {
    const { core, sendFn } = setup()
    core.setTargets([
      { name: 'ip-10-0-0-2', host: '10.0.0.2', sendPort: 9000, primary: true },
      { name: 'ip-10-0-0-3', host: '10.0.0.3', sendPort: 9000, primary: false },
    ])
    sendFn.mockClear()
    expect(core.firePad('/fx/fire', [{ type: 'i', value: 1 }])).toEqual({ ok: true })
    expect(sendFn.mock.calls.filter(call => call[2] === '/fx/fire').map(call => `${String(call[0])}:${String(call[1])}`))
      .toEqual(['10.0.0.2:9000', '10.0.0.3:9000'])

    // 全てのデバイスへ切り替えたらブロードキャストアドレスへ 1 回
    core.setTargets([{ name: 'all-devices', host: '192.168.1.255', sendPort: 9000, primary: true, broadcast: BROADCAST }])
    sendFn.mockClear()
    core.firePad('/fx/fire', [])
    expect(sendFn.mock.calls.filter(call => call[2] === '/fx/fire').map(call => String(call[0]))).toEqual(['192.168.1.255'])
  })

  it('refuses a list without exactly one primary', () => {
    const { core } = setup()
    expect(() => core.setTargets([])).toThrow()
    expect(() => core.setTargets([{ name: 'a', host: '10.0.0.2', sendPort: 9000, primary: false }])).toThrow()
  })
})

describe('broadcast targets (D-079)', () => {
  const broadcastTarget = { name: 'all-devices', host: '192.168.1.255', sendPort: 9000, primary: true, broadcast: BROADCAST }

  it('accepts pongs from any host of the network and remembers each responder', () => {
    const { core, sendFn, publish, onRespondersChanged, ping, pong, levelSends } = setup()
    core.setTargets([broadcastTarget])
    sendFn.mockClear()

    ping()
    expect(sendFn).toHaveBeenCalledWith('192.168.1.255', 9000, SYS.PING, expect.objectContaining({ type: 'i' }))
    pong('192.168.1.20')
    pong('192.168.1.21')
    // ネットワークの外からの pong は受けない
    pong('10.0.0.5')
    // 同じ PC の Unity がループバックへ返した pong は、この PC の 1 台として受ける
    pong('127.0.0.1')

    expect(levelSends()).toEqual([])
    expect(core.primaryHosts()).toEqual(['192.168.1.255', '192.168.1.20', '192.168.1.21', '127.0.0.1'])
    expect(onRespondersChanged).toHaveBeenCalledTimes(3)
    expect(core.linkSnapshot().unity.reachability).toBe('reachable')

    // 答えたホストが戻っても、知らせ直すのは新しいホストだけ
    ping(); pong('192.168.1.20'); pong('192.168.1.21'); pong('127.0.0.1')
    ping(); pong('192.168.1.20'); pong('127.0.0.1')
    ping(); pong('192.168.1.20'); pong('192.168.1.21'); pong('127.0.0.1')
    expect(onRespondersChanged).toHaveBeenCalledTimes(3)

    // 操作はブロードキャストアドレスへ 1 回だけ送る
    sendFn.mockClear()
    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/light/level', args: [{ type: 'f', value: 0.3 }] }, 'ui-1')
    expect(levelSends()).toEqual(['192.168.1.255:9000'])

    // 答えたホストのエコーは主系のエコーとして UI へ流れる
    publish.mockClear()
    core.handleOscIn({ address: '/light/level', args: [{ type: 'f', value: 0.3 }], from: { host: '192.168.1.20', port: 9000 } })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'osc.message', address: '/light/level', from: { host: '192.168.1.20', port: 9000 } }))
  })

  it('accepts pongs from this PC\'s other NIC addresses given in addresses (D-085)', () => {
    // 同じ PC の Unity が返信先をこの PC の別の NIC(10.0.0.5)にしていると、ネットワークの外のアドレスから答える
    const { core, ping, pong } = setup()
    core.setTargets([{ ...broadcastTarget, addresses: ['192.168.1.10', '10.0.0.5'] }])
    ping()
    pong('10.0.0.5')
    pong('10.0.0.6')
    expect(core.primaryHosts()).toContain('10.0.0.5')
    expect(core.primaryHosts()).not.toContain('10.0.0.6')
    expect(core.linkSnapshot().unity.reachability).toBe('reachable')
  })

  it('counts a round without any responder as a loss', () => {
    const { core, ping, pong } = setup()
    core.setTargets([broadcastTarget])
    ping(); pong('192.168.1.20')
    ping(); ping()
    expect(core.linkSnapshot().unity).toMatchObject({ reachability: 'lost', consecutiveLosses: 1 })
  })
})

describe('boot ids and pad sync (D-169)', () => {
  function bootSetup() {
    let tick: (() => void) | undefined
    let clock = 10_000
    const sendFn = vi.fn()
    const onBootId = vi.fn()
    const onSent = vi.fn()
    const logWarn = vi.fn()
    const timers: (() => void)[] = []
    const core = createSurfaceCore({
      config: CONFIG, sendFn, publish: vi.fn(), onBootId, onSent, logInfo: vi.fn(), logWarn, now: () => clock,
      setIntervalFn: callback => { tick = callback; return 1 as never },
      setTimeoutFn: callback => { timers.push(callback) },
    })
    core.start()
    const runTimers = () => { while (timers.length > 0) timers.shift()!() }
    let seq = 0
    const ping = () => { clock += 2_000; tick?.(); seq += core.currentTargets().length }
    const pong = (host: string, bootId?: unknown, index = 0) => core.handleOscIn({
      address: SYS.PONG,
      args: [{ type: 'i', value: seq - core.currentTargets().length + 1 + index }, ...(bootId === undefined ? [] : [bootId as never])],
      from: { host, port: 9000 },
    })
    return { core, sendFn, onBootId, onSent, logWarn, ping, pong, timers, runTimers }
  }

  it('reports the boot id of each accepted pong, and null for a pong without one', () => {
    const { onBootId, ping, pong } = bootSetup()
    ping()
    pong('127.0.0.1', { type: 's', value: 'boot-1' })
    expect(onBootId).toHaveBeenLastCalledWith({ name: 'unity', host: '127.0.0.1', port: 9000 }, 'boot-1')
    // 遅れて届いた古い seq の pong(受理しない)では知らせない
    pong('127.0.0.1', { type: 's', value: 'boot-2' })
    expect(onBootId).toHaveBeenCalledTimes(1)
    ping()
    pong('127.0.0.1', { type: 'i', value: 3 })
    expect(onBootId).toHaveBeenLastCalledWith({ name: 'unity', host: '127.0.0.1', port: 9000 }, null)
  })

  it('reports the boot id per answering PC on a broadcast target', () => {
    const { core, onBootId, ping, pong } = bootSetup()
    core.setTargets([{ name: 'all', host: '192.168.1.255', sendPort: 9000, primary: true, broadcast: BROADCAST }])
    ping()
    pong('192.168.1.20', { type: 's', value: 'a' })
    pong('192.168.1.21', { type: 's', value: 'b' })
    expect(onBootId.mock.calls).toEqual([
      [{ name: 'all', host: '192.168.1.20', port: 9000 }, 'a'],
      [{ name: 'all', host: '192.168.1.21', port: 9000 }, 'b'],
    ])
    expect(core.syncTargets({ host: '192.168.1.21' })).toEqual({ ok: true, targets: [{ name: 'all', host: '192.168.1.21', port: 9000 }] })
    expect(core.syncTargets({ host: '192.168.1.99' })).toEqual({ ok: false, reason: 'unknown-host: 192.168.1.99' })
  })

  it('chooses sync targets among the current destinations only', () => {
    const { core } = bootSetup()
    core.setTargets([
      { name: 'main', host: '10.0.0.2', sendPort: 9000, primary: true },
      { name: 'app2', host: '10.0.0.2', sendPort: 9100, primary: false },
    ])
    expect(core.syncTargets({})).toEqual({ ok: true, targets: [{ name: 'main', host: '10.0.0.2', port: 9000 }, { name: 'app2', host: '10.0.0.2', port: 9100 }] })
    expect(core.syncTargets({ target: 'app2' })).toEqual({ ok: true, targets: [{ name: 'app2', host: '10.0.0.2', port: 9100 }] })
    expect(core.syncTargets({ host: '10.0.0.2', port: 9100 })).toEqual({ ok: true, targets: [{ name: 'app2', host: '10.0.0.2', port: 9100 }] })
    expect(core.syncTargets({ target: 'ghost' })).toEqual({ ok: false, reason: 'unknown-target: ghost' })
    expect(core.syncTargets({ host: '10.0.0.9', port: 9000 })).toEqual({ ok: false, reason: 'unknown-host: 10.0.0.9:9000' })
  })

  it('wraps a sync in /sys/sync/begin and /sys/sync/end, and logs it as one resend', () => {
    const { core, sendFn, onSent } = bootSetup()
    sendFn.mockClear()
    core.sendSync({ name: 'unity', host: '127.0.0.1', port: 9000 }, 'manual', () => [{ address: '/mixer/level', args: [{ type: 'f', value: 0.5 }] }])
    expect(sendFn.mock.calls).toEqual([
      ['127.0.0.1', 9000, SYS.SYNC_BEGIN, { type: 's', value: 'manual' }],
      ['127.0.0.1', 9000, '/mixer/level', { type: 'f', value: 0.5 }],
      ['127.0.0.1', 9000, SYS.SYNC_END],
    ])
    expect(onSent).toHaveBeenCalledWith(expect.objectContaining({ origin: 'resend', targets: ['unity'] }))
  })

  it('paces a large sync in steps, takes the current values at each step and ends after the last one', () => {
    const { core, sendFn, timers, runTimers } = bootSetup()
    sendFn.mockClear()
    const values = new Map(Array.from({ length: 70 }, (_, index) => [`/v/${String(index)}`, index]))
    const current = () => [...values].map(([address, value]) => ({ address, args: [{ type: 'i' as const, value }] }))
    core.sendSync({ name: 'unity', host: '127.0.0.1', port: 9000 }, 'boot', current)
    // 1 段目は begin と 32 件だけ。end はまだ送らない
    expect(sendFn.mock.calls.map(call => call[2])).toEqual([SYS.SYNC_BEGIN, ...Array.from({ length: 32 }, (_, index) => `/v/${String(index)}`)])
    expect(timers).toHaveLength(1)
    // 途中で操作された値は、次の段で今の値として送る(始めの古い値にしない)
    values.set('/v/40', 999)
    runTimers()
    const calls = sendFn.mock.calls.map(call => [call[2], call[3]])
    expect(calls.filter(call => call[0] === '/v/40')).toEqual([['/v/40', { type: 'i', value: 999 }]])
    expect(calls.at(-1)).toEqual([SYS.SYNC_END, undefined])
    expect(calls.filter(call => String(call[0]).startsWith('/v/'))).toHaveLength(70)
  })

  it('resends a value changed after an earlier step sent it, so a sync target outside the destinations ends with the current value (HID-502)', () => {
    const { core, sendFn, runTimers } = bootSetup()
    sendFn.mockClear()
    const values = new Map(Array.from({ length: 40 }, (_, index) => [`/v/${String(index)}`, index]))
    const current = () => [...values].map(([address, value]) => ({ address, args: [{ type: 'i' as const, value }] }))
    // 送信先に選んでいない PC(通常の送信は届かない)
    core.sendSync({ name: 'other', host: '10.0.0.77', port: 9000 }, 'manual', current)
    // 1 段目で送った値を、2 段目の前に操作する
    values.set('/v/3', 333)
    runTimers()
    const calls = sendFn.mock.calls.filter(call => call[0] === '10.0.0.77').map(call => [call[2], call[3]])
    expect(calls.filter(call => call[0] === '/v/3')).toEqual([['/v/3', { type: 'i', value: 3 }], ['/v/3', { type: 'i', value: 333 }]])
    // 変わっていない値は送り直さない
    expect(calls.filter(call => call[0] === '/v/4')).toHaveLength(1)
    // 送り直しは end より前
    expect(calls.findIndex(call => call[0] === '/v/3' && (call[1] as { value: number }).value === 333)).toBeLessThan(calls.findIndex(call => call[0] === SYS.SYNC_END))
    expect(calls.at(-1)).toEqual([SYS.SYNC_END, undefined])
  })

  it('does not resend a changed value to a sync target that normal sends already reach (HID-502)', () => {
    const { core, sendFn, runTimers } = bootSetup()
    sendFn.mockClear()
    const values = new Map(Array.from({ length: 40 }, (_, index) => [`/v/${String(index)}`, index]))
    const current = () => [...values].map(([address, value]) => ({ address, args: [{ type: 'i' as const, value }] }))
    // 127.0.0.1:9000 は今の宛先(操作は通常の送信で届く)
    core.sendSync({ name: 'unity', host: '127.0.0.1', port: 9000 }, 'manual', current)
    values.set('/v/3', 333)
    runTimers()
    expect(sendFn.mock.calls.filter(call => call[2] === '/v/3')).toHaveLength(1)
  })

  it('still resends a value changed while the sync target was not a destination after it is added as one (HID-502)', () => {
    const { core, sendFn, timers } = bootSetup()
    sendFn.mockClear()
    const values = new Map(Array.from({ length: 70 }, (_, index) => [`/v/${String(index)}`, index]))
    const current = () => [...values].map(([address, value]) => ({ address, args: [{ type: 'i' as const, value }] }))
    core.sendSync({ name: 'other', host: '10.0.0.77', port: 9000 }, 'manual', current)
    // 宛先でない間の操作は通常の送信で届かない。その後で宛先に足しても、同期で送り直す
    values.set('/v/3', 333)
    core.setTargets([{ name: 'other', host: '10.0.0.77', sendPort: 9000, primary: true }])
    while (timers.length > 0) timers.shift()!()
    expect(sendFn.mock.calls.filter(call => call[2] === '/v/3').map(call => call[3])).toEqual([{ type: 'i', value: 3 }, { type: 'i', value: 333 }])
  })

  it('sends a changed row list before the new unsent cells of the same step (HID-502)', () => {
    const { core, sendFn, timers } = bootSetup()
    sendFn.mockClear()
    let keys = 'a'
    const cells = new Map(Array.from({ length: 40 }, (_, index) => [`/t/a/${String(index)}`, index]))
    const current = () => [
      { address: '/t/keys', args: [{ type: 's' as const, value: keys }] },
      ...[...cells].map(([address, value]) => ({ address, args: [{ type: 'i' as const, value }] })),
    ]
    core.sendSync({ name: 'other', host: '10.0.0.77', port: 9000 }, 'manual', current)
    keys = 'a,b'
    cells.set('/t/b/0', 1)
    timers.shift()!()
    const order = sendFn.mock.calls.map(call => call[2])
    expect(order.lastIndexOf('/t/keys')).toBeLessThan(order.indexOf('/t/b/0'))
  })

  it('still ends a sync whose values keep changing faster than it can resend them (HID-502)', () => {
    const { core, sendFn, logWarn, timers } = bootSetup()
    sendFn.mockClear()
    let round = 0
    const current = () => Array.from({ length: 100 }, (_, index) => ({ address: `/v/${String(index)}`, args: [{ type: 'i' as const, value: index + round * 1000 }] }))
    const done = vi.fn()
    core.sendSync({ name: 'other', host: '10.0.0.77', port: 9000 }, 'manual', current, done)
    // 段ごとに 100 件すべてが変わる
    for (let guard = 0; guard < 100 && timers.length > 0; guard += 1) {
      round += 1
      timers.shift()!()
    }
    expect(done).toHaveBeenCalledTimes(1)
    expect(sendFn.mock.calls.at(-1)?.[2]).toBe(SYS.SYNC_END)
    // 1 巡目(100 件を段の半分までの送り直しと並べて)の後、送り直しだけの段は MAX_SYNC_RESEND_STEPS まで
    const steps = sendFn.mock.calls.filter(call => call[2] === '/v/0').length
    expect(round).toBeLessThanOrEqual(Math.ceil(100 / (SYNC_MESSAGES_PER_STEP / 2)) + MAX_SYNC_RESEND_STEPS)
    expect(steps).toBeGreaterThan(1)
    expect(logWarn).toHaveBeenCalledWith('(WARN, BRIDGE)', expect.stringContaining('ended while values were still changing'))
  })

  it('reports completion only after the end of a sync, not when it is cut off or the bridge stops (HID-499)', () => {
    const { core, runTimers } = bootSetup()
    const many = () => Array.from({ length: 40 }, (_, index) => ({ address: `/v/${String(index)}`, args: [{ type: 'i' as const, value: index }] }))
    const to = { name: 'unity', host: '127.0.0.1', port: 9000 }
    const done = vi.fn()
    core.sendSync(to, 'boot', many, done)
    // 2 段に分かれるので、1 段目の後ではまだ知らせない
    expect(done).not.toHaveBeenCalled()
    runTimers()
    expect(done).toHaveBeenCalledTimes(1)
    // パッドの採用が変わって打ち切られた同期は、送り終えていない
    let live = true
    const cut = vi.fn()
    core.sendSync(to, 'boot', () => live ? many() : null, cut)
    live = false
    runTimers()
    expect(cut).not.toHaveBeenCalled()
    // 途中でブリッジを止めた同期も、送り終えていない
    const stopped = vi.fn()
    core.sendSync(to, 'boot', many, stopped)
    core.stop()
    runTimers()
    expect(stopped).not.toHaveBeenCalled()
  })

  it('drops the rest of a sync when a newer sync to the same PC starts', () => {
    const { core, sendFn, runTimers } = bootSetup()
    sendFn.mockClear()
    const many = () => Array.from({ length: 40 }, (_, index) => ({ address: `/v/${String(index)}`, args: [{ type: 'i' as const, value: index }] }))
    const to = { name: 'unity', host: '127.0.0.1', port: 9000 }
    const completed: string[] = []
    core.sendSync(to, 'boot', many, () => completed.push('boot'))
    core.sendSync(to, 'manual', many, () => completed.push('manual'))
    runTimers()
    // 送り終えたと知らせるのは end を送った新しい同期だけ(HID-499)
    expect(completed).toEqual(['manual'])
    const addresses = sendFn.mock.calls.map(call => call[2])
    // 古い同期は 1 段目のあと止まり、end は新しい同期の 1 回だけ
    expect(addresses.filter(address => address === SYS.SYNC_BEGIN)).toHaveLength(2)
    expect(addresses.filter(address => address === SYS.SYNC_END)).toHaveLength(1)
    expect(addresses.filter(address => address === '/v/39')).toHaveLength(1)
  })

  describe('syncs that overlap through a broadcast destination (HID-498)', () => {
    const many = () => Array.from({ length: 40 }, (_, index) => ({ address: `/v/${String(index)}`, args: [{ type: 'i' as const, value: index }] }))
    const wide = { name: 'all', host: '192.168.1.255', port: 9000 }
    const pc = { name: 'all', host: '192.168.1.20', port: 9000 }
    const broadcastSetup = () => {
      const setup = bootSetup()
      setup.core.setTargets([{ name: 'all', host: '192.168.1.255', sendPort: 9000, primary: true, broadcast: BROADCAST }])
      setup.ping()
      setup.pong('192.168.1.20')
      setup.sendFn.mockClear()
      // 宛先ごとの [契機の印, アドレス] の並び。値は /v/ だけを数える
      const sequence = () => setup.sendFn.mock.calls
        .filter(call => call[2] === SYS.SYNC_BEGIN || call[2] === SYS.SYNC_END || String(call[2]).startsWith('/v/'))
        .map(call => `${String(call[0])}:${String(call[1])} ${String(call[2])}${call[2] === SYS.SYNC_BEGIN ? ` ${String((call[3] as { value: string }).value)}` : ''}`)
      return { ...setup, sequence }
    }

    it('starts a sync to one PC only after the broadcast sync that reaches it has ended', () => {
      const { core, runTimers, sequence } = broadcastSetup()
      core.sendSync(wide, 'manual', many)
      core.sendSync(pc, 'boot', many)
      // 個別の同期は、ブロードキャストの同期の 1 段目の途中では始めない
      expect(sequence().some(line => line.startsWith('192.168.1.20:'))).toBe(false)
      runTimers()
      const lines = sequence()
      const wideLines = lines.filter(line => line.startsWith('192.168.1.255:9000 '))
      const pcLines = lines.filter(line => line.startsWith('192.168.1.20:9000 '))
      // ブロードキャストの同期は打ち切られずに最後まで届き、その後に個別の同期が begin から end まで続く
      expect(wideLines).toHaveLength(42)
      expect(wideLines.at(-1)).toBe(`192.168.1.255:9000 ${SYS.SYNC_END}`)
      expect(pcLines).toHaveLength(42)
      expect(pcLines[0]).toBe(`192.168.1.20:9000 ${SYS.SYNC_BEGIN} boot`)
      expect(lines.indexOf(pcLines[0]!)).toBeGreaterThan(lines.indexOf(wideLines.at(-1)!))
    })

    it('waits only for the latest sync requested to the same PC behind a broadcast sync', () => {
      const { core, runTimers, sequence } = broadcastSetup()
      core.sendSync(wide, 'manual', many)
      core.sendSync(pc, 'boot', many)
      core.sendSync(pc, 'manual', many)
      runTimers()
      const begins = sequence().filter(line => line.startsWith('192.168.1.20:9000 ') && line.includes(SYS.SYNC_BEGIN))
      expect(begins).toEqual([`192.168.1.20:9000 ${SYS.SYNC_BEGIN} manual`])
    })

    it('drops the rest of a sync to one PC when a broadcast sync that reaches it starts', () => {
      const { core, runTimers, sequence } = broadcastSetup()
      core.sendSync(pc, 'boot', many)
      core.sendSync(wide, 'manual', many)
      runTimers()
      const lines = sequence()
      const pcLines = lines.filter(line => line.startsWith('192.168.1.20:9000 '))
      // 個別の同期は 1 段目(begin と 32 件)で止まり、end は送らない(ブロードキャストの begin で区切り直される)
      expect(pcLines).toHaveLength(33)
      expect(pcLines.some(line => line.includes(SYS.SYNC_END))).toBe(false)
      expect(lines.filter(line => line.startsWith('192.168.1.255:9000 '))).toHaveLength(42)
    })

    it('stops an older sync to the PC when a newer one has to wait behind a broadcast sync', () => {
      const { core, runTimers, sequence } = broadcastSetup()
      // ブロードキャストの同期が届く PC と分かる前(pong の前)に始まった個別の同期は打ち切られずに残る
      core.sendSync({ name: 'all', host: '192.168.1.30', port: 9000 }, 'boot', many)
      core.setTargets([{ name: 'all', host: '192.168.1.255', sendPort: 9000, primary: true, broadcast: { networkInt: ipv4ToInt('192.168.2.0')!, maskInt: maskOf(24) } }])
      core.sendSync(wide, 'manual', many)
      core.setTargets([{ name: 'all', host: '192.168.1.255', sendPort: 9000, primary: true, broadcast: BROADCAST }])
      core.sendSync({ name: 'all', host: '192.168.1.30', port: 9000 }, 'manual', many)
      runTimers()
      const pcLines = sequence().filter(line => line.startsWith('192.168.1.30:9000 '))
      // 古い同期は 1 段目で止まり、新しい同期はブロードキャストの同期の後に begin から end まで届く
      expect(pcLines.filter(line => line.includes(SYS.SYNC_BEGIN))).toEqual([`192.168.1.30:9000 ${SYS.SYNC_BEGIN} boot`, `192.168.1.30:9000 ${SYS.SYNC_BEGIN} manual`])
      expect(pcLines.filter(line => line.includes(SYS.SYNC_END))).toHaveLength(1)
      expect(pcLines).toHaveLength(33 + 42)
    })

    it('lets the waiting syncs start when a broadcast sync throws part-way', () => {
      const { core, runTimers, sequence } = broadcastSetup()
      let calls = 0
      const failing = () => {
        calls += 1
        if (calls > 1) throw new Error('boom')
        return many()
      }
      core.sendSync(wide, 'manual', failing)
      core.sendSync(pc, 'boot', many)
      expect(() => runTimers()).toThrow('boom')
      runTimers()
      expect(sequence().filter(line => line.startsWith('192.168.1.20:9000 '))).toHaveLength(42)
    })

    it('leaves a sync to one PC running when a waiting broadcast sync turns out to have nothing to send', () => {
      const { core, runTimers, sequence } = broadcastSetup()
      // 別のサブネットの同じポートのブロードキャスト(A が先、B は A の後に待つ)
      core.setTargets([
        { name: 'all', host: '192.168.1.255', sendPort: 9000, primary: true, broadcast: BROADCAST },
        { name: 'other', host: '192.168.2.255', sendPort: 9000, primary: false, broadcast: { networkInt: ipv4ToInt('192.168.2.0')!, maskInt: maskOf(24) } },
      ])
      let adopted = true
      const oldPad = () => adopted ? many() : null
      core.sendSync(wide, 'manual', oldPad)
      core.sendSync({ name: 'other', host: '192.168.2.255', port: 9000 }, 'manual', oldPad)
      // パッドの採用が変わり、新しいパッドを B のサブネットの PC へ(A とは重ならないのですぐに始まる)
      adopted = false
      core.sendSync({ name: 'other', host: '192.168.2.20', port: 9000 }, 'manual', many)
      runTimers()
      const pcLines = sequence().filter(line => line.startsWith('192.168.2.20:9000 '))
      // B は何も送らずに終わるので、個別の同期を止めない
      expect(pcLines).toHaveLength(42)
      expect(sequence().some(line => line.startsWith('192.168.2.255:'))).toBe(false)
    })

    it('lets a broadcast sync wait for a sync to a PC on a narrower overlapping network instead of cutting it off', () => {
      const { core, runTimers, sequence } = broadcastSetup()
      // /8 の VPN のブロードキャストは、/24 の LAN の PC には届かないかもしれない(OS は狭い方の経路で送る。HID-325)
      core.setTargets([
        { name: 'vpn', host: '10.255.255.255', sendPort: 9000, primary: true, broadcast: { networkInt: ipv4ToInt('10.0.0.0')!, maskInt: maskOf(8) } },
        { name: 'lan-pc', host: '10.1.2.50', sendPort: 9000, primary: false },
      ])
      core.sendSync({ name: 'lan-pc', host: '10.1.2.50', port: 9000 }, 'manual', many)
      core.sendSync({ name: 'vpn', host: '10.255.255.255', port: 9000 }, 'manual', many)
      runTimers()
      const lines = sequence()
      const pcLines = lines.filter(line => line.startsWith('10.1.2.50:9000 '))
      const wideLines = lines.filter(line => line.startsWith('10.255.255.255:9000 '))
      // 個別の同期は最後まで届き、ブロードキャストの同期はその end の後に始まる
      expect(pcLines).toHaveLength(42)
      expect(wideLines).toHaveLength(42)
      expect(lines.indexOf(wideLines[0]!)).toBeGreaterThan(lines.indexOf(pcLines.at(-1)!))
    })

    it('keeps a waiting broadcast sync a broadcast after its destination is renamed', () => {
      const { core, timers, runTimers, sequence } = broadcastSetup()
      const netB = { networkInt: ipv4ToInt('192.168.2.0')!, maskInt: maskOf(24) }
      core.setTargets([
        { name: 'all-devices', host: '192.168.1.255', sendPort: 9000, primary: true, broadcast: BROADCAST },
        { name: 'all-devices-2', host: '192.168.2.255', sendPort: 9000, primary: false, broadcast: netB },
      ])
      core.sendSync({ name: 'all-devices', host: '192.168.1.255', port: 9000 }, 'manual', many)
      core.sendSync({ name: 'all-devices-2', host: '192.168.2.255', port: 9000 }, 'manual', many)
      // 宛先タブでネットワークの選択に切り替えると、送り先は同じまま名前だけが変わる
      core.setTargets([
        { name: 'net-a', host: '192.168.1.255', sendPort: 9000, primary: true, broadcast: BROADCAST },
        { name: 'net-b', host: '192.168.2.255', sendPort: 9000, primary: false, broadcast: netB },
      ])
      // A の 2 段目で A が終わり、待っていた B が始まる。B の途中で A をもう一度頼むと、B の end の後に始まる
      timers.shift()!()
      expect(sequence().filter(line => line.startsWith('192.168.2.255:9000 '))).toHaveLength(33)
      core.sendSync({ name: 'net-a', host: '192.168.1.255', port: 9000 }, 'manual', many)
      runTimers()
      const lines = sequence().filter(line => line.includes(SYS.SYNC_BEGIN) || line.includes(SYS.SYNC_END))
      // どの時点でも進行中の同期は 1 つだけ(begin と end が交互に並ぶ)
      lines.forEach((line, index) => expect(line.includes(index % 2 === 0 ? SYS.SYNC_BEGIN : SYS.SYNC_END)).toBe(true))
    })

    it('drops a waiting broadcast sync whose destination was deselected while it waited', () => {
      const { core, runTimers, sequence } = broadcastSetup()
      const netB = { networkInt: ipv4ToInt('192.168.2.0')!, maskInt: maskOf(24) }
      core.setTargets([
        { name: 'net-a', host: '192.168.1.255', sendPort: 9000, primary: true, broadcast: BROADCAST },
        { name: 'net-b', host: '192.168.2.255', sendPort: 9000, primary: false, broadcast: netB },
      ])
      core.sendSync({ name: 'net-a', host: '192.168.1.255', port: 9000 }, 'manual', many)
      core.sendSync({ name: 'net-b', host: '192.168.2.255', port: 9000 }, 'manual', many)
      // B を選択から外す。A が終わっても B は始まらない
      core.setTargets([{ name: 'net-a', host: '192.168.1.255', sendPort: 9000, primary: true, broadcast: BROADCAST }])
      runTimers()
      core.sendSync({ name: 'net-a', host: '192.168.1.255', port: 9000 }, 'manual', many)
      runTimers()
      expect(sequence().some(line => line.startsWith('192.168.2.255:'))).toBe(false)
      expect(sequence().filter(line => line.startsWith('192.168.1.255:9000 '))).toHaveLength(84)
    })

    it('keeps a sync to another port of the PC running beside the broadcast sync', () => {
      const { core, runTimers, sequence } = broadcastSetup()
      core.sendSync(wide, 'manual', many)
      core.sendSync({ name: 'all', host: '192.168.1.20', port: 9100 }, 'manual', many)
      // ポートが違えば重ならないので、すぐに始める
      expect(sequence().filter(line => line.startsWith('192.168.1.20:9100 '))).toHaveLength(33)
      runTimers()
      expect(sequence().filter(line => line.startsWith('192.168.1.20:9100 '))).toHaveLength(42)
    })
  })

  it('maps an OSCQuery endpoint to the answering destination with the pong key, and to nothing otherwise', () => {
    const { core, ping, pong } = bootSetup()
    // まだ答えていない宛先へは引かない(pong に任せる)
    expect(core.answeringSyncTarget('127.0.0.1', 9000)).toBeNull()
    ping()
    pong('127.0.0.1')
    expect(core.answeringSyncTarget('127.0.0.1', 9000)).toEqual({ name: 'unity', host: '127.0.0.1', port: 9000 })
    expect(core.answeringSyncTarget('127.0.0.1', 9100)).toBeNull()
    // 喪失中は引かない(回復の pong に任せる)
    ping()
    ping()
    expect(core.answeringSyncTarget('127.0.0.1', 9000)).toBeNull()

    core.setTargets([{ name: 'all', host: '192.168.1.255', sendPort: 9000, primary: true, broadcast: BROADCAST }])
    expect(core.answeringSyncTarget('192.168.1.20', 9000)).toBeNull()
    ping()
    pong('192.168.1.20')
    expect(core.answeringSyncTarget('192.168.1.20', 9000)).toEqual({ name: 'all', host: '192.168.1.20', port: 9000 })
  })
})

describe('pad locks on raw OSC routes (D-169)', () => {
  it('refuses osc.message and osc.batch on an address a pad widget lock covers', () => {
    const sendFn = vi.fn()
    const sendBundleFn = vi.fn(() => ({ ok: true as const, bytes: 0, messageCount: 0 }))
    const publish = vi.fn<(frame: DownstreamFrame, target?: string) => void>()
    const core = createSurfaceCore({
      config: CONFIG, sendFn, sendBundleFn, publish, logInfo: vi.fn(), logWarn: vi.fn(),
      padLockRefs: address => address === '/light/level' ? [{ widget: 'level' }] : [],
      lockedBy: refs => refs.some(ref => 'widget' in ref) ? 'other' : null,
    })
    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/light/level', args: [{ type: 'f', value: 0.1 }] }, 'ui-1')
    core.handleUiFrame({ v: 1, type: 'osc.batch', messages: [{ address: '/light/level', args: [{ type: 'f', value: 0.1 }] }] }, 'ui-1')
    expect(sendFn.mock.calls.filter(call => call[2] === '/light/level')).toEqual([])
    expect(sendBundleFn).not.toHaveBeenCalled()
    const codes = publish.mock.calls.flatMap(([frame]) => frame.type === 'notice' ? [`${frame.code}: ${frame.detail}`] : [])
    expect(codes).toEqual(['locked: locked: level by other', 'batch-rejected: locked: level by other'])
    expect(core.lockRefsOf('/light/level', [])).toEqual([{ widget: 'level' }])
  })
})

describe('sync interrupted by a pad change (D-169)', () => {
  it('stops a sync without the end signal when the pad behind it changes', () => {
    const timers: (() => void)[] = []
    const sendFn = vi.fn()
    const core = createSurfaceCore({ config: CONFIG, sendFn, publish: vi.fn(), logInfo: vi.fn(), logWarn: vi.fn(), setTimeoutFn: callback => { timers.push(callback) } })
    let adopted = true
    const many = () => adopted ? Array.from({ length: 40 }, (_, index) => ({ address: `/v/${String(index)}`, args: [{ type: 'i' as const, value: index }] })) : null
    core.sendSync({ name: 'unity', host: '127.0.0.1', port: 9000 }, 'manual', many)
    adopted = false
    while (timers.length > 0) timers.shift()!()
    const addresses = sendFn.mock.calls.map(call => call[2])
    expect(addresses.filter(address => address === SYS.SYNC_END)).toEqual([])
    expect(addresses.filter(address => String(address).startsWith('/v/'))).toHaveLength(32)
  })
})