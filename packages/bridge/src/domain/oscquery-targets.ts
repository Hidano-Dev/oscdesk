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
  /**
   * WebSocket で PATH_* を受ける(LISTEN は送らない)。onOpen はつながったとき、onPathEvent は PATH_* を受けるたび、
   * onClose は切れた・つながらなかったとき 1 回だけ(close() で閉じたときは呼ばない)。例外は投げない(つなげなければ onClose)
   */
  watch(host: string, port: number, handlers: { onOpen?: () => void; onPathEvent: (command: string) => void; onClose: (reason: string) => void }): OscQueryWatch
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
  /** mDNS の削除の告知・期限切れ。同じエンドポイントを名乗るインスタンスが残っていればターゲットは残す */
  serviceLost(instance: string): void
  /** ターゲットがいる範囲が変わったとき。範囲の外になった mDNS のターゲットを外す */
  revalidate(): void
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
  /** 監視中の WebSocket と、その接続先(host:port)。HOST_INFO の WS_PORT・EXTENSIONS が変われば張り直す */
  watch: { handle: OscQueryWatch; key: string; token: object } | null
  pathEvents: boolean
  abort: AbortController | null
  // 読み込みの世代。読んでいる間に読み直し・エンドポイントの変更・削除が来たら、古い読み込みの結果を捨てる
  generation: number
  refreshTimer: TimerHandle | null
  /** HTTP の読み直し(読めなかったとき)。間隔は httpRetryMs で倍々に延ばし、読めたら戻す */
  retryTimer: TimerHandle | null
  httpRetryMs: number
  /** WebSocket のつなぎ直し。間隔は watchRetryMs で倍々に延ばし、つながったら戻す(HTTP の成功では戻さない) */
  watchTimer: TimerHandle | null
  watchRetryMs: number
  /** 最後に読めた HOST_INFO(WebSocket をつなぎ直すときに使う) */
  hostInfo: OscQueryHostInfo | null
  /** 載せている候補(palette と unsupported)の JSON の大きさ。全ターゲットの合計を予算に収める */
  paletteBytes: number
  /** このターゲットを名乗っている mDNS のインスタンス名。最後の 1 つが消えたらターゲットを消す(設定のターゲットは空) */
  instances: Set<string>
}

/**
 * 候補を予算(JSON の大きさ)に収める。先頭から載せ、入らない項目は数えて落とす(dropped)。
 * 1 項目は VALS などで数十 KB になり得るので、件数だけでなく大きさで縛る
 */
export function fitPalette(items: readonly PaletteItem[], unsupported: readonly PaletteUnsupported[], budget: number): { items: PaletteItem[]; unsupported: PaletteUnsupported[]; bytes: number; dropped: number } {
  let bytes = 0
  let dropped = 0
  const keptItems: PaletteItem[] = []
  for (const item of items) {
    const size = JSON.stringify(item).length + 1
    if (bytes + size > budget) {
      dropped += 1
      continue
    }
    bytes += size
    keptItems.push(item)
  }
  const keptUnsupported: PaletteUnsupported[] = []
  for (const entry of unsupported) {
    const size = JSON.stringify(entry).length + 1
    if (bytes + size > budget) {
      dropped += 1
      continue
    }
    bytes += size
    keptUnsupported.push(entry)
  }
  return { items: keptItems, unsupported: keptUnsupported, bytes, dropped }
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
  let lastRequeryAt = Number.NEGATIVE_INFINITY
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

  const isCurrent = (target: TargetState) => !closed && targets.get(target.id) === target

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

  const clearTimer = (target: TargetState, which: 'refreshTimer' | 'retryTimer' | 'watchTimer') => {
    const handle = target[which]
    if (handle !== null) clearTimeoutFn(handle)
    target[which] = null
  }

  const stopWatch = (target: TargetState) => {
    const watch = target.watch
    target.watch = null
    target.pathEvents = false
    clearTimer(target, 'watchTimer')
    watch?.handle.close()
  }

  /** 進行中の読み込みを捨てる(世代を進めて中断する)。結果は使われない */
  const invalidate = (target: TargetState, reason: string) => {
    target.generation += 1
    target.abort?.abort(new Error(reason))
    target.abort = null
  }

  const scheduleHttpRetry = (target: TargetState) => {
    if (!isCurrent(target) || target.retryTimer !== null) return
    const delay = target.httpRetryMs
    target.httpRetryMs = Math.min(MAX_RETRY_MS, target.httpRetryMs * 2)
    target.retryTimer = setTimeoutFn(() => {
      target.retryTimer = null
      if (isCurrent(target)) void load(target)
    }, delay)
  }

  // PATH_*・mDNS の告知・osc.queryRefresh は、間引いて木を取り直す(HID-484 §6.5)。1 つの操作で PATH_ADDED が何十も続くことがあるため
  const scheduleRefresh = (target: TargetState) => {
    if (!isCurrent(target) || target.refreshTimer !== null) return
    target.refreshTimer = setTimeoutFn(() => {
      target.refreshTimer = null
      if (isCurrent(target)) void load(target)
    }, deps.refreshDebounceMs)
  }

  const scheduleWatchRetry = (target: TargetState) => {
    if (!isCurrent(target) || target.watchTimer !== null) return
    const delay = target.watchRetryMs
    target.watchRetryMs = Math.min(MAX_RETRY_MS, target.watchRetryMs * 2)
    target.watchTimer = setTimeoutFn(() => {
      target.watchTimer = null
      // 切れていた間の変化は知らないので、つなぎ直しと一緒に木も読み直す(読み込みが WebSocket をつなぐ)
      if (isCurrent(target)) void load(target)
    }, delay)
  }

  /**
   * HOST_INFO に合わせて WebSocket の監視を揃える。PATH_* に対応しなくなったら閉じ、接続先(ホスト・WS_PORT)が変わったら張り直す。
   * 同じ接続先でつながっているなら何もしない
   */
  const syncWatch = (target: TargetState, hostInfo: OscQueryHostInfo) => {
    if (!supportsPathEvents(hostInfo)) {
      if (target.watch !== null) stopWatch(target)
      return
    }
    // WS_PORT が無ければ HTTP と同じポート(仕様の既定)
    const port = hostInfo.WS_PORT ?? target.httpPort
    const key = `${target.host}:${String(port)}`
    if (target.watch !== null && target.watch.key === key) return
    if (target.watch !== null) stopWatch(target)
    // 張り直しの待ちがあれば、この接続で置き換える
    clearTimer(target, 'watchTimer')
    // この接続の印。古い接続(張り直した・閉じた)からの知らせを取り違えないよう、今の監視の印と比べる。
    // watch が同期で onClose を呼んでも(つなげない)扱えるよう、呼ぶ前に監視として登録しておく
    const token = {}
    const slot: { handle: OscQueryWatch; key: string; token: object } = { handle: { close: () => undefined }, key, token }
    target.watch = slot
    target.pathEvents = true
    const isLive = () => isCurrent(target) && target.watch?.token === token
    slot.handle = deps.client.watch(target.host, port, {
      onOpen: () => {
        if (!isLive()) return
        target.watchRetryMs = baseRetryMs
      },
      onPathEvent: () => {
        if (isLive()) scheduleRefresh(target)
      },
      onClose: reason => {
        if (!isLive()) return
        target.watch = null
        target.pathEvents = false
        logWarn('(WARN, BRIDGE)', `OSCQuery WebSocket to ${key} closed (${reason}); reconnecting later.`)
        publish()
        scheduleWatchRetry(target)
      },
    })
  }

  const load = async (target: TargetState): Promise<void> => {
    if (!isCurrent(target)) return
    invalidate(target, 'superseded')
    const controller = new AbortController()
    target.abort = controller
    const generation = target.generation
    // 読み込みはこの時点のエンドポイントで行う(途中で告知がアドレスを変えても、旧エンドポイントの HOST_INFO と
    // 新エンドポイントの名前空間を混ぜない。変更は invalidate で世代を進めるので、この読み込みの結果は捨てられる)
    const endpoint = { host: target.host, httpPort: target.httpPort }
    const current = () => isCurrent(target) && target.generation === generation
    if (target.fetchedAt === null && target.status !== 'loading') {
      target.status = 'loading'
      publish()
    }
    await acquireSlot()
    if (!current()) {
      releaseSlot()
      return
    }
    const timer = setTimeoutFn(() => controller.abort(new Error(`timed out after ${String(deps.fetchTimeoutMs)} ms`)), deps.fetchTimeoutMs)
    try {
      const info = await deps.client.read(endpoint.host, endpoint.httpPort, 'HOST_INFO', controller.signal)
      if (!current()) return
      // HOST_INFO に答えない(204・400)実装もある。名前空間だけで候補は作れる(送り先のポートは分からない)
      const parsedInfo = info.kind === 'json' ? OscQueryHostInfoSchema.safeParse(info.value) : null
      const hostInfo: OscQueryHostInfo = parsedInfo?.success === true ? parsedInfo.data : {}
      const tree = await deps.client.read(endpoint.host, endpoint.httpPort, null, controller.signal)
      if (!current()) return
      if (tree.kind !== 'json') throw new Error(`the namespace answered HTTP ${String(tree.status)}`)
      const parsed = parseOscQueryNamespace(tree.value)
      if (!parsed.ok) throw new Error(`the namespace is not usable (${parsed.reason})`)
      // 候補は 1 ターゲットと全ターゲットの合計の両方の予算に収める。LAN の 1 台がインスタンスを 64 個告知して
      // それぞれ大きな名前空間を返すと、候補を抱え続けて全量のフレームも数百 MiB になるため
      const built = buildPalette(parsed.methods)
      const others = [...targets.values()].reduce((sum, other) => other === target ? sum : sum + other.paletteBytes, 0)
      const budget = Math.max(0, Math.min(PALETTE_BYTES_PER_TARGET, PALETTE_BYTES_TOTAL - others))
      const fitted = fitPalette(built.items, built.unsupported, budget)
      const palette = { items: fitted.items, unsupported: fitted.unsupported, dropped: built.dropped + fitted.dropped }
      target.paletteBytes = fitted.bytes
      if (fitted.dropped > 0) logWarn('(WARN, BRIDGE)', `OSCQuery target ${target.id}: dropped ${String(fitted.dropped)} palette item(s) over the size budget.`)
      const previousBoot = target.bootId
      const bootId = hostInfo[OSCQUERY.BOOT_ID_KEY] ?? null
      target.name = hostInfo.NAME ?? target.name
      target.oscPort = hostInfo.OSC_PORT ?? null
      target.bootId = bootId
      target.hostInfo = hostInfo
      target.palette = palette.items
      target.unsupported = palette.unsupported
      target.dropped = palette.dropped
      target.status = 'ready'
      target.error = null
      target.fetchedAt = now()
      // HTTP の再試行の間隔だけを戻す。WebSocket の間隔は、つながったとき(onOpen)に戻す
      target.httpRetryMs = baseRetryMs
      clearTimer(target, 'retryTimer')
      // 起動 ID の比較による再送は HID-487 の担当。ここでは記録と表示だけ
      if (previousBoot !== null && bootId !== null && previousBoot !== bootId) {
        logInfo('(INFO, BRIDGE)', `OSCQuery target ${target.id} restarted (boot id changed).`)
      }
      syncWatch(target, hostInfo)
      changed()
    } catch (error) {
      if (!current()) return
      const cause = controller.signal.aborted ? controller.signal.reason as unknown : error
      const detail = (cause instanceof Error ? cause.message : String(cause)).slice(0, 256)
      // 前に読めた候補は消さない(一時的な失敗で画面の候補が消えないように)。理由だけを出して読み直す
      if (target.error !== detail) logWarn('(WARN, BRIDGE)', `OSCQuery target ${target.id} could not be read: ${detail}`)
      target.status = target.fetchedAt === null ? 'error' : target.status
      target.error = detail
      publish()
      scheduleHttpRetry(target)
    } finally {
      clearTimeoutFn(timer)
      if (target.abort === controller) target.abort = null
      releaseSlot()
    }
  }

  // mDNS のインスタンス名 → それを名乗ったターゲット(同じエンドポイントの複数のインスタンス名は 1 つのターゲットにまとまる)
  const owner = new Map<string, TargetState>()
  const attach = (target: TargetState, instance: string) => {
    if (target.source !== 'mdns') return
    // 1 つのターゲットが覚える名前の数も縛る(名乗り放題で表を膨らませない)。覚えきれない名前は、消えても何もしないだけ
    if (!target.instances.has(instance) && target.instances.size >= MAX_INSTANCES_PER_TARGET) return
    target.instances.add(instance)
    owner.set(instance, target)
  }
  /** インスタンス名をターゲットから外す。外したターゲット(無ければ null) */
  const detach = (instance: string): TargetState | null => {
    const target = owner.get(instance)
    if (target === undefined) return null
    owner.delete(instance)
    target.instances.delete(instance)
    if (target.source === 'mdns' && target.instances.size === 0 && targets.get(target.id) === target && !closed) {
      // 移った・設定のターゲットに吸われたなどで名乗る名前が無くなった。消えたのと同じ扱い
      remove(target)
      changed()
    }
    return target
  }
  const uniqueId = (base: string) => {
    let id = base
    for (let index = 2; targets.has(id); index += 1) id = `${base}#${String(index)}`
    return id
  }
  const resetEndpoint = (known: TargetState, host: string, httpPort: number) => {
    // 旧エンドポイントの読み込み・監視・送り先は捨て、新しいエンドポイントで読み直す(旧の OSC_PORT を新しいアドレスと組み合わせて送らない)
    invalidate(known, 'endpoint changed')
    stopWatch(known)
    clearTimer(known, 'retryTimer')
    known.host = host
    known.httpPort = httpPort
    known.oscPort = null
    known.bootId = null
    known.hostInfo = null
    known.palette = []
    known.unsupported = []
    known.paletteBytes = 0
    known.dropped = 0
    known.fetchedAt = null
    known.status = 'loading'
    known.error = null
    known.httpRetryMs = baseRetryMs
    known.watchRetryMs = baseRetryMs
    changed()
  }

  const add = (id: string, source: 'mdns' | 'config', host: string, httpPort: number, name: string | null): TargetState | null => {
    if (targets.size >= OSCQUERY.MAX_TARGETS) {
      logWarn('(WARN, BRIDGE)', `Ignored OSCQuery target ${id}: already tracking ${String(OSCQUERY.MAX_TARGETS)} targets.`)
      return null
    }
    const target: TargetState = {
      id, source, host, httpPort, name, oscPort: null, bootId: null, status: 'loading', error: null, fetchedAt: null,
      palette: [], unsupported: [], dropped: 0, watch: null, pathEvents: false, abort: null, generation: 0,
      refreshTimer: null, retryTimer: null, httpRetryMs: baseRetryMs, watchTimer: null, watchRetryMs: baseRetryMs, hostInfo: null, paletteBytes: 0, instances: new Set(),
    }
    targets.set(id, target)
    logInfo('(INFO, BRIDGE)', `OSCQuery target ${id} at ${host}:${String(httpPort)} (${source}).`)
    void load(target)
    changed()
    return target
  }

  const remove = (target: TargetState) => {
    targets.delete(target.id)
    for (const instance of target.instances) if (owner.get(instance) === target) owner.delete(instance)
    target.instances.clear()
    invalidate(target, 'removed')
    clearTimer(target, 'refreshTimer')
    clearTimer(target, 'retryTimer')
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
      if (!Number.isInteger(service.port) || service.port < 1 || service.port > 65535 || service.instance.length === 0) return
      if (!deps.isAllowedHost(service.host)) {
        logWarn('(WARN, BRIDGE)', `Ignored OSCQuery service "${service.instance.slice(0, 64)}" at ${service.host}: outside the target networks.`)
        return
      }
      // 設定で直接指定したターゲットと同じなら、設定の方だけを持つ(同じターゲットを 2 回並べない)
      const asConfig = [...targets.values()].find(target => target.source === 'config' && target.host === service.host && target.httpPort === service.port)
      if (asConfig !== undefined) {
        detach(service.instance)
        if (asConfig.name === null) asConfig.name = service.instance
        scheduleRefresh(asConfig)
        return
      }
      const current = owner.get(service.instance)
      if (current !== undefined) {
        if (current.host === service.host && current.httpPort === service.port) {
          // 告知は起動に早く気づくきっかけ(D-164)。HOST_INFO を取り直して起動 ID を見る。告知を続けて送られても読み直しが
          // 重ならないよう、PATH_* と同じく間引く
          scheduleRefresh(current)
          return
        }
        const occupied = [...targets.values()].some(target => target !== current && target.host === service.host && target.httpPort === service.port)
        if (current.instances.size === 1 && !occupied) {
          // このインスタンスだけのターゲットのアドレスかポートが変わった(DHCP・再起動で別のポート)
          resetEndpoint(current, service.host, service.port)
          scheduleRefresh(current)
          return
        }
        // ほかのインスタンスと共有していた・移った先に別のターゲットがある。このインスタンスだけを外して、下で付け直す
        detach(service.instance)
      }
      // 同じエンドポイント(ホストと HTTP のポート)を別のインスタンス名で告知しても、1 つのターゲットとして持つ。
      // 1 台がたくさんのインスタンスを名乗って同じ名前空間を何度も読ませ、候補を抱えさせないため。名乗ったインスタンス名は
      // すべて覚え、最後の 1 つが消えたときだけターゲットを消す
      const sameEndpoint = [...targets.values()].find(target => target.host === service.host && target.httpPort === service.port)
      if (sameEndpoint !== undefined) {
        attach(sameEndpoint, service.instance)
        scheduleRefresh(sameEndpoint)
        return
      }
      const onHost = [...targets.values()].filter(target => target.source === 'mdns' && target.host === service.host).length
      if (onHost >= MAX_TARGETS_PER_HOST) {
        logWarn('(WARN, BRIDGE)', `Ignored OSCQuery service "${service.instance.slice(0, 64)}" at ${service.host}: already tracking ${String(MAX_TARGETS_PER_HOST)} targets on that host.`)
        return
      }
      const added = add(uniqueId(service.instance), 'mdns', service.host, service.port, service.instance)
      if (added !== null) attach(added, service.instance)
    },
    serviceLost(instance) {
      const target = owner.get(instance)
      if (target === undefined) return
      if (target.instances.size === 1) logInfo('(INFO, BRIDGE)', `OSCQuery target ${target.id} went away.`)
      // 最後の 1 つなら detach がターゲットを消す。ほかの名前が残っていれば、候補も読み込みもそのまま
      detach(instance)
    },
    revalidate() {
      // ターゲットがいる範囲(D-113)が変わった。外れた mDNS のターゲットを外す(入ったものは発見の側が知らせ直す)
      let dropped = false
      for (const target of [...targets.values()]) {
        if (target.source !== 'mdns' || deps.isAllowedHost(target.host)) continue
        logInfo('(INFO, BRIDGE)', `OSCQuery target ${target.id} is outside the target networks now.`)
        remove(target)
        dropped = true
      }
      if (dropped) changed()
    },    handleUiFrame(frame, clientId) {
      if (frame.type !== 'osc.queryRefresh') return false
      // 認証の無い UI から連打されても、mDNS の問い合わせは 1 秒に 1 回まで、読み直しは間引いて 1 回にまとめる
      if (now() - lastRequeryAt >= REQUERY_MIN_INTERVAL_MS) {
        lastRequeryAt = now()
        deps.requery?.()
      }
      for (const target of targets.values()) {
        clearTimer(target, 'retryTimer')
        scheduleRefresh(target)
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
const REQUERY_MIN_INTERVAL_MS = 1_000
// 候補の大きさの予算(JSON の文字数)。1 ターゲット 1 MiB、全体 8 MiB(全量のフレームを数 MiB に収める)
const PALETTE_BYTES_PER_TARGET = 1024 * 1024
const PALETTE_BYTES_TOTAL = 8 * 1024 * 1024
// 1 台の PC で同時に持つ mDNS のターゲットの数(同じ PC の複数のアプリには十分で、1 台が名乗り放題にならない数)
const MAX_TARGETS_PER_HOST = 8
const MAX_INSTANCES_PER_TARGET = 16