import { describe, expect, it, vi } from 'vitest'

import type { DownstreamFrame } from '@oscdesk/shared'

import type { DestinationSelection, DestinationSelectionStore } from './destinations-file'
import { createMemoryDeviceAliasStore, type DeviceAliasStore } from './device-aliases'
import type { HostnameResolver } from './hostname-lookup'
import {
  createDestinations,
  isSelectableHost,
  listDevices,
  resolveDestinationTargets,
  type ConfigTarget,
} from './destinations'
import { localIpv4Addresses, scanSubnets, selectNeighbors, type LanProber, type Neighbor, type ScanInterface } from './lan-scan'
import type { RuntimeTargetSpec } from './surface-core'

const CONFIG_TARGETS: ConfigTarget[] = [
  { name: 'unity', host: '192.168.1.20', sendPort: 7090, primary: true, addresses: [] },
  { name: 'backup', host: 'stage-pc', sendPort: 7092, primary: false, addresses: ['192.168.1.30'] },
]
const NIC: ScanInterface = { name: 'Ethernet', address: '192.168.1.10', netmask: '255.255.255.0', family: 'IPv4', internal: false }
const SUBNETS = scanSubnets([NIC])
const WIFI: ScanInterface = { name: 'Wi-Fi', address: '10.0.0.5', netmask: '255.255.255.0', family: 'IPv4', internal: false }
const TWO_SUBNETS = scanSubnets([NIC, WIFI])

describe('resolveDestinationTargets', () => {
  const resolve = (selection: DestinationSelection | null, subnets = SUBNETS) =>
    resolveDestinationTargets({ selection, configTargets: CONFIG_TARGETS, subnets, sendPort: 7090 })

  it('uses the config targets while nothing is saved', () => {
    expect(resolve(null)).toEqual(CONFIG_TARGETS)
  })

  it('maps scanned hosts to ip-* targets on unity.sendPort and keeps config targets as they are', () => {
    expect(resolve({ allDevices: false, networks: [], hosts: ['192.168.1.40', 'stage-pc'] })).toEqual([
      { name: 'ip-192-168-1-40', host: '192.168.1.40', sendPort: 7090, primary: true },
      { ...CONFIG_TARGETS[1], primary: false },
    ])
    // 設定の主系が選ばれていれば、選択の順にかかわらずそれが主系
    expect(resolve({ allDevices: false, networks: [], hosts: ['192.168.1.40', '192.168.1.20'] })?.find(target => target.primary)?.name).toBe('unity')
    // この PC のアドレスは、ループバックから返る pong・エコーも受ける
    expect(resolve({ allDevices: false, networks: [], hosts: ['192.168.1.10'] })).toEqual([
      { name: 'ip-192-168-1-10', host: '192.168.1.10', sendPort: 7090, primary: true, addresses: ['127.0.0.1'] },
    ])
  })

  it('keeps a config target name even when it looks like a generated ip-* name', () => {
    const configTargets: ConfigTarget[] = [{ name: 'ip-192-168-1-40', host: '192.168.1.20', sendPort: 7090, primary: true, addresses: [] }]
    const targets = resolveDestinationTargets({
      selection: { allDevices: false, networks: [], hosts: ['192.168.1.40', '192.168.1.20'] }, configTargets, subnets: SUBNETS, sendPort: 7090,
    })
    expect(targets?.map(target => [target.host, target.name])).toEqual([
      ['192.168.1.40', 'ip-192-168-1-40-2'],
      ['192.168.1.20', 'ip-192-168-1-40'],
    ])
  })

  it('checks every overlapping network, so a /24 broadcast inside a /8 VPN is still refused', () => {
    const subnets = scanSubnets([
      { name: 'VPN', address: '10.200.0.1', netmask: '255.0.0.0', family: 'IPv4', internal: false },
      { name: 'LAN', address: '10.1.2.3', netmask: '255.255.255.0', family: 'IPv4', internal: false },
    ])
    expect(subnets.map(subnet => subnet.network)).toEqual(['10.0.0.0/8', '10.1.2.0/24'])
    expect(isSelectableHost('10.1.2.255', CONFIG_TARGETS, subnets)).toBe(false)
    expect(isSelectableHost('10.1.2.0', CONFIG_TARGETS, subnets)).toBe(false)
    expect(isSelectableHost('10.255.255.255', CONFIG_TARGETS, subnets)).toBe(false)
    expect(isSelectableHost('10.1.2.50', CONFIG_TARGETS, subnets)).toBe(true)
    expect(isSelectableHost('10.5.0.1', CONFIG_TARGETS, subnets)).toBe(true)
    // 走査結果からも、どちらかのネットワーク・ブロードキャストアドレスは端末として出さない
    expect(selectNeighbors([{ host: '10.1.2.255', mac: 'aa:bb:cc:dd:ee:ff' }, { host: '10.1.2.50', mac: 'aa:bb:cc:dd:ee:32' }], subnets))
      .toEqual([{ host: '10.1.2.50', mac: 'aa:bb:cc:dd:ee:32' }])
  })

  it('decides "this PC" from every local IPv4 address, not only the scanned networks', () => {
    const interfaces: ScanInterface[] = [
      NIC,
      { name: 'APIPA', address: '169.254.10.20', netmask: '255.255.0.0', family: 'IPv4', internal: false },
      { name: 'p2p', address: '10.9.9.9', netmask: '255.255.255.255', family: 'IPv4', internal: false },
      { name: 'lo', address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', internal: true },
    ]
    const own = localIpv4Addresses(interfaces)
    expect([...own]).toEqual(['192.168.1.10', '169.254.10.20', '10.9.9.9'])
    // 走査の対象はこのうち 1 つだけだが、残りへ解決される宛先もこの PC
    expect(scanSubnets(interfaces).map(subnet => subnet.address)).toEqual(['192.168.1.10'])
    const configTargets: ConfigTarget[] = [
      { name: 'unity', host: 'apipa-pc', sendPort: 7090, primary: true, addresses: ['169.254.10.20'] },
      { name: 'p2p', host: '10.9.9.9', sendPort: 7092, primary: false, addresses: [] },
    ]
    expect(resolveDestinationTargets({ selection: null, configTargets, subnets: scanSubnets(interfaces), sendPort: 7090, ownAddresses: own })).toEqual([
      { ...configTargets[0], addresses: ['169.254.10.20', '127.0.0.1'] },
      { ...configTargets[1], addresses: ['127.0.0.1'] },
    ])
  })

  it('adds the loopback alias to config targets that point at this PC, by host or by resolved address', () => {
    const configTargets: ConfigTarget[] = [
      { name: 'unity', host: '192.168.1.20', sendPort: 7090, primary: true, addresses: [] },
      { name: 'local', host: '192.168.1.10', sendPort: 7092, primary: false, addresses: [] },
      { name: 'named', host: 'this-pc', sendPort: 7094, primary: false, addresses: ['192.168.1.10'] },
    ]
    const targets = resolveDestinationTargets({
      selection: { allDevices: false, networks: [], hosts: ['192.168.1.10', 'this-pc'] }, configTargets, subnets: SUBNETS, sendPort: 7090,
    })
    // 副系を主系に選び直しても、同じ PC の Unity のループバックからの返事を受ける
    expect(targets).toEqual([
      { name: 'local', host: '192.168.1.10', sendPort: 7092, primary: true, addresses: ['127.0.0.1'] },
      { name: 'named', host: 'this-pc', sendPort: 7094, primary: false, addresses: ['192.168.1.10', '127.0.0.1'] },
    ])
    // この PC でない宛先には足さない
    expect(resolveDestinationTargets({
      selection: { allDevices: false, networks: [], hosts: ['192.168.1.20'] }, configTargets, subnets: SUBNETS, sendPort: 7090,
    })).toEqual([{ ...configTargets[0], primary: true, addresses: [] }])
  })

  it('sends to the broadcast address of each network for all devices, and gives up without a network', () => {
    expect(resolve({ allDevices: true, networks: [], hosts: ['192.168.1.40'] })).toEqual([
      expect.objectContaining({ name: 'all-devices', host: '192.168.1.255', sendPort: 7090, primary: true, broadcast: { networkInt: SUBNETS[0]!.networkInt, maskInt: SUBNETS[0]!.maskInt } }),
    ])
    expect(resolve({ allDevices: true, networks: [], hosts: [] }, [])).toBeNull()
    expect(resolve({ allDevices: false, networks: [], hosts: ['not-a-config-host'] })).toBeNull()
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
    expect(resolve({ allDevices: false, networks: [], hosts: ['192.168.1.255'] })).toBeNull()
  })
})

describe('resolveDestinationTargets with per-network all devices (D-085)', () => {
  const resolve = (selection: DestinationSelection) =>
    resolveDestinationTargets({ selection, configTargets: CONFIG_TARGETS, subnets: TWO_SUBNETS, sendPort: 7090 })

  it('broadcasts to the chosen network only and unicasts to hosts outside it', () => {
    expect(resolve({ allDevices: false, networks: ['10.0.0.0/24'], hosts: ['192.168.1.40', '10.0.0.40'] })).toEqual([
      // この PC のアドレス(どちらの NIC も)を持たせ、同じ PC の Unity が別の NIC から返す pong も受けさせる
      {
        name: 'net-10-0-0-0-24', host: '10.0.0.255', sendPort: 7090, primary: true, addresses: ['192.168.1.10', '10.0.0.5'],
        broadcast: { networkInt: TWO_SUBNETS[1]!.networkInt, maskInt: TWO_SUBNETS[1]!.maskInt },
      },
      { name: 'ip-192-168-1-40', host: '192.168.1.40', sendPort: 7090, primary: false },
    ])
  })

  it('does not send twice to a host the broadcast already covers, but keeps a config target on another port', () => {
    const targets = resolve({ allDevices: false, networks: ['192.168.1.0/24'], hosts: ['192.168.1.20', '192.168.1.40', 'stage-pc', '10.0.0.40'] })
    expect(targets?.map(target => [target.name, target.primary])).toEqual([
      // 設定の主系(192.168.1.20)はブロードキャストに含まれるので、そのネットワークの宛先が主系になる
      ['net-192-168-1-0-24', true],
      ['backup', false],
      ['ip-10-0-0-40', false],
    ])
  })

  it('treats a config host name that resolves into the chosen network as covered', () => {
    const configTargets: ConfigTarget[] = [
      { name: 'unity', host: 'stage-pc', sendPort: 7090, primary: true, addresses: ['192.168.1.20'] },
      { name: 'other-port', host: 'side-pc', sendPort: 7092, primary: false, addresses: ['192.168.1.21'] },
    ]
    const targets = resolveDestinationTargets({
      selection: { allDevices: false, networks: ['192.168.1.0/24'], hosts: ['stage-pc', 'side-pc'] }, configTargets, subnets: TWO_SUBNETS, sendPort: 7090,
    })
    // 同じポートの stage-pc はブロードキャストで届くので個別に送らず、主系はそのネットワークの宛先。ポートの違う side-pc は残す
    expect(targets?.map(target => [target.name, target.primary])).toEqual([['net-192-168-1-0-24', true], ['other-port', false]])
  })

  it('treats this PC (loopback or any of its NIC addresses) as covered by any chosen network', () => {
    // ブロードキャストはこの PC 自身にも届くので、同じ PC の Unity へ個別にも送ると 2 回撃たれる
    const configTargets: ConfigTarget[] = [{ name: 'unity', host: '127.0.0.1', sendPort: 7090, primary: true, addresses: [] }]
    const targets = resolveDestinationTargets({
      selection: { allDevices: false, networks: ['192.168.1.0/24'], hosts: ['127.0.0.1', '10.0.0.5', '10.0.0.40'] },
      configTargets, subnets: TWO_SUBNETS, sendPort: 7090,
    })
    expect(targets?.map(target => [target.name, target.primary])).toEqual([['net-192-168-1-0-24', true], ['ip-10-0-0-40', false]])
    // ネットワークを選んでいなければ、これまでどおり個別に送る
    expect(resolveDestinationTargets({
      selection: { allDevices: false, networks: [], hosts: ['127.0.0.1'] }, configTargets, subnets: TWO_SUBNETS, sendPort: 7090,
    })?.map(target => target.name)).toEqual(['unity'])
  })

  it('sends individually to a host whose narrowest network is not the chosen one (HID-325)', () => {
    const subnets = scanSubnets([
      { name: 'vpn', address: '10.200.0.1', netmask: '255.0.0.0', family: 'IPv4', internal: false },
      { name: 'lan', address: '10.1.2.3', netmask: '255.255.255.0', family: 'IPv4', internal: false },
    ])
    const targets = resolveDestinationTargets({
      selection: { allDevices: false, networks: ['10.0.0.0/8'], hosts: ['10.1.2.50', '10.7.7.7'] },
      configTargets: CONFIG_TARGETS, subnets, sendPort: 7090,
    })
    expect(targets?.map(target => target.name)).toEqual(['net-10-0-0-0-8', 'ip-10-1-2-50'])
  })

  it('does not send individually when the narrower network shares the chosen network broadcast address', () => {
    const subnets = scanSubnets([
      { name: 'wide', address: '192.168.1.1', netmask: '255.255.0.0', family: 'IPv4', internal: false },
      { name: 'narrow', address: '192.168.255.1', netmask: '255.255.255.0', family: 'IPv4', internal: false },
    ])
    const targets = resolveDestinationTargets({
      selection: { allDevices: false, networks: ['192.168.0.0/16'], hosts: ['192.168.255.50'] },
      configTargets: CONFIG_TARGETS, subnets, sendPort: 7090,
    })
    expect(targets?.map(target => target.name)).toEqual(['net-192-168-0-0-16'])
  })

  it('ignores networks this PC is not on and needs something to send to', () => {
    expect(resolve({ allDevices: false, networks: ['172.16.0.0/24'], hosts: [] })).toBeNull()
    expect(resolve({ allDevices: false, networks: [], hosts: [] })).toBeNull()
  })
})

describe('listDevices', () => {
  it('shows the looked-up names and the OS host name for this PC', () => {
    const devices = listDevices({
      neighbors: [{ host: '192.168.1.40', mac: 'aa:bb:cc:dd:ee:28' }],
      subnets: SUBNETS,
      configTargets: [],
      selectedHosts: [],
      hostnames: new Map([['192.168.1.40', 'unity-main']]),
      localHostname: 'control-pc',
    })
    expect(devices.map(device => [device.host, device.hostname])).toEqual([['192.168.1.10', 'control-pc'], ['192.168.1.40', 'unity-main']])
  })

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

function setup(options: {
  store?: ReturnType<typeof memoryStore>
  probe?: LanProber['probe']
  interfaces?: ScanInterface[]
  hostnameResolver?: HostnameResolver
  aliasStore?: DeviceAliasStore
} = {}) {
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
    ...(options.hostnameResolver === undefined ? {} : { hostnameResolver: options.hostnameResolver }),
    localHostname: () => 'control-pc',
    store,
    ...(options.aliasStore === undefined ? {} : { aliasStore: options.aliasStore }),
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
      selection: { source: 'config', allDevices: false, networks: [], hosts: ['192.168.1.20', 'stage-pc'] },
      targets: [{ name: 'unity', primary: true, broadcast: false }, { name: 'backup', primary: false, broadcast: false }],
    })
    expect(lastFrame().devices.map(device => device.host)).toContain('192.168.1.40')
  })

  it('applies and saves a selection, and restores it on the next start', async () => {
    const first = setup()
    first.destinations.start()
    await first.destinations.scan()
    expect(first.destinations.handleUiFrame({ v: 1, type: 'destinationsSelect', allDevices: false, networks: [], hosts: ['192.168.1.40'] }, 'ui-1')).toBe(true)
    expect(first.applied.at(-1)).toEqual([{ name: 'ip-192-168-1-40', host: '192.168.1.40', sendPort: 7090, primary: true }])
    expect(first.store.saved).toEqual({ allDevices: false, networks: [], hosts: ['192.168.1.40'] })
    expect(first.lastFrame()).toMatchObject({ selection: { source: 'saved', allDevices: false, networks: [], hosts: ['192.168.1.40'] } })

    const second = setup({ store: first.store })
    second.destinations.start()
    expect(second.applied[0]).toEqual([{ name: 'ip-192-168-1-40', host: '192.168.1.40', sendPort: 7090, primary: true }])
  })

  it('switches to the broadcast target for all devices and keeps the individual hosts for later', async () => {
    const { destinations, applied, store } = setup()
    destinations.start()
    await destinations.scan()
    destinations.handleUiFrame({ v: 1, type: 'destinationsSelect', allDevices: true, networks: [], hosts: ['192.168.1.40'] }, 'ui-1')
    expect(applied.at(-1)).toEqual([expect.objectContaining({ name: 'all-devices', host: '192.168.1.255', primary: true })])
    expect(store.saved).toEqual({ allDevices: true, networks: [], hosts: ['192.168.1.40'] })
  })

  it('selects per-network all devices, rejects unknown networks and drops vanished ones on restore', async () => {
    const { destinations, applied, store, publish } = setup({ interfaces: [NIC, WIFI] })
    destinations.start()
    destinations.handleUiFrame({ v: 1, type: 'destinationsSelect', allDevices: false, networks: ['10.0.0.0/24'], hosts: ['192.168.1.40'] }, 'ui-1')
    expect(applied.at(-1)?.map(target => target.name)).toEqual(['net-10-0-0-0-24', 'ip-192-168-1-40'])
    expect(store.saved).toEqual({ allDevices: false, networks: ['10.0.0.0/24'], hosts: ['192.168.1.40'] })
    destinations.handleUiFrame({ v: 1, type: 'destinationsSelect', allDevices: false, networks: ['172.16.0.0/24'], hosts: [] }, 'ui-1')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ code: 'destinations-rejected', detail: 'invalid-network: 172.16.0.0/24' }), 'ui-1')
    // ネットワークだけを選んだ保存は、そのネットワークが無くなると設定ファイルの宛先へ戻る
    const restored = setup({ store: memoryStore({ allDevices: false, networks: ['10.0.0.0/24'], hosts: [] }), interfaces: [NIC] })
    restored.destinations.start()
    restored.destinations.publish()
    expect(restored.lastFrame().selection).toEqual({ source: 'config', allDevices: false, networks: [], hosts: ['192.168.1.20', 'stage-pc'] })
  })

  it('looks up host names after a scan and keeps names whose lookup did not finish', async () => {
    const answers: Map<string, string | null>[] = [
      new Map([['192.168.1.40', 'unity-main'], ['192.168.1.41', 'old-name']]),
      new Map([['192.168.1.41', null]]),
    ]
    const asked: string[][] = []
    const resolver: HostnameResolver = { resolve: async hosts => { asked.push([...hosts]); return answers.shift() ?? new Map() } }
    const { destinations, lastFrame } = setup({
      hostnameResolver: resolver,
      probe: async () => [{ host: '192.168.1.40', mac: null }, { host: '192.168.1.41', mac: null }],
    })
    destinations.start()
    await destinations.scan()
    // この PC は問い合わせず、OS のホスト名を出す。設定の宛先のホスト名(stage-pc)は IP でないので問い合わせない
    expect(asked[0]).toEqual(['192.168.1.40', '192.168.1.41', '192.168.1.20'])
    const names = () => Object.fromEntries(lastFrame().devices.map(device => [device.host, device.hostname]))
    expect(names()).toMatchObject({ '192.168.1.10': 'control-pc', '192.168.1.40': 'unity-main', '192.168.1.41': 'old-name', '192.168.1.20': null })
    await destinations.scan()
    // 2 回目は 192.168.1.40 の問い合わせが終わらなかった(結果に無い)ので前回の名前を保ち、名前が無いと分かった .41 は消す
    expect(names()).toMatchObject({ '192.168.1.40': 'unity-main', '192.168.1.41': null })
  })

  it('names devices by MAC, follows them to a new IP and restores the names on the next start', async () => {
    let found: Neighbor[] = [{ host: '192.168.1.40', mac: 'aa:bb:cc:dd:ee:28' }]
    const aliasStore = createMemoryDeviceAliasStore()
    const nic = { ...NIC, mac: 'AA-BB-CC-DD-EE-0A' }
    const { destinations, lastFrame, publish } = setup({ probe: async () => found, aliasStore, interfaces: [nic] })
    destinations.start()
    await destinations.scan()
    const alias = (host: string) => lastFrame().devices.find(device => device.host === host)?.alias
    expect(alias('192.168.1.40')).toBeNull()
    publish.mockClear()
    destinations.handleUiFrame({ v: 1, type: 'destinationsAlias', host: '192.168.1.40', alias: '  ステージ左 iPad ' }, 'ui-1')
    // 全 UI へ配り直す(要求元だけでなく)
    expect(publish.mock.calls.at(-1)?.[0].type).toBe('destinations')
    expect(publish.mock.calls.at(-1)?.[1]).toBeUndefined()
    expect(alias('192.168.1.40')).toBe('ステージ左 iPad')
    expect(aliasStore.load()).toEqual(new Map([['mac:aa:bb:cc:dd:ee:28', { alias: 'ステージ左 iPad', host: '192.168.1.40' }]]))
    // この PC は NIC の MAC で覚える
    expect(lastFrame().devices.find(device => device.self)?.mac).toBe('aa:bb:cc:dd:ee:0a')
    destinations.handleUiFrame({ v: 1, type: 'destinationsAlias', host: '192.168.1.10', alias: '操作卓' }, 'ui-1')
    expect(aliasStore.load().get('mac:aa:bb:cc:dd:ee:0a')?.alias).toBe('操作卓')

    // DHCP で IP が変わっても同じ MAC なら同じ名前
    found = [{ host: '192.168.1.41', mac: 'aa:bb:cc:dd:ee:28' }]
    await destinations.scan()
    expect(alias('192.168.1.41')).toBe('ステージ左 iPad')

    const restarted = setup({ probe: async () => found, aliasStore, interfaces: [nic] })
    restarted.destinations.start()
    await restarted.destinations.scan()
    expect(restarted.lastFrame().devices.find(device => device.host === '192.168.1.41')?.alias).toBe('ステージ左 iPad')
    expect(restarted.lastFrame().devices.find(device => device.self)?.alias).toBe('操作卓')
  })

  it('keeps and edits the MAC alias of a device that is offline or not yet scanned', async () => {
    let found: Neighbor[] = [{ host: '192.168.1.40', mac: 'aa:bb:cc:dd:ee:28' }]
    const aliasStore = createMemoryDeviceAliasStore()
    const store = memoryStore()
    const first = setup({ probe: async () => found, aliasStore, store })
    first.destinations.start()
    await first.destinations.scan()
    first.destinations.handleUiFrame({ v: 1, type: 'destinationsSelect', allDevices: false, networks: [], hosts: ['192.168.1.40'] }, 'ui-1')
    first.destinations.handleUiFrame({ v: 1, type: 'destinationsAlias', host: '192.168.1.40', alias: 'ステージ左 iPad' }, 'ui-1')
    const device = (frame: ReturnType<typeof first.lastFrame>) => frame.devices.find(item => item.host === '192.168.1.40')

    // 電源が落ちて走査に出なくなっても(選択中なので行は残る)、最後に分かった MAC で名前を出す
    found = []
    await first.destinations.scan()
    expect(device(first.lastFrame())).toMatchObject({ found: false, mac: 'aa:bb:cc:dd:ee:28', alias: 'ステージ左 iPad' })
    // 走査に出ていない間の改名も MAC の別名を変える(host の別名だけを変えると、MAC が分かった後に古い名前が勝つ)
    first.destinations.handleUiFrame({ v: 1, type: 'destinationsAlias', host: '192.168.1.40', alias: '改名' }, 'ui-1')
    expect(aliasStore.load()).toEqual(new Map([['mac:aa:bb:cc:dd:ee:28', { alias: '改名', host: '192.168.1.40' }]]))

    // 再起動直後(初回の走査の前)も名前が出る
    const restarted = setup({ probe: async () => found, aliasStore, store })
    restarted.destinations.start()
    restarted.destinations.publish()
    expect(device(restarted.lastFrame())).toMatchObject({ found: false, alias: '改名' })
    // 走査に出ていない間の消去も MAC の別名を消す
    restarted.destinations.handleUiFrame({ v: 1, type: 'destinationsAlias', host: '192.168.1.40', alias: null }, 'ui-1')
    expect(aliasStore.load()).toEqual(new Map())
    found = [{ host: '192.168.1.40', mac: 'aa:bb:cc:dd:ee:28' }]
    await restarted.destinations.scan()
    expect(device(restarted.lastFrame())?.alias).toBeNull()
  })

  it('falls back to the host for devices without a MAC and clears both keys', async () => {
    const aliasStore = createMemoryDeviceAliasStore()
    const { destinations, lastFrame } = setup({ probe: async () => [{ host: '192.168.1.40', mac: 'aa:bb:cc:dd:ee:28' }], aliasStore })
    destinations.start()
    // 走査の前でも、設定の宛先(MAC が分からない)には host で名前を付けられる。ホスト名の宛先も同じ
    destinations.handleUiFrame({ v: 1, type: 'destinationsAlias', host: '192.168.1.20', alias: 'Unity 本番機' }, 'ui-1')
    destinations.handleUiFrame({ v: 1, type: 'destinationsAlias', host: 'stage-pc', alias: '舞台袖' }, 'ui-1')
    expect(aliasStore.load()).toEqual(new Map([['host:192.168.1.20', { alias: 'Unity 本番機' }], ['host:stage-pc', { alias: '舞台袖' }]]))
    await destinations.scan()
    expect(lastFrame().devices.find(device => device.host === 'stage-pc')?.alias).toBe('舞台袖')
    destinations.handleUiFrame({ v: 1, type: 'destinationsAlias', host: 'stage-pc', alias: null }, 'ui-1')
    destinations.handleUiFrame({ v: 1, type: 'destinationsAlias', host: '192.168.1.20', alias: '   ' }, 'ui-1')
    expect(aliasStore.load()).toEqual(new Map())
    expect(lastFrame().devices.every(device => device.alias === null)).toBe(true)
  })

  it('rejects names for unlisted hosts and invalid names, and reports a failed save', async () => {
    const failing: DeviceAliasStore = { file: 'aliases.json', load: () => new Map(), save: () => false }
    const { destinations, publish, lastFrame } = setup({ aliasStore: failing })
    destinations.start()
    await destinations.scan()
    publish.mockClear()
    destinations.handleUiFrame({ v: 1, type: 'destinationsAlias', host: '203.0.113.9', alias: 'x' }, 'ui-1')
    destinations.handleUiFrame({ v: 1, type: 'destinationsAlias', host: '192.168.1.40', alias: 'a\u0007b' }, 'ui-1')
    const notices = publish.mock.calls.filter(call => call[0].type === 'notice').map(call => [call[0], call[1]])
    expect(notices).toEqual([
      [expect.objectContaining({ code: 'destination-alias-rejected', detail: 'unknown-host: 203.0.113.9' }), 'ui-1'],
      [expect.objectContaining({ code: 'destination-alias-rejected', detail: 'alias-has-control-characters' }), 'ui-1'],
    ])
    publish.mockClear()
    destinations.handleUiFrame({ v: 1, type: 'destinationsAlias', host: '192.168.1.40', alias: '照明卓' }, 'ui-1')
    // 保存できなくても実行中は効く
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ code: 'destination-aliases-save-failed' }))
    expect(lastFrame().devices.find(device => device.host === '192.168.1.40')?.alias).toBe('照明卓')
  })

  it('does not fail the scan when the host name lookup fails', async () => {
    const resolver: HostnameResolver = { resolve: () => Promise.reject(new Error('boom')) }
    const { destinations, lastFrame, publish } = setup({ hostnameResolver: resolver })
    destinations.start()
    await destinations.scan()
    expect(lastFrame()).toMatchObject({ scanning: false, scannedAt: '2026-10-18T10:00:00.000Z' })
    expect(publish).not.toHaveBeenCalledWith(expect.objectContaining({ code: 'destinations-scan-failed' }))
  })

  it('rejects invalid selections with a notice and re-sends the current state to the requester', async () => {
    const { destinations, publish, applied } = setup({ interfaces: [] })
    destinations.start()
    await destinations.scan()
    publish.mockClear()
    destinations.handleUiFrame({ v: 1, type: 'destinationsSelect', allDevices: false, networks: [], hosts: [] }, 'ui-1')
    destinations.handleUiFrame({ v: 1, type: 'destinationsSelect', allDevices: false, networks: [], hosts: ['evil.example.com'] }, 'ui-1')
    destinations.handleUiFrame({ v: 1, type: 'destinationsSelect', allDevices: true, networks: [], hosts: [] }, 'ui-1')
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
      destinations.handleUiFrame({ v: 1, type: 'destinationsSelect', allDevices: false, networks: [], hosts: ['192.168.1.40', host] }, 'ui-1')
      expect(publish).toHaveBeenCalledWith(expect.objectContaining({ code: 'destinations-rejected', detail: `invalid-host: ${host}` }), 'ui-1')
    }
    expect(applied).toEqual([])
  })

  it('drops saved hosts that fail the same check, and falls back to the config targets when none is left', () => {
    const partly = setup({ store: memoryStore({ allDevices: false, networks: [], hosts: ['8.8.8.8', '192.168.1.40'] }) })
    partly.destinations.start()
    expect(partly.applied.at(-1)).toEqual([{ name: 'ip-192-168-1-40', host: '192.168.1.40', sendPort: 7090, primary: true }])

    const none = setup({ store: memoryStore({ allDevices: false, networks: [], hosts: ['8.8.8.8', '192.168.1.255'] }) })
    none.destinations.start()
    expect(none.applied).toEqual([])
    none.destinations.publish('ui-1')
    expect(none.lastFrame().selection).toEqual({ source: 'config', allDevices: false, networks: [], hosts: ['192.168.1.20', 'stage-pc'] })
  })

  it('rejects a non-canonical spelling of the broadcast address', () => {
    const { destinations, publish, applied } = setup()
    destinations.start()
    destinations.handleUiFrame({ v: 1, type: 'destinationsSelect', allDevices: false, networks: [], hosts: ['192.168.001.255'] }, 'ui-1')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ code: 'destinations-rejected', detail: 'invalid-host: 192.168.001.255' }), 'ui-1')
    expect(applied).toEqual([])
  })

  it('re-checks the individual selection when a rescan finds the networks changed', async () => {
    const interfaces = [NIC]
    const { destinations, applied, lastFrame } = setup({ interfaces })
    destinations.start()
    await destinations.scan()
    destinations.handleUiFrame({ v: 1, type: 'destinationsSelect', allDevices: false, networks: [], hosts: ['192.168.1.40', '192.168.1.20'] }, 'ui-1')
    expect(applied.at(-1)?.map(target => target.host)).toEqual(['192.168.1.40', '192.168.1.20'])

    // NIC が別のネットワークへ移った。旧ネットワークの端末は落ち、設定の宛先のホストは残る
    interfaces.splice(0, 1, { ...NIC, address: '10.0.0.5' })
    await destinations.scan()
    expect(applied.at(-1)).toEqual([{ ...CONFIG_TARGETS[0], primary: true }])
    expect(lastFrame().selection).toEqual({ source: 'saved', allDevices: false, networks: [], hosts: ['192.168.1.20'] })

    // 個別の選択が全部落ちたら設定ファイルの宛先へ戻る
    const only = setup({ interfaces: [NIC] })
    only.destinations.start()
    only.destinations.handleUiFrame({ v: 1, type: 'destinationsSelect', allDevices: false, networks: [], hosts: ['192.168.1.40'] }, 'ui-1')
    const moved = [{ ...NIC, address: '10.0.0.5' }]
    const again = setup({ store: only.store, interfaces: moved })
    again.destinations.start()
    expect(again.applied).toEqual([])
    again.destinations.publish('ui-1')
    expect(again.lastFrame().selection.source).toBe('config')
  })

  it('moves the loopback alias when DHCP changes the address of this PC within the same network', async () => {
    const interfaces = [NIC]
    const { destinations, applied } = setup({ interfaces })
    destinations.start()
    destinations.handleUiFrame({ v: 1, type: 'destinationsSelect', allDevices: false, networks: [], hosts: ['192.168.1.10', '192.168.1.11'] }, 'ui-1')
    expect(applied.at(-1)).toEqual([
      { name: 'ip-192-168-1-10', host: '192.168.1.10', sendPort: 7090, primary: true, addresses: ['127.0.0.1'] },
      { name: 'ip-192-168-1-11', host: '192.168.1.11', sendPort: 7090, primary: false },
    ])
    const before = applied.length
    // 同じ /24 のまま、この PC のアドレスが .10 から .11 に変わった
    interfaces.splice(0, 1, { ...NIC, address: '192.168.1.11' })
    await destinations.scan()
    expect(applied).toHaveLength(before + 1)
    expect(applied.at(-1)).toEqual([
      { name: 'ip-192-168-1-10', host: '192.168.1.10', sendPort: 7090, primary: true },
      { name: 'ip-192-168-1-11', host: '192.168.1.11', sendPort: 7090, primary: false, addresses: ['127.0.0.1'] },
    ])
    // 変わらない再走査では適用し直さない
    await destinations.scan()
    expect(applied).toHaveLength(before + 1)
  })

  it('reports a selection it could not save, and does not present it as saved', () => {
    const { destinations, publish, applied, lastFrame } = setup({ store: memoryStore(null, false) })
    destinations.start()
    destinations.handleUiFrame({ v: 1, type: 'destinationsSelect', allDevices: false, networks: [], hosts: ['192.168.1.40'] }, 'ui-1')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'notice', level: 'error', code: 'destinations-save-failed' }))
    // 保存できなくても実行中は効く
    expect(applied.at(-1)).toEqual([{ name: 'ip-192-168-1-40', host: '192.168.1.40', sendPort: 7090, primary: true }])
    expect(lastFrame().selection).toEqual({ source: 'unsaved', allDevices: false, networks: [], hosts: ['192.168.1.40'] })

    publish.mockClear()
    destinations.handleUiFrame({ v: 1, type: 'destinationsReset' }, 'ui-1')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ code: 'destinations-save-failed', detail: expect.stringContaining('could not remove') }))
  })

  it('goes back to the config targets on reset', async () => {
    const { destinations, applied, store } = setup({ store: memoryStore({ allDevices: false, networks: [], hosts: ['192.168.1.40'] }) })
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
