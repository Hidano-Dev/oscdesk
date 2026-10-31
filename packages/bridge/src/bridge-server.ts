import { lookup } from 'node:dns/promises'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

import { OscPadStoredSchema, resolveUnityTargets, type DownstreamFrame } from '@oscdesk/shared'

import { createBlueprintManager, type BlueprintManager } from './blueprint-manager'
import { createCatalogManager, type CatalogManager } from './catalog-manager'
import { createDesiredValuesFileStore, type DesiredValuesFileStore, type DesiredValuesFs } from './desired-values-file'
import { createDestinations, withLoopbackAlias, type Destinations } from './destinations'
import { createDestinationSelectionFile, DEFAULT_DESTINATIONS_FILE_NAME, type DestinationsFs } from './destinations-file'
import { createDeviceAliasFile, DEFAULT_DEVICE_ALIASES_FILE_NAME } from './device-aliases'
import { isIpv4 } from './ipv4'
import { createLockManager, type LockManager } from './lock-manager'
import { createSystemHostnameResolver, NO_HOSTNAMES, type HostnameResolver } from './hostname-lookup'
import { createSystemLanProber, localIpv4Addresses, normalizeMac, type LanProber, type ScanInterface } from './lan-scan'
import { createPadActiveFile, createPadManager, type PadActiveFs } from './pad-manager'
import { createProjectManager, type ProjectManager } from './project-manager'
import { createSentLog, type SentLog } from './sent-log'
import { createSurfaceCore, type BridgeConfig } from './surface-core'
import { createOscAdapter } from './target-adapter'
import { startUdpTransport, type UdpTransport } from './udp-transport'
import { startUiHub, type UiHub } from './ui-hub'
import { createDiagnosticsEngine } from './diagnostics-engine'
import { createSurfaceManager } from './surface-manager'
import { createNamedJsonStore, createSurfaceStore } from './surface-store'
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
  let pads: ReturnType<typeof createPadManager> | undefined
  let projects: ProjectManager | undefined
  let desiredValuesStore: DesiredValuesFileStore | undefined
  let sentLog: SentLog | undefined
  let catalog: CatalogManager | undefined
  let destinations: Destinations | undefined
  let locks: LockManager | undefined
  let blueprints: BlueprintManager | undefined
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
    const ownAddresses = localIpv4Addresses(createNetworkInterfacesProvider()())
    const unityAddresses = withLoopbackAlias(
      options.config.unity.host, await resolveUnityAddresses(options.config.unity.host, logWarn), ownAddresses,
    )
    const secondaryAddresses: Record<string, readonly string[]> = {}
    for (const target of options.config.unity.secondary) {
      secondaryAddresses[target.name] = withLoopbackAlias(target.host, await resolveUnityAddresses(target.host, logWarn), ownAddresses)
    }

    // ターゲットとのやり取りは通信アダプタ(HID-373・D-110)を通す。今は OSC のアダプタだけ
    const adapter = createOscAdapter({
      transport: () => udp,
      handlers: () => ({
        delivered: message => core?.handleOscIn(message),
        alive: message => core?.handleOscIn(message),
        // 設計図(D-104)は core の手前で受ける。core は /sys/* を読み捨てるだけなので、先に取らないと届かない
        blueprint: message => catalog?.handleOscIn(message) === true,
        // 対象なし・処理失敗(HID-375)は送り先ブロックの点灯(HID-376)で使う。今は受けて捨てる(UI へ生の OSC として流さない)
        unbound: () => {},
        failed: () => {},
      }),
    })
    udp = await startUdpTransport({
      host: options.config.bridge.oscListenHost,
      port: oscListenPort,
      onMessage: message => adapter.receive(message),
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
        catalog?.publish(clientId)
        locks?.publish(clientId)
        blueprints?.publish(clientId)
      },
      onDisconnect: (clientId) => {
        // 切れた接続のロック(HID-378)は期限を待たずに外す
        locks?.releaseConnection(clientId)
        core?.onUiDisconnected(clientId)
      },
      onFrame: (frame, clientId) => {
        if (locks?.handleUiFrame(frame, clientId) === true) return
        if (destinations?.handleUiFrame(frame, clientId) === true) return
        if (catalog?.handleUiFrame(frame, clientId) === true) return
        if (blueprints?.handleUiFrame(frame, clientId) === true) return
        if (projects?.handleUiFrame(frame, clientId) === true) return
        if (pads?.handleUiFrame(frame, clientId) === true) return
        if (surfaces?.handleUiFrame(frame, clientId) === true) {
          // 保持値は surface の後に届ける(UI が定義を持ってから値を当てられるように)
          if (frame.type === 'surfaceRequest') {
            core?.publishDesired(clientId)
            core?.publishRuntimeOptions(clientId)
            core?.publishDesiredStatus(clientId)
          }
          return
        }
        core?.handleUiFrame(frame, clientId)
      },
      onHttpRequest: (request, response) => surfaces?.handleHttp(request, response) ?? false,
      onHttpRejected: (method, origin, peer) => logWarn('(WARN, BRIDGE)', 'Rejected browser-originated HTTP request', { method, origin: origin.slice(0, 200), peer }),
      onHandshakeRejected: (origin, peer) => logWarn('(WARN, BRIDGE)', 'Rejected browser-originated WebSocket handshake', { origin: origin.slice(0, 200), peer }),
      onInvalidFrame: (clientId, reason, raw) => logWarn('(WARN, BRIDGE)', 'Invalid UI frame', { clientId, reason, raw }),
    })
    // 保持値の保存先(D-058)。省略時は定義の保管先の `.values`(定義の一覧には *.json しか出ないので混ざらない)
    const valuesDir = options.config.surfaces.valuesDir ?? path.join(options.config.surfaces.dir, DEFAULT_VALUES_DIR_NAME)
    desiredValuesStore = createDesiredValuesFileStore({
      dir: valuesDir,
      fs: nodeDesiredValuesFs,
      logWarn,
    })
    // 操作中のロック(HID-378)。core が値の変更を通す前に持ち主を確かめる
    locks = createLockManager({
      publish: (frame: DownstreamFrame, target) => target === undefined ? hub?.broadcast(frame) : hub?.sendTo(target, frame),
    })
    const activeLocks = locks
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
      adapterKinds: [adapter.kind],
      lockedBy: (refs, clientId, holder) => activeLocks.blockingOwner(refs, clientId, holder)?.label ?? null,
      sendFn: (host, port, address, ...args) => adapter.sendValue({ host, port }, address, args),
      sendBundleFn: (host, port, messages) => adapter.sendValues({ host, port }, messages.map(message => ({
        address: message.address,
        args: [...message.args],
      }))),
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
    const catalogCore = core
    catalog = createCatalogManager({
      publish: (frame: DownstreamFrame, target) => {
        if (target === undefined) hub?.broadcast(frame)
        else hub?.sendTo(target, frame)
        // 設計図が変われば「この PC には無い」の突き合わせも変わる(HID-386)
        if (target === undefined) blueprints?.refresh()
      },
      requestFromTargets: () => catalogCore.requestCatalog(),
      logInfo: options.logInfo,
      logWarn: options.logWarn,
    })
    surfaces = createSurfaceManager({
      store: createSurfaceStore({ dir: options.config.surfaces.dir }),
      onAdopt: (definition, name, imported) => {
        core?.setDefinition(definition, name, imported)
        blueprints?.refresh()
      },
      publish: (frame: DownstreamFrame, target) => target === undefined ? hub?.broadcast(frame) : hub?.sendTo(target, frame),
      logInfo: options.logInfo,
      logWarn: options.logWarn,
    })
    // 設計図からの既定の画面と、採用中の画面の突き合わせ(HID-386)
    const activeCatalog = catalog
    const activeSurfaces = surfaces
    blueprints = createBlueprintManager({
      pcs: () => activeCatalog.pcs(),
      active: () => activeSurfaces.active(),
      adoptBlueprint: (name, generated) => activeSurfaces.adoptBlueprint(name, generated),
      publish: (frame: DownstreamFrame, target) => target === undefined ? hub?.broadcast(frame) : hub?.sendTo(target, frame),
      logInfo: options.logInfo,
    })
    // 宛先タブ(D-078)。保存した選択があれば設定ファイルの宛先より優先し、ping を始める前に差し替えておく
    const activeCore = core
    // 選択の保存先の既定は保持値と同じフォルダの `.destinations.json`(`<name>.values.json` とも、valuesDir を定義の保管先と
    // 同じにした構成の `<定義名>.json` とも重ならない。D-078)
    destinations = createDestinations({
      configTargets: resolveUnityTargets(options.config.unity).map(target => ({
        ...target,
        addresses: (target.primary ? unityAddresses : secondaryAddresses[target.name]) ?? [],
      })),
      sendPort: options.config.unity.sendPort,
      interfaces: createNetworkInterfacesProvider(),
      prober: createLanProber(process.env),
      hostnameResolver: createHostnameResolver(process.env),
      localHostname: () => cleanLocalHostname(os.hostname()),
      store: createDestinationSelectionFile({
        file: options.config.destinations.file ?? path.join(valuesDir, DEFAULT_DESTINATIONS_FILE_NAME),
        fs: nodeDestinationsFs,
        logWarn,
      }),
      // 端末の別名(D-092)。既定は選択と同じフォルダの `.device-aliases.json`
      aliasStore: createDeviceAliasFile({
        file: options.config.destinations.aliasesFile ?? path.join(valuesDir, DEFAULT_DEVICE_ALIASES_FILE_NAME),
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
    // OSC パッド(D-080)。省略時は定義の保管先の `pads`(定義と一緒に運べる)
    const padsDir = options.config.surfaces.padsDir ?? path.join(options.config.surfaces.dir, DEFAULT_PADS_DIR_NAME)
    const padCore = core
    pads = createPadManager({
      // 大きすぎるパッドは保存も採用もしない(起動時の復元でも同じ検証を通るので、UI が受け切れないパッドで詰まない)
      store: createNamedJsonStore({ dir: padsDir, schema: OscPadStoredSchema }),
      activeStore: createPadActiveFile({ dir: padsDir, fs: nodePadActiveFs, logWarn }),
      fire: (address, args) => padCore.firePad(address, args),
      publish: (frame: DownstreamFrame, target) => target === undefined ? hub?.broadcast(frame) : hub?.sendTo(target, frame),
      logInfo: options.logInfo,
      logWarn: options.logWarn,
    })
    // プロジェクトファイル(D-090)。保管と採用は定義・パッド・保持値の既存の経路に任せ、まとめと検証だけを持つ
    projects = createProjectManager({
      surfaces,
      pads,
      heldValues: () => padCore.exportDesired(),
      publish: (frame: DownstreamFrame, target) => target === undefined ? hub?.broadcast(frame) : hub?.sendTo(target, frame),
      logInfo: options.logInfo,
      logWarn: options.logWarn,
    })
    surfaces.start(options.config.surfaces.defaultName)
    destinations.start()
    pads.start()
    core.start()
    return {
      wsPort: hub.port,
      oscListenPort: udp.port,
      async close() {
        destinations?.close()
        catalog?.close()
        locks?.close()
        core?.stop()
        sentLog?.close()
        // 間引きで保留中の保持値を書いてから終わる(SIGINT / SIGTERM でも main がここを通る)
        desiredValuesStore?.close()
        await Promise.all([hub?.close(), udp?.close()])
      },
    }
  } catch (error) {
    destinations?.close()
    catalog?.close()
    locks?.close()
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
const DEFAULT_PADS_DIR_NAME = 'pads'
const nodePadActiveFs: PadActiveFs = fs

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
      mac: entry.mac,
    })),
  )
}

// 走査結果を差し替えるテストでは、実ネットワークの DNS へ名前を問い合わせない
function createHostnameResolver(env: NodeJS.ProcessEnv): HostnameResolver {
  const file = env[TEST_LAN_SCAN_FILE_ENV_VAR]
  return file === undefined || file.trim() === '' ? createSystemHostnameResolver() : NO_HOSTNAMES
}

function cleanLocalHostname(name: string): string | null {
  return name.trim() === '' ? null : name.trim()
}

function createLanProber(env: NodeJS.ProcessEnv): LanProber {
  const file = env[TEST_LAN_SCAN_FILE_ENV_VAR]
  if (file === undefined || file.trim() === '') return createSystemLanProber()
  return {
    async probe(_subnets, signal) {
      const parsed = JSON.parse(await fs.promises.readFile(file, { encoding: 'utf8', signal })) as unknown
      // 要素は IPv4 の文字列か、MAC つきの { host, mac }(端末の別名を MAC で引く E2E 用。D-092)
      const isEntry = (entry: unknown): entry is string | { host: string; mac: string } => typeof entry === 'string'
        ? isIpv4(entry)
        : typeof entry === 'object' && entry !== null && typeof (entry as { host?: unknown }).host === 'string'
          && isIpv4((entry as { host: string }).host) && normalizeMac((entry as { mac?: unknown }).mac as string | undefined) !== null
      if (!Array.isArray(parsed) || !parsed.every(isEntry)) {
        throw new Error(`${TEST_LAN_SCAN_FILE_ENV_VAR} must point to a JSON array of IPv4 addresses or { host, mac } objects.`)
      }
      return parsed.map(entry => typeof entry === 'string' ? { host: entry, mac: null } : { host: entry.host, mac: normalizeMac(entry.mac) })
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
    ...(typeof candidate.mac === 'string' ? { mac: candidate.mac } : {}),
  }
}
