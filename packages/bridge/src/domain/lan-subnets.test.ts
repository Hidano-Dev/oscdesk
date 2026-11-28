import { describe, expect, it } from 'vitest'

import { intToIpv4, ipv4ToInt, isUnicastIpv4, maskOf, prefixLength } from './ipv4'
import { inScanRanges, normalizeMac, scanSubnets, scopedScanSubnets, type ScanInterface } from './lan-subnets'

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

describe('normalizeMac', () => {
  it('normalizes the NIC MAC and drops the all-zero placeholder', () => {
    expect(normalizeMac('AA-BB-CC-DD-EE-0A')).toBe('aa:bb:cc:dd:ee:0a')
    expect(normalizeMac('a:b:c:d:e:f')).toBe('0a:0b:0c:0d:0e:0f')
    expect(normalizeMac('00:00:00:00:00:00')).toBeNull()
    expect(normalizeMac('not-a-mac')).toBeNull()
    expect(normalizeMac(undefined)).toBeNull()
    // この PC のネットワークに NIC の MAC を持たせる(この PC の別名のキー。D-092)
    expect(scanSubnets([nic('192.168.1.10', '255.255.255.0', { mac: 'AA:BB:CC:DD:EE:0A' })])[0]?.mac).toBe('aa:bb:cc:dd:ee:0a')
  })
})

describe('scanSubnets', () => {
  it('takes the real network and broadcast address of each external IPv4 interface', () => {
    expect(scanSubnets([nic('192.168.1.10', '255.255.255.0')])[0]).toMatchObject({ interface: 'Ethernet', network: '192.168.1.0/24', broadcast: '192.168.1.255' })
    expect(scanSubnets([nic('10.1.2.3', '255.255.0.0')])[0]).toMatchObject({ network: '10.1.0.0/16', broadcast: '10.1.255.255' })
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

describe('scopedScanSubnets (D-113)', () => {
  const lan = nic('192.168.1.10', '255.255.255.0')
  const wifi = nic('10.0.0.20', '255.255.0.0', { name: 'Wi-Fi' })

  it('is every network when nothing is chosen', () => {
    expect(scopedScanSubnets([lan, wifi], { targetInterface: null, targetRanges: [] })).toEqual(scanSubnets([lan, wifi]))
  })

  it('keeps only the network of the chosen target interface', () => {
    expect(scopedScanSubnets([lan, wifi], { targetInterface: '10.0.0.20', targetRanges: [] }).map(subnet => subnet.network)).toEqual(['10.0.0.0/16'])
    expect(scopedScanSubnets([lan, wifi], { targetInterface: '127.0.0.1', targetRanges: [] })).toEqual([])
  })

  it('keeps the overlap with the target range and drops networks outside every range', () => {
    const [subnet, ...rest] = scopedScanSubnets([lan, wifi], { targetInterface: null, targetRanges: ['192.168.1.8/30', '172.16.0.0/24'] })
    expect(rest).toEqual([])
    // ネットワークとブロードキャストは NIC のまま、端末は範囲の中だけ
    expect(subnet).toMatchObject({ network: '192.168.1.0/24', broadcast: '192.168.1.255' })
    expect(inScanRanges('192.168.1.9', subnet!)).toBe(true)
    expect(inScanRanges('192.168.1.20', subnet!)).toBe(false)
  })
})
