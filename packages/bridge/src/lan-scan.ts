import { execFile } from 'node:child_process'
import dgram from 'node:dgram'
import fs from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'

import { DESTINATIONS } from '@oscdesk/shared'

import { intToIpv4, ipv4ToInt, maskOf, prefixLength } from './ipv4'

// 宛先タブの LAN 走査(D-078)。サブネットの計算と ARP 表の読み取りは純粋関数にし、
// 実ネットワークに触る部分(UDP の送信・arp コマンド)は LanProber に閉じ込めて差し替えられるようにする。

export interface ScanInterface {
  /** OS のインタフェース名(画面の表示用)。 */
  name: string
  address: string
  netmask: string
  family: 'IPv4' | 'IPv6'
  internal: boolean
  /** NIC の MAC(OS が教えたとき)。この PC の別名のキーに使う(D-092) */
  mac?: string
}

/** 走査する 1 ネットワーク。network / broadcast は実際のネットワークのもの、hosts は走査する範囲(/24 まで)。 */
export interface ScanSubnet {
  interface: string
  address: string
  networkInt: number
  maskInt: number
  /** CIDR 表記(例 192.168.1.0/24)。 */
  network: string
  broadcast: string
  hosts: readonly string[]
  /** この PC のそのネットワークの NIC の MAC(正規形。分からなければ省くか null。D-092) */
  mac?: string | null
  /**
   * ターゲットがいる範囲(D-113)のうち、このネットワークに重なる部分。省くと範囲で絞らない(自動)。
   * あれば走査・端末の一覧・個別に選べるホストをこの中に絞る。ネットワーク(network / broadcast)は NIC のもののまま
   * (「全てのデバイス」のブロードキャストは L2 全体へ届くもので、範囲で狭められないため)
   */
  ranges?: readonly ScanRange[]
}

export interface ScanRange {
  networkInt: number
  maskInt: number
}

/** 走査の範囲(D-113)。targetInterface はターゲット向けのネットワーク(null はすべて)、targetRanges は IPv4 の CIDR(空は自動)。 */
export interface ScanScope {
  targetInterface: string | null
  targetRanges: readonly string[]
}

export interface Neighbor {
  host: string
  mac: string | null
}

/**
 * 走査 1 回分。見つかった端末を返す(自分のアドレス・ネットワーク外のものは含めない)。
 * signal が中断されたら(時間切れ・ブリッジの終了)、待ち・ソケット・子プロセスを片付けてすぐに reject する。
 * 中断を無視すると、時間切れの後も走査が裏で続いて次の走査と重なり、終了後も Node を生かし続けるため
 */
export interface LanProber {
  probe(subnets: readonly ScanSubnet[], signal: AbortSignal): Promise<readonly Neighbor[]>
}

const LINK_LOCAL_INT = ipv4ToInt('169.254.0.0')!
const LINK_LOCAL_MASK = maskOf(16)

/**
 * 走査するネットワークを決める。IPv4 の外部インタフェースだけを見て、リンクローカル(169.254/16。DHCP が取れなかった NIC)と
 * /31・/32 は除く。/24 より広いネットワークは自分のアドレスを含む /24 だけを掃く(ブロードキャストアドレスは実際のネットワークのもの)。
 * 同じネットワークの重複は 1 つにまとめ、インタフェースの数にも上限を設ける
 */
export function scanSubnets(interfaces: readonly ScanInterface[]): ScanSubnet[] {
  const result: ScanSubnet[] = []
  for (const entry of interfaces) {
    if (entry.family !== 'IPv4' || entry.internal) continue
    const address = ipv4ToInt(entry.address)
    const maskInt = ipv4ToInt(entry.netmask)
    if (address === null || maskInt === null) continue
    if (((address & LINK_LOCAL_MASK) >>> 0) === LINK_LOCAL_INT) continue
    const prefix = prefixLength(maskInt)
    if (prefix === null || prefix > 30) continue
    const networkInt = (address & maskInt) >>> 0
    if (result.some(subnet => subnet.networkInt === networkInt && subnet.maskInt === maskInt)) continue
    const broadcastInt = (networkInt | ~maskInt) >>> 0
    const scanPrefix = Math.max(prefix, DESTINATIONS.MIN_SCAN_PREFIX)
    const scanMask = maskOf(scanPrefix)
    const scanNetwork = (address & scanMask) >>> 0
    const scanBroadcast = (scanNetwork | ~scanMask) >>> 0
    const hosts: string[] = []
    for (let value = scanNetwork + 1; value < scanBroadcast; value += 1) {
      // 広いネットワークの /24 を切り出すと、端が実際のネットワーク・ブロードキャストアドレスに当たることがある
      if (value === address || value === networkInt || value === broadcastInt) continue
      hosts.push(intToIpv4(value))
    }
    result.push({
      interface: entry.name,
      address: entry.address,
      networkInt,
      maskInt,
      network: `${intToIpv4(networkInt)}/${String(prefix)}`,
      broadcast: intToIpv4(broadcastInt),
      hosts,
      mac: normalizeMac(entry.mac),
    })
    if (result.length >= DESTINATIONS.MAX_SCAN_INTERFACES) break
  }
  return result
}

/**
 * 走査の範囲(D-113)で絞った走査ネットワーク。ターゲット向けのネットワークを選んでいればその NIC のネットワークだけにし、
 * ターゲットがいる範囲があれば、範囲が重なるネットワークだけを残して走査するアドレスを重なりの中に絞る。
 * 範囲が /24 より広い重なりは、この PC のアドレスを含む /24(含まなければ重なりの先頭の /24)だけを掃く(scanSubnets と同じ上限)。
 * どのネットワークにも重ならない範囲は使わない(ARP もブロードキャストも届かない、ルーターの先のネットワークは走査できないため)
 */
export function scopedScanSubnets(interfaces: readonly ScanInterface[], scope: ScanScope): ScanSubnet[] {
  const chosen = scope.targetInterface === null
    ? interfaces
    : interfaces.filter(entry => entry.family === 'IPv4' && entry.address === scope.targetInterface)
  const base = scanSubnets(chosen)
  const ranges = scope.targetRanges.map(parseRange).filter((range): range is ScanRange => range !== null)
  if (ranges.length === 0) return base
  return base.flatMap(subnet => {
    const overlaps = ranges
      .map(range => intersectRange(range, { networkInt: subnet.networkInt, maskInt: subnet.maskInt }))
      .filter((range): range is ScanRange => range !== null)
    if (overlaps.length === 0) return []
    const own = ipv4ToInt(subnet.address)!
    const broadcastInt = ipv4ToInt(subnet.broadcast)!
    const hosts = new Set<number>()
    for (const overlap of overlaps) {
      for (const value of rangeScanValues(overlap, own)) {
        if (value === own || value === subnet.networkInt || value === broadcastInt) continue
        hosts.add(value)
      }
    }
    return [{ ...subnet, hosts: [...hosts].sort((a, b) => a - b).map(intToIpv4), ranges: overlaps }]
  })
}

/** 範囲の中か(範囲が無ければ常に中)。 */
export function inScanRanges(host: string, subnet: ScanSubnet): boolean {
  if (subnet.ranges === undefined) return true
  const value = ipv4ToInt(host)
  return value !== null && subnet.ranges.some(range => ((value & range.maskInt) >>> 0) === range.networkInt)
}

function parseRange(text: string): ScanRange | null {
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(text)
  if (match === null) return null
  const address = ipv4ToInt(match[1]!)
  const prefix = Number(match[2])
  if (address === null || prefix > 32) return null
  const maskInt = maskOf(prefix)
  return { networkInt: (address & maskInt) >>> 0, maskInt }
}

/** CIDR のブロック同士の重なり(どちらかがもう一方を含むときだけ重なる)。 */
function intersectRange(a: ScanRange, b: ScanRange): ScanRange | null {
  const [wide, narrow] = a.maskInt <= b.maskInt ? [a, b] : [b, a]
  return ((narrow.networkInt & wide.maskInt) >>> 0) === wide.networkInt ? narrow : null
}

function rangeScanValues(range: ScanRange, own: number): number[] {
  let networkInt = range.networkInt
  let maskInt = range.maskInt
  const prefix = prefixLength(maskInt) ?? 32
  if (prefix < DESTINATIONS.MIN_SCAN_PREFIX) {
    maskInt = maskOf(DESTINATIONS.MIN_SCAN_PREFIX)
    networkInt = ((own & range.maskInt) >>> 0) === range.networkInt ? (own & maskInt) >>> 0 : range.networkInt
  }
  const last = (networkInt | ~maskInt) >>> 0
  const values: number[] = []
  // 範囲の端(先頭・末尾)も、NIC のネットワークの中では普通のホストでありうるので含める(NIC のネットワーク・ブロードキャストアドレスは呼び出し側が除く)
  for (let value = networkInt; value <= last; value += 1) values.push(value)
  return values
}

/**
 * この PC の IPv4 アドレス全部(ループバックを除く)。自ホストの判定(ループバックの別名。D-078)に使う。
 * 走査の対象(scanSubnets)とは分ける: 走査はリンクローカル・/31・/32・5 つ目以降の NIC を除くが、
 * そこへ解決される宛先もこの PC であることに変わりはない
 */
export function localIpv4Addresses(interfaces: readonly ScanInterface[]): ReadonlySet<string> {
  return new Set(interfaces.filter(entry => entry.family === 'IPv4' && !entry.internal && ipv4ToInt(entry.address) !== null).map(entry => entry.address))
}

/** その IPv4 アドレスを含む走査ネットワークすべて(ネットワークは重なり得る)。 */
export function subnetsContaining(host: string, subnets: readonly ScanSubnet[]): ScanSubnet[] {
  const value = ipv4ToInt(host)
  if (value === null) return []
  return subnets.filter(subnet => ((value & subnet.maskInt) >>> 0) === subnet.networkInt)
}

/** その IPv4 アドレスを含む走査ネットワーク(重なるときは最初のもの。表示用)。 */
export function subnetOf(host: string, subnets: readonly ScanSubnet[]): ScanSubnet | undefined {
  const value = ipv4ToInt(host)
  if (value === null) return undefined
  return subnets.find(subnet => ((value & subnet.maskInt) >>> 0) === subnet.networkInt)
}

const IPV4_IN_LINE = /(?<![\d.])(\d{1,3}(?:\.\d{1,3}){3})(?![\d.])/
const MAC_IN_LINE = /(?<![0-9a-f])((?:[0-9a-f]{1,2}[:-]){5}[0-9a-f]{1,2})(?![0-9a-f])/i

/**
 * `arp -a`(Windows・macOS・Linux)と /proc/net/arp の出力から、IPv4 と MAC の組を取り出す。
 * 形式は OS ごとに違うが、1 行に IPv4 と MAC が 1 つずつ並ぶ点は共通なので行ごとに両方を拾う。
 * MAC の無い行(Windows の Interface 見出し・未解決の incomplete)は捨てる
 */
export function parseArpTable(text: string): Neighbor[] {
  const result: Neighbor[] = []
  for (const line of text.split(/\r?\n/)) {
    const ip = IPV4_IN_LINE.exec(line)?.[1]
    const mac = MAC_IN_LINE.exec(line)?.[1]
    if (ip === undefined || mac === undefined || ipv4ToInt(ip) === null) continue
    result.push({ host: ip, mac: canonicalMac(mac) })
  }
  return result
}

function canonicalMac(mac: string): string {
  return mac.toLowerCase().split(/[:-]/).map(part => part.padStart(2, '0')).join(':')
}

/**
 * OS が教えた NIC の MAC を ARP 表と同じ正規形(小文字・コロン区切り)にする。読めない値と、
 * MAC を持たない NIC(VPN・ループバック等)が返す 00:00:00:00:00:00 は null
 */
export function normalizeMac(mac: string | undefined): string | null {
  if (mac === undefined || !/^(?:[0-9a-f]{1,2}[:-]){5}[0-9a-f]{1,2}$/i.test(mac)) return null
  const normalized = canonicalMac(mac)
  return normalized === '00:00:00:00:00:00' ? null : normalized
}

/**
 * ARP 表の行のうち、走査したネットワークにいる実在の端末だけを残す。
 * 未解決(00:..)・ブロードキャスト(ff:..)・マルチキャストの MAC、ネットワーク・ブロードキャストアドレス、
 * マルチキャストの IP、この PC 自身のアドレスを除く(この PC は呼び出し側が「この PC」として別に足す)
 */
export function selectNeighbors(entries: readonly Neighbor[], subnets: readonly ScanSubnet[]): Neighbor[] {
  const own = new Set(subnets.map(subnet => subnet.address))
  const seen = new Set<string>()
  const result: Neighbor[] = []
  for (const entry of entries) {
    const containing = subnetsContaining(entry.host, subnets)
    if (containing.length === 0 || own.has(entry.host) || seen.has(entry.host)) continue
    // 重なるネットワークのどれかでネットワーク・ブロードキャストアドレスなら端末ではない
    const value = ipv4ToInt(entry.host)!
    if (containing.some(subnet => value === subnet.networkInt || value === ipv4ToInt(subnet.broadcast))) continue
    // ターゲットがいる範囲(D-113)の外の端末は一覧に出さない(ARP 表には走査と無関係な端末も載る)
    if (!containing.some(subnet => inScanRanges(entry.host, subnet))) continue
    const mac = entry.mac
    if (mac !== null && (/^(?:00:){5}00$/.test(mac) || /^(?:ff:){5}ff$/.test(mac) || isMulticastMac(mac))) continue
    seen.add(entry.host)
    result.push(entry)
  }
  return result
}

function isMulticastMac(mac: string): boolean {
  // 先頭オクテットの最下位ビットが 1 ならグループアドレス(01:00:5e:… の IPv4 マルチキャスト等)
  return (Number.parseInt(mac.slice(0, 2), 16) & 1) === 1
}

/** UDP の宛先に使う discard ポート。受け手が何も返さない前提のポートで、届いても害が無い。 */
const DISCARD_PORT = 9
// 送ってから ARP の応答と OS の近隣状態の更新を待つ長さ。Windows は古いエントリの再確認に 1 秒前後かかる
const DEFAULT_SETTLE_MS = 2_500
const DEFAULT_ARP_TIMEOUT_MS = 4_000

/**
 * OS の機能だけで端末を探す走査器。走査範囲の全アドレスへ空の UDP データグラムを 1 個ずつ送り、
 * 送信のために OS が行う ARP 解決で ARP 表を埋めてから、`arp -a`(無ければ /proc/net/arp)を読む。
 * ICMP の ping は使わない: 生ソケットに権限が要り、Windows の既定の防火壁は ping に応答しない
 * (Unity を動かす Windows PC が見つからない)が、ARP には防火壁の設定にかかわらず応答するため
 */
export function createSystemLanProber(options: {
  settleMs?: number
  arpTimeoutMs?: number
  sendProbes?: (hosts: readonly string[], signal: AbortSignal) => Promise<void>
  readArpTable?: (signal: AbortSignal) => Promise<string>
} = {}): LanProber {
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS
  const send = options.sendProbes ?? sendUdpProbes
  const readArpTable = options.readArpTable ?? (signal => readSystemArpTable(options.arpTimeoutMs ?? DEFAULT_ARP_TIMEOUT_MS, signal))
  return {
    async probe(subnets, signal) {
      signal.throwIfAborted()
      await send(subnets.flatMap(subnet => subnet.hosts), signal)
      await delay(settleMs, undefined, { signal })
      const table = await readArpTable(signal)
      signal.throwIfAborted()
      return selectNeighbors(parseArpTable(table), subnets)
    },
  }
}

async function sendUdpProbes(hosts: readonly string[], signal: AbortSignal): Promise<void> {
  if (hosts.length === 0) return
  // 中断されたらソケットを閉じる(送信待ちのコールバックはエラーで返り、下の Promise.all が終わる)
  const socket = dgram.createSocket({ type: 'udp4', signal })
  // 届かない宛先の送信エラー(EHOSTUNREACH 等)は走査の結果に関係ないので握りつぶす
  socket.on('error', () => undefined)
  const empty = Buffer.alloc(0)
  try {
    await Promise.all(hosts.map(host => new Promise<void>(resolve => {
      socket.send(empty, DISCARD_PORT, host, () => resolve())
    })))
  } finally {
    // signal で閉じ済みなら close は投げるので握りつぶす
    try { socket.close() } catch { /* 既に閉じている */ }
  }
  signal.throwIfAborted()
}

function readSystemArpTable(timeoutMs: number, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    // Windows の arp はコードページ依存の文字で見出しを出す。数字と英字だけ拾うので latin1 で読めば足りる。
    // signal で中断されると子プロセスを kill して AbortError で返る
    execFile('arp', ['-a'], { timeout: timeoutMs, windowsHide: true, encoding: 'latin1', signal }, (error, stdout) => {
      if (error === null) {
        resolve(stdout)
        return
      }
      if (signal.aborted) {
        reject(error)
        return
      }
      // arp コマンドの無い Linux(net-tools 未導入)はカーネルの表を直接読む
      fs.readFile('/proc/net/arp', { encoding: 'utf8', signal }, (fileError, text) => {
        if (fileError === null) resolve(text)
        else reject(error)
      })
    })
  })
}
