import { lookup } from 'node:dns/promises'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

import { resolveUnityTargets, type DownstreamFrame } from '@oscdesk/shared'

import { createDesiredValuesFileStore, type DesiredValuesFileStore, type DesiredValuesFs } from './desired-values-file'
import { createDestinations, withLoopbackAlias, type Destinations } from './destinations'
import { createDestinationSelectionFile, DEFAULT_DESTINATIONS_FILE_NAME, type DestinationsFs } from './destinations-file'
import { isIpv4 } from './ipv4'
import { createSystemLanProber, scanSubnets, type LanProber, type ScanInterface } from './lan-scan'
import { createSentLog, type SentLog } from './sent-log'
import { createSurfaceCore, type BridgeConfig } from './surface-core'
import { startUdpTransport, type UdpTransport } from './udp-transport'
import { startUiHub, type UiHub } from './ui-hub'
import { createDiagnosticsEngine } from './diagnostics-engine'
import { createSurfaceManager } from './surface-manager'
import { createSurfaceStore } from './surface-store'
import type { NdjsonFs } from './ndjson-writer'

const TEST_NETWORK_INTERFACES_ENV_VAR = 'OSCDESK_TEST_NETWORK_INTERFACES'
// E2E 用。走査のたびにこのファイル(ホストの JSON 配列)を読み、その中身を見つかった端末として返す。
// テストがファイルを書き換えれば「端末の増減」を実ネットワークなしで再現できる
const TEST_LAN_SCAN_FILE_ENV_VAR = 'OSCDESK_TEST_LAN_SCAN_FILE'

export interface BridgeServer {
  readonly wsPort: number
  readonly oscListenPort: number
  close(): Promise<void>
}

export async function startBridgeServer(options: {
  config: BridgeConfig
  logInfo?: (...args: unknown[]) => void
  logWarn?: (...args: unknown[]) => void
  logError?: (...args: unknown[]) => void
}): Promise<BridgeServer> {
  let udp: UdpTransport | undefined
  let hub: UiHub | undefined
  let core: ReturnType<typeof createSurfaceCore> | undefined
  let surfaces: ReturnType<typeof createSurfaceManager> | undefined
  let desiredValuesStore: DesiredValuesFileStore | undefined
  let sentLog: SentLog | undefined
  let destinations: Destinations | undefined
  const logWarn = options.logWarn ?? console.warn
  const logError = options.logError ?? console.error
  const oscListenPort = options.config.bridge.oscListenPort
  const wsPort = options.config.bridge.wsPort

  try {
    // 名前解決はトランスポートより先に済ませる。WebSocket 待受開始から core 生成までの
    // 間に await を挟むと、その隙に接続したクライアントの onConnect が core?. で
    // 黙って落ち、hello / link を受け取れない接続が残るため
    // 宛先がこの PC(LAN のアドレス、またはそこへ解決されるホスト名)なら、ループバックの別名を足す(D-078)。
    // 同じ PC の Unity は返信先を 127.0.0.1 にしているとループバックから pong・エコーを返すため。宛先タブで選び直したときと同じ規則
    const ownSubnets = scanSubnets(createNetworkInterfacesProvider()())
    const unityAddresses = withLoopbackAlias(
      options.config.unity.host, await resolveUnityAddresses(options.config.unity.host, logWarn), ownSubnets,
    )
    const secondaryAddresses: Record<string, readonly string[]> = {}
    for (const target of options.config.unity.secondary) {
      secondaryAddresses[target.name] = withLoopbackAlias(target.host, await resolveUnityAddresses(target.host, logWarn), ownSubnets)
    }

    udp = await startUdpTransport({
      host: options.config.bridge.oscListenHost,
      port: oscListenPort,
      onMessage: message => core?.handleOscIn(message),
      onDecodeError: (error, from) => logWarn('(WARN, BRIDGE)', 'OSC decode failed', from, error),
      onSocketError: error => logError('(ERROR, BRIDGE)', 'UDP socket error', error),
    })
    hub = await startUiHub({
      host: options.config.bridge.wsHost,
      port: wsPort,
      onConnect: clientId => {
        core?.onUiConnected(clientId)
        // 送信ログ(D-067)の既存分は hello・link の後に届ける
        sentLog?.publishBacklog(clientId)
        // 宛先タブ(D-078)は定義に依存しないので、surfaceRequest を待たずに接続時に送る
        destinations?.publish(clientId)
      },
      onDisconnect: (clientId) => core?.onUiDisconnected(clientId),
      onFrame: (frame, clientId) => {
        if (destinations?.handleUiFrame(frame, clientId) === true) return
        if (surfaces?.handleUiFrame(frame, clientId) === true) {
          // 保持値は surface の後に届ける(UI が定義を持ってから値を当てられるように)
          if (frame.type === 'surfaceRequest') {
            core?.publishDesired(clientId)
            core?.publishRuntimeOptions(clientId)
          }
          return
        }
        core?.handleUiFrame(frame, clientId)
      },
      onHttpRequest: (request, response) => surfaces?.handleHttp(request, response) ?? false,
      onInvalidFrame: (clientId, reason, raw) => logWarn('(WARN, BRIDGE)', 'Invalid UI frame', { clientId, reason, raw }),
    })
    // 保持値の保存先(D-058)。省略時は定義の保管先の `.values`(定義の一覧には *.json しか出ないので混ざらない)
    const valuesDir = options.config.surfaces.valuesDir ?? path.join(options.config.surfaces.dir, DEFAULT_VALUES_DIR_NAME)
    desiredValuesStore = createDesiredValuesFileStore({
      dir: valuesDir,
      fs: nodeDesiredValuesFs,
      logWarn,
    })
    sentLog = createSentLog({
      publish: (frame: DownstreamFrame, target) => target === undefined ? hub?.broadcast(frame) : hub?.sendTo(target, frame),
    })
    core = createSurfaceCore({
      desiredValuesStore,
      onRespondersChanged: () => destinations?.publish(),
      onSent: event => sentLog?.record(event),
      config: options.config,
      unityAddresses,
      secondaryAddresses,
      sendFn: (host, port, address, ...args) => udp?.send(host, port, address, args),
      sendBundleFn: (host, port, messages) => udp?.sendBundle(host, port, messages.map(message => ({
        address: message.address,
        args: [...message.args],
      })))
        ?? { ok: false, reason: 'transport-unavailable' },
      publish: (frame: DownstreamFrame, target) => target === undefined ? hub?.broadcast(frame) : hub?.sendTo(target, frame),
      logInfo: options.logInfo,
      logWarn: options.logWarn,
      logError: options.logError,
      createDiagnosticsEngine: deps => createDiagnosticsEngine({
        ...(deps as Parameters<typeof createDiagnosticsEngine>[0]),
        interfacesProvider: createNetworkInterfacesProvider(),
        fs: nodeFs,
        logError,
      }),
    })
    surfaces = createSurfaceManager({
      store: createSurfaceStore({ dir: options.config.surfaces.dir }),
      onAdopt: (definition, name) => core?.setDefinition(definition, name),
      publish: (frame: DownstreamFrame, target) => target === undefined ? hub?.broadcast(frame) : hub?.sendTo(target, frame),
      logInfo: options.logInfo,
      logWarn: options.logWarn,
    })
    // 宛先タブ(D-078)。保存した選択があれば設定ファイルの宛先より優先し、ping を始める前に差し替えておく
    const activeCore = core
    // 選択の保存先の既定は保持値と同じフォルダ(`<name>.values.json` とは名前が重ならない)
    destinations = createDestinations({
      configTargets: resolveUnityTargets(options.config.unity).map(target => ({
        ...target,
        addresses: (target.primary ? unityAddresses : secondaryAddresses[target.name]) ?? [],
      })),
      sendPort: options.config.unity.sendPort,
      interfaces: createNetworkInterfacesProvider(),
      prober: createLanProber(process.env),
      store: createDestinationSelectionFile({
        file: options.config.destinations.file ?? path.join(valuesDir, DEFAULT_DESTINATIONS_FILE_NAME),
        fs: nodeDestinationsFs,
        logWarn,
      }),
      scanTimeoutMs: options.config.destinations.scanTimeoutMs,
      applyTargets: targets => activeCore.setTargets(targets),
      currentTargets: () => activeCore.currentTargets(),
      primaryHosts: () => activeCore.primaryHosts(),
      publish: (frame: DownstreamFrame, target) => target === undefined ? hub?.broadcast(frame) : hub?.sendTo(target, frame),
      logInfo: options.logInfo,
      logWarn: options.logWarn,
    })
    surfaces.start(options.config.surfaces.defaultName)
    destinations.start()
    core.start()
    return {
      wsPort: hub.port,
      oscListenPort: udp.port,
      async close() {
        destinations?.close()
        core?.stop()
        sentLog?.close()
        // 間引きで保留中の保持値を書いてから終わる(SIGINT / SIGTERM でも main がここを通る)
        desiredValuesStore?.close()
        await Promise.all([hub?.close(), udp?.close()])
      },
    }
  } catch (error) {
    destinations?.close()
    core?.stop()
    sentLog?.close()
    desiredValuesStore?.close()
    await Promise.allSettled([hub?.close(), udp?.close()])
    throw error
  }
}

const nodeFs = fs as unknown as NdjsonFs
const nodeDesiredValuesFs: DesiredValuesFs = fs
const nodeDestinationsFs: DestinationsFs = fs
const DEFAULT_VALUES_DIR_NAME = '.values'

/**
 * unity.host がホスト名のとき、UDP 送信元(常に数値アドレス)と突き合わせるために
 * 名前解決しておく。解決失敗は警告して空配列(文字列比較のみに退行)。
 */
async function resolveUnityAddresses(host: string, logWarn: (...args: unknown[]) => void): Promise<readonly string[]> {
  if (net.isIP(host) !== 0) return []
  try {
    const results = await lookup(host, { all: true })
    return results.map(result => result.address)
  } catch (error) {
    logWarn('(WARN, BRIDGE)', `Failed to resolve unity.host "${host}".`, error)
    return []
  }
}

function createNetworkInterfacesProvider(): () => readonly ScanInterface[] {
  const override = readNetworkInterfacesOverride(process.env)

  if (override !== null) return () => override

  return () => Object.entries(os.networkInterfaces()).flatMap(([name, entries]) =>
    (entries ?? []).map(entry => ({
      name,
      address: entry.address,
      netmask: entry.netmask,
      family: entry.family === 'IPv4' ? 'IPv4' as const : 'IPv6' as const,
      internal: entry.internal,
    })),
  )
}

function createLanProber(env: NodeJS.ProcessEnv): LanProber {
  const file = env[TEST_LAN_SCAN_FILE_ENV_VAR]
  if (file === undefined || file.trim() === '') return createSystemLanProber()
  return {
    async probe(_subnets, signal) {
      const parsed = JSON.parse(await fs.promises.readFile(file, { encoding: 'utf8', signal })) as unknown
      if (!Array.isArray(parsed) || !parsed.every((host): host is string => typeof host === 'string' && isIpv4(host))) {
        throw new Error(`${TEST_LAN_SCAN_FILE_ENV_VAR} must point to a JSON array of IPv4 addresses.`)
      }
      return parsed.map(host => ({ host, mac: null }))
    },
  }
}

function readNetworkInterfacesOverride(env: NodeJS.ProcessEnv): readonly ScanInterface[] | null {
  const raw = env[TEST_NETWORK_INTERFACES_ENV_VAR]
  if (raw === undefined || raw.trim() === '') return null

  const parsed = JSON.parse(raw) as unknown
  if (!Array.isArray(parsed)) {
    throw new Error(`${TEST_NETWORK_INTERFACES_ENV_VAR} must be a JSON array.`)
  }

  return parsed.map((entry, index) => normalizeNetworkInterfaceInfo(entry, index))
}

function normalizeNetworkInterfaceInfo(entry: unknown, index: number): ScanInterface {
  if (entry === null || typeof entry !== 'object') {
    throw new Error(`${TEST_NETWORK_INTERFACES_ENV_VAR}[${index}] must be an object.`)
  }

  const candidate = entry as Record<string, unknown>
  if (typeof candidate.address !== 'string' || candidate.address.length === 0) {
    throw new Error(`${TEST_NETWORK_INTERFACES_ENV_VAR}[${index}].address must be a non-empty string.`)
  }
  if (typeof candidate.netmask !== 'string' || candidate.netmask.length === 0) {
    throw new Error(`${TEST_NETWORK_INTERFACES_ENV_VAR}[${index}].netmask must be a non-empty string.`)
  }
  if (candidate.family !== 'IPv4' && candidate.family !== 'IPv6') {
    throw new Error(`${TEST_NETWORK_INTERFACES_ENV_VAR}[${index}].family must be "IPv4" or "IPv6".`)
  }
  if (typeof candidate.internal !== 'boolean') {
    throw new Error(`${TEST_NETWORK_INTERFACES_ENV_VAR}[${index}].internal must be a boolean.`)
  }

  return {
    name: typeof candidate.name === 'string' && candidate.name.length > 0 ? candidate.name : `if${String(index)}`,
    address: candidate.address,
    netmask: candidate.netmask,
    family: candidate.family,
    internal: candidate.internal,
  }
}
