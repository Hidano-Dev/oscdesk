import path from 'node:path'

import { z } from 'zod'

import { DESTINATIONS } from '@oscdesk/shared'

// 宛先タブの選択(D-078)をブリッジ再起動をまたいで残すファイル。保持値(D-058)と同じく一時ファイル + rename で置き換える。
// 選択は UI の操作でしか変わらず回数が少ないので、間引かずにその場で書く。fs は引数で受け取り単体テストで差し替える。

export const DESTINATIONS_FILE_FORMAT = 'oscdesk-destinations'
export const DESTINATIONS_FILE_VERSION = 1
export const DEFAULT_DESTINATIONS_FILE_NAME = 'destinations.json'

export interface DestinationSelection {
  /** 「全てのデバイス」(ブロードキャスト)。true の間も hosts は外したときに戻すために持つ。 */
  allDevices: boolean
  hosts: string[]
}

const DestinationsFileSchema = z.object({
  format: z.literal(DESTINATIONS_FILE_FORMAT),
  version: z.literal(DESTINATIONS_FILE_VERSION),
  savedAt: z.string(),
  allDevices: z.boolean(),
  hosts: z.array(z.string().min(1).max(253)).max(DESTINATIONS.MAX_SELECTED_HOSTS),
}).strict()

export interface DestinationsFs {
  readFileSync(file: string, encoding: 'utf8'): string
  writeFileSync(file: string, data: string, encoding: 'utf8'): void
  renameSync(from: string, to: string): void
  mkdirSync(dir: string, options: { recursive: true }): unknown
  rmSync(file: string, options: { force: true }): void
}

export interface DestinationSelectionStore {
  readonly file: string
  /** 無ければ null(警告なし)。壊れていれば警告して null(設定ファイルの宛先で起動する)。 */
  load(): DestinationSelection | null
  /** 書けなければ警告して false(選択は実行中だけ効く)。 */
  save(selection: DestinationSelection): boolean
  /** 保存した選択を消す(設定ファイルの宛先へ戻す)。 */
  clear(): void
}

type LogFn = (message?: unknown, ...optionalParams: unknown[]) => void

export function createDestinationSelectionFile(options: {
  file: string
  fs: DestinationsFs
  now?: () => number
  pid?: number
  logWarn?: LogFn
}): DestinationSelectionStore {
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
        if (isErrorCode(error, 'ENOENT')) return null
        logWarn('(WARN, BRIDGE)', `Destinations not restored (using the config targets): failed to read "${file}": ${describe(error)}`)
        return null
      }
      let json: unknown
      try {
        json = JSON.parse(text.replace(/^﻿/, ''))
      } catch (error) {
        logWarn('(WARN, BRIDGE)', `Destinations not restored (using the config targets): "${file}" is not valid JSON: ${describe(error)}`)
        return null
      }
      const parsed = DestinationsFileSchema.safeParse(json)
      if (!parsed.success) {
        const issues = parsed.error.issues.slice(0, 5).map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        logWarn('(WARN, BRIDGE)', `Destinations not restored (using the config targets): "${file}" is invalid: ${issues.join('; ')}`)
        return null
      }
      return { allDevices: parsed.data.allDevices, hosts: [...parsed.data.hosts] }
    },
    save(selection) {
      const temp = `${file}.${String(pid)}.tmp`
      try {
        const body = {
          format: DESTINATIONS_FILE_FORMAT,
          version: DESTINATIONS_FILE_VERSION,
          savedAt: new Date(now()).toISOString(),
          allDevices: selection.allDevices,
          hosts: [...selection.hosts],
        }
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(temp, `${JSON.stringify(body, null, 2)}\n`, 'utf8')
        fs.renameSync(temp, file)
        return true
      } catch (error) {
        try { fs.rmSync(temp, { force: true }) } catch { /* 後始末の失敗は元のエラーを優先して報告する */ }
        logWarn('(WARN, BRIDGE)', `Failed to save destinations to "${file}" (the selection lasts until the bridge stops): ${describe(error)}`)
        return false
      }
    },
    clear() {
      try {
        fs.rmSync(file, { force: true })
      } catch (error) {
        logWarn('(WARN, BRIDGE)', `Failed to remove saved destinations "${file}": ${describe(error)}`)
      }
    },
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code
}
