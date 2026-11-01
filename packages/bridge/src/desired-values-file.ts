import path from 'node:path'

import { z } from 'zod'

import {
  HeldArgSchema,
  HeldKeyListSchema,
  HeldRecordRowSchema,
  HeldSpawnSchema,
  HeldValueSchema,
  isValidSurfaceName,
  type HeldValues,
  type OscArg,
} from '@oscdesk/shared'

import type { PersistedDesired } from './desired-values'

// 保持値(D-045)をブリッジ再起動をまたいで残すためのファイル(D-058)。
// 定義名ごとに 1 ファイル `<dir>/<name>.values.json`。書き込みは間引き、一時ファイル + rename で置き換える。
// fs と時計は引数で受け取り、単体テストでディスクとタイマーを差し替えられるようにする。

export const DESIRED_VALUES_FILE_FORMAT = 'oscdesk-desired-values'
// 2 でレコードの行(records)を足した(D-062)。3 で UI で管理する一覧の行に ID を持たせた(D-087)。
// 4 で「取り込んだプロジェクトの値をまだ Unity へ送っていない」印(unsentSince)を足した(D-090)。
// 5 で生成の記録(spawns。HID-385・D-115)を足した。1〜4 も読む
export const DESIRED_VALUES_FILE_VERSION = 5
// 操作のたびに書くとドラッグ中に毎秒数十回ディスクを叩く。落ちても失うのはこの間の操作だけに留める
export const DEFAULT_DESIRED_VALUES_WRITE_DELAY_MS = 500
const FILE_SUFFIX = '.values.json'

// 引数・値・行・一覧の形はプロジェクトファイル(D-090)の保持値と同じ(shared の project-file が正典)
const PersistedArgSchema = HeldArgSchema
const PersistedValueSchema = HeldValueSchema
const PersistedRecordRowSchema = HeldRecordRowSchema

const fileHeader = {
  format: z.literal(DESIRED_VALUES_FILE_FORMAT),
  surface: z.string().refine(isValidSurfaceName, { message: 'invalid surface name' }),
  savedAt: z.string(),
  values: z.array(PersistedValueSchema),
}

// version 1(HID-211)は records を持たない。読むだけで、書くのは常に現行の版
const DesiredValuesFileV1Schema = z.object({ ...fileHeader, version: z.literal(1) }).strict()

// UI で管理するキーの一覧(D-075)。行の値(records)とは別に、追加した順を持つ。無い版のファイルも読めるよう省略可。
// version 2 はキー(= Name)の並びで、行の値(records)の key も Name だった。読むだけで、ID は採用時に振る(D-087)
const LegacyKeyListSchema = z.object({ address: z.string().min(1), keys: z.array(z.string()) }).strict()
const DesiredValuesFileV2Schema = z.object({
  ...fileHeader,
  version: z.literal(2),
  records: z.array(PersistedRecordRowSchema),
  keyLists: z.array(LegacyKeyListSchema).optional(),
}).strict()

// version 3 は行ごとに変わらない ID と変えられる Name を持つ。records の key は ID(D-087)
const PersistedKeyListSchema = HeldKeyListSchema
const DesiredValuesFileV3Schema = z.object({
  ...fileHeader,
  version: z.literal(3),
  records: z.array(PersistedRecordRowSchema),
  keyLists: z.array(PersistedKeyListSchema).optional(),
}).strict()

// version 4 は version 3 に、取り込んだプロジェクトの値をまだ Unity へ送っていない印(取り込んだ時刻)を足した(D-090)。
// 印があるとブリッジ再起動後も自動の再送を止めたままにする(再起動を挟んだだけで取り込んだ値が勝手に送られないため)
const DesiredValuesFileV4Schema = z.object({
  ...fileHeader,
  version: z.literal(4),
  records: z.array(PersistedRecordRowSchema),
  keyLists: z.array(PersistedKeyListSchema).optional(),
  unsentSince: z.string().datetime({ offset: true }).optional(),
}).strict()

// version 5 は version 4 に生成の記録(HID-385・D-115)を足した。保持値と同じくブリッジの再起動をまたいで残し、
// 起動の合図(/sys/catalog/begin)を受けた PC へ生成し直す
export const DesiredValuesFileSchema = z.object({
  ...fileHeader,
  version: z.literal(DESIRED_VALUES_FILE_VERSION),
  records: z.array(PersistedRecordRowSchema),
  keyLists: z.array(PersistedKeyListSchema).optional(),
  unsentSince: z.string().datetime({ offset: true }).optional(),
  spawns: z.array(HeldSpawnSchema).optional(),
}).strict()

const ReadableDesiredValuesFileSchema = z.discriminatedUnion('version', [
  DesiredValuesFileV1Schema,
  DesiredValuesFileV2Schema,
  DesiredValuesFileV3Schema,
  DesiredValuesFileV4Schema,
  DesiredValuesFileSchema,
])

export type DesiredValuesFile = z.infer<typeof DesiredValuesFileSchema>

/** 使う fs の関数だけを抜き出した形(テストで差し替える)。 */
export interface DesiredValuesFs {
  readFileSync(file: string, encoding: 'utf8'): string
  writeFileSync(file: string, data: string, encoding: 'utf8'): void
  renameSync(from: string, to: string): void
  mkdirSync(dir: string, options: { recursive: true }): unknown
  rmSync(file: string, options: { force: true }): void
}

type TimerHandle = ReturnType<typeof setTimeout> | number
type LogFn = (message?: unknown, ...optionalParams: unknown[]) => void

export interface DesiredValuesFileStore {
  /** 保存済みの値を読む。無ければ null(警告なし)、壊れていれば警告して null(起動は止めない)。 */
  load(name: string): PersistedDesired | null
  /** 未送信の印(D-090)だけを見る。無い・読めなければ undefined(警告しない)。 */
  unsentSince(name: string): string | undefined
  /** 保存を予約する。間引いたうえで最後の値だけを書く。別の名前の予約が残っていれば先にそれを書く。 */
  save(name: string, values: PersistedDesired): void
  /** 予約中の保存をすぐ書く。 */
  flush(): void
  /** 予約中の保存を書いて、以後の予約を受けない(終了時)。 */
  close(): void
}

export function desiredValuesFilePath(dir: string, name: string): string {
  return path.join(path.resolve(dir), `${name}${FILE_SUFFIX}`)
}

export function createDesiredValuesFileStore(options: {
  dir: string
  fs: DesiredValuesFs
  now?: () => number
  delayMs?: number
  setTimeoutFn?: (cb: () => void, ms: number) => TimerHandle
  clearTimeoutFn?: (handle: TimerHandle) => void
  pid?: number
  logWarn?: LogFn
}): DesiredValuesFileStore {
  const fs = options.fs
  const now = options.now ?? Date.now
  const delayMs = options.delayMs ?? DEFAULT_DESIRED_VALUES_WRITE_DELAY_MS
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout
  const pid = options.pid ?? process.pid
  const logWarn = options.logWarn ?? console.warn
  const dir = path.resolve(options.dir)
  let pending: { name: string; values: PersistedDesired } | null = null
  let timer: TimerHandle | null = null
  let closed = false

  const write = (name: string, values: PersistedDesired) => {
    const target = desiredValuesFilePath(dir, name)
    const temp = `${target}.${String(pid)}.tmp`
    try {
      const body: DesiredValuesFile = {
        format: DESIRED_VALUES_FILE_FORMAT,
        version: DESIRED_VALUES_FILE_VERSION,
        surface: name,
        savedAt: new Date(now()).toISOString(),
        ...toHeldValues(values),
        ...(values.unsentSince === undefined ? {} : { unsentSince: values.unsentSince }),
      }
      fs.mkdirSync(dir, { recursive: true })
      // 書き込み途中の電源断・強制終了で半端なファイルを残さないよう、一時ファイルを置き換える
      fs.writeFileSync(temp, `${JSON.stringify(body, null, 2)}\n`, 'utf8')
      fs.renameSync(temp, target)
    } catch (error) {
      try { fs.rmSync(temp, { force: true }) } catch { /* 後始末の失敗は元のエラーを優先して報告する */ }
      // 書けなくても操作と再送は続ける。次の変更で再び書きに行く
      logWarn('(WARN, BRIDGE)', `Failed to save desired values for surface "${name}" to "${target}": ${describe(error)}`)
    }
  }

  const flush = () => {
    if (timer !== null) {
      clearTimeoutFn(timer)
      timer = null
    }
    if (pending === null) return
    const { name, values } = pending
    pending = null
    write(name, values)
  }

  // warn が null なら黙って読む(稼働中の採用で未送信の印だけを見るとき。D-090)
  const read = (name: string, warn: LogFn | null): PersistedDesired | null => {
      if (!isValidSurfaceName(name)) return null
      // 予約中の同じ名前の保存は先に書く(書く前の古いファイルを読まない)
      if (pending?.name === name) flush()
      const file = desiredValuesFilePath(dir, name)
      const notRestored = (reason: string) => {
        warn?.('(WARN, BRIDGE)', `Desired values for surface "${name}" not restored (starting from defaults): ${reason}`)
        return null
      }
      let text: string
      try {
        text = fs.readFileSync(file, 'utf8')
      } catch (error) {
        if (isErrorCode(error, 'ENOENT')) return null
        return notRestored(`failed to read "${file}": ${describe(error)}`)
      }
      let json: unknown
      try {
        json = JSON.parse(text.replace(/^﻿/, ''))
      } catch (error) {
        return notRestored(`"${file}" is not valid JSON: ${describe(error)}`)
      }
      const parsed = ReadableDesiredValuesFileSchema.safeParse(json)
      if (!parsed.success) {
        const issues = parsed.error.issues.slice(0, 5).map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        return notRestored(`"${file}" is invalid: ${issues.join('; ')}`)
      }
      // 別の名前のファイルを手でコピーした取り違えを、黙って別の定義へ当てない
      if (parsed.data.surface !== name) {
        return notRestored(`"${file}" belongs to surface "${parsed.data.surface}".`)
      }
      return {
        values: parsed.data.values.map(value => ({ ...value, args: value.args.map(arg => ({ ...arg }) as OscArg) })),
        records: (parsed.data.version === 1 ? [] : parsed.data.records).map(row => ({
          ...row,
          fields: row.fields.map(field => ({ ...field, arg: { ...field.arg } as OscArg })),
        })),
        ...keyListsOf(parsed.data),
        ...((parsed.data.version === 4 || parsed.data.version === DESIRED_VALUES_FILE_VERSION) && parsed.data.unsentSince !== undefined
          ? { unsentSince: parsed.data.unsentSince }
          : {}),
        ...(parsed.data.version === DESIRED_VALUES_FILE_VERSION && parsed.data.spawns !== undefined
          ? { spawns: parsed.data.spawns.map(spawn => ({ ...spawn })) }
          : {}),
      }
  }

  return {
    load: name => read(name, logWarn),
    unsentSince: name => read(name, null)?.unsentSince,
    save(name, values) {
      if (closed || !isValidSurfaceName(name)) return
      // 予約中の別の名前は失わないよう先に書く(定義を切り替えた直後の操作で前の定義の保存を落とさない)
      if (pending !== null && pending.name !== name) flush()
      pending = { name, values }
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

// version 2 の一覧は ID の無い行(name だけ)として返し、採用時に migrateLegacyRowKeys が ID を振る。3 と 4 は同じ形
function keyListsOf(data: z.infer<typeof ReadableDesiredValuesFileSchema>): Pick<PersistedDesired, 'keyLists'> {
  if (data.version === 1 || data.keyLists === undefined) return {}
  if (data.version === 2) {
    return { keyLists: data.keyLists.map(list => ({ address: list.address, rows: list.keys.map(name => ({ name })) })) }
  }
  return { keyLists: data.keyLists.map(list => ({ address: list.address, rows: list.rows.map(row => ({ ...row })) })) }
}

type PersistedArg = z.infer<typeof PersistedArgSchema>

/**
 * 保持値の全量をファイル・プロジェクトファイル(D-090)の形にする(両方の写像をここ 1 か所に置く)。
 * UI で管理するキーを使わない定義では keyLists を書かない(従来のファイルと同じ形を保つ)。
 * ID の無い行(version 2 から読んだまま)は採用時に ID を振るので、ここへは来ない。来ても書かない
 * (ID の無い行を書くと、次の読み込みで別の ID が振られて行の値と結び付かなくなる)
 */
export function toHeldValues(values: PersistedDesired): HeldValues {
  return {
    values: values.values.map(value => ({ id: value.id, address: value.address, type: value.type, args: value.args.map(toPersistedArg), ...(value.fields === undefined ? {} : { fields: value.fields.map(field => ({ ...field })) }) })),
    records: values.records.map(row => ({
      id: row.id,
      address: row.address,
      key: row.key,
      fields: row.fields.map(field => ({ id: field.id, type: field.type, arg: toPersistedArg(field.arg) })),
    })),
    ...(values.keyLists !== undefined && values.keyLists.length > 0
      ? {
          keyLists: values.keyLists.map(list => ({
            address: list.address,
            rows: list.rows.flatMap(row => row.id === undefined ? [] : [{ id: row.id, name: row.name }]),
          })),
        }
      : {}),
    // 記録が無ければ書かない(生成担当を使わない定義のファイル・プロジェクトを従来と同じ形に保つ)
    ...(values.spawns !== undefined && values.spawns.length > 0 ? { spawns: values.spawns.map(spawn => ({ ...spawn })) } : {}),
  }
}

/** toHeldValues の逆(プロジェクトファイルの取り込み。D-090)。keyLists は無ければ空の一覧として返す */
export function fromHeldValues(values: HeldValues): PersistedDesired {
  return {
    values: values.values.map(value => ({ ...value, args: value.args.map(arg => ({ ...arg }) as OscArg) })),
    records: values.records.map(row => ({ ...row, fields: row.fields.map(field => ({ ...field, arg: { ...field.arg } as OscArg })) })),
    keyLists: (values.keyLists ?? []).map(list => ({ address: list.address, rows: list.rows.map(row => ({ ...row })) })),
    // 取り込みは今の記録を捨てて置き換える(HID-385)。無ければ空の記録
    spawns: (values.spawns ?? []).map(spawn => ({ ...spawn })),
  }
}

function toPersistedArg(arg: OscArg): PersistedArg {
  if (arg.type === 'b') throw new Error('blob arguments are never held as desired values')
  return { type: arg.type, value: arg.value } as PersistedArg
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code
}
