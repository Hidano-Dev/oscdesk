import { DESTINATIONS } from '@oscdesk/shared'

import { intToIpv4, ipv4ToInt, maskOf, prefixLength } from './ipv4'

// この PC の IPv4 のネットワークと、ターゲットがいる範囲(D-113)の判定。純粋関数。
// 宛先パネルの選べる端末・ブロードキャストの宛先・OSCQuery で見つけたターゲットの受け入れ・mDNS で探す NIC に使う。
// LAN の走査(UDP の掃引と ARP 表。D-078)は撤去した(D-172)。ここに残すのはネットワークの計算だけ

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

/** この PC の 1 ネットワーク。network / broadcast は実際のネットワークのもの。 */
export interface ScanSubnet {
  interface: string
  address: string
  networkInt: number
  maskInt: number
  /** CIDR 表記(例 192.168.1.0/24)。 */
  network: string
  broadcast: string
  /** この PC のそのネットワークの NIC の MAC(正規形。分からなければ省くか null。D-092) */
  mac?: string | null
  /**
   * ターゲットがいる範囲(D-113)のうち、このネットワークに重なる部分。省くと範囲で絞らない(自動)。
   * あれば端末の一覧・個別に選べるホストをこの中に絞る。ネットワーク(network / broadcast)は NIC のもののまま
   * (「全てのデバイス」のブロードキャストは L2 全体へ届くもので、範囲で狭められないため)
   */
  ranges?: readonly ScanRange[]
  /**
   * 範囲(D-113)で外した NIC も含めた、この PC のすべてのネットワークのネットワーク・ブロードキャストアドレス(整数)。
   * 個別の端末として選べないアドレス。省くと自分の network / broadcast だけを見る
   */
  reserved?: readonly number[]
}

export interface ScanRange {
  networkInt: number
  maskInt: number
}

/** 範囲(D-113)。targetInterface はターゲット向けのネットワーク(null はすべて)、targetRanges は IPv4 の CIDR(空は自動)。 */
export interface ScanScope {
  targetInterface: string | null
  targetRanges: readonly string[]
}

const LINK_LOCAL_INT = ipv4ToInt('169.254.0.0')!
const LINK_LOCAL_MASK = maskOf(16)

/**
 * この PC のネットワーク。IPv4 の外部インタフェースだけを見て、リンクローカル(169.254/16。DHCP が取れなかった NIC)と
 * /31・/32 は除く。同じネットワークの重複は 1 つにまとめ、インタフェースの数にも上限を設ける
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
    result.push({
      interface: entry.name,
      address: entry.address,
      networkInt,
      maskInt,
      network: `${intToIpv4(networkInt)}/${String(prefix)}`,
      broadcast: intToIpv4(broadcastInt),
      mac: normalizeMac(entry.mac),
    })
    if (result.length >= DESTINATIONS.MAX_SCAN_INTERFACES) break
  }
  return result
}

/**
 * 範囲(D-113)で絞ったネットワーク。ターゲット向けのネットワークを選んでいればその NIC のネットワークだけにし、
 * ターゲットがいる範囲があれば、範囲が重なるネットワークだけを残す(重なりを ranges に持つ)。
 * どのネットワークにも重ならない範囲は使わない(ブロードキャストが届かない、ルーターの先のネットワークのため)
 */
export function scopedScanSubnets(interfaces: readonly ScanInterface[], scope: ScanScope): ScanSubnet[] {
  const chosen = scope.targetInterface === null
    ? interfaces
    : interfaces.filter(entry => entry.family === 'IPv4' && entry.address === scope.targetInterface)
  // 絞り込みで外した NIC のネットワーク・ブロードキャストアドレスも、個別の端末としては選ばせない。ネットワークが重なる
  // (/8 の VPN と /24 の LAN)と、外した狭い LAN のブロードキャストアドレスが残した広いネットワークでは普通のホストに見え、
  // OS は狭い方の経路で送るので「全てのデバイス」の扱いを経ずにブロードキャストになるため
  const all = scanSubnets(interfaces)
  // 何も選んでいなければ外す NIC が無いので、ネットワークそのまま
  if (scope.targetInterface === null && scope.targetRanges.length === 0) return all
  const reserved = all.flatMap(subnet => [subnet.networkInt, ipv4ToInt(subnet.broadcast)!])
  const base = scanSubnets(chosen).map(subnet => ({ ...subnet, reserved }))
  const ranges = scope.targetRanges.map(parseRange).filter((range): range is ScanRange => range !== null)
  if (ranges.length === 0) return base
  return base.flatMap(subnet => {
    const overlaps = ranges
      .map(range => intersectRange(range, { networkInt: subnet.networkInt, maskInt: subnet.maskInt }))
      .filter((range): range is ScanRange => range !== null)
    return overlaps.length === 0 ? [] : [{ ...subnet, ranges: overlaps }]
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

/**
 * この PC の IPv4 アドレス全部(ループバックを除く)。自ホストの判定(ループバックの別名。D-078)に使う。
 * ネットワーク(scanSubnets)とは分ける: そちらはリンクローカル・/31・/32・5 つ目以降の NIC を除くが、
 * そこへ解決される宛先もこの PC であることに変わりはない
 */
export function localIpv4Addresses(interfaces: readonly ScanInterface[]): ReadonlySet<string> {
  return new Set(interfaces.filter(entry => entry.family === 'IPv4' && !entry.internal && ipv4ToInt(entry.address) !== null).map(entry => entry.address))
}

/** その IPv4 アドレスを含むネットワークすべて(ネットワークは重なり得る)。 */
export function subnetsContaining(host: string, subnets: readonly ScanSubnet[]): ScanSubnet[] {
  const value = ipv4ToInt(host)
  if (value === null) return []
  return subnets.filter(subnet => ((value & subnet.maskInt) >>> 0) === subnet.networkInt)
}

/** その IPv4 アドレスを含むネットワーク(重なるときは最初のもの。表示用)。 */
export function subnetOf(host: string, subnets: readonly ScanSubnet[]): ScanSubnet | undefined {
  const value = ipv4ToInt(host)
  if (value === null) return undefined
  return subnets.find(subnet => ((value & subnet.maskInt) >>> 0) === subnet.networkInt)
}

/**
 * OS が教えた NIC の MAC を正規形(小文字・コロン区切り)にする。読めない値と、
 * MAC を持たない NIC(VPN・ループバック等)が返す 00:00:00:00:00:00 は null
 */
export function normalizeMac(mac: string | undefined): string | null {
  if (mac === undefined || !/^(?:[0-9a-f]{1,2}[:-]){5}[0-9a-f]{1,2}$/i.test(mac)) return null
  const normalized = mac.toLowerCase().split(/[:-]/).map(part => part.padStart(2, '0')).join(':')
  return normalized === '00:00:00:00:00:00' ? null : normalized
}
