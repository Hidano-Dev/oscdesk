import {
  isInternalAddress,
  isOscdeskAddress,
  OSCDESK,
  OSCDESK_DIAG,
  SYS,
  type DownstreamFrame,
  type LinkManifestStatus,
  type LinkRejection,
  type LinkUnityStatus,
  type Manifest,
  type ManifestAdoption,
  type OscArg,
  type SurfaceDefinition,
  type BridgeConfig as RuntimeBridgeConfig,
  type UpstreamFrame,
} from '@oscdesk/shared'

import { createDesiredValues } from './desired-values'
import { ManifestClient } from './manifest-client'
import { PingMonitor } from './ping-monitor'
import { OscUiRouter } from './osc-ui-router'

const PING_INTERVAL_MS = 2_000
const RESEND_COALESCE_MS = 1_000
// UI が最後に操作してからこの間は、遅れて届く旧いエコーを食い違いとして警告しない(ドラッグ中の誤警告を避ける)
const ECHO_SETTLE_MS = 1_000

type TimerHandle = ReturnType<typeof setInterval> | number
type LogFn = (message?: unknown, ...optionalParams: unknown[]) => void
type SendFn = (host: string, port: number, address: string, ...args: OscArg[]) => void
type BundleSendFn = (host: string, port: number, messages: readonly { address: string; args: readonly OscArg[] }[]) => BundleSendResult

export type BundleSendResult =
  | { ok: true; bytes: number; messageCount: number }
  | { ok: false; reason: 'too-large'; bytes: number; limitBytes: number }
  | { ok: false; reason: 'transport-unavailable' }

export type ClientId = string

export interface InboundOscMessage {
  address: string
  args: readonly OscArg[]
  from: { host: string; port: number }
}

export type BridgeConfig = RuntimeBridgeConfig & {
  server?: { name?: string; version?: string }
}

export interface SurfaceCoreDeps {
  config: BridgeConfig
  /** unity.host がホスト名のときの名前解決済み数値アドレス(OSC ネイティブ UI 判定用)。 */
  unityAddresses?: readonly string[]
  sendFn: SendFn
  sendBundleFn?: BundleSendFn
  publish: (frame: DownstreamFrame, target?: ClientId) => void
  now?: () => number
  setIntervalFn?: (cb: () => void, ms: number) => TimerHandle
  clearIntervalFn?: (handle: TimerHandle) => void
  logInfo?: LogFn
  logWarn?: LogFn
  logError?: LogFn
  createDiagnosticsEngine?: (deps: Record<string, unknown>) => DiagnosticsHooks
  createGuardEventLog?: (deps: Record<string, unknown>) => GuardHooks
}

interface DiagnosticsHooks {
  recordIncoming?: (address: string, args: readonly OscArg[], host: string, port: number) => void
  recordOutgoing?: (address: string, args: readonly OscArg[], host: string, port: number) => void
  onPingCycle?: (event: { previousLost: boolean }) => void
  onPongAccepted?: () => void
  snapshot?: () => unknown
  dispose: () => void
}

interface GuardHooks {
  recordRejection: (event: {
    expectedProjectId: string
    receivedProjectId: string
    isRepeat: boolean
    peer?: { host: string; port: number }
  }) => void
  dispose: () => void
}

export interface SurfaceCore {
  start(): void
  stop(): void
  handleOscIn(message: InboundOscMessage): void
  handleUiFrame(frame: UpstreamFrame, clientId: ClientId): void
  onUiConnected(clientId: ClientId): void
  onUiDisconnected(clientId: ClientId): void
  linkSnapshot(): { unity: LinkUnityStatus; manifest: LinkManifestStatus; lastRejection: LinkRejection | null }
  helloFrame(clientId: ClientId): DownstreamFrame
  /** 定義の採用を保持値へ反映し、全 UI へ配って(Unity 到達可能なら)再送する。null は採用解除。 */
  setDefinition(definition: SurfaceDefinition | null): void
  /** 保持値の全量を指定の UI へ送る(定義が無ければ何もしない)。 */
  publishDesired(clientId: ClientId): void
}

export function createSurfaceCore(deps: SurfaceCoreDeps): SurfaceCore {
  const now = deps.now ?? Date.now
  const setIntervalFn = deps.setIntervalFn ?? setInterval
  const clearIntervalFn = deps.clearIntervalFn ?? clearInterval
  const logInfo = deps.logInfo ?? console.info
  const logWarn = deps.logWarn ?? console.warn
  const logError = deps.logError ?? console.error
  const monitor = new PingMonitor()
  const uiRouter = deps.config.oscUi.enabled
    ? new OscUiRouter({
        unity: { host: deps.config.unity.host, port: deps.config.unity.sendPort },
        unityAddresses: deps.unityAddresses,
        config: deps.config.oscUi,
      })
    : null
  const desired = createDesiredValues()
  const manifests = new ManifestClient({ expectedProjectId: deps.config.expectedProjectId })
  let timer: TimerHandle | null = null
  let stopped = false
  let refreshAfterRecovery = false
  let hasBeenReachable = false
  let hasDefinition = false
  let acceptedManifest: Manifest | null = null
  let acceptedAdoption: ManifestAdoption | null = null
  let adoptionSeq = 0
  let lastRejection: LinkRejection | null = null
  let lastLinkPublishedAt = -Infinity
  const warnedInternalAddresses = new Set<string>()
  const warnedNonUnitySources = new Set<string>()
  const warnedEchoMismatch = new Set<string>()
  const unityHosts = new Set([deps.config.unity.host, ...(deps.unityAddresses ?? [])])
  const isUnityHost = (host: string) => unityHosts.has(host)
  let diagnostics: DiagnosticsHooks | null = null
  let guardLog: GuardHooks | null = null

  const publishLink = (target?: ClientId, force = false) => {
    const timestamp = now()
    if (!force && timestamp - lastLinkPublishedAt < PING_INTERVAL_MS) return
    lastLinkPublishedAt = timestamp
    deps.publish({ v: 1, type: 'link', ...linkSnapshot() }, target)
  }

  const sendMessage: SendFn = (host, port, address, ...args) => {
    if (isBridgeInternalAddress(address)) {
      if (!warnedInternalAddresses.has(address)) {
        warnedInternalAddresses.add(address)
        logWarn('(WARN, BRIDGE)', `Blocked outbound internal message "${address}".`)
      }
      return
    }
    diagnostics?.recordOutgoing?.(address, args, host, port)
    deps.sendFn(host, port, address, ...args)
  }

  const rejectBatch = (clientId: ClientId, detail: string) => {
    deps.publish({ v: 1, type: 'notice', level: 'error', code: 'batch-rejected', detail }, clientId)
  }

  const publishManifest = (target?: ClientId) => {
    if (acceptedManifest === null || acceptedAdoption === null) return
    const frame = { v: 1 as const, type: 'manifest' as const, manifest: acceptedManifest, adoption: acceptedAdoption }
    if (target === undefined) deps.publish(frame)
    else deps.publish(frame, target)
  }


  const desiredFrame = (full: boolean, values = desired.snapshot()): DownstreamFrame => ({
    v: 1, type: 'desired', full,
    values: values.map(value => ({ address: value.address, args: toWireArgs(value.args) })),
  })

  const publishDesiredFull = (target?: ClientId) => {
    if (!hasDefinition) return
    deps.publish(desiredFrame(true), target)
  }

  // 保持値を Unity へ送り直す(D-045)。state のみが対象で、trigger は保持していないため再送されない。
  // 再起動では pong の回復とマニフェストの bootId 変化が続けて起きる。二重の送信は演出などの副作用を
  // 繰り返し起こすため、直近 1 秒以内の再送はまとめる。
  let lastResendAt = -Infinity
  const resendDesired = (reason: string, only?: ReadonlySet<string>) => {
    const timestamp = now()
    if (only === undefined && timestamp - lastResendAt < RESEND_COALESCE_MS) return
    const values = desired.snapshot().filter(value => only === undefined || only.has(value.address))
    if (values.length === 0) return
    if (only === undefined) lastResendAt = timestamp
    logInfo('(INFO, BRIDGE)', `Resending ${String(values.length)} desired value(s) to Unity (${reason}).`)
    for (const value of values) sendMessage(deps.config.unity.host, deps.config.unity.sendPort, value.address, ...value.args)
  }

  const lastOperatedAt = new Map<string, number>()
  const recordDesired = (messages: readonly { address: string; args: readonly OscArg[] }[]) => {
    const changed = messages.filter(message => desired.record(message.address, message.args))
    for (const message of changed) lastOperatedAt.set(message.address, now())
    if (changed.length > 0) deps.publish(desiredFrame(false, changed))
  }

  const isUnityReachable = () => {
    const status = monitor.snapshot()
    return status.lastPongSeq !== null && status.consecutiveLosses === 0
  }

  const requestManifest = () => {
    if (manifests.shouldRequest(now())) {
      sendMessage(deps.config.unity.host, deps.config.unity.sendPort, SYS.MANIFEST_REQUEST)
      manifests.onRequestSent(now())
    }
  }

  const requestStats = () => {
    if (manifests.shouldRequestStats(now())) {
      sendMessage(deps.config.unity.host, deps.config.unity.sendPort, SYS.STATS_REQUEST)
      manifests.onStatsRequestSent(now())
    }
  }

  const handleStats = (payload: string) => {
    const result = manifests.onStatsPayload(payload)
    if (result.kind === 'mismatch') {
      logInfo('(INFO, BRIDGE)', `Unity manifest origin changed (bootId ${result.reported.bootId}, generation ${String(result.reported.structureGeneration)}); requesting manifest.`)
      requestManifest()
    } else if (result.kind === 'invalid' && !result.isRepeat) {
      logWarn('(WARN, BRIDGE)', `Invalid /sys/stats payload: ${result.detail}`)
    }
  }

  const tick = () => {
    if (stopped) return
    const before = monitor.snapshot().consecutiveLosses
    const seq = monitor.nextPing(now())
    refreshAfterRecovery ||= monitor.snapshot().consecutiveLosses > before
    diagnostics?.onPingCycle?.({ previousLost: monitor.snapshot().consecutiveLosses > before })
    sendMessage(deps.config.unity.host, deps.config.unity.sendPort, SYS.PING, { type: 'i', value: seq })
    requestManifest()
    requestStats()
    publishLink()
  }

  const handleManifest = (message: InboundOscMessage, payload: string) => {
    const result = manifests.onManifestPayload(payload)
    if (result.accepted !== true) {
      const rejected = result as Extract<typeof result, { accepted: false }>
      if (!rejected.isRepeat) logError('(ERROR, BRIDGE)', `Manifest ${rejected.reason}: ${rejected.detail}`)
      lastRejection = {
        ts: new Date(now()).toISOString(),
        reason: rejected.reason,
        detail: rejected.detail,
        receivedProjectId: rejected.reason === 'project-mismatch' ? rejected.receivedProjectId : null,
      }
      if (rejected.reason === 'project-mismatch') {
        guardLog?.recordRejection({
          expectedProjectId: rejected.expectedProjectId,
          receivedProjectId: rejected.receivedProjectId,
          isRepeat: rejected.isRepeat,
          peer: message.from,
        })
      }
      publishLink(undefined, true)
      return
    }
    if (result.duplicate) {
      // 採用は発行しないが、直前の拒否表示は有効なマニフェストの受信で解除する
      if (lastRejection !== null) {
        lastRejection = null
        publishLink(undefined, true)
      }
      return
    }
    if (result.bootChanged) {
      logInfo('(INFO, BRIDGE)', 'Unity restart detected (bootId changed); adopting new manifest.')
      resendDesired('Unity restart')
    }
    acceptedManifest = result.manifest as Manifest
    acceptedAdoption = { seq: ++adoptionSeq, at: new Date(now()).toISOString() }
    lastRejection = null
    publishManifest()
    publishLink(undefined, true)
  }

  const linkSnapshot = () => ({
    unity: unityStatus(),
    manifest: acceptedManifest === null
      ? ({ state: 'none' } as const)
      : ({ state: 'accepted', projectId: acceptedManifest.projectId, entryCount: acceptedManifest.entries?.length ?? 0 } as const),
    lastRejection,
  })

  function unityStatus(): LinkUnityStatus {
    const status = monitor.snapshot()
    return {
      reachability: status.consecutiveLosses > 0 ? 'lost' : status.lastPongSeq === null ? 'unknown' : 'reachable',
      lastRttMs: status.lastRttMs,
      consecutiveLosses: status.consecutiveLosses,
      lastPongSeq: status.lastPongSeq,
    }
  }

  return {
    start() {
      if (timer !== null) return
      diagnostics = deps.config.debug
        ? deps.createDiagnosticsEngine?.({ config: deps.config, getStatus: () => unityStatus(), now }) ?? null
        : null
      guardLog = deps.createGuardEventLog?.({ config: deps.config, now }) ?? null
      stopped = false
      requestManifest()
      timer = setIntervalFn(tick, PING_INTERVAL_MS)
    },
    stop() {
      if (timer === null) {
        stopped = true
        return
      }
      clearIntervalFn(timer)
      timer = null
      diagnostics?.dispose()
      guardLog?.dispose()
      diagnostics = null
      guardLog = null
      stopped = true
    },
    handleOscIn(message) {
      if (stopped) return
      diagnostics?.recordIncoming?.(message.address, message.args, message.from.host, message.from.port)
      if (message.address === OSCDESK.HELLO) {
        if (uiRouter !== null) {
          // 名乗りにポート引数が無い(または不正な)場合は送信元ポートへフォールバックする。
          const arg = message.args[0]
          const announcedPort = arg?.type === 'i' && Number.isInteger(arg.value) && arg.value >= 1 && arg.value <= 65535
            ? arg.value
            : message.from.port
          uiRouter.registerPeer(message.from.host, announcedPort, now())
        }
        return
      }
      // Unity の制御応答(pong / manifest)は設定された Unity ホスト以外から受理しない。
      // 検証しないと、LAN 内の任意のピアが偽マニフェストで UI のコントロールを
      // 差し替えたり、偽 pong で到達性表示を偽装できる
      if ((message.address === SYS.PONG || message.address === SYS.MANIFEST || message.address === SYS.STATS) && !isUnityHost(message.from.host)) {
        if (!warnedNonUnitySources.has(message.from.host)) {
          warnedNonUnitySources.add(message.from.host)
          logWarn('(WARN, BRIDGE)', `Ignored ${message.address} from non-Unity source ${message.from.host}:${String(message.from.port)}.`)
        }
        return
      }
      if (message.address === SYS.PONG) {
        const arg = message.args[0]
        if (arg?.type === 'i' && Number.isInteger(arg.value)) {
          const result = monitor.onPong(arg.value, now())
          if (result.accepted && (!hasBeenReachable || result.recoveredFromLoss)) {
            resendDesired(hasBeenReachable ? 'Unity recovered' : 'Unity first reachable')
          }
          if (result.accepted) hasBeenReachable = true
          if (result.accepted && (result.recoveredFromLoss || refreshAfterRecovery)) {
            refreshAfterRecovery = false
            manifests.onReachabilityRecovered()
            requestManifest()
          }
          if (result.accepted) publishLink()
          if (result.accepted) diagnostics?.onPongAccepted?.()
        }
        return
      }
      if (message.address === SYS.MANIFEST) {
        const arg = message.args[0]
        if (arg?.type !== 's') {
          logError('(ERROR, BRIDGE)', 'Manifest payload must be a string.')
          return
        }
        handleManifest(message, arg.value)
        return
      }
      if (message.address === SYS.STATS) {
        const arg = message.args[0]
        if (arg?.type === 's') handleStats(arg.value)
        return
      }
      if (message.address === OSCDESK_DIAG.REQUEST) {
        const snapshot = diagnostics?.snapshot?.()
        if (snapshot !== undefined) {
          deps.sendFn(message.from.host, message.from.port, OSCDESK_DIAG.SNAPSHOT, {
            type: 's', value: JSON.stringify(snapshot),
          })
        }
        return
      }
      // OSC ネイティブクライアント向けの UDP 応答。返信は /oscdesk/* なので、
      // 送出抑止(sendMessage)を通さず要求元へ直接返す(診断応答と同じ扱い)。
      if (message.address === OSCDESK.MANIFEST_REQUEST) {
        if (acceptedManifest !== null) {
          deps.sendFn(message.from.host, message.from.port, OSCDESK.MANIFEST, {
            type: 's', value: JSON.stringify(acceptedManifest),
          })
        }
        return
      }
      if (message.address === OSCDESK.STATUS_REQUEST) {
        deps.sendFn(message.from.host, message.from.port, OSCDESK.STATUS, {
          type: 's', value: JSON.stringify(linkSnapshot()),
        })
        return
      }
      if (isInternalAddress(message.address)) return
      // OSC ネイティブ UI の中継(D-7)は WebSocket UI への配信と併存する。
      // 中継の可否で publish を止めないこと(止めると WebSocket UI から外部 OSC が見えなくなる)。
      if (uiRouter !== null) {
        const decision = uiRouter.route(message.from, now())
        if (decision.kind === 'to-unity') {
          sendMessage(deps.config.unity.host, deps.config.unity.sendPort, message.address, ...message.args)
          // OSC ネイティブ UI の操作も保持値に入れる(入れないと Unity 再起動の再送で巻き戻る)
          recordDesired([{ address: message.address, args: message.args }])
        } else if (decision.kind === 'to-ui') {
          for (const target of decision.targets) {
            deps.sendFn(target.host, target.port, message.address, ...message.args)
          }
        }
      }
      // 保持値と食い違うエコーは書き換えず警告だけ残す(D-045)。同じアドレスの警告は一致に戻るまで 1 回。
      const settling = now() - (lastOperatedAt.get(message.address) ?? -Infinity) < ECHO_SETTLE_MS
      if (isUnityHost(message.from.host) && !settling && desired.differsFromEcho(message.address, message.args)) {
        if (!warnedEchoMismatch.has(message.address)) {
          warnedEchoMismatch.add(message.address)
          logWarn('(WARN, BRIDGE)', `Unity echo differs from desired value for "${message.address}".`)
        }
      } else {
        warnedEchoMismatch.delete(message.address)
      }
      deps.publish({ v: 1, type: 'osc', address: message.address, args: toWireArgs(message.args), from: message.from })
    },
    handleUiFrame(frame, clientId) {
      if (frame.type === 'manifestRequest') {
        publishManifest(clientId)
        return
      }
      if (frame.type === 'heartbeatAck') return
      // /sys/* も /oscdesk/* も UI からは送らせない(内部予約アドレス。/sys/* の
      // ブリッジ自身の送信は sendMessage を通るため、ここでだけ広く弾く)
      if (frame.type === 'oscBatch') {
        const internalAddress = frame.messages.find(message => isInternalAddress(message.address))?.address
        if (internalAddress !== undefined) {
          rejectBatch(clientId, `internal-address: ${internalAddress}`)
          return
        }
        if (deps.sendBundleFn === undefined) {
          rejectBatch(clientId, 'transport-unavailable')
          return
        }

        const messages = frame.messages.map(message => ({
          address: message.address,
          args: toOscArgs(message.args),
        }))
        const result = deps.sendBundleFn(deps.config.unity.host, deps.config.unity.sendPort, messages)
        if (!result.ok) {
          rejectBatch(clientId, result.reason === 'too-large'
            ? `too-large: ${String(result.bytes)} bytes (limit ${String(result.limitBytes)})`
            : 'transport-unavailable')
          return
        }
        recordDesired(messages)
        for (const message of messages) {
          diagnostics?.recordOutgoing?.(message.address, message.args, deps.config.unity.host, deps.config.unity.sendPort)
        }
        return
      }
      if (frame.type !== 'osc') return
      if (isInternalAddress(frame.address)) {
        if (!warnedInternalAddresses.has(frame.address)) {
          warnedInternalAddresses.add(frame.address)
          logWarn('(WARN, BRIDGE)', `Blocked UI frame to internal address "${frame.address}".`)
        }
        return
      }
      const args = toOscArgs(frame.args)
      sendMessage(deps.config.unity.host, deps.config.unity.sendPort, frame.address, ...args)
      recordDesired([{ address: frame.address, args }])
    },
    onUiConnected(clientId) {
      deps.publish(buildHelloFrame(clientId), clientId)
      publishLink(clientId, true)
      publishManifest(clientId)
    },
    onUiDisconnected(_clientId) {},
    linkSnapshot,
    helloFrame: buildHelloFrame,
    setDefinition(definition) {
      const reset = desired.setDefinition(definition)
      hasDefinition = definition !== null
      warnedEchoMismatch.clear()
      lastOperatedAt.clear()
      publishDesiredFull()
      // 引き継がれた値は Unity にも入っているはずなので、値が決まり直したものだけ送る
      // (レイアウトだけの保存で、Unity 側の手動変更まで巻き戻さないため)
      if (hasDefinition && isUnityReachable()) resendDesired('definition adopted', new Set(reset))
    },
    publishDesired: publishDesiredFull,
  }

  function buildHelloFrame(clientId: ClientId): DownstreamFrame {
      return {
        v: 1, type: 'hello', clientId, protocolVersion: 1,
        server: { name: deps.config.server?.name ?? 'oscdesk-bridge', version: deps.config.server?.version ?? '0.1.0' },
        unity: { host: deps.config.unity.host, sendPort: deps.config.unity.sendPort },
        bridge: {
          oscListenPort: deps.config.bridge.oscListenPort,
          wsPort: deps.config.bridge.wsPort,
        },
        expectedProjectId: deps.config.expectedProjectId ?? null,
        heartbeat: { intervalMs: 15_000, timeoutMs: 30_000 },
        pingIntervalMs: PING_INTERVAL_MS,
        debug: deps.config.debug,
      }
  }
}

function toWireArgs(args: readonly OscArg[]) {
  return args.map((arg) => arg.type === 'b'
    ? { type: 'b' as const, value: Buffer.from(arg.value).toString('base64') }
    : arg)
}

function toOscArgs(args: readonly { type?: 'i' | 'f' | 's' | 'b'; value?: unknown }[]): OscArg[] {
  return args.map((arg) => {
    if (arg.type === 'i' || arg.type === 'f') return { type: arg.type, value: Number(arg.value) } as OscArg
    if (arg.type === 's') return { type: 's', value: String(arg.value) }
    return { type: 'b', value: Buffer.from(String(arg.value ?? ''), 'base64') }
  })
}

function isBridgeInternalAddress(address: string): boolean {
  return isOscdeskAddress(address)
}
