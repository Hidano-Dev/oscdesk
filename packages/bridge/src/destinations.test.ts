import { describe, expect, it, vi } from 'vitest'

import type { DownstreamFrame } from '@oscdesk/shared'

import type { DestinationSelection, DestinationSelectionStore } from './destinations-file'
import {
  createDestinations,
  isSelectableHost,
  listDevices,
  resolveDestinationTargets,
  type ConfigTarget,
} from './destinations'
import { scanSubnets, type LanProber, type Neighbor, type ScanInterface } from './lan-scan'
import type { RuntimeTargetSpec } from './surface-core'

const CONFIG_TARGETS: ConfigTarget[] = [
  { name: 'unity', host: '192.168.1.20', sendPort: 7090, primary: true, addresses: [] },
  { name: 'backup', host: 'stage-pc', sendPort: 7092, primary: false, addresses: ['192.168.1.30'] },
]
const NIC: ScanInterface = { name: 'Ethernet', address: '192.168.1.10', netmask: '255.255.255.0', family: 'IPv4', internal: false }
const SUBNETS = scanSubnets([NIC])

describe('resolveDestinationTargets', () => {
  const resolve = (selection: DestinationSelection | null, subnets = SUBNETS) =>
    resolveDestinationTargets({ selection, configTargets: CONFIG_TARGETS, subnets, sendPort: 7090 })

  it('uses the config targets while nothing is saved', () => {
    expect(resolve(null)).toEqual(CONFIG_TARGETS)
  })

  it('maps scanned hosts to ip-* targets on unity.sendPort and keeps config targets as they are', () => {
    expect(resolve({ allDevices: false, hosts: ['192.168.1.40', 'stage-pc'] })).toEqual([
      { name: 'ip-192-168-1-40', host: '192.168.1.40', sendPort: 7090, primary: true },
      { ...CONFIG_TARGETS[1], primary: false },
    ])
    // 設定の主系が選ばれていれば、選択の順にかかわらずそれが主系
    expect(resolve({ allDevices: false, hosts: ['192.168.1.40', '192.168.1.20'] })?.find(target => target.primary)?.name).toBe('unity')
    // この PC のアドレスは、ループバックから返る pong・エコーも受ける
    expect(resolve({ allDevices: false, hosts: ['192.168.1.10'] })).toEqual([
      { name: 'ip-192-168-1-10', host: '192.168.1.10', sendPort: 7090, primary: true, addresses: ['127.0.0.1'] },
    ])
  })

  it('sends to the broadcast address of each network for all devices, and gives up without a network', () => {
    expect(resolve({ allDevices: true, hosts: ['192.168.1.40'] })).toEqual([
      expect.objectContaining({ name: 'all-devices', host: '192.168.1.255', sendPort: 7090, primary: true, broadcast: { networkInt: SUBNETS[0]!.networkInt, maskInt: SUBNETS[0]!.maskInt } }),
    ])
    expect(resolve({ allDevices: true, hosts: [] }, [])).toBeNull()
    expect(resolve({ allDevices: false, hosts: ['not-a-config-host'] })).toBeNull()
  })

  it('accepts only config hosts and unicast addresses inside the local networks', () => {
    expect(isSelectableHost('192.168.1.40', CONFIG_TARGETS, SUBNETS)).toBe(true)
    expect(isSelectableHost('192.168.1.10', CONFIG_TARGETS, SUBNETS)).toBe(true) // この PC
    expect(isSelectableHost('stage-pc', CONFIG_TARGETS, SUBNETS)).toBe(true) // 設定の宛先
    for (const host of ['192.168.1.0', '192.168.1.255', '8.8.8.8', '127.0.0.5', '10.0.0.255', '224.0.0.1', '192.168.2.10']) {
      expect(isSelectableHost(host, CONFIG_TARGETS, SUBNETS), host).toBe(false)
    }
    // 非正規の表記(先頭ゼロ)は、ブロードキャストアドレスを言い換えたものも、ふつうの端末のものも受けない
    for (const host of ['192.168.001.255', '192.168.1.040', '192.168.01.40', '192.168.1.00']) {
      expect(isSelectableHost(host, CONFIG_TARGETS, SUBNETS), host).toBe(false)
    }
    // ネットワークが無ければ設定の宛先しか選べない
    expect(isSelectableHost('192.168.1.40', CONFIG_TARGETS, [])).toBe(false)
    expect(resolve({ allDevices: false, hosts: ['192.168.1.255'] })).toBeNull()
  })
})

describe('listDevices', () => {
  it('merges found devices, this PC, config targets and selected hosts in IP order', () => {
    const devices = listDevices({
      neighbors: [{ host: '192.168.1.40', mac: 'aa:bb:cc:dd:ee:28' }, { host: '192.168.1.5', mac: 'aa:bb:cc:dd:ee:05' }],
      subnets: SUBNETS,
      configTargets: CONFIG_TARGETS,
      selectedHosts: ['192.168.1.99'],
    })
    expect(devices.map(device => device.host)).toEqual(['192.168.1.5', '192.168.1.10', '192.168.1.20', '192.168.1.40', '192.168.1.99', 'stage-pc'])
    expect(devices.find(device => device.host === '192.168.1.10')).toMatchObject({ self: true, found: true, interface: 'Ethernet' })
    expect(devices.find(device => device.host === '192.168.1.20')).toMatchObject({ configured: true, found: false })
    expect(devices.find(device => device.host === '192.168.1.99')).toMatchObject({ configured: false, found: false })
    expect(devices.find(device => device.host === 'stage-pc')).toMatchObject({ interface: null })
  })
})

function memoryStore(initial: DestinationSelection | null = null, writable = true): DestinationSelectionStore & { saved: DestinationSelection | null } {
  const store = {
    file: 'destinations.json',
    saved: initial,
    load: () => store.saved,
    save: (selection: DestinationSelection) => {
      if (writable) store.saved = { ...selection, hosts: [...selection.hosts] }
      return writable
    },
    clear: () => {
      if (writable) store.saved = null
      return writable
    },
  }
  return store
}

function setup(options: { store?: ReturnType<typeof memoryStore>; probe?: LanProber['probe']; interfaces?: ScanInterface[] } = {}) {
  const store = options.store ?? memoryStore()
  const applied: (readonly RuntimeTargetSpec[])[] = []
  let current: readonly RuntimeTargetSpec[] = CONFIG_TARGETS
  const publish = vi.fn<(frame: DownstreamFrame, clientId?: string) => void>()
  const probe = vi.fn(options.probe ?? (async (): Promise<readonly Neighbor[]> => [{ host: '192.168.1.40', mac: 'aa:bb:cc:dd:ee:28' }]))
  const destinations = createDestinations({
    configTargets: CONFIG_TARGETS,
    sendPort: 7090,
    interfaces: () => options.interfaces ?? [NIC],
    prober: { probe },
    store,
    scanTimeoutMs: 1_000,
    applyTargets: targets => { applied.push(targets); current = targets },
    currentTargets: () => current.map(target => ({ ...target, broadcast: target.broadcast ?? null })),
    primaryHosts: () => current.filter(target => target.primary).map(target => target.host),
    publish,
    now: () => Date.parse('2026-10-18T10:00:00.000Z'),
    logInfo: vi.fn(),
    logWarn: vi.fn(),
  })
  const lastFrame = () => publish.mock.calls.map(call => call[0]).filter(frame => frame.type === 'destinations').at(-1) as Extract<DownstreamFrame, { type: 'destinations' }>
  return { destinations, store, applied, publish, probe, lastFrame }
}

describe('createDestinations', () => {
  it('does not scan on start, and lists the scan result with the config selection', async () => {
    const { destinations, lastFrame, applied, probe, publish } = setup()
    destinations.start()
    expect(probe).not.toHaveBeenCalled()
    destinations.publish('ui-1')
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ scanning: false, scannedAt: null }), 'ui-1')
    destinations.handleUiFrame({ v: 1, type: 'destinationsScan' }, 'ui-1')
    expect(lastFrame()).toMatchObject({ scanning: true, scannedAt: null })
    await destinations.scan()
    expect(applied).toEqual([])
    expect(lastFrame()).toMatchObject({
      type: 'destinations', sendPort: 7090, scanning: false, scannedAt: '2026-10-18T10:00:00.000Z',
      broadcasts: [{ address: '192.168.1.255', interface: 'Ethernet', network: '192.168.1.0/24' }],
      selection: { source: 'config', allDevices: false, hosts: ['192.168.1.20', 'stage-pc'] },
      targets: [{ name: 'unity', primary: true, broadcast: false }, { name: 'backup', primary: false, broadcast: false }],
    })
    expect(lastFrame().devices.map(device => device.host)).toContain('192.168.1.40')
  })

  it('applies and saves a selection, and restores it on the next start', async () => {
    const first = setup()
    first.destinations.start()
    await first.destinations.scan()
    expect(first.destinations.handleUiFrame({ v: 1, type: 'destinationsSelect', allDevices: false, hosts: ['192.168.1.40'] }, 'ui-1')).toBe(true)
    expect(first.applied.at(-1)).toEqual([{ name: 'ip-192-168-1-40', host: '192.168.1.40', sendPort: 7090, primary: true }])
    expect(first.store.saved).toEqual({ allDevices: false, hosts: ['192.168.1.40'] })
    expect(first.lastFrame()).toMatchObject({ selection: { source: 'saved', allDevices: false, hosts: ['192.168.1.40'] } })

    const second = setup({ store: first.store })
    second.destinations.start()
    expect(second.applied[0]).toEqual([{ name: 'ip-192-168-1-40', host: '192.168.1.40', sendPort: 7090, primary: true }])
  })

  it('switches to the broadcast target for all devices and keeps the individual hosts for later', async () => {
    const { destinations, applied, store } = setup()
    destinations.start()
    await destinations.scan()
    destinations.handleUiFrame({ v: 1, type: 'destinationsSelect', allDevices: true, hosts: ['192.168.1.40'] }, 'ui-1')
    expect(applied.at(-1)).toEqual([expect.objectContaining({ name: 'all-devices', host: '192.168.1.255', primary: true })])
    expect(store.saved).toEqual({ allDevices: true, hosts: ['192.168.1.40'] })
  })

  it('rejects invalid selections with a notice and re-sends the current state to the requester', async () => {
    const { destinations, publish, applied } = setup({ interfaces: [] })
    destinations.start()
    await destinations.scan()
    publish.mockClear()
    destinations.handleUiFrame({ v: 1, type: 'destinationsSelect', allDevices: false, hosts: [] }, 'ui-1')
    destinations.handleUiFrame({ v: 1, type: 'destinationsSelect', allDevices: false, hosts: ['evil.example.com'] }, 'ui-1')
    destinations.handleUiFrame({ v: 1, type: 'destinationsSelect', allDevices: true, hosts: [] }, 'ui-1')
    const notices = publish.mock.calls.filter(call => call[0].type === 'notice').map(call => [call[0], call[1]])
    expect(notices).toEqual([
      [expect.objectContaining({ code: 'destinations-rejected', detail: 'empty-selection' }), 'ui-1'],
      [expect.objectContaining({ code: 'destinations-rejected', detail: 'invalid-host: evil.example.com' }), 'ui-1'],
      [expect.objectContaining({ code: 'destinations-rejected', detail: 'no-broadcast-network' }), 'ui-1'],
    ])
    expect(publish.mock.calls.filter(call => call[0].type === 'destinations').every(call => call[1] === 'ui-1')).toBe(true)
    expect(applied).toEqual([])
  })

  it('rejects network, broadcast and outside addresses as individual hosts', async () => {
    const { destinations, publish, applied } = setup()
    destinations.start()
    for (const host of ['192.168.1.0', '192.168.1.255', '8.8.8.8', '127.0.0.5']) {
      destinations.handleUiFrame({ v: 1, type: 'destinationsSelect', allDevices: false, hosts: ['192.168.1.40', host] }, 'ui-1')
      expect(publish).toHaveBeenCalledWith(expect.objectContaining({ code: 'destinations-rejected', detail: `invalid-host: ${host}` }), 'ui-1')
    }
    expect(applied).toEqual([])
  })

  it('drops saved hosts that fail the same check, and falls back to the config targets when none is left', () => {
    const partly = setup({ store: memoryStore({ allDevices: false, hosts: ['8.8.8.8', '192.168.1.40'] }) })
    partly.destinations.start()
    expect(partly.applied.at(-1)).toEqual([{ name: 'ip-192-168-1-40', host: '192.168.1.40', sendPort: 7090, primary: true }])

    const none = setup({ store: memoryStore({ allDevices: false, hosts: ['8.8.8.8', '192.168.1.255'] }) })
    none.destinations.start()
    expect(none.applied).toEqual([])
    none.destinations.publish('ui-1')
    expect(none.lastFrame().selection).toEqual({ source: 'config', allDevices: false, hosts: ['192.168.1.20', 'stage-pc'] })
  })

  it('rejects a non-canonical spelling of the broadcast address', () => {
    const { destinations, publish, applied } = setup()
    destinations.start()
    destinations.handleUiFrame({ v: 1, type: 'destinationsSelect', allDevices: false, hosts: ['192.168.001.255'] }, 'ui-1')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ code: 'destinations-rejected', detail: 'invalid-host: 192.168.001.255' }), 'ui-1')
    expect(applied).toEqual([])
  })

  it('re-checks the individual selection when a rescan finds the networks changed', async () => {
    const interfaces = [NIC]
    const { destinations, applied, lastFrame } = setup({ interfaces })
    destinations.start()
    await destinations.scan()
    destinations.handleUiFrame({ v: 1, type: 'destinationsSelect', allDevices: false, hosts: ['192.168.1.40', '192.168.1.20'] }, 'ui-1')
    expect(applied.at(-1)?.map(target => target.host)).toEqual(['192.168.1.40', '192.168.1.20'])

    // NIC が別のネットワークへ移った。旧ネットワークの端末は落ち、設定の宛先のホストは残る
    interfaces.splice(0, 1, { ...NIC, address: '10.0.0.5' })
    await destinations.scan()
    expect(applied.at(-1)).toEqual([{ ...CONFIG_TARGETS[0], primary: true }])
    expect(lastFrame().selection).toEqual({ source: 'saved', allDevices: false, hosts: ['192.168.1.20'] })

    // 個別の選択が全部落ちたら設定ファイルの宛先へ戻る
    const only = setup({ interfaces: [NIC] })
    only.destinations.start()
    only.destinations.handleUiFrame({ v: 1, type: 'destinationsSelect', allDevices: false, hosts: ['192.168.1.40'] }, 'ui-1')
    const moved = [{ ...NIC, address: '10.0.0.5' }]
    const again = setup({ store: only.store, interfaces: moved })
    again.destinations.start()
    expect(again.applied).toEqual([])
    again.destinations.publish('ui-1')
    expect(again.lastFrame().selection.source).toBe('config')
  })

  it('reports a selection it could not save, and does not present it as saved', () => {
    const { destinations, publish, applied, lastFrame } = setup({ store: memoryStore(null, false) })
    destinations.start()
    destinations.handleUiFrame({ v: 1, type: 'destinationsSelect', allDevices: false, hosts: ['192.168.1.40'] }, 'ui-1')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'notice', level: 'error', code: 'destinations-save-failed' }))
    // 保存できなくても実行中は効く
    expect(applied.at(-1)).toEqual([{ name: 'ip-192-168-1-40', host: '192.168.1.40', sendPort: 7090, primary: true }])
    expect(lastFrame().selection).toEqual({ source: 'unsaved', allDevices: false, hosts: ['192.168.1.40'] })

    publish.mockClear()
    destinations.handleUiFrame({ v: 1, type: 'destinationsReset' }, 'ui-1')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ code: 'destinations-save-failed', detail: expect.stringContaining('could not remove') }))
  })

  it('goes back to the config targets on reset', async () => {
    const { destinations, applied, store } = setup({ store: memoryStore({ allDevices: false, hosts: ['192.168.1.40'] }) })
    destinations.start()
    await destinations.scan()
    destinations.handleUiFrame({ v: 1, type: 'destinationsReset' }, 'ui-1')
    expect(store.saved).toBeNull()
    expect(applied.at(-1)).toEqual(CONFIG_TARGETS)
  })

  it('runs one scan at a time and reflects devices that come and go', async () => {
    let found: Neighbor[] = [{ host: '192.168.1.40', mac: null }]
    let release: (() => void) | undefined
    const { destinations, probe, lastFrame } = setup({
      probe: () => new Promise(resolve => { release = () => resolve(found) }),
    })
    destinations.start()
    destinations.handleUiFrame({ v: 1, type: 'destinationsScan' }, 'ui-1')
    expect(probe).toHaveBeenCalledTimes(1)
    release?.()
    await destinations.scan()
    expect(lastFrame().devices.filter(device => device.found && !device.self).map(device => device.host)).toEqual(['192.168.1.40'])

    found = [{ host: '192.168.1.41', mac: null }]
    const next = destinations.scan()
    release?.()
    await next
    expect(probe).toHaveBeenCalledTimes(2)
    expect(lastFrame().devices.map(device => device.host)).not.toContain('192.168.1.40')
    expect(lastFrame().devices.map(device => device.host)).toContain('192.168.1.41')
  })

  it('aborts the prober on the time limit, so the next scan never overlaps it', async () => {
    vi.useFakeTimers()
    try {
      const signals: AbortSignal[] = []
      let active = 0
      let maxActive = 0
      const { destinations, publish, probe } = setup({
        probe: (_subnets, signal) => new Promise((_resolve, rejectProbe) => {
          signals.push(signal)
          active += 1
          maxActive = Math.max(maxActive, active)
          signal.addEventListener('abort', () => { active -= 1; rejectProbe(signal.reason) }, { once: true })
        }),
      })
      destinations.start()
      void destinations.scan()
      await vi.advanceTimersByTimeAsync(1_000)
      expect(signals[0]?.aborted).toBe(true)
      expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'notice', code: 'destinations-scan-failed', detail: 'timed out after 1000 ms' }))
      expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'destinations', scanning: false, scannedAt: null }), undefined)

      void destinations.scan()
      expect(probe).toHaveBeenCalledTimes(2)
      expect(maxActive).toBe(1)
      destinations.close()
      expect(signals[1]?.aborted).toBe(true)
      await vi.runAllTimersAsync()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
