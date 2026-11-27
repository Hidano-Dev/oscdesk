import { z } from 'zod'

import { OSC_BATCH } from './limits'
import { hasLoneSurrogate, imageDataUrlBytes, OSC_PAD, OSC_PAD_FORMAT } from './osc-pad'

// パッドの文書の版 2(D-167)。画面を作る仕組みをパッド 1 つにまとめる作り直し(D-163)の土台で、版 1(D-080。決まった値を
// 送るボタンだけの格子)の格子に、値を持つ部品・組み合わせの型・表(繰り返し)を置けるようにする。
// 判定の正はここ(shared)とブリッジだけで、UI は写しを持たない(D-122・D-126)。版 1 のパッドは読み込むときに
// pad-migration.ts で版 2 へ直す。
//
// 部品はどれも id・種類(kind)・位置(row・column と広がり)・ラベル・背景色を持つ。アドレスと型は部品の種類ごとに置く
// (表は行と欄でアドレスが決まるため、共通の 1 つのアドレスを持たない)。
// bool は部品のアドレスの型に従って送る: type 'T' は OSC 1.0 の T / F の型タグ、type 'i' は 0 / 1(D-017 の形)。

export const PAD_DOCUMENT_VERSION = 2

export const PAD_DOCUMENT = {
  MAX_ROWS: OSC_PAD.MAX_ROWS,
  MAX_COLUMNS: OSC_PAD.MAX_COLUMNS,
  MAX_WIDGETS: OSC_PAD.MAX_ROWS * OSC_PAD.MAX_COLUMNS,
  MAX_ARGS: OSC_PAD.MAX_ARGS,
  MAX_LABEL_CHARS: OSC_PAD.MAX_LABEL_CHARS,
  MAX_STRING_CHARS: OSC_PAD.MAX_STRING_ARG_CHARS,
  MAX_ADDRESS_CHARS: OSC_PAD.MAX_ADDRESS_CHARS,
  MAX_IMAGE_BYTES: OSC_PAD.MAX_IMAGE_BYTES,
  MAX_TOTAL_IMAGE_BYTES: OSC_PAD.MAX_TOTAL_IMAGE_BYTES,
  MAX_SERIALIZED_BYTES: OSC_PAD.MAX_SERIALIZED_BYTES,
  // 選択の候補の数。OSCQuery の VALS をそのまま受けられる程度に持つ
  MAX_OPTIONS: 256,
  // 組み合わせの型の引数の数。送信ログが切り詰めずに見せられる個数(引数の上限)に揃える
  MAX_FIELDS: OSC_PAD.MAX_ARGS,
  MAX_TABLE_COLUMNS: 16,
  // UI で管理する行の数(サーフェス定義の keysFrom.max の上限 1000 と同じ。D-075)
  MAX_TABLE_ROWS: 1000,
  MAX_TABLE_ACTIONS: 16,
  // 行のキーは行ごとのアドレスの 1 段になる(/member/<キー>/active。D-164)
  MAX_ROW_KEY_CHARS: 64,
} as const

const INT32_MIN = -2147483648
const INT32_MAX = 2147483647

const IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/
const IMAGE_DATA_URL_PATTERN = /^data:image\/(?:png|jpeg|gif|webp);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
/**
 * 部品のアドレス(具体アドレス)。版 1 のボタンと同じ規則で、/sys/*・/oscdesk/* と、パターン文字・空白・空のパート・
 * 末尾の / を拒否する。サーフェス定義の PARAMETER_ADDRESS_PATTERN と同じ文字列だが、定義の形式は撤去する予定(D-163)
 * なので、パッドの形式はそちらを import しない
 */
export const PAD_ADDRESS_PATTERN = '^(?!/(?:sys|oscdesk)(?:/|(?![\\s\\S])))(?:/[^\\s/?\\[\\]{},*]+)+(?![\\s\\S])'
/** 表の欄・アクションのアドレス(行のアドレスの後ろに付ける相対のパス。先頭の / を持たない) */
export const PAD_RELATIVE_ADDRESS_PATTERN = '^[^\\s/?\\[\\]{},*]+(?:/[^\\s/?\\[\\]{},*]+)*(?![\\s\\S])'
/** 行のキー。行ごとのアドレスの 1 段になるので ASCII の英数字と _ - だけ(表示名は label に書く。D-164) */
export const PAD_ROW_KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

const oscText = (max: number, what: string, pattern?: string) => (pattern === undefined ? z.string().max(max) : z.string().max(max).regex(new RegExp(pattern)))
  // OSC の文字列は NUL で終わるので、途中の NUL は受け側で切れる。孤立サロゲートは UTF-8 化で U+FFFD に化ける
  .refine(value => !value.includes('\0'), { message: `${what} must not contain NUL` })
  .refine(value => !hasLoneSurrogate(value), { message: `${what} must not contain lone surrogates` })

export const PadAddressSchema = oscText(PAD_DOCUMENT.MAX_ADDRESS_CHARS, 'address', PAD_ADDRESS_PATTERN)
export const PadRelativeAddressSchema = oscText(PAD_DOCUMENT.MAX_ADDRESS_CHARS, 'address', PAD_RELATIVE_ADDRESS_PATTERN)
const IdentifierSchema = z.string().regex(IDENTIFIER_PATTERN)
const LabelSchema = z.string().max(PAD_DOCUMENT.MAX_LABEL_CHARS)
const ColorSchema = z.string().regex(COLOR_PATTERN)
const Int32Schema = z.number().int().min(INT32_MIN).max(INT32_MAX)
// OSC の f は float32。有限でも float32 に収まらない値(1e300 など)は Unity で +Inf になる
const Float32Schema = z.number().finite().refine(value => Number.isFinite(Math.fround(value)), { message: 'f must fit in float32' })
const OscStringSchema = oscText(PAD_DOCUMENT.MAX_STRING_CHARS, 's')

// --- 決まった値(ボタンとアクションの引数) ---------------------------------------------

// 版 1 の i / f / s に、OSC 1.0 の T / F(値を持たない型タグ)を足す(D-167)
export const PadArgSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('i'), value: Int32Schema }).strict(),
  z.object({ type: z.literal('f'), value: Float32Schema }).strict(),
  z.object({ type: z.literal('s'), value: OscStringSchema }).strict(),
  z.object({ type: z.literal('T') }).strict(),
  z.object({ type: z.literal('F') }).strict(),
])
export const PAD_ARG_TYPES = ['i', 'f', 's', 'T', 'F'] as const

// --- 値を持つ操作(部品・組み合わせの引数・表の欄が共通に持つ) -----------------------------

const OptionValueSchema = z.union([z.number(), z.string()])
const OptionSchema = z.object({ value: OptionValueSchema, label: LabelSchema.optional() }).strict()

/**
 * 値を持つ操作の種類ごとの欄。type はアドレスの OSC の型タグで、送る引数の型を決める。
 * 値域・候補が型に合うか(i は int32 の整数、f は float32 に収まる、min < max など)は意味検証(collectControlIssues)で見る
 */
const controlShapes = {
  // T: T / F の型タグで送る。i: 0 / 1 で送る(D-017 の形)
  toggle: { kind: z.literal('toggle'), type: z.enum(['T', 'i']) },
  slider: { kind: z.literal('slider'), type: z.enum(['i', 'f']), min: z.number().finite(), max: z.number().finite(), step: z.number().finite().positive().optional() },
  select: { kind: z.literal('select'), type: z.enum(['i', 'f', 's']), options: z.array(OptionSchema).min(1).max(PAD_DOCUMENT.MAX_OPTIONS) },
  // 範囲の片側だけも書ける(OSCQuery の RANGE は MIN だけ・MAX だけもある)
  number: { kind: z.literal('number'), type: z.enum(['i', 'f']), min: z.number().finite().optional(), max: z.number().finite().optional(), step: z.number().finite().positive().optional() },
  text: { kind: z.literal('text'), type: z.literal('s'), maxLength: z.number().int().min(1).max(PAD_DOCUMENT.MAX_STRING_CHARS).optional() },
  // r: OSC 1.0 の RGBA の 32 ビット色。ffff: 0〜1 の小数 4 つ(OSCQuery で EXTENDED_TYPE が色のもの)
  color: { kind: z.literal('color'), type: z.enum(['r', 'ffff']) },
} as const

/** 組み合わせの引数と表の欄に置ける操作(色は 1 つのアドレスの部品だけ) */
export const PAD_FIELD_KINDS = ['toggle', 'slider', 'select', 'number', 'text'] as const
export const PAD_VALUE_KINDS = ['toggle', 'slider', 'select', 'number', 'text', 'color'] as const
export const PAD_WIDGET_KINDS = ['button', ...PAD_VALUE_KINDS, 'composite', 'table'] as const
export type PadFieldKind = (typeof PAD_FIELD_KINDS)[number]
export type PadValueKind = (typeof PAD_VALUE_KINDS)[number]
export type PadWidgetKind = (typeof PAD_WIDGET_KINDS)[number]

// 値を持つ部品の振る舞い。resend は「送り直す」(D-165。既定オン。自動の再送・手動の同期で送るか)。
// readOnly は表示だけ(OSCQuery の ACCESS 1。送らないので再送もしない)
const holdingFields = {
  resend: z.boolean().default(true),
  readOnly: z.boolean().optional(),
}

// --- 部品 -----------------------------------------------------------------------------

const commonFields = {
  id: IdentifierSchema,
  // 0 始まりのマス(左上)。格子の外・重なりは意味検証で拒否する
  row: z.number().int().min(0).max(PAD_DOCUMENT.MAX_ROWS - 1),
  column: z.number().int().min(0).max(PAD_DOCUMENT.MAX_COLUMNS - 1),
  // 占めるマスの数(省略は 1)。スライダーや表を広く置くため
  rowSpan: z.number().int().min(1).max(PAD_DOCUMENT.MAX_ROWS).optional(),
  columnSpan: z.number().int().min(1).max(PAD_DOCUMENT.MAX_COLUMNS).optional(),
  // 画像や色だけのボタンもあり得るので空を許す。画面に出すだけで OSC に載らない
  label: LabelSchema,
  color: ColorSchema.optional(),
}

// 種類ごとの z.object は総称の関数で組まずに書き並べる(総称にすると discriminatedUnion が種類の欄を読めない)
const fieldBase = { id: IdentifierSchema, label: LabelSchema }
/** 組み合わせの型の引数 1 つ(宣言順に並べて 1 つのアドレスへ送る) */
export const PadFieldSchema = z.discriminatedUnion('kind', [
  z.object({ ...fieldBase, ...controlShapes.toggle }).strict(),
  z.object({ ...fieldBase, ...controlShapes.slider }).strict(),
  z.object({ ...fieldBase, ...controlShapes.select }).strict(),
  z.object({ ...fieldBase, ...controlShapes.number }).strict(),
  z.object({ ...fieldBase, ...controlShapes.text }).strict(),
])

const columnBase = {
  ...fieldBase,
  // 行のアドレスの後ろに付ける相対のパス(/member/<キー>/<address>)。欄ごとのアドレスで送る(D-164)
  address: PadRelativeAddressSchema,
  resend: z.boolean().default(true),
  // 欄の一括トグル(トグルの欄だけ。意味検証で見る)。全行を同じ値にする
  bulk: z.boolean().optional(),
}
/** 表の欄 1 つ */
export const PadTableColumnSchema = z.discriminatedUnion('kind', [
  z.object({ ...columnBase, ...controlShapes.toggle }).strict(),
  z.object({ ...columnBase, ...controlShapes.slider }).strict(),
  z.object({ ...columnBase, ...controlShapes.select }).strict(),
  z.object({ ...columnBase, ...controlShapes.number }).strict(),
  z.object({ ...columnBase, ...controlShapes.text }).strict(),
])

export const PadRowKeySchema = z.string().regex(PAD_ROW_KEY_PATTERN)
/**
 * 表の行の出どころ。target: ターゲットが持つ行で、OSCQuery の名前空間で表のアドレスの下にある子のノード
 * (パスは ASCII の ID、表示名は DESCRIPTION。行の増減は PATH_ADDED / PATH_REMOVED で知る。D-164)。
 * ui: UI で管理する行で、パッドの中に一覧を持つ(D-075)。keysAddress を書くと、ブリッジは行の ID の並びをそこへ送る
 */
export const PadTableRowsSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('target') }).strict(),
  z.object({
    source: z.literal('ui'),
    keys: z.array(z.object({ key: PadRowKeySchema, label: LabelSchema }).strict()).max(PAD_DOCUMENT.MAX_TABLE_ROWS),
    max: z.number().int().min(1).max(PAD_DOCUMENT.MAX_TABLE_ROWS).optional(),
    keysAddress: PadAddressSchema.optional(),
  }).strict(),
])

/**
 * 表のアクション。row: 各行の末尾に出し、押した行の /<表のアドレス>/<キー>/<address> へ args を送る。
 * all: 表に 1 つ出し、全行について行ごとに同じものを送る
 */
export const PadTableActionSchema = z.object({
  id: IdentifierSchema,
  label: LabelSchema,
  scope: z.enum(['row', 'all']),
  address: PadRelativeAddressSchema,
  args: z.array(PadArgSchema).max(PAD_DOCUMENT.MAX_ARGS),
}).strict()

const valueBase = { ...commonFields, address: PadAddressSchema, ...holdingFields }

export const PadWidgetSchema = z.discriminatedUnion('kind', [
  // 決まった値を 1 回送る(版 1 のボタン)。保持値・再送に載せない
  z.object({
    ...commonFields,
    kind: z.literal('button'),
    image: z.string().regex(IMAGE_DATA_URL_PATTERN).optional(),
    address: PadAddressSchema,
    args: z.array(PadArgSchema).max(PAD_DOCUMENT.MAX_ARGS),
  }).strict(),
  z.object({ ...valueBase, ...controlShapes.toggle }).strict(),
  z.object({ ...valueBase, ...controlShapes.slider }).strict(),
  z.object({ ...valueBase, ...controlShapes.select }).strict(),
  z.object({ ...valueBase, ...controlShapes.number }).strict(),
  z.object({ ...valueBase, ...controlShapes.text }).strict(),
  z.object({ ...valueBase, ...controlShapes.color }).strict(),
  // 組み合わせの型(サーフェス定義の composite。D-121)。引数ごとの操作を並べ、宣言順の引数で 1 つのアドレスへ送る。
  // hint は表示ヒント(OSCQuery の EXTENDED_TYPE など)で、知らない名前なら引数ごとの操作を並べる
  z.object({
    ...commonFields,
    kind: z.literal('composite'),
    address: PadAddressSchema,
    hint: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,31}$/).optional(),
    fields: z.array(PadFieldSchema).min(1).max(PAD_DOCUMENT.MAX_FIELDS),
    ...holdingFields,
  }).strict(),
  // 表(繰り返し)。行 = キー、列 = 欄。address は行のアドレスの根(/member なら行は /member/<キー>)
  z.object({
    ...commonFields,
    kind: z.literal('table'),
    address: PadAddressSchema,
    rows: PadTableRowsSchema,
    columns: z.array(PadTableColumnSchema).min(1).max(PAD_DOCUMENT.MAX_TABLE_COLUMNS),
    actions: z.array(PadTableActionSchema).max(PAD_DOCUMENT.MAX_TABLE_ACTIONS).optional(),
  }).strict(),
])

export const PadDocumentStructureSchema = z.object({
  format: z.literal(OSC_PAD_FORMAT),
  version: z.literal(PAD_DOCUMENT_VERSION),
  rows: z.number().int().min(1).max(PAD_DOCUMENT.MAX_ROWS),
  columns: z.number().int().min(1).max(PAD_DOCUMENT.MAX_COLUMNS),
  widgets: z.array(PadWidgetSchema).max(PAD_DOCUMENT.MAX_WIDGETS),
}).strict()

export type PadArg = z.infer<typeof PadArgSchema>
export type PadOption = z.infer<typeof OptionSchema>
export type PadField = z.infer<typeof PadFieldSchema>
export type PadTableColumn = z.infer<typeof PadTableColumnSchema>
export type PadTableRows = z.infer<typeof PadTableRowsSchema>
export type PadTableAction = z.infer<typeof PadTableActionSchema>
export type PadWidget = z.infer<typeof PadWidgetSchema>
export type PadDocument = z.infer<typeof PadDocumentStructureSchema>
export type PadButtonWidget = Extract<PadWidget, { kind: 'button' }>
export type PadCompositeWidget = Extract<PadWidget, { kind: 'composite' }>
export type PadTableWidget = Extract<PadWidget, { kind: 'table' }>
/** 1 つのアドレスへ値を送る部品(トグル・スライダー・選択・数値と文字の入力・色) */
export type PadValueWidget = Extract<PadWidget, { kind: PadValueKind }>
/** 値を持つ操作(値を持つ部品・組み合わせの引数・表の欄)の、種類ごとの欄だけ */
export type PadControl = Pick<PadValueWidget, 'kind' | 'type'> & Partial<Record<'min' | 'max' | 'step' | 'maxLength', number>> & { options?: PadOption[] }

/** 値を保持する部品か(ボタンは決まった値を送るだけで保持しない。表は行と欄ごとに保持する) */
export function isHoldingWidget(widget: PadWidget): widget is PadValueWidget | PadCompositeWidget | PadTableWidget {
  return widget.kind !== 'button'
}

export interface PadIssue {
  path: (string | number)[]
  message: string
}

/** 型どおりの数か(i は int32 の整数、f は float32 に収まる有限の数) */
function numberFits(type: 'i' | 'f', value: number): boolean {
  return type === 'i' ? Int32Schema.safeParse(value).success : Float32Schema.safeParse(value).success
}

/**
 * 値を持つ操作の、構造で表せない規則(値域・候補が型に合うか)。部品・組み合わせの引数・表の欄で共通。
 * 編集の規則(ブリッジの pad-document-editor)も同じ判定を当てる
 */
export function collectControlIssues(control: PadControl, path: (string | number)[]): PadIssue[] {
  const issues: PadIssue[] = []
  if (control.kind === 'slider' || control.kind === 'number') {
    const type = control.type as 'i' | 'f'
    for (const key of ['min', 'max'] as const) {
      const value = control[key]
      if (value !== undefined && !numberFits(type, value)) issues.push({ path: [...path, key], message: `${key} does not fit type ${type}` })
    }
    const { min, max, step } = control
    if (min !== undefined && max !== undefined) {
      if (control.kind === 'slider' ? !(min < max) : !(min <= max)) issues.push({ path: [...path, 'max'], message: control.kind === 'slider' ? 'max must be greater than min' : 'max must not be less than min' })
    }
    if (step !== undefined && type === 'i' && !Number.isInteger(step)) issues.push({ path: [...path, 'step'], message: 'step of an i control must be an integer' })
  }
  if (control.kind === 'select') {
    const seen = new Set<string>()
    ;(control.options ?? []).forEach((option, index) => {
      const here = [...path, 'options', index, 'value']
      const fits = control.type === 's'
        ? typeof option.value === 'string' && OscStringSchema.safeParse(option.value).success
        : typeof option.value === 'number' && numberFits(control.type as 'i' | 'f', option.value)
      if (!fits) issues.push({ path: here, message: `option does not fit type ${control.type}` })
      const key = `${typeof option.value}:${String(option.value)}`
      if (seen.has(key)) issues.push({ path: here, message: `duplicate option ${JSON.stringify(option.value)}` })
      seen.add(key)
    })
  }
  return issues
}

/** OSC の文字列 1 つの大きさ(UTF-8 + 終端の NUL を 4 バイトに揃える) */
const oscStringBytes = (text: string) => Math.ceil((new TextEncoder().encode(text).length + 1) / 4) * 4
/** 行のキーの並び(s をキーの数だけ)を keysAddress へ送る OSC メッセージの大きさ */
export function keyListMessageBytes(address: string, keys: readonly string[]): number {
  return oscStringBytes(address) + oscStringBytes(`,${'s'.repeat(keys.length)}`) + keys.reduce((sum, key) => sum + oscStringBytes(key), 0)
}

function tableIssues(table: PadTableWidget, path: (string | number)[]): PadIssue[] {
  const issues: PadIssue[] = []
  const columnIds = new Set<string>()
  const columnAddresses = new Set<string>()
  table.columns.forEach((column, index) => {
    const here = [...path, 'columns', index]
    if (columnIds.has(column.id)) issues.push({ path: [...here, 'id'], message: `duplicate column id "${column.id}"` })
    columnIds.add(column.id)
    // 同じアドレスの欄が 2 つあると、エコーと保持値がどちらの欄のものか決まらない
    if (columnAddresses.has(column.address)) issues.push({ path: [...here, 'address'], message: `duplicate column address "${column.address}"` })
    columnAddresses.add(column.address)
    if (column.bulk === true && column.kind !== 'toggle') issues.push({ path: [...here, 'bulk'], message: 'bulk needs a toggle column' })
    issues.push(...collectControlIssues(column, here))
  })
  const actionIds = new Set<string>()
  ;(table.actions ?? []).forEach((action, index) => {
    const here = [...path, 'actions', index]
    if (actionIds.has(action.id)) issues.push({ path: [...here, 'id'], message: `duplicate action id "${action.id}"` })
    actionIds.add(action.id)
    // 欄と同じアドレスへ決まった値を送ると、保持値と食い違う値をターゲットへ書く
    if (columnAddresses.has(action.address)) issues.push({ path: [...here, 'address'], message: `action "${action.id}" uses the address of a column` })
  })
  if (table.rows.source === 'ui') {
    const keys = new Set<string>()
    table.rows.keys.forEach((row, index) => {
      if (keys.has(row.key)) issues.push({ path: [...path, 'rows', 'keys', index, 'key'], message: `duplicate row key "${row.key}"` })
      keys.add(row.key)
    })
    if (table.rows.max !== undefined && table.rows.keys.length > table.rows.max) {
      issues.push({ path: [...path, 'rows', 'keys'], message: `rows exceed max ${String(table.rows.max)}` })
    }
    // 行のキーの並びは keysAddress へ 1 メッセージで送る(D-169)。1 データグラムに収まらない一覧は送れず、同期で行の並びが
    // 黙って落ちるので、保存の時点で断る(キー 1,000 個 × 64 文字は UDP の上限を超える)
    if (table.rows.keysAddress !== undefined) {
      const bytes = keyListMessageBytes(table.rows.keysAddress, table.rows.keys.map(row => row.key))
      if (bytes > OSC_BATCH.PRACTICAL_LIMIT_BYTES) {
        issues.push({ path: [...path, 'rows', 'keys'], message: `the row key list sent to keysAddress is ${String(bytes)} bytes as OSC (limit ${String(OSC_BATCH.PRACTICAL_LIMIT_BYTES)})` })
      }
    }
  }
  return issues
}

/** 部品が占めるマスの範囲(右下は含まない) */
export function widgetCells(widget: Pick<PadWidget, 'row' | 'column' | 'rowSpan' | 'columnSpan'>): { row: number; column: number; rowEnd: number; columnEnd: number } {
  return { row: widget.row, column: widget.column, rowEnd: widget.row + (widget.rowSpan ?? 1), columnEnd: widget.column + (widget.columnSpan ?? 1) }
}

const withinLimit = (value: number, min: number, max: number): boolean => Number.isInteger(value) && value >= min && value <= max

/** 構造(zod)で表せない規則。判定の正はここだけで、UI は写しを持たない(D-122・D-126)。 */
export function collectPadDocumentIssues(pad: PadDocument): PadIssue[] {
  const issues: PadIssue[] = []
  const ids = new Set<string>()
  const occupied = new Map<string, string>()
  let totalImageBytes = 0
  // zod の数の上限(.max)の違反は superRefine を止めない(値の形が合っていれば、上限を外れた数のまま届く)。
  // マスを 1 つずつ展開する前に、格子の大きさと部品の位置・広がりが上限の内側かを確かめ、外れていれば展開しない
  // (行・列・広がりを 1000000 にした小さな JSON で 10^12 マスを走査しないように。PR #172 のレビュー。上限の違反は構造の検証が報告する)
  const gridFits = withinLimit(pad.rows, 1, PAD_DOCUMENT.MAX_ROWS) && withinLimit(pad.columns, 1, PAD_DOCUMENT.MAX_COLUMNS)
  pad.widgets.forEach((widget, index) => {
    const path = ['widgets', index]
    if (ids.has(widget.id)) issues.push({ path: [...path, 'id'], message: `duplicate widget id "${widget.id}"` })
    ids.add(widget.id)
    const cells = widgetCells(widget)
    const placeFits = withinLimit(widget.row, 0, PAD_DOCUMENT.MAX_ROWS - 1) && withinLimit(widget.column, 0, PAD_DOCUMENT.MAX_COLUMNS - 1)
      && withinLimit(widget.rowSpan ?? 1, 1, PAD_DOCUMENT.MAX_ROWS) && withinLimit(widget.columnSpan ?? 1, 1, PAD_DOCUMENT.MAX_COLUMNS)
    if (gridFits && placeFits && (cells.rowEnd > pad.rows || cells.columnEnd > pad.columns)) {
      issues.push({ path, message: `widget "${widget.id}" is outside the ${String(pad.rows)}x${String(pad.columns)} grid` })
    } else if (gridFits && placeFits) {
      // 上限の内側なら 1 部品で最大 144 マス
      let overlaps = false
      for (let row = cells.row; row < cells.rowEnd; row += 1) {
        for (let column = cells.column; column < cells.columnEnd; column += 1) {
          const cell = `${String(row)},${String(column)}`
          if (occupied.has(cell)) overlaps = true
          occupied.set(cell, widget.id)
        }
      }
      if (overlaps) issues.push({ path, message: `widget "${widget.id}" overlaps another widget` })
    }
    switch (widget.kind) {
      case 'button':
        if (widget.image !== undefined) {
          const bytes = imageDataUrlBytes(widget.image) ?? 0
          totalImageBytes += bytes
          if (bytes > PAD_DOCUMENT.MAX_IMAGE_BYTES) issues.push({ path: [...path, 'image'], message: `image of "${widget.id}" exceeds ${String(PAD_DOCUMENT.MAX_IMAGE_BYTES)} bytes` })
        }
        break
      case 'composite': {
        const fieldIds = new Set<string>()
        widget.fields.forEach((field, fieldIndex) => {
          if (fieldIds.has(field.id)) issues.push({ path: [...path, 'fields', fieldIndex, 'id'], message: `duplicate field id "${field.id}"` })
          fieldIds.add(field.id)
          issues.push(...collectControlIssues(field, [...path, 'fields', fieldIndex]))
        })
        break
      }
      case 'table':
        issues.push(...tableIssues(widget, path))
        break
      default:
        issues.push(...collectControlIssues(widget, path))
    }
  })
  if (totalImageBytes > PAD_DOCUMENT.MAX_TOTAL_IMAGE_BYTES) {
    issues.push({ path: ['widgets'], message: `images exceed ${String(PAD_DOCUMENT.MAX_TOTAL_IMAGE_BYTES)} bytes in total` })
  }
  return issues
}

export const PadDocumentSchema = PadDocumentStructureSchema.superRefine((pad, context) => {
  for (const issue of collectPadDocumentIssues(pad)) context.addIssue({ code: z.ZodIssueCode.custom, ...issue })
})

/** パッドの JSON(区切りの空白なし)の UTF-8 のバイト数。保存・採用の上限(MAX_SERIALIZED_BYTES)と比べる。 */
export function padDocumentSerializedBytes(pad: PadDocument): number {
  return new TextEncoder().encode(JSON.stringify(pad)).length
}

/** ブリッジが保存・採用するときの検証。形と意味に加えて JSON の大きさを見る(版 1 の OscPadStoredSchema と同じ考え) */
export const PadDocumentStoredSchema = PadDocumentSchema.superRefine((pad, context) => {
  const bytes = padDocumentSerializedBytes(pad)
  if (bytes > PAD_DOCUMENT.MAX_SERIALIZED_BYTES) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: [], message: `pad is ${String(bytes)} bytes as JSON (limit ${String(PAD_DOCUMENT.MAX_SERIALIZED_BYTES)})` })
  }
})

/** 保持値と再送の対象になる値の JSON の形(HID-487 が保持値に使う)。組み合わせの型は引数の並び */
const PadScalarValueSchema = z.union([z.boolean(), z.number().finite(), z.string()])
export const PadValueSchema = z.union([PadScalarValueSchema, z.array(PadScalarValueSchema).max(PAD_DOCUMENT.MAX_FIELDS)])
export type PadValue = z.infer<typeof PadValueSchema>
