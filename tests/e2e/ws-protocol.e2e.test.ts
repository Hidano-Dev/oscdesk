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

  // パッドの部品(版 2。D-167)を採用して osc.padSet を送るまでの共通の手順。定義の保存先はテストごとの一時フォルダ
  const startWithPad = async (prefix: string, pad: Record<string, unknown>) => {
    const wsPort = await reserveTcpPort()
    const oscListenPort = await reserveUdpPort()
    const unityPort = await reserveUdpPort()
    await startMockUnity(unityPort, oscListenPort)
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    cleanups.push(() => fs.rmSync(workDir, { recursive: true, force: true }))
    const configPath = path.join(workDir, 'config.json')
    fs.writeFileSync(configPath, JSON.stringify({
      unity: { host: '127.0.0.1', sendPort: unityPort }, bridge: {}, debug: false, boolFallbackToInt: false,
      surfaces: { dir: path.join(workDir, 'surfaces') },
    }))
    bridge = await startBridge({ configPath, wsPort, oscListenPort, readyTimeoutMs: 30_000 })
    client = await connectWsE2eClient(`ws://127.0.0.1:${bridge.ready.wsPort}`)
    const hello = await client.waitForFrame(frame => frame.type === 'hello')
    client.send({ v: 1, type: 'osc.padSave', name: 'pad-e2e', pad })
    const adopted = await client.waitForFrame(frame => frame.type === 'osc.padDocument' && frame.name === 'pad-e2e')
    return { hello, version: adopted.type === 'osc.padDocument' ? adopted.version : '' }
  }

  test('sends a pad value to Unity as the widget address and type, and announces the OSC adapter in hello (HID-373)', async () => {
    const { hello, version } = await startWithPad('oscdesk-set-e2e-', {
      format: 'oscdesk-pad', version: 2, rows: 1, columns: 2,
      widgets: [
        { id: 'visible', kind: 'toggle', row: 0, column: 0, label: 'Visible', address: '/avatar/visible', type: 'i' },
        { id: 'level', kind: 'slider', row: 0, column: 1, label: 'Level', address: '/avatar/level', type: 'f', min: 0, max: 1 },
      ],
    })
    expect(hello).toMatchObject({ adapters: ['osc'] })
    const live = client!

    // mock-unity は届いた OSC を同じアドレスへ返す。UI は型タグを知らずに JSON の値だけを送る
    live.send({ v: 1, type: 'osc.padSet', name: 'pad-e2e', version, widget: 'visible', value: true })
    const echo = await live.waitForFrame(frame => frame.type === 'osc.message' && frame.address === '/avatar/visible', 5_000)
    expect(echo.type === 'osc.message' && echo.args).toEqual([{ type: 'i', value: 1 }])

    live.send({ v: 1, type: 'osc.padSet', name: 'pad-e2e', version, widget: 'level', value: 5 })
    const rejected = await live.waitForFrame(frame => frame.type === 'notice' && frame.code === 'pad-set-rejected', 5_000)
    expect(rejected).toMatchObject({ detail: 'out-of-range: 5 (level)' })

    // 旧画面(別の版)からの値は送らずに断る
    live.send({ v: 1, type: 'osc.padSet', name: 'pad-e2e', version: 'stale-999', widget: 'visible', value: false })
    const stale = await live.waitForFrame(frame => frame.type === 'notice' && frame.code === 'pad-set-rejected' && frame.detail.startsWith('stale-pad'), 5_000)
    expect(stale).toMatchObject({ detail: 'stale-pad: pad-e2e@stale-999' })
  })

  test('rejects a change from another client while one holds the lock, and lets it through after the lease expires (HID-378)', async () => {
    const { version } = await startWithPad('oscdesk-lock-e2e-', {
      format: 'oscdesk-pad', version: 2, rows: 1, columns: 1,
      widgets: [{ id: 'level', kind: 'slider', row: 0, column: 0, label: 'Level', address: '/lock/level', type: 'f', min: 0, max: 1 }],
    })
    const owner = client!
    const other = await connectWsE2eClient(`ws://127.0.0.1:${bridge!.ready.wsPort}`)
    cleanups.push(() => { void other.close().catch(() => undefined) })
    const set = (from: WsE2eClient, value: number, holder: string) =>
      from.send({ v: 1, type: 'osc.padSet', name: 'pad-e2e', version, widget: 'level', value, holder })

    // 接続直後に届く空のロックの一覧を先に受けておく(後の「外れた」の待ちに当たらないように)
    await other.waitForFrame(frame => frame.type === 'locks' && frame.locks.length === 0, 5_000)
    owner.send({ v: 1, type: 'lock', ref: { widget: 'level' }, holder: 'page-a', label: 'browser A' })
    await other.waitForFrame(frame => frame.type === 'locks' && frame.locks.length === 1, 5_000)

    set(other, 0.9, 'page-b')
    // ロック中の断りは code が locked(pad-set-rejected ではない)
    const rejected = await other.waitForFrame(frame => frame.type === 'notice' && frame.code === 'locked', 5_000)
    expect(rejected).toMatchObject({ detail: expect.stringMatching(/^locked: .*level.* by browser A$/) })
    other.send({ v: 1, type: 'lock', ref: { widget: 'level' }, holder: 'page-b', label: 'browser B' })
    await other.waitForFrame(frame => frame.type === 'notice' && frame.code === 'lock-rejected', 5_000)

    // 持ち主は送れる
    set(owner, 0.4, 'page-a')
    await owner.waitForFrame(frame => frame.type === 'osc.message' && frame.address === '/lock/level', 5_000)

    // 延長しなければ期限(2 秒)で外れ、もう一方の変更が通る
    await other.waitForFrame(frame => frame.type === 'locks' && frame.locks.length === 0, 5_000)
    set(other, 0.7, 'page-b')
    const echo = await other.waitForFrame(frame => frame.type === 'osc.message' && frame.address === '/lock/level'
      && frame.args[0]?.type === 'f' && Math.abs(frame.args[0].value - 0.7) < 1e-4, 5_000)
    expect(echo.type).toBe('osc.message')
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
