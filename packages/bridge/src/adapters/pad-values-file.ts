import path from 'node:path'

import { z } from 'zod'

import { isValidSurfaceName, PadAddressSchema, PadRowKeySchema, PadValueSchema } from '@oscdesk/shared'

import type { PadValuesStore } from '../domain/pad-manager'
import { MAX_HELD_CELLS, type PersistedPadValues } from '../domain/pad-values'
import { describeError, readJsonFile, writeJsonFileAtomically, type JsonFileFs } from './json-file'

// パッドの保持値(D-169)をブリッジ再起動をまたいで残すファイル。パッドの名前ごとに 1 ファイル `<dir>/<name>.pad-values.json`
// (dir は保持値の保管先 surfaces.valuesDir。サーフェス定義の `<name>.values.json` とは名前が重ならない)。
// 値の部品は持ち主の部品の id とアドレス、表は部品・行・欄の id とマスのアドレスを持ち、採用のときにアドレスまで一致するものだけを戻す
// (部品のアドレスを書き換えたパッドで、前のアドレスの値を新しいアドレスへ送らないため)。
// 書き込みは間引き(操作のたびに書くとドラッグ中に毎秒数十回ディスクを叩く)、一時ファイル + rename で置き換える

export const PAD_VALUES_FILE_FORMAT = 'oscdesk-pad-values'
export const PAD_VALUES_FILE_VERSION = 1
export const DEFAULT_PAD_VALUES_WRITE_DELAY_MS = 500
const FILE_SUFFIX = '.pad-values.json'

const IdSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/)
// 表のマスのアドレスは部品のアドレスより長くなりうる(表のアドレス + キー + 欄のアドレス)ので、形だけを見る
const CellAddressSchema = z.string().min(2).max(1024).startsWith('/')

export const PadValuesFileSchema = z.object({
  format: z.literal(PAD_VALUES_FILE_FORMAT),
  version: z.literal(PAD_VALUES_FILE_VERSION),
  pad: z.string().refine(isValidSurfaceName, { message: 'invalid pad name' }),
  savedAt: z.string(),
  widgets: z.array(z.object({ widget: IdSchema, address: PadAddressSchema, value: PadValueSchema }).strict()).max(1024),
  rows: z.array(z.object({ widget: IdSchema, key: PadRowKeySchema, column: IdSchema, address: CellAddressSchema, value: PadValueSchema }).strict()).max(MAX_HELD_CELLS),
}).strict()

type TimerHandle = ReturnType<typeof setTimeout> | number
type LogFn = (message?: unknown, ...optionalParams: unknown[]) => void

export interface PadValuesFileStore extends PadValuesStore {
  flush(): void
  close(): void
}

export function padValuesFilePath(dir: string, name: string): string {
  return path.join(path.resolve(dir), `${name}${FILE_SUFFIX}`)
}

export function createPadValuesFileStore(options: {
  dir: string
  fs: JsonFileFs
  now?: () => number
  delayMs?: number
  setTimeoutFn?: (cb: () => void, ms: number) => TimerHandle
  clearTimeoutFn?: (handle: TimerHandle) => void
  pid?: number
  logWarn?: LogFn
}): PadValuesFileStore {
  const now = options.now ?? Date.now
  const delayMs = options.delayMs ?? DEFAULT_PAD_VALUES_WRITE_DELAY_MS
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout
  const pid = options.pid ?? process.pid
  const logWarn = options.logWarn ?? console.warn
  const dir = path.resolve(options.dir)
  // 名前ごとに最後の値だけを持つ(パッドを切り替えた直後の操作で、前のパッドの保存を落とさない)
  const pending = new Map<string, PersistedPadValues>()
  let timer: TimerHandle | null = null
  let closed = false

  const write = (name: string, values: PersistedPadValues) => {
    const file = padValuesFilePath(dir, name)
    try {
      writeJsonFileAtomically(options.fs, file, {
        format: PAD_VALUES_FILE_FORMAT,
        version: PAD_VALUES_FILE_VERSION,
        pad: name,
        savedAt: new Date(now()).toISOString(),
        widgets: values.widgets,
        rows: values.rows,
      }, pid)
    } catch (error) {
      // 書けなくても操作と同期は続ける。次の変更で再び書きに行く
      logWarn('(WARN, BRIDGE)', `Failed to save held values of pad "${name}" to "${file}": ${describeError(error)}`)
    }
  }

  const flush = () => {
    if (timer !== null) {
      clearTimeoutFn(timer)
      timer = null
    }
    const entries = [...pending]
    pending.clear()
    for (const [name, values] of entries) write(name, values)
  }

  return {
    load(name) {
      if (!isValidSurfaceName(name)) return null
      // 予約中の保存は先に書く(書く前の古いファイルを読まない)
      if (pending.has(name)) flush()
      const file = padValuesFilePath(dir, name)
      const read = readJsonFile(options.fs, file)
      if (read.kind === 'missing') return null
      const notRestored = (reason: string) => {
        // 読めないファイルは脇へ退ける(次の操作の保存で上書きして、手で直せたかもしれない値を消さないように)
        const aside = `${file}.broken-${String(now())}`
        let kept = ''
        try {
          options.fs.renameSync(file, aside)
          kept = ` (kept as "${aside}")`
        } catch { /* 退けられなくても、読めない理由の警告は出す */ }
        logWarn('(WARN, BRIDGE)', `Held values of pad "${name}" not restored: ${reason}${kept}`)
        return null
      }
      if (read.kind === 'failed') return notRestored(read.reason)
      const parsed = PadValuesFileSchema.safeParse(read.json)
      if (!parsed.success) {
        return notRestored(`"${file}" is invalid: ${parsed.error.issues.slice(0, 5).map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ')}`)
      }
      // 別の名前のファイルを手でコピーした取り違えを、黙って別のパッドへ当てない
      if (parsed.data.pad !== name) return notRestored(`"${file}" belongs to pad "${parsed.data.pad}".`)
      return { widgets: parsed.data.widgets, rows: parsed.data.rows }
    },
    save(name, values) {
      if (closed || !isValidSurfaceName(name)) return
      pending.set(name, { widgets: values.widgets.map(entry => ({ ...entry })), rows: values.rows.map(entry => ({ ...entry })) })
      if (timer === null) {
        timer = setTimeoutFn(() => {
          timer = null
          flush()
        }, delayMs)
      }
    },
    flush,
    close() {
      flush()
      closed = true
    },
  }
}
