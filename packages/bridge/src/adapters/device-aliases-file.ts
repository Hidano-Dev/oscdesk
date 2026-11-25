import path from 'node:path'

import { z } from 'zod'

import { DESTINATIONS } from '@oscdesk/shared'

import {
  hostAliasKey,
  isAliasableHost,
  macAliasKey,
  normalizeAlias,
  type AliasEntry,
  type DeviceAliasStore,
} from '../domain/device-aliases'
import { normalizeMac } from '../domain/lan-subnets'
import { describeError, readJsonFile, writeJsonFileAtomically, type JsonFileFs } from './json-file'

// 宛先パネルの端末の別名(D-092)のファイル。別名のキーの決め方と照合は domain/device-aliases の純粋関数(D-134)。

export const DEVICE_ALIASES_FILE_FORMAT = 'oscdesk-device-aliases'
export const DEVICE_ALIASES_FILE_VERSION = 1
// 選択のファイル(.destinations.json)と同じく先頭をドットにし、サーフェス名の `<name>.json` と重ならないようにする
export const DEFAULT_DEVICE_ALIASES_FILE_NAME = '.device-aliases.json'

const DeviceAliasesFileSchema = z.object({
  format: z.literal(DEVICE_ALIASES_FILE_FORMAT),
  version: z.literal(DEVICE_ALIASES_FILE_VERSION),
  savedAt: z.string(),
  // 1 件ずつ検証する(1 件の書き損じでファイル全体を捨てると、次の保存で全部の別名が消えるため)
  aliases: z.array(z.unknown()),
}).strict()

const AliasFileEntrySchema = z.object({
  key: z.string(),
  alias: z.string(),
  host: z.string().optional(),
}).strict()

/**
 * ファイルの 1 件を読む。手で書いたファイルの表記揺れ(MAC の大文字・ハイフン区切り、別名の前後の空白)は直して受け、
 * 直せないものは null(呼び出し側が警告して捨てる)
 */
function readEntry(raw: unknown): [string, AliasEntry] | null {
  const parsed = AliasFileEntrySchema.safeParse(raw)
  if (!parsed.success) return null
  const { key, host } = parsed.data
  const alias = normalizeAlias(parsed.data.alias)
  if (!alias.ok || alias.alias === null) return null
  if (key.startsWith('mac:')) {
    const mac = normalizeMac(key.slice('mac:'.length))
    if (mac === null) return null
    if (host !== undefined && !isAliasableHost(host)) return [macAliasKey(mac), { alias: alias.alias }]
    return [macAliasKey(mac), host === undefined ? { alias: alias.alias } : { alias: alias.alias, host }]
  }
  if (key.startsWith('host:')) {
    const target = key.slice('host:'.length)
    return isAliasableHost(target) ? [hostAliasKey(target), { alias: alias.alias }] : null
  }
  return null
}

type LogFn = (message?: unknown, ...optionalParams: unknown[]) => void

/** 別名をファイルに残す。選択のファイル(destinations-file)と同じく一時ファイル + rename で置き換える。 */
export function createDeviceAliasFile(options: {
  file: string
  fs: JsonFileFs
  now?: () => number
  pid?: number
  logWarn?: LogFn
}): DeviceAliasStore {
  const fs = options.fs
  const file = path.resolve(options.file)
  const now = options.now ?? Date.now
  const pid = options.pid ?? process.pid
  const logWarn = options.logWarn ?? console.warn
  // 読めなかったファイルの理由。残っている間は上書きしない(手で直せば次の起動で読める)
  let unreadable: string | null = null

  return {
    file,
    load() {
      unreadable = null
      const read = readJsonFile(fs, file)
      if (read.kind === 'missing') return new Map()
      if (read.kind === 'failed') {
        unreadable = read.reason
        logWarn('(WARN, BRIDGE)', `Device aliases not restored (the file is kept as is): ${read.reason}`)
        return new Map()
      }
      const parsed = DeviceAliasesFileSchema.safeParse(read.json)
      if (!parsed.success) {
        const issues = parsed.error.issues.slice(0, 5).map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        unreadable = `"${file}" is invalid: ${issues.join('; ')}`
        logWarn('(WARN, BRIDGE)', `Device aliases not restored (the file is kept as is): ${unreadable}`)
        return new Map()
      }
      const result = new Map<string, AliasEntry>()
      const dropped: number[] = []
      parsed.data.aliases.forEach((raw, index) => {
        const entry = readEntry(raw)
        // 同じキーが重なっていれば後ろが勝つ(手で書き足したときに分かりやすい方)
        if (entry === null || (!result.has(entry[0]) && result.size >= DESTINATIONS.MAX_DEVICE_ALIASES)) dropped.push(index)
        else result.set(entry[0], entry[1])
      })
      if (dropped.length > 0) {
        logWarn('(WARN, BRIDGE)', `Device aliases: ignored ${String(dropped.length)} invalid or excess entr${dropped.length === 1 ? 'y' : 'ies'} in "${file}" (aliases[${dropped.slice(0, 5).join(', ')}]).`)
      }
      return result
    },
    save(aliases) {
      if (unreadable !== null) {
        logWarn('(WARN, BRIDGE)', `Not overwriting device aliases in "${file}" because it could not be read (fix or remove it): ${unreadable}`)
        return false
      }
      try {
        writeJsonFileAtomically(fs, file, {
          format: DEVICE_ALIASES_FILE_FORMAT,
          version: DEVICE_ALIASES_FILE_VERSION,
          savedAt: new Date(now()).toISOString(),
          aliases: [...aliases].sort(([left], [right]) => left.localeCompare(right))
            .map(([key, entry]) => (entry.host === undefined ? { key, alias: entry.alias } : { key, alias: entry.alias, host: entry.host })),
        }, pid)
        return true
      } catch (error) {
        logWarn('(WARN, BRIDGE)', `Failed to save device aliases to "${file}" (the aliases last until the bridge stops): ${describeError(error)}`)
        return false
      }
    },
  }
}
