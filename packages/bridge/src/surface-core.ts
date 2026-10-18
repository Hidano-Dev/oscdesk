import {
  isInternalAddress,
  isOscdeskAddress,
  OSCDESK,
  OSCDESK_DIAG,
  SYS,
  type DownstreamFrame,
  type LinkUnityStatus,
  type LinkTargetStatus,
  type OscArg,
  resolveUnityTargets,
  type SurfaceDefinition,
  type SurfaceRecord,
  type BridgeConfig as RuntimeBridgeConfig,
  type UpstreamFrame,
} from '@oscdesk/shared'

import { createDesiredValues, type DesiredValue, type PersistedDesired } from './desired-values'
import { PingMonitor } from './ping-monitor'
import { OscUiRouter } from './osc-ui-router'
import { createRuntimeOptions } from './runtime-options'
import type { SentEvent } from './sent-log'

const PING_INTERVAL_MS = 2_000
// UI が最後に操作してからこの間は、遅れて届く旧いエコーを食い違いとして警告しない(ドラッグ中の誤警告を避ける)
const ECHO_SETTLE_MS = 1_000

interface UnityRuntimeTarget {
  readonly name: string
  readonly host: string
  readonly sendPort: number
  readonly primary: boolean
  readonly monitor: PingMonitor
  readonly addresses: ReadonlySet<string>
  hasBeenReachable: boolean
}

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
  /** 副系の宛先名ごとの、名前解決済み数値アドレス。 */
  secondaryAddresses?: Readonly<Record<string, readonly string[]>>
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
  /** Unity へ実際に送ったものの記録先(送信ログ、D-067)。ping は渡さない。 */
  onSent?: (event: SentEvent) => void
  /** 保持値の保存先(D-058)。省くと保存も復元もしない。 */
  desiredValuesStore?: {
    load(name: string): PersistedDesired | null
    save(name: string, values: PersistedDesired): void
  }
}

interface DiagnosticsHooks {
  recordIncoming?: (address: string, args: readonly OscArg[], host: string, port: number) => void
  recordOutgoing?: (address: string, args: readonly OscArg[], host: string, port: number) => void
  onPingCycle?: (event: { previousLost: boolean }) => void
  onPongAccepted?: () => void
  snapshot?: () => unknown
  dispose: () => void
}

export interface SurfaceCore {
  start(): void
  stop(): void
  handleOscIn(message: InboundOscMessage): void
  handleUiFrame(frame: UpstreamFrame, clientId: ClientId): void
  onUiConnected(clientId: ClientId): void
  onUiDisconnected(clientId: ClientId): void
  linkSnapshot(): { unity: LinkUnityStatus; targets: LinkTargetStatus[] }
  helloFrame(clientId: ClientId): DownstreamFrame
  /**
   * 定義の採用を保持値へ反映し、全 UI へ配って(Unity 到達可能なら)再送する。null は採用解除。
   * name は保管名で、保持値の保存と(保持値を持っていない最初の採用での)復元に使う(D-058)。
   */
  setDefinition(definition: SurfaceDefinition | null, name?: string): void
  /** 保持値の全量を指定の UI へ送る(定義が無ければ何もしない)。 */
  publishDesired(clientId: ClientId): void
  /** Unity の一覧(D-053)の全量を指定の UI へ送る(定義が無ければ何もしない)。 */
  publishRuntimeOptions(clientId: ClientId): void
  /**
   * OSC パッドの押下(D-080)を全宛先へ 1 メッセージで送る。保持値(D-045)は更新せず、再送もしない。
   * 予約アドレスと一覧のアドレス(D-055)は送らずに理由を返す。
   */
  firePad(address: string, args: readonly OscArg[]): { ok: true } | { ok: false; reason: string }
}

export function createSurfaceCore(deps: SurfaceCoreDeps): SurfaceCore {
  const now = deps.now ?? Date.now
  const setIntervalFn = deps.setIntervalFn ?? setInterval
  const clearIntervalFn = deps.clearIntervalFn ?? clearInterval
  const logInfo = deps.logInfo ?? console.info
  const logWarn = deps.logWarn ?? console.warn
  const logError = deps.logError ?? console.error
  const targets: UnityRuntimeTarget[] = resolveUnityTargets(deps.config.unity).map(target => ({
    ...target,
    monitor: new PingMonitor(),
    addresses: new Set([
      target.host,
      ...(target.primary ? deps.unityAddresses : deps.secondaryAddresses?.[target.name]) ?? [],
    ]),
    hasBeenReachable: false,
  }))
  const primary = targets[0]!
  const monitor = primary.monitor
  let pingSeq = 1
  const uiRouter = deps.config.oscUi.enabled
    ? new OscUiRouter({
        unity: { host: deps.config.unity.host, port: deps.config.unity.sendPort },
        unityAddresses: deps.unityAddresses,
        config: deps.config.oscUi,
      })
    : null
  const desired = createDesiredValues()
  const runtimeOptions = createRuntimeOptions(targets.map(target => target.name))
  let timer: TimerHandle | null = null
  let stopped = false
  let hasDefinition = false
  let activeName: string | undefined
  // 採用中の定義のレコード(行の追加・削除のフレームを id で引くため。D-075)
  let definedRecords: readonly SurfaceRecord[] = []
  let lastLinkPublishedAt = -Infinity
  const warnedInternalAddresses = new Set<string>()
  const warnedNonUnitySources = new Set<string>()
  const warnedEchoMismatch = new Set<string>()
  const warnedRuntimeOptions = new Set<string>()
  const warnRuntimeOptionsOnce = (key: string, message: string) => {
    if (warnedRuntimeOptions.has(key)) return
    warnedRuntimeOptions.add(key)
    logWarn('(WARN, BRIDGE)', message)
  }
  const isUnityHost = (host: string) => targets.some(target => target.addresses.has(host))
  // 同じホストに複数の宛先がある構成(同一 PC の検証等)では、送信元ポートが宛先の
  // sendPort と一致するものを優先し、決まらなければ主系とみなす
  const sourceTarget = (from: { host: string; port: number }): UnityRuntimeTarget | null => {
    const candidates = targets.filter(target => target.addresses.has(from.host))
    if (candidates.length === 0) return null
    return candidates.find(target => target.sendPort === from.port)
      ?? candidates.find(target => target.primary)
      ?? candidates[0]!
  }
  let diagnostics: DiagnosticsHooks | null = null

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

  const desiredFrame = (full: boolean, values = desired.snapshot()): DownstreamFrame => ({
    v: 1, type: 'desired', full,
    values: values.map(value => ({ address: value.address, args: toWireArgs(value.args) })),
  })

  const publishDesiredFull = (target?: ClientId) => {
    if (!hasDefinition) return
    deps.publish(desiredFrame(true), target)
  }

  // 保持値を Unity へ送り直す(D-045)。state のみが対象で、trigger は保持していないため再送されない。
  // Unity の再起動は pong の喪失→回復で検知する。ping の間隔より速い再起動は検知できないが、
  // 起動識別子(bootId)での検知はマニフェストごと廃止した(D-051)。UI の「再送」操作で補える。
  // 宛先を絞ると、その台だけが他の台に追いつける(D-046)。
  // レコードはキーごとに 1 エントリなので、行ごとに 1 メッセージになる(D-062)
  const resendDesired = (reason: string, only?: ReadonlySet<string>, to: readonly UnityRuntimeTarget[] = targets) => {
    // UI で管理するキーの一覧(D-075)は行の並びと削除を Unity に伝える値なので、行より先に毎回送り直す
    sendUiKeyLists('resend', to)
    const values = desired.snapshot().filter(value => only === undefined || only.has(desired.entryId(value.address, value.args)))
    if (values.length === 0) return
    for (const target of to) {
      logInfo('(INFO, BRIDGE)', `Resending ${String(values.length)} desired value(s) to Unity "${target.name}" (${reason}).`)
      for (const value of values) sendLogged('resend', [target], value.address, ...value.args)
    }
  }
  // 一覧は全量を配る。同じ一覧の繰り返しは receive が unchanged を返すので、呼び出し側で配り直さない
  const publishRuntimeOptions = (target?: ClientId) => {
    if (hasDefinition) deps.publish(runtimeOptions.frame(), target)
  }

  // 一覧の要求(optionsFrom.request)は引数なしで送る。応答は定義が宣言した一覧のアドレスへ届く(D-053)
  const requestRuntimeOptions = (reason: string, addresses: readonly string[], to: readonly UnityRuntimeTarget[]) => {
    if (addresses.length === 0) return
    for (const target of to) {
      logInfo('(INFO, BRIDGE)', `Requesting ${String(addresses.length)} option list(s) from Unity "${target.name}" (${reason}).`)
      for (const address of addresses) sendLogged('request', [target], address)
    }
  }

  // Unity へ送り、送信ログ(D-067)へ 1 件として残す。宛先をまとめて 1 件にするのは、全台へ同じものを
  // 送る通常の操作で、ログが宛先の数だけ膨らまないようにするため
  const sendLogged = (origin: SentEvent['origin'], to: readonly UnityRuntimeTarget[], address: string, ...args: OscArg[]) => {
    for (const target of to) sendMessage(target.host, target.sendPort, address, ...args)
    if (to.length > 0) deps.onSent?.({ origin, targets: to.map(target => target.name), messages: [{ address, args }] })
  }

  const sendToAllTargets = (origin: SentEvent['origin'], address: string, ...args: OscArg[]) => {
    sendLogged(origin, targets, address, ...args)
  }

  // UI で管理するキーの一覧(D-075)を、keysFrom.address へ s の並びで送る(Unity はこれで行の順と削除を知る)
  const sendUiKeyLists = (origin: SentEvent['origin'], to: readonly UnityRuntimeTarget[], only?: string) => {
    for (const list of runtimeOptions.uiKeyLists()) {
      if (only !== undefined && list.address !== only) continue
      sendLogged(origin, to, list.address, ...list.keys.map((key): OscArg => ({ type: 's', value: key })))
    }
  }

  // 保存は間引きを store 側に任せ、ここでは変わるたびに全量を渡すだけにする(D-058)
  const persistDesired = () => {
    if (activeName === undefined) return
    const keyLists = runtimeOptions.uiKeyLists()
    deps.desiredValuesStore?.save(activeName, keyLists.length === 0 ? desired.persistable() : { ...desired.persistable(), keyLists })
  }

  const rejectRecordKey = (clientId: ClientId, detail: string) => {
    deps.publish({ v: 1, type: 'notice', level: 'error', code: 'record-key-rejected', detail }, clientId)
  }

  /**
   * 通常の画面からの行の追加(D-075)。UI で管理するキーなら一覧の末尾に足して Unity へ送り直し、
   * どちらの出どころでも、同じキーの集合を共有する state レコードに default の行を作って送る
   */
  const addRecordKey = (recordId: string, key: string, clientId: ClientId) => {
    const record = definedRecords.find(candidate => candidate.id === recordId)
    if (record === undefined) return rejectRecordKey(clientId, `unknown-record: ${recordId}`)
    if (key === '') return rejectRecordKey(clientId, 'empty-key')
    const keysAddress = record.keysFrom.address
    if (record.keysFrom.source === 'ui') {
      const result = runtimeOptions.addUiKey(keysAddress, key)
      if (result !== 'added') return rejectRecordKey(clientId, `${result === 'full' ? 'full' : 'exists'}: ${key}`)
      sendUiKeyLists('ui', targets, keysAddress)
      publishRuntimeOptions()
    }
    const lists = definedRecords
      .filter(candidate => candidate.keysFrom.address === keysAddress)
      .map(candidate => ({ record: candidate.id, keys: [key] }))
    const created = desired.addKeys(lists)
    if (created.length === 0 && record.keysFrom.source !== 'ui') return rejectRecordKey(clientId, `exists: ${key}`)
    addRecordRows(created)
    persistDesired()
  }

  /** 通常の画面からの行の削除(D-075)。同じキーの集合を共有する全レコードから行を消し、全量を配り直す */
  const removeRecordKey = (recordId: string, key: string, clientId: ClientId) => {
    const record = definedRecords.find(candidate => candidate.id === recordId)
    if (record === undefined) return rejectRecordKey(clientId, `unknown-record: ${recordId}`)
    const keysAddress = record.keysFrom.address
    const listed = record.keysFrom.source === 'ui' && runtimeOptions.removeUiKey(keysAddress, key)
    const removed = desired.removeKey(keysAddress, key)
    if (!listed && !removed) return rejectRecordKey(clientId, `not-found: ${key}`)
    if (listed) {
      sendUiKeyLists('ui', targets, keysAddress)
      publishRuntimeOptions()
    }
    logInfo('(INFO, BRIDGE)', `Removed record row "${key}" (${keysAddress}).`)
    // Unity の一覧にまだあるキーは行が残るので、default で作り直して Unity にも送る(値が「既定値に戻る」)
    const recreated = desired.addKeys(runtimeOptions.recordKeys())
    for (const target of targets.filter(isTargetReachable)) {
      for (const value of recreated) sendLogged('row', [target], value.address, ...value.args)
    }
    // desired の差分は値の追加・更新しか表せないので、消した行は全量で配って UI に落とさせる
    publishDesiredFull()
    persistDesired()
  }

  // UI で管理するキーの一覧に無いキーの行は持たない(古い画面からの書き込みや、一覧の無い保存から戻った行)
  const retainUiRows = () => {
    for (const list of runtimeOptions.uiKeyLists()) desired.retainKeys(list.address, list.keys)
  }

  // 操作の時刻と食い違いの警告はエントリ単位(レコードは行ごと)。アドレス単位だと別の行のエコーが警告を解除してしまう
  const lastOperatedAt = new Map<string, number>()
  // UI で管理するキー(D-075)の一覧に無いキーの行か。別の画面で消した行へ、古い画面から書き込んだときに起きる
  const isUnlistedUiRow = (address: string, args: readonly OscArg[]) => {
    const record = definedRecords.find(candidate => candidate.address === address && candidate.keysFrom.source === 'ui')
    const head = args[0]
    if (record === undefined || head?.type !== 's') return false
    const list = runtimeOptions.uiKeyLists().find(candidate => candidate.address === record.keysFrom.address)
    return !(list?.keys.includes(head.value) ?? false)
  }

  const recordDesired = (messages: readonly { address: string; args: readonly OscArg[] }[]) => {
    const changed = messages.filter(message =>
      !isUnlistedUiRow(message.address, message.args) && desired.record(message.address, message.args))
    for (const message of changed) lastOperatedAt.set(desired.entryId(message.address, message.args), now())
    if (changed.length > 0) {
      deps.publish(desiredFrame(false, changed))
      persistDesired()
    }
  }

  const isTargetReachable = (target: UnityRuntimeTarget) => {
    const status = target.monitor.snapshot()
    return status.lastPongSeq !== null && status.consecutiveLosses === 0
  }

  // キーの一覧に新しいキーが現れたら、default で行を作って到達可能な台へ送り、差分を配る(D-062)。
  // 未到達の台には初回到達・回復の再送で届く
  const addRecordRows = (created: DesiredValue[]) => {
    if (created.length === 0) return
    for (const target of targets.filter(isTargetReachable)) {
      logInfo('(INFO, BRIDGE)', `Sending ${String(created.length)} new record row(s) to Unity "${target.name}".`)
      for (const value of created) sendLogged('row', [target], value.address, ...value.args)
    }
    deps.publish(desiredFrame(false, created))
    persistDesired()
  }

  const tick = () => {
    if (stopped) return
    for (const target of targets) {
      const before = target.monitor.snapshot().consecutiveLosses
      // seq は全宛先で一意にする。pong は seq しか持たないため、同じホストの宛先でも出所を特定できる
      const seq = target.monitor.nextPing(now(), pingSeq++)
      const lost = target.monitor.snapshot().consecutiveLosses > before
      if (target.primary) diagnostics?.onPingCycle?.({ previousLost: lost })
      sendMessage(target.host, target.sendPort, SYS.PING, { type: 'i', value: seq })
    }
    publishLink()
  }

  const linkSnapshot = () => ({
    unity: unityStatus(),
    targets: targets.map(target => ({ name: target.name, primary: target.primary, ...statusOf(target) })),
  })

  function unityStatus(): LinkUnityStatus {
    return statusOf(primary)
  }

  function statusOf(target: UnityRuntimeTarget): LinkUnityStatus {
    const status = target.monitor.snapshot()
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
      stopped = false
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
      diagnostics = null
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
      // Unity の制御応答(pong)は設定された Unity ホスト以外から受理しない。
      // 検証しないと、LAN 内の任意のピアが偽 pong で到達性表示を偽装できる
      if (message.address === SYS.PONG && !isUnityHost(message.from.host)) {
        if (!warnedNonUnitySources.has(message.from.host)) {
          warnedNonUnitySources.add(message.from.host)
          logWarn('(WARN, BRIDGE)', `Ignored ${message.address} from non-Unity source ${message.from.host}:${String(message.from.port)}.`)
        }
        return
      }
      if (message.address === SYS.PONG) {
        const arg = message.args[0]
        // seq が一致しても、その宛先のホストから届いたものだけを受理する(別の台の pong で到達性を偽らないため)
        const answered = arg?.type === 'i'
          ? targets.find(target => target.monitor.pendingSeq() === arg.value && target.addresses.has(message.from.host))
          : undefined
        if (arg?.type === 'i' && Number.isInteger(arg.value) && answered !== undefined) {
          const result = answered.monitor.onPong(arg.value, now())
          if (result.accepted && (!answered.hasBeenReachable || result.recoveredFromLoss)) {
            const reason = answered.hasBeenReachable ? 'Unity recovered' : 'Unity first reachable'
            resendDesired(reason, undefined, [answered])
            requestRuntimeOptions(reason, runtimeOptions.requestAddresses(), [answered])
          }
          if (result.accepted) answered.hasBeenReachable = true
          if (result.accepted) publishLink()
          if (result.accepted && answered.primary) diagnostics?.onPongAccepted?.()
        }
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
      if (message.address === OSCDESK.STATUS_REQUEST) {
        deps.sendFn(message.from.host, message.from.port, OSCDESK.STATUS, {
          type: 's', value: JSON.stringify(linkSnapshot()),
        })
        return
      }
      if (isInternalAddress(message.address)) return
      const source = sourceTarget(message.from)
      // Unity の一覧(D-053)は副系からも受けるので、副系のエコーを捨てる処理より前で受け止める。
      // osc フレームとしては流さない(一覧のフレームと二重になるため)。Unity 以外の送信元は受けない
      if (runtimeOptions.isListAddress(message.address)) {
        if (source === null) {
          warnRuntimeOptionsOnce(`source:${message.from.host}:${message.address}`, `Ignored option list "${message.address}" from non-Unity source ${message.from.host}:${String(message.from.port)}.`)
          return
        }
        const result = runtimeOptions.receive(source.name, message.address, message.args)
        if (result === 'invalid') {
          warnRuntimeOptionsOnce(`args:${source.name}:${message.address}`, `Ignored option list "${message.address}" from Unity "${source.name}": every argument must be a string.`)
        } else if (result === 'changed') {
          publishRuntimeOptions()
          addRecordRows(desired.addKeys(runtimeOptions.recordKeys()))
        }
        return
      }
      // Unity からの要求のエコーは「届いた」以上の意味を持たないので、UI へも OSC ネイティブ UI へも流さない
      // (OSC ネイティブ UI の端末が要求を送るのは中継の対象なので、出所を Unity に限る)
      if (source !== null && runtimeOptions.isRequestAddress(message.address)) return
      // 副系のエコーは UI へ配らず(表示は主系だけ。D-046)、保持値との食い違いだけを警告する。
      // 中継判定より前に処理しないと、ルーターが副系を UI ピアとみなして Unity へ送り返してしまう
      const entryId = desired.entryId(message.address, message.args)
      if (source !== null && !source.primary) {
        const key = `${source.name}:${entryId}`
        const secondarySettling = now() - (lastOperatedAt.get(entryId) ?? -Infinity) < ECHO_SETTLE_MS
        if (secondarySettling) {
          // 操作直後の遅れた旧いエコーは主系と同じく食い違いとして扱わない
        } else if (desired.differsFromEcho(message.address, message.args)) {
          if (!warnedEchoMismatch.has(key)) {
            warnedEchoMismatch.add(key)
            logWarn('(WARN, BRIDGE)', `Unity "${source.name}" echo differs from desired value for "${describeEntry(message.address, message.args, entryId)}".`)
          }
        } else {
          warnedEchoMismatch.delete(key)
        }
        return
      }
      // OSC ネイティブ UI の中継(D-7)は WebSocket UI への配信と併存する。
      // 中継の可否で publish を止めないこと(止めると WebSocket UI から外部 OSC が見えなくなる)。
      if (uiRouter !== null) {
        const decision = uiRouter.route(message.from, now())
        if (decision.kind === 'to-unity') {
          sendToAllTargets('relay', message.address, ...message.args)
          // OSC ネイティブ UI の操作も保持値に入れる(入れないと Unity 再起動の再送で巻き戻る)
          recordDesired([{ address: message.address, args: message.args }])
        } else if (decision.kind === 'to-ui') {
          for (const target of decision.targets) {
            deps.sendFn(target.host, target.port, message.address, ...message.args)
          }
        }
      }
      // 保持値と食い違うエコーは書き換えず警告だけ残す(D-045)。同じアドレスの警告は一致に戻るまで 1 回。
      const settling = now() - (lastOperatedAt.get(entryId) ?? -Infinity) < ECHO_SETTLE_MS
      if (isUnityHost(message.from.host) && !settling && desired.differsFromEcho(message.address, message.args)) {
        if (!warnedEchoMismatch.has(entryId)) {
          warnedEchoMismatch.add(entryId)
          logWarn('(WARN, BRIDGE)', `Unity echo differs from desired value for "${describeEntry(message.address, message.args, entryId)}".`)
        }
      } else {
        warnedEchoMismatch.delete(entryId)
      }
      deps.publish({ v: 1, type: 'osc', address: message.address, args: toWireArgs(message.args), from: message.from })
    },
    handleUiFrame(frame, clientId) {
      if (frame.type === 'heartbeatAck') return
      if (frame.type === 'runtimeOptionsRefresh') {
        // 到達不能の台にも送る(UDP なので害はなく、戻った台は回復時の要求でも追いつく)
        requestRuntimeOptions('requested by UI', runtimeOptions.requestAddresses(), targets)
        return
      }
      if (frame.type === 'recordKeyAdd') {
        addRecordKey(frame.record, frame.key, clientId)
        return
      }
      if (frame.type === 'recordKeyRemove') {
        removeRecordKey(frame.record, frame.key, clientId)
        return
      }
      if (frame.type === 'resend') {
        const only = frame.target === undefined ? targets : targets.filter(target => target.name === frame.target)
        if (only.length === 0) {
          deps.publish({ v: 1, type: 'notice', level: 'error', code: 'resend-rejected', detail: `unknown-target: ${String(frame.target)}` }, clientId)
          return
        }
        resendDesired('requested by UI', undefined, only)
        return
      }
      // /sys/* も /oscdesk/* も UI からは送らせない(内部予約アドレス。/sys/* の
      // ブリッジ自身の送信は sendMessage を通るため、ここでだけ広く弾く)
      if (frame.type === 'oscBatch') {
        const internalAddress = frame.messages.find(message => isInternalAddress(message.address))?.address
        if (internalAddress !== undefined) {
          rejectBatch(clientId, `internal-address: ${internalAddress}`)
          return
        }
        const listAddress = frame.messages.find(message => runtimeOptions.isListAddress(message.address))?.address
        if (listAddress !== undefined) {
          rejectBatch(clientId, `option-list-address: ${listAddress}`)
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
        const result = deps.sendBundleFn(primary.host, primary.sendPort, messages)
        const delivered = [primary.name]
        if (result.ok) {
          for (const target of targets.slice(1)) {
            const secondaryResult = deps.sendBundleFn(target.host, target.sendPort, messages)
            if (!secondaryResult.ok) logWarn('(WARN, BRIDGE)', `Batch to Unity "${target.name}" failed: ${secondaryResult.reason}.`)
            else delivered.push(target.name)
          }
        }
        if (!result.ok) {
          rejectBatch(clientId, result.reason === 'too-large'
            ? `too-large: ${String(result.bytes)} bytes (limit ${String(result.limitBytes)})`
            : 'transport-unavailable')
          return
        }
        deps.onSent?.({ origin: 'action', targets: delivered, messages, batch: true })
        recordDesired(messages)
        for (const message of messages) {
          for (const target of targets) diagnostics?.recordOutgoing?.(message.address, message.args, target.host, target.sendPort)
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
      // 一覧のアドレスは Unity → OscDesk の向きだけ。UI から送るとそのエコーが全台の一覧を上書きする(D-055)
      if (runtimeOptions.isListAddress(frame.address)) {
        warnRuntimeOptionsOnce(`ui:${frame.address}`, `Blocked UI frame to option list address "${frame.address}".`)
        return
      }
      const args = toOscArgs(frame.args)
      sendToAllTargets('ui', frame.address, ...args)
      recordDesired([{ address: frame.address, args }])
    },
    onUiConnected(clientId) {
      deps.publish(buildHelloFrame(clientId), clientId)
      publishLink(clientId, true)
    },
    onUiDisconnected(_clientId) {},
    linkSnapshot,
    helloFrame: buildHelloFrame,
    setDefinition(definition, name) {
      const holdsValues = hasDefinition
      const reset = desired.setDefinition(definition)
      // 保持値を持っていない採用(ブリッジ起動後の最初の採用)に限り、保存しておいた値を戻す(D-058)。
      // 稼働中の再採用・切り替えは従来どおりメモリ上の値を引き継ぐ(Unity に入っているのはそちらのため)。
      // 戻した値も reset に残るので、到達済みの台があれば採用時の再送で送られる
      const resend = new Set(reset)
      let savedKeyLists: PersistedDesired['keyLists']
      if (definition !== null && name !== undefined && !holdsValues) {
        const saved = deps.desiredValuesStore?.load(name)
        if (saved != null) {
          savedKeyLists = saved.keyLists
          // レコードの行は採用の時点では無い(reset に入らない)ので、戻した行も採用時の再送に加える
          const restored = desired.restore(saved)
          for (const id of restored) resend.add(id)
          const total = saved.values.length + saved.records.length
          logInfo('(INFO, BRIDGE)', `Restored ${String(restored.length)} of ${String(total)} saved desired value(s) for surface "${name}".`)
        }
      }
      activeName = definition === null ? undefined : name
      definedRecords = definition?.records ?? []
      const newRequests = runtimeOptions.setDefinition(definition)
      // UI で管理するキーの一覧(D-075)は一覧の登録(setDefinition)の後でしか戻せない。戻したら一覧に無い行を落とす
      if (savedKeyLists !== undefined) runtimeOptions.restoreUiKeys(savedKeyLists)
      retainUiRows()
      // 引き継いだ一覧に、新しく採用したレコードの行がまだ無いキーがあれば作る(復元した行が先に勝つ)
      const created = desired.addKeys(runtimeOptions.recordKeys())
      for (const value of created) resend.add(desired.entryId(value.address, value.args))
      persistDesired()
      hasDefinition = definition !== null
      warnedEchoMismatch.clear()
      warnedRuntimeOptions.clear()
      lastOperatedAt.clear()
      publishDesiredFull()
      // 一覧が変わらなくても surface・desired と同じく毎回配る(UI が定義と一緒に選択肢を揃え直せるように)
      publishRuntimeOptions()
      // 引き継がれた値は Unity にも入っているはずなので、値が決まり直したものだけ送る
      // (レイアウトだけの保存で、Unity 側の手動変更まで巻き戻さないため)
      if (hasDefinition) {
        const reachable = targets.filter(isTargetReachable)
        resendDesired('definition adopted', resend, reachable)
        requestRuntimeOptions('definition adopted', newRequests, reachable)
      }
    },
    publishDesired: publishDesiredFull,
    publishRuntimeOptions: clientId => publishRuntimeOptions(clientId),
    firePad(address, args) {
      // パッドの保存時にも検証しているが、送る直前にも弾く(手で書き換えたファイルを読み込んだ場合の保険)
      if (isInternalAddress(address)) return { ok: false, reason: `internal-address: ${address}` }
      // 一覧のアドレスへ送ると、そのエコーが全台の一覧を上書きする(D-055。上り osc と同じ扱い)
      if (runtimeOptions.isListAddress(address)) return { ok: false, reason: `option-list-address: ${address}` }
      // 保持値は書き換えない(recordDesired を通さない)。パッドはきっかけを撃つ場所で、狙いの値はサーフェス定義が持つ
      sendToAllTargets('pad', address, ...args)
      return { ok: true }
    },
  }

  function buildHelloFrame(clientId: ClientId): DownstreamFrame {
      return {
        v: 1, type: 'hello', clientId, protocolVersion: 1,
        server: { name: deps.config.server?.name ?? 'oscdesk-bridge', version: deps.config.server?.version ?? '0.1.0' },
        unity: { host: primary.host, sendPort: primary.sendPort },
        targets: targets.map(target => ({ name: target.name, host: target.host, sendPort: target.sendPort, primary: target.primary })),
        bridge: {
          oscListenPort: deps.config.bridge.oscListenPort,
          wsPort: deps.config.bridge.wsPort,
        },
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

// ログではレコードの行をキーつきで示す(どの行が食い違ったか分かるように)
function describeEntry(address: string, args: readonly OscArg[], entryId: string): string {
  const head = args[0]
  return entryId !== address && head?.type === 's' ? `${address}" key "${head.value}` : address
}

function isBridgeInternalAddress(address: string): boolean {
  return isOscdeskAddress(address)
}
