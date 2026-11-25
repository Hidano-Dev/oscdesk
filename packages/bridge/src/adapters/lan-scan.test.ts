import { describe, expect, it, vi } from 'vitest'

import { scanSubnets, type ScanInterface } from '../domain/lan-subnets'
import { createSystemLanProber } from './lan-scan'

const nic = (address: string, netmask: string, extra: Partial<ScanInterface> = {}): ScanInterface => ({
  name: 'Ethernet', address, netmask, family: 'IPv4', internal: false, ...extra,
})

describe('createSystemLanProber', () => {
  it('sends one probe per host, then reads the ARP table (both injected, so no real network is touched)', async () => {
    const sent: string[][] = []
    const prober = createSystemLanProber({
      settleMs: 0,
      sendProbes: async hosts => { sent.push([...hosts]) },
      readArpTable: async () => '  192.168.77.20   aa-bb-cc-dd-ee-14   dynamic\n  192.168.77.1   aa-bb-cc-dd-ee-01   dynamic',
    })
    const subnets = scanSubnets([nic('192.168.77.21', '255.255.255.0')])
    await expect(prober.probe(subnets, new AbortController().signal)).resolves.toEqual([
      { host: '192.168.77.20', mac: 'aa:bb:cc:dd:ee:14' },
      { host: '192.168.77.1', mac: 'aa:bb:cc:dd:ee:01' },
    ])
    expect(sent).toHaveLength(1)
    expect(sent[0]).toHaveLength(253)
  })

  it('stops waiting and never reads the ARP table once aborted', async () => {
    const readArpTable = vi.fn(async () => '')
    const prober = createSystemLanProber({ settleMs: 60_000, sendProbes: async () => undefined, readArpTable })
    const controller = new AbortController()
    const probing = prober.probe(scanSubnets([nic('192.168.77.21', '255.255.255.0')]), controller.signal)
    controller.abort(new Error('timed out'))
    await expect(probing).rejects.toThrow()
    expect(readArpTable).not.toHaveBeenCalled()
  })
})
