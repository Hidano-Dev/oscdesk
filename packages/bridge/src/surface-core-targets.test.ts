import { describe, expect, it, vi } from 'vitest'

import { SYS, type DownstreamFrame } from '@oscdesk/shared'

import { ipv4ToInt, maskOf } from './ipv4'
import { createSurfaceCore, type BridgeConfig } from './surface-core'

// 宛先の差し替え(宛先タブ。D-078)とブロードキャストの宛先(D-079)。

const CONFIG: BridgeConfig = {
  unity: { name: 'unity', host: '127.0.0.1', sendPort: 9000, secondary: [] },
  bridge: { oscListenHost: '0.0.0.0', oscListenPort: 9001, wsHost: '0.0.0.0', wsPort: 8080 },
  ui: { host: '0.0.0.0', port: 8080 },
  debug: false,
  boolFallbackToInt: false,
  diagnostics: { ringBufferSize: 200, lossRateWindow: 30, ndjsonDir: 'logs/diagnostics', ndjsonMaxTotalBytes: 52_428_800 },
  oscUi: { enabled: false, staticPeers: [], peerTtlMs: 0 },
  surfaces: { dir: 'surfaces' },
  destinations: { scanTimeoutMs: 8_000 },
}

const DEFINITION = {
  format: 'oscdesk-surface' as const,
  version: 1 as const,
  name: 'T',
  parameters: [{ id: 'level', address: '/light/level', label: 'Level', type: 'f' as const, kind: 'state' as const, default: 0.5 }],
  screens: [],
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
  core.setDefinition(DEFINITION)
  core.handleUiFrame({ v: 1, type: 'osc.message', address: '/light/level', args: [{ type: 'f', value: 0.9 }] }, 'ui-1')
  let seq = 0
  const ping = () => { clock += 2_000; tick?.(); seq += core.currentTargets().length }
  // seq は全宛先で一意に振られる(1 周で宛先の数だけ進む)。index は今の周回での宛先の位置
  const pong = (host: string, port = 9000, index = 0) =>
    core.handleOscIn({ address: SYS.PONG, args: [{ type: 'i', value: seq - core.currentTargets().length + 1 + index }], from: { host, port } })
  const levelSends = () => sendFn.mock.calls.filter(call => call[2] === '/light/level').map(call => `${String(call[0])}:${String(call[1])}`)
  return { core, sendFn, publish, onRespondersChanged, ping, pong, levelSends }
}

describe('setTargets (D-078)', () => {
  it('sends UI operations only to the new targets and resends the held values on their first pong', () => {
    const { core, sendFn, publish, ping, pong, levelSends } = setup()
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

    // 新しく加わった宛先は初回の pong で保持値を受け取る(初回到達)
    sendFn.mockClear()
    ping()
    pong('10.0.0.3', 9000, 0)
    expect(levelSends()).toEqual(['10.0.0.3:9000'])
  })

  it('keeps the link state of an unchanged target, so it is not treated as first reachable again', () => {
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
    // 初回到達として保持値が送られ、到達可能になる
    expect(levelSends()).toEqual(['192.168.1.10:9002'])
    expect(core.linkSnapshot().unity.reachability).toBe('reachable')
    // ループバックからのエコーは主系のエコーで、UI もこの出所を Unity とみなせる
    expect(core.primaryHosts()).toEqual(['192.168.1.10', '127.0.0.1'])
    publish.mockClear()
    core.handleOscIn({ address: '/light/level', args: [{ type: 'f', value: 0.9 }], from: { host: '127.0.0.1', port: 9002 } })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'osc.message', from: { host: '127.0.0.1', port: 9002 } }))
  })

  it('republishes the option lists when the targets change, and forgets a list of a reused name', () => {
    const { core, publish } = setup()
    core.setDefinition({
      ...DEFINITION,
      parameters: [...DEFINITION.parameters, {
        id: 'segment', address: '/member/segment', label: 'Segment', type: 's' as const, kind: 'state' as const,
        options: ['(none)'], default: '(none)', optionsFrom: { address: '/mb/segments' },
      }],
    })
    const choices = () => {
      const frame = publish.mock.calls.map(call => call[0]).filter(candidate => candidate.type === 'runtimeOptions').at(-1)
      return frame?.type === 'runtimeOptions' ? frame.choices[0]?.options : undefined
    }
    core.handleOscIn({ address: '/mb/segments', args: [{ type: 's', value: 'Intro' }], from: { host: '127.0.0.1', port: 9000 } })
    expect(choices()).toEqual(['(none)', 'Intro'])

    // 一覧を返していない宛先へ差し替えると、旧宛先の候補を残さずに配り直す
    core.setTargets([{ name: 'ip-10-0-0-2', host: '10.0.0.2', sendPort: 9000, primary: true }])
    expect(choices()).toEqual(['(none)'])

    // 旧宛先に戻すと、名前が同じでも別の宛先として扱い、以前の一覧は引き継がない
    core.setTargets([{ name: 'unity', host: '127.0.0.1', sendPort: 9000, primary: true }])
    expect(choices()).toEqual(['(none)'])
    publish.mockClear()
    // 変わらない差し替えでは配り直さない
    core.setTargets([{ name: 'unity', host: '127.0.0.1', sendPort: 9000, primary: true }])
    expect(publish.mock.calls.some(call => call[0].type === 'runtimeOptions')).toBe(false)
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

  it('accepts pongs from any host of the network and resends to each new responder by unicast', () => {
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

    expect(levelSends()).toEqual(['192.168.1.20:9000', '192.168.1.21:9000', '127.0.0.1:9000'])
    expect(core.primaryHosts()).toEqual(['192.168.1.255', '192.168.1.20', '192.168.1.21', '127.0.0.1'])
    expect(onRespondersChanged).toHaveBeenCalledTimes(3)
    expect(core.linkSnapshot().unity.reachability).toBe('reachable')

    // 答え続けているホストへは再送しない。1 周取りこぼして戻ったホストへだけ再送する
    sendFn.mockClear()
    ping(); pong('192.168.1.20'); pong('192.168.1.21'); pong('127.0.0.1')
    ping(); pong('192.168.1.20'); pong('127.0.0.1')
    ping(); pong('192.168.1.20'); pong('192.168.1.21'); pong('127.0.0.1')
    expect(levelSends()).toEqual(['192.168.1.21:9000'])
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

  it('accepts pongs from this PC\'s other NIC addresses given in addresses, and resends there by unicast (D-085)', () => {
    // 同じ PC の Unity が返信先をこの PC の別の NIC(10.0.0.5)にしていると、ネットワークの外のアドレスから答える
    const { core, ping, pong, levelSends, sendFn } = setup()
    core.setTargets([{ ...broadcastTarget, addresses: ['192.168.1.10', '10.0.0.5'] }])
    sendFn.mockClear()
    ping()
    pong('10.0.0.5')
    pong('10.0.0.6')
    expect(levelSends()).toEqual(['10.0.0.5:9000'])
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
