import dgram from 'node:dgram'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { SYS, StatsPayloadSchema } from '@oscdesk/shared'
import type { OscMessagePacket, OscPacket } from '@oscdesk/shared'
import { decodeOscPacket, encodeOscPacket } from '@oscdesk/osc-codec'

import { MockUnityResponder } from './responder'
import { ScenarioRuntime, loadScenarioDefinition } from './scenario'
import { startMockUnityServer } from './server'

describe('startMockUnityServer', () => {
  const resources: Array<{ close(): Promise<void> }> = []

  afterEach(async () => {
    while (resources.length > 0) {
      await resources.pop()?.close()
    }
  })

  it('responds to ping on UDP and uses the incoming sender by default', async () => {
    const server = await startMockUnityServer({
      listenPort: 0,
      host: '127.0.0.1',
    })
    resources.push(server)

    const client = await createUdpClient()
    resources.push(client)

    const reply = await request(client.socket, {
      to: { host: '127.0.0.1', port: server.listenPort },
      packet: {
        address: SYS.PING,
        args: [{ type: 'i', value: 11 }],
      },
    })

    expect(reply).toEqual({
      address: SYS.PONG,
      args: [{ type: 'i', value: 11 }],
    })
  })

  it('warns once per size when the manifest approaches the single-datagram limit', async () => {
    const warnings: string[] = []
    const errors: string[] = []
    // 警告閾値(48KB)を超え、実用上限(60KB)には収まるダミー JSON
    const largeManifest = JSON.stringify({ version: 1, projectId: 'x'.repeat(50 * 1024), entries: [] })
    const runtime = new ScenarioRuntime({
      projectId: 'oscdesk-demo',
      entries: [],
      rawManifestOverride: largeManifest,
    })
    const server = await startMockUnityServer({
      listenPort: 0,
      host: '127.0.0.1',
      responder: new MockUnityResponder(undefined, runtime),
      log: {
        error(message: string) {
          errors.push(message)
        },
        warn(message: string) {
          warnings.push(message)
        },
      },
    })
    resources.push(server)

    const client = await createUdpClient()
    resources.push(client)

    for (let i = 0; i < 2; i += 1) {
      const reply = await request(client.socket, {
        to: { host: '127.0.0.1', port: server.listenPort },
        packet: { address: SYS.MANIFEST_REQUEST, args: [] },
      })
      expect(reply.address).toBe(SYS.MANIFEST)
    }

    expect(errors).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/\/sys\/manifest is 50\.\d KB/)
    expect(warnings[0]).toContain('approaching the practical single-datagram limit of 60.0 KB')
  })

  it('does not warn for a manifest well under the warning threshold', async () => {
    const warnings: string[] = []
    const runtime = new ScenarioRuntime(
      loadScenarioDefinition(path.resolve(__dirname, '../scenarios/default.json')),
    )
    const server = await startMockUnityServer({
      listenPort: 0,
      host: '127.0.0.1',
      responder: new MockUnityResponder(undefined, runtime),
      log: {
        error() {},
        warn(message: string) {
          warnings.push(message)
        },
      },
    })
    resources.push(server)

    const client = await createUdpClient()
    resources.push(client)

    const reply = await request(client.socket, {
      to: { host: '127.0.0.1', port: server.listenPort },
      packet: { address: SYS.MANIFEST_REQUEST, args: [] },
    })
    expect(reply.address).toBe(SYS.MANIFEST)
    expect(warnings).toEqual([])
  })

  it('increments parseErrors after malformed datagrams and reports them via /sys/stats', async () => {
    const errors: string[] = []
    const server = await startMockUnityServer({
      listenPort: 0,
      host: '127.0.0.1',
      log: {
        error(message: string) {
          errors.push(message)
        },
      },
    })
    resources.push(server)

    const client = await createUdpClient()
    resources.push(client)

    await sendRaw(client.socket, Uint8Array.from([0xde, 0xad, 0xbe, 0xef]), server.listenPort)

    const reply = await request(client.socket, {
      to: { host: '127.0.0.1', port: server.listenPort },
      packet: {
        address: SYS.STATS_REQUEST,
        args: [],
      },
    })

    expect(reply.address).toBe(SYS.STATS)
    expect(reply.args).toHaveLength(1)
    expect(reply.args[0]?.type).toBe('s')

    const payload = StatsPayloadSchema.parse(JSON.parse(String(reply.args[0]?.value)))
    expect(payload.parseErrors).toBe(1)
    expect(payload.received).toBe(1)
    expect(errors[0]).toContain('Failed to decode OSC packet')
  })

  it('sends startup replies after the socket begins listening', async () => {
    const client = await createUdpClient()
    resources.push(client)
    const startup = new Promise<OscPacket>((resolve, reject) => {
      const timeout = setTimeout(() => {
        client.socket.off('message', handleMessage)
        reject(new Error('Timed out waiting for startup reply.'))
      }, 2000)
      const handleMessage = (data: Buffer) => {
        clearTimeout(timeout)
        client.socket.off('message', handleMessage)
        resolve(decodeOscPacket(data))
      }
      client.socket.on('message', handleMessage)
    })

    const server = await startMockUnityServer({
      listenPort: 0,
      host: '127.0.0.1',
      replyTarget: {
        host: '127.0.0.1',
        port: client.socket.address().port,
      },
      startupReplies: [
        {
          kind: 'message',
          packet: {
            address: SYS.MANIFEST,
            args: [{ type: 's', value: '{"version":1,"projectId":"oscdesk-demo","entries":[]}' }],
          },
        },
      ],
    })
    resources.push(server)

    const packet = await startup
    expect(packet).toMatchObject({
      address: SYS.MANIFEST,
      args: [{ type: 's', value: expect.stringContaining('"projectId":"oscdesk-demo"') }],
    })
  })

  it('observes each staging apply once instead of replaying the log on every datagram', async () => {
    const applied: string[] = []
    const server = await startMockUnityServer({
      listenPort: 0,
      host: '127.0.0.1',
      responder: new MockUnityResponder(
        { now: () => new Date(0) },
        new ScenarioRuntime(
          loadScenarioDefinition(path.resolve(__dirname, '../scenarios/staging.json')),
        ),
      ),
      onStagingApply: (record) => {
        applied.push(`${record.triggerAddress} ${record.values.length}`)
      },
    })
    resources.push(server)

    const client = await createUdpClient()
    resources.push(client)

    // 1 押下は押下 1 / 解放 0 の 2 メッセージ。適用は非ゼロの 1 回だけ成立する
    await request(client.socket, {
      to: { host: '127.0.0.1', port: server.listenPort },
      packet: { address: '/member/01/name', args: [{ type: 's', value: 'Alicia' }] },
    })
    await request(client.socket, {
      to: { host: '127.0.0.1', port: server.listenPort },
      packet: { address: '/member/01/update', args: [{ type: 'i', value: 1 }] },
    })
    await request(client.socket, {
      to: { host: '127.0.0.1', port: server.listenPort },
      packet: { address: '/member/01/update', args: [{ type: 'i', value: 0 }] },
    })
    await request(client.socket, {
      to: { host: '127.0.0.1', port: server.listenPort },
      packet: { address: SYS.PING, args: [{ type: 'i', value: 1 }] },
    })

    // 適用は 1 回だけ観測される。値数 2 は name と enabled(既定値投入分)
    expect(applied).toEqual(['/member/01/update 2'])
  })
})

async function createUdpClient() {
  const socket = dgram.createSocket('udp4')
  await bindSocket(socket, 0, '127.0.0.1')

  return {
    socket,
    async close() {
      await closeSocket(socket)
    },
  }
}

async function request(
  socket: dgram.Socket,
  options: {
    to: { host: string; port: number }
    packet: OscMessagePacket
  },
) {
  const response = new Promise<OscPacket>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('Timed out waiting for UDP reply.'))
    }, 2000)

    const handleMessage = (data: Buffer) => {
      cleanup()
      resolve(decodeOscPacket(data))
    }

    const cleanup = () => {
      clearTimeout(timeout)
      socket.off('message', handleMessage)
    }

    socket.on('message', handleMessage)
  })

  await sendPacket(socket, encodeOscPacket(options.packet), options.to.port, options.to.host)
  const packet = await response

  if (!('address' in packet)) {
    throw new Error('Expected OSC message packet.')
  }

  return packet
}

function sendRaw(socket: dgram.Socket, data: Uint8Array, port: number): Promise<void> {
  return sendPacket(socket, data, port, '127.0.0.1')
}

function sendPacket(socket: dgram.Socket, data: Uint8Array, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.send(data, port, host, (error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

function bindSocket(socket: dgram.Socket, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const handleListening = () => {
      cleanup()
      resolve()
    }

    const handleError = (error: Error) => {
      cleanup()
      reject(error)
    }

    const cleanup = () => {
      socket.off('listening', handleListening)
      socket.off('error', handleError)
    }

    socket.once('listening', handleListening)
    socket.once('error', handleError)
    socket.bind(port, host)
  })
}

function closeSocket(socket: dgram.Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.close(() => {
      resolve()
    })
  })
}
