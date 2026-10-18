import { describe, expect, it } from 'vitest'

import { intToIpv4, ipv4ToInt, isUnicastIpv4, maskOf, prefixLength } from './ipv4'
import { createSystemLanProber, parseArpTable, scanSubnets, selectNeighbors, type ScanInterface } from './lan-scan'

const nic = (address: string, netmask: string, extra: Partial<ScanInterface> = {}): ScanInterface => ({
  name: 'Ethernet', address, netmask, family: 'IPv4', internal: false, ...extra,
})

describe('ipv4 helpers', () => {
  it('round-trips addresses as unsigned integers', () => {
    expect(ipv4ToInt('192.168.1.255')).toBe(0xc0a801ff)
    expect(intToIpv4(0xc0a801ff)).toBe('192.168.1.255')
    expect(ipv4ToInt('256.0.0.1')).toBeNull()
    expect(ipv4ToInt('localhost')).toBeNull()
    expect(prefixLength(ipv4ToInt('255.255.255.0')!)).toBe(24)
    expect(prefixLength(ipv4ToInt('255.255.0.255')!)).toBeNull()
    expect(maskOf(22)).toBe(ipv4ToInt('255.255.252.0'))
    expect(isUnicastIpv4('192.168.1.10')).toBe(true)
    expect(isUnicastIpv4('224.0.0.1')).toBe(false)
    expect(isUnicastIpv4('0.0.0.0')).toBe(false)
  })
})

describe('scanSubnets', () => {
  it('scans the /24 of each external IPv4 interface, excluding itself', () => {
    const [subnet] = scanSubnets([nic('192.168.1.10', '255.255.255.0')])
    expect(subnet).toMatchObject({ interface: 'Ethernet', network: '192.168.1.0/24', broadcast: '192.168.1.255' })
    expect(subnet!.hosts).toHaveLength(253)
    expect(subnet!.hosts).not.toContain('192.168.1.10')
    expect(subnet!.hosts[0]).toBe('192.168.1.1')
    expect(subnet!.hosts.at(-1)).toBe('192.168.1.254')
  })

  it('limits a wider network to the /24 of the own address but keeps the real broadcast address', () => {
    const [subnet] = scanSubnets([nic('10.1.2.3', '255.255.0.0')])
    expect(subnet).toMatchObject({ network: '10.1.0.0/16', broadcast: '10.1.255.255' })
    expect(subnet!.hosts).toHaveLength(253)
    expect(subnet!.hosts.every(host => host.startsWith('10.1.2.'))).toBe(true)
  })

  it('skips loopback, IPv6, link-local, /31-/32 and duplicate networks', () => {
    const subnets = scanSubnets([
      nic('127.0.0.1', '255.0.0.0', { internal: true }),
      nic('fe80::1', 'ffff:ffff:ffff:ffff::', { family: 'IPv6' }),
      nic('169.254.10.20', '255.255.0.0'),
      nic('192.168.5.1', '255.255.255.254'),
      nic('192.168.1.10', '255.255.255.0'),
      nic('192.168.1.11', '255.255.255.0', { name: 'Wi-Fi' }),
    ])
    expect(subnets.map(subnet => subnet.network)).toEqual(['192.168.1.0/24'])
  })
})

describe('parseArpTable', () => {
  it('reads Windows, macOS and Linux outputs', () => {
    const windows = [
      'Interface: 192.168.1.10 --- 0x7',
      '  Internet Address      Physical Address      Type',
      '  192.168.1.1           aa-bb-cc-dd-ee-01     dynamic',
      '  192.168.1.20          aa-bb-cc-dd-ee-14     動的',
      '  192.168.1.255         ff-ff-ff-ff-ff-ff     static',
    ].join('\r\n')
    expect(parseArpTable(windows)).toEqual([
      { host: '192.168.1.1', mac: 'aa:bb:cc:dd:ee:01' },
      { host: '192.168.1.20', mac: 'aa:bb:cc:dd:ee:14' },
      { host: '192.168.1.255', mac: 'ff:ff:ff:ff:ff:ff' },
    ])
    expect(parseArpTable('? (192.168.1.30) at 0:1a:2b:3c:4d:5e on en0 ifscope [ethernet]\n? (192.168.1.31) at (incomplete) on en0'))
      .toEqual([{ host: '192.168.1.30', mac: '00:1a:2b:3c:4d:5e' }])
    expect(parseArpTable('IP address       HW type     Flags       HW address            Mask     Device\n192.168.1.40     0x1         0x2         52:54:00:12:34:56     *        eth0'))
      .toEqual([{ host: '192.168.1.40', mac: '52:54:00:12:34:56' }])
  })
})

describe('selectNeighbors', () => {
  it('keeps real devices of the scanned networks only', () => {
    const subnets = scanSubnets([nic('192.168.1.10', '255.255.255.0')])
    const kept = selectNeighbors([
      { host: '192.168.1.20', mac: 'aa:bb:cc:dd:ee:14' },
      { host: '192.168.1.20', mac: 'aa:bb:cc:dd:ee:14' },
      { host: '192.168.1.10', mac: 'aa:bb:cc:dd:ee:0a' },
      { host: '192.168.1.255', mac: 'ff:ff:ff:ff:ff:ff' },
      { host: '192.168.1.0', mac: 'aa:bb:cc:dd:ee:00' },
      { host: '192.168.1.50', mac: '00:00:00:00:00:00' },
      { host: '192.168.1.51', mac: '01:00:5e:00:00:fb' },
      { host: '10.0.0.1', mac: 'aa:bb:cc:dd:ee:ff' },
    ], subnets)
    expect(kept).toEqual([{ host: '192.168.1.20', mac: 'aa:bb:cc:dd:ee:14' }])
  })

  it('sends one probe per host, then reads the ARP table (both injected, so no real network is touched)', async () => {
    const sent: string[][] = []
    const prober = createSystemLanProber({
      settleMs: 0,
      sendProbes: async hosts => { sent.push([...hosts]) },
      readArpTable: async () => '  192.168.77.20   aa-bb-cc-dd-ee-14   dynamic\n  192.168.77.1   aa-bb-cc-dd-ee-01   dynamic',
    })
    const subnets = scanSubnets([nic('192.168.77.21', '255.255.255.0')])
    await expect(prober.probe(subnets)).resolves.toEqual([
      { host: '192.168.77.20', mac: 'aa:bb:cc:dd:ee:14' },
      { host: '192.168.77.1', mac: 'aa:bb:cc:dd:ee:01' },
    ])
    expect(sent).toHaveLength(1)
    expect(sent[0]).toHaveLength(253)
  })
})
