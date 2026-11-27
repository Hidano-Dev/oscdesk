import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { findDefaultPorts, findDefaultPortsInConfig } from './default-ports'
import { reserveTcpPort, reserveUdpPort } from './ports'
import { ProcessHarness, type ManagedProcess } from './process'

export interface BridgeReadyLine {
  wsPort: number
  oscListenPort: number
  unity: { host: string; sendPort: number }
  protocolVersion: number
  debug: boolean
  configPath: string
  /** SPA を配る HTTP のパス。配らない設定なら null(D-138) */
  webUiPath?: string | null
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
  debug?: boolean
  /** そのほかのコマンドライン引数(ブリッジの cli.ts が読むもの) */
  extraArgs?: string[]
  readyTimeoutMs?: number
  /**
   * ブリッジへ足す環境変数(走査結果の差し替え `OSCDESK_TEST_LAN_SCAN_FILE` など)。`OSCDESK_TEST_MDNS` は既定で `off`
   * (mDNS を起動しない)。mDNS を使うテストは `{"port":<帯のポート>,"interfaces":["127.0.0.1"]}` を渡す
   */
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
  if (options.debug === true) args.push('--debug')
  args.push(...(options.extraArgs ?? []))

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

  // 副の宛先・固定の配信先は起動の途中で送り始めるので、READY 行を待ってからでは既定のポートへ届いた後になる。
  // 渡された設定は起動前に確かめる(HID-449)
  if (options.configPath !== undefined) {
    try {
      assertNoDefaultPortsIn(findDefaultPortsInConfig(readBridgeConfig(options.configPath, options.cwd ?? ownedCwd)))
    } catch (error) {
      removeOwnedCwd()
      throw error
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
      // mDNS(D-168)は既定で止める。5353 を並列のブリッジで取り合い、LAN へ問い合わせを撒くため。mDNS を使うテストは
      // OSCDESK_TEST_MDNS に帯の中のポートとループバックの NIC を渡す(D-133)
      env: { OSCDESK_TEST_MDNS: 'off', ...options.env },
      cwd: options.cwd ?? ownedCwd,
    })
  } catch (error) {
    removeOwnedCwd()
    throw error
  }

  try {
    const ready = parseReadyLine(managed.stdoutSnapshot())
    assertNoDefaultPorts(ready, options.cwd ?? ownedCwd)
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
  // configPath は既定のポートの検査で設定を読み直すのに使う(HID-449)
  if (!Number.isInteger(payload.wsPort) || !Number.isInteger(payload.oscListenPort) || typeof payload.configPath !== 'string' || payload.configPath === '') {
    throw new Error(`Invalid OSCDESK_BRIDGE_READY line: ${line}`)
  }
  return payload as BridgeReadyLine
}

// 設定ファイルを渡すテストでも、元にした config/oscdesk.config.json のポートが残っていれば並列のワーカーと
// 取り合う(D-133)。起動できてしまうと別のテストのブリッジ・mock と黙って話すので、ここで落とす。
// 副の宛先は READY 行に出ないので、ブリッジが読んだ設定ファイルを読み直して確かめる(HID-449)
function assertNoDefaultPorts(ready: BridgeReadyLine, bridgeCwd: string | undefined): void {
  assertNoDefaultPortsIn(findDefaultPorts(ready, readBridgeConfig(ready.configPath, bridgeCwd)))
}

function assertNoDefaultPortsIn(used: readonly string[]): void {
  if (used.length > 0) {
    throw new Error(`E2E bridge must not use the default ports (${used.join(', ')}). Pass ports from helpers/ports.ts.`)
  }
}

// ブリッジは相対パスを自分の作業フォルダから解決するので、同じ基準で開く。ブリッジが読めた設定を読めない
// のは異常なので、黙って検査を飛ばさずに落とす(飛ばすと副の宛先の既定ポートを見逃す)
function readBridgeConfig(configPath: string, bridgeCwd: string | undefined): unknown {
  const resolved = path.resolve(bridgeCwd ?? process.cwd(), configPath)
  return JSON.parse(fs.readFileSync(resolved, 'utf8')) as unknown
}

function appendOption(args: string[], flag: string, value: string | number | undefined): void {
  if (value !== undefined) args.push(flag, String(value))
}
