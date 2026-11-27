import { lookup } from 'node:dns/promises'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

import { PadDocumentStoredSchema, resolveUnityTargets, upgradePadDocument, type DownstreamFrame } from '@oscdesk/shared'

import { createDesiredValuesFileStore, type DesiredValuesFileStore, type DesiredValuesFs } from '../adapters/desired-values-file'
import { createDestinationSelectionFile, DEFAULT_DESTINATIONS_FILE_NAME, type DestinationsFs } from '../adapters/destinations-file'
import { createDeviceAliasFile, DEFAULT_DEVICE_ALIASES_FILE_NAME } from '../adapters/device-aliases-file'
import { createDiagnosticsEngine } from '../adapters/diagnostics-engine'
import { createSystemHostnameResolver } from '../adapters/hostname-lookup'
import { createSystemLanProber } from '../adapters/lan-scan'
import { startMdnsDiscovery, type MdnsDiscovery } from '../adapters/mdns-discovery'
import type { NdjsonFs } from '../adapters/ndjson-writer'
import { createNetworkSettings, normalizeAddress, type NetworkSettingsManager } from '../adapters/network-settings'
import { createNetworkSettingsFile, DEFAULT_NETWORK_SETTINGS_FILE_NAME } from '../adapters/network-settings-file'
import { createOscQueryClient } from '../adapters/oscquery-client'
import { createPadActiveFile, type PadActiveFs } from '../adapters/pad-active-file'
import { createPadResendFile, DEFAULT_PAD_RESEND_FILE_NAME, type PadResendFileStore } from '../adapters/pad-resend-file'
import { createPadValuesFileStore, type PadValuesFileStore } from '../adapters/pad-values-file'
import { createSurfaceManager } from '../adapters/surface-manager'
import { createNamedJsonStore, createSurfaceStore } from '../adapters/surface-store'
import { createOscAdapter } from '../adapters/target-adapter'
import { startUdpTransport, type UdpTransport } from '../adapters/udp-transport'
import { startUiHub, type UiHub } from '../adapters/ui-hub'
import { createWebUiStatic, WEB_UI_PATH } from '../adapters/web-ui-static'
import { createBlueprintManager, type BlueprintManager } from '../domain/blueprint-manager'
import { isExpectedHost, isSameOriginPage, localHostNames } from '../domain/browser-access'
import { createCatalogManager, type CatalogManager } from '../domain/catalog-manager'
import { createDestinations, NO_HOSTNAMES, withLoopbackAlias, type Destinations, type HostnameResolver } from '../domain/destinations'
import { isIpv4 } from '../domain/ipv4'
import { inScanRanges, localIpv4Addresses, normalizeMac, scopedScanSubnets, subnetsContaining, type LanProber, type ScanInterface } from '../domain/lan-subnets'
import { createLockManager, type LockManager } from '../domain/lock-manager'
import { createPadManager } from '../domain/pad-manager'
import { createOscQueryTargets, type OscQueryTargets } from '../domain/oscquery-targets'
import { createPadResendSettings, type PadResendSettings } from '../domain/pad-resend'
import { createProjectManager, type ProjectManager } from '../domain/project-manager'
import { createSentLog, type SentLog } from '../domain/sent-log'
import { createSurfaceCore, type BridgeConfig, type InboundOscMessage } from '../domain/surface-core'

const TEST_NETWORK_INTERFACES_ENV_VAR = 'OSCDESK_TEST_NETWORK_INTERFACES'
// E2E 用。走査のたびにこのファイル(ホストの JSON 配列)を読み、その中身を見つかった端末として返す。
// テストがファイルを書き換えれば「端末の増減」を実ネットワークなしで再現できる
const TEST_LAN_SCAN_FILE_ENV_VAR = 'OSCDESK_TEST_LAN_SCAN_FILE'
// E2E 用(D-168)。`off` で mDNS を起動しない(既定のポート 5353 を並列のブリッジで取り合わず、LAN へ問い合わせを撒かない)。
// JSON の { "port": n, "interfaces": ["127.0.0.1"] } で、帯の中のポートとループバックの NIC だけに閉じた mDNS にする。
// E2E の startBridge は既定で off にする
const TEST_MDNS_ENV_VAR = 'OSCDESK_TEST_MDNS'

export interface BridgeServer {
  readonly wsPort: number
  readonly oscListenPort: number
  /** SPA を配っている HTTP のパス(D-138)。配っていなければ null */
  readonly webUiPath: string | null
  close(): Promise<void>
}

export async function startBridgeServer(options: {
  config: BridgeConfig
  /**
   * SPA(packages/web-ui のビルド出力。D-138)のフォルダ。渡したときだけ HTTP の / に配る。
   * 渡さなくても、ブリッジ自身が配ったページ(同じオリジン)からの接続は受ける(別のポートで配った開発用の SPA は断る)
   */
  webUiDir?: string
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
  let padValuesStore: PadValuesFileStore | undefined
  let padResendFile: PadResendFileStore | undefined
  let padResend: PadResendSettings | undefined
  let sentLog: SentLog | undefined
  let catalog: CatalogManager | undefined
  let destinations: Destinations | undefined
  let network: NetworkSettingsManager | undefined
  let locks: LockManager | undefined
  let blueprints: BlueprintManager | undefined
  let oscQuery: OscQueryTargets | undefined
  let discovery: MdnsDiscovery | undefined
  const logWarn = options.logWarn ?? console.warn
  const logError = options.logError ?? console.error
  const oscListenPort = options.config.bridge.oscListenPort
  const wsPort = options.config.bridge.wsPort
  const webUi = options.webUiDir === undefined ? undefined : createWebUiStatic({ dir: options.webUiDir })
  // Host で受けてよい名前(D-138)。OS のホスト名は起動時に 1 回だけ読む(実行中に変えるのは稀で、変えたら再起動する)
  const hostNames = localHostNames(os.hostname())
  if (options.webUiDir !== undefined && !fs.existsSync(path.join(options.webUiDir, 'index.html'))) {
    // 起動は止めない(OSC の中継とブラウザでない道具はそのまま使える)。開いたブラウザには 503 で案内を出す
    logWarn('(WARN, BRIDGE)', 'The web UI is not built; / answers 503 until it is (run: corepack pnpm -r run build)', { dir: options.webUiDir })
  }

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

    // 保持値の保存先(D-058)。省略時は定義の保管先の `.values`(定義の一覧には *.json しか出ないので混ざらない)
    const valuesDir = options.config.surfaces.valuesDir ?? path.join(options.config.surfaces.dir, DEFAULT_VALUES_DIR_NAME)
    // ネットワークの設定(D-113)。ターゲット向けの待ち受けアドレスと接続してよいブラウザの範囲を決めるので、
    // UDP と WebSocket の待ち受けより先に読む
    const interfacesProvider = createNetworkInterfacesProvider()
    network = createNetworkSettings({
      configListenHost: options.config.bridge.oscListenHost,
      store: createNetworkSettingsFile({
        file: options.config.network.file ?? path.join(valuesDir, DEFAULT_NETWORK_SETTINGS_FILE_NAME),
        fs: nodeDestinationsFs,
        logWarn,
      }),
      interfaces: interfacesProvider,
      rebind: async host => {
        if (udp === undefined) throw new Error('the target socket is not open')
        await udp.rebind(host)
      },
      onScopeChanged: () => {
        destinations?.rescope()
        discovery?.setInterfaces(mdnsInterfaces())
        // 範囲の外になったターゲットを外し、前に範囲の外として断ったサービスを知らせ直す(D-168)
        oscQuery?.revalidate()
        discovery?.renotify()
      },
      onAllowedChanged: () => {
        const closed = hub?.closeDisallowed() ?? 0
        if (closed > 0) logWarn('(WARN, BRIDGE)', `Closed ${String(closed)} WebSocket connection(s) outside the allowed browser range.`)
      },
      peerOf: clientId => hub?.peerOf(clientId),
      publish: (frame: DownstreamFrame, target) => target === undefined ? hub?.broadcast(frame) : hub?.sendTo(target, frame),
      logInfo: options.logInfo,
      logWarn: options.logWarn,
    })
    const activeNetwork = network
    const mdnsOverride = readMdnsOverride(process.env)
    // mDNS で探す NIC は、ターゲット向けのネットワーク(D-113)で絞った走査ネットワークの、この PC のアドレス
    const mdnsInterfaces = (): string[] => mdnsOverride !== null && mdnsOverride !== 'off'
      ? [...mdnsOverride.interfaces]
      : [...new Set(scopedScanSubnets(interfacesProvider(), activeNetwork.scope()).map(subnet => subnet.address))]
    const { bindHost } = network.start()
    // ターゲットとのやり取りは通信アダプタ(HID-373・D-110)を通す。今は OSC のアダプタだけ
    const adapter = createOscAdapter({
      transport: () => udp,
      handlers: () => ({
        delivered: message => core?.handleOscIn(message),
        alive: message => core?.handleOscIn(message),
        // 設計図(D-104)は core の手前で受ける。core は /sys/* を読み捨てるだけなので、先に取らないと届かない
        blueprint: message => catalog?.handleOscIn(message) === true,
        // 対象なし・処理失敗(HID-375)は送り先ブロックの点灯(D-116)にだけ使う(UI へ生の OSC として流さない)
        unbound: (from, refs) => core?.handleUndelivered(from, 'ignored', refs),
        failed: (from, entries) => core?.handleUndelivered(from, 'failed', entries.map(entry => entry.ref)),
      }),
    })
    const udpOptions = {
      port: oscListenPort,
      onMessage: (message: InboundOscMessage) => adapter.receive(message),
      onDecodeError: (error: unknown, from: { host: string; port: number }) => logWarn('(WARN, BRIDGE)', 'OSC decode failed', from, error),
      onSocketError: (error: Error) => logError('(ERROR, BRIDGE)', 'UDP socket error', error),
      logError,
    }
    try {
      udp = await startUdpTransport({ ...udpOptions, host: bindHost })
    } catch (error) {
      // 保存したアドレスで待ち受けられなければ、設定ファイルのアドレスで起動する(ブラウザから選び直せる)
      if (bindHost === options.config.bridge.oscListenHost) throw error
      logWarn('(WARN, BRIDGE)', `Could not listen for targets on ${bindHost}; using ${options.config.bridge.oscListenHost} from the config.`, error)
      network.fallBackToConfigInterface()
      udp = await startUdpTransport({ ...udpOptions, host: options.config.bridge.oscListenHost })
    }
    hub = await startUiHub({
      host: options.config.bridge.wsHost,
      port: wsPort,
      onConnect: (clientId, peer) => {
        // 送信元を hello に載せる(SPA のネットワークのタブの「このブラウザ」。D-153)。判定には使わない
        core?.onUiConnected(clientId, normalizeAddress(peer.host))
        // 送信ログ(D-067)の既存分は hello・link の後に届ける
        sentLog?.publishBacklog(clientId)
        // 宛先タブ(D-078)は定義に依存しないので、surfaceRequest を待たずに接続時に送る
        destinations?.publish(clientId)
        // ネットワークの設定(D-113)も定義に依存しないので接続時に送る
        network?.publish(clientId)
        catalog?.publish(clientId)
        oscQuery?.publish(clientId)
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
        if (network?.handleUiFrame(frame, clientId) === true) return
        // 送信先パネルの「更新」は NIC を取り直す。後から足した NIC・DHCP で変わったアドレスをネットワークのタブでも
        // 選べるよう、候補(interfaces)を全 UI へ配り直す(ネットワークの設定は接続時と変更時にしか配らないため)
        if (frame.type === 'destinationsScan') network?.publish()
        if (destinations?.handleUiFrame(frame, clientId) === true) return
        if (oscQuery?.handleUiFrame(frame, clientId) === true) return
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
        // 旧画面からの set・setRow・batch(HID-373・HID-389)は、定義の版が違えば送らない。同じ id が新しい定義で
        // 別のアドレスに読み替わるため
        if ((frame.type === 'set' || frame.type === 'setRow' || frame.type === 'batch')
          && frame.revision !== undefined && frame.revision !== surfaces?.activeRevision()) {
          const [code, what] = frame.type === 'set'
            ? ['set-rejected', frame.param]
            : frame.type === 'setRow' ? ['row-rejected', `${frame.record}[${frame.key}]`] : ['batch-rejected', 'batch']
          // batch の印(requestId)は拒否にも載せる(HID-482。core の rejectBatch と同じ)
          const answer = frame.type === 'batch' && frame.requestId !== undefined ? { requestId: frame.requestId } : {}
          hub?.sendTo(clientId, { v: 1, type: 'notice', level: frame.type === 'set' ? 'warn' : 'error', code, detail: `stale-surface: ${what}`, ...answer })
          return
        }
        core?.handleUiFrame(frame, clientId)
      },
      onHttpRequest: (request, response) => webUi?.handle(request, response) === true || (surfaces?.handleHttp(request, response) ?? false),
      isHostAllowed: (host) => isExpectedHost(host, hostNames),
      isOriginAllowed: (origin, host) => isSameOriginPage(origin, host, hostNames),
      onHostRejected: (kind, host, peer) => logWarn('(WARN, BRIDGE)', 'Rejected a request with an unexpected Host (DNS rebinding?)', { kind, host, peer }),
      onHttpRejected: (method, origin, peer) => logWarn('(WARN, BRIDGE)', 'Rejected browser-originated HTTP request', { method, origin: origin.slice(0, 200), peer }),
      onHandshakeRejected: (origin, peer) => logWarn('(WARN, BRIDGE)', 'Rejected browser-originated WebSocket handshake', { origin: origin.slice(0, 200), peer }),
      onInvalidFrame: (clientId, reason, raw) => logWarn('(WARN, BRIDGE)', 'Invalid UI frame', { clientId, reason, raw }),
      // 接続してよいブラウザの範囲(D-113)。この PC の localhost は常に通る
      isPeerAllowed: address => activeNetwork.isBrowserAllowed(address),
      onPeerRejected: (kind, peer) => logWarn('(WARN, BRIDGE)', `Rejected ${kind === 'http' ? 'an HTTP request' : 'a WebSocket connection'} from ${peer} (outside the allowed browser range)`),
      logError,
    })
    desiredValuesStore = createDesiredValuesFileStore({
      dir: valuesDir,
      fs: nodeDesiredValuesFs,
      logWarn,
    })
    // 操作中のロック(HID-378)。core が値の変更を通す前に持ち主を確かめる
    locks = createLockManager({
      publish: (frame: DownstreamFrame, target) => target === undefined ? hub?.broadcast(frame) : hub?.sendTo(target, frame),
      // 採用中の定義・パッドに無い単位のロックは断る(HID-392・D-169)。core とパッドはこの後で作るので呼ばれた時点で引く
      isKnownRef: ref => (core?.isLockableRef(ref) ?? false) || (pads?.isLockableRef(ref) ?? false),
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
      // 起動 ID の変化でターゲットの起動を知り、自動の再送が入っていればパッドの保持値をその 1 台へ送り直す(D-169)。
      // 見た起動 ID は自動の再送を切っていても覚える(入れた直後に、動いていたターゲットを起動とみなさないように)
      onBootId: (to, bootId) => {
        if (bootId !== null && padResend?.observeBoot(`${to.host}:${String(to.port)}`, bootId) === true) pads?.onTargetStarted(to)
      },
      onTargetEcho: (address, args, source) => pads?.handleEcho(address, args, source),
      // パッドの部品・行のロック(D-169)も、osc.message・osc.batch・定義の操作で確かめる
      padLockRefs: address => pads?.lockRefsOfAddress(address) ?? [],
      // パッドが値を持つアドレスは定義の保持値の再送から除く(D-169)
      padHeldAddresses: () => pads?.heldAddresses() ?? new Set<string>(),
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
      // 起動の合図でサーフェス定義の保持値をその PC へ送り直す(HID-385。生成の記録は D-166 で撤去した)
      onTargetStarted: host => catalogCore.onTargetStarted(host),
      // Sync の答えは要求の時点から ping に答え続けている PC の begin だけ(HID-396)
      upSinceOfSource: host => catalogCore.upSinceOfSource(host),
      logInfo: options.logInfo,
      logWarn: options.logWarn,
    })
    surfaces = createSurfaceManager({
      store: createSurfaceStore({ dir: options.config.surfaces.dir, logInfo: options.logInfo, logWarn: options.logWarn }),
      onAdopt: (definition, name, imported) => {
        core?.setDefinition(definition, name, imported)
        blueprints?.refresh()
      },
      publish: (frame: DownstreamFrame, target) => target === undefined ? hub?.broadcast(frame) : hub?.sendTo(target, frame),
      logInfo: options.logInfo,
      logWarn: options.logWarn,
      logError,
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
      interfaces: interfacesProvider,
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
      scanScope: () => activeNetwork.scope(),
      applyTargets: targets => activeCore.setTargets(targets),
      discovered: () => oscQuery?.destinations() ?? [],
      currentTargets: () => activeCore.currentTargets(),
      primaryHosts: () => activeCore.primaryHosts(),
      publish: (frame: DownstreamFrame, target) => target === undefined ? hub?.broadcast(frame) : hub?.sendTo(target, frame),
      logInfo: options.logInfo,
      logWarn: options.logWarn,
    })
    // OSC パッド(D-080)。省略時は定義の保管先の `pads`(定義と一緒に運べる)
    const padsDir = options.config.surfaces.padsDir ?? path.join(options.config.surfaces.dir, DEFAULT_PADS_DIR_NAME)
    const padCore = core
    // 自動の再送の設定と見た起動 ID(D-169)。既定は保持値と同じフォルダの `.pad-resend.json`
    padResendFile = createPadResendFile({ file: path.join(valuesDir, DEFAULT_PAD_RESEND_FILE_NAME), fs: nodeDestinationsFs, logWarn })
    padResend = createPadResendSettings({
      store: padResendFile,
      publish: (frame: DownstreamFrame, target) => target === undefined ? hub?.broadcast(frame) : hub?.sendTo(target, frame),
      logInfo: options.logInfo,
    })
    // パッドの保持値(D-169)は保持値の保管先に `<パッド名>.pad-values.json` で残す
    padValuesStore = createPadValuesFileStore({ dir: valuesDir, fs: nodeDestinationsFs, logWarn })
    pads = createPadManager({
      // パッドは版 2(D-167)で保管する。版 1 のファイルは読み込むときに版 2 で書き直す(直前の内容は .backups へ退避する)。
      // 大きすぎるパッドは保存も採用もしない(起動時の復元でも同じ検証を通るので、UI が受け切れないパッドで詰まない)
      store: createNamedJsonStore({ dir: padsDir, schema: PadDocumentStoredSchema, upgrade: upgradePadDocument, logInfo: options.logInfo, logWarn: options.logWarn }),
      activeStore: createPadActiveFile({ dir: padsDir, fs: nodePadActiveFs, logWarn }),
      valuesStore: padValuesStore,
      resend: padResend,
      fire: (address, args, origin) => padCore.firePad(address, args, origin),
      // 手動の同期は今の宛先に加えて、OSCQuery で見つけたターゲット(ホストと OSC の受信ポートの組。D-168)へも送れる。
      // 見つけたターゲットはターゲットがいる範囲の中だけなので(isAllowedHost)、任意のアドレスへは送らない
      syncTargets: selection => {
        const chosen = padCore.syncTargets(selection)
        if (chosen.ok || selection.target !== undefined || selection.host === undefined || selection.port === undefined) return chosen
        const found = (oscQuery?.destinations() ?? []).find(candidate => candidate.host === selection.host && candidate.oscPort === selection.port)
        return found === undefined ? chosen : { ok: true, targets: [{ name: found.name ?? found.host, host: found.host, port: found.oscPort }] }
      },
      sync: (to, reason, messages) => padCore.sendSync(to, reason, messages),
      lockedBy: (refs, clientId, holder) => activeLocks.blockingOwner(refs, clientId, holder)?.label ?? null,
      lockRefsOf: (address, args) => padCore.lockRefsOf(address, args),
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
    // OSCQuery のターゲット(D-168)。mDNS で見つけたものは、ターゲット向けのネットワークの中か、この PC のものだけを読む
    // (LAN の誰でも mDNS で答えられるので、任意のアドレスへブリッジに HTTP を取りに行かせない)
    const oscQueryConfig = options.config.oscQuery
    oscQuery = createOscQueryTargets({
      configTargets: oscQueryConfig.targets,
      client: createOscQueryClient(),
      // host は mDNS の応答の送信元(A レコードではない)なので、ループバックとこの PC のアドレスはこの PC のプロセスの答え。
      // ほかの端末はターゲットがいる範囲(D-113)の中だけ(ネットワークに含まれても範囲の外なら読まない)
      isAllowedHost: host => {
        if (host.startsWith('127.') || localIpv4Addresses(interfacesProvider()).has(host)) return true
        return subnetsContaining(host, scopedScanSubnets(interfacesProvider(), activeNetwork.scope())).some(subnet => inScanRanges(host, subnet))
      },
      mdnsState: () => discovery?.state ?? 'off',
      // 問い合わせ直しに加えて、いま見えているサービスも知らせ直す(断ったサービスを拾い直す。告知の間引きで黙らないように)
      requery: () => {
        discovery?.query()
        discovery?.renotify()
      },
      publish: (frame: DownstreamFrame, target) => target === undefined ? hub?.broadcast(frame) : hub?.sendTo(target, frame),
      onDestinationsChanged: () => destinations?.discoveredChanged(),
      // HOST_INFO の起動 ID も pong のものと同じ記録(host:OSC の受信ポート)で比べる(D-169)。自動の再送は今の宛先の 1 台にだけ送る
      // HOST_INFO の起動 ID は、今 ping に答えている送り先へ引けたときだけ、pong と同じ記録の印(宛先の host と送信ポート)で比べる
      // (D-169。PR #175 のレビュー)。引けないとき(送り先でない・まだ答えていない・喪失中)は記録もせず、次の pong に任せる。
      // 先に記録すると、送り先として確定した後の pong で同じ起動 ID を見て送り直さない。喪失中を待つのは、回復の pong で
      // サーフェス定義の保持値を送ってからパッドを同期するため(古い定義の値でパッドの値を巻き戻さない)
      onBootId: (endpoint, bootId) => {
        const to = activeCore.answeringSyncTarget(endpoint.host, endpoint.oscPort)
        if (to === null) return
        if (padResend?.observeBoot(`${to.host}:${String(to.port)}`, bootId) === true) pads?.onTargetStarted(to)
      },
      fetchTimeoutMs: oscQueryConfig.fetchTimeoutMs,
      refreshDebounceMs: oscQueryConfig.refreshDebounceMs,
      logInfo: options.logInfo,
      logWarn: options.logWarn,
    })
    const activeOscQuery = oscQuery
    surfaces.start(options.config.surfaces.defaultName)
    destinations.start()
    pads.start()
    core.start()
    oscQuery.start()
    if (oscQueryConfig.mdns && mdnsOverride !== 'off') {
      discovery = startMdnsDiscovery({
        interfaces: mdnsInterfaces(),
        ...(mdnsOverride === null ? {} : { port: mdnsOverride.port }),
        queryIntervalMs: oscQueryConfig.queryIntervalMs,
        onFound: service => activeOscQuery.serviceFound(service),
        onLost: instance => activeOscQuery.serviceLost(instance),
        onStateChanged: () => activeOscQuery.publish(),
        logWarn,
      })
    }
    return {
      wsPort: hub.port,
      oscListenPort: udp.port,
      webUiPath: webUi === undefined ? null : WEB_UI_PATH,
      async close() {
        discovery?.close()
        oscQuery?.close()
        destinations?.close()
        catalog?.close()
        locks?.close()
        core?.stop()
        sentLog?.close()
        // 間引きで保留中の保持値を書いてから終わる(SIGINT / SIGTERM でも main がここを通る)
        desiredValuesStore?.close()
        padValuesStore?.close()
        padResendFile?.close()
        await Promise.all([hub?.close(), udp?.close()])
      },
    }
  } catch (error) {
    discovery?.close()
    oscQuery?.close()
    destinations?.close()
    catalog?.close()
    locks?.close()
    core?.stop()
    sentLog?.close()
    desiredValuesStore?.close()
    padValuesStore?.close()
    padResendFile?.close()
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

function readMdnsOverride(env: NodeJS.ProcessEnv): 'off' | { port: number; interfaces: readonly string[] } | null {
  const raw = env[TEST_MDNS_ENV_VAR]
  if (raw === undefined || raw.trim() === '') return null
  if (raw.trim() === 'off') return 'off'
  const parsed = JSON.parse(raw) as { port?: unknown; interfaces?: unknown }
  if (typeof parsed.port !== 'number' || !Number.isInteger(parsed.port) || parsed.port < 1 || parsed.port > 65535
    || !Array.isArray(parsed.interfaces) || !parsed.interfaces.every(entry => typeof entry === 'string' && isIpv4(entry))) {
    throw new Error(`${TEST_MDNS_ENV_VAR} must be "off" or JSON { "port": <port>, "interfaces": [<IPv4>...] }.`)
  }
  return { port: parsed.port, interfaces: parsed.interfaces as string[] }
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
