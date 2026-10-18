import type { DestinationsFrame, DownstreamFrame, UpstreamFrame } from '@oscdesk/shared'

import type { DestinationSelection, DestinationSelectionStore } from './destinations-file'
import { ipv4ToInt, isUnicastIpv4 } from './ipv4'
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

/** 宛先として選べるホストか。IPv4 のユニキャストか、設定ファイルにある宛先のホスト(ホスト名を含む)。 */
export function isSelectableHost(host: string, configTargets: readonly ConfigTarget[]): boolean {
  return isUnicastIpv4(host) || configTargets.some(target => target.host === host)
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
  if (selection === null) return configTargets.map(target => ({ ...target }))
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
  const hosts = [...new Set(selection.hosts)].filter(host => isSelectableHost(host, configTargets))
  if (hosts.length === 0) return null
  const used = new Set<string>()
  const uniqueName = (base: string) => {
    let name = base
    for (let index = 2; used.has(name); index += 1) name = `${base}-${String(index)}`
    used.add(name)
    return name
  }
  // この PC のアドレスを選んだときは、同じ PC の Unity が返信先を 127.0.0.1 にしていると pong とエコーがループバックから届く
  const ownAddresses = new Set(subnets.map(subnet => subnet.address))
  const result: RuntimeTargetSpec[] = []
  for (const host of hosts) {
    const configured = configTargets.filter(target => target.host === host)
    if (configured.length > 0) {
      for (const target of configured) result.push({ ...target, name: uniqueName(target.name), primary: false })
    } else {
      result.push({
        name: uniqueName(`ip-${host.replace(/\./g, '-')}`),
        host,
        sendPort,
        primary: false,
        ...(ownAddresses.has(host) ? { addresses: ['127.0.0.1'] } : {}),
      })
    }
  }
  const configPrimary = configTargets.find(target => target.primary)
  const primaryIndex = Math.max(0, result.findIndex(target => configPrimary !== undefined
    && target.host === configPrimary.host && target.sendPort === configPrimary.sendPort))
  return result.map((target, index) => ({ ...target, primary: index === primaryIndex }))
}

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
  let closed = false

  const apply = () => {
    const targets = resolveDestinationTargets({ selection, configTargets: deps.configTargets, subnets, sendPort: deps.sendPort })
    if (targets === null) {
      // 保存した選択は消さない(NIC が戻れば次の走査・再起動でまた効く)
      logWarn('(WARN, BRIDGE)', selection?.allDevices === true
        ? 'Destinations: "all devices" needs an IPv4 network interface; using the config targets for now.'
        : 'Destinations: no selectable host in the saved selection; using the config targets for now.')
      deps.applyTargets(deps.configTargets.map(target => ({ ...target })))
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
      : { source: 'saved', allDevices: selection.allDevices, hosts: [...selection.hosts] },
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

  const broadcastKey = (list: readonly ScanSubnet[]) => list.map(subnet => `${subnet.broadcast}/${String(subnet.maskInt)}`).join(',')

  const scan = (): Promise<void> => {
    if (inFlight !== null) return inFlight
    const scanning = (async () => {
      const subnetsNow = scanSubnets(deps.interfaces())
      let timer: TimerHandle | null = null
      try {
        const timeout = new Promise<never>((_resolve, rejectTimeout) => {
          timer = setTimeoutFn(() => rejectTimeout(new Error(`timed out after ${String(deps.scanTimeoutMs)} ms`)), deps.scanTimeoutMs)
        })
        const found = await Promise.race([deps.prober.probe(subnetsNow), timeout])
        if (closed) return
        const broadcastsChanged = broadcastKey(subnets) !== broadcastKey(subnetsNow)
        subnets = subnetsNow
        neighbors = found
        scannedAt = now()
        logInfo('(INFO, BRIDGE)', `LAN scan found ${String(found.length)} device(s) on ${subnetsNow.map(subnet => subnet.network).join(', ') || 'no IPv4 network'}.`)
        // 全てのデバイスはネットワークのブロードキャストアドレスへ送るので、NIC の差し替えで宛先が変わる
        if (selection?.allDevices === true && broadcastsChanged) apply()
      } catch (error) {
        if (closed) return
        const detail = error instanceof Error ? error.message : String(error)
        logWarn('(WARN, BRIDGE)', `LAN scan failed: ${detail}`)
        deps.publish({ v: 1, type: 'notice', level: 'warn', code: 'destinations-scan-failed', detail })
      } finally {
        if (timer !== null) clearTimeoutFn(timer)
      }
    })()
    inFlight = scanning.finally(() => {
      inFlight = null
      publish()
    })
    // 走査中であることを先に配る(更新ボタンを押した UI に「走査中」を出す)
    publish()
    return inFlight
  }

  const select = (frameIn: Extract<DestinationsUpstream, { type: 'destinationsSelect' }>, clientId: ClientId) => {
    const hosts = [...new Set(frameIn.hosts)]
    const invalid = hosts.find(host => !isSelectableHost(host, deps.configTargets))
    if (invalid !== undefined) return reject(clientId, `invalid-host: ${invalid}`)
    if (!frameIn.allDevices && hosts.length === 0) return reject(clientId, 'empty-selection')
    if (frameIn.allDevices && subnets.length === 0) return reject(clientId, 'no-broadcast-network')
    selection = { allDevices: frameIn.allDevices, hosts }
    deps.store.save(selection)
    apply()
    publish()
  }

  return {
    start() {
      const saved = deps.store.load()
      if (saved !== null) {
        const hosts = saved.hosts.filter(host => isSelectableHost(host, deps.configTargets))
        if (hosts.length !== saved.hosts.length) {
          logWarn('(WARN, BRIDGE)', `Destinations: ignored ${String(saved.hosts.length - hosts.length)} saved host(s) that are neither IPv4 addresses nor config targets.`)
        }
        selection = { allDevices: saved.allDevices, hosts }
        logInfo('(INFO, BRIDGE)', `Restored destinations from "${deps.store.file}".`)
      }
      subnets = scanSubnets(deps.interfaces())
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
        deps.store.clear()
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
    },
  }
}
