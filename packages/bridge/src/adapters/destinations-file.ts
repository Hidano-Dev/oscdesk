import path from 'node:path'

import { z } from 'zod'

import { DESTINATIONS, DestinationEndpointSchema } from '@oscdesk/shared'

import type { DestinationSelectionStore } from '../domain/destinations'
import { describeError, readJsonFile, writeJsonFileAtomically, type JsonFileFs } from './json-file'

// 宛先タブの選択(D-078)をブリッジ再起動をまたいで残すファイル。保持値(D-058)と同じく一時ファイル + rename で置き換える。
// 選択は UI の操作でしか変わらず回数が少ないので、間引かずにその場で書く。fs は引数で受け取り単体テストで差し替える。

export const DESTINATIONS_FILE_FORMAT = 'oscdesk-destinations'
export const DESTINATIONS_FILE_VERSION = 1
// 既定のファイル名は先頭をドットにする。保持値の保存先(surfaces.valuesDir)を定義の保管先(surfaces.dir)と同じにした構成でも、
// サーフェス名(英数字で始まる)の `<name>.json` と重ならず、定義の一覧にも出ない(destinations という名前の定義を上書きしない)。
// 旧名(destinations.json)からの移行はしない: リリース前で旧名のファイルを持つ現場が無く、旧名を読むと
// 同じ名前のサーフェス定義を選択として読み違える経路を残すため
export const DEFAULT_DESTINATIONS_FILE_NAME = '.destinations.json'

const DestinationsFileSchema = z.object({
  format: z.literal(DESTINATIONS_FILE_FORMAT),
  version: z.literal(DESTINATIONS_FILE_VERSION),
  savedAt: z.string(),
  allDevices: z.boolean(),
  // D-085 で足した。足す前に保存したファイル(networks が無い)もそのまま読めるよう、省略は空として扱う
  networks: z.array(z.string().min(1).max(18)).max(DESTINATIONS.MAX_SCAN_INTERFACES).default([]),
  hosts: z.array(z.string().min(1).max(253)).max(DESTINATIONS.MAX_SELECTED_HOSTS),
  // D-168 で足した。OSCQuery のターゲットをホストと OSC_PORT の組で選んだもの。足す前のファイルも読めるよう省略は空
  endpoints: z.array(DestinationEndpointSchema).max(DESTINATIONS.MAX_SELECTED_HOSTS).default([]),
  // 開発の途中(PR #173 の 2 つ目の版)で書いていた形。端末の選択にポートを添えていた(ホスト → ポート)。読むときに
  // endpoints へ移し、そのホストは端末の選択から外す(そのホストへは unity.sendPort でなく、このポートへ送っていたため)。書き出さない
  ports: z.record(z.string().min(1).max(253), z.number().int().min(1).max(65535)).optional(),
}).strict()

export type DestinationsFs = JsonFileFs

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
      const read = readJsonFile(fs, file)
      if (read.kind === 'missing') return null
      if (read.kind === 'failed') {
        logWarn('(WARN, BRIDGE)', `Destinations not restored (using the config targets): ${read.reason}`)
        return null
      }
      const parsed = DestinationsFileSchema.safeParse(read.json)
      if (!parsed.success) {
        const issues = parsed.error.issues.slice(0, 5).map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        logWarn('(WARN, BRIDGE)', `Destinations not restored (using the config targets): "${file}" is invalid: ${issues.join('; ')}`)
        return null
      }
      const legacy = Object.entries(parsed.data.ports ?? {})
      const endpoints = [...parsed.data.endpoints, ...legacy.map(([host, port]) => ({ host, port }))]
      const moved = new Set(legacy.map(([host]) => host))
      const selection = { allDevices: parsed.data.allDevices, networks: [...parsed.data.networks], hosts: parsed.data.hosts.filter(host => !moved.has(host)) }
      return endpoints.length === 0 ? selection : { ...selection, endpoints }
    },
    save(selection) {
      try {
        writeJsonFileAtomically(fs, file, {
          format: DESTINATIONS_FILE_FORMAT,
          version: DESTINATIONS_FILE_VERSION,
          savedAt: new Date(now()).toISOString(),
          allDevices: selection.allDevices,
          networks: [...selection.networks],
          hosts: [...selection.hosts],
          ...(selection.endpoints !== undefined && selection.endpoints.length > 0 ? { endpoints: selection.endpoints.map(endpoint => ({ ...endpoint })) } : {}),
        }, pid)
        return true
      } catch (error) {
        logWarn('(WARN, BRIDGE)', `Failed to save destinations to "${file}" (the selection lasts until the bridge stops): ${describeError(error)}`)
        return false
      }
    },
    clear() {
      try {
        fs.rmSync(file, { force: true })
        return true
      } catch (error) {
        logWarn('(WARN, BRIDGE)', `Failed to remove saved destinations "${file}": ${describeError(error)}`)
        return false
      }
    },
  }
}
