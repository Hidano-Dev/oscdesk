import dgram from 'node:dgram'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import type { DownstreamFrame, SentLogRecord } from '../../packages/shared/src'

import { startBridge, type BridgeProcess } from './helpers/bridge'
import { reserveTcpPort, reserveUdpPort } from './helpers/ports'
import { connectWsE2eClient, type WsE2eClient } from './helpers/ws-client'

// HID-256 / D-067: ブリッジが Unity へ送った OSC を送信ログとして UI へ配り、後から接続した UI には既存分を送る
function listen(socket: dgram.Socket): Promise<number> {
  return new Promise((resolve) => socket.bind(0, '127.0.0.1', () => resolve(socket.address().port)))
}

const recordsOf = (frame: DownstreamFrame): SentLogRecord[] => frame.type === 'osc.sentLog' ? frame.records : []

describe('sent OSC log (HID-256)', () => {
  let workDir: string
  let bridge: BridgeProcess | undefined
  const clients: WsE2eClient[] = []
  let unity: dgram.Socket | undefined

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-e2e-sentlog-'))
  })

  afterEach(async () => {
    for (const client of clients.splice(0)) await client.close().catch(() => undefined)
    await bridge?.stop().catch(() => undefined)
    bridge = undefined
    unity?.close()
    unity = undefined
    fs.rmSync(workDir, { recursive: true, force: true })
  })

  test('UI sends and batches are pushed to every UI and replayed to a UI that connects later', async () => {
    unity = dgram.createSocket('udp4')
    const unityPort = await listen(unity)
    const configPath = path.join(workDir, 'config.json')
    fs.writeFileSync(configPath, JSON.stringify({
      unity: { host: '127.0.0.1', sendPort: unityPort },
      bridge: {},
      debug: false,
      boolFallbackToInt: false,
      surfaces: { dir: path.join(workDir, 'surfaces') },
    }))
    bridge = await startBridge({ configPath, wsPort: await reserveTcpPort(), oscListenPort: await reserveUdpPort(), readyTimeoutMs: 30_000 })
    const url = `ws://127.0.0.1:${String(bridge.ready.wsPort)}`

    const first = await connectWsE2eClient(url)
    clients.push(first)
    // 接続直後は hello・link の後に既存分(空)が full で届く
    expect(await first.waitForFrame(frame => frame.type === 'osc.sentLog')).toEqual({ v: 1, type: 'osc.sentLog', full: true, records: [] })

    first.sendOsc('/mix/master', [{ type: 'f', value: 0.25 }])
    first.sendOsc('/mix/master', [{ type: 'f', value: 0.5 }])
    first.send({ v: 1, type: 'osc.batch', messages: [
      { address: '/slot/01', args: [{ type: 'i', value: 1 }] },
      { address: '/cue/apply', args: [] },
    ] })

    // 間引きで 1 フレームにまとまって届く(同じアドレスの連続送信は 1 件で count 2)
    const seen = new Map<number, SentLogRecord>()
    while (![...seen.values()].some(record => record.address === '/cue/apply')) {
      for (const record of recordsOf(await first.waitForFrame(frame => frame.type === 'osc.sentLog'))) seen.set(record.seq, record)
    }
    const records = [...seen.values()].sort((a, b) => a.seq - b.seq)
    expect(records.map(record => [record.origin, record.address, record.count, record.batch])).toEqual([
      ['ui', '/mix/master', 2, null],
      ['action', '/slot/01', 1, { id: 1, index: 0, size: 2 }],
      ['action', '/cue/apply', 1, { id: 1, index: 1, size: 2 }],
    ])
    expect(records[0]!.args).toEqual([{ type: 'f', value: 0.5 }])
    expect(records[0]!.targets).toEqual(['unity'])

    const later = await connectWsE2eClient(url)
    clients.push(later)
    const backlog = await later.waitForFrame(frame => frame.type === 'osc.sentLog')
    expect(backlog.type === 'osc.sentLog' && backlog.full).toBe(true)
    expect(recordsOf(backlog).map(record => record.address)).toEqual(['/mix/master', '/slot/01', '/cue/apply'])
  }, 60_000)
})
