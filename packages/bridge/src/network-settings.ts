import net from 'node:net'

import type { DownstreamFrame, UpstreamFrame } from '@oscdesk/shared'

import { intToIpv4, ipv4ToInt, maskOf } from './ipv4'
import type { ScanInterface, ScanScope } from './lan-scan'
import type { NetworkSettingsStore } from './network-settings-file'
import type { ClientId } from './surface-core'

// ネットワークの設定(D-104)。ターゲット向けのネットワーク(OSC の送受信に使うこの PC のアドレス)・ターゲットがいる範囲・
// 接続してよいブラウザの範囲を、どのブラウザからでも実行中に変えられるようにする。D-029 の「設定は起動時に確定」を
// この 3 つについてだけ覆す。判定は純粋関数にし、ソケットの付け替え・ファイル・配信は引数で受け取る。
//
// 許可リストは認証の代わりではない(信頼できる LAN 内で使う前提は変わらない)。誤って別の PC から操作されにくくする
// 囲いで、締め出しの事故を避けるために次を守る:
// - この PC の localhost(127.0.0.1 / ::1)は常に許可する(どんな設定にしても、サーバー PC のブラウザから戻せる)
// - 変更した操作元(接続の送信元と、UI のプロセスが名乗るブラウザのアドレス)を締め出す変更は断る

export interface NetworkSettings {
  /** ターゲット向けの送受信に使うこの PC の IPv4 アドレス。null はすべてのネットワーク(0.0.0.0)。 */
  targetInterface: string | null
  /** ターゲットがいる範囲(IPv4 の CIDR。正規形)。空は自動(この PC のネットワークそのまま)。 */
  targetRanges: string[]
  /** 接続してよいブラウザの範囲(CIDR。正規形)。空ならこの PC の localhost だけ。 */
  allowedBrowsers: string[]
}

/** 保存していない間の既定。ブラウザはすべて許可する(許可リストを足す前と同じふるまい)。 */
export const DEFAULT_ALLOWED_BROWSERS: readonly string[] = ['0.0.0.0/0', '::/0']

export const LOCALHOST_ADDRESS = '127.0.0.1'

/**
 * 接続元のアドレスを比較用に揃える。IPv4 射影の IPv6(::ffff:192.168.1.5)は IPv4 にし、IPv6 は小文字にする。
 * 両方で待ち受ける HTTP サーバーは IPv4 の接続元を射影の形で渡すことがあり、揃えないと IPv4 の許可に当たらない
 */
export function normalizeAddress(address: string): string {
  const trimmed = address.trim()
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(trimmed)
  if (mapped !== null) return mapped[1]!
  return trimmed.toLowerCase()
}

/**
 * サーバー PC の localhost か(常に許可する接続元)。127.0.0.1 と ::1 だけで、127.0.0.0/8 の他のアドレスは含めない
 * (localhost の名前が指すのはこの 2 つで、ループバックの別アドレスから入る接続まで素通しにする理由が無いため)
 */
export function isLocalhost(address: string): boolean {
  const normalized = normalizeAddress(address)
  return normalized === LOCALHOST_ADDRESS || normalized === '::1'
}

interface ParsedCidr {
  family: 'ipv4' | 'ipv6'
  address: string
  prefix: number
  /** 正規形の表記(IPv4 はネットワークアドレスへ丸めたもの)。 */
  text: string
}

/**
 * CIDR を読む。IPv4 は正規形の dotted-quad(先頭ゼロなし)と 0〜32 の接頭辞で、ネットワークアドレスへ丸めて返す
 * (192.168.1.10/24 → 192.168.1.0/24)。bareAddress が true なら接頭辞の無いアドレスも受け、1 台(/32・/128)として扱う。
 * ipv4Only なら IPv6 は受けない。読めなければ null
 */
export function parseCidr(text: string, options: { bareAddress?: boolean; ipv4Only?: boolean } = {}): ParsedCidr | null {
  const trimmed = text.trim()
  const slash = trimmed.indexOf('/')
  const addressPart = slash < 0 ? trimmed : trimmed.slice(0, slash)
  const prefixPart = slash < 0 ? null : trimmed.slice(slash + 1)
  if (prefixPart === null && options.bareAddress !== true) return null
  if (prefixPart !== null && !/^(?:0|[1-9]\d{0,2})$/.test(prefixPart)) return null
  const ipv4 = ipv4ToInt(addressPart)
  if (ipv4 !== null) {
    if (intToIpv4(ipv4) !== addressPart) return null
    const prefix = prefixPart === null ? 32 : Number(prefixPart)
    if (prefix > 32) return null
    const network = intToIpv4((ipv4 & maskOf(prefix)) >>> 0)
    return { family: 'ipv4', address: network, prefix, text: `${network}/${String(prefix)}` }
  }
  if (options.ipv4Only === true) return null
  // ゾーン ID(fe80::1%eth0)は接続元の比較に使えないので受けない
  if (!net.isIPv6(addressPart) || addressPart.includes('%')) return null
  const prefix = prefixPart === null ? 128 : Number(prefixPart)
  if (prefix > 128) return null
  const address = addressPart.toLowerCase()
  return { family: 'ipv6', address, prefix, text: `${address}/${String(prefix)}` }
}

/** そのアドレスが CIDR のどれかに入るか。IPv4 射影の IPv6 は IPv4 として見る。 */
export function matchesAnyCidr(address: string, cidrs: readonly string[]): boolean {
  const normalized = normalizeAddress(address)
  const family = net.isIPv4(normalized) ? 'ipv4' : net.isIPv6(normalized) ? 'ipv6' : null
  if (family === null) return false
  const list = new net.BlockList()
  for (const cidr of cidrs) {
    const parsed = parseCidr(cidr, { bareAddress: true })
    // 接続元と同じファミリーの範囲だけを見る。BlockList は IPv4 のアドレスを ::/0 などの IPv6 の範囲にも当ててしまい、
    // UI(Python の ipaddress。ファミリーが違えば当たらない)と判定が食い違って、締め出しの検査をすり抜けるため
    if (parsed !== null && parsed.family === family) list.addSubnet(parsed.address, parsed.prefix, parsed.family)
  }
  return list.check(normalized, family)
}

/** そのブラウザ(接続元)を受けてよいか。localhost は常に受ける。 */
export function isBrowserAllowed(address: string, allowedBrowsers: readonly string[]): boolean {
  return isLocalhost(address) || matchesAnyCidr(address, allowedBrowsers)
}

/** ターゲット向けのネットワークに選べるアドレス(localhost を先頭に、この PC の IPv4 を並べる)。 */
export function selectableInterfaces(interfaces: readonly ScanInterface[]): { address: string; name: string }[] {
  const result = [{ address: LOCALHOST_ADDRESS, name: 'localhost' }]
  for (const entry of interfaces) {
    if (entry.family !== 'IPv4' || entry.internal || ipv4ToInt(entry.address) === null) continue
    if (result.some(item => item.address === entry.address)) continue
    result.push({ address: entry.address, name: entry.name })
  }
  return result
}

export type NetworkSettingsCheck = { ok: true; settings: NetworkSettings } | { ok: false; reason: string }

/**
 * ブラウザから届いた設定を検査して正規形にする(純粋関数)。
 * - targetInterface は null(すべて)か、選べるアドレス(selectableInterfaces)のどれか。0.0.0.0 は null と同じ
 * - targetRanges は IPv4 の CIDR(接頭辞は必須)。allowedBrowsers は CIDR か 1 台のアドレス(IPv6 も可)。どちらも重複を除く
 * - requesters(操作元のアドレス)のうち localhost でないものが新しい許可リストに入らなければ断る(自分を締め出さない)。
 *   アドレスとして読めない操作元も、許可に当たらないので断る側に倒す
 */
export function checkNetworkSettings(
  input: { targetInterface: string | null; targetRanges: readonly string[]; allowedBrowsers: readonly string[] },
  context: { selectableAddresses: ReadonlySet<string>; requesters: readonly string[] },
): NetworkSettingsCheck {
  const targetInterface = input.targetInterface === null || input.targetInterface.trim() === '0.0.0.0' ? null : input.targetInterface.trim()
  if (targetInterface !== null && !context.selectableAddresses.has(targetInterface)) {
    return { ok: false, reason: `invalid-target-interface: ${targetInterface}` }
  }
  const targetRanges: string[] = []
  for (const range of input.targetRanges) {
    const parsed = parseCidr(range, { ipv4Only: true })
    if (parsed === null) return { ok: false, reason: `invalid-target-range: ${range}` }
    if (!targetRanges.includes(parsed.text)) targetRanges.push(parsed.text)
  }
  const allowedBrowsers: string[] = []
  for (const entry of input.allowedBrowsers) {
    const parsed = parseCidr(entry, { bareAddress: true })
    if (parsed === null) return { ok: false, reason: `invalid-allowed-browser: ${entry}` }
    if (!allowedBrowsers.includes(parsed.text)) allowedBrowsers.push(parsed.text)
  }
  for (const requester of context.requesters) {
    if (!isBrowserAllowed(requester, allowedBrowsers)) {
      return { ok: false, reason: `would-lock-out: ${normalizeAddress(requester)}` }
    }
  }
  return { ok: true, settings: { targetInterface, targetRanges, allowedBrowsers } }
}

export function sameSettings(a: NetworkSettings, b: NetworkSettings): boolean {
  return a.targetInterface === b.targetInterface
    && a.targetRanges.join(',') === b.targetRanges.join(',')
    && a.allowedBrowsers.join(',') === b.allowedBrowsers.join(',')
}

type LogFn = (message?: unknown, ...optionalParams: unknown[]) => void
type SetFrame = Extract<UpstreamFrame, { type: 'networkSettingsSet' }>

export interface NetworkSettingsManager {
  /** 保存した設定を読む。ターゲット向けに使う待ち受けのアドレス(0.0.0.0 か、この PC のアドレス)を返す。 */
  start(): { bindHost: string }
  /** 起動時に保存したアドレスで待ち受けられなかったとき、設定ファイルのアドレスへ戻したことを記録する(ファイルは書き換えない)。 */
  fallBackToConfigInterface(): void
  readonly current: NetworkSettings
  isBrowserAllowed(address: string): boolean
  /** 宛先の走査の範囲(ターゲット向けのネットワークと範囲)。 */
  scope(): ScanScope
  /** networkSettingsSet なら処理して true。処理は非同期(ソケットの付け替えを待つ)で、届いた順に 1 つずつ行う。 */
  handleUiFrame(frame: UpstreamFrame, clientId: ClientId): boolean
  publish(clientId?: ClientId): void
  /** 処理中の変更が終わるのを待つ(テスト用)。 */
  idle(): Promise<void>
}

export function bindHostOf(targetInterface: string | null): string {
  return targetInterface ?? '0.0.0.0'
}

export function createNetworkSettings(deps: {
  /** 設定ファイルのターゲット向けの待ち受け(bridge.oscListenHost)。保存していない間の既定 */
  configListenHost: string
  store: NetworkSettingsStore
  interfaces: () => readonly ScanInterface[]
  /** ターゲット向けのソケットを付け替える。失敗したら元のアドレスへ戻してから reject する */
  rebind: (host: string) => Promise<void>
  /** 範囲・ネットワークが変わった(宛先の走査範囲を決め直す) */
  onScopeChanged: () => void
  /** 許可リストが変わった(範囲の外になった接続を切る) */
  onAllowedChanged: () => void
  /** その接続の送信元アドレス */
  peerOf: (clientId: ClientId) => string | undefined
  publish: (frame: DownstreamFrame, clientId?: ClientId) => void
  logInfo?: LogFn
  logWarn?: LogFn
}): NetworkSettingsManager {
  const logInfo = deps.logInfo ?? console.info
  const logWarn = deps.logWarn ?? console.warn
  const configInterface = deps.configListenHost === '0.0.0.0' ? null : deps.configListenHost
  let settings: NetworkSettings = { targetInterface: configInterface, targetRanges: [], allowedBrowsers: [...DEFAULT_ALLOWED_BROWSERS] }
  let source: 'default' | 'saved' | 'unsaved' = 'default'
  let queue: Promise<void> = Promise.resolve()

  const frame = (): DownstreamFrame => ({
    v: 1,
    type: 'networkSettings',
    targetInterface: settings.targetInterface,
    targetRanges: [...settings.targetRanges],
    allowedBrowsers: [...settings.allowedBrowsers],
    interfaces: selectableInterfaces(deps.interfaces()),
    source,
  })

  const publish = (clientId?: ClientId) => deps.publish(frame(), clientId)

  const reject = (clientId: ClientId, reason: string) => {
    deps.publish({ v: 1, type: 'notice', level: 'error', code: 'network-settings-rejected', detail: reason }, clientId)
    // 要求元の入力欄を、ブリッジが持つ設定へ戻させる
    publish(clientId)
  }

  const apply = async (frameIn: SetFrame, clientId: ClientId) => {
    const peer = deps.peerOf(clientId)
    // 接続が既に切れていれば、操作元を確かめられないので変えない
    if (peer === undefined) return
    const requesters = frameIn.browser === undefined ? [peer] : [peer, frameIn.browser]
    const selectableAddresses = new Set(selectableInterfaces(deps.interfaces()).map(item => item.address))
    // 今使っているアドレスは、NIC が一時的に見えなくても選び直せる(範囲だけを変えたいときに断られないように)
    if (settings.targetInterface !== null) selectableAddresses.add(settings.targetInterface)
    const checked = checkNetworkSettings(frameIn, { selectableAddresses, requesters })
    if (!checked.ok) {
      logWarn('(WARN, BRIDGE)', `Network settings rejected: ${checked.reason}`)
      return reject(clientId, checked.reason)
    }
    const next = checked.settings
    if (next.targetInterface !== settings.targetInterface) {
      try {
        await deps.rebind(bindHostOf(next.targetInterface))
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        logWarn('(WARN, BRIDGE)', `Could not listen for targets on ${bindHostOf(next.targetInterface)}: ${detail}`)
        return reject(clientId, `rebind-failed: ${detail}`)
      }
    }
    const scopeChanged = next.targetInterface !== settings.targetInterface || next.targetRanges.join(',') !== settings.targetRanges.join(',')
    const allowedChanged = next.allowedBrowsers.join(',') !== settings.allowedBrowsers.join(',')
    settings = next
    const saved = deps.store.save(settings)
    source = saved ? 'saved' : 'unsaved'
    if (!saved) {
      deps.publish({
        v: 1, type: 'notice', level: 'error', code: 'network-settings-save-failed',
        detail: `could not write ${deps.store.file}; the network settings last until the bridge stops`,
      })
    }
    logInfo('(INFO, BRIDGE)', `Network settings changed: targets on ${bindHostOf(settings.targetInterface)}, ranges [${settings.targetRanges.join(', ') || 'auto'}], browsers [${settings.allowedBrowsers.join(', ') || 'localhost only'}].`)
    if (scopeChanged) deps.onScopeChanged()
    if (allowedChanged) deps.onAllowedChanged()
    publish()
  }

  return {
    start() {
      const saved = deps.store.load()
      if (saved !== null) {
        settings = saved
        source = 'saved'
        logInfo('(INFO, BRIDGE)', `Restored network settings from "${deps.store.file}".`)
        const local = new Set(selectableInterfaces(deps.interfaces()).map(item => item.address))
        if (settings.targetInterface !== null && !local.has(settings.targetInterface)) {
          // NIC が外れた・DHCP でアドレスが変わった。ファイルは書き換えない(戻れば次の起動でまた効く)
          logWarn('(WARN, BRIDGE)', `Network settings: ${settings.targetInterface} is not on this PC now; listening for targets as the config says (${deps.configListenHost}).`)
          settings = { ...settings, targetInterface: configInterface }
        }
      }
      return { bindHost: bindHostOf(settings.targetInterface) }
    },
    fallBackToConfigInterface() {
      settings = { ...settings, targetInterface: configInterface }
    },
    get current() {
      return settings
    },
    isBrowserAllowed(address) {
      return isBrowserAllowed(address, settings.allowedBrowsers)
    },
    scope() {
      return { targetInterface: settings.targetInterface, targetRanges: settings.targetRanges }
    },
    handleUiFrame(frameIn, clientId) {
      if (frameIn.type !== 'networkSettingsSet') return false
      // ソケットの付け替えを待つ間に次の変更が来ても、届いた順に 1 つずつ処理する(付け替えが重なると待ち受けを失う)
      queue = queue.then(() => apply(frameIn, clientId)).catch((error: unknown) => {
        logWarn('(WARN, BRIDGE)', 'Network settings change failed', error)
      })
      return true
    },
    publish,
    idle() {
      return queue
    },
  }
}
