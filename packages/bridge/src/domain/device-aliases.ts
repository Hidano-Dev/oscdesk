import { DESTINATIONS, hasLoneSurrogate } from '@oscdesk/shared'

// 宛先パネルの端末の別名(D-092)。開発機の LAN のように逆引きも OS の名前解決も名前を返さない現場があるので、
// UI から端末に名前を付けられるようにし、ブリッジが覚えてブリッジ再起動をまたいで残す。
// キーは MAC(DHCP で IP が変わっても同じ端末を指せる)。MAC の分からない端末(別のセグメント・未走査・設定のホスト名)は
// host(IP やホスト名の文字列)をキーにする。キーの決め方と照合は純粋関数にし、ファイルの読み書きは
// adapters/device-aliases-file に置く(D-134)。

/**
 * 別名の表の 1 件。host は MAC のキーの別名が最後に見えたホスト(host のキーの別名には付けない)。
 * 最後に見えたホストを覚えるのは、端末が走査に出ない間(電源断・再起動直後の初回走査前)も、そのホストの行に MAC の別名を
 * 出し続け、改名・消去を MAC の別名へ届かせるため(覚えないと host の別名だけが変わり、MAC が分かった後に古い名前が勝つ)
 */
export interface AliasEntry {
  alias: string
  host?: string
}

/** キー(`mac:aa:bb:cc:dd:ee:ff` / `host:192.168.1.20`)→ 別名。 */
export type DeviceAliases = ReadonlyMap<string, AliasEntry>

const MAC_PATTERN = /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/
// 別名・host に制御文字を許すと、ログと画面の行を崩せる
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/
const MAX_HOST_CHARS = 253

/** 別名のキーに使える MAC か(小文字・コロン区切りの正規形。lan-subnets の normalizeMac が作る形)。 */
export function isAliasableMac(mac: string | null | undefined): mac is string {
  return typeof mac === 'string' && MAC_PATTERN.test(mac)
}

/**
 * host のキーに使える host か。書くとき(UI からの別名)と読むとき(ファイル)で同じ規則を使う(ずれると自分で書いたキーを
 * 次の起動で捨てる)。設定の host は空でないことしか縛らないので、空白は許し、長さ・制御文字・孤立サロゲートだけを縛る
 * (孤立サロゲートは別名と同じく、destinations を受ける UI が描けなくなる)
 */
export function isAliasableHost(host: string): boolean {
  return host.length > 0 && host.length <= MAX_HOST_CHARS && !CONTROL_CHARS.test(host) && !hasLoneSurrogate(host)
}

export function macAliasKey(mac: string): string {
  return `mac:${mac}`
}

export function hostAliasKey(host: string): string {
  return `host:${host}`
}

/**
 * 端末の別名(純粋関数)。MAC が分かれば MAC の別名、無ければ host の別名。
 * MAC が分かっても host の別名を見るのは、走査の前(MAC がまだ分からない間)に付けた名前を、走査で MAC が分かった後も
 * 出し続けるため(消えると「付けた名前が走査で消えた」ように見える)。MAC の別名があればそちらが勝つ
 */
export function aliasFor(aliases: DeviceAliases, host: string, mac: string | null): string | null {
  if (isAliasableMac(mac)) {
    const byMac = aliases.get(macAliasKey(mac))
    if (byMac !== undefined) return byMac.alias
  }
  return aliases.get(hostAliasKey(host))?.alias ?? null
}

/** MAC の別名が最後に見えたホスト → MAC。走査に出ていない端末の MAC を補う(D-092)。 */
export function lastSeenMacs(aliases: DeviceAliases): Map<string, string> {
  const result = new Map<string, string>()
  for (const [key, entry] of aliases) {
    if (entry.host !== undefined && key.startsWith('mac:')) result.set(entry.host, key.slice('mac:'.length))
  }
  return result
}

export type AliasInput = { ok: true; alias: string | null } | { ok: false; reason: string }

/** UI から届いた別名を整える。前後の空白を外し、空なら消す(null)。制御文字・長すぎる名前は断る。 */
export function normalizeAlias(input: string | null): AliasInput {
  if (input === null) return { ok: true, alias: null }
  const alias = input.trim()
  if (alias === '') return { ok: true, alias: null }
  // 文字数は UTF-16 の単位(String.length)で数える。zod の max・ブラウザの maxlength・UI(alias_from_input)と同じ数え方
  if (alias.length > DESTINATIONS.MAX_ALIAS_CHARS) {
    return { ok: false, reason: `alias-too-long: at most ${String(DESTINATIONS.MAX_ALIAS_CHARS)} characters` }
  }
  if (CONTROL_CHARS.test(alias)) return { ok: false, reason: 'alias-has-control-characters' }
  // 孤立サロゲートは JS では正しい文字列だが、保存すると destinations を受ける UI(Python・NiceGUI の orjson)が符号化に
  // 失敗し、その端末が一覧にある限り宛先一覧を受け取れない・描けない。ファイルの読み込みもここを通り、そのエントリは捨てる
  if (hasLoneSurrogate(alias)) return { ok: false, reason: 'alias-has-lone-surrogates' }
  return { ok: true, alias }
}

export type AliasUpdate = { ok: true; aliases: Map<string, AliasEntry> } | { ok: false; reason: string }

/**
 * 別名を付け替えた新しい表(純粋関数)。mac は今の走査で分かった MAC か、最後に分かった MAC(分からなければ null)。
 * - 付ける: MAC が分かれば MAC のキーで(最後に見えたホストとして host も)覚え、同じ host のキーの別名は消す(MAC の別名へ
 *   移す。残すと、その IP に後から来た別の端末へ古い名前が付いて見える)。MAC が分からなければ host のキーで覚える
 * - 消す: MAC と host の両方のキーを消す(片方を残すと、消したはずの名前が aliasFor のもう片方の経路で出てくる)
 * - 新しいキーを足すと上限を超えるなら断る
 */
export function updateAliases(aliases: DeviceAliases, host: string, mac: string | null, alias: string | null): AliasUpdate {
  const next = new Map(aliases)
  const hostKey = hostAliasKey(host)
  const macKey = isAliasableMac(mac) ? macAliasKey(mac) : null
  if (alias === null) {
    next.delete(hostKey)
    if (macKey !== null) next.delete(macKey)
    return { ok: true, aliases: next }
  }
  const key = macKey ?? hostKey
  if (!next.has(key) && next.size - (macKey !== null && next.has(hostKey) ? 1 : 0) >= DESTINATIONS.MAX_DEVICE_ALIASES) {
    return { ok: false, reason: `too-many-aliases: at most ${String(DESTINATIONS.MAX_DEVICE_ALIASES)}` }
  }
  if (macKey === null) {
    next.set(hostKey, { alias })
    return { ok: true, aliases: next }
  }
  next.delete(hostKey)
  // 同じホストを最後に見えたホストとして持つ別の MAC の別名からは、そのホストを外す(どちらの MAC か決められなくなるため)
  for (const [otherKey, entry] of next) {
    if (otherKey !== macKey && entry.host === host) next.set(otherKey, { alias: entry.alias })
  }
  next.set(macKey, { alias, host })
  return { ok: true, aliases: next }
}

/**
 * 走査で見つかった端末に合わせて、MAC の別名の最後に見えたホストを更新する(純粋関数)。変わらなければ changed: false。
 * 同じホストを持っていた別の MAC の別名からはそのホストを外す(そのホストには今は別の端末がいるため)
 */
export function followMacs(aliases: DeviceAliases, seen: Iterable<{ host: string; mac: string | null }>): { aliases: Map<string, AliasEntry>; changed: boolean } {
  const next = new Map(aliases)
  let changed = false
  for (const { host, mac } of seen) {
    if (!isAliasableMac(mac)) continue
    const macKey = macAliasKey(mac)
    for (const [key, entry] of next) {
      if (key !== macKey && entry.host === host) {
        next.set(key, { alias: entry.alias })
        changed = true
      }
    }
    const own = next.get(macKey)
    if (own !== undefined && own.host !== host) {
      next.set(macKey, { alias: own.alias, host })
      changed = true
    }
  }
  return { aliases: next, changed }
}

export interface DeviceAliasStore {
  readonly file: string
  /**
   * 無ければ空(警告なし)。書き損じの件だけ警告して捨て、残りを読む。ファイルそのものが読めない(JSON でない・形式が違う)
   * ときは警告して空で始め、上書きしない(save が false を返す。直すか消すまで内容を残す)
   */
  load(): Map<string, AliasEntry>
  /** 書けなければ(読めなかったファイルを守るときを含む)警告して false(別名は実行中だけ効く)。 */
  save(aliases: DeviceAliases): boolean
}

/** ファイルに残さない別名の表(別名の保存先を渡さない構成・テスト用)。 */
export function createMemoryDeviceAliasStore(): DeviceAliasStore {
  let saved = new Map<string, AliasEntry>()
  return {
    file: '(memory)',
    load: () => new Map(saved),
    save: aliases => { saved = new Map(aliases); return true },
  }
}
