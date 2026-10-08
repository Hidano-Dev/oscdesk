import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { DownstreamFrame, Manifest } from '../../../packages/shared/src'

import { startBridge, type BridgeProcess } from './bridge'
import { reserveTcpPort, reserveUdpPort } from './ports'
import { ProcessHarness, type ManagedProcess } from './process'
import { connectWsE2eClient, type WsE2eClient } from './ws-client'

export type ManifestFrame = Extract<DownstreamFrame, { type: 'manifest' }>

export interface ReinjectStackOptions {
  /** `packages/mock-unity/scenarios/` 配下のシナリオ名(拡張子なし)。 */
  scenario: string
  /** mock-unity の追加の起動引数(`--fault ...` / `--legacy-origin` など)。 */
  mockArgs?: string[]
  /** ブリッジ設定へ重ねる値(`surfaces` の保管先を一時フォルダへ向ける等)。 */
  configOverrides?: Record<string, unknown>
  /** true なら副系 "backup" の mock-unity をもう 1 台起動する(冗長構成。D-046)。 */
  withBackup?: boolean
}

/** mock-unity + ブリッジ + WebSocket クライアントの組。Python UI は使わない。 */
export interface ReinjectStack {
  readonly bridge: BridgeProcess
  readonly client: WsE2eClient
  readonly unityPort: number
  /** 副系の mock-unity の待受ポート(withBackup のときだけ)。 */
  readonly backupPort: number | undefined
  readonly mock: () => ManagedProcess
  /** mock-unity を止めて、同じポート・同じ引数で起動し直す。 */
  restartMock(): Promise<ManagedProcess>
  /** 副系の mock-unity を止めて、同じポートで起動し直す(withBackup のときだけ)。 */
  restartBackup(): Promise<ManagedProcess>
  stop(): Promise<void>
}

export async function startReinjectStack(options: ReinjectStackOptions): Promise<ReinjectStack> {
  const wsPort = await reserveTcpPort()
  const oscListenPort = await reserveUdpPort()
  const unityPort = await reserveUdpPort()
  const backupPort = options.withBackup === true ? await reserveUdpPort() : undefined
  const mockHarness = new ProcessHarness()

  // 既定設定の expectedProjectId はシナリオの projectId と合わないので、シナリオに合わせた設定を一時ファイルに書く。
  const scenarioPath = path.resolve('packages/mock-unity/scenarios', `${options.scenario}.json`)
  const projectId = (JSON.parse(fs.readFileSync(scenarioPath, 'utf8')) as { projectId: string }).projectId
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-reinject-'))
  const configPath = path.join(configDir, 'oscdesk.config.json')
  const baseConfig = JSON.parse(fs.readFileSync(path.resolve('config/oscdesk.config.json'), 'utf8')) as Record<string, unknown>
  const baseUnity = baseConfig.unity as Record<string, unknown>
  const unity = backupPort === undefined
    ? baseUnity
    : { ...baseUnity, secondary: [{ name: 'backup', host: '127.0.0.1', sendPort: backupPort }] }
  fs.writeFileSync(configPath, JSON.stringify({ ...baseConfig, unity, expectedProjectId: projectId, ...options.configOverrides }))

  const bridge = await startBridge({ configPath, wsPort, oscListenPort, unityHost: '127.0.0.1', unityPort })
  let client: WsE2eClient | undefined
  try {
    const spawnMockOn = (port: number) =>
      mockHarness.start({
        command: process.execPath,
        args: [
          path.resolve('packages/mock-unity/dist/mock-unity.js'),
          '--listen-port', String(port),
          '--reply-host', '127.0.0.1',
          '--reply-port', String(bridge.ready.oscListenPort),
          '--scenario', scenarioPath,
          ...(options.mockArgs ?? []),
        ],
        readyPattern: /^MOCK_UNITY_READY /m,
        readyTimeoutMs: 10_000,
      })

    const spawnMock = () => spawnMockOn(unityPort)
    let mock = await spawnMock()
    let backup = backupPort === undefined ? undefined : await spawnMockOn(backupPort)
    client = await connectWsE2eClient(`ws://127.0.0.1:${bridge.ready.wsPort}`)
    const connected = client

    return {
      bridge,
      client: connected,
      unityPort,
      backupPort,
      mock: () => mock,
      restartMock: async () => {
        await mock.stop()
        mock = await spawnMock()
        return mock
      },
      restartBackup: async () => {
        if (backupPort === undefined || backup === undefined) throw new Error('withBackup is not enabled')
        await backup.stop()
        backup = await spawnMockOn(backupPort)
        return backup
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

export async function waitForManifest(
  client: WsE2eClient,
  predicate: (frame: ManifestFrame) => boolean = () => true,
  timeoutMs = 10_000,
): Promise<ManifestFrame> {
  const frame = await client.waitForFrame(
    (candidate) => candidate.type === 'manifest' && predicate(candidate),
    timeoutMs,
  )
  if (frame.type !== 'manifest') throw new Error('Expected a manifest frame')
  return frame
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

export async function waitUntil(predicate: () => boolean, description: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

export function addressesOf(manifest: Manifest): string[] {
  return manifest.entries.map((entry) => entry.address)
}

export function entryOf(manifest: Manifest, address: string): Manifest['entries'][number] {
  const entry = manifest.entries.find((candidate) => candidate.address === address)
  if (entry === undefined) throw new Error(`Manifest has no entry ${address}`)
  return entry
}

export function trigger(client: WsE2eClient, address: string): void {
  client.sendOsc(address, [{ type: 'i', value: 1 }])
}
