import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { reserveTcpPort, reserveUdpPort } from './ports'
import { ProcessHarness, type ManagedProcess } from './process'

export interface BridgeReadyLine {
  wsPort: number
  oscListenPort: number
  unity: { host: string; sendPort: number }
  uiPort: number
  protocolVersion: number
  debug: boolean
  configPath: string
}

export interface BridgeProcess extends ManagedProcess {
  readonly ready: BridgeReadyLine
}

export interface StartBridgeOptions {
  configPath?: string
  wsPort?: number
  oscListenPort?: number
  unityHost?: string
  unityPort?: number
  uiPort?: number
  debug?: boolean
  readyTimeoutMs?: number
  /** ブリッジへ足す環境変数(走査結果の差し替え `OSCDESK_TEST_LAN_SCAN_FILE` など)。 */
  env?: Record<string, string>
  /**
   * ブリッジの作業フォルダ。設定で書き換えていない保管先(`surfaces`・`surfaces/.values`・`logs/diagnostics`)は
   * ここからの相対で決まる。省くと起動ごとに一時フォルダを作り、止めたら消す(D-133)
   */
  cwd?: string
}

const DEFAULT_READY_TIMEOUT_MS = 30_000

export async function startBridge(options: StartBridgeOptions = {}): Promise<BridgeProcess> {
  const args = [path.resolve('packages/bridge/dist/oscdesk-bridge.js')]
  appendOption(args, '--config', options.configPath)
  // 設定ファイルを渡さないと、ポートは既定の設定(7080・7090・7091)になる。並列のワーカーや手元で動かしている
  // ブリッジ・Unity とぶつかるので、渡されなかったポートはこのワーカーの帯から取る(D-133)
  const external = options.configPath === undefined
  appendOption(args, '--ws-port', options.wsPort ?? (external ? await reserveTcpPort() : undefined))
  appendOption(args, '--osc-listen-port', options.oscListenPort ?? (external ? await reserveUdpPort() : undefined))
  appendOption(args, '--unity-host', options.unityHost)
  appendOption(args, '--unity-port', options.unityPort ?? (external ? await reserveUdpPort() : undefined))
  appendOption(args, '--ui-port', options.uiPort)
  if (options.debug === true) args.push('--debug')

  // 既定の保管先は作業フォルダからの相対なので、リポジトリ直下で起動すると並列のブリッジが同じ
  // `surfaces/`・`logs/diagnostics/` を読み書きし、保持値・ネットワーク設定・診断ログが混ざる
  const ownedCwd = options.cwd === undefined ? fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-bridge-cwd-')) : undefined
  // 後片付けは失敗してもテストを落とさない。Windows は止めた直後のプロセスがフォルダを掴んでいて EBUSY に
  // なることがあるので数回やり直し、それでも消せなければ OS の一時フォルダに残す
  const removeOwnedCwd = () => {
    if (ownedCwd === undefined) return
    try {
      fs.rmSync(ownedCwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch {
      // 残っても次の実行は別の名前のフォルダを作るので害は無い
    }
  }

  const harness = new ProcessHarness()
  let managed: ManagedProcess
  try {
    managed = await harness.start({
      command: process.execPath,
      args,
      readyPattern: /^OSCDESK_BRIDGE_READY /m,
      readyTimeoutMs: options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
      env: options.env,
      cwd: options.cwd ?? ownedCwd,
    })
  } catch (error) {
    removeOwnedCwd()
    throw error
  }

  try {
    const ready = parseReadyLine(managed.stdoutSnapshot())
    assertNoDefaultPorts(ready)
    return {
      pid: managed.pid,
      ready,
      stdoutSnapshot: () => managed.stdoutSnapshot(),
      stderrSnapshot: () => managed.stderrSnapshot(),
      stop: async () => {
        try {
          await managed.stop()
          await harness.stopAll()
        } finally {
          removeOwnedCwd()
        }
      },
    }
  } catch (error) {
    await harness.stopAll().catch(() => undefined)
    removeOwnedCwd()
    throw error
  }
}

export function parseReadyLine(stdout: string): BridgeReadyLine {
  const line = stdout.split(/\r?\n/).find((candidate) => candidate.startsWith('OSCDESK_BRIDGE_READY '))
  if (line === undefined) throw new Error('Bridge exited without an OSCDESK_BRIDGE_READY line.')

  const payload = JSON.parse(line.slice('OSCDESK_BRIDGE_READY '.length)) as Partial<BridgeReadyLine>
  if (!Number.isInteger(payload.wsPort) || !Number.isInteger(payload.oscListenPort)) {
    throw new Error(`Invalid OSCDESK_BRIDGE_READY line: ${line}`)
  }
  return payload as BridgeReadyLine
}

// 設定ファイルを渡すテストでも、元にした config/oscdesk.config.json のポートが残っていれば並列のワーカーと
// 取り合う(D-133)。起動できてしまうと別のテストのブリッジ・mock と黙って話すので、ここで落とす
const DEFAULT_PORTS = new Set([7080, 7090, 7091])

function assertNoDefaultPorts(ready: BridgeReadyLine): void {
  const used = [ready.wsPort, ready.oscListenPort, ready.unity?.sendPort].filter(port => port !== undefined && DEFAULT_PORTS.has(port))
  if (used.length > 0) {
    throw new Error(`E2E bridge must not use the default ports (${used.join(', ')}). Pass ports from helpers/ports.ts.`)
  }
}

function appendOption(args: string[], flag: string, value: string | number | undefined): void {
  if (value !== undefined) args.push(flag, String(value))
}
