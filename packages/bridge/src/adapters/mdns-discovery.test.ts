import dgram from 'node:dgram'

import multicastDns from 'multicast-dns'
import { afterEach, describe, expect, it } from 'vitest'

import type { DiscoveredService } from '../domain/oscquery-targets'

import { instanceName, startMdnsDiscovery, type MdnsDiscovery } from './mdns-discovery'

// 実際のマルチキャストを、ループバックの NIC と空いている番号のポートだけで流す(5353 と LAN を使わないので、
// 並列のテストや手元の mDNS とぶつからない。D-133)
async function freeUdpPort(): Promise<number> {
  const socket = dgram.createSocket('udp4')
  await new Promise<void>(resolve => socket.bind(0, '127.0.0.1', resolve))
  const { port } = socket.address()
  await new Promise<void>(resolve => socket.close(() => resolve()))
  return port
}

const SERVICE = '_oscjson._tcp.local'
const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function responder(port: number, instance: string, httpPort: number, withSrv = true) {
  const socket = multicastDns({ port, interface: '127.0.0.1', bind: '0.0.0.0', reuseAddr: true, loopback: true })
  const fullName = `${instance}.${SERVICE}`
  const records = (ttl: number) => ({
    answers: [{ name: SERVICE, type: 'PTR', ttl, data: fullName }],
    additionals: withSrv
      ? [
          { name: fullName, type: 'SRV', ttl, data: { port: httpPort, target: 'mock.local' } },
          { name: fullName, type: 'TXT', ttl, data: ['txtvers=1'] },
          // A レコードは信じない(送信元のアドレスを読む)。ほかのアドレスを名乗っても送信元になる
          { name: 'mock.local', type: 'A', ttl, data: '10.9.9.9' },
        ]
      : [],
  })
  socket.on('query', packet => {
    for (const question of packet.questions ?? []) {
      if (question.name === SERVICE) socket.respond(records(120))
      if (question.name === fullName && question.type === 'SRV') {
        socket.respond({ answers: [{ name: fullName, type: 'SRV', ttl: 120, data: { port: httpPort, target: 'mock.local' } }], additionals: [{ name: 'mock.local', type: 'A', ttl: 120, data: '127.0.0.1' }] })
      }
    }
  })
  cleanups.push(() => socket.destroy())
  return { goodbye: () => socket.respond(records(0)) }
}

function discover(port: number) {
  const found: DiscoveredService[] = []
  const lost: string[] = []
  let notify = () => undefined as void
  const discovery: MdnsDiscovery = startMdnsDiscovery({
    interfaces: ['127.0.0.1'],
    port,
    queryIntervalMs: 60_000,
    onFound: service => { found.push(service); notify() },
    onLost: instance => { lost.push(instance); notify() },
    logWarn: () => undefined,
  })
  cleanups.push(() => discovery.close())
  const until = (check: () => boolean) => new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timed out')), 5_000)
    notify = () => {
      if (check()) {
        clearTimeout(timeout)
        resolve()
      }
    }
    notify()
  })
  return { discovery, found, lost, until }
}

describe('startMdnsDiscovery', () => {
  it('finds a service with the SRV port at the sender address (not the claimed A address), and drops it on goodbye', async () => {
    const port = await freeUdpPort()
    const target = responder(port, 'Unity-9100', 9100)
    const { found, lost, until, discovery } = discover(port)
    await until(() => found.length > 0)
    expect(found[0]).toEqual({ instance: 'Unity-9100', host: '127.0.0.1', port: 9100 })
    expect(discovery.state).toBe('running')
    target.goodbye()
    await until(() => lost.length > 0)
    expect(lost).toEqual(['Unity-9100'])
  })

  it('asks for the SRV when the answer has only the PTR', async () => {
    const port = await freeUdpPort()
    responder(port, 'Bare', 9200, false)
    const { found, until } = discover(port)
    await until(() => found.length > 0)
    expect(found[0]).toEqual({ instance: 'Bare', host: '127.0.0.1', port: 9200 })
  })

  it('tells two targets on the same PC apart by the instance name', async () => {
    const port = await freeUdpPort()
    responder(port, 'A-1', 9301)
    responder(port, 'B-2', 9302)
    const { found, until } = discover(port)
    await until(() => new Set(found.map(service => service.instance)).size === 2)
    expect(new Set(found.map(service => `${service.instance}:${String(service.port)}`))).toEqual(new Set(['A-1:9301', 'B-2:9302']))
  })
})

describe('instanceName', () => {
  it('strips the service suffix', () => {
    expect(instanceName('Unity 1._oscjson._tcp.local')).toBe('Unity 1')
    expect(instanceName('x._http._tcp.local')).toBeNull()
    expect(instanceName('._oscjson._tcp.local')).toBeNull()
  })
})
