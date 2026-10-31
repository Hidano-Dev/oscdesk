import path from 'node:path'

import { z } from 'zod'

import { NETWORK_SETTINGS } from '@oscdesk/shared'

import { describeError, readJsonFile, writeJsonFileAtomically, type JsonFileFs } from './json-file'
import { checkNetworkSettings, type NetworkSettings } from './network-settings'

// ネットワークの設定(D-104)をブリッジ再起動をまたいで残すファイル。宛先の選択(D-078)と同じく一時ファイル + rename で置き換え、
// 変更はブラウザの操作でしか起きないので間引かずにその場で書く。設定ファイル(config/*.json)へは書き戻さない
// (設定ファイルはリポジトリで管理する案件の既定で、実行中の変更で書き換えると差分が混ざるため)

export const NETWORK_SETTINGS_FILE_FORMAT = 'oscdesk-network-settings'
export const NETWORK_SETTINGS_FILE_VERSION = 1
// 先頭をドットにする理由は宛先の選択(.destinations.json)と同じ(サーフェス名の <name>.json と重ならない)
export const DEFAULT_NETWORK_SETTINGS_FILE_NAME = '.network-settings.json'

const NetworkSettingsFileSchema = z.object({
  format: z.literal(NETWORK_SETTINGS_FILE_FORMAT),
  version: z.literal(NETWORK_SETTINGS_FILE_VERSION),
  savedAt: z.string(),
  targetInterface: z.string().min(1).nullable(),
  targetRanges: z.array(z.string().min(1).max(NETWORK_SETTINGS.MAX_CIDR_CHARS)).max(NETWORK_SETTINGS.MAX_TARGET_RANGES),
  allowedBrowsers: z.array(z.string().min(1).max(NETWORK_SETTINGS.MAX_CIDR_CHARS)).max(NETWORK_SETTINGS.MAX_ALLOWED_BROWSERS),
}).strict()

export interface NetworkSettingsStore {
  readonly file: string
  /** 無ければ null(警告なし)。壊れていれば警告して null(既定で起動する)。 */
  load(): NetworkSettings | null
  /** 書けなければ警告して false(設定は実行中だけ効く)。 */
  save(settings: NetworkSettings): boolean
}

type LogFn = (message?: unknown, ...optionalParams: unknown[]) => void

export function createNetworkSettingsFile(options: {
  file: string
  fs: JsonFileFs
  now?: () => number
  pid?: number
  logWarn?: LogFn
}): NetworkSettingsStore {
  const fs = options.fs
  const file = path.resolve(options.file)
  const now = options.now ?? Date.now
  const pid = options.pid ?? process.pid
  const logWarn = options.logWarn ?? console.warn

  return {
    file,
    load() {
      const read = readJsonFile(fs, file)
      if (read.kind === 'missing') return null
      if (read.kind === 'failed') {
        logWarn('(WARN, BRIDGE)', `Network settings not restored (using the defaults): ${read.reason}`)
        return null
      }
      const parsed = NetworkSettingsFileSchema.safeParse(read.json)
      if (!parsed.success) {
        const issues = parsed.error.issues.slice(0, 5).map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        logWarn('(WARN, BRIDGE)', `Network settings not restored (using the defaults): "${file}" is invalid: ${issues.join('; ')}`)
        return null
      }
      // 手で書き換えたファイルも、ブラウザからの変更と同じ規則で CIDR を検査して正規形にする。
      // ターゲット向けのアドレスがこの PC にあるかは起動側が確かめる(ここでは形だけを見る)。操作元は無いので締め出しの判定はしない
      const checked = checkNetworkSettings(parsed.data, {
        selectableAddresses: new Set(parsed.data.targetInterface === null ? [] : [parsed.data.targetInterface]),
        requesters: [],
      })
      if (!checked.ok) {
        logWarn('(WARN, BRIDGE)', `Network settings not restored (using the defaults): "${file}" is invalid: ${checked.reason}`)
        return null
      }
      return checked.settings
    },
    save(settings) {
      try {
        writeJsonFileAtomically(fs, file, {
          format: NETWORK_SETTINGS_FILE_FORMAT,
          version: NETWORK_SETTINGS_FILE_VERSION,
          savedAt: new Date(now()).toISOString(),
          targetInterface: settings.targetInterface,
          targetRanges: [...settings.targetRanges],
          allowedBrowsers: [...settings.allowedBrowsers],
        }, pid)
        return true
      } catch (error) {
        logWarn('(WARN, BRIDGE)', `Failed to save network settings to "${file}" (they last until the bridge stops): ${describeError(error)}`)
        return false
      }
    },
  }
}
