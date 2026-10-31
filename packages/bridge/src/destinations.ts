import type { DestinationsFrame, DownstreamFrame, UpstreamFrame } from '@oscdesk/shared'

import type { DestinationSelection, DestinationSelectionStore } from './destinations-file'
import {
  aliasFor,
  createMemoryDeviceAliasStore,
  followMacs,
  isAliasableHost,
  lastSeenMacs,
  normalizeAlias,
  updateAliases,
  type DeviceAliases,
  type DeviceAliasStore,
} from './device-aliases'
import type { HostnameResolver } from './hostname-lookup'
import { intToIpv4, ipv4ToInt, isUnicastIpv4 } from './ipv4'
import { inScanRanges, localIpv4Addresses, scopedScanSubnets, selectNeighbors, subnetOf, subnetsContaining, type LanProber, type Neighbor, type ScanInterface, type ScanScope, type ScanSubnet } from './lan-scan'
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

type DestinationsUpstream = Extract<UpstreamFrame, { type: 'destinationsScan' | 'destinationsSelect' | 'destinationsReset' | 'destinationsAlias' }>
type LogFn = (message?: unknown, ...optionalParams: unknown[]) => void
type TimerHandle = ReturnType<typeof setTimeout> | number

export interface Destinations {
  /** 保存した選択を読んで宛先を決める(走査はしない)。 */
  start(): void
  /** 宛先タブのフレームなら処理して true。 */
  handleUiFrame(frame: UpstreamFrame, clientId: ClientId): boolean
  /** destinations の全量を配る(clientId を省くと全 UI)。 */
  publish(clientId?: ClientId): void
  /**
   * 走査の範囲(D-113。ターゲット向けのネットワーク・ターゲットがいる範囲)が変わったときに呼ぶ。走査はせずに、
   * 今のネットワークから走査ネットワークを決め直し、選択を検証し直して宛先と一覧を更新する
   */
  rescope(): void
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
  // ネットワークは重なり得る(/8 の VPN と /24 の LAN など)。OS は狭い方の経路で送るので、10.1.2.255 は /8 では普通のホストでも
  // /24 ではブロードキャストになる。当てはまるネットワークすべてと照合し、どれかのネットワーク・ブロードキャストアドレスなら断る
  const containing = subnetsContaining(host, subnets)
  // ターゲットがいる範囲(D-113)を決めていれば、その中のホストだけを選べる
  return containing.length > 0 && containing.every(subnet => value !== subnet.networkInt && value !== ipv4ToInt(subnet.broadcast))
    && containing.some(subnet => inScanRanges(host, subnet))
}

/**
 * 選択から実際の宛先を決める(純粋関数)。選択が null(未保存)なら設定ファイルの宛先そのもの。
 * 選べない選択(全てのデバイスなのにネットワークが無い・選べるホストが残らない)は null を返し、呼び出し側が設定の宛先に戻す。
 *
 * - 全てのデバイス: 走査ネットワークごとのブロードキャストアドレス(先頭が主系)。ポートは unity.sendPort
 * - ネットワークごとの全てのデバイス(D-085): 選んだネットワークのブロードキャストアドレス(`net-a-b-c-d-prefix`)。
 *   そのネットワークの中のホストは、unity.sendPort で送るものは個別に送らない(ブロードキャストと二重に届くため)
 * - 端末の選択: 設定ファイルにあるホストはその宛先(名前・sendPort)をそのまま使い、それ以外は `ip-a-b-c-d` の宛先にする。
 * 並びはブロードキャストの宛先が先。主系は設定の主系が個別の宛先に残っていればそれ、設定の主系が選んだネットワークの中なら
 * そのネットワークの宛先、どちらでもなければ先頭
 */
export function resolveDestinationTargets(input: {
  selection: DestinationSelection | null
  configTargets: readonly ConfigTarget[]
  subnets: readonly ScanSubnet[]
  sendPort: number
  /** この PC の IPv4 アドレス(自ホストの判定用。走査の絞り込み前の全部)。省くと走査ネットワークの自分のアドレス */
  ownAddresses?: ReadonlySet<string>
}): RuntimeTargetSpec[] | null {
  const { selection, configTargets, subnets, sendPort } = input
  const own = input.ownAddresses ?? new Set(subnets.map(subnet => subnet.address))
  // 選択が無い間も、この PC を指す config の宛先にはループバックの別名を足す(選び直したときと同じ規則)
  if (selection === null) return configTargets.map(target => ({ ...target, addresses: withLoopbackAlias(target.host, target.addresses, own) }))
  // ブロードキャストはこの PC 自身にも届く。同じ PC の Unity は返信先にしたこの PC のどの NIC のアドレスからも答えるので、
  // ブロードキャストの宛先にこの PC のアドレスを持たせ、そこからの pong も受けさせる(D-085)
  const ownAddresses = [...own]
  if (selection.allDevices) {
    if (subnets.length === 0) return null
    return subnets.map((subnet, index) => ({
      name: index === 0 ? ALL_DEVICES_TARGET_NAME : `${ALL_DEVICES_TARGET_NAME}-${String(index + 1)}`,
      host: subnet.broadcast,
      sendPort,
      primary: index === 0,
      ...(ownAddresses.length > 0 ? { addresses: ownAddresses } : {}),
      broadcast: { networkInt: subnet.networkInt, maskInt: subnet.maskInt },
    }))
  }
  const networks = subnets.filter(subnet => selection.networks.includes(subnet.network))
  // ホスト名の設定の宛先は、名前解決したアドレスでもネットワークの中か見る(見ないとブロードキャストと二重に届き、きっかけが 2 回撃たれる)
  // ネットワークが重なる(/8 の VPN と /24 の LAN など)と OS は最も狭い経路で送るので、広い方のブロードキャストは狭い方の端末に届かない。
  // 届くと見なすのは、そのアドレスを含む走査ネットワークのうち最も狭いものが選んだネットワークのときだけ(個別に送る端末を取りこぼさない。HID-325)
  const reaches = (address: string, subnet: ScanSubnet) => {
    const narrowest = narrowestSubnet(address, subnets)
    // 狭いネットワークのブロードキャストアドレスが選んだネットワークのものと同じで、そのアドレスが選んだネットワークの中にあるなら、同じ宛先へ出るので二重に届く(個別には送らない)。
    // 選んだ狭いネットワークの外の端末は、同じアドレスのブロードキャストが狭い側へ出るので届かない
    return narrowest !== undefined && (subnet.network === narrowest.network || (subnet.broadcast === narrowest.broadcast && inSubnet(address, subnet)))
  }
  const inNetworks = (host: string, addresses: readonly string[] = []) =>
    [host, ...addresses].some(address => networks.some(subnet => reaches(address, subnet)))
  // この PC を指す宛先(ループバック・この PC のどの NIC のアドレスも)は、どのネットワークを選んでも届く。ブリッジが送った
  // ブロードキャストはこの PC 自身にも届き(D-079)、0.0.0.0 で待つ同じ PC の Unity が受けるため。個別にも送ると 2 回撃たれる
  const isThisPc = (host: string, addresses: readonly string[] = []) =>
    [host, ...addresses].some(address => own.has(address) || isLoopbackIpv4(address))
  const covered = (host: string, port: number, addresses?: readonly string[]) =>
    port === sendPort && networks.length > 0 && (inNetworks(host, addresses) || isThisPc(host, addresses))
  const hosts = [...new Set(selection.hosts)].filter(host => isSelectableHost(host, configTargets, subnets))
  if (hosts.length === 0 && networks.length === 0) return null
  const used = new Set<string>()
  const uniqueName = (base: string) => {
    let name = base
    for (let index = 2; used.has(name); index += 1) name = `${base}-${String(index)}`
    used.add(name)
    return name
  }
  // 設定の宛先の名前を先に予約する。生成名(ip-*)を host の順に割り当てると、`ip-192-168-1-40` と名付けた設定の宛先が
  // 後ろに並んだとき生成名に先を越されて `-2` に改名され、設定の宛先は名前を保つ契約が破れるため
  interface Slot { host: string; target: ConfigTarget | null; name: string }
  const slots = hosts.flatMap((host): Slot[] => {
    const configured = configTargets.filter(target => target.host === host && !covered(host, target.sendPort, target.addresses))
    if (configured.length > 0) return configured.map(target => ({ host, target, name: uniqueName(target.name) }))
    if (configTargets.some(target => target.host === host) || covered(host, sendPort)) return []
    return [{ host, target: null, name: '' }]
  })
  const broadcastTargets: RuntimeTargetSpec[] = networks.map(subnet => ({
    name: uniqueName(`net-${subnet.network.replace(/[./]/g, '-')}`),
    host: subnet.broadcast,
    sendPort,
    primary: false,
    ...(ownAddresses.length > 0 ? { addresses: ownAddresses } : {}),
    broadcast: { networkInt: subnet.networkInt, maskInt: subnet.maskInt },
  }))
  const unicastTargets: RuntimeTargetSpec[] = slots.map(slot => {
    if (slot.target !== null) {
      return { ...slot.target, name: slot.name, primary: false, addresses: withLoopbackAlias(slot.target.host, slot.target.addresses, own) }
    }
    const addresses = withLoopbackAlias(slot.host, [], own)
    return {
      name: uniqueName(`ip-${slot.host.replace(/\./g, '-')}`),
      host: slot.host,
      sendPort,
      primary: false,
      ...(addresses.length > 0 ? { addresses } : {}),
    }
  })
  const result = [...broadcastTargets, ...unicastTargets]
  if (result.length === 0) return null
  const configPrimary = configTargets.find(target => target.primary)
  const unicastPrimary = result.findIndex(target => configPrimary !== undefined && target.broadcast === undefined
    && target.host === configPrimary.host && target.sendPort === configPrimary.sendPort)
  const networkPrimary = configPrimary === undefined
    ? -1
    : networks.findIndex(subnet => [configPrimary.host, ...configPrimary.addresses].some(address => reaches(address, subnet)))
  const primaryIndex = unicastPrimary >= 0 ? unicastPrimary : Math.max(0, networkPrimary)
  return result.map((target, index) => ({ ...target, primary: index === primaryIndex }))
}

function isLoopbackIpv4(host: string): boolean {
  const value = ipv4ToInt(host)
  return value !== null && value >>> 24 === 127
}

/** そのアドレスを含む走査ネットワークのうち最も狭いもの(プレフィックスが最長。同じ長さなら先に並ぶもの)。 */
function narrowestSubnet(host: string, subnets: readonly ScanSubnet[]): ScanSubnet | undefined {
  return subnetsContaining(host, subnets).reduce<ScanSubnet | undefined>(
    (best, subnet) => (best === undefined || subnet.maskInt > best.maskInt ? subnet : best),
    undefined,
  )
}

function inSubnet(host: string, subnet: ScanSubnet): boolean {
  const value = ipv4ToInt(host)
  return value !== null && ((value & subnet.maskInt) >>> 0) === subnet.networkInt
}

/**
 * 宛先が受ける送信元アドレス(名前解決済みのアドレス)に、この PC 宛てならループバックの別名を足す。
 * 同じ PC の Unity は返信先を 127.0.0.1 にしているとループバックから pong とエコーを返すので、足さないと
 * 到達不能のまま保持値も再送されない。host がこの PC の LAN アドレスのとき・host の名前解決先にこの PC のアドレスがあるときの
 * どちらも当てる(個別に選んだ端末と、選び直した config の宛先(主系・副系)で同じ規則にする)。
 * own は走査の対象に絞る前の、この PC の全 IPv4 アドレス(localIpv4Addresses)。走査用に絞った一覧(リンクローカル・/31・/32・
 * 5 つ目以降の NIC を除く)で判定すると、それらのアドレスへ解決される宛先に別名が付かないため
 */
export function withLoopbackAlias(host: string, addresses: readonly string[], own: ReadonlySet<string>): string[] {
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
  /** 引けた端末の名前(D-085)。省くと名前なし */
  hostnames?: ReadonlyMap<string, string>
  /** この PC の名前(OS のホスト名)。省くと名前なし */
  localHostname?: string | null
  /** UI から付けた端末の別名(D-092)。省くと別名なし */
  aliases?: DeviceAliases
  /**
   * 直近の走査に出なかった端末の、最後に分かった MAC(ホスト → MAC。D-092)。走査に出ない間(電源断・再起動直後の初回走査前)も
   * MAC で覚えた別名を出すため。省くと補わない
   */
  knownMacs?: ReadonlyMap<string, string>
}): DestinationsFrame['devices'] {
  const devices = new Map<string, DestinationsFrame['devices'][number]>()
  const upsert = (host: string, patch: Partial<DestinationsFrame['devices'][number]>) => {
    const current = devices.get(host) ?? {
      host,
      hostname: input.hostnames?.get(host) ?? null,
      alias: null,
      mac: input.knownMacs?.get(host) ?? null,
      interface: subnetOf(host, input.subnets)?.interface ?? null,
      self: false,
      configured: false,
      found: false,
    }
    devices.set(host, { ...current, ...patch })
  }
  for (const neighbor of input.neighbors) upsert(neighbor.host, { mac: neighbor.mac ?? input.knownMacs?.get(neighbor.host) ?? null, found: true })
  // この PC は ARP 表に出ないが、同じ PC の Unity へ送る構成があるので自分のアドレスも並べる
  // この PC の MAC は ARP 表に無いので NIC の MAC を使う(この PC にも MAC で別名を付けられるように。D-092)
  for (const subnet of input.subnets) {
    upsert(subnet.address, {
      self: true, found: true, mac: subnet.mac ?? input.knownMacs?.get(subnet.address) ?? null,
      ...(input.localHostname ? { hostname: input.localHostname } : {}),
    })
  }
  for (const target of input.configTargets) upsert(target.host, { configured: true })
  for (const host of input.selectedHosts) upsert(host, {})
  const aliases = input.aliases ?? new Map()
  return [...devices.values()].map(device => ({ ...device, alias: aliasFor(aliases, device.host, device.mac) })).sort(compareHosts)
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
  /** 端末の名前を引く(D-085)。省くと名前を引かない */
  hostnameResolver?: HostnameResolver
  /** この PC の名前(OS のホスト名)。省くと名前なし */
  localHostname?: () => string | null
  store: DestinationSelectionStore
  /** 端末の別名の保存先(D-092)。省くと別名は実行中だけ覚える */
  aliasStore?: DeviceAliasStore
  scanTimeoutMs: number
  /** 走査の範囲(D-113)。省くと自動(この PC のネットワークそのまま) */
  scanScope?: () => ScanScope
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
  const scopeOf = deps.scanScope ?? (() => ({ targetInterface: null, targetRanges: [] }))
  const subnetsFrom = (interfaces: readonly ScanInterface[]) => scopedScanSubnets(interfaces, scopeOf())
  let selection: DestinationSelection | null = null
  let subnets: ScanSubnet[] = []
  // この PC の全 IPv4 アドレス(自ホストの判定。走査の対象とは分ける)
  let ownAddresses: ReadonlySet<string> = new Set()
  let neighbors: readonly Neighbor[] = []
  // 引けた端末の名前。走査のたびに引き直し、引き終わらなかったホストは前回の名前を保つ
  const hostnames = new Map<string, string>()
  let scannedAt: number | null = null
  let inFlight: Promise<void> | null = null
  let abortScan: ((reason: Error) => void) | null = null
  let closed = false
  // 選択をファイルへ書けたか。書けなかった選択は実行中だけ効くので、保存済み(saved)としては配らない(unsaved)
  let persisted = true
  const aliasStore = deps.aliasStore ?? createMemoryDeviceAliasStore()
  let aliases: DeviceAliases = new Map()
  // この実行中の走査で分かったホスト → MAC(D-092)。走査に出なくなった端末の MAC を補う。別名の無い端末も持つのは、
  // その端末が走査に出ていない間に名前を付けても MAC で覚えるため。ブリッジを再起動すると、別名の表の
  // 「最後に見えたホスト」(lastSeenMacs)だけが残る
  const sessionMacs = new Map<string, string>()

  const knownMacs = (): Map<string, string> => new Map([...lastSeenMacs(aliases), ...sessionMacs])

  const rememberMacs = (seen: readonly { host: string; mac: string | null }[]) => {
    for (const { host, mac } of seen) {
      if (mac === null) continue
      // 同じ MAC が別のホストへ移ったら、前のホストの MAC は忘れる(そのホストには今は別の端末がいるかもしれない)
      for (const [other, otherMac] of sessionMacs) if (otherMac === mac && other !== host) sessionMacs.delete(other)
      sessionMacs.set(host, mac)
    }
    const followed = followMacs(aliases, seen)
    if (followed.changed) {
      aliases = followed.aliases
      // 最後に見えたホストは表示の補助なので、書けなくても通知はしない(store が警告ログを出す)
      aliasStore.save(aliases)
    }
  }

  /** 一覧に出ている端末か(別名を付けられる端末)。一覧を作らずに判定する。 */
  const isListed = (host: string) => neighbors.some(neighbor => neighbor.host === host)
    || subnets.some(subnet => subnet.address === host)
    || deps.configTargets.some(target => target.host === host)
    || (selection?.hosts.includes(host) ?? false)

  /** 別名のキーに使う MAC。今の走査の MAC、この PC は NIC の MAC、どちらも無ければ最後に分かった MAC。 */
  const macOf = (host: string): string | null => neighbors.find(neighbor => neighbor.host === host)?.mac
    ?? subnets.find(subnet => subnet.address === host)?.mac
    ?? sessionMacs.get(host)
    ?? lastSeenMacs(aliases).get(host)
    ?? null

  // 選択をこの PC の今のネットワークで検証し直す(保存した選択の復元と、走査でネットワークが変わったとき。D-078)。
  // 外れたホストは警告して落とし、個別の選択が全部落ちたら null(設定ファイルの宛先)にする。ファイルは書き換えない
  // (NIC が一時的に落ちていただけなら、次の起動で戻せるように)
  const revalidate = (candidate: DestinationSelection, context: string): DestinationSelection | null => {
    const hosts = candidate.hosts.filter(host => isSelectableHost(host, deps.configTargets, subnets))
    const dropped = candidate.hosts.filter(host => !hosts.includes(host))
    if (dropped.length > 0) {
      logWarn('(WARN, BRIDGE)', `Destinations (${context}): dropped host(s) outside the local networks and the config targets: ${dropped.join(', ')}.`)
    }
    const known = new Set(subnets.map(subnet => subnet.network))
    const networks = candidate.networks.filter(network => known.has(network))
    const droppedNetworks = candidate.networks.filter(network => !known.has(network))
    if (droppedNetworks.length > 0) {
      logWarn('(WARN, BRIDGE)', `Destinations (${context}): dropped network(s) this PC is no longer on: ${droppedNetworks.join(', ')}.`)
    }
    if (!candidate.allDevices && hosts.length === 0 && networks.length === 0) {
      logWarn('(WARN, BRIDGE)', `Destinations (${context}): no selectable host or network left; using the config targets.`)
      return null
    }
    return { allDevices: candidate.allDevices, networks, hosts }
  }

  const apply = () => {
    const targets = resolveDestinationTargets({ selection, configTargets: deps.configTargets, subnets, sendPort: deps.sendPort, ownAddresses })
    if (targets === null) {
      // 保存した選択は消さない(NIC が戻れば次の走査・再起動でまた効く)
      logWarn('(WARN, BRIDGE)', selection?.allDevices === true
        ? 'Destinations: "all devices" needs an IPv4 network interface; using the config targets for now.'
        : 'Destinations: no selectable host in the saved selection; using the config targets for now.')
      deps.applyTargets(resolveDestinationTargets({ selection: null, configTargets: deps.configTargets, subnets, sendPort: deps.sendPort, ownAddresses })!)
      return
    }
    deps.applyTargets(targets)
  }

  const devices = () => listDevices({
    neighbors, subnets, configTargets: deps.configTargets, selectedHosts: selection?.hosts ?? [], hostnames,
    localHostname: deps.localHostname?.() ?? null, aliases, knownMacs: knownMacs(),
  })

  const frame = (): DownstreamFrame => ({
    v: 1,
    type: 'destinations',
    sendPort: deps.sendPort,
    scanning: inFlight !== null,
    scannedAt: scannedAt === null ? null : new Date(scannedAt).toISOString(),
    devices: devices(),
    broadcasts: subnets.map(subnet => ({ address: subnet.broadcast, interface: subnet.interface, network: subnet.network })),
    // 未保存の間は設定の宛先のホストを選択中として見せる(チェックを足し引きした結果がそのまま新しい選択になる)
    selection: selection === null
      ? { source: 'config', allDevices: false, networks: [], hosts: configHosts }
      : { source: persisted ? 'saved' : 'unsaved', allDevices: selection.allDevices, networks: [...selection.networks], hosts: [...selection.hosts] },
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

  // 範囲(D-113)も含める。ネットワークが同じでも範囲が変われば、選べるホストが変わるので選択を検証し直す
  const networksKey = (list: readonly ScanSubnet[]) => list.map(subnet => `${String(subnet.networkInt)}/${String(subnet.maskInt)}${(subnet.ranges ?? []).map(range => `:${String(range.networkInt)}/${String(range.maskInt)}`).join('')}`).join(',')
  const addressesKey = (own: ReadonlySet<string>) => [...own].sort().join(',')
  const saveFailed = (detail: string) => {
    // 選択はどの UI から見ても同じなので、保存の失敗も全 UI へ知らせる
    deps.publish({ v: 1, type: 'notice', level: 'error', code: 'destinations-save-failed', detail })
  }

  // 走査の後に端末の名前を引く。走査の時間切れとは別の上限(resolver の budget)で打ち切り、失敗しても走査は失敗にしない
  // (名前は表示の補助で、引けなくても宛先は選べるため)。close で中断する
  let abortLookup: (() => void) | null = null
  const lookupHostnames = async () => {
    if (deps.hostnameResolver === undefined) return
    const own = new Set(subnets.map(subnet => subnet.address))
    const targets = [...new Set([
      ...neighbors.map(neighbor => neighbor.host),
      ...(selection?.hosts ?? []),
      ...configHosts,
    ])].filter(host => !own.has(host) && ipv4ToInt(host) !== null)
    const controller = new AbortController()
    abortLookup = () => controller.abort(new Error('bridge is closing'))
    try {
      const results = await deps.hostnameResolver.resolve(targets, controller.signal)
      if (closed) return
      for (const [host, name] of results) {
        if (name === null) hostnames.delete(host)
        else hostnames.set(host, name)
      }
    } catch (error) {
      logWarn('(WARN, BRIDGE)', `Hostname lookup failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      abortLookup = null
    }
  }

  const scan = (): Promise<void> => {
    if (inFlight !== null) return inFlight
    // 時間切れと close は走査器まで中断を通す(ラッパだけを終わらせると、走査が裏で続いて次の走査と重なり、
    // 終了後もタイマー・ソケット・子プロセスが Node を生かし続けるため)。走査器が中断を受けて終わるまで inFlight を残す
    const controller = new AbortController()
    abortScan = reason => controller.abort(reason)
    const scanning = (async () => {
      const interfacesNow = deps.interfaces()
      const subnetsAtStart = subnetsFrom(interfacesNow)
      const ownNow = localIpv4Addresses(interfacesNow)
      const timer = setTimeoutFn(
        () => controller.abort(new Error(`timed out after ${String(deps.scanTimeoutMs)} ms`)),
        deps.scanTimeoutMs,
      )
      try {
        const probed = await deps.prober.probe(subnetsAtStart, controller.signal)
        // 中断を受けても結果を返してしまう走査器の結果は使わない
        controller.signal.throwIfAborted()
        if (closed) return
        // 走査の間に範囲(D-113)が変わっていれば、今の範囲で決め直して結果も絞る(古い範囲の結果で上書きしない)
        const subnetsNow = subnetsFrom(interfacesNow)
        const found = selectNeighbors(probed, subnetsNow)
        const networksChanged = networksKey(subnets) !== networksKey(subnetsNow)
        // 同じネットワークのまま DHCP でこの PC のアドレスだけが変わることもある(ループバックの別名を付ける宛先が変わる)
        const ownChanged = addressesKey(ownAddresses) !== addressesKey(ownNow)
        subnets = subnetsNow
        ownAddresses = ownNow
        neighbors = found
        rememberMacs([...found, ...subnetsNow.map(subnet => ({ host: subnet.address, mac: subnet.mac ?? null }))])
        scannedAt = now()
        logInfo('(INFO, BRIDGE)', `LAN scan found ${String(found.length)} device(s) on ${subnetsNow.map(subnet => subnet.network).join(', ') || 'no IPv4 network'}.`)
        // NIC の差し替えでネットワークが変わったら、全てのデバイス(ブロードキャストアドレス)も個別の選択(ネットワークの中か)も
        // 決め直す。個別の選択を検証し直さないと、もう選べない旧ネットワークのホストへ送り続ける
        if (networksChanged && selection !== null) selection = revalidate(selection, 'network changed')
        if (networksChanged || ownChanged) apply()
        clearTimeoutFn(timer)
        await lookupHostnames()
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
    const networks = [...new Set(frameIn.networks)]
    const unknownNetwork = networks.find(network => !subnets.some(subnet => subnet.network === network))
    if (unknownNetwork !== undefined) return reject(clientId, `invalid-network: ${unknownNetwork}`)
    if (!frameIn.allDevices && hosts.length === 0 && networks.length === 0) return reject(clientId, 'empty-selection')
    if (frameIn.allDevices && subnets.length === 0) return reject(clientId, 'no-broadcast-network')
    selection = { allDevices: frameIn.allDevices, networks, hosts }
    persisted = deps.store.save(selection)
    if (!persisted) saveFailed(`could not write ${deps.store.file}; the selection lasts until the bridge stops`)
    apply()
    publish()
  }

  // 端末の別名(D-092)。一覧にある端末だけに付けられる(任意の文字列をキーにして表を膨らませないため)。
  // キーの MAC はブリッジが知っている MAC(走査の ARP 表・この PC の NIC・最後に分かった MAC)で、UI からは受け取らない。
  // 最後に分かった MAC も使うのは、端末が走査に出ていない間の改名・消去を MAC の別名へ届かせるため(host の別名だけを
  // 変えると、MAC が分かった後に MAC の古い名前が勝つ)
  const setAlias = (frameIn: Extract<DestinationsUpstream, { type: 'destinationsAlias' }>, clientId: ClientId) => {
    const rejectAlias = (detail: string) => {
      deps.publish({ v: 1, type: 'notice', level: 'error', code: 'destination-alias-rejected', detail }, clientId)
      publish(clientId)
    }
    const host = frameIn.host
    if (!isListed(host)) return rejectAlias(`unknown-host: ${host}`)
    // 制御文字を含む設定のホスト名などは、ファイルから読み戻せないキーになるので受けない
    if (!isAliasableHost(host)) return rejectAlias(`unaliasable-host: ${host}`)
    const normalized = normalizeAlias(frameIn.alias)
    if (!normalized.ok) return rejectAlias(normalized.reason)
    const updated = updateAliases(aliases, host, macOf(host), normalized.alias)
    if (!updated.ok) return rejectAlias(updated.reason)
    aliases = updated.aliases
    if (!aliasStore.save(aliases)) {
      deps.publish({
        v: 1, type: 'notice', level: 'error', code: 'destination-aliases-save-failed',
        detail: `could not write ${aliasStore.file}; the device names last until the bridge stops`,
      })
    }
    publish()
  }

  return {
    start() {
      const interfaces = deps.interfaces()
      subnets = subnetsFrom(interfaces)
      ownAddresses = localIpv4Addresses(interfaces)
      aliases = aliasStore.load()
      if (aliases.size > 0) logInfo('(INFO, BRIDGE)', `Restored ${String(aliases.size)} device name(s) from "${aliasStore.file}".`)
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
      if (frameIn.type === 'destinationsAlias') {
        setAlias(frameIn, clientId)
        return true
      }
      return false
    },
    publish,
    rescope() {
      const interfaces = deps.interfaces()
      const subnetsNow = subnetsFrom(interfaces)
      const ownNow = localIpv4Addresses(interfaces)
      const changed = networksKey(subnets) !== networksKey(subnetsNow) || addressesKey(ownAddresses) !== addressesKey(ownNow)
      subnets = subnetsNow
      ownAddresses = ownNow
      // 範囲の外になった端末は一覧から外す(次の走査を待たない)
      neighbors = selectNeighbors(neighbors, subnets)
      if (changed) {
        if (selection !== null) selection = revalidate(selection, 'target range changed')
        apply()
      }
      publish()
    },
    scan,
    close() {
      closed = true
      abortScan?.(new Error('bridge is closing'))
      abortLookup?.()
    },
  }
}
