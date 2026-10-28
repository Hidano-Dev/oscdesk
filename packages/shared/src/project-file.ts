import { z } from 'zod'

import { OscPadSchema } from './osc-pad'
import { SurfaceDefinitionSchema, type SurfaceDefinition } from './surface-definition'
import { SurfaceNameSchema } from './surface-name'
import { recordFieldArgs, recordHasRowIds, recordInitialValues } from './surface-record'

// プロジェクトファイル(D-090)。採用中のサーフェス定義・その保持値・採用中の OSC パッドを 1 つの JSON にまとめ、
// ブラウザでダウンロード・アップロードして利用者が保管する。取り込みは画面と保持値を置き換えるだけで、
// Unity へは送らない(送るのは利用者の明示の操作)。正典はこの zod で、ブリッジが取り込む前に検証する。

export const PROJECT_FILE_FORMAT = 'oscdesk-project'
export const PROJECT_FILE_VERSION = 1

export const PROJECT_FILE = {
  // プロジェクトの JSON(区切りの空白なし、UTF-8)の上限。書き出しは project フレームで UI へ届き、UI の受信上限は
  // 16 MiB(D-071)なので、パッドの上限 8 MiB(D-080)と定義・保持値を収めつつ余裕を残す値にする
  MAX_SERIALIZED_BYTES: 12 * 1024 * 1024,
  // 書き出しの要求と応答を結ぶ印。UI のプロセスはブラウザのページを複数抱えるので、どのページの要求かを返す
  MAX_REQUEST_ID_CHARS: 64,
  // UI で管理する一覧 1 つの行数の上限(定義の keysFrom.max の上限 1000 と同じ)。取り込む一覧の行は、一覧を共有する
  // state レコードの数だけ保持値の行に展開されるので、行数と展開後の大きさを採用の前に抑える(PR #80 のレビュー指摘)
  MAX_KEY_LIST_ROWS: 1000,
  // 保持値のレコードの行の上限(UI で管理する一覧の行の展開を含む)
  MAX_HELD_ROWS: 20_000,
  // 取り込み後の desired(full)の大きさの見積もりの上限。desired は全 UI へ配り、UI の受信上限は 16 MiB(D-071)なので、
  // 見積もりの誤差を見込んで半分に抑える。超えると再接続のたびに受け切れないフレームを配り続ける
  MAX_DESIRED_BYTES: 8 * 1024 * 1024,
} as const

const INT32_MIN = -2147483648
const INT32_MAX = 2147483647

// 保持値に入るのは state の i / f / s(bool は i の 0/1)だけなので、blob は受けない。
// 形は保持値の保存ファイル(D-058 / D-087)と同じで、ブリッジの desired-values-file もこれを使う
export const HeldArgSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('i'), value: z.number().int().min(INT32_MIN).max(INT32_MAX) }).strict(),
  z.object({ type: z.literal('f'), value: z.number().finite() }).strict(),
  z.object({ type: z.literal('s'), value: z.string() }).strict(),
])

export const HeldValueSchema = z.object({
  id: z.string().min(1),
  address: z.string().min(1),
  type: z.enum(['i', 'f', 's', 'bool']),
  args: z.array(HeldArgSchema),
}).strict()

// レコードの 1 行(D-062)。フィールドは位置でなく id で照合するので、定義でフィールドを並べ替えても戻せる。
// key は行のキーで、UI で管理する一覧のレコード(D-087)では行の ID
export const HeldRecordRowSchema = z.object({
  id: z.string().min(1),
  address: z.string().min(1),
  key: z.string(),
  fields: z.array(z.object({
    id: z.string().min(1),
    type: z.enum(['i', 'f', 's', 'bool']),
    arg: HeldArgSchema,
  }).strict()),
}).strict()

// UI で管理する一覧(D-075 / D-087)。行ごとに変わらない ID と変えられる Name を、追加した順に持つ
export const HeldKeyListSchema = z.object({
  address: z.string().min(1),
  rows: z.array(z.object({ id: z.string().min(1), name: z.string() }).strict()),
}).strict()

export const HeldValuesSchema = z.object({
  values: z.array(HeldValueSchema),
  records: z.array(HeldRecordRowSchema),
  keyLists: z.array(HeldKeyListSchema).optional(),
}).strict()

// プロジェクトの保持値は、保存ファイルと同じ形に行数の上限を足したもの(保存ファイルの読み込みには上限を足さない。
// 既存の現場のファイルを読めなくしないため。取り込みは外から来るファイルなので抑える)
const ProjectHeldValuesSchema = z.object({
  values: z.array(HeldValueSchema),
  records: z.array(HeldRecordRowSchema).max(PROJECT_FILE.MAX_HELD_ROWS),
  keyLists: z.array(HeldKeyListSchema.extend({
    rows: z.array(z.object({ id: z.string().min(1), name: z.string() }).strict()).max(PROJECT_FILE.MAX_KEY_LIST_ROWS),
  }).strict()).optional(),
}).strict()

export const ProjectFileSchema = z.object({
  format: z.literal(PROJECT_FILE_FORMAT),
  version: z.literal(PROJECT_FILE_VERSION),
  exportedAt: z.string().datetime({ offset: true }),
  // 保持値は定義ごとに意味が決まる(照合は定義の id・型・値域で行う。D-058)ので、定義の中に置く
  surface: z.object({
    name: SurfaceNameSchema,
    definition: SurfaceDefinitionSchema,
    values: ProjectHeldValuesSchema,
  }).strict().superRefine((surface, context) => {
    const expanded = estimateImportedDesired(surface.definition, surface.values)
    if (expanded.rows > PROJECT_FILE.MAX_HELD_ROWS) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['values'], message: `held values expand to ${String(expanded.rows)} record rows (limit ${String(PROJECT_FILE.MAX_HELD_ROWS)})` })
    }
    if (expanded.bytes > PROJECT_FILE.MAX_DESIRED_BYTES) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['values'], message: `held values expand to about ${String(expanded.bytes)} bytes (limit ${String(PROJECT_FILE.MAX_DESIRED_BYTES)})` })
    }
    if (expanded.optionsBytes > PROJECT_FILE.MAX_DESIRED_BYTES) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['values', 'keyLists'], message: `UI-managed lists expand to about ${String(expanded.optionsBytes)} bytes of runtime options (limit ${String(PROJECT_FILE.MAX_DESIRED_BYTES)})` })
    }
  }).nullable(),
  pad: z.object({
    name: SurfaceNameSchema,
    pad: OscPadSchema,
  }).strict().nullable(),
}).strict().refine(project => project.surface !== null || project.pad !== null, {
  message: 'project must contain a surface or a pad',
})

export type HeldArg = z.infer<typeof HeldArgSchema>
export type HeldValues = z.infer<typeof HeldValuesSchema>
export type ProjectFile = z.infer<typeof ProjectFileSchema>

const utf8Bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length

// desired の 1 エントリの枠({"address":…,"args":[…]} と引数の {"type":…,"value":…})の見込み。中身の JSON に足す
const ENTRY_OVERHEAD_BYTES = 32
const ARG_OVERHEAD_BYTES = 24

/**
 * 取り込んだ後(採用で戻した後)の保持値のレコードの行数と、desired(full)の大きさの見積もり。ブリッジは採用のとき、
 * UI で管理する一覧の行を一覧を共有する state レコードごとの行へ展開し(D-075 / D-087)、ファイルの行に欠けたフィールドを
 * default で補う(D-058 の carryFields)ので、ファイルの大きさだけでは抑えられない。採用後の行をそのまま数える:
 * - 行は state レコードごとに、UI で管理する一覧ならその一覧の行(keysFrom.max まで。一覧に無い行は採用で落ちる)、
 *   Unity の一覧から行ができるレコードならファイルにあるそのレコードの行(キーごとに 1 行)。同じ行を二重に数えない
 * - フィールドはファイルの値と default の大きいほう(型が合わなければ default に戻るので、上限として数える)
 * - パラメータはファイルの値と default の大きいほう
 * 定義に無いレコード・パラメータの値は採用で落ちるので数えない
 */
export function estimateImportedDesired(definition: SurfaceDefinition, values: Pick<HeldValues, 'values' | 'records' | 'keyLists'>): { rows: number; bytes: number; optionsBytes: number } {
  let rows = 0
  let bytes = 0
  // runtimeOptions の keys / names は、UI で管理する一覧を参照するレコードごと(trigger も含む)に一覧の ID と Name を複製する
  // (D-087)。desired と別のフレームなので別に数える(PR #80 のセキュリティレビュー指摘)
  let optionsBytes = 0
  for (const record of definition.records ?? []) {
    if (!recordHasRowIds(record)) continue
    const list = values.keyLists?.find(candidate => candidate.address === record.keysFrom.address)
    if (list === undefined) continue
    const listed = list.rows.slice(0, Math.min(list.rows.length, record.keysFrom.max ?? Number.POSITIVE_INFINITY))
    optionsBytes += utf8Bytes(record.id) + ENTRY_OVERHEAD_BYTES + utf8Bytes(listed.map(row => row.id)) + utf8Bytes(listed.map(row => row.name))
  }
  for (const param of definition.parameters) {
    if (param.kind !== 'state' || param.standalone === false) continue
    const held = values.values.find(value => value.address === param.address)
    const fromFile = held === undefined ? 0 : utf8Bytes(held.args)
    const fromDefault = param.default === undefined ? 0 : utf8Bytes(param.default) + ARG_OVERHEAD_BYTES
    bytes += utf8Bytes(param.address) + ENTRY_OVERHEAD_BYTES + Math.max(fromFile, fromDefault)
  }
  for (const record of definition.records ?? []) {
    if (record.kind !== 'state') continue
    const defaults = recordFieldArgs(record, recordInitialValues(record)).map(arg => utf8Bytes(arg))
    const fileRows = new Map<string, (typeof values.records)[number]>()
    for (const row of values.records) {
      if (row.id === record.id && row.address === record.address && row.key !== '') fileRows.set(row.key, row)
    }
    // 行のキー(と Name)の一覧
    let keys: { key: string; name?: string }[]
    if (recordHasRowIds(record)) {
      const list = values.keyLists?.find(candidate => candidate.address === record.keysFrom.address)
      const listed = list?.rows ?? []
      keys = listed.slice(0, Math.min(listed.length, record.keysFrom.max ?? Number.POSITIVE_INFINITY)).map(row => ({ key: row.id, name: row.name }))
    } else {
      keys = [...fileRows.keys()].map(key => ({ key }))
    }
    const address = utf8Bytes(record.address) + ENTRY_OVERHEAD_BYTES
    for (const { key, name } of keys) {
      const fileRow = fileRows.get(key)
      let rowBytes = address + utf8Bytes(key) + ARG_OVERHEAD_BYTES + (name === undefined ? 0 : utf8Bytes(name) + ARG_OVERHEAD_BYTES)
      record.fields.forEach((field, index) => {
        const held = fileRow?.fields.find(candidate => candidate.id === field.id)
        rowBytes += Math.max(defaults[index]!, held === undefined ? 0 : utf8Bytes(held.arg))
      })
      rows += 1
      bytes += rowBytes
    }
  }
  return { rows, bytes, optionsBytes }
}

/** プロジェクトの JSON(区切りの空白なし)の UTF-8 のバイト数。取り込み・書き出しの上限(MAX_SERIALIZED_BYTES)と比べる。 */
export function projectSerializedBytes(project: unknown): number {
  return new TextEncoder().encode(JSON.stringify(project)).length
}
