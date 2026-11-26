// 宛先パネル(D-078 / D-079 / D-085 / D-086 / D-089 / D-092 / D-093)の画面の規則。
// NiceGUI 版(packages/nicegui-ui/src/oscdesk_ui/destinations_panel.py)の純粋関数を TypeScript に写したもの(D-138。HID-461 の試作から)。
// 型は shared の zod スキーマから導出した DestinationsFrame をそのまま使う(Python 版のように型を写し直さない)

import { DESTINATIONS, type DestinationsFrame } from '@oscdesk/shared'

export type Device = DestinationsFrame['devices'][number]
export type Broadcast = DestinationsFrame['broadcasts'][number]

/** ブリッジの destinationsSelect と同じ 3 つ組(全てのデバイス, ネットワーク, 端末)。 */
export interface Selection {
  readonly allDevices: boolean
  readonly networks: readonly string[]
  readonly hosts: readonly string[]
}

export const SELF_CAPTION = 'サーバー PC'

export function selectionOf(frame: DestinationsFrame): Selection {
  return { allDevices: frame.selection.allDevices, networks: frame.selection.networks, hosts: frame.selection.hosts }
}

export function sameSelection(a: Selection, b: Selection): boolean {
  return a.allDevices === b.allDevices && a.networks.join('\n') === b.networks.join('\n') && a.hosts.join('\n') === b.hosts.join('\n')
}

// ---- IPv4(宛先の走査は IPv4 だけ。ブリッジの domain/ipv4 と同じ規則) ----

function ipv4ToInt(value: string): number | null {
  const parts = value.split('.')
  if (parts.length !== 4) return null
  let result = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    result = result * 256 + octet
  }
  return result
}

interface Network { base: number; prefix: number }

function parseNetwork(text: string): Network | null {
  const [address, prefixText, extra] = text.split('/')
  if (extra !== undefined) return null
  const base = ipv4ToInt(address ?? '')
  const prefix = prefixText === undefined ? 32 : /^\d{1,2}$/.test(prefixText) ? Number(prefixText) : -1
  if (base === null || prefix < 0 || prefix > 32) return null
  return { base, prefix }
}

const maskOf = (prefix: number) => (prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0)

function inNetwork(host: string, network: string): boolean {
  const address = ipv4ToInt(host)
  const parsed = parseNetwork(network)
  if (address === null || parsed === null) return false
  const mask = maskOf(parsed.prefix)
  return ((address & mask) >>> 0) === ((parsed.base & mask) >>> 0)
}

function broadcastOf(network: string): number | null {
  const parsed = parseNetwork(network)
  if (parsed === null) return null
  return ((parsed.base & maskOf(parsed.prefix)) | (~maskOf(parsed.prefix) >>> 0)) >>> 0
}

const prefixOf = (network: string) => parseNetwork(network)?.prefix ?? -1

/** そのホストを含むネットワークのうち最も狭いもの(重なると OS は狭い経路で送るので、広い方のブロードキャストは届かない)。 */
export function narrowestNetwork(host: string, networks: readonly string[]): string | null {
  let best: string | null = null
  for (const network of networks) {
    if (inNetwork(host, network) && (best === null || prefixOf(network) > prefixOf(best))) best = network
  }
  return best
}

/** 選んだネットワークのうち、そのホストへブロードキャストで届けるもの(ブリッジと同じ規則。D-085 / D-093)。 */
export function coveringNetwork(host: string, networks: readonly string[], scanned?: readonly string[]): string | null {
  const narrowest = narrowestNetwork(host, scanned ?? networks)
  if (narrowest === null) return null
  const address = broadcastOf(narrowest)
  return networks.find((network) => network === narrowest || (broadcastOf(network) === address && inNetwork(host, network))) ?? null
}

// ---- 一覧の組み立て ----

export interface DeviceGroup { broadcast: Broadcast | null; devices: Device[] }

/** 端末をネットワークごとにまとめる。重なるときは最も狭いネットワークに入れる(1 台を 2 か所に出さない)。 */
export function groupDevices(frame: DestinationsFrame): DeviceGroup[] {
  const networks = frame.broadcasts.map((broadcast) => broadcast.network)
  const placed = new Map(frame.devices.map((device) => [device.host, narrowestNetwork(device.host, networks)]))
  const groups: DeviceGroup[] = frame.broadcasts.map((broadcast) => ({
    broadcast,
    devices: frame.devices.filter((device) => placed.get(device.host) === broadcast.network),
  }))
  const remaining = frame.devices.filter((device) => placed.get(device.host) === null)
  if (remaining.length > 0) groups.push({ broadcast: null, devices: remaining })
  return groups
}

export function deviceName(device: Device): string {
  return device.alias ?? device.hostname ?? device.host
}

export function deviceCaption(device: Device): string {
  const parts: string[] = []
  if (device.alias !== null && device.hostname !== null) parts.push(device.hostname)
  if (device.alias !== null || device.hostname !== null) parts.push(device.host)
  if (device.self) parts.push(SELF_CAPTION)
  if (device.configured) parts.push('設定の宛先')
  if (!device.found) parts.push('直近の走査で見つかりません')
  return parts.join(' / ')
}

export function aliasKeyHint(device: Device): string {
  return device.mac !== null
    ? `MAC ${device.mac} で覚えます(IP が変わっても同じ名前で出ます)`
    : `MAC が分からないため ${device.host} で覚えます(IP が変わると名前は外れます)`
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR = /[\u0000-\u001f\u007f]/

export type AliasInput = { ok: true; alias: string | null } | { ok: false; message: string }

/** 別名の入力欄の文字列を、ブリッジへ送る別名にする(D-092)。JS の length はそのまま UTF-16 の単位なのでブリッジと数え方が揃う。 */
export function aliasFromInput(text: string | null | undefined): AliasInput {
  const alias = (text ?? '').trim()
  if (alias === '') return { ok: true, alias: null }
  if (alias.length > DESTINATIONS.MAX_ALIAS_CHARS) return { ok: false, message: `名前は ${DESTINATIONS.MAX_ALIAS_CHARS} 文字までです` }
  if (CONTROL_CHAR.test(alias)) return { ok: false, message: '名前に制御文字は使えません' }
  if (LONE_SURROGATE.test(alias)) return { ok: false, message: '名前に使えない文字が含まれています' }
  return { ok: true, alias }
}

const searchFields = (device: Device) =>
  [device.alias, device.hostname, device.host, device.mac, device.interface].filter((field): field is string => field !== null && field !== '')

export interface QueryResult { matched: boolean[]; fallback: 'invalid' | null }

/**
 * 検索欄の正規表現が、各端末の別名・名前・IP・MAC・インタフェース名のどれかの一部に一致するか(D-086 / D-092)。
 * 読めない式(打っている途中)は文字どおりの部分一致に落とす。NiceGUI 版にある照合の時間の上限は置かない(D-140):
 * 照合はそのブラウザのタブの中で走るので、重い式で止まるのは打った本人の画面だけになる(全ブラウザの更新が止まらない)
 */
export function matchDevices(devices: readonly Device[], query: string): QueryResult {
  const needle = query.trim()
  if (needle === '') return { matched: devices.map(() => true), fallback: null }
  let pattern: RegExp | null = null
  try {
    // u は付けない(u だと `\-` のような Python の regex が読む式を断る)
    pattern = new RegExp(needle, 'i')
  } catch {
    pattern = null
  }
  if (pattern !== null) {
    const compiled = pattern
    return { matched: devices.map((device) => searchFields(device).some((field) => compiled.test(field))), fallback: null }
  }
  const folded = needle.toLowerCase()
  return { matched: devices.map((device) => searchFields(device).some((field) => field.toLowerCase().includes(folded))), fallback: 'invalid' }
}

// ---- 選択の付け外し(D-089) ----

export function toggledHosts(selected: readonly string[], host: string, checked: boolean, order: readonly string[]): string[] {
  const chosen = new Set(selected)
  if (checked) chosen.add(host)
  else chosen.delete(host)
  const listed = order.filter((item) => chosen.has(item))
  const rest = selected.filter((item) => chosen.has(item) && !order.includes(item))
  return [...listed, ...rest]
}

export function toggledNetworks(selected: readonly string[], network: string, checked: boolean, order: readonly string[]): string[] {
  const chosen = new Set(selected)
  if (checked) chosen.add(network)
  else chosen.delete(network)
  return order.filter((item) => chosen.has(item))
}

/** 全てのデバイス・選んだネットワークで届く端末か。設定の宛先はポートが違うことがあるので個別の選択に任せる。この PC はどのネットワークでも届く。 */
export function isCovered(device: Device, allDevices: boolean, networks: readonly string[], scanned?: readonly string[]): boolean {
  if (allDevices) return true
  if (device.configured) return false
  return coveringNetwork(device.host, networks, scanned) !== null || (device.self && networks.length > 0)
}

/** チェックの見た目。親(全てのデバイス・ネットワーク)で届く端末にもチェックを付ける(D-089)。 */
export function isChecked(device: Device, selection: Selection, scanned?: readonly string[]): boolean {
  return selection.hosts.includes(device.host) || isCovered(device, selection.allDevices, selection.networks, scanned)
}

export function selectionWith(frame: DestinationsFrame, selection: Selection, hostsOn: readonly string[]): Selection {
  const order = frame.devices.map((device) => device.host)
  let chosen = [...selection.hosts]
  for (const host of hostsOn) chosen = toggledHosts(chosen, host, true, order)
  return { allDevices: selection.allDevices, networks: selection.networks, hosts: chosen }
}

/**
 * 端末(またはネットワーク)を選択から外す。親で届いていた端末を外すときは親を外し、残りを個別の選択へ展開する(D-089)。
 * ネットワークそのものを外すとき(networkOff)は、その中の端末は個別に選んでいたものだけを残す
 */
export function selectionWithout(
  frame: DestinationsFrame, selection: Selection, hostsOff: readonly string[] = [], networkOff: string | null = null,
): Selection {
  const off = new Set(hostsOff)
  const scanned = frame.broadcasts.map((broadcast) => broadcast.network)
  const dropped = new Set<string>(networkOff === null ? [] : [networkOff])
  const released = new Set<string>()
  const networkOf = new Map<string, string>()
  for (const group of groupDevices(frame)) {
    if (group.broadcast === null) continue
    for (const device of group.devices) {
      networkOf.set(device.host, group.broadcast.network)
      if (off.has(device.host)) {
        // 設定の宛先も、外したらそのネットワークを外す(同じポートならブロードキャストで届き続けるため)
        dropped.add(group.broadcast.network)
        // 共通のブロードキャストで届く親も外さないと送り続ける
        const parent = coveringNetwork(device.host, selection.networks, scanned)
        if (parent !== null) dropped.add(parent)
      }
      if (group.broadcast.network === networkOff) released.add(device.host)
    }
  }
  if (networkOff !== null) {
    for (const device of frame.devices) {
      if (coveringNetwork(device.host, [networkOff], scanned) === networkOff) released.add(device.host)
    }
  }
  const base = selection.allDevices ? scanned : selection.networks
  const kept = base.filter((network) => !dropped.has(network))
  const order = frame.devices.map((device) => device.host)
  const keep: string[] = []
  for (const device of frame.devices) {
    if (off.has(device.host) || keep.includes(device.host)) continue
    const explicit = selection.hosts.includes(device.host)
    const own = networkOf.get(device.host)
    const cover = coveringNetwork(device.host, selection.networks, scanned)
    // 展開するのは外した親の中で届いていた端末だけ(この PC を別のネットワークのアドレスで個別の選択へ足さない)
    const inParent = selection.allDevices || (own !== undefined && dropped.has(own)) || (cover !== null && dropped.has(cover))
    const expanded = inParent && !released.has(device.host) && isChecked(device, selection, scanned) && !isCovered(device, false, kept, scanned)
    if (explicit || expanded) keep.push(device.host)
  }
  const rest = selection.hosts.filter((host) => !order.includes(host) && !off.has(host))
  return { allDevices: selection.allDevices && off.size === 0 && networkOff === null, networks: kept, hosts: [...keep, ...rest] }
}

export function isEmpty(selection: Selection): boolean {
  return !selection.allDevices && selection.networks.length === 0 && selection.hosts.length === 0
}

// ---- 文言 ----

export function allDevicesLabel(frame: DestinationsFrame, filtering = false): string {
  if (filtering) return '表示中の全てのデバイス'
  if (frame.broadcasts.length === 0) return '全てのデバイス(IPv4 のネットワークが見つかりません)'
  return '全てのデバイス'
}

export function allDevicesTooltip(frame: DestinationsFrame): string {
  return '送り先: ' + frame.broadcasts.map((broadcast) => broadcast.address).join(', ')
}

export function networkLabel(filtering = false): string {
  return filtering ? 'このネットワークの表示中のデバイス' : 'このネットワークの全てのデバイス'
}

export function scanStatus(frame: DestinationsFrame, formatTime: (at: Date) => string = defaultTime): string {
  if (frame.scanning) return '走査中…'
  if (frame.scannedAt === null) return '未走査'
  return `最終走査 ${formatTime(new Date(frame.scannedAt))}`
}

const defaultTime = (at: Date) => at.toLocaleTimeString('ja-JP', { hour12: false })

export function sourceLabel(frame: DestinationsFrame): string {
  switch (frame.selection.source) {
    case 'saved': return '保存した選択を使っています'
    case 'unsaved': return '選択を使っています(保存できなかったため、ブリッジを再起動すると設定ファイルの宛先に戻ります)'
    default: return '設定ファイルの宛先を使っています'
  }
}

export function targetsSummary(frame: DestinationsFrame): string {
  return `いま送っている宛先: ${frame.targets.map((target) => `${target.host}:${target.sendPort}`).join(', ')}`
}

export function mismatchSummary(count: number): string {
  return count > 0 ? `設計図が一致していない PC: ${count} 台(設計図のタブを確認してください)` : ''
}
