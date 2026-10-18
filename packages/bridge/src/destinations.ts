import type { DestinationsFrame, DownstreamFrame, UpstreamFrame } from '@oscdesk/shared'

import type { DestinationSelection, DestinationSelectionStore } from './destinations-file'
import { intToIpv4, ipv4ToInt, isUnicastIpv4 } from './ipv4'
import { scanSubnets, subnetOf, type LanProber, type Neighbor, type ScanInterface, type ScanSubnet } from './lan-scan'
import type { BroadcastNetwork, ClientId, RuntimeTargetSpec } from './surface-core'

// 宛先タブ(D-078)。LAN の走査・宛先の選択・選択の保存を受け持ち、実際の送信先は surface-core の setTargets で差し替える。
// 走査器・ファイル・時計は引数で受け取り、単体テストを実ネットワークとディスクに依存させない。

export const ALL_DEVICES_TARGET_NAME = 'all-devices'

/** 設定ファイルの宛先(主系 + 副系。D-046)。addresses は host がホスト名のときの名前解決済みアドレス。 */
export interface ConfigTarget {
  readonly name: string
  readonly host: string
  readonly sendPort: number
  readonly primary: boolean
  readonly addresses: readonly string[]
}

type DestinationsUpstream = Extract<UpstreamFrame, { type: 'destinationsScan' | 'destinationsSelect' | 'destinationsReset' }>
type LogFn = (message?: unknown, ...optionalParams: unknown[]) => void
type TimerHandle = ReturnType<typeof setTimeout> | number

export interface Destinations {
  /** 保存した選択を読んで宛先を決める(走査はしない)。 */
  start(): void
  /** 宛先タブのフレームなら処理して true。 */
  handleUiFrame(frame: UpstreamFrame, clientId: ClientId): boolean
  /** destinations の全量を配る(clientId を省くと全 UI)。 */
  publish(clientId?: ClientId): void
  /** 走査する。走査中なら、その走査の終わりを待つ(同時に 1 本だけ)。 */
  scan(): Promise<void>
  close(): void
}

/**
 * 個別の端末として選べるホストか(D-078)。次のどちらかだけを通す。
 * - 設定ファイルにある宛先のホスト(ホスト名・ループバックを含む。設定を書いた人が決めた宛先なので信頼する)
 * - この PC の有効なネットワーク(走査するネットワーク。この PC 自身のアドレスを含む)の中のユニキャストアドレス。
 *   ネットワークアドレス・ブロードキャストアドレス(例 192.168.1.0 / .255)は除く
 * UI は認証なしで誰でも送れるので、ここで縛らないと公開アドレス・ループバック・別ネットワークのディレクテッドブロードキャストへ
 * OSC を送らせ、それを保存して起動のたびの宛先にできてしまう。ネットワーク・ブロードキャストアドレスを通すと
 * 「全てのデバイス」の扱い(D-079 の pong の受け方・ユニキャストの再送)を経ずにブロードキャストになる。
 * 走査で見つかった端末かどうかでは縛らない(再起動直後は未走査で、保存した選択を戻せなくなるため)。
 * IPv4 は正規形(先頭ゼロの無い dotted-quad。例 192.168.1.20)だけを受ける。192.168.001.255 のような非正規の表記は、
 * 文字列の比較ではブロードキャストアドレスと一致しないのに OS はブロードキャストへ解決するので、拒否する(正規形へ直して受ける案は、
 * 保存した選択・一覧のチェックとの照合が表記ごとにずれるため採らない)。比較は整数で行う
 */
export function isSelectableHost(host: string, configTargets: readonly ConfigTarget[], subnets: readonly ScanSubnet[]): boolean {
  if (configTargets.some(target => target.host === host)) return true
  if (!isUnicastIpv4(host)) return false
  const value = ipv4ToInt(host)!
  if (intToIpv4(value) !== host) return false
  const subnet = subnetOf(host, subnets)
  return subnet !== undefined && value !== subnet.networkInt && value !== ipv4ToInt(subnet.broadcast)
}

/**
 * 選択から実際の宛先を決める(純粋関数)。選択が null(未保存)なら設定ファイルの宛先そのもの。
 * 選べない選択(全てのデバイスなのにネットワークが無い・選べるホストが残らない)は null を返し、呼び出し側が設定の宛先に戻す。
 *
 * - 全てのデバイス: 走査ネットワークごとのブロードキャストアドレス(先頭が主系)。ポートは unity.sendPort
 * - 端末の選択: 設定ファイルにあるホストはその宛先(名前・sendPort)をそのまま使い、それ以外は `ip-a-b-c-d` の宛先にする。
 *   主系は設定の主系が選ばれていればそれ、無ければ選択の先頭
 */
export function resolveDestinationTargets(input: {
  selection: DestinationSelection | null
  configTargets: readonly ConfigTarget[]
  subnets: readonly ScanSubnet[]
  sendPort: number
}): RuntimeTargetSpec[] | null {
  const { selection, configTargets, subnets, sendPort } = input
  // 選択が無い間も、この PC を指す config の宛先にはループバックの別名を足す(選び直したときと同じ規則)
  if (selection === null) return configTargets.map(target => ({ ...target, addresses: withLoopbackAlias(target.host, target.addresses, subnets) }))
  if (selection.allDevices) {
    if (subnets.length === 0) return null
    return subnets.map((subnet, index) => ({
      name: index === 0 ? ALL_DEVICES_TARGET_NAME : `${ALL_DEVICES_TARGET_NAME}-${String(index + 1)}`,
      host: subnet.broadcast,
      sendPort,
      primary: index === 0,
      broadcast: { networkInt: subnet.networkInt, maskInt: subnet.maskInt },
    }))
  }
  const hosts = [...new Set(selection.hosts)].filter(host => isSelectableHost(host, configTargets, subnets))
  if (hosts.length === 0) return null
  const used = new Set<string>()
  const uniqueName = (base: string) => {
    let name = base
    for (let index = 2; used.has(name); index += 1) name = `${base}-${String(index)}`
    used.add(name)
    return name
  }
  const result: RuntimeTargetSpec[] = []
  for (const host of hosts) {
    const configured = configTargets.filter(target => target.host === host)
    if (configured.length > 0) {
      for (const target of configured) {
        result.push({ ...target, name: uniqueName(target.name), primary: false, addresses: withLoopbackAlias(target.host, target.addresses, subnets) })
      }
    } else {
      const addresses = withLoopbackAlias(host, [], subnets)
      result.push({
        name: uniqueName(`ip-${host.replace(/\./g, '-')}`),
        host,
        sendPort,
        primary: false,
        ...(addresses.length > 0 ? { addresses } : {}),
      })
    }
  }
  const configPrimary = configTargets.find(target => target.primary)
  const primaryIndex = Math.max(0, result.findIndex(target => configPrimary !== undefined
    && target.host === configPrimary.host && target.sendPort === configPrimary.sendPort))
  return result.map((target, index) => ({ ...target, primary: index === primaryIndex }))
}

/**
 * 宛先が受ける送信元アドレス(名前解決済みのアドレス)に、この PC 宛てならループバックの別名を足す。
 * 同じ PC の Unity は返信先を 127.0.0.1 にしているとループバックから pong とエコーを返すので、足さないと
 * 到達不能のまま保持値も再送されない。host がこの PC の LAN アドレスのとき・host の名前解決先にこの PC のアドレスがあるときの
 * どちらも当てる(個別に選んだ端末と、選び直した config の宛先(主系・副系)で同じ規則にする)
 */
export function withLoopbackAlias(host: string, addresses: readonly string[], subnets: readonly ScanSubnet[]): string[] {
  const own = new Set(subnets.map(subnet => subnet.address))
  const isSelf = own.has(host) || addresses.some(address => own.has(address))
  return isSelf && !addresses.includes(LOOPBACK_ALIAS) ? [...addresses, LOOPBACK_ALIAS] : [...addresses]
}

const LOOPBACK_ALIAS = '127.0.0.1'

/** 一覧に並べる端末(純粋関数)。走査で見つかった端末・この PC・設定の宛先・選択中のホストの和集合を IP の順に並べる。 */
export function listDevices(input: {
  neighbors: readonly Neighbor[]
  subnets: readonly ScanSubnet[]
  configTargets: readonly ConfigTarget[]
  selectedHosts: readonly string[]
}): DestinationsFrame['devices'] {
  const devices = new Map<string, DestinationsFrame['devices'][number]>()
  const upsert = (host: string, patch: Partial<DestinationsFrame['devices'][number]>) => {
    const current = devices.get(host) ?? {
      host, mac: null, interface: subnetOf(host, input.subnets)?.interface ?? null, self: false, configured: false, found: false,
    }
    devices.set(host, { ...current, ...patch })
  }
  for (const neighbor of input.neighbors) upsert(neighbor.host, { mac: neighbor.mac, found: true })
  // この PC は ARP 表に出ないが、同じ PC の Unity へ送る構成があるので自分のアドレスも並べる
  for (const subnet of input.subnets) upsert(subnet.address, { self: true, found: true })
  for (const target of input.configTargets) upsert(target.host, { configured: true })
  for (const host of input.selectedHosts) upsert(host, {})
  return [...devices.values()].sort(compareHosts)
}

function compareHosts(a: { host: string }, b: { host: string }): number {
  const left = ipv4ToInt(a.host)
  const right = ipv4ToInt(b.host)
  if (left !== null && right !== null) return left - right
  if (left !== null) return -1
  if (right !== null) return 1
  return a.host.localeCompare(b.host)
}

export function createDestinations(deps: {
  configTargets: readonly ConfigTarget[]
  sendPort: number
  interfaces: () => readonly ScanInterface[]
  prober: LanProber
  store: DestinationSelectionStore
  scanTimeoutMs: number
  applyTargets: (targets: readonly RuntimeTargetSpec[]) => void
  currentTargets: () => readonly { name: string; host: string; sendPort: number; primary: boolean; broadcast: BroadcastNetwork | null }[]
  primaryHosts: () => readonly string[]
  publish: (frame: DownstreamFrame, clientId?: ClientId) => void
  now?: () => number
  setTimeoutFn?: (cb: () => void, ms: number) => TimerHandle
  clearTimeoutFn?: (handle: TimerHandle) => void
  logInfo?: LogFn
  logWarn?: LogFn
}): Destinations {
  const now = deps.now ?? Date.now
  const setTimeoutFn = deps.setTimeoutFn ?? setTimeout
  const clearTimeoutFn = deps.clearTimeoutFn ?? clearTimeout
  const logInfo = deps.logInfo ?? console.info
  const logWarn = deps.logWarn ?? console.warn
  const configHosts = [...new Set(deps.configTargets.map(target => target.host))]
  let selection: DestinationSelection | null = null
  let subnets: ScanSubnet[] = []
  let neighbors: readonly Neighbor[] = []
  let scannedAt: number | null = null
  let inFlight: Promise<void> | null = null
  let abortScan: ((reason: Error) => void) | null = null
  let closed = false
  // 選択をファイルへ書けたか。書けなかった選択は実行中だけ効くので、保存済み(saved)としては配らない(unsaved)
  let persisted = true

  // 選択をこの PC の今のネットワークで検証し直す(保存した選択の復元と、走査でネットワークが変わったとき。D-078)。
  // 外れたホストは警告して落とし、個別の選択が全部落ちたら null(設定ファイルの宛先)にする。ファイルは書き換えない
  // (NIC が一時的に落ちていただけなら、次の起動で戻せるように)
  const revalidate = (candidate: DestinationSelection, context: string): DestinationSelection | null => {
    const hosts = candidate.hosts.filter(host => isSelectableHost(host, deps.configTargets, subnets))
    const dropped = candidate.hosts.filter(host => !hosts.includes(host))
    if (dropped.length > 0) {
      logWarn('(WARN, BRIDGE)', `Destinations (${context}): dropped host(s) outside the local networks and the config targets: ${dropped.join(', ')}.`)
    }
    if (!candidate.allDevices && hosts.length === 0) {
      logWarn('(WARN, BRIDGE)', `Destinations (${context}): no selectable host left; using the config targets.`)
      return null
    }
    return { allDevices: candidate.allDevices, hosts }
  }

  const apply = () => {
    const targets = resolveDestinationTargets({ selection, configTargets: deps.configTargets, subnets, sendPort: deps.sendPort })
    if (targets === null) {
      // 保存した選択は消さない(NIC が戻れば次の走査・再起動でまた効く)
      logWarn('(WARN, BRIDGE)', selection?.allDevices === true
        ? 'Destinations: "all devices" needs an IPv4 network interface; using the config targets for now.'
        : 'Destinations: no selectable host in the saved selection; using the config targets for now.')
      deps.applyTargets(resolveDestinationTargets({ selection: null, configTargets: deps.configTargets, subnets, sendPort: deps.sendPort })!)
      return
    }
    deps.applyTargets(targets)
  }

  const frame = (): DownstreamFrame => ({
    v: 1,
    type: 'destinations',
    sendPort: deps.sendPort,
    scanning: inFlight !== null,
    scannedAt: scannedAt === null ? null : new Date(scannedAt).toISOString(),
    devices: listDevices({ neighbors, subnets, configTargets: deps.configTargets, selectedHosts: selection?.hosts ?? [] }),
    broadcasts: subnets.map(subnet => ({ address: subnet.broadcast, interface: subnet.interface, network: subnet.network })),
    // 未保存の間は設定の宛先のホストを選択中として見せる(チェックを足し引きした結果がそのまま新しい選択になる)
    selection: selection === null
      ? { source: 'config', allDevices: false, hosts: configHosts }
      : { source: persisted ? 'saved' : 'unsaved', allDevices: selection.allDevices, hosts: [...selection.hosts] },
    targets: deps.currentTargets().map(target => ({
      name: target.name, host: target.host, sendPort: target.sendPort, primary: target.primary, broadcast: target.broadcast !== null,
    })),
    primaryHosts: [...deps.primaryHosts()],
  })

  const publish = (clientId?: ClientId) => {
    if (!closed) deps.publish(frame(), clientId)
  }

  const reject = (clientId: ClientId, detail: string) => {
    deps.publish({ v: 1, type: 'notice', level: 'error', code: 'destinations-rejected', detail }, clientId)
    // 要求元のチェックボックスを、ブリッジが持つ選択へ戻させる
    publish(clientId)
  }

  const networksKey = (list: readonly ScanSubnet[]) => list.map(subnet => `${String(subnet.networkInt)}/${String(subnet.maskInt)}`).join(',')
  const saveFailed = (detail: string) => {
    // 選択はどの UI から見ても同じなので、保存の失敗も全 UI へ知らせる
    deps.publish({ v: 1, type: 'notice', level: 'error', code: 'destinations-save-failed', detail })
  }

  const scan = (): Promise<void> => {
    if (inFlight !== null) return inFlight
    // 時間切れと close は走査器まで中断を通す(ラッパだけを終わらせると、走査が裏で続いて次の走査と重なり、
    // 終了後もタイマー・ソケット・子プロセスが Node を生かし続けるため)。走査器が中断を受けて終わるまで inFlight を残す
    const controller = new AbortController()
    abortScan = reason => controller.abort(reason)
    const scanning = (async () => {
      const subnetsNow = scanSubnets(deps.interfaces())
      const timer = setTimeoutFn(
        () => controller.abort(new Error(`timed out after ${String(deps.scanTimeoutMs)} ms`)),
        deps.scanTimeoutMs,
      )
      try {
        const found = await deps.prober.probe(subnetsNow, controller.signal)
        // 中断を受けても結果を返してしまう走査器の結果は使わない
        controller.signal.throwIfAborted()
        if (closed) return
        const networksChanged = networksKey(subnets) !== networksKey(subnetsNow)
        subnets = subnetsNow
        neighbors = found
        scannedAt = now()
        logInfo('(INFO, BRIDGE)', `LAN scan found ${String(found.length)} device(s) on ${subnetsNow.map(subnet => subnet.network).join(', ') || 'no IPv4 network'}.`)
        // NIC の差し替えでネットワークが変わったら、全てのデバイス(ブロードキャストアドレス)も個別の選択(ネットワークの中か)も
        // 決め直す。個別の選択を検証し直さないと、もう選べない旧ネットワークのホストへ送り続ける
        if (networksChanged && selection !== null) {
          selection = revalidate(selection, 'network changed')
          apply()
        }
      } catch (error) {
        if (closed) return
        // 中断で終わったときは、走査器が投げた AbortError ではなく中断の理由(時間切れ)を伝える
        const cause = controller.signal.aborted ? controller.signal.reason as unknown : error
        const detail = cause instanceof Error ? cause.message : String(cause)
        logWarn('(WARN, BRIDGE)', `LAN scan failed: ${detail}`)
        deps.publish({ v: 1, type: 'notice', level: 'warn', code: 'destinations-scan-failed', detail })
      } finally {
        clearTimeoutFn(timer)
      }
    })()
    inFlight = scanning.finally(() => {
      inFlight = null
      abortScan = null
      publish()
    })
    // 走査中であることを先に配る(更新ボタンを押した UI に「走査中」を出す)
    publish()
    return inFlight
  }

  const select = (frameIn: Extract<DestinationsUpstream, { type: 'destinationsSelect' }>, clientId: ClientId) => {
    const hosts = [...new Set(frameIn.hosts)]
    const invalid = hosts.find(host => !isSelectableHost(host, deps.configTargets, subnets))
    if (invalid !== undefined) return reject(clientId, `invalid-host: ${invalid}`)
    if (!frameIn.allDevices && hosts.length === 0) return reject(clientId, 'empty-selection')
    if (frameIn.allDevices && subnets.length === 0) return reject(clientId, 'no-broadcast-network')
    selection = { allDevices: frameIn.allDevices, hosts }
    persisted = deps.store.save(selection)
    if (!persisted) saveFailed(`could not write ${deps.store.file}; the selection lasts until the bridge stops`)
    apply()
    publish()
  }

  return {
    start() {
      subnets = scanSubnets(deps.interfaces())
      const saved = deps.store.load()
      if (saved !== null) {
        // 保存した選択も UI からの選択と同じ規則で検証する(ファイルを手で書き換えた・ネットワークが変わった場合)
        selection = revalidate(saved, `restoring ${deps.store.file}`)
        persisted = true
        if (selection !== null) logInfo('(INFO, BRIDGE)', `Restored destinations from "${deps.store.file}".`)
      }
      if (selection !== null) apply()
      // 起動時には走査しない。走査は LAN の全アドレスへ送るので、宛先タブを開いた UI の要求(未走査なら UI が自動で出す)
      // と「更新」でだけ行う(UI を使わない起動・E2E で LAN へ撒かないため)
    },
    handleUiFrame(frameIn, clientId) {
      if (frameIn.type === 'destinationsScan') {
        // 走査中に押された更新は、走査中の走査に合流させる(要求元には走査中の状態を見せる)
        if (inFlight !== null) publish(clientId)
        else void scan()
        return true
      }
      if (frameIn.type === 'destinationsSelect') {
        select(frameIn, clientId)
        return true
      }
      if (frameIn.type === 'destinationsReset') {
        selection = null
        persisted = true
        // 消せなかったファイルは次の起動で読み戻されるので、そのことを知らせる
        if (!deps.store.clear()) saveFailed(`could not remove ${deps.store.file}; the saved selection comes back after a bridge restart`)
        apply()
        publish()
        return true
      }
      return false
    },
    publish,
    scan,
    close() {
      closed = true
      abortScan?.(new Error('bridge is closing'))
    },
  }
}
