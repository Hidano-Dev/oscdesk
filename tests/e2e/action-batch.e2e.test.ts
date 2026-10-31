import dgram from 'node:dgram'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { decodeOscPacket, encodeOscPacket } from '../../packages/osc-codec/src'
import { collectSurfaceDefinitionIssues, resolveActionSteps, type SurfaceDefinitionStructure } from '../../packages/shared/src'

import { startBridge, type BridgeProcess } from './helpers/bridge'
import { reserveTcpPort, reserveUdpPort } from './helpers/ports'
import { connectWsE2eClient, type WsE2eClient } from './helpers/ws-client'

// HID-166: スロットの部品は standalone:false(操作しても単独では送らない)で、アクションを押したときだけ
// 1 つの oscBatch(= 1 OSC bundle)にまとまって Unity へ届く。
const DEFINITION: SurfaceDefinitionStructure = {
  format: 'oscdesk-surface',
  version: 1,
  name: 'Slots',
  parameters: [
    { id: 'slot01', address: '/slot/01', label: 'Slot 1', type: 'f', kind: 'state', range: [0, 1], default: 0, standalone: false },
    { id: 'slot02', address: '/slot/02', label: 'Slot 2', type: 'f', kind: 'state', range: [0, 1], default: 0, standalone: false },
    { id: 'mode', address: '/slot/mode', label: 'Mode', type: 's', kind: 'state', options: ['a', 'b'], default: 'a', standalone: false },
    { id: 'apply', address: '/cue/apply', label: 'Apply', type: 'i', kind: 'trigger', value: 1 },
  ],
  actions: [{ id: 'applyAll', label: 'Apply all', steps: [{ match: '/slot/*' }, { param: 'apply' }] }],
  screens: [{ id: 'main', label: 'Main', children: [{ kind: 'action', action: 'applyAll' }] }],
}

function listen(socket: dgram.Socket): Promise<number> {
  return new Promise((resolve) => socket.bind(0, '127.0.0.1', () => resolve(socket.address().port)))
}

describe('action batch (HID-166)', () => {
  let workDir: string
  let bridge: BridgeProcess | undefined
  let client: WsE2eClient | undefined
  let unity: dgram.Socket | undefined

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-e2e-action-'))
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

  test('the definition expands to the ordered messages that reach Unity as one bundle and echo back', async () => {
    expect(collectSurfaceDefinitionIssues(DEFINITION)).toEqual([])
    const expanded = resolveActionSteps(DEFINITION.actions![0]!, DEFINITION.parameters).map(step => step.parameter.address)
    expect(expanded).toEqual(['/slot/01', '/slot/02', '/slot/mode', '/cue/apply'])

    // Unity 役の UDP ソケット。受け取ったデータグラムを全部ためる
    unity = dgram.createSocket('udp4')
    const datagrams: Buffer[] = []
    unity.on('message', (data) => datagrams.push(data))
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
    client = await connectWsE2eClient(`ws://127.0.0.1:${String(bridge.ready.wsPort)}`)

    client.send({ v: 1, type: 'surfaceSave', name: 'slots', definition: DEFINITION })
    await client.waitForFrame(frame => frame.type === 'surface')

    const before = datagrams.length
    client.send({
      v: 1,
      type: 'osc.batch',
      messages: [
        { address: '/slot/01', args: [{ type: 'f', value: 0.25 }] },
        { address: '/slot/02', args: [{ type: 'f', value: 0.75 }] },
        { address: '/slot/mode', args: [{ type: 's', value: 'b' }] },
        { address: '/cue/apply', args: [{ type: 'i', value: 1 }] },
      ],
    })
    const deadline = Date.now() + 5_000
    const isTargetBundle = (data: Buffer): boolean => 'packets' in decodeOscPacket(new Uint8Array(data))
    while (!datagrams.slice(before).some(isTargetBundle)) {
      if (Date.now() > deadline) throw new Error('The bundle did not reach Unity.')
      await new Promise(resolve => setTimeout(resolve, 25))
    }

    // 1 データグラム = 1 bundle に、送った順で全メッセージが入っている
    const bundles = datagrams.slice(before).filter(isTargetBundle)
    expect(bundles).toHaveLength(1)
    const bundle = decodeOscPacket(new Uint8Array(bundles[0]!))
    if (!('packets' in bundle)) throw new Error('Expected a bundle')
    expect(bundle.packets.map(packet => ('address' in packet ? packet.address : null))).toEqual(expanded)

    // Unity のエコーは WebSocket の osc フレームとして届き、UI の確認に使われる
    const echo = dgram.createSocket('udp4')
    try {
      for (const packet of bundle.packets) {
        if (!('address' in packet)) continue
        const data = encodeOscPacket(packet)
        await new Promise<void>((resolve, reject) => echo.send(data, bridge!.ready.oscListenPort, '127.0.0.1', error => (error ? reject(error) : resolve())))
      }
    } finally {
      echo.close()
    }
    for (const address of expanded) {
      await client.waitForFrame(frame => frame.type === 'osc.message' && frame.address === address)
    }
  }, 60_000)
})
