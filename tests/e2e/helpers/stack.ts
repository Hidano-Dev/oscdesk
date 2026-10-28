import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { DownstreamFrame } from '../../../packages/shared/src'

import { startBridge, type BridgeProcess } from './bridge'
import { reserveTcpPort, reserveUdpPort } from './ports'
import { ProcessHarness, type ManagedProcess } from './process'
import { connectWsE2eClient, type WsE2eClient } from './ws-client'

export interface StackOptions {
  /** mock-unity の追加の起動引数(`--fault ...` など)。 */
  mockArgs?: string[]
  /** ブリッジ設定へ重ねる値(`surfaces` の保管先を一時フォルダへ向ける等)。 */
  configOverrides?: Record<string, unknown>
  /** true なら副系 "backup" の mock-unity をもう 1 台起動する(冗長構成。D-046)。 */
  withBackup?: boolean
  /** 副系の mock-unity の追加の起動引数。省くと mockArgs と同じ(台ごとに違う一覧を返させる等)。 */
  backupMockArgs?: string[]
}

/** mock-unity + ブリッジ + WebSocket クライアントの組。Python UI は使わない。 */
export interface Stack {
  readonly bridge: BridgeProcess
  readonly client: WsE2eClient
  readonly unityPort: number
  /** 副系の mock-unity の待受ポート(withBackup のときだけ)。 */
  readonly backupPort: number | undefined
  readonly mock: () => ManagedProcess
  /**
   * mock-unity を止め、停止中を ping が検知できる長さ待ってから、同じポートで起動し直す。
   * mockArgs を渡すと、その引数で起動し直す(再起動した Unity が別の一覧を返す場面を作る)
   */
  restartMock(mockArgs?: string[]): Promise<ManagedProcess>
  /** 副系の mock-unity を止め、同様に待ってから起動し直す(withBackup のときだけ)。 */
  restartBackup(): Promise<ManagedProcess>
  /**
   * ブリッジだけを止め、同じ設定・ポートで起動し直す(mock-unity は動かしたまま)。
   * WebSocket クライアントも張り直し、以後の `bridge` / `client` は新しいものを指す。
   */
  restartBridge(): Promise<void>
  stop(): Promise<void>
}

// 再起動の検知は pong の喪失→回復に頼る(D-051)。ping は 2 秒間隔なので、停止中に最低 2 回は
// ping が飛ぶ長さ待たないと、喪失が現れず「再起動していない」のと区別がつかない。
const OUTAGE_MS = 5_000

export async function startStack(options: StackOptions = {}): Promise<Stack> {
  const wsPort = await reserveTcpPort()
  const oscListenPort = await reserveUdpPort()
  const unityPort = await reserveUdpPort()
  const backupPort = options.withBackup === true ? await reserveUdpPort() : undefined
  const mockHarness = new ProcessHarness()

  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-stack-'))
  const configPath = path.join(configDir, 'oscdesk.config.json')
  const baseConfig = JSON.parse(fs.readFileSync(path.resolve('config/oscdesk.config.json'), 'utf8')) as Record<string, unknown>
  const baseUnity = baseConfig.unity as Record<string, unknown>
  const unity = backupPort === undefined
    ? baseUnity
    : { ...baseUnity, secondary: [{ name: 'backup', host: '127.0.0.1', sendPort: backupPort }] }
  fs.writeFileSync(configPath, JSON.stringify({ ...baseConfig, unity, ...options.configOverrides }))

  const bridgeOptions = { configPath, wsPort, oscListenPort, unityHost: '127.0.0.1', unityPort }
  let bridge = await startBridge(bridgeOptions)
  let client: WsE2eClient | undefined
  try {
    const spawnMockOn = (port: number, extraArgs = options.mockArgs ?? []) =>
      mockHarness.start({
        command: process.execPath,
        args: [
          path.resolve('packages/mock-unity/dist/mock-unity.js'),
          '--listen-port', String(port),
          '--reply-host', '127.0.0.1',
          '--reply-port', String(bridge.ready.oscListenPort),
          ...extraArgs,
        ],
        readyPattern: /^MOCK_UNITY_READY /m,
        readyTimeoutMs: 10_000,
      })

    let mock = await spawnMockOn(unityPort)
    const backupArgs = options.backupMockArgs ?? options.mockArgs
    let backup = backupPort === undefined ? undefined : await spawnMockOn(backupPort, backupArgs)
    client = await connectWsE2eClient(`ws://127.0.0.1:${bridge.ready.wsPort}`)
    let connected = client

    return {
      get bridge() { return bridge },
      get client() { return connected },
      unityPort,
      backupPort,
      mock: () => mock,
      restartMock: async (mockArgs?: string[]) => {
        await mock.stop()
        await new Promise((resolve) => setTimeout(resolve, OUTAGE_MS))
        mock = await spawnMockOn(unityPort, mockArgs)
        return mock
      },
      restartBackup: async () => {
        if (backupPort === undefined || backup === undefined) throw new Error('withBackup is not enabled')
        await backup.stop()
        await new Promise((resolve) => setTimeout(resolve, OUTAGE_MS))
        backup = await spawnMockOn(backupPort, backupArgs)
        return backup
      },
      restartBridge: async () => {
        await connected.close().catch(() => undefined)
        await bridge.stop()
        bridge = await startBridge(bridgeOptions)
        connected = await connectWsE2eClient(`ws://127.0.0.1:${bridge.ready.wsPort}`)
      },
      stop: async () => {
        await connected.close().catch(() => undefined)
        await mockHarness.stopAll().catch(() => undefined)
        await bridge.stop().catch(() => undefined)
        fs.rmSync(configDir, { recursive: true, force: true })
      },
    }
  } catch (error) {
    await client?.close().catch(() => undefined)
    await mockHarness.stopAll().catch(() => undefined)
    await bridge.stop().catch(() => undefined)
    fs.rmSync(configDir, { recursive: true, force: true })
    throw error
  }
}

/** `durationMs` の間、条件に合うフレームが届かないことを確かめる(届いたらそのフレームを返す)。 */
export async function frameWithin(
  client: WsE2eClient,
  predicate: (frame: DownstreamFrame) => boolean,
  durationMs: number,
): Promise<DownstreamFrame | null> {
  try {
    return await client.waitForFrame(predicate, durationMs)
  } catch {
    return null
  }
}
