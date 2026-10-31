import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { startBridge, type BridgeProcess } from './helpers/bridge'
import { ProcessHarness, type ManagedProcess } from './helpers/process'
import { reserveTcpPort, reserveUdpPort } from './helpers/ports'
import { connectWsE2eClient, type WsE2eClient } from './helpers/ws-client'

describe('WebSocket protocol round trip', () => {
  const mockHarness = new ProcessHarness()
  let bridge: BridgeProcess | undefined
  let client: WsE2eClient | undefined
  const cleanups: (() => void)[] = []

  afterEach(async () => {
    await client?.close().catch(() => undefined)
    client = undefined
    await mockHarness.stopAll()
    await bridge?.stop().catch(() => undefined)
    bridge = undefined
    for (const cleanup of cleanups.splice(0)) cleanup()
  })

  test('preserves the connection sequence and typed single-argument UDP echo', async () => {
    const wsPort = await reserveTcpPort()
    const oscListenPort = await reserveUdpPort()
    const unityPort = await reserveUdpPort()

    await startMockUnity(unityPort, oscListenPort)
    bridge = await startBridge({
      wsPort,
      oscListenPort,
      unityHost: '127.0.0.1',
      unityPort,
      readyTimeoutMs: 30_000,
    })
    client = await connectWsE2eClient(`ws://127.0.0.1:${bridge.ready.wsPort}`)

    const initialFrames = [await client.nextFrame(), await client.nextFrame()]
    expect(initialFrames.map((frame) => frame.type)).toEqual(['hello', 'link'])
    expect(initialFrames[0]).toMatchObject({ type: 'hello', protocolVersion: 1 })
    expect(initialFrames[1]).toMatchObject({ type: 'link', unity: { reachability: 'unknown' } })

    client.sendOsc('/avatar/blend/smile', [{ type: 'f', value: 0.73 }])
    const echo = await client.waitForFrame(
      (frame) => frame.type === 'osc.message' && frame.address === '/avatar/blend/smile',
      5_000,
    )

    expect(echo.type).toBe('osc.message')
    expect(Array.isArray(echo.args)).toBe(true)
    expect(echo.args).toEqual([{ type: 'f', value: expect.closeTo(0.73, 5) }])
  })

  test('sends a set frame to Unity as the parameter address and type, and announces the OSC adapter in hello (HID-373)', async () => {
    const wsPort = await reserveTcpPort()
    const oscListenPort = await reserveUdpPort()
    const unityPort = await reserveUdpPort()

    await startMockUnity(unityPort, oscListenPort)
    // 定義の保存先はテストごとの一時フォルダ(リポジトリの surfaces/ へ書かない)
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-set-e2e-'))
    cleanups.push(() => fs.rmSync(workDir, { recursive: true, force: true }))
    const configPath = path.join(workDir, 'config.json')
    fs.writeFileSync(configPath, JSON.stringify({
      unity: { host: '127.0.0.1', sendPort: unityPort },
      bridge: {},
      debug: false,
      boolFallbackToInt: false,
      surfaces: { dir: path.join(workDir, 'surfaces') },
    }))
    bridge = await startBridge({ configPath, wsPort, oscListenPort, readyTimeoutMs: 30_000 })
    client = await connectWsE2eClient(`ws://127.0.0.1:${bridge.ready.wsPort}`)
    const hello = await client.waitForFrame(frame => frame.type === 'hello')
    expect(hello).toMatchObject({ adapters: ['osc'] })

    client.send({
      v: 1,
      type: 'surfaceSave',
      name: 'set-e2e',
      activate: true,
      definition: {
        format: 'oscdesk-surface',
        version: 1,
        name: 'Set',
        parameters: [
          { id: 'visible', address: '/avatar/visible', label: 'Visible', type: 'bool', kind: 'state', default: false },
          { id: 'level', address: '/avatar/level', label: 'Level', type: 'f', kind: 'state', range: [0, 1], default: 0 },
        ],
        screens: [{ id: 'main', label: 'Main', children: [{ kind: 'control', param: 'visible', widget: 'switch' }] }],
      },
    })
    await client.waitForFrame(frame => frame.type === 'surface' && frame.name === 'set-e2e')

    // mock-unity は届いた OSC を同じアドレスへ返す。UI は型タグを知らずに JSON の値だけを送る
    client.send({ v: 1, type: 'set', param: 'visible', value: true })
    const echo = await client.waitForFrame(frame => frame.type === 'osc.message' && frame.address === '/avatar/visible', 5_000)
    expect(echo.type === 'osc.message' && echo.args).toEqual([{ type: 'i', value: 1 }])

    client.send({ v: 1, type: 'set', param: 'level', value: 5 })
    const rejected = await client.waitForFrame(frame => frame.type === 'notice' && frame.code === 'set-rejected', 5_000)
    expect(rejected).toMatchObject({ detail: 'out-of-range: level' })
  })

  async function startMockUnity(listenPort: number, replyPort: number): Promise<ManagedProcess> {
    return mockHarness.start({
      command: process.execPath,
      args: [
        path.resolve('packages/mock-unity/dist/mock-unity.js'),
        '--listen-port', String(listenPort),
        '--reply-host', '127.0.0.1',
        '--reply-port', String(replyPort),
      ],
      readyPattern: /MOCK_UNITY_READY/,
      readyTimeoutMs: 10_000,
    })
  }
})
