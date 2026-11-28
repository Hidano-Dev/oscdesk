import type { DestinationEndpoint, DestinationsFrame, DownstreamFrame, UpstreamFrame } from '@oscdesk/shared'

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
import { intToIpv4, ipv4ToInt, isUnicastIpv4 } from './ipv4'
import { inScanRanges, localIpv4Addresses, scanSubnets, scopedScanSubnets, subnetOf, subnetsContaining, type ScanInterface, type ScanScope, type ScanSubnet } from './lan-subnets'
import type { BroadcastNetwork, ClientId, RuntimeTargetSpec } from './surface-core'

// 宛先タブ(D-078)。宛先の選択・選択の保存・端末の別名を受け持ち、実際の送信先は surface-core の setTargets で差し替える。
// 端末の一覧はこの PC・設定の宛先・選んだホスト・OSCQuery で見つけたターゲット(D-168)。LAN の走査は撤去した(D-175)。
// ファイル・時計は引数で受け取り、単体テストを実ネットワークとディスクに依存させない。

export const ALL_DEVICES_TARGET_NAME = 'all-devices'

// ---- ポート(D-134)。実装は adapters/destinations-file と adapters/hostname-lookup ----

export interface DestinationSelection {
  /** 「全てのデバイス」(ブロードキャスト)。true の間も networks と hosts は外したときに戻すために持つ。 */
  allDevices: boolean
  /** ネットワークごとの「全てのデバイス」(CIDR 表記。D-085) */
  networks: string[]
  hosts: string[]
  /**
   * OSCQuery のターゲット(D-168)を、ホストと OSC の受信ポート(HOST_INFO の OSC_PORT)の組で選んだもの。同じ PC の複数のアプリは
   * ポートで区別する。ポートは選んだ時点のものを持って保存するので、発見の情報が一時的に消えても(mDNS の取りこぼし・再起動直後で
   * OSCQuery をまだ読んでいない)送り先は変わらない。省略は空
   */
  endpoints?: DestinationEndpoint[]
}

export interface DestinationSelectionStore {
  readonly file: string
  /** 無ければ null(警告なし)。壊れていれば警告して null(設定ファイルの宛先で起動する)。 */
  load(): DestinationSelection | null
  /** 書けなければ警告して false(選択は実行中だけ効く)。 */
  save(selection: DestinationSelection): boolean
  /** 保存した選択を消す(設定ファイルの宛先へ戻す)。消せなければ警告して false。 */
  clear(): boolean
}

/** 設定ファイルの宛先(主系 + 副系。D-046)。addresses は host がホスト名のときの名前解決済みアドレス。 */
export interface ConfigTarget {
  readonly name: string
  readonly host: string
  readonly sendPort: number
  readonly primary: boolean
  readonly addresses: readonly string[]
}

type DestinationsUpstream = Extract<UpstreamFrame, { type: 'destinationsSelect' | 'destinationsReset' | 'destinationsAlias' }>
type LogFn = (message?: unknown, ...optionalParams: unknown[]) => void

export interface Destinations {
  /** 保存した選択を読んで宛先を決める。 */
  start(): void
  /** 宛先タブのフレームなら処理して true。 */
  handleUiFrame(frame: UpstreamFrame, clientId: ClientId): boolean
  /** destinations の全量を配る(clientId を省くと全 UI)。 */
  publish(clientId?: ClientId): void
  /**
   * この PC のネットワーク・範囲(D-113。ターゲット向けのネットワーク・ターゲットがいる範囲)を読み直す。範囲を変えたときと、
   * 宛先パネルの「探し直す」(後から足した NIC・DHCP で変わったアドレス)で呼ぶ。変わったときだけ選択を検証し直して宛先と一覧を更新し、
   * 全 UI へ配り直す(「探し直す」を繰り返し押されても、変わらなければ全 UI への配信を増やさない)。変わったかを返す
   */
  rescope(): boolean
  /** OSCQuery で見つけたターゲット(discovered)が変わったときに呼ぶ(D-168) */
  discoveredChanged(): void
  close(): void
}

/**
 * 個別の端末として選べるホストか(D-078)。次のどちらかだけを通す。
 * - 設定ファイルにある宛先のホスト(ホスト名・ループバックを含む。設定を書いた人が決めた宛先なので信頼する)
 * - この PC の有効なネットワーク(この PC 自身のアドレスを含む)の中のユニキャストアドレス。
 *   ネットワークアドレス・ブロードキャストアドレス(例 192.168.1.0 / .255)は除く
 * UI は認証なしで誰でも送れるので、ここで縛らないと公開アドレス・ループバック・別ネットワークのディレクテッドブロードキャストへ
 * OSC を送らせ、それを保存して起動のたびの宛先にできてしまう。ネットワーク・ブロードキャストアドレスを通すと
 * 「全てのデバイス」の扱い(D-079 の pong の受け方・ユニキャストの再送)を経ずにブロードキャストになる。
 * 見つかった端末かどうかでは縛らない(再起動直後はまだ見つかっておらず、保存した選択を戻せなくなるため)。
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
  // 走査の範囲で外した NIC のネットワーク・ブロードキャストアドレス(reserved)も断る(外した狭い LAN の .255 を通さないため)
  return containing.length > 0
    && containing.every(subnet => value !== subnet.networkInt && value !== ipv4ToInt(subnet.broadcast) && subnet.reserved?.includes(value) !== true)
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
  /**
   * ブロードキャストが届くかの判定に使う、走査の範囲(D-113)で絞る前のこの PC のすべてのネットワーク。省くと subnets。
   * 絞った後のネットワークだけで最も狭い経路を決めると、外した狭い LAN の端末が広い VPN のブロードキャストで届くと誤って見なされ、個別の宛先から消えるため
   */
  reachSubnets?: readonly ScanSubnet[]
}): RuntimeTargetSpec[] | null {
  const { selection, configTargets, subnets, sendPort } = input
  const own = input.ownAddresses ?? new Set(subnets.map(subnet => subnet.address))
  // 選択が無い間も、この PC を指す config の宛先にはループバックの別名を足す(選び直したときと同じ規則)
  if (selection === null) return configTargets.map(target => ({ ...target, addresses: withLoopbackAlias(target.host, target.addresses, own) }))
  // ブロードキャストはこの PC 自身にも届く。同じ PC の Unity は返信先にしたこの PC のどの NIC のアドレスからも答えるので、
  // ブロードキャストの宛先にこの PC のアドレスを持たせ、そこからの pong も受けさせる(D-085)
  const ownAddresses = [...own]
  // 全てのデバイスは、すべての走査ネットワークを選んだのと同じ届き方をする(OSCQuery のターゲットの判定に使う)
  const networks = selection.allDevices ? subnets : subnets.filter(subnet => selection.networks.includes(subnet.network))
  // ホスト名の設定の宛先は、名前解決したアドレスでもネットワークの中か見る(見ないとブロードキャストと二重に届き、きっかけが 2 回撃たれる)
  // ネットワークが重なる(/8 の VPN と /24 の LAN など)と OS は最も狭い経路で送るので、広い方のブロードキャストは狭い方の端末に届かない。
  // 届くと見なすのは、そのアドレスを含む走査ネットワークのうち最も狭いものが選んだネットワークのときだけ(個別に送る端末を取りこぼさない。HID-325)
  const reaches = (address: string, subnet: ScanSubnet) => {
    const narrowest = narrowestSubnet(address, input.reachSubnets ?? subnets)
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
  const endpoints = uniqueEndpoints(selection.endpoints ?? []).filter(endpoint => isSelectableHost(endpoint.host, configTargets, subnets))
  const used = new Set<string>()
  const uniqueName = (base: string) => {
    let name = base
    for (let index = 2; used.has(name); index += 1) name = `${base}-${String(index)}`
    used.add(name)
    return name
  }
  // OSCQuery のターゲット(D-168)は、ホストと OSC_PORT の組で 1 宛先。同じ PC の複数のアプリはポートで分かれる。
  // 同じホスト・同じポートへほかの選択(設定の宛先・端末の選択・ブロードキャスト)で既に送るなら足さない(2 回撃たれる)
  const endpointTargets = (alsoSentTo: (host: string, port: number) => boolean): RuntimeTargetSpec[] => endpoints
    .filter(endpoint => !covered(endpoint.host, endpoint.port) && !alsoSentTo(endpoint.host, endpoint.port))
    .map(endpoint => {
      const addresses = withLoopbackAlias(endpoint.host, [], own)
      return {
        name: uniqueName(`oq-${endpoint.host.replace(/\./g, '-')}-${String(endpoint.port)}`),
        host: endpoint.host,
        sendPort: endpoint.port,
        primary: false,
        ...(addresses.length > 0 ? { addresses } : {}),
      }
    })
  if (selection.allDevices) {
    if (subnets.length === 0) return null
    const broadcasts: RuntimeTargetSpec[] = subnets.map((subnet, index) => ({
      name: uniqueName(index === 0 ? ALL_DEVICES_TARGET_NAME : `${ALL_DEVICES_TARGET_NAME}-${String(index + 1)}`),
      host: subnet.broadcast,
      sendPort,
      primary: index === 0,
      ...(ownAddresses.length > 0 ? { addresses: ownAddresses } : {}),
      broadcast: { networkInt: subnet.networkInt, maskInt: subnet.maskInt },
    }))
    // ブロードキャストは unity.sendPort にしか届かないので、別のポートの OSCQuery のターゲットは個別に送る
    return [...broadcasts, ...endpointTargets(() => false)]
  }
  if (hosts.length === 0 && networks.length === 0 && endpoints.length === 0) return null
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
  // ホスト名の設定の宛先(例 unity.local)は、名前解決したアドレス(OSCQuery のターゲットは IP で来る)でも同じ受信先か見る。
  // 見ないと同じアプリへ 2 回送り、きっかけが 2 回撃たれる(HID-496)。この PC を指す宛先が持つループバックの別名も、
  // 同じ PC の同じポートなので同じ受信先として扱う
  const sentTo = (host: string, port: number) => unicastTargets.some(target => target.sendPort === port
    && (target.host === host || target.addresses?.includes(host) === true))
  const result = [...broadcastTargets, ...unicastTargets, ...endpointTargets(sentTo)]
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

/** 重なりを除いた OSCQuery のターゲットの選択(最初に並んだ順) */
export function uniqueEndpoints(endpoints: readonly DestinationEndpoint[]): DestinationEndpoint[] {
  const seen = new Set<string>()
  return endpoints.filter(endpoint => {
    const key = `${endpoint.host}:${String(endpoint.port)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).map(endpoint => ({ host: endpoint.host, port: endpoint.port }))
}

/** OSCQuery のターゲットを選んでいない選択は endpoints を持たない(以前の形のまま保存・比較する) */
function withEndpoints(selection: DestinationSelection, endpoints: readonly DestinationEndpoint[]): DestinationSelection {
  return endpoints.length === 0 ? selection : { ...selection, endpoints: [...endpoints] }
}

/** 一覧に並べる端末(純粋関数)。この PC・OSCQuery で見つけたターゲット・設定の宛先・選択中のホストの和集合を IP の順に並べる。 */
export function listDevices(input: {
  subnets: readonly ScanSubnet[]
  configTargets: readonly ConfigTarget[]
  selectedHosts: readonly string[]
  /** この PC の名前(OS のホスト名)。省くと名前なし */
  localHostname?: string | null
  /** UI から付けた端末の別名(D-092)。省くと別名なし */
  aliases?: DeviceAliases
  /**
   * 最後に分かった MAC(ホスト → MAC。D-092)。撤去した走査で覚えた MAC の別名を出し続けるため。省くと補わない
   */
  knownMacs?: ReadonlyMap<string, string>
  /**
   * OSCQuery で見つけたターゲット(D-168)。見つかった端末として並べ、引けた名前が無ければ HOST_INFO の名前を出す。
   * 端末の services にターゲットごとの OSC_PORT を並べる(同じ PC の複数のアプリを区別して選べるように)
   */
  discovered?: readonly { host: string; name: string | null; oscPort: number }[]
  /** 選んでいる OSCQuery のターゲット。いまは見つかっていなくても services に残す(選択を外せるように) */
  selectedEndpoints?: readonly DestinationEndpoint[]
}): DestinationsFrame['devices'] {
  const services = new Map<string, { name: string | null; oscPort: number }[]>()
  const addService = (host: string, name: string | null, oscPort: number) => {
    const list = services.get(host) ?? []
    const known = list.find(entry => entry.oscPort === oscPort)
    if (known === undefined) list.push({ name: name === null ? null : name.slice(0, 256), oscPort })
    else if (known.name === null && name !== null) known.name = name.slice(0, 256)
    services.set(host, list)
  }
  const devices = new Map<string, DestinationsFrame['devices'][number]>()
  const upsert = (host: string, patch: Partial<DestinationsFrame['devices'][number]>) => {
    const current = devices.get(host) ?? {
      host,
      hostname: null,
      alias: null,
      mac: input.knownMacs?.get(host) ?? null,
      interface: subnetOf(host, input.subnets)?.interface ?? null,
      self: false,
      configured: false,
      found: false,
    }
    devices.set(host, { ...current, ...patch })
  }
  // 同じ PC の Unity へ送る構成があるので自分のアドレスも並べる。MAC は NIC の MAC を使う(この PC にも MAC で別名を付けられるように。D-092)
  for (const subnet of input.subnets) {
    // ターゲットがいる範囲(D-113)の外なら並べない(選ぼうとしても isSelectableHost が断るので、一覧と選べる端末が食い違う)。
    // 設定の宛先・選択中のホストとしては下で並ぶ
    if (!inScanRanges(subnet.address, subnet)) continue
    upsert(subnet.address, {
      self: true, found: true, mac: subnet.mac ?? input.knownMacs?.get(subnet.address) ?? null,
      ...(input.localHostname ? { hostname: input.localHostname } : {}),
    })
  }
  for (const target of input.discovered ?? []) {
    // ターゲットがいる範囲(D-113)の外は並べない(選べないため)。設定の宛先のホストは範囲の外
    // (ループバックの 127.0.0.1 など)でも選べる(isSelectableHost)ので、そのターゲットも並べる
    const configured = input.configTargets.some(config => config.host === target.host)
    if (!configured && !input.subnets.some(subnet => inScanRanges(target.host, subnet) && inSubnet(target.host, subnet))) continue
    const named = devices.get(target.host)?.hostname ?? null
    upsert(target.host, { found: true, ...(named === null && target.name !== null ? { hostname: target.name.slice(0, 253) } : {}) })
    addService(target.host, target.name, target.oscPort)
  }
  for (const target of input.configTargets) upsert(target.host, { configured: true })
  for (const host of input.selectedHosts) upsert(host, {})
  for (const endpoint of input.selectedEndpoints ?? []) {
    upsert(endpoint.host, {})
    addService(endpoint.host, null, endpoint.port)
  }
  const aliases = input.aliases ?? new Map()
  return [...devices.values()].map(device => {
    const listed = (services.get(device.host) ?? []).sort((a, b) => a.oscPort - b.oscPort).slice(0, 64)
    return { ...device, alias: aliasFor(aliases, device.host, device.mac), ...(listed.length > 0 ? { services: listed } : {}) }
  }).sort(compareHosts)
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
  /** この PC の名前(OS のホスト名)。省くと名前なし */
  localHostname?: () => string | null
  store: DestinationSelectionStore
  /** 端末の別名の保存先(D-092)。省くと別名は実行中だけ覚える */
  aliasStore?: DeviceAliasStore
  /** ターゲットがいる範囲(D-113)。省くと自動(この PC のネットワークそのまま) */
  scanScope?: () => ScanScope
  applyTargets: (targets: readonly RuntimeTargetSpec[]) => void
  /** OSCQuery で見つけたターゲット(D-168)。送り先の候補として一覧に並べ、選ばれたら OSC_PORT へ送る。省くと無し */
  discovered?: () => readonly { host: string; oscPort: number; name: string | null }[]
  currentTargets: () => readonly { name: string; host: string; sendPort: number; primary: boolean; broadcast: BroadcastNetwork | null }[]
  primaryHosts: () => readonly string[]
  publish: (frame: DownstreamFrame, clientId?: ClientId) => void
  logInfo?: LogFn
  logWarn?: LogFn
}): Destinations {
  const logInfo = deps.logInfo ?? console.info
  const logWarn = deps.logWarn ?? console.warn
  const configHosts = [...new Set(deps.configTargets.map(target => target.host))]
  const scopeOf = deps.scanScope ?? (() => ({ targetInterface: null, targetRanges: [] }))
  const subnetsFrom = (interfaces: readonly ScanInterface[]) => scopedScanSubnets(interfaces, scopeOf())
  let selection: DestinationSelection | null = null
  let subnets: ScanSubnet[] = []
  // 範囲で絞る前のすべてのネットワーク(ブロードキャストの到達の判定用)
  let allSubnets: ScanSubnet[] = []
  // この PC の全 IPv4 アドレス(自ホストの判定。ネットワークの一覧とは分ける)
  let ownAddresses: ReadonlySet<string> = new Set()
  let closed = false
  // 選択をファイルへ書けたか。書けなかった選択は実行中だけ効くので、保存済み(saved)としては配らない(unsaved)
  let persisted = true
  const aliasStore = deps.aliasStore ?? createMemoryDeviceAliasStore()
  let aliases: DeviceAliases = new Map()

  // この PC の NIC の MAC で覚えた別名を、アドレスが変わっても付いて回らせる(D-092)。ほかの端末の MAC は撤去した走査
  // (ARP 表)でしか分からなかったので、いまは別名の表の「最後に見えたホスト」(lastSeenMacs)だけを使う
  const followOwnMacs = () => {
    const followed = followMacs(aliases, subnets.map(subnet => ({ host: subnet.address, mac: subnet.mac ?? null })))
    if (followed.changed) {
      aliases = followed.aliases
      // 最後に見えたホストは表示の補助なので、書けなくても通知はしない(store が警告ログを出す)
      aliasStore.save(aliases)
    }
  }

  /** 一覧に出ている端末か(別名を付けられる端末)。一覧を作らずに判定する。 */
  const isListed = (host: string) => (deps.discovered?.().some(target => target.host === host) ?? false)
    || subnets.some(subnet => subnet.address === host)
    || deps.configTargets.some(target => target.host === host)
    || (selection?.hosts.includes(host) ?? false)
    || (selection?.endpoints?.some(endpoint => endpoint.host === host) ?? false)

  /** 別名のキーに使う MAC。この PC は NIC の MAC、ほかは最後に分かった MAC。 */
  const macOf = (host: string): string | null => subnets.find(subnet => subnet.address === host)?.mac
    ?? lastSeenMacs(aliases).get(host)
    ?? null

  // 選択をこの PC の今のネットワークで検証し直す(保存した選択の復元と、ネットワークが変わったとき。D-078)。
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
    const endpoints = uniqueEndpoints(candidate.endpoints ?? []).filter(endpoint => isSelectableHost(endpoint.host, deps.configTargets, subnets))
    const droppedEndpoints = (candidate.endpoints ?? []).filter(endpoint => !isSelectableHost(endpoint.host, deps.configTargets, subnets))
    if (droppedEndpoints.length > 0) {
      logWarn('(WARN, BRIDGE)', `Destinations (${context}): dropped OSCQuery target(s) outside the local networks: ${droppedEndpoints.map(endpoint => `${endpoint.host}:${String(endpoint.port)}`).join(', ')}.`)
    }
    if (!candidate.allDevices && hosts.length === 0 && networks.length === 0 && endpoints.length === 0) {
      logWarn('(WARN, BRIDGE)', `Destinations (${context}): no selectable host or network left; using the config targets.`)
      return null
    }
    return withEndpoints({ allDevices: candidate.allDevices, networks, hosts }, endpoints)
  }
  const apply = () => {
    const targets = resolveDestinationTargets({ selection, configTargets: deps.configTargets, subnets, sendPort: deps.sendPort, ownAddresses, reachSubnets: allSubnets })
    if (targets === null) {
      // 保存した選択は消さない(NIC が戻れば次の読み直し・再起動でまた効く)
      logWarn('(WARN, BRIDGE)', selection?.allDevices === true
        ? 'Destinations: "all devices" needs an IPv4 network interface; using the config targets for now.'
        : 'Destinations: no selectable host in the saved selection; using the config targets for now.')
      deps.applyTargets(resolveDestinationTargets({ selection: null, configTargets: deps.configTargets, subnets, sendPort: deps.sendPort, ownAddresses, reachSubnets: allSubnets })!)
      return
    }
    deps.applyTargets(targets)
  }

  const devices = () => listDevices({
    subnets, configTargets: deps.configTargets, selectedHosts: selection?.hosts ?? [],
    localHostname: deps.localHostname?.() ?? null, aliases, knownMacs: lastSeenMacs(aliases), discovered: deps.discovered?.() ?? [],
    selectedEndpoints: selection?.endpoints ?? [],
  })

  const frame = (): DownstreamFrame => ({
    v: 1,
    type: 'destinations',
    sendPort: deps.sendPort,
    devices: devices(),
    broadcasts: subnets.map(subnet => ({ address: subnet.broadcast, interface: subnet.interface, network: subnet.network })),
    // 未保存の間は設定の宛先のホストを選択中として見せる(チェックを足し引きした結果がそのまま新しい選択になる)
    selection: selection === null
      ? { source: 'config', allDevices: false, networks: [], hosts: configHosts }
      : {
        source: persisted ? 'saved' : 'unsaved', allDevices: selection.allDevices, networks: [...selection.networks], hosts: [...selection.hosts],
        ...(selection.endpoints !== undefined && selection.endpoints.length > 0 ? { endpoints: selection.endpoints.map(endpoint => ({ ...endpoint })) } : {}),
      },
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

  const select = (frameIn: Extract<DestinationsUpstream, { type: 'destinationsSelect' }>, clientId: ClientId) => {
    const hosts = [...new Set(frameIn.hosts)]
    const invalid = hosts.find(host => !isSelectableHost(host, deps.configTargets, subnets))
    if (invalid !== undefined) return reject(clientId, `invalid-host: ${invalid}`)
    const networks = [...new Set(frameIn.networks)]
    const unknownNetwork = networks.find(network => !subnets.some(subnet => subnet.network === network))
    if (unknownNetwork !== undefined) return reject(clientId, `invalid-network: ${unknownNetwork}`)
    // OSCQuery のターゲット(D-168)。ホストは端末と同じ規則で縛る(いま見つかっているかは問わない。再起動直後の選び直しで落とさない)
    const endpoints = uniqueEndpoints(frameIn.endpoints ?? [])
    const invalidEndpoint = endpoints.find(endpoint => !isSelectableHost(endpoint.host, deps.configTargets, subnets))
    if (invalidEndpoint !== undefined) return reject(clientId, `invalid-endpoint: ${invalidEndpoint.host}:${String(invalidEndpoint.port)}`)
    if (!frameIn.allDevices && hosts.length === 0 && networks.length === 0 && endpoints.length === 0) return reject(clientId, 'empty-selection')
    if (frameIn.allDevices && subnets.length === 0) return reject(clientId, 'no-broadcast-network')
    selection = withEndpoints({ allDevices: frameIn.allDevices, networks, hosts }, endpoints)
    persisted = deps.store.save(selection)
    if (!persisted) saveFailed(`could not write ${deps.store.file}; the selection lasts until the bridge stops`)
    apply()
    publish()
  }

  // 端末の別名(D-092)。一覧にある端末だけに付けられる(任意の文字列をキーにして表を膨らませないため)。
  // キーの MAC はブリッジが知っている MAC(この PC の NIC・最後に分かった MAC)で、UI からは受け取らない。
  // 最後に分かった MAC も使うのは、改名・消去を MAC で覚えた別名へ届かせるため(host の別名だけを変えると MAC の古い名前が勝つ)
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
      allSubnets = scanSubnets(interfaces)
      ownAddresses = localIpv4Addresses(interfaces)
      aliases = aliasStore.load()
      if (aliases.size > 0) logInfo('(INFO, BRIDGE)', `Restored ${String(aliases.size)} device name(s) from "${aliasStore.file}".`)
      followOwnMacs()
      const saved = deps.store.load()
      if (saved !== null) {
        // 保存した選択も UI からの選択と同じ規則で検証する(ファイルを手で書き換えた・ネットワークが変わった場合)
        selection = revalidate(saved, `restoring ${deps.store.file}`)
        persisted = true
        if (selection !== null) logInfo('(INFO, BRIDGE)', `Restored destinations from "${deps.store.file}".`)
      }
      if (selection !== null) apply()
    },
    handleUiFrame(frameIn, clientId) {
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
      allSubnets = scanSubnets(interfaces)
      ownAddresses = ownNow
      if (changed) {
        followOwnMacs()
        // NIC の差し替え・範囲の変更でネットワークが変わったら、全てのデバイス(ブロードキャストアドレス)も個別の選択(ネットワークの中か)も
        // 決め直す。個別の選択を検証し直さないと、もう選べない旧ネットワークのホストへ送り続ける
        if (selection !== null) selection = revalidate(selection, 'networks changed')
        apply()
        publish()
      }
      return changed
    },
    discoveredChanged() {
      // 一覧(services)だけが変わる。選んだターゲットはホストとポートの組で持つので、発見が消えても・ポートが変わっても
      // 送り先は変えない(別のポートのアプリを選ぶのは利用者)
      publish()
    },
    close() {
      closed = true
    },
  }
}
