import dgram from 'node:dgram'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import type { DownstreamFrame, SentLogRecord } from '../../packages/shared/src'

import { startBridge, type BridgeProcess } from './helpers/bridge'
import { reserveTcpPort, reserveUdpPort } from './helpers/ports'
import { connectWsE2eClient, type WsE2eClient } from './helpers/ws-client'

// HID-492: パッドのトグル(type 'T')とボタンの引数 { type: 'T' } / { type: 'F' } は、OSC 1.0 の T / F の型タグで Unity へ届く。
// 型タグは引数のバイトを持たないので、データグラムの型タグ文字列とその後ろのバイト数で確かめる(i の 0/1 に化けていないこと)
function listen(socket: dgram.Socket): Promise<number> {
  return new Promise((resolve) => socket.bind(0, '127.0.0.1', () => resolve(socket.address().port)))
}

/** OSC の文字列(NUL 終端・4 バイト境界)を offset から読む */
function readOscString(bytes: Buffer, offset: number): { text: string; next: number } {
  const end = bytes.indexOf(0, offset)
  return { text: bytes.toString('utf8', offset, end), next: (end + 4) & ~3 }
}

function parseHead(bytes: Buffer): { address: string; typeTags: string; argBytes: Buffer } {
  const address = readOscString(bytes, 0)
  const tags = readOscString(bytes, address.next)
  return { address: address.text, typeTags: tags.text, argBytes: bytes.subarray(tags.next) }
}

// まとめ送り(osc.batch)は 1 つのバンドルで届く。中のメッセージを順に取り出す
function messagesOf(bytes: Buffer): Buffer[] {
  if (bytes.toString('latin1', 0, 8) !== '#bundle\u0000') return [bytes]
  const messages: Buffer[] = []
  for (let offset = 16; offset < bytes.length;) {
    const size = bytes.readInt32BE(offset)
    messages.push(...messagesOf(bytes.subarray(offset + 4, offset + 4 + size)))
    offset += 4 + size
  }
  return messages
}

const recordsOf = (frame: DownstreamFrame): SentLogRecord[] => frame.type === 'osc.sentLog' ? frame.records : []

describe('OSC T / F type tags (HID-492)', () => {
  let workDir: string
  let bridge: BridgeProcess | undefined
  let client: WsE2eClient | undefined
  let unity: dgram.Socket | undefined

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-e2e-booltags-'))
  })

  afterEach(async () => {
    await client?.close().catch(() => undefined)
    client = undefined
    await bridge?.stop().catch(() => undefined)
    bridge = undefined
    unity?.close()
    unity = undefined
    fs.rmSync(workDir, { recursive: true, force: true })
  })

  test('UI sends T / F as value-less type tags, the sent log keeps them, and Unity echoes come back as T / F', async () => {
    unity = dgram.createSocket('udp4')
    const unityPort = await listen(unity)
    const received: Buffer[] = []
    unity.on('message', (buffer) => {
      if (!buffer.toString('latin1', 0, 5).startsWith('/sys/')) received.push(buffer)
    })
    const configPath = path.join(workDir, 'config.json')
    fs.writeFileSync(configPath, JSON.stringify({
      unity: { host: '127.0.0.1', sendPort: unityPort },
      bridge: {},
      debug: false,
      boolFallbackToInt: false,
      surfaces: { dir: path.join(workDir, 'surfaces') },
    }))
    bridge = await startBridge({ configPath, wsPort: await reserveTcpPort(), oscListenPort: await reserveUdpPort(), readyTimeoutMs: 30_000 })
    client = await connectWsE2eClient(`ws://127.0.0.1:${String(bridge.ready.wsPort)}`)
    await client.waitForFrame(frame => frame.type === 'osc.sentLog')

    client.sendOsc('/pad/light', [{ type: 'T' }])
    client.send({ v: 1, type: 'osc.batch', messages: [{ address: '/pad/mix', args: [{ type: 'F' }, { type: 'i', value: 7 }] }] })

    const deadline = Date.now() + 10_000
    while (received.length < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
    const heads = received.flatMap(messagesOf).map(parseHead)
    expect(heads.map(head => [head.address, head.typeTags, head.argBytes.toString('hex')])).toEqual([
      ['/pad/light', ',T', ''],
      ['/pad/mix', ',Fi', '00000007'],
    ])

    // 送信ログ(D-067)も値を持たない T / F のまま配る
    const seen = new Map<number, SentLogRecord>()
    while (![...seen.values()].some(record => record.address === '/pad/mix')) {
      for (const record of recordsOf(await client.waitForFrame(frame => frame.type === 'osc.sentLog'))) seen.set(record.seq, record)
    }
    expect([...seen.values()].sort((a, b) => a.seq - b.seq).map(record => [record.address, record.args])).toEqual([
      ['/pad/light', [{ type: 'T' }]],
      ['/pad/mix', [{ type: 'F' }, { type: 'i', value: 7 }]],
    ])

    // Unity からのエコー(同じアドレスへ T / F)は、UI へ値を持たない T / F の引数で届く
    const echo = Buffer.from('2f7061642f6c6967687400002c544600', 'hex')
    expect(parseHead(echo)).toMatchObject({ address: '/pad/light', typeTags: ',TF' })
    await new Promise<void>((resolve, reject) => unity!.send(echo, bridge!.ready.oscListenPort, '127.0.0.1', error => error ? reject(error) : resolve()))
    const message = await client.waitForFrame(frame => frame.type === 'osc.message' && frame.address === '/pad/light', 10_000)
    expect(message.type === 'osc.message' && message.args).toEqual([{ type: 'T' }, { type: 'F' }])
  }, 60_000)

  test('a T / F argument with a value is rejected without closing the connection', async () => {
    unity = dgram.createSocket('udp4')
    const unityPort = await listen(unity)
    bridge = await startBridge({ wsPort: await reserveTcpPort(), oscListenPort: await reserveUdpPort(), unityHost: '127.0.0.1', unityPort, readyTimeoutMs: 30_000 })
    client = await connectWsE2eClient(`ws://127.0.0.1:${String(bridge.ready.wsPort)}`)
    await client.waitForFrame(frame => frame.type === 'hello')
    const received: Buffer[] = []
    unity.on('message', (buffer) => {
      if (!buffer.toString('latin1', 0, 5).startsWith('/sys/')) received.push(buffer)
    })
    // value 付きの T は、どちらの真偽か食い違うので断る
    client.sendRaw(JSON.stringify({ v: 1, type: 'osc.message', address: '/pad/light', args: [{ type: 'T', value: false }] }))
    const notice = await client.waitForFrame(frame => frame.type === 'notice', 10_000)
    expect(notice).toMatchObject({ type: 'notice', code: 'invalid-frame', level: 'warn', detail: 'schema-error' })
    // 断った後も接続は保たれ(不正フレームはそのフレームだけを捨てる)、次の正しい T は届く
    expect(client.isOpen).toBe(true)
    client.sendOsc('/pad/light', [{ type: 'F' }])
    const deadline = Date.now() + 10_000
    while (received.length < 1 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
    expect(received.map(buffer => [parseHead(buffer).address, parseHead(buffer).typeTags])).toEqual([['/pad/light', ',F']])
  }, 60_000)
})
