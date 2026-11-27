import {
  buildPalette,
  OSCQUERY,
  OscQueryHostInfoSchema,
  parseOscQueryNamespace,
  supportsPathEvents,
  type DownstreamFrame,
  type OscQueryHostInfo,
  type OscQueryTargetView,
  type PaletteItem,
  type PaletteUnsupported,
  type UpstreamFrame,
} from '@oscdesk/shared'

import type { ClientId } from './surface-core'

// OSCQuery のターゲット(D-164・D-168)。mDNS で見つけたか設定で直接指定したターゲットの HOST_INFO と名前空間を読み、
// 部品の候補(パレット)を作って SPA へ配る。名前空間は保管しない(読み直せばよく、古い木で画面を作らないため)。
// HTTP・WebSocket・mDNS は引数のポートを通してだけ触る(実装は adapters/oscquery-http・oscquery-ws・mdns-discovery)

// ---- ポート(D-134) ----

/** HTTP の取得の結果。unsupported は 204 か 400(未対応の属性への応答が実装で割れているので両方を同じに扱う。HID-484 §6.1) */
export type OscQueryFetchResult = { kind: 'json'; value: unknown } | { kind: 'unsupported'; status: number }

export interface OscQueryWatch {
  close(): void
}

export interface OscQueryClient {
  /**
   * `http://host:port/` を取る。query が 'HOST_INFO' なら `/?HOST_INFO`。時間・大きさの上限を超えたら・200/204/400 以外は
   * 理由付きの Error で失敗する。signal で中断する
   */
  read(host: string, port: number, query: 'HOST_INFO' | null, signal: AbortSignal): Promise<OscQueryFetchResult>
  /** WebSocket で PATH_* を受ける(LISTEN は送らない)。onPathEvent は PATH_* を受けるたび、onClose は切れたとき 1 回だけ */
  watch(host: string, port: number, handlers: { onPathEvent: (command: string) => void; onClose: (reason: string) => void }): OscQueryWatch
}

export interface DiscoveredService {
  /** mDNS のサービスのインスタンス名(同じ PC の複数のターゲットはこれで区別する。HID-484 §6.8) */
  instance: string
  host: string
  port: number
}

/** 送り先の候補として宛先タブへ渡すもの(D-168)。oscPort が分かっているターゲットだけ */
export interface OscQueryDestination {
  host: string
  oscPort: number
  name: string | null
}

type LogFn = (message?: unknown, ...optionalParams: unknown[]) => void
type TimerHandle = ReturnType<typeof setTimeout> | number

export type MdnsState = 'off' | 'running' | 'failed'

export interface OscQueryTargets {
  start(): void
  /** mDNS で見つけた・告知を受けた(既知なら HOST_INFO を取り直す。起動に早く気づくきっかけ。D-164) */
  serviceFound(service: DiscoveredService): void
  /** mDNS の削除の告知・期限切れ */
  serviceLost(instance: string): void
  /** osc.queryRefresh なら処理して true */
  handleUiFrame(frame: UpstreamFrame, clientId: ClientId): boolean
  publish(clientId?: ClientId): void
  destinations(): readonly OscQueryDestination[]
  close(): void
}

interface TargetState {
  id: string
  source: 'mdns' | 'config'
  host: string
  httpPort: number
  name: string | null
  oscPort: number | null
  bootId: string | null
  status: 'loading' | 'ready' | 'error'
  error: string | null
  fetchedAt: number | null
  palette: PaletteItem[]
  unsupported: PaletteUnsupported[]
  dropped: number
  watch: OscQueryWatch | null
  pathEvents: boolean
  abort: AbortController | null
  // 読み込みの世代。読んでいる間に読み直し・削除が来たら、古い読み込みの結果を捨てる
  generation: number
  refreshTimer: TimerHandle | null
  retryTimer: TimerHandle | null
  retryMs: number
}

export function createOscQueryTargets(deps: {
  configTargets: readonly { host: string; port: number }[]
  client: OscQueryClient
  /** mDNS で見つけたホストを読んでよいか(この PC のネットワークの中か、この PC 自身)。設定で指定したターゲットには当てない */
  isAllowedHost: (host: string) => boolean
  mdnsState: () => MdnsState
  /** mDNS の問い合わせを出し直す(osc.queryRefresh)。mDNS が無効なら省く */
  requery?: () => void
  publish: (frame: DownstreamFrame, clientId?: ClientId) => void
  /** 送り先の候補(destinations())が変わったとき */
  onDestinationsChanged?: () => void
  fetchTimeoutMs: number
  refreshDebounceMs: number
  /** 読めなかったターゲット・切れた WebSocket を読み直すまでの最初の間隔(倍々に延ばし、MAX_RETRY_MS で止める) */
  retryMs?: number
  now?: () => number
  setTimeoutFn?: (cb: () => void, ms: number) => TimerHandle
  clearTimeoutFn?: (handle: TimerHandle) => void
  logInfo?: LogFn
  logWarn?: LogFn
}): OscQueryTargets {
  const now = deps.now ?? Date.now
  const setTimeoutFn = deps.setTimeoutFn ?? setTimeout
  const clearTimeoutFn = deps.clearTimeoutFn ?? clearTimeout
  const logInfo = deps.logInfo ?? console.info
  const logWarn = deps.logWarn ?? console.warn
  const baseRetryMs = deps.retryMs ?? 5_000
  const targets = new Map<string, TargetState>()
  let closed = false
  let lastDestinationsKey = ''
  // 同時に読む名前空間の数の上限(全体)。LAN の 1 台が 64 個のインスタンスを告知して、それぞれ上限いっぱいの応答を返すと、
  // 一度に読めば 64 × 8 MiB を抱えてブリッジのメモリを使い切る。待つ読み込みは列に並べ、順番が来てから時間を計り始める
  let running = 0
  const waiting: (() => void)[] = []
  const acquireSlot = (): Promise<void> => {
    if (running < MAX_CONCURRENT_LOADS) {
      running += 1
      return Promise.resolve()
    }
    return new Promise(resolve => waiting.push(() => {
      running += 1
      resolve()
    }))
  }
  const releaseSlot = () => {
    running -= 1
    waiting.shift()?.()
  }

  const destinations = (): OscQueryDestination[] => [...targets.values()]
    .flatMap(target => target.oscPort === null ? [] : [{ host: target.host, oscPort: target.oscPort, name: target.name }])

  const view = (target: TargetState): OscQueryTargetView => ({
    id: target.id,
    source: target.source,
    name: target.name,
    host: target.host,
    httpPort: target.httpPort,
    oscPort: target.oscPort,
    bootId: target.bootId,
    pathEvents: target.pathEvents,
    status: target.status,
    error: target.error,
    fetchedAt: target.fetchedAt === null ? null : new Date(target.fetchedAt).toISOString(),
    palette: target.palette,
    unsupported: target.unsupported,
    dropped: target.dropped,
  })

  const publish = (clientId?: ClientId) => {
    if (closed) return
    deps.publish({ v: 1, type: 'osc.queryTargets', mdns: deps.mdnsState(), targets: [...targets.values()].map(view) }, clientId)
  }

  const changed = () => {
    publish()
    const key = JSON.stringify(destinations())
    if (key !== lastDestinationsKey) {
      lastDestinationsKey = key
      deps.onDestinationsChanged?.()
    }
  }

  const clearTimers = (target: TargetState) => {
    if (target.refreshTimer !== null) clearTimeoutFn(target.refreshTimer)
    if (target.retryTimer !== null) clearTimeoutFn(target.retryTimer)
    target.refreshTimer = null
    target.retryTimer = null
  }

  const stopWatch = (target: TargetState) => {
    const watch = target.watch
    target.watch = null
    target.pathEvents = false
    watch?.close()
  }

  const scheduleRetry = (target: TargetState) => {
    if (closed || target.retryTimer !== null) return
    const delay = target.retryMs
    target.retryMs = Math.min(MAX_RETRY_MS, target.retryMs * 2)
    target.retryTimer = setTimeoutFn(() => {
      target.retryTimer = null
      if (targets.get(target.id) === target) void load(target)
    }, delay)
  }

  // PATH_* は種類を問わず、間引いて木を取り直す(HID-484 §6.5)。1 つの操作で PATH_ADDED が何十も続くことがあるため
  const scheduleRefresh = (target: TargetState) => {
    if (closed || target.refreshTimer !== null) return
    target.refreshTimer = setTimeoutFn(() => {
      target.refreshTimer = null
      if (targets.get(target.id) === target) void load(target)
    }, deps.refreshDebounceMs)
  }

  const startWatch = (target: TargetState, hostInfo: OscQueryHostInfo) => {
    if (target.watch !== null || !supportsPathEvents(hostInfo)) return
    // WS_PORT が無ければ HTTP と同じポート(仕様の既定)
    const port = hostInfo.WS_PORT ?? target.httpPort
    let open = true
    target.watch = deps.client.watch(target.host, port, {
      onPathEvent: () => {
        if (open) scheduleRefresh(target)
      },
      onClose: reason => {
        if (!open) return
        open = false
        if (targets.get(target.id) !== target || target.watch === null) return
        target.watch = null
        target.pathEvents = false
        logWarn('(WARN, BRIDGE)', `OSCQuery WebSocket to ${target.host}:${String(port)} closed (${reason}); reloading the namespace later.`)
        publish()
        // 切れたら木の変化を知る手段が無いので、間を置いて読み直す(読み直しで WebSocket もつなぎ直す)
        scheduleRetry(target)
      },
    })
    target.pathEvents = true
  }

  const load = async (target: TargetState): Promise<void> => {
    if (closed) return
    target.abort?.abort(new Error('superseded'))
    const controller = new AbortController()
    target.abort = controller
    const generation = ++target.generation
    if (target.fetchedAt === null && target.status !== 'loading') {
      target.status = 'loading'
      publish()
    }
    const current = () => !closed && targets.get(target.id) === target && target.generation === generation
    await acquireSlot()
    if (!current()) {
      releaseSlot()
      return
    }
    const timer = setTimeoutFn(() => controller.abort(new Error(`timed out after ${String(deps.fetchTimeoutMs)} ms`)), deps.fetchTimeoutMs)
    try {
      const info = await deps.client.read(target.host, target.httpPort, 'HOST_INFO', controller.signal)
      // HOST_INFO に答えない(204・400)実装もある。名前空間だけで候補は作れる(送り先のポートは分からない)
      const parsedInfo = info.kind === 'json' ? OscQueryHostInfoSchema.safeParse(info.value) : null
      const hostInfo: OscQueryHostInfo = parsedInfo?.success === true ? parsedInfo.data : {}
      const tree = await deps.client.read(target.host, target.httpPort, null, controller.signal)
      if (!current()) return
      if (tree.kind !== 'json') throw new Error(`the namespace answered HTTP ${String(tree.status)}`)
      const parsed = parseOscQueryNamespace(tree.value)
      if (!parsed.ok) throw new Error(`the namespace is not usable (${parsed.reason})`)
      const palette = buildPalette(parsed.methods)
      const previousBoot = target.bootId
      const bootId = hostInfo[OSCQUERY.BOOT_ID_KEY] ?? null
      target.name = hostInfo.NAME ?? target.name
      target.oscPort = hostInfo.OSC_PORT ?? null
      target.bootId = bootId
      target.palette = palette.items
      target.unsupported = palette.unsupported
      target.dropped = palette.dropped
      target.status = 'ready'
      target.error = null
      target.fetchedAt = now()
      target.retryMs = baseRetryMs
      // 起動 ID の比較による再送は HID-487 の担当。ここでは記録と表示だけ
      if (previousBoot !== null && bootId !== null && previousBoot !== bootId) {
        logInfo('(INFO, BRIDGE)', `OSCQuery target ${target.id} restarted (boot id changed).`)
      }
      startWatch(target, hostInfo)
      changed()
    } catch (error) {
      if (!current()) return
      const cause = controller.signal.aborted ? controller.signal.reason as unknown : error
      const detail = (cause instanceof Error ? cause.message : String(cause)).slice(0, 256)
      // 前に読めた候補は消さない(一時的な失敗で画面の候補が消えないように)。理由だけを出して読み直す
      if (target.status !== 'error' || target.error !== detail) logWarn('(WARN, BRIDGE)', `OSCQuery target ${target.id} could not be read: ${detail}`)
      target.status = target.fetchedAt === null ? 'error' : target.status
      target.error = detail
      publish()
      scheduleRetry(target)
    } finally {
      clearTimeoutFn(timer)
      if (target.abort === controller) target.abort = null
      releaseSlot()
    }
  }

  const add = (id: string, source: 'mdns' | 'config', host: string, httpPort: number, name: string | null) => {
    if (targets.size >= OSCQUERY.MAX_TARGETS) {
      logWarn('(WARN, BRIDGE)', `Ignored OSCQuery target ${id}: already tracking ${String(OSCQUERY.MAX_TARGETS)} targets.`)
      return
    }
    const target: TargetState = {
      id, source, host, httpPort, name, oscPort: null, bootId: null, status: 'loading', error: null, fetchedAt: null,
      palette: [], unsupported: [], dropped: 0, watch: null, pathEvents: false, abort: null, generation: 0,
      refreshTimer: null, retryTimer: null, retryMs: baseRetryMs,
    }
    targets.set(id, target)
    logInfo('(INFO, BRIDGE)', `OSCQuery target ${id} at ${host}:${String(httpPort)} (${source}).`)
    void load(target)
    changed()
  }

  const remove = (target: TargetState) => {
    targets.delete(target.id)
    target.generation += 1
    target.abort?.abort(new Error('removed'))
    clearTimers(target)
    stopWatch(target)
  }

  return {
    start() {
      for (const entry of deps.configTargets) {
        const id = `${entry.host}:${String(entry.port)}`
        if (!targets.has(id)) add(id, 'config', entry.host, entry.port, null)
      }
      publish()
    },
    serviceFound(service) {
      if (closed) return
      if (!deps.isAllowedHost(service.host)) {
        logWarn('(WARN, BRIDGE)', `Ignored OSCQuery service "${service.instance}" at ${service.host}: outside the target networks.`)
        return
      }
      // 設定で直接指定したターゲットと同じなら、設定の方だけを持つ(同じターゲットを 2 回並べない)
      const asConfig = [...targets.values()].find(target => target.source === 'config' && target.host === service.host && target.httpPort === service.port)
      if (asConfig !== undefined) {
        if (asConfig.name === null) asConfig.name = service.instance
        scheduleRefresh(asConfig)
        return
      }
      const known = targets.get(service.instance)
      if (known === undefined) {
        add(service.instance, 'mdns', service.host, service.port, service.instance)
        return
      }
      if (known.host !== service.host || known.httpPort !== service.port) {
        // アドレスかポートが変わった(DHCP・再起動で別のポート)。WebSocket もつなぎ直す
        known.host = service.host
        known.httpPort = service.port
        stopWatch(known)
      }
      // 告知は起動に早く気づくきっかけ(D-164)。HOST_INFO を取り直して起動 ID を見る。告知を続けて送られても読み直しが
      // 重ならないよう、PATH_* と同じく間引く
      scheduleRefresh(known)
    },
    serviceLost(instance) {
      const target = targets.get(instance)
      if (target === undefined || target.source !== 'mdns') return
      logInfo('(INFO, BRIDGE)', `OSCQuery target ${instance} went away.`)
      remove(target)
      changed()
    },
    handleUiFrame(frame, clientId) {
      if (frame.type !== 'osc.queryRefresh') return false
      deps.requery?.()
      for (const target of targets.values()) {
        clearTimers(target)
        void load(target)
      }
      publish(clientId)
      return true
    },
    publish,
    destinations,
    close() {
      closed = true
      for (const target of [...targets.values()]) remove(target)
    },
  }
}

const MAX_RETRY_MS = 60_000
const MAX_CONCURRENT_LOADS = 2
