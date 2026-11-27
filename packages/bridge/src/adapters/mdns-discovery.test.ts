import dgram from 'node:dgram'
import { EventEmitter } from 'node:events'

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

function discover(port: number, options: { interfaces?: () => readonly string[]; queryIntervalMs?: number } = {}) {
  const found: DiscoveredService[] = []
  const lost: string[] = []
  let notify = () => undefined as void
  const discovery: MdnsDiscovery = startMdnsDiscovery({
    interfaces: options.interfaces ?? (() => ['127.0.0.1']),
    port,
    queryIntervalMs: options.queryIntervalMs ?? 60_000,
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

  it('tells the found services again on renotify (to pick up ones the bridge refused before)', async () => {
    const port = await freeUdpPort()
    responder(port, 'Again', 9400)
    const { found, until, discovery } = discover(port)
    await until(() => found.length > 0)
    const before = found.length
    discovery.renotify()
    expect(found.length).toBe(before + 1)
    expect(found.at(-1)).toEqual({ instance: 'Again', host: '127.0.0.1', port: 9400 })
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

describe('startMdnsDiscovery の NIC の追従(HID-497)', () => {
  it('opens a socket on an NIC that appeared after the start when the discovery is refreshed', async () => {
    const port = await freeUdpPort()
    responder(port, 'Late', 9500)
    // LAN に未接続で起動した(探す NIC が無い)
    let nics: string[] = []
    const { found, until, discovery } = discover(port, { interfaces: () => nics })
    expect(discovery.state).toBe('failed')
    // Ethernet をつないだ後の osc.queryRefresh
    nics = ['127.0.0.1']
    discovery.query()
    await until(() => found.length > 0)
    expect(found[0]).toEqual({ instance: 'Late', host: '127.0.0.1', port: 9500 })
    expect(discovery.state).toBe('running')
  })

  it('follows a new NIC on the periodic query without a refresh', async () => {
    const port = await freeUdpPort()
    responder(port, 'Tick', 9501)
    let nics: string[] = []
    const { found, until } = discover(port, { interfaces: () => nics, queryIntervalMs: 50 })
    nics = ['127.0.0.1']
    await until(() => found.length > 0)
    expect(found[0]).toEqual({ instance: 'Tick', host: '127.0.0.1', port: 9501 })
  })

  // 実際のソケットの代わりに、作った・壊したを数える偽物で確かめる(開けなかった NIC を作り直す時機はソケットの外から見えないため)
  function fakeSockets() {
    const made: { address: string; socket: EventEmitter & { destroyed: boolean } }[] = []
    const create = ((opts: { interface: string }) => {
      const socket = Object.assign(new EventEmitter(), {
        destroyed: false,
        query: () => undefined,
        destroy() { this.destroyed = true },
      })
      made.push({ address: opts.interface, socket })
      return socket
    }) as unknown as Parameters<typeof startMdnsDiscovery>[0]['create']
    return { made, create }
  }

  it('closes the socket of an NIC that went away', () => {
    const { made, create } = fakeSockets()
    let nics = ['10.0.0.5', '192.168.1.5']
    const discovery = startMdnsDiscovery({ interfaces: () => nics, queryIntervalMs: 60_000, onFound: () => undefined, onLost: () => undefined, logWarn: () => undefined, create })
    cleanups.push(() => discovery.close())
    expect(made.map(entry => entry.address)).toEqual(['10.0.0.5', '192.168.1.5'])
    nics = ['192.168.1.5']
    discovery.refreshInterfaces()
    expect(made.map(entry => [entry.address, entry.socket.destroyed])).toEqual([['10.0.0.5', true], ['192.168.1.5', false]])
  })

  it('reopens a socket that failed only on query, and not again within 30 s (so a blocked NIC does not warn on every refresh)', () => {
    const { made, create } = fakeSockets()
    let clock = 1_000_000
    const warnings: string[] = []
    const discovery = startMdnsDiscovery({ interfaces: () => ['10.0.0.5'], queryIntervalMs: 60_000, onFound: () => undefined, onLost: () => undefined, logWarn: (...args) => warnings.push(args.join(' ')), now: () => clock, create })
    cleanups.push(() => discovery.close())
    made[0]?.socket.emit('error', new Error('EACCES'))
    expect(discovery.state).toBe('failed')
    discovery.refreshInterfaces()
    clock += 29_000
    discovery.query()
    expect(made).toHaveLength(1)
    clock += 1_000
    discovery.query()
    expect(made).toHaveLength(2)
    // 閉じたソケットに後から届いたエラーは警告しない
    const before = warnings.length
    made[0]?.socket.emit('error', new Error('late'))
    expect(warnings).toHaveLength(before)
    expect(made[0]?.socket.destroyed).toBe(true)
    made[1]?.socket.emit('ready')
    expect(discovery.state).toBe('running')
  })
})

it('keeps the current sockets when the NIC list cannot be read (instead of throwing from the query timer)', () => {
  const { made, create } = (() => {
    const list: string[] = []
    const fake = ((opts: { interface: string }) => {
      list.push(opts.interface)
      return Object.assign(new EventEmitter(), { query: () => undefined, destroy: () => undefined })
    }) as unknown as Parameters<typeof startMdnsDiscovery>[0]['create']
    return { made: list, create: fake }
  })()
  let fail = false
  const warnings: string[] = []
  const discovery = startMdnsDiscovery({
    interfaces: () => { if (fail) throw new Error('uv_interface_addresses'); return ['10.0.0.5'] },
    queryIntervalMs: 60_000, onFound: () => undefined, onLost: () => undefined, logWarn: (...args) => warnings.push(args.join(' ')), create,
  })
  cleanups.push(() => discovery.close())
  fail = true
  expect(() => discovery.query()).not.toThrow()
  expect(() => discovery.refreshInterfaces()).not.toThrow()
  expect(made).toEqual(['10.0.0.5'])
  expect(warnings.some(warning => warning.includes('uv_interface_addresses'))).toBe(true)
})

describe('instanceName', () => {
  it('strips the service suffix', () => {
    expect(instanceName('Unity 1._oscjson._tcp.local')).toBe('Unity 1')
    expect(instanceName('x._http._tcp.local')).toBeNull()
    expect(instanceName('._oscjson._tcp.local')).toBeNull()
  })
})
