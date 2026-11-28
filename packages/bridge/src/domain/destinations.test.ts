import { describe, expect, it, vi } from 'vitest'

import type { DownstreamFrame } from '@oscdesk/shared'

import {
  createDestinations,
  isSelectableHost,
  listDevices,
  resolveDestinationTargets,
  type ConfigTarget,
  type DestinationSelection,
  type DestinationSelectionStore,
} from './destinations'
import { createMemoryDeviceAliasStore, type DeviceAliasStore } from './device-aliases'
import { localIpv4Addresses, scanSubnets, scopedScanSubnets, type ScanInterface, type ScanScope } from './lan-subnets'
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
  })

  it('still refuses the broadcast of a NIC left out by the target network or range (D-113)', () => {
    const interfaces: ScanInterface[] = [
      { name: 'VPN', address: '10.200.0.1', netmask: '255.0.0.0', family: 'IPv4', internal: false },
      { name: 'LAN', address: '10.1.2.3', netmask: '255.255.255.0', family: 'IPv4', internal: false },
    ]
    // VPN をターゲット向けのネットワークに選ぶと LAN は走査から外れるが、LAN の .255 / .0 は個別の端末として選べない
    const vpnOnly = scopedScanSubnets(interfaces, { targetInterface: '10.200.0.1', targetRanges: [] })
    expect(vpnOnly.map(subnet => subnet.network)).toEqual(['10.0.0.0/8'])
    expect(isSelectableHost('10.1.2.255', CONFIG_TARGETS, vpnOnly)).toBe(false)
    expect(isSelectableHost('10.1.2.0', CONFIG_TARGETS, vpnOnly)).toBe(false)
    expect(isSelectableHost('10.1.2.50', CONFIG_TARGETS, vpnOnly)).toBe(true)
    // 範囲で LAN を外したときも同じ
    const ranged = scopedScanSubnets(interfaces, { targetInterface: null, targetRanges: ['10.1.0.0/16'] })
    expect(ranged.map(subnet => subnet.network)).toEqual(['10.0.0.0/8', '10.1.2.0/24'])
    const vpnRanged = scopedScanSubnets(interfaces, { targetInterface: '10.200.0.1', targetRanges: ['10.1.0.0/16'] })
    expect(isSelectableHost('10.1.2.255', CONFIG_TARGETS, vpnRanged)).toBe(false)
  })

  it('judges broadcast reach with every NIC, so a LAN host stays an individual target when only the VPN is scanned (D-113)', () => {
    const interfaces: ScanInterface[] = [
      { name: 'VPN', address: '10.200.0.1', netmask: '255.0.0.0', family: 'IPv4', internal: false },
      { name: 'LAN', address: '10.1.2.3', netmask: '255.255.255.0', family: 'IPv4', internal: false },
    ]
    const vpnOnly = scopedScanSubnets(interfaces, { targetInterface: '10.200.0.1', targetRanges: [] })
    const configTargets: ConfigTarget[] = [{ name: 'unity', host: '10.1.2.50', sendPort: 7090, primary: true, addresses: [] }]
    const targets = resolveDestinationTargets({
      selection: { allDevices: false, networks: ['10.0.0.0/8'], hosts: ['10.1.2.50'] },
      configTargets, subnets: vpnOnly, sendPort: 7090, reachSubnets: scanSubnets(interfaces),
    })
    // /8 のブロードキャストは OS が /24 の経路で送る LAN の端末に届かないので、個別の宛先として残す
    expect(targets?.map(target => target.host)).toEqual(['10.255.255.255', '10.1.2.50'])
  })

  it('leaves this PC out of the device list when it is outside the target range (D-113)', () => {
    const subnets = scopedScanSubnets([NIC], { targetInterface: null, targetRanges: ['192.168.1.128/25'] })
    const devices = listDevices({ subnets, configTargets: [], selectedHosts: [] })
    expect(devices.map(device => device.host)).toEqual([])
    expect(isSelectableHost('192.168.1.10', [], subnets)).toBe(false)
    // 範囲の中なら今までどおり並ぶ
    const inside = scopedScanSubnets([NIC], { targetInterface: null, targetRanges: ['192.168.1.0/28'] })
    expect(listDevices({ subnets: inside, configTargets: [], selectedHosts: [] }).map(device => device.host)).toEqual(['192.168.1.10'])
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

  it('keeps the config primary on the chosen network that reaches it through a shared broadcast address', () => {
    const subnets = scanSubnets([
      { name: 'a', address: '10.0.0.5', netmask: '255.255.255.0', family: 'IPv4', internal: false },
      { name: 'wide', address: '192.168.1.1', netmask: '255.255.0.0', family: 'IPv4', internal: false },
      { name: 'narrow', address: '192.168.255.1', netmask: '255.255.255.0', family: 'IPv4', internal: false },
    ])
    const configTargets: ConfigTarget[] = [{ name: 'unity', host: '192.168.255.50', sendPort: 7090, primary: true, addresses: [] }]
    const targets = resolveDestinationTargets({
      selection: { allDevices: false, networks: ['10.0.0.0/24', '192.168.0.0/16'], hosts: ['192.168.255.50'] },
      configTargets, subnets, sendPort: 7090,
    })
    expect(targets?.map(target => [target.name, target.primary])).toEqual([['net-10-0-0-0-24', false], ['net-192-168-0-0-16', true]])
  })

  it('does not treat a host outside the chosen narrow network as reached through a shared broadcast address', () => {
    const subnets = scanSubnets([
      { name: 'wide', address: '192.168.1.1', netmask: '255.255.0.0', family: 'IPv4', internal: false },
      { name: 'narrow', address: '192.168.255.1', netmask: '255.255.255.0', family: 'IPv4', internal: false },
    ])
    const targets = resolveDestinationTargets({
      selection: { allDevices: false, networks: ['192.168.255.0/24'], hosts: ['192.168.1.50'] },
      configTargets: CONFIG_TARGETS, subnets, sendPort: 7090,
    })
    expect(targets?.map(target => target.name)).toEqual(['net-192-168-255-0-24', 'ip-192-168-1-50'])
  })

  it('ignores networks this PC is not on and needs something to send to', () => {
    expect(resolve({ allDevices: false, networks: ['172.16.0.0/24'], hosts: [] })).toBeNull()
    expect(resolve({ allDevices: false, networks: [], hosts: [] })).toBeNull()
  })
})

describe('OSCQuery targets in the destinations (D-168)', () => {
  const sendTo = (targets: readonly RuntimeTargetSpec[] | null) => targets?.map(target => [target.name, target.host, target.sendPort])

  it('sends to each selected host and OSC port pair, telling two apps on one PC apart', () => {
    const targets = resolveDestinationTargets({
      selection: { allDevices: false, networks: [], hosts: ['192.168.1.31'], endpoints: [{ host: '192.168.1.30', port: 9000 }, { host: '192.168.1.30', port: 9001 }, { host: '192.168.1.30', port: 9000 }] },
      configTargets: CONFIG_TARGETS,
      subnets: SUBNETS,
      sendPort: 7090,
    })
    expect(sendTo(targets)).toEqual([
      ['ip-192-168-1-31', '192.168.1.31', 7090],
      ['oq-192-168-1-30-9000', '192.168.1.30', 9000],
      ['oq-192-168-1-30-9001', '192.168.1.30', 9001],
    ])
  })

  it('does not send twice when a selected pair is already covered by a broadcast or a host on the same port', () => {
    const targets = resolveDestinationTargets({
      selection: { allDevices: false, networks: ['192.168.1.0/24'], hosts: [], endpoints: [{ host: '192.168.1.30', port: 7090 }, { host: '192.168.1.30', port: 9000 }] },
      configTargets: CONFIG_TARGETS,
      subnets: SUBNETS,
      sendPort: 7090,
    })
    expect(sendTo(targets)).toEqual([['net-192-168-1-0-24', '192.168.1.255', 7090], ['oq-192-168-1-30-9000', '192.168.1.30', 9000]])
    const both = resolveDestinationTargets({
      selection: { allDevices: false, networks: [], hosts: ['192.168.1.30'], endpoints: [{ host: '192.168.1.30', port: 7090 }] },
      configTargets: CONFIG_TARGETS,
      subnets: SUBNETS,
      sendPort: 7090,
    })
    expect(sendTo(both)).toEqual([['ip-192-168-1-30', '192.168.1.30', 7090]])
  })

  it('does not send twice to a config target named by host name whose resolved address and port match a pair (HID-496)', () => {
    // backup は stage-pc(192.168.1.30 に解決)の 7092。同じアドレス・同じポートの組は足さず、別のポートの組だけ足す
    const targets = resolveDestinationTargets({
      selection: { allDevices: false, networks: [], hosts: ['stage-pc'], endpoints: [{ host: '192.168.1.30', port: 7092 }, { host: '192.168.1.30', port: 9000 }] },
      configTargets: CONFIG_TARGETS,
      subnets: SUBNETS,
      sendPort: 7090,
    })
    expect(sendTo(targets)).toEqual([['backup', 'stage-pc', 7092], ['oq-192-168-1-30-9000', '192.168.1.30', 9000]])
    // この PC を指す宛先はループバックの別名も同じ受信先(同じ PC の同じポート)
    const local = resolveDestinationTargets({
      selection: { allDevices: false, networks: [], hosts: ['192.168.1.10'], endpoints: [{ host: '127.0.0.1', port: 7090 }, { host: '192.168.1.10', port: 7090 }] },
      configTargets: CONFIG_TARGETS,
      subnets: SUBNETS,
      sendPort: 7090,
    })
    expect(sendTo(local)).toEqual([['ip-192-168-1-10', '192.168.1.10', 7090]])
  })

  it('still sends to a pair on another port when all devices is on, and drops pairs outside the networks', () => {
    const targets = resolveDestinationTargets({
      selection: { allDevices: true, networks: [], hosts: [], endpoints: [{ host: '192.168.1.30', port: 9000 }, { host: '10.9.9.9', port: 9000 }] },
      configTargets: CONFIG_TARGETS,
      subnets: SUBNETS,
      sendPort: 7090,
    })
    expect(sendTo(targets)).toEqual([['all-devices', '192.168.1.255', 7090], ['oq-192-168-1-30-9000', '192.168.1.30', 9000]])
  })

  it('lists services of a config target host outside the local networks (the loopback default)', () => {
    const devices = listDevices({
      subnets: SUBNETS,
      configTargets: [{ name: 'unity', host: '127.0.0.1', sendPort: 7090, primary: true, addresses: [] }],
      selectedHosts: [],
      discovered: [{ host: '127.0.0.1', name: 'Local', oscPort: 9001 }, { host: '127.0.0.2', name: 'Other', oscPort: 9002 }],
    })
    expect(devices.find(device => device.host === '127.0.0.1')).toMatchObject({ configured: true, found: true, services: [{ name: 'Local', oscPort: 9001 }] })
    expect(devices.some(device => device.host === '127.0.0.2')).toBe(false)
    // その組は選べて、OSC_PORT へ送る
    const targets = resolveDestinationTargets({
      selection: { allDevices: false, networks: [], hosts: [], endpoints: [{ host: '127.0.0.1', port: 9001 }] },
      configTargets: [{ name: 'unity', host: '127.0.0.1', sendPort: 7090, primary: true, addresses: [] }],
      subnets: SUBNETS,
      sendPort: 7090,
    })
    expect(targets?.map(target => [target.host, target.sendPort])).toEqual([['127.0.0.1', 9001]])
  })

  it('lists the OSCQuery targets of each device as services, keeping selected ones that are not found now', () => {
    const devices = listDevices({
      subnets: SUBNETS,
      configTargets: [],
      selectedHosts: [],
      discovered: [
        { host: '192.168.1.30', name: 'Unity', oscPort: 9001 },
        { host: '192.168.1.30', name: 'Other', oscPort: 9000 },
        { host: '192.168.1.31', name: 'Other', oscPort: 9000 },
        { host: '10.9.9.9', name: 'Far', oscPort: 9000 },
      ],
      selectedEndpoints: [{ host: '192.168.1.30', port: 9100 }],
    })
    expect(devices.map(device => [device.host, device.hostname, device.found, device.services])).toEqual([
      ['192.168.1.10', null, true, undefined],
      ['192.168.1.30', 'Unity', true, [{ name: 'Other', oscPort: 9000 }, { name: 'Unity', oscPort: 9001 }, { name: null, oscPort: 9100 }]],
      ['192.168.1.31', 'Other', true, [{ name: 'Other', oscPort: 9000 }]],
    ])
  })
})
describe('listDevices', () => {
  it('shows the OS host name for this PC', () => {
    const devices = listDevices({ subnets: SUBNETS, configTargets: [], selectedHosts: [], localHostname: 'control-pc' })
    expect(devices.map(device => [device.host, device.hostname])).toEqual([['192.168.1.10', 'control-pc']])
  })

  it('merges this PC, OSCQuery targets, config targets and selected hosts in IP order', () => {
    const devices = listDevices({
      subnets: SUBNETS,
      configTargets: CONFIG_TARGETS,
      selectedHosts: ['192.168.1.99'],
      discovered: [{ host: '192.168.1.40', name: null, oscPort: 9000 }, { host: '192.168.1.5', name: 'A', oscPort: 9000 }],
    })
    expect(devices.map(device => device.host)).toEqual(['192.168.1.5', '192.168.1.10', '192.168.1.20', '192.168.1.40', '192.168.1.99', 'stage-pc'])
    expect(devices.find(device => device.host === '192.168.1.10')).toMatchObject({ self: true, found: true, interface: 'Ethernet' })
    expect(devices.find(device => device.host === '192.168.1.40')).toMatchObject({ found: true, hostname: null })
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
  interfaces?: ScanInterface[]
  aliasStore?: DeviceAliasStore
  scanScope?: () => ScanScope
  discovered?: () => readonly { host: string; oscPort: number; name: string | null }[]
} = {}) {
  const store = options.store ?? memoryStore()
  const applied: (readonly RuntimeTargetSpec[])[] = []
  let current: readonly RuntimeTargetSpec[] = CONFIG_TARGETS
  const publish = vi.fn<(frame: DownstreamFrame, clientId?: string) => void>()
  const destinations = createDestinations({
    configTargets: CONFIG_TARGETS,
    sendPort: 7090,
    interfaces: () => options.interfaces ?? [NIC],
    localHostname: () => 'control-pc',
    store,
    ...(options.aliasStore === undefined ? {} : { aliasStore: options.aliasStore }),
    ...(options.scanScope === undefined ? {} : { scanScope: options.scanScope }),
    applyTargets: targets => { applied.push(targets); current = targets },
    // 既定は OSCQuery で 192.168.1.40 のアプリが 1 つ見つかっている
    discovered: options.discovered ?? (() => [{ host: '192.168.1.40', oscPort: 9000, name: null }]),
    currentTargets: () => current.map(target => ({ ...target, broadcast: target.broadcast ?? null })),
    primaryHosts: () => current.filter(target => target.primary).map(target => target.host),
    publish,
    logInfo: vi.fn(),
    logWarn: vi.fn(),
  })
  const lastFrame = () => publish.mock.calls.map(call => call[0]).filter(frame => frame.type === 'destinations').at(-1) as Extract<DownstreamFrame, { type: 'destinations' }>
  return { destinations, store, applied, publish, lastFrame }
}

describe('createDestinations with OSCQuery targets (D-168)', () => {
  const ports = (targets: readonly RuntimeTargetSpec[] | undefined) => targets?.map(target => `${target.host}:${String(target.sendPort)}`)

  it('selects two apps on one PC by host and OSC port, keeps them while mDNS loses them, and saves the pairs', () => {
    let found: { host: string; oscPort: number; name: string | null }[] = [
      { host: '192.168.1.30', oscPort: 9000, name: 'A' },
      { host: '192.168.1.30', oscPort: 9001, name: 'B' },
    ]
    const { destinations, applied, store, lastFrame } = setup({ discovered: () => found })
    destinations.start()
    destinations.handleUiFrame({ v: 1, type: 'destinationsSelect', allDevices: false, networks: [], hosts: [], endpoints: [{ host: '192.168.1.30', port: 9001 }] }, 'ui-1')
    expect(ports(applied.at(-1))).toEqual(['192.168.1.30:9001'])
    expect(store.saved?.endpoints).toEqual([{ host: '192.168.1.30', port: 9001 }])
    expect(lastFrame().selection.endpoints).toEqual([{ host: '192.168.1.30', port: 9001 }])
    expect(lastFrame().devices.find(device => device.host === '192.168.1.30')?.services).toEqual([{ name: 'A', oscPort: 9000 }, { name: 'B', oscPort: 9001 }])

    // 発見が消えても、ポートが変わっても、選んだ組へ送り続ける(別のアプリへ送り先を変えない)
    found = []
    destinations.discoveredChanged()
    expect(ports(applied.at(-1))).toEqual(['192.168.1.30:9001'])
    found = [{ host: '192.168.1.30', oscPort: 9100, name: 'B' }]
    destinations.discoveredChanged()
    expect(ports(applied.at(-1))).toEqual(['192.168.1.30:9001'])
    expect(lastFrame().devices.find(device => device.host === '192.168.1.30')?.services).toEqual([{ name: null, oscPort: 9001 }, { name: 'B', oscPort: 9100 }])
  })

  it('rejects a pair outside the local networks and restores saved pairs before OSCQuery has read the targets', () => {
    const { destinations, publish } = setup()
    destinations.start()
    destinations.handleUiFrame({ v: 1, type: 'destinationsSelect', allDevices: false, networks: [], hosts: [], endpoints: [{ host: '10.9.9.9', port: 9000 }] }, 'ui-1')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'notice', code: 'destinations-rejected', detail: 'invalid-endpoint: 10.9.9.9:9000' }), 'ui-1')

    const store = memoryStore({ allDevices: false, networks: [], hosts: [], endpoints: [{ host: '192.168.1.30', port: 9000 }, { host: '10.9.9.9', port: 9001 }] })
    const restored = setup({ store, discovered: () => [] })
    restored.destinations.start()
    expect(ports(restored.applied.at(-1))).toEqual(['192.168.1.30:9000'])
  })
})
describe('createDestinations', () => {
  it('narrows the devices and the selectable hosts to the target range on rescope (D-113)', () => {
    let scope: ScanScope = { targetInterface: null, targetRanges: [] }
    const { destinations, applied, publish, lastFrame } = setup({
      interfaces: [NIC, WIFI],
      scanScope: () => scope,
      discovered: () => [{ host: '192.168.1.40', oscPort: 9000, name: null }, { host: '10.0.0.7', oscPort: 9000, name: null }],
    })
    destinations.start()
    destinations.handleUiFrame({ v: 1, type: 'destinationsSelect', allDevices: false, networks: ['10.0.0.0/24'], hosts: ['192.168.1.40'] }, 'ui-1')
    expect(applied.at(-1)?.map(target => target.name)).toEqual(['net-10-0-0-0-24', 'ip-192-168-1-40'])
    expect(lastFrame().devices.map(device => device.host)).toContain('10.0.0.7')

    // 範囲を 192.168.1.32/28 にすると、Wi-Fi のネットワークと範囲の外の端末は消え、選択も検証し直す
    scope = { targetInterface: null, targetRanges: ['192.168.1.32/28'] }
    destinations.rescope()
    expect(lastFrame().broadcasts.map(entry => entry.network)).toEqual(['192.168.1.0/24'])
    expect(lastFrame().devices.map(device => device.host)).not.toContain('10.0.0.7')
    expect(applied.at(-1)?.map(target => target.name)).toEqual(['ip-192-168-1-40'])
    destinations.handleUiFrame({ v: 1, type: 'destinationsSelect', allDevices: false, networks: [], hosts: ['192.168.1.60'] }, 'ui-1')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ code: 'destinations-rejected', detail: 'invalid-host: 192.168.1.60' }), 'ui-1')
    // 設定ファイルの宛先は範囲の外でも選べる(設定を書いた人が決めた宛先)
    expect(isSelectableHost('192.168.1.20', CONFIG_TARGETS, [])).toBe(true)
  })

  it('lists this PC, the OSCQuery targets and the config targets with the config selection', () => {
    const { destinations, lastFrame, applied, publish } = setup()
    destinations.start()
    destinations.publish('ui-1')
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'destinations' }), 'ui-1')
    expect(applied).toEqual([])
    expect(lastFrame()).toMatchObject({
      type: 'destinations', sendPort: 7090,
      broadcasts: [{ address: '192.168.1.255', interface: 'Ethernet', network: '192.168.1.0/24' }],
      selection: { source: 'config', allDevices: false, networks: [], hosts: ['192.168.1.20', 'stage-pc'] },
      targets: [{ name: 'unity', primary: true, broadcast: false }, { name: 'backup', primary: false, broadcast: false }],
    })
    expect(lastFrame()).not.toHaveProperty('scanning')
    expect(lastFrame().devices.map(device => device.host)).toContain('192.168.1.40')
  })

  it('applies and saves a selection, and restores it on the next start', () => {
    const first = setup()
    first.destinations.start()
    expect(first.destinations.handleUiFrame({ v: 1, type: 'destinationsSelect', allDevices: false, networks: [], hosts: ['192.168.1.40'] }, 'ui-1')).toBe(true)
    expect(first.applied.at(-1)).toEqual([{ name: 'ip-192-168-1-40', host: '192.168.1.40', sendPort: 7090, primary: true }])
    expect(first.store.saved).toEqual({ allDevices: false, networks: [], hosts: ['192.168.1.40'] })
    expect(first.lastFrame()).toMatchObject({ selection: { source: 'saved', allDevices: false, networks: [], hosts: ['192.168.1.40'] } })

    const second = setup({ store: first.store })
    second.destinations.start()
    expect(second.applied[0]).toEqual([{ name: 'ip-192-168-1-40', host: '192.168.1.40', sendPort: 7090, primary: true }])
  })

  it('switches to the broadcast target for all devices and keeps the individual hosts for later', () => {
    const { destinations, applied, store } = setup()
    destinations.start()
    destinations.handleUiFrame({ v: 1, type: 'destinationsSelect', allDevices: true, networks: [], hosts: ['192.168.1.40'] }, 'ui-1')
    expect(applied.at(-1)).toEqual([expect.objectContaining({ name: 'all-devices', host: '192.168.1.255', primary: true })])
    expect(store.saved).toEqual({ allDevices: true, networks: [], hosts: ['192.168.1.40'] })
  })

  it('selects per-network all devices, rejects unknown networks and drops vanished ones on restore', () => {
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

  it('names this PC by its NIC MAC, follows it to a new IP and restores the names on the next start', () => {
    const aliasStore = createMemoryDeviceAliasStore()
    const interfaces = [{ ...NIC, mac: 'AA-BB-CC-DD-EE-0A' }]
    const { destinations, lastFrame, publish } = setup({ aliasStore, interfaces })
    destinations.start()
    const self = () => lastFrame().devices.find(device => device.self)
    publish.mockClear()
    destinations.handleUiFrame({ v: 1, type: 'destinationsAlias', host: '192.168.1.10', alias: ' 操作卓 ' }, 'ui-1')
    // 全 UI へ配り直す(要求元だけでなく)
    expect(publish.mock.calls.at(-1)?.[0].type).toBe('destinations')
    expect(publish.mock.calls.at(-1)?.[1]).toBeUndefined()
    expect(self()).toMatchObject({ mac: 'aa:bb:cc:dd:ee:0a', alias: '操作卓' })
    expect(aliasStore.load().get('mac:aa:bb:cc:dd:ee:0a')).toEqual({ alias: '操作卓', host: '192.168.1.10' })

    // DHCP でこの PC のアドレスが変わっても同じ MAC なら同じ名前
    interfaces.splice(0, 1, { ...interfaces[0]!, address: '192.168.1.11' })
    destinations.rescope()
    expect(self()).toMatchObject({ host: '192.168.1.11', alias: '操作卓' })
    expect(aliasStore.load().get('mac:aa:bb:cc:dd:ee:0a')?.host).toBe('192.168.1.11')

    const restarted = setup({ aliasStore, interfaces })
    restarted.destinations.start()
    restarted.destinations.publish()
    expect(restarted.lastFrame().devices.find(device => device.self)?.alias).toBe('操作卓')
  })

  it('keeps the MAC alias learned before (by the removed LAN scan) for a device that is not found now', () => {
    const aliasStore = createMemoryDeviceAliasStore()
    aliasStore.save(new Map([['mac:aa:bb:cc:dd:ee:28', { alias: 'ステージ左 iPad', host: '192.168.1.40' }]]))
    const { destinations, lastFrame } = setup({ aliasStore, discovered: () => [] , store: memoryStore({ allDevices: false, networks: [], hosts: ['192.168.1.40'] }) })
    destinations.start()
    destinations.publish()
    const device = () => lastFrame().devices.find(item => item.host === '192.168.1.40')
    expect(device()).toMatchObject({ found: false, mac: 'aa:bb:cc:dd:ee:28', alias: 'ステージ左 iPad' })
    // 改名・消去も MAC の別名を変える(host の別名だけを変えると、MAC の古い名前が勝つ)
    destinations.handleUiFrame({ v: 1, type: 'destinationsAlias', host: '192.168.1.40', alias: '改名' }, 'ui-1')
    expect(aliasStore.load()).toEqual(new Map([['mac:aa:bb:cc:dd:ee:28', { alias: '改名', host: '192.168.1.40' }]]))
    destinations.handleUiFrame({ v: 1, type: 'destinationsAlias', host: '192.168.1.40', alias: null }, 'ui-1')
    expect(aliasStore.load()).toEqual(new Map())
  })

  it('falls back to the host for devices without a MAC and clears both keys', () => {
    const aliasStore = createMemoryDeviceAliasStore()
    const { destinations, lastFrame } = setup({ aliasStore })
    destinations.start()
    // 設定の宛先(MAC が分からない)には host で名前を付けられる。ホスト名の宛先も同じ
    destinations.handleUiFrame({ v: 1, type: 'destinationsAlias', host: '192.168.1.20', alias: 'Unity 本番機' }, 'ui-1')
    destinations.handleUiFrame({ v: 1, type: 'destinationsAlias', host: 'stage-pc', alias: '舞台袖' }, 'ui-1')
    expect(aliasStore.load()).toEqual(new Map([['host:192.168.1.20', { alias: 'Unity 本番機' }], ['host:stage-pc', { alias: '舞台袖' }]]))
    expect(lastFrame().devices.find(device => device.host === 'stage-pc')?.alias).toBe('舞台袖')
    destinations.handleUiFrame({ v: 1, type: 'destinationsAlias', host: 'stage-pc', alias: null }, 'ui-1')
    destinations.handleUiFrame({ v: 1, type: 'destinationsAlias', host: '192.168.1.20', alias: '   ' }, 'ui-1')
    expect(aliasStore.load()).toEqual(new Map())
    expect(lastFrame().devices.every(device => device.alias === null)).toBe(true)
  })

  it('rejects names for unlisted hosts and invalid names, and reports a failed save', () => {
    const failing: DeviceAliasStore = { file: 'aliases.json', load: () => new Map(), save: () => false }
    const { destinations, publish, lastFrame } = setup({ aliasStore: failing })
    destinations.start()
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

  it('rejects invalid selections with a notice and re-sends the current state to the requester', () => {
    const { destinations, publish, applied } = setup({ interfaces: [] })
    destinations.start()
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

  it('rejects network, broadcast and outside addresses as individual hosts', () => {
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

  it('re-checks the individual selection when the networks change on rescope', () => {
    const interfaces = [NIC]
    const { destinations, applied, lastFrame } = setup({ interfaces })
    destinations.start()
    destinations.handleUiFrame({ v: 1, type: 'destinationsSelect', allDevices: false, networks: [], hosts: ['192.168.1.40', '192.168.1.20'] }, 'ui-1')
    expect(applied.at(-1)?.map(target => target.host)).toEqual(['192.168.1.40', '192.168.1.20'])

    // NIC が別のネットワークへ移った(「探し直す」で読み直す)。旧ネットワークの端末は落ち、設定の宛先のホストは残る
    interfaces.splice(0, 1, { ...NIC, address: '10.0.0.5' })
    destinations.rescope()
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

  it('moves the loopback alias when DHCP changes the address of this PC within the same network', () => {
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
    destinations.rescope()
    expect(applied).toHaveLength(before + 1)
    expect(applied.at(-1)).toEqual([
      { name: 'ip-192-168-1-10', host: '192.168.1.10', sendPort: 7090, primary: true },
      { name: 'ip-192-168-1-11', host: '192.168.1.11', sendPort: 7090, primary: false, addresses: ['127.0.0.1'] },
    ])
    // 変わらない読み直しでは適用し直さない
    destinations.rescope()
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

  it('goes back to the config targets on reset', () => {
    const { destinations, applied, store } = setup({ store: memoryStore({ allDevices: false, networks: [], hosts: ['192.168.1.40'] }) })
    destinations.start()
    destinations.handleUiFrame({ v: 1, type: 'destinationsReset' }, 'ui-1')
    expect(store.saved).toBeNull()
    expect(applied.at(-1)).toEqual(CONFIG_TARGETS)
  })
})
