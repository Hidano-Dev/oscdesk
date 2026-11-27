import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import type { DownstreamFrame, OscQueryTargetsFrame } from '../../packages/shared/src'

import { startBridge, type BridgeProcess } from './helpers/bridge'
import { reserveTcpPort, reserveUdpPort } from './helpers/ports'
import { ProcessHarness } from './helpers/process'
import { startStack, type Stack } from './helpers/stack'
import { connectWsE2eClient, type WsE2eClient } from './helpers/ws-client'

// OSCQuery でのターゲットの発見と名前空間の読み込み(D-168)。見本のターゲットは mock-unity の --oscquery-port。
// mDNS は 5353 を使わず、ワーカーの帯のポートとループバックの NIC だけで流す(並列の E2E とぶつからない。D-133)

const NAMESPACE = {
  CONTENTS: {
    scene: {
      CONTENTS: {
        level: { TYPE: 'f', ACCESS: 3, RANGE: [{ MIN: 0, MAX: 1 }], DESCRIPTION: '音量' },
        start: { TYPE: 'N', ACCESS: 2 },
        fps: { TYPE: 'f', ACCESS: 1 },
        stamp: { TYPE: 't', ACCESS: 2 },
      },
    },
  },
}

type TargetsFrame = OscQueryTargetsFrame
const isTargets = (frame: DownstreamFrame): frame is TargetsFrame => frame.type === 'osc.queryTargets'

function mockReady(stdout: string): { listenPort: number; oscQueryPort: number; bootId: string } {
  const line = stdout.split(/\r?\n/).find(candidate => candidate.startsWith('MOCK_UNITY_READY '))
  if (line === undefined) throw new Error('mock-unity has no READY line')
  return JSON.parse(line.slice('MOCK_UNITY_READY '.length)) as { listenPort: number; oscQueryPort: number; bootId: string }
}

describe('OSCQuery targets (D-168)', () => {
  let workDir: string
  let stack: Stack | undefined

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-e2e-oscquery-'))
  })

  afterEach(async () => {
    await stack?.stop().catch(() => undefined)
    stack = undefined
    fs.rmSync(workDir, { recursive: true, force: true })
  })

  test('reads a config target\'s HOST_INFO and namespace into a palette, and follows PATH_CHANGED', async () => {
    const httpPort = await reserveTcpPort()
    const namespaceFile = path.join(workDir, 'namespace.json')
    fs.writeFileSync(namespaceFile, JSON.stringify(NAMESPACE))
    stack = await startStack({
      mockArgs: ['--oscquery-port', String(httpPort), '--oscquery-namespace', namespaceFile, '--oscquery-name', 'Mock'],
      configOverrides: {
        surfaces: { dir: path.join(workDir, 'surfaces') },
        oscQuery: { mdns: false, targets: [{ host: '127.0.0.1', port: httpPort }], refreshDebounceMs: 50 },
      },
    })
    const ready = mockReady(stack.mock().stdoutSnapshot())

    // ブリッジは mock より先に起動するので、最初の読み込みは失敗して読み直す
    const loaded = await stack.client.waitForFrame(frame => isTargets(frame) && frame.targets[0]?.status === 'ready', 20_000) as TargetsFrame
    expect(loaded.mdns).toBe('off')
    const target = loaded.targets[0]!
    expect(target).toMatchObject({
      id: `127.0.0.1:${String(httpPort)}`,
      source: 'config',
      name: 'Mock',
      host: '127.0.0.1',
      httpPort,
      oscPort: ready.listenPort,
      bootId: ready.bootId,
      pathEvents: true,
      error: null,
    })
    expect(target.palette.map(item => [item.address, item.kind, item.hold])).toEqual([
      ['/scene/level', 'slider', true],
      ['/scene/start', 'button', false],
    ])
    expect(target.unsupported).toEqual([{ address: '/scene/stamp', type: 't', reason: 'unsupported-type' }])

    // 名前空間を書き換えると mock が PATH_CHANGED を送り、ブリッジは木を取り直す
    fs.writeFileSync(namespaceFile, JSON.stringify({ CONTENTS: { mode: { TYPE: 's', ACCESS: 3, RANGE: [{ VALS: ['a', 'b'] }] } } }))
    const changed = await stack.client.waitForFrame(frame => isTargets(frame)
      && frame.targets[0]?.palette.some(item => item.address === '/mode') === true, 10_000) as TargetsFrame
    expect(changed.targets[0]!.palette).toEqual([
      { address: '/mode', type: 's', access: 3, description: null, extendedType: null, range: [{ min: null, max: null, vals: ['a', 'b'] }], kind: 'select', hold: true },
    ])

    // pong の第 2 引数(起動 ID)があっても到達の判定は壊れない
    await stack.client.waitForFrame(frame => frame.type === 'link' && frame.unity.reachability === 'reachable', 10_000)

    // 新しく接続した UI にも接続時に配る
    const late = await connectWsE2eClient(`ws://127.0.0.1:${String(stack.bridge.ready.wsPort)}`)
    try {
      const first = await late.waitForFrame(isTargets, 5_000) as TargetsFrame
      expect(first.targets[0]!.palette.map(item => item.address)).toEqual(['/mode'])
      late.send({ v: 1, type: 'osc.queryRefresh' })
      await late.waitForFrame(isTargets, 5_000)
    } finally {
      await late.close()
    }
  })

  test('finds a target by mDNS on a private port and rereads it when a restarted target announces itself', async () => {
    const mdnsPort = await reserveUdpPort()
    const httpPort = await reserveTcpPort()
    const unityPort = await reserveUdpPort()
    const harness = new ProcessHarness()
    let bridge: BridgeProcess | undefined
    let client: WsE2eClient | undefined
    try {
      bridge = await startBridge({
        unityHost: '127.0.0.1',
        unityPort,
        env: { OSCDESK_TEST_MDNS: JSON.stringify({ port: mdnsPort, interfaces: ['127.0.0.1'] }) },
      })
      client = await connectWsE2eClient(`ws://127.0.0.1:${String(bridge.ready.wsPort)}`)
      await client.waitForFrame(frame => isTargets(frame) && frame.mdns === 'running', 10_000)
      const startMock = () => harness.start({
        command: process.execPath,
        args: [
          path.resolve('packages/mock-unity/dist/mock-unity.js'),
          '--listen-port', String(unityPort),
          '--listen-host', '127.0.0.1',
          '--oscquery-port', String(httpPort),
          '--oscquery-name', 'MockUnity',
          '--mdns', '--mdns-port', String(mdnsPort), '--mdns-address', '127.0.0.1',
        ],
        readyPattern: /^MOCK_UNITY_READY /m,
        readyTimeoutMs: 10_000,
      })
      const mock = await startMock()
      const ready = mockReady(mock.stdoutSnapshot())
      // 起動の告知で見つける(定期の問い合わせは 30 秒ごとなので、待たずに見つかるのは告知のおかげ)
      const found = await client.waitForFrame(frame => isTargets(frame) && frame.targets[0]?.status === 'ready', 10_000) as TargetsFrame
      expect(found.targets[0]).toMatchObject({
        id: `MockUnity-${String(httpPort)}`,
        source: 'mdns',
        name: 'MockUnity',
        host: '127.0.0.1',
        httpPort,
        oscPort: unityPort,
        bootId: ready.bootId,
      })
      expect(found.targets[0]!.palette.length).toBeGreaterThan(0)

      // 同じポートで起動し直すと、起動の告知で HOST_INFO を取り直し、新しい起動 ID が出る(D-164)。
      // Windows の子プロセスの停止はシグナルを受けられないので、削除の告知(TTL 0)は単体テストで確かめる
      await mock.stop()
      const restarted = mockReady((await startMock()).stdoutSnapshot())
      expect(restarted.bootId).not.toBe(ready.bootId)
      const reread = await client.waitForFrame(frame => isTargets(frame) && frame.targets[0]?.bootId === restarted.bootId, 10_000) as TargetsFrame
      expect(reread.targets).toHaveLength(1)
    } finally {
      await client?.close().catch(() => undefined)
      await harness.stopAll().catch(() => undefined)
      await bridge?.stop().catch(() => undefined)
    }
  })
})
