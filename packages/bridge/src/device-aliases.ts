import path from 'node:path'

import { z } from 'zod'

import { DESTINATIONS } from '@oscdesk/shared'

import type { DestinationsFs } from './destinations-file'

// 宛先パネルの端末の別名(D-092)。開発機の LAN のように逆引きも OS の名前解決も名前を返さない現場があるので、
// UI から端末に名前を付けられるようにし、ブリッジが覚えてブリッジ再起動をまたいで残す。
// キーは MAC(DHCP で IP が変わっても同じ端末を指せる)。MAC の分からない端末(別のセグメント・未走査・設定のホスト名)は
// host(IP やホスト名の文字列)をキーにする。キーの決め方と照合は純粋関数にし、ファイルの読み書きは fs を引数で受け取る。

export const DEVICE_ALIASES_FILE_FORMAT = 'oscdesk-device-aliases'
export const DEVICE_ALIASES_FILE_VERSION = 1
// 選択のファイル(.destinations.json)と同じく先頭をドットにし、サーフェス名の `<name>.json` と重ならないようにする
export const DEFAULT_DEVICE_ALIASES_FILE_NAME = '.device-aliases.json'

/** キー(`mac:aa:bb:cc:dd:ee:ff` / `host:192.168.1.20`)→ 別名。 */
export type DeviceAliases = ReadonlyMap<string, string>

const MAC_PATTERN = /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/
// 別名・host に制御文字を許すと、ログと画面の行を崩せる
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/
const KEY_PATTERN = /^(?:mac:(?:[0-9a-f]{2}:){5}[0-9a-f]{2}|host:[^\s\u0000-\u001f\u007f]{1,253})$/

/** 別名のキーに使える MAC か(小文字・コロン区切りの正規形。lan-scan の parseArpTable が作る形)。 */
export function isAliasableMac(mac: string | null | undefined): mac is string {
  return typeof mac === 'string' && MAC_PATTERN.test(mac) && mac !== '00:00:00:00:00:00'
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
    if (byMac !== undefined) return byMac
  }
  return aliases.get(hostAliasKey(host)) ?? null
}

export type AliasInput = { ok: true; alias: string | null } | { ok: false; reason: string }

/** UI から届いた別名を整える。前後の空白を外し、空なら消す(null)。制御文字・長すぎる名前は断る。 */
export function normalizeAlias(input: string | null): AliasInput {
  if (input === null) return { ok: true, alias: null }
  const alias = input.trim()
  if (alias === '') return { ok: true, alias: null }
  if (alias.length > DESTINATIONS.MAX_ALIAS_CHARS) return { ok: false, reason: `alias-too-long: at most ${String(DESTINATIONS.MAX_ALIAS_CHARS)} characters` }
  if (CONTROL_CHARS.test(alias)) return { ok: false, reason: 'alias-has-control-characters' }
  return { ok: true, alias }
}

export type AliasUpdate = { ok: true; aliases: Map<string, string> } | { ok: false; reason: string }

/**
 * 別名を付け替えた新しい表(純粋関数)。
 * - 付ける: MAC が分かれば MAC のキーで覚え、同じ host のキーの別名は消す(MAC の別名へ移す。残すと、その IP に後から来た
 *   別の端末へ古い名前が付いて見える)。MAC が分からなければ host のキーで覚える
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
  if (macKey !== null) next.delete(hostKey)
  if (!next.has(key) && next.size >= DESTINATIONS.MAX_DEVICE_ALIASES) {
    return { ok: false, reason: `too-many-aliases: at most ${String(DESTINATIONS.MAX_DEVICE_ALIASES)}` }
  }
  next.set(key, alias)
  return { ok: true, aliases: next }
}

const DeviceAliasesFileSchema = z.object({
  format: z.literal(DEVICE_ALIASES_FILE_FORMAT),
  version: z.literal(DEVICE_ALIASES_FILE_VERSION),
  savedAt: z.string(),
  aliases: z.array(z.object({
    key: z.string().regex(KEY_PATTERN),
    alias: z.string().min(1).max(DESTINATIONS.MAX_ALIAS_CHARS).refine(value => value.trim() === value && !CONTROL_CHARS.test(value), 'alias must be trimmed and have no control characters'),
  }).strict()).max(DESTINATIONS.MAX_DEVICE_ALIASES),
}).strict()

export interface DeviceAliasStore {
  readonly file: string
  /** 無ければ空(警告なし)。壊れていれば警告して空(別名なしで起動する。ファイルは書き換えるまで残す)。 */
  load(): Map<string, string>
  /** 書けなければ警告して false(別名は実行中だけ効く)。 */
  save(aliases: DeviceAliases): boolean
}

type LogFn = (message?: unknown, ...optionalParams: unknown[]) => void

/** 別名をファイルに残す。選択のファイル(destinations-file)と同じく一時ファイル + rename で置き換える。 */
export function createDeviceAliasFile(options: {
  file: string
  fs: DestinationsFs
  now?: () => number
  pid?: number
  logWarn?: LogFn
}): DeviceAliasStore {
  const fs = options.fs
  const file = path.resolve(options.file)
  const now = options.now ?? Date.now
  const pid = options.pid ?? process.pid
  const logWarn = options.logWarn ?? console.warn

  return {
    file,
    load() {
      let text: string
      try {
        text = fs.readFileSync(file, 'utf8')
      } catch (error) {
        if (isErrorCode(error, 'ENOENT')) return new Map()
        logWarn('(WARN, BRIDGE)', `Device aliases not restored: failed to read "${file}": ${describe(error)}`)
        return new Map()
      }
      let json: unknown
      try {
        json = JSON.parse(text.replace(/^\uFEFF/, ''))
      } catch (error) {
        logWarn('(WARN, BRIDGE)', `Device aliases not restored: "${file}" is not valid JSON: ${describe(error)}`)
        return new Map()
      }
      const parsed = DeviceAliasesFileSchema.safeParse(json)
      if (!parsed.success) {
        const issues = parsed.error.issues.slice(0, 5).map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        logWarn('(WARN, BRIDGE)', `Device aliases not restored: "${file}" is invalid: ${issues.join('; ')}`)
        return new Map()
      }
      // 同じキーが重なっていれば後ろが勝つ(手で書き足したときに分かりやすい方)
      return new Map(parsed.data.aliases.map(entry => [entry.key, entry.alias]))
    },
    save(aliases) {
      const temp = `${file}.${String(pid)}.tmp`
      try {
        const body = {
          format: DEVICE_ALIASES_FILE_FORMAT,
          version: DEVICE_ALIASES_FILE_VERSION,
          savedAt: new Date(now()).toISOString(),
          aliases: [...aliases].sort(([left], [right]) => left.localeCompare(right)).map(([key, alias]) => ({ key, alias })),
        }
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(temp, `${JSON.stringify(body, null, 2)}\n`, 'utf8')
        fs.renameSync(temp, file)
        return true
      } catch (error) {
        try { fs.rmSync(temp, { force: true }) } catch { /* 後始末の失敗は元のエラーを優先して報告する */ }
        logWarn('(WARN, BRIDGE)', `Failed to save device aliases to "${file}" (the aliases last until the bridge stops): ${describe(error)}`)
        return false
      }
    },
  }
}

/** ファイルに残さない別名の表(別名の保存先を渡さない構成・テスト用)。 */
export function createMemoryDeviceAliasStore(): DeviceAliasStore {
  let saved: Map<string, string> = new Map()
  return {
    file: '(memory)',
    load: () => new Map(saved),
    save: aliases => { saved = new Map(aliases); return true },
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code
}
