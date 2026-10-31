import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import type { DownstreamFrame } from '../../packages/shared/src'

import { startBridge, type BridgeProcess } from './helpers/bridge'
import { reserveTcpPort, reserveUdpPort } from './helpers/ports'
import { ProcessHarness } from './helpers/process'
import { connectWsE2eClient, type WsE2eClient } from './helpers/ws-client'

// ネットワークの設定(D-113)。この PC の localhost(127.0.0.1)は常に許可されるので、「別の PC のブラウザ」は
// 送信元を 127.0.0.2 にした接続で作る(Windows も Linux も 127.0.0.0/8 のどのアドレスからでも送れる)
const OTHER_BROWSER = '127.0.0.2'

type NetworkSettingsFrame = Extract<DownstreamFrame, { type: 'networkSettings' }>
const isNetworkSettings = (predicate: (frame: NetworkSettingsFrame) => boolean = () => true) => (frame: DownstreamFrame) =>
  frame.type === 'networkSettings' && predicate(frame)

describe('network settings (D-113)', () => {
  let workDir: string
  let bridge: BridgeProcess | undefined
  const clients: WsE2eClient[] = []
  const mocks = new ProcessHarness()

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-e2e-network-'))
  })

  afterEach(async () => {
    await Promise.all(clients.splice(0).map(client => client.close().catch(() => undefined)))
    await mocks.stopAll().catch(() => undefined)
    await bridge?.stop().catch(() => undefined)
    bridge = undefined
    fs.rmSync(workDir, { recursive: true, force: true })
  })

  const start = async () => {
    const unityPort = await reserveUdpPort()
    const configPath = path.join(workDir, 'oscdesk.config.json')
    const baseConfig = JSON.parse(fs.readFileSync(path.resolve('config/oscdesk.config.json'), 'utf8')) as Record<string, unknown>
    fs.writeFileSync(configPath, JSON.stringify({
      ...baseConfig,
      unity: { name: 'unity', host: '127.0.0.1', sendPort: unityPort },
      surfaces: { dir: path.join(workDir, 'surfaces') },
      network: { file: path.join(workDir, 'network-settings.json') },
    }))
    const options = { configPath, wsPort: await reserveTcpPort(), oscListenPort: await reserveUdpPort() }
    bridge = await startBridge(options)
    return { unityPort, options }
  }

  const connect = async (localAddress?: string) => {
    const client = await connectWsE2eClient(`ws://127.0.0.1:${bridge!.ready.wsPort}`, localAddress === undefined ? undefined : { localAddress })
    clients.push(client)
    return client
  }

  test('rejects a change that locks out its own browser, and turns away browsers outside the allowed range', async () => {
    await start()
    const local = await connect()
    const initial = await local.waitForFrame(isNetworkSettings()) as NetworkSettingsFrame
    expect(initial).toMatchObject({ targetInterface: null, targetRanges: [], allowedBrowsers: ['0.0.0.0/0', '::/0'], source: 'default' })
    expect(initial.interfaces[0]).toEqual({ address: '127.0.0.1', name: 'localhost' })

    const other = await connect(OTHER_BROWSER)
    await other.waitForFrame(isNetworkSettings())
    // 自分(127.0.0.2)を入れない許可リストは断られ、設定は変わらない
    other.send({ v: 1, type: 'networkSettingsSet', targetInterface: null, targetRanges: [], allowedBrowsers: ['127.0.0.1/32'] })
    const rejected = await other.waitForFrame(frame => frame.type === 'notice' && frame.code === 'network-settings-rejected')
    expect(rejected).toMatchObject({ detail: `would-lock-out: ${OTHER_BROWSER}` })

    // localhost の UI のプロセスが名乗ったブラウザのアドレスでも締め出しを判定する
    local.send({ v: 1, type: 'networkSettingsSet', targetInterface: null, targetRanges: [], allowedBrowsers: ['10.0.0.0/8'], browser: '192.168.1.30' })
    await expect(local.waitForFrame(frame => frame.type === 'notice' && frame.code === 'network-settings-rejected'))
      .resolves.toMatchObject({ detail: 'would-lock-out: 192.168.1.30' })

    // localhost から許可リストを localhost だけにすると、範囲の外になった接続は切られ、新しい接続も断られる
    local.send({ v: 1, type: 'networkSettingsSet', targetInterface: null, targetRanges: [], allowedBrowsers: [] })
    await local.waitForFrame(isNetworkSettings(frame => frame.allowedBrowsers.length === 0 && frame.source === 'saved'))
    await waitUntil(() => !other.isOpen)
    await expect(connect(OTHER_BROWSER)).rejects.toThrow(/403/)
    expect(local.isOpen).toBe(true)

    // 設定はファイルに残る(読み戻しは単体テストで確かめる)
    expect(JSON.parse(fs.readFileSync(path.join(workDir, 'network-settings.json'), 'utf8'))).toMatchObject({ allowedBrowsers: [] })
  })

  test('keeps the browser connection when the target network changes, and still reaches Unity on the new one', async () => {
    const { unityPort } = await start()
    await mocks.start({
      command: process.execPath,
      args: [
        path.resolve('packages/mock-unity/dist/mock-unity.js'),
        '--listen-host', '127.0.0.1',
        '--listen-port', String(unityPort),
        '--reply-host', '127.0.0.1',
        '--reply-port', String(bridge!.ready.oscListenPort),
      ],
      readyPattern: /^MOCK_UNITY_READY /m,
      readyTimeoutMs: 10_000,
    })
    const local = await connect()
    const other = await connect(OTHER_BROWSER)
    await other.waitForFrame(isNetworkSettings())
    await local.waitForFrame(frame => frame.type === 'link' && frame.unity.reachability === 'reachable', 15_000)

    // ターゲット向けの待ち受けを localhost に付け替える。どちらのブラウザの接続も切れない
    other.send({ v: 1, type: 'networkSettingsSet', targetInterface: '127.0.0.1', targetRanges: [], allowedBrowsers: ['0.0.0.0/0', '::/0'] })
    await other.waitForFrame(isNetworkSettings(frame => frame.targetInterface === '127.0.0.1'))
    await local.waitForFrame(isNetworkSettings(frame => frame.targetInterface === '127.0.0.1'))
    expect(other.isOpen).toBe(true)
    expect(local.isOpen).toBe(true)

    // 付け替えた後も同じポートで Unity と送受信できる(エコーが戻る)
    other.sendOsc('/network/check', [{ type: 'i', value: 7 }])
    await expect(other.waitForFrame(frame => frame.type === 'osc' && frame.address === '/network/check'))
      .resolves.toMatchObject({ args: [{ type: 'i', value: 7 }] })

    // この PC に無いアドレスは選べない
    other.send({ v: 1, type: 'networkSettingsSet', targetInterface: '203.0.113.254', targetRanges: [], allowedBrowsers: ['0.0.0.0/0', '::/0'] })
    await expect(other.waitForFrame(frame => frame.type === 'notice' && frame.code === 'network-settings-rejected'))
      .resolves.toMatchObject({ detail: 'invalid-target-interface: 203.0.113.254' })
    expect(other.isOpen).toBe(true)
  })
})

async function waitUntil(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the condition.')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}
