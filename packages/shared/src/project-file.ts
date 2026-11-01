import { z } from 'zod'

import { OscPadSchema } from './osc-pad'
import { resolveOscSurface, type OscSurfaceDefinition } from './osc-definition'
import { IDENTIFIER_PATTERN, SurfaceDefinitionSchema, type SurfaceDefinition } from './surface-definition'
import { migrateSurfaceDefinition } from './surface-migration'
import { SurfaceNameSchema } from './surface-name'
import { recordFieldArgs, recordHasRowIds, recordInitialValues } from './surface-record'
import type { OscArg } from './osc-types'

// プロジェクトファイル(D-090)。採用中のサーフェス定義・その保持値・採用中の OSC パッドを 1 つの JSON にまとめ、
// ブラウザでダウンロード・アップロードして利用者が保管する。取り込みは画面と保持値を置き換えるだけで、
// Unity へは送らない(送るのは利用者の明示の操作)。正典はこの zod で、ブリッジが取り込む前に検証する。
//
// 版 2(HID-389・D-117)で、定義を版 2(本体と bindings)にし、保持値をパラメータ・レコード・一覧の id と JSON の値で
// 書くようにした。OSC 専用のもの(OSC パッド・生成の記録)は osc の欄に分ける。版 1 のファイルも取り込める
// (定義は版 2 へ移し、保持値は版 1 の形のまま使う)

export const PROJECT_FILE_FORMAT = 'oscdesk-project'
export const PROJECT_FILE_VERSION = 2
export const LEGACY_PROJECT_FILE_VERSION = 1

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

// 生成の記録(HID-385・D-115)。生成担当(アドレスが /spawn で終わる s の trigger)へ送った生成の命令を、送り先の PC
// (host)ごとに 1 件持つ。消す命令を送るか、その PC から設計図の削除通知が来るまで残り、PC が起動したとき・
// 「記録に合わせる」で送り直す。removedElsewhere は、その PC が止まっている間にほかの PC から同じものの削除通知が
// 来た印(起動して戻ったときに復元せず記録から外す)
export const SPAWN_RECORD = {
  // 生成担当 1 つが同時に残せる数の既定は 64(受け口の Max Instances)。PC と生成担当の数を見込んだ全体の上限
  MAX_ENTRIES: 4096,
  MAX_NAME_CHARS: 128,
  MAX_HOST_CHARS: 253,
} as const
// 名前はアドレスの 1 段になる(/パッケージ名/<名前>/…)ので、受け口の生成担当が断る文字(空白・制御文字・/ と
// OSC のパターン文字・#)を含まない。受け口の invalid name と同じ規則
export const SPAWN_NAME_PATTERN = /^[^\s/*?[\]{},#\u0000-\u001f\u007f]+$/u
export const isValidSpawnName = (name: string): boolean =>
  name.length > 0 && name.length <= SPAWN_RECORD.MAX_NAME_CHARS && SPAWN_NAME_PATTERN.test(name)
// 記録の address は生成担当の spawn のアドレス(/パッケージ名/対象名/spawn)だけ。取り込んだプロジェクト・保存ファイルの記録は
// 起動の合図と「Unity へ送る」でそのまま送るので、ほかのアドレス(/sys/catalog/request・任意のきっかけ)を撃たせない。
// 予約の名前空間(/sys/*・/oscdesk/*)も受けない
export const isSpawnAddress = (address: string): boolean => {
  const segments = address.split('/')
  return segments.length === 4 && segments[0] === '' && segments[3] === 'spawn'
    && segments.slice(1, 3).every(segment => isValidSpawnName(segment))
    && segments[1] !== 'sys' && segments[1] !== 'oscdesk'
}
export const HeldSpawnSchema = z.object({
  param: z.string().min(1),
  address: z.string().refine(isSpawnAddress, { message: 'not a spawner address (/<package>/<target>/spawn)' }),  name: z.string().refine(isValidSpawnName, { message: 'invalid spawn name' }),
  host: z.string().min(1).max(SPAWN_RECORD.MAX_HOST_CHARS),
  removedElsewhere: z.literal(true).optional(),
}).strict()

export const HeldValuesSchema = z.object({
  values: z.array(HeldValueSchema),
  records: z.array(HeldRecordRowSchema),
  keyLists: z.array(HeldKeyListSchema).optional(),
  spawns: z.array(HeldSpawnSchema).optional(),
}).strict()

// プロジェクトの保持値は、保存ファイルと同じ形に行数の上限を足したもの(保存ファイルの読み込みには上限を足さない。
// 既存の現場のファイルを読めなくしないため。取り込みは外から来るファイルなので抑える)
const ProjectHeldValuesSchema = z.object({
  values: z.array(HeldValueSchema),
  records: z.array(HeldRecordRowSchema).max(PROJECT_FILE.MAX_HELD_ROWS),
  keyLists: z.array(HeldKeyListSchema.extend({
    rows: z.array(z.object({ id: z.string().min(1), name: z.string() }).strict()).max(PROJECT_FILE.MAX_KEY_LIST_ROWS),
  }).strict()).optional(),
  // 生成の記録(HID-385)。読み込むと今の記録と置き換わり、「Unity へ送る」まで自動では復元しない
  spawns: z.array(HeldSpawnSchema).max(SPAWN_RECORD.MAX_ENTRIES).optional(),
}).strict()

// 取り込んだ後の保持値の行数と大きさ(desired・runtimeOptions)の上限を確かめる(PR #80 のレビュー指摘)
function checkExpandedSize(definition: OscSurfaceDefinition, values: HeldValues, context: z.RefinementCtx, valuesPath: (string | number)[]): void {
  const expanded = estimateImportedDesired(definition, values)
  if (expanded.rows > PROJECT_FILE.MAX_HELD_ROWS) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: valuesPath, message: `held values expand to ${String(expanded.rows)} record rows (limit ${String(PROJECT_FILE.MAX_HELD_ROWS)})` })
  }
  if (expanded.bytes > PROJECT_FILE.MAX_DESIRED_BYTES) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: valuesPath, message: `held values expand to about ${String(expanded.bytes)} bytes (limit ${String(PROJECT_FILE.MAX_DESIRED_BYTES)})` })
  }
  if (expanded.optionsBytes > PROJECT_FILE.MAX_DESIRED_BYTES) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: [...valuesPath, 'keyLists'], message: `UI-managed lists expand to about ${String(expanded.optionsBytes)} bytes of runtime options (limit ${String(PROJECT_FILE.MAX_DESIRED_BYTES)})` })
  }
}

const ProjectPadSchema = z.object({
  name: SurfaceNameSchema,
  pad: OscPadSchema,
}).strict()

// 版 1 のプロジェクトファイル。定義は版 2 へ移してから検証し、保持値は OSC のアドレスで書いた形(保存ファイルと同じ)のまま
export const LegacyProjectFileSchema = z.object({
  format: z.literal(PROJECT_FILE_FORMAT),
  version: z.literal(LEGACY_PROJECT_FILE_VERSION),
  exportedAt: z.string().datetime({ offset: true }),
  surface: z.object({
    name: SurfaceNameSchema,
    definition: z.preprocess(migrateSurfaceDefinition, SurfaceDefinitionSchema),
    values: ProjectHeldValuesSchema,
  }).strict().superRefine((surface, context) => {
    if (surface.definition.bindings?.osc === undefined) return
    checkExpandedSize(resolveOscSurface(surface.definition), surface.values, context, ['values'])
  }).nullable(),
  pad: ProjectPadSchema.nullable(),
}).strict().refine(project => project.surface !== null || project.pad !== null, {
  message: 'project must contain a surface or a pad',
})

// 保持値の値(パラメータの値・行のフィールドの値)。型タグを付けない JSON の値(HID-373)
const ProjectValueSchema = z.union([z.number().finite(), z.string(), z.boolean()])
const identifierSchema = z.string().regex(new RegExp(IDENTIFIER_PATTERN))
// 版 2 の保持値。パラメータは id と値、レコードの行は id・キー・フィールド id ごとの値、UI で管理する一覧は一覧の id と行。
// 定義に無い id・型の合わない値は、取り込みで(保存ファイルからの復元と同じく)落とし、default に戻す
export const ProjectValuesSchema = z.object({
  values: z.array(z.object({ param: identifierSchema, value: ProjectValueSchema }).strict()),
  // フィールドの id は identifier に縛る(z.string() の record は `__proto__` を黙って落とす)
  rows: z.array(z.object({
    record: identifierSchema,
    key: z.string(),
    values: z.record(identifierSchema, ProjectValueSchema),
  }).strict()).max(PROJECT_FILE.MAX_HELD_ROWS),
  keyLists: z.array(z.object({
    list: identifierSchema,
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
    values: ProjectValuesSchema,
    // OSC 専用のもの。生成の記録(HID-385)は生成担当の OSC のアドレスで持つ。読み込むと今の記録と置き換わり、
    // 「Unity へ送る」まで自動では復元しない
    osc: z.object({
      spawns: z.array(HeldSpawnSchema).max(SPAWN_RECORD.MAX_ENTRIES).optional(),
    }).strict().optional(),
  }).strict().superRefine((surface, context) => {
    // 取り込んだ定義はそのまま採用するので、ブリッジの通信アダプタ(OSC)の結び付けが無ければ送れない
    if (surface.definition.bindings?.osc === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['definition', 'bindings'], message: 'surface needs osc bindings' })
      return
    }
    const held = projectValuesToHeld(surface.definition, surface.values)
    checkExpandedSize(resolveOscSurface(surface.definition), held, context, ['values'])
  }).nullable(),
  // OSC 専用のもの(OSC パッド。D-080)
  osc: z.object({
    pad: ProjectPadSchema.nullable(),
  }).strict().optional(),
}).strict().refine(project => project.surface !== null || (project.osc?.pad ?? null) !== null, {
  message: 'project must contain a surface or a pad',
})

export type HeldArg = z.infer<typeof HeldArgSchema>
export type HeldValues = z.infer<typeof HeldValuesSchema>
export type ProjectFile = z.infer<typeof ProjectFileSchema>
export type LegacyProjectFile = z.infer<typeof LegacyProjectFileSchema>
export type ProjectValues = z.infer<typeof ProjectValuesSchema>
type ProjectValue = z.infer<typeof ProjectValueSchema>

/** 型どおりの OSC の引数にする(bool は i の 0/1。D-017)。型に合わなければ undefined。値域・options は見ない */
export function valueToHeldArg(type: 'i' | 'f' | 's' | 'bool', value: ProjectValue): HeldArg | undefined {
  switch (type) {
    case 'i':
      return typeof value === 'number' && Number.isInteger(value) && value >= INT32_MIN && value <= INT32_MAX ? { type: 'i', value } : undefined
    case 'f':
      return typeof value === 'number' && Number.isFinite(value) ? { type: 'f', value } : undefined
    case 's':
      return typeof value === 'string' ? { type: 's', value } : undefined
    case 'bool':
      return typeof value === 'boolean' ? { type: 'i', value: value ? 1 : 0 } : undefined
  }
}

/** OSC の引数を型どおりの JSON の値にする(bool は 0/1 を真偽に)。読めなければ undefined */
export function heldArgToValue(type: 'i' | 'f' | 's' | 'bool', arg: OscArg | HeldArg): ProjectValue | undefined {
  if (type === 's') return arg.type === 's' ? arg.value : undefined
  if (arg.type !== 'i' && arg.type !== 'f') return undefined
  if (!Number.isFinite(arg.value)) return undefined
  if (type === 'bool') return arg.value === 0 ? false : arg.value === 1 ? true : undefined
  return arg.value
}

/**
 * 版 2 の保持値を、保存ファイルと同じ OSC のアドレスで書いた形にする(取り込み・大きさの見積もり)。
 * 定義(結び付けを含む)に無い id・型の合わない値は落とす。結び付けが無ければ空
 */
export function projectValuesToHeld(definition: SurfaceDefinition, values: ProjectValues): HeldValues {
  const osc = definition.bindings?.osc
  if (osc === undefined) return { values: [], records: [] }
  const parameterAddresses = new Map(osc.parameters.map(binding => [binding.id, binding.address]))
  const recordAddresses = new Map((osc.records ?? []).map(binding => [binding.id, binding.address]))
  const listAddresses = new Map((osc.lists ?? []).map(binding => [binding.id, binding.address]))
  const parameters = new Map(definition.parameters.map(parameter => [parameter.id, parameter]))
  const records = new Map((definition.records ?? []).map(record => [record.id, record]))
  const heldValues: HeldValues['values'] = []
  for (const entry of values.values) {
    const parameter = parameters.get(entry.param)
    const address = parameterAddresses.get(entry.param)
    if (parameter === undefined || address === undefined) continue
    const arg = valueToHeldArg(parameter.type, entry.value)
    if (arg !== undefined) heldValues.push({ id: parameter.id, address, type: parameter.type, args: [arg] })
  }
  const heldRows: HeldValues['records'] = []
  for (const row of values.rows) {
    const record = records.get(row.record)
    const address = recordAddresses.get(row.record)
    if (record === undefined || address === undefined) continue
    const fields: HeldValues['records'][number]['fields'] = []
    for (const field of record.fields) {
      if (!Object.prototype.hasOwnProperty.call(row.values, field.id)) continue
      const arg = valueToHeldArg(field.type, row.values[field.id]!)
      if (arg !== undefined) fields.push({ id: field.id, type: field.type, arg })
    }
    heldRows.push({ id: record.id, address, key: row.key, fields })
  }
  const keyLists = (values.keyLists ?? []).flatMap(list => {
    const address = listAddresses.get(list.list)
    return address === undefined ? [] : [{ address, rows: list.rows.map(row => ({ ...row })) }]
  })
  return { values: heldValues, records: heldRows, ...(keyLists.length === 0 ? {} : { keyLists }) }
}

/** projectValuesToHeld の逆(書き出し)。定義の結び付けに無いアドレスの値は落とす */
export function heldToProjectValues(definition: SurfaceDefinition, held: Pick<HeldValues, 'values' | 'records' | 'keyLists'>): ProjectValues {
  const osc = definition.bindings?.osc
  if (osc === undefined) return { values: [], rows: [] }
  const parameterIds = new Map(osc.parameters.map(binding => [binding.address, binding.id]))
  const recordIds = new Map((osc.records ?? []).map(binding => [binding.address, binding.id]))
  const listIds = new Map((osc.lists ?? []).map(binding => [binding.address, binding.id]))
  const values: ProjectValues['values'] = []
  for (const entry of held.values) {
    const param = parameterIds.get(entry.address)
    const arg = entry.args[0]
    if (param === undefined || param !== entry.id || arg === undefined) continue
    const value = heldArgToValue(entry.type, arg)
    if (value !== undefined) values.push({ param, value })
  }
  const rows: ProjectValues['rows'] = []
  for (const row of held.records) {
    const record = recordIds.get(row.address)
    if (record === undefined || record !== row.id) continue
    const fieldValues: Record<string, ProjectValue> = {}
    for (const field of row.fields) {
      const value = heldArgToValue(field.type, field.arg)
      if (value !== undefined) fieldValues[field.id] = value
    }
    rows.push({ record, key: row.key, values: fieldValues })
  }
  const keyLists = (held.keyLists ?? []).flatMap(list => {
    const id = listIds.get(list.address)
    return id === undefined ? [] : [{ list: id, rows: list.rows.map(row => ({ id: row.id, name: row.name })) }]
  })
  return { values, rows, ...(keyLists.length === 0 ? {} : { keyLists }) }
}

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
export function estimateImportedDesired(definition: OscSurfaceDefinition, values: Pick<HeldValues, 'values' | 'records' | 'keyLists'>): { rows: number; bytes: number; optionsBytes: number } {
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
