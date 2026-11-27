import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'

import { SYS } from '@oscdesk/shared'

import { parseCliArgs } from './index'
import { DEFAULT_OSCQUERY_NAMESPACE, startMockOscQueryServer, type MockOscQueryServer } from './oscquery-server'
import { MockUnityResponder } from './responder'

const servers: MockOscQueryServer[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close()
})

async function start() {
  const server = await startMockOscQueryServer({
    port: 0,
    host: '127.0.0.1',
    namespace: { CONTENTS: { a: { CONTENTS: { b: { TYPE: 'f', ACCESS: 3 } } } } },
    hostInfo: () => ({ NAME: 'mock', OSC_PORT: 9000, X_OSCDESK_BOOT_ID: 'boot-1' }),
  })
  servers.push(server)
  return server
}

describe('startMockOscQueryServer', () => {
  it('answers HOST_INFO, the tree with FULL_PATH filled in, a sub node and 204 for other attributes', async () => {
    const { port } = await start()
    const base = `http://127.0.0.1:${String(port)}`
    expect(await (await fetch(`${base}/?HOST_INFO`)).json()).toEqual({ NAME: 'mock', OSC_PORT: 9000, X_OSCDESK_BOOT_ID: 'boot-1' })
    expect(await (await fetch(`${base}/`)).json()).toEqual({
      FULL_PATH: '/',
      CONTENTS: { a: { FULL_PATH: '/a', CONTENTS: { b: { FULL_PATH: '/a/b', TYPE: 'f', ACCESS: 3 } } } },
    })
    expect(await (await fetch(`${base}/a/b`)).json()).toEqual({ FULL_PATH: '/a/b', TYPE: 'f', ACCESS: 3 })
    expect((await fetch(`${base}/a/b?VALUE`)).status).toBe(204)
    expect((await fetch(`${base}/nope`)).status).toBe(404)
    // 不正なパーセントエンコードは 400 で断り、その後も答え続ける
    expect((await fetch(`${base}/%`)).status).toBe(400)
    expect((await fetch(`${base}/?%E0%A4%A`)).status).toBe(400)
    expect((await fetch(`${base}/?HOST_INFO`)).status).toBe(200)
  })

  it('sends PATH_CHANGED over the WebSocket when the namespace changes', async () => {
    const server = await start()
    const socket = new WebSocket(`ws://127.0.0.1:${String(server.port)}/`)
    await new Promise(resolve => socket.once('open', resolve))
    const message = new Promise<string>(resolve => socket.once('message', data => resolve(data.toString())))
    server.setNamespace({ CONTENTS: {} })
    expect(JSON.parse(await message)).toEqual({ COMMAND: 'PATH_CHANGED', DATA: '/' })
    socket.close()
  })

  it('ships a sample namespace that covers the control kinds', () => {
    expect(Object.keys(DEFAULT_OSCQUERY_NAMESPACE.CONTENTS?.scene?.CONTENTS ?? {})).toContain('level')
  })
})

describe('boot id (D-164)', () => {
  it('adds the boot id to the pong as the second argument', () => {
    const responder = new MockUnityResponder()
    responder.bootId = 'boot-1'
    expect(responder.handlePacket({ address: SYS.PING, args: [{ type: 'i', value: 4 }] })).toEqual([
      { kind: 'message', packet: { address: SYS.PONG, args: [{ type: 'i', value: 4 }, { type: 's', value: 'boot-1' }] } },
    ])
  })

  it('parses the OSCQuery and mDNS flags', () => {
    expect(parseCliArgs(['--listen-port', '9000', '--oscquery-port', '0', '--oscquery-name', 'u', '--boot-id', 'b', '--mdns', '--mdns-port', '25353', '--mdns-address', '127.0.0.1']))
      .toMatchObject({ oscQuery: { port: 0, name: 'u' }, bootId: 'b', mdns: { port: 25353, address: '127.0.0.1' } })
    expect(() => parseCliArgs(['--listen-port', '9000', '--mdns'])).toThrow('--mdns needs --oscquery-port')
  })
})
