import { z } from 'zod'

import { matchesPattern } from './address-pattern'
import { OSC_BATCH } from './limits'

// サーフェス定義(D-043)。OscDesk 側の JSON ファイルが操作対象の正典で、
// 「パラメータ層」(何を送るか)と「画面層」(どう並べるか)の 2 層に分ける。
// 画面層は NiceGUI 以外の描画方式でも読めるよう、ウィジェットは「ヒント」に留める。
//
// 版 2(HID-389・D-117)で、パラメータの本体(id・型・制約・表示ヒント)と通信の結び付け(bindings)を分けた。
// 本体は通信方式に依らない語彙だけで書き、OSC のアドレス・一覧の受け口・アドレスのパターンは bindings.osc にだけ置く
// (UI を OSC に依存させず、MIDI などのアダプタを足しても UI と本体を作り直さないため。HID-373 の決定 1)。
// 版 1(パラメータに address を直接書く形)はブリッジが読み込むときに版 2 へ移す(surface-migration.ts)。

export const SURFACE_DEFINITION_FORMAT = 'oscdesk-surface'
export const SURFACE_DEFINITION_VERSION = 2

const INT32_MIN = -2147483648
const INT32_MAX = 2147483647

// 予約名前空間(/sys/* と /oscdesk/*)を先読みで弾く。JSON Schema の pattern にそのまま出て、
// Python 側の jsonschema 検証でも同じ拒否になる(二重実装を避けるため正規表現を 1 つに保つ)。
// `*` `?` `[` `]` `{` `}` `,` と空白は具体アドレスに使えず、空パートと末尾 `/` も許さない。
// 末尾は `$` でなく `(?![\\s\\S])`: Python の re では `$` が末尾の改行の手前にも一致し、JS と判定が割れるため。
// OSC パッド(D-080)のボタンのアドレスも同じ規則で縛るため公開する
export const PARAMETER_ADDRESS_PATTERN = '^(?!/(?:sys|oscdesk)(?:/|(?![\\s\\S])))(?:/[^\\s/?\\[\\]{},*]+)+(?![\\s\\S])'
// アクションの match(OSC の結び付けのセレクタ)用。`*` を許す以外は具体アドレスと同じ形
// (予約名前空間は定義済みパラメータにしか当たらないので検査不要)。
export const ADDRESS_MATCH_PATTERN = '^(?:/[^\\s/?\\[\\]{},]+)+(?![\\s\\S])'
export const IDENTIFIER_PATTERN = '^[A-Za-z][A-Za-z0-9_-]{0,63}(?![\\s\\S])'

const identifierSchema = z.string().regex(new RegExp(IDENTIFIER_PATTERN))
const labelSchema = z.string().min(1)
const concreteAddressSchema = z.string().regex(new RegExp(PARAMETER_ADDRESS_PATTERN))

// 実行時の一覧(D-053 の optionsFrom・D-061 の keysFrom)は、本体では一覧の id で指す。どこから届くか(OSC なら
// どのアドレスへ返り、どのアドレスへ要求を送るか)は bindings が決める。同じ id を指す箇所は同じ一覧を共有する
const listRefSchema = z.object({ list: identifierSchema }).strict()
// レコードのキー(行)の出どころ(D-061 / D-075)。source を省くか 'unity' ならターゲットが返す一覧。
// 'ui' なら UI で追加・削除し、ブリッジが追加順に保持・保存してターゲットへ送る一覧(要求は持てない)。
// max は 'ui' の一覧の上限で、達したら UI は追加を受け付けない
export const RECORD_KEYS_MAX = 1000
const keysFromSchema = z
  .object({
    list: identifierSchema,
    source: z.enum(['unity', 'ui']).optional(),
    max: z.number().int().min(1).max(RECORD_KEYS_MAX).optional(),
  })
  .strict()

export const SURFACE_WIDGET_HINTS = ['slider', 'switch', 'button', 'input', 'select'] as const

const parameterBaseFields = {
  id: identifierSchema,
  label: labelSchema,
  // state: ターゲットの現在値を表し、再接続時に再送する。trigger: 押した瞬間だけの「きっかけ」で再送しない。
  kind: z.enum(['state', 'trigger']),
  // false なら単独では送れず、複数メッセージ列の一部としてのみ送る(HID-166)。省略時は true。
  standalone: z.boolean().optional(),
  // 表示ヒント(HID-377)。画面層の widget が無いときの既定。無ければ型と制約から決める(D-103)。
  widget: z.enum(SURFACE_WIDGET_HINTS).optional(),
}

const rangeSchema = z.tuple([z.number(), z.number()])

const numericParameter = <T extends 'i' | 'f'>(type: T) =>
  z
    .object({
      ...parameterBaseFields,
      type: z.literal(type),
      range: rangeSchema.optional(),
      step: z.number().positive().optional(),
      default: z.number().optional(),
      // trigger が押下で送る値。state では使わない(意味層で検査)。
      value: z.number().optional(),
    })
    .strict()

// 型は D-103 の i(整数)/ f(小数)/ s(文字列)/ bool(真偽)。値は JSON の値で持ち、通信の型(OSC の型タグ)への
// 直し方は結び付けの側(ブリッジのアダプタ)が決める
export const SurfaceParameterSchema = z.discriminatedUnion('type', [
  numericParameter('i'),
  numericParameter('f'),
  z
    .object({
      ...parameterBaseFields,
      type: z.literal('s'),
      // 静的な候補。optionsFrom と併記したときは、実行時の一覧の前に固定で付く候補になる(D-053)
      options: z.array(z.string()).min(1).optional(),
      // ターゲットが実行時に持つ文字列の一覧(D-053)。一覧は値であり、定義は書き換えない
      optionsFrom: listRefSchema.optional(),
      default: z.string().optional(),
      value: z.string().optional(),
    })
    .strict(),
  z
    .object({
      ...parameterBaseFields,
      type: z.literal('bool'),
      default: z.boolean().optional(),
      value: z.boolean().optional(),
    })
    .strict(),
])

// レコードのフィールド(D-061)。型ごとの欄はパラメータと同じで、kind と standalone はレコード側が持つ。
// default 必須(state)・value 必須(trigger)はレコードの kind で決まるので意味検証で見る
const numericRecordField = <T extends 'i' | 'f'>(type: T) =>
  z
    .object({
      id: identifierSchema,
      label: labelSchema,
      type: z.literal(type),
      range: rangeSchema.optional(),
      step: z.number().positive().optional(),
      default: z.number().optional(),
      value: z.number().optional(),
    })
    .strict()

export const SurfaceRecordFieldSchema = z.discriminatedUnion('type', [
  numericRecordField('i'),
  numericRecordField('f'),
  z
    .object({
      id: identifierSchema,
      label: labelSchema,
      type: z.literal('s'),
      options: z.array(z.string()).min(1).optional(),
      optionsFrom: listRefSchema.optional(),
      default: z.string().optional(),
      value: z.string().optional(),
    })
    .strict(),
  z
    .object({
      id: identifierSchema,
      label: labelSchema,
      type: z.literal('bool'),
      default: z.boolean().optional(),
      value: z.boolean().optional(),
    })
    .strict(),
])

// レコード型パラメータ(D-059 / D-061): 1 行 = キーとフィールドを宣言順に並べた値。
// キー(行)の一覧は keysFrom の一覧で、定義は個数を持たない
export const SurfaceRecordSchema = z
  .object({
    id: identifierSchema,
    label: labelSchema,
    kind: z.enum(['state', 'trigger']),
    // キーの型は s だけなので型の欄は置かない
    key: z.object({ label: labelSchema.optional() }).strict().optional(),
    keysFrom: keysFromSchema,
    fields: z.array(SurfaceRecordFieldSchema),
  })
  .strict()

const fixedValueSchema = z.union([z.number(), z.string(), z.boolean()])

// アクション(HID-166): 押すと複数のパラメータの値を 1 つのまとめ送りで送る。
// 「何を送るか」なのでパラメータ層に置き、画面層は kind:'action' のノードで配置するだけにする。
const actionStepSchema = z.union([
  // param: そのパラメータ 1 件。value があれば固定値、無ければ state は現在値・trigger は定義の value
  z.object({ param: identifierSchema, value: fixedValueSchema.optional() }).strict(),
  // selector: 結び付けが決めるパラメータの集まり(OSC ではアドレスのパターン。`*` は 1 パート内の 0 文字以上)を定義順に。
  // 現在値(trigger は定義の value)を送る。どのパラメータが当たるかは通信方式に依るので、本体には id だけを書く(D-117)
  z.object({ selector: identifierSchema }).strict(),
  // record: 行 1 つ分のレコード(D-061)。scope を持つアクションだけが使える。
  // state はその行の現在値、value に書いたフィールドだけ固定値で上書き。trigger はフィールドの定義の value
  // value のキーはフィールド id なので identifier に縛る。z.string() のままだと zod の record が `__proto__` を
  // 黙って落とし、Python(未知のフィールドとして拒否)と判定が食い違う
  z.object({ record: identifierSchema, value: z.record(identifierSchema, fixedValueSchema).optional() }).strict(),
])

export const SurfaceActionSchema = z
  .object({
    id: identifierSchema,
    label: labelSchema,
    // row: 押した行のキーについて展開する。all: 表示中の全行について行ごとに展開する(D-061)。省略は従来のアクション
    scope: z.enum(['row', 'all']).optional(),
    steps: z.array(actionStepSchema).min(1),
  })
  .strict()

// 12 分割グリッドの占有幅。'auto' は描画側に任せる。
const widthSchema = z.union([z.literal('auto'), z.number().int().min(1).max(12)])

export type SurfaceControlNode = {
  kind: 'control'
  param: string
  widget?: (typeof SURFACE_WIDGET_HINTS)[number] | undefined
  label?: string | undefined
  width?: 'auto' | number | undefined
}
export type SurfaceActionNode = {
  kind: 'action'
  action: string
  label?: string | undefined
  width?: 'auto' | number | undefined
}
export type SurfaceRecordColumn = {
  field: string
  widget?: (typeof SURFACE_WIDGET_HINTS)[number] | undefined
  label?: string | undefined
  /** 列の直下(表の枠内のフッター行)に出す scope:'all' のアクション id。列の一括操作の置き場(D-066) */
  actions?: string[] | undefined
  /** bool の列の直下に出す一括トグル(D-073)。オンにすると on、オフにすると off の scope:'all' アクションを送る */
  toggle?: SurfaceRecordColumnToggle | undefined
}
export type SurfaceRecordColumnToggle = {
  label: string
  on: string
  off: string
}
/** レコード表(D-061)。行 = キー、列 = columns(省略時は全フィールドを定義順)。行の並び順は UI の規則で、定義では宣言しない。 */
export type SurfaceRecordNode = {
  kind: 'record'
  record: string
  label?: string | undefined
  width?: 'auto' | number | undefined
  columns?: SurfaceRecordColumn[] | undefined
  /** 各行の末尾に出す scope:'row' のアクション id */
  rowActions?: string[] | undefined
  /** 表の右側に、行の並びいっぱいの縦長ボタンで出す scope:'all' のアクション id(表全体の確定。D-074) */
  tableActions?: string[] | undefined
  /**
   * 通常の画面で行の追加(表の下)と削除(各行の左の ×)を出すか(D-075)。省略時は keysFrom.source が 'ui' なら出し、
   * ターゲットの一覧なら出さない。trigger のレコードの表には出さない(保持値が無い)
   */
  editRows?: boolean | undefined
}
export type SurfaceLayoutNode =
  | SurfaceControlNode
  | SurfaceActionNode
  | SurfaceRecordNode
  | { kind: 'row' | 'column'; children: SurfaceLayoutNode[]; width?: 'auto' | number | undefined }
  | { kind: 'group'; label: string; collapsed?: boolean | undefined; children: SurfaceLayoutNode[]; width?: 'auto' | number | undefined }
  | { kind: 'tabs'; tabs: { label: string; children: SurfaceLayoutNode[] }[]; width?: 'auto' | number | undefined }

export const SurfaceLayoutNodeSchema: z.ZodType<SurfaceLayoutNode> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('control'),
        param: identifierSchema,
        widget: z.enum(SURFACE_WIDGET_HINTS).optional(),
        label: labelSchema.optional(),
        width: widthSchema.optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('action'),
        action: identifierSchema,
        label: labelSchema.optional(),
        width: widthSchema.optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('record'),
        record: identifierSchema,
        label: labelSchema.optional(),
        width: widthSchema.optional(),
        columns: z
          .array(
            z
              .object({
                field: identifierSchema,
                widget: z.enum(SURFACE_WIDGET_HINTS).optional(),
                label: labelSchema.optional(),
                actions: z.array(identifierSchema).optional(),
                toggle: z.object({ label: labelSchema, on: identifierSchema, off: identifierSchema }).strict().optional(),
              })
              .strict(),
          )
          .optional(),
        rowActions: z.array(identifierSchema).optional(),
        tableActions: z.array(identifierSchema).optional(),
        editRows: z.boolean().optional(),
      })
      .strict(),
    z.object({ kind: z.literal('row'), children: z.array(SurfaceLayoutNodeSchema), width: widthSchema.optional() }).strict(),
    z.object({ kind: z.literal('column'), children: z.array(SurfaceLayoutNodeSchema), width: widthSchema.optional() }).strict(),
    z
      .object({
        kind: z.literal('group'),
        label: labelSchema,
        collapsed: z.boolean().optional(),
        children: z.array(SurfaceLayoutNodeSchema),
        width: widthSchema.optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('tabs'),
        tabs: z
          .array(z.object({ label: labelSchema, children: z.array(SurfaceLayoutNodeSchema) }).strict())
          .min(1),
        width: widthSchema.optional(),
      })
      .strict(),
  ]),
)

export const SurfaceScreenSchema = z
  .object({
    id: identifierSchema,
    label: labelSchema,
    children: z.array(SurfaceLayoutNodeSchema),
  })
  .strict()

// OSC の結び付け(D-117)。本体の id から OSC の語へ引く表で、OSC のアダプタ(ブリッジ)だけが解釈する。
// UI は OSC のアダプタがあるときだけ、編集モードのアドレスの欄のためにこれを受け取る。
// 配列で持つのは、id をキーにしたオブジェクトだと `constructor` などの名前が JS のオブジェクトの既定のメンバーと紛れるため
const OscAddressBindingSchema = z.object({ id: identifierSchema, address: concreteAddressSchema }).strict()
// 一覧の受け口。address はターゲットが一覧を返すアドレス、request を書くとブリッジがそこへ引数なしの要求を送る
// (省略時はターゲットの自発送信だけを待つ)。keysFrom.source 'ui' の一覧では、address はブリッジが行の ID の並びを送る先
const OscListBindingSchema = z
  .object({ id: identifierSchema, address: concreteAddressSchema, request: concreteAddressSchema.optional() })
  .strict()
const OscSelectorBindingSchema = z.object({ id: identifierSchema, match: z.string().regex(new RegExp(ADDRESS_MATCH_PATTERN)) }).strict()
export const OscBindingsSchema = z
  .object({
    parameters: z.array(OscAddressBindingSchema),
    records: z.array(OscAddressBindingSchema).optional(),
    lists: z.array(OscListBindingSchema).optional(),
    selectors: z.array(OscSelectorBindingSchema).optional(),
  })
  .strict()
// 通信アダプタごとの結び付け。キーはアダプタの種類(hello.adapters と同じ名前)
export const SurfaceBindingsSchema = z.object({ osc: OscBindingsSchema.optional() }).strict()

/** 構造だけの検証。JSON Schema はこの形から生成する(参照・値域などの意味検証は含まない)。 */
export const SurfaceDefinitionStructureSchema = z
  .object({
    format: z.literal(SURFACE_DEFINITION_FORMAT),
    version: z.literal(SURFACE_DEFINITION_VERSION),
    name: labelSchema,
    parameters: z.array(SurfaceParameterSchema),
    // 省略可。parameters に混ぜないのは、既存のパラメータ処理(selector・保持値)を変えずに済ませるため(D-061)
    records: z.array(SurfaceRecordSchema).optional(),
    // 省略可。無い定義(HID-166 以前)もそのまま有効
    actions: z.array(SurfaceActionSchema).optional(),
    screens: z.array(SurfaceScreenSchema),
    // 通信の結び付け(D-117)。保存するファイルとプロジェクトファイルには必ず入り、UI へ配るフレームでは本体から外して
    // 別の欄で添える。本体だけの定義(結び付けを含まない)も構造としては有効
    bindings: SurfaceBindingsSchema.optional(),
  })
  .strict()

export type SurfaceAction = z.infer<typeof SurfaceActionSchema>
export type SurfaceActionStep = SurfaceAction['steps'][number]
export type SurfaceRecordStep = Extract<SurfaceActionStep, { record: string }>
export type SurfaceRecord = z.infer<typeof SurfaceRecordSchema>
export type SurfaceRecordField = z.infer<typeof SurfaceRecordFieldSchema>
export type SurfaceParameter = z.infer<typeof SurfaceParameterSchema>
export type SurfaceScreen = z.infer<typeof SurfaceScreenSchema>
export type SurfaceDefinitionStructure = z.infer<typeof SurfaceDefinitionStructureSchema>
export type OscBindings = z.infer<typeof OscBindingsSchema>
export type SurfaceBindings = z.infer<typeof SurfaceBindingsSchema>

export interface SurfaceDefinitionIssue {
  path: (string | number)[]
  message: string
}

type IssuePath = (string | number)[]
type FixedValue = number | string | boolean

/** 部品のヒントの適合を見る対象。レコードのフィールドは「kind = レコードの kind」のパラメータとして判定する(D-061)。 */
export type WidgetTarget = {
  kind: 'state' | 'trigger'
  type: 'i' | 'f' | 's' | 'bool'
  range?: unknown
  options?: unknown
  optionsFrom?: unknown
}

export function widgetFits(widget: string, target: WidgetTarget): boolean {
  switch (widget) {
    case 'slider':
      return target.kind === 'state' && (target.type === 'i' || target.type === 'f') && target.range !== undefined
    case 'switch':
      return target.kind === 'state' && target.type === 'bool'
    case 'button':
      return target.kind === 'trigger'
    case 'select':
      return target.kind === 'state' && target.type === 's' && (target.options !== undefined || target.optionsFrom !== undefined)
    case 'input':
      return target.kind === 'state' && (target.type === 's' || target.type === 'i' || target.type === 'f')
    default:
      return false
  }
}

/** パラメータとレコードのフィールドに共通の「値の宣言」(型・range・step・options・optionsFrom・default・value)。 */
type ValueSpec = SurfaceParameter | SurfaceRecordField

function checkNumber(spec: ValueSpec, field: 'default' | 'value', path: IssuePath, issues: SurfaceDefinitionIssue[]): void {
  if (spec.type !== 'i' && spec.type !== 'f') return
  const current = spec[field]
  if (current === undefined) return
  if (spec.type === 'i' && (!Number.isInteger(current) || current < INT32_MIN || current > INT32_MAX)) {
    issues.push({ path: [...path, field], message: 'type i requires an int32 value' })
  }
  if (spec.range !== undefined && (current < spec.range[0] || current > spec.range[1])) {
    issues.push({ path: [...path, field], message: `${field} must be within range` })
  }
}

/**
 * 値の宣言の検証。パラメータとレコードのフィールドで同じ規則を使う(D-061)。
 * 違いは 1 点だけで、state レコードのフィールドは default 必須(行の生成でその値を使うため)。
 */
function collectValueSpecIssues(
  spec: ValueSpec,
  kind: 'state' | 'trigger',
  owner: 'parameter' | 'record field',
  path: IssuePath,
  issues: SurfaceDefinitionIssue[],
): void {
  const at = (field: string): IssuePath => [...path, field]
  if (kind === 'state') {
    if (spec.value !== undefined) {
      issues.push({ path: at('value'), message: `state ${owner} cannot define value` })
    }
    if (owner === 'record field' && spec.default === undefined) {
      issues.push({ path: at('default'), message: 'state record field requires default' })
    }
  } else {
    if (spec.value === undefined) {
      issues.push({ path: at('value'), message: `trigger ${owner} requires value` })
    }
    for (const field of ['default', 'range', 'options', 'step', 'optionsFrom'] as const) {
      if (field in spec) {
        issues.push({ path: at(field), message: `trigger ${owner} cannot define ${field}` })
      }
    }
  }

  if ((spec.type === 'i' || spec.type === 'f') && spec.range !== undefined) {
    if (spec.range[0] >= spec.range[1]) {
      issues.push({ path: at('range'), message: 'range minimum must be less than maximum' })
    }
    if (spec.step !== undefined && spec.step > spec.range[1] - spec.range[0]) {
      issues.push({ path: at('step'), message: 'step must not exceed the range width' })
    }
    if (spec.type === 'i' && !spec.range.every((bound) => Number.isInteger(bound) && bound >= INT32_MIN && bound <= INT32_MAX)) {
      issues.push({ path: at('range'), message: 'type i requires int32 range bounds' })
    }
  }
  if (spec.type === 'i' && spec.step !== undefined && !Number.isInteger(spec.step)) {
    issues.push({ path: at('step'), message: 'type i requires an integer step' })
  }
  checkNumber(spec, 'default', path, issues)
  checkNumber(spec, 'value', path, issues)

  if (spec.type === 's' && spec.options !== undefined) {
    if (new Set(spec.options).size !== spec.options.length) {
      issues.push({ path: at('options'), message: 'options must be unique' })
    }
    // optionsFrom を持つなら default は実行時の一覧にある名前でもよい(D-053 / D-054)。value は state では別に拒否される
    for (const field of spec.optionsFrom === undefined ? (['default', 'value'] as const) : (['value'] as const)) {
      const current = spec[field]
      if (current !== undefined && !spec.options.includes(current)) {
        issues.push({ path: at(field), message: `${field} must be one of options` })
      }
    }
  }
}

/** id で索引化する。重複 id は(従来の find と同じく)先勝ち。重複自体は別の検証が報告する。 */
function indexById<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  const index = new Map<string, T>()
  for (const item of items) if (!index.has(item.id)) index.set(item.id, item)
  return index
}

// レコードのフィールドの索引。columns・step の value の照合のたびに fields を find で総当たりすると、
// 1 MiB の定義でも(列や値の数 × フィールド数で)ブロックが伸びるため、1 回の検証の中でレコードごとに 1 回だけ作る。
// 検証をまたいで持ち越さないのは、呼び出し側が同じオブジェクトを書き換えて再検証したときに古い索引を使わないため
type FieldIndex = (record: SurfaceRecord) => ReadonlyMap<string, SurfaceRecordField>
function createFieldIndex(): FieldIndex {
  const cache = new Map<SurfaceRecord, Map<string, SurfaceRecordField>>()
  return (record) => {
    let index = cache.get(record)
    if (index === undefined) {
      index = indexById(record.fields)
      cache.set(record, index)
    }
    return index
  }
}

/** step の固定値が値の宣言の型・値域・options に収まらなければ理由を返す。 */
export function fixedValueProblem(spec: ValueSpec, value: FixedValue): string | undefined {
  switch (spec.type) {
    case 'bool':
      return typeof value === 'boolean' ? undefined : 'type bool requires a boolean value'
    case 's':
      if (typeof value !== 'string') return 'type s requires a string value'
      // optionsFrom の候補は実行時にしか分からないので、静的な options への所属を問わない(D-054)
      return spec.options !== undefined && spec.optionsFrom === undefined && !spec.options.includes(value)
        ? 'value must be one of options'
        : undefined
    case 'i':
    case 'f':
      if (typeof value !== 'number') return `type ${spec.type} requires a number value`
      if (spec.type === 'i' && (!Number.isInteger(value) || value < INT32_MIN || value > INT32_MAX)) {
        return 'type i requires an int32 value'
      }
      if (spec.range !== undefined && (value < spec.range[0] || value > spec.range[1])) {
        return 'value must be within range'
      }
      return undefined
  }
}

/**
 * scope を持つアクション(D-061)。record step だけを持ち、その全レコードが同じ keysFrom の一覧を持つ
 * (行 = 同じキー集合)。件数の上限は実行時の行数で決まるので、ここでは見ない(UI が展開後に見る)。
 */
function collectScopedActionIssues(
  action: SurfaceAction,
  actionIndex: number,
  recordsById: ReadonlyMap<string, SurfaceRecord>,
  fieldIndexOf: FieldIndex,
  issues: SurfaceDefinitionIssue[],
): void {
  let keysList: string | undefined
  action.steps.forEach((step, stepIndex) => {
    const stepPath: IssuePath = ['actions', actionIndex, 'steps', stepIndex]
    if (!('record' in step)) {
      issues.push({ path: stepPath, message: 'scoped action can only have record steps' })
      return
    }
    const record = recordsById.get(step.record)
    if (record === undefined) {
      issues.push({ path: [...stepPath, 'record'], message: `unknown record: ${step.record}` })
      return
    }
    if (keysList === undefined) {
      keysList = record.keysFrom.list
    } else if (record.keysFrom.list !== keysList) {
      issues.push({ path: [...stepPath, 'record'], message: 'records in a scoped action must share the same keysFrom list' })
    }
    if (step.value === undefined) return
    if (record.kind === 'trigger') {
      issues.push({ path: [...stepPath, 'value'], message: 'trigger record keeps its own values; step cannot override them' })
      return
    }
    for (const [fieldId, value] of Object.entries(step.value)) {
      const field = fieldIndexOf(record).get(fieldId)
      if (field === undefined) {
        issues.push({ path: [...stepPath, 'value', fieldId], message: `unknown field: ${fieldId}` })
        continue
      }
      const problem = fixedValueProblem(field, value)
      if (problem !== undefined) issues.push({ path: [...stepPath, 'value', fieldId], message: problem })
    }
  })
}

function collectActionIssues(definition: SurfaceDefinitionStructure, fieldIndexOf: FieldIndex, issues: SurfaceDefinitionIssue[]): void {
  const actionIds = new Set<string>()
  const parametersById = indexById(definition.parameters)
  const recordsById = indexById(definition.records ?? [])
  ;(definition.actions ?? []).forEach((action, actionIndex) => {
    if (actionIds.has(action.id)) {
      issues.push({ path: ['actions', actionIndex, 'id'], message: 'duplicate action id' })
    }
    actionIds.add(action.id)

    // step は最低 1 件に展開されるので、上限超の steps は展開するまでもなく送れない。
    // 数千 step × 数千 parameter の総当たりで検証が数十秒ブロックするのを防ぐため、ここで打ち切る
    // (scope を持つアクションも 1 行で steps 件になるので同じく送れない)
    if (action.steps.length > OSC_BATCH.MAX_MESSAGES) {
      issues.push({ path: ['actions', actionIndex, 'steps'], message: `action has more than ${OSC_BATCH.MAX_MESSAGES} steps` })
      return
    }

    if (action.scope !== undefined) {
      collectScopedActionIssues(action, actionIndex, recordsById, fieldIndexOf, issues)
      return
    }

    let total = 0
    let hasSelector = false
    action.steps.forEach((step, stepIndex) => {
      const at = (field: string): (string | number)[] => ['actions', actionIndex, 'steps', stepIndex, field]
      if ('record' in step) {
        // どの行のメッセージか決まらないので、scope の無いアクションには置けない
        issues.push({ path: at('record'), message: 'record step requires action scope (row or all)' })
      } else if ('param' in step) {
        const parameter = parametersById.get(step.param)
        if (parameter === undefined) {
          issues.push({ path: at('param'), message: `unknown parameter: ${step.param}` })
          return
        }
        total += 1
        if (step.value !== undefined) {
          if (parameter.kind === 'trigger') {
            issues.push({ path: at('value'), message: 'trigger parameter keeps its own value; step cannot override it' })
          } else {
            const problem = fixedValueProblem(parameter, step.value)
            if (problem !== undefined) issues.push({ path: at('value'), message: problem })
          }
        }
      } else {
        // selector が何件に展開されるかは結び付けで決まるので、件数の上限は結び付けの検証で見る
        hasSelector = true
      }
    })
    // まとめ送り 1 回に載せる上限(bridge の batch と同じ)。超えると実行時に送れないので定義で止める
    if (!hasSelector && total > OSC_BATCH.MAX_MESSAGES) {
      issues.push({ path: ['actions', actionIndex, 'steps'], message: `action expands to more than ${OSC_BATCH.MAX_MESSAGES} messages` })
    }
  })
}

/** 実行時の一覧の参照(optionsFrom と keysFrom)を、パラメータ → レコード(keysFrom → フィールドの optionsFrom)の順に集める。 */
export function listReferences(definition: Pick<SurfaceDefinitionStructure, 'parameters' | 'records'>): { path: IssuePath; label: 'optionsFrom' | 'keysFrom'; list: string }[] {
  const references: { path: IssuePath; label: 'optionsFrom' | 'keysFrom'; list: string }[] = []
  definition.parameters.forEach((parameter, index) => {
    if (parameter.type === 's' && parameter.optionsFrom !== undefined) {
      references.push({ path: ['parameters', index, 'optionsFrom'], label: 'optionsFrom', list: parameter.optionsFrom.list })
    }
  })
  ;(definition.records ?? []).forEach((record, index) => {
    references.push({ path: ['records', index, 'keysFrom'], label: 'keysFrom', list: record.keysFrom.list })
    record.fields.forEach((field, fieldIndex) => {
      if (field.type === 's' && field.optionsFrom !== undefined) {
        references.push({ path: ['records', index, 'fields', fieldIndex, 'optionsFrom'], label: 'optionsFrom', list: field.optionsFrom.list })
      }
    })
  })
  return references
}

/**
 * UI で管理するキー(keysFrom.source 'ui'。D-075)。一覧はブリッジが持ってターゲットへ送る側なので、
 * 同じ一覧をターゲットから受ける一覧(optionsFrom・source 'unity' の keysFrom)と共有できない。
 * 同じ一覧を共有するレコードは同じ行の集合なので、source と max も揃える。max は 'ui' の一覧にだけ書ける
 */
function collectKeySourceIssues(definition: SurfaceDefinitionStructure, issues: SurfaceDefinitionIssue[]): void {
  const byList = new Map<string, { source: 'unity' | 'ui'; max: number | undefined }>()
  ;(definition.records ?? []).forEach((record, index) => {
    const path = ['records', index, 'keysFrom']
    const source = record.keysFrom.source ?? 'unity'
    if (source !== 'ui' && record.keysFrom.max !== undefined) {
      issues.push({ path: [...path, 'max'], message: 'keysFrom max needs source ui' })
    }
    const seen = byList.get(record.keysFrom.list)
    if (seen === undefined) {
      byList.set(record.keysFrom.list, { source, max: record.keysFrom.max })
    } else if (seen.source !== source || seen.max !== record.keysFrom.max) {
      issues.push({ path, message: 'records sharing a keysFrom list must agree on source and max' })
    }
  })
  for (const { path, label, list } of listReferences(definition)) {
    if (label === 'optionsFrom' && byList.get(list)?.source === 'ui') {
      issues.push({ path: [...path, 'list'], message: 'optionsFrom list must not be a keysFrom list with source ui' })
    }
  }
}

/** レコード(D-061)。id はパラメータ id とも重ねない(画面層とアクションで取り違えないため)。 */
function collectRecordIssues(
  definition: SurfaceDefinitionStructure,
  parameterIds: ReadonlySet<string>,
  issues: SurfaceDefinitionIssue[],
): void {
  const recordIds = new Set<string>()
  ;(definition.records ?? []).forEach((record, index) => {
    if (recordIds.has(record.id)) {
      issues.push({ path: ['records', index, 'id'], message: 'duplicate record id' })
    }
    if (parameterIds.has(record.id)) {
      issues.push({ path: ['records', index, 'id'], message: 'record id must not be a parameter id' })
    }
    recordIds.add(record.id)

    if (record.kind === 'state' && record.fields.length === 0) {
      issues.push({ path: ['records', index, 'fields'], message: 'state record requires at least one field' })
    }
    const fieldIds = new Set<string>()
    record.fields.forEach((field, fieldIndex) => {
      if (fieldIds.has(field.id)) {
        issues.push({ path: ['records', index, 'fields', fieldIndex, 'id'], message: 'duplicate field id' })
      }
      fieldIds.add(field.id)
      collectValueSpecIssues(field, record.kind, 'record field', ['records', index, 'fields', fieldIndex], issues)
    })
  })
}

/** レコード表のノード(D-061)の columns(列のアクション D-066 を含む)と rowActions。 */
function collectRecordNodeIssues(
  node: SurfaceRecordNode,
  here: IssuePath,
  recordsById: ReadonlyMap<string, SurfaceRecord>,
  actionsById: ReadonlyMap<string, SurfaceAction>,
  keysListsOf: (action: SurfaceAction) => ReadonlySet<string>,
  fieldIndexOf: FieldIndex,
  issues: SurfaceDefinitionIssue[],
): void {
  const record = recordsById.get(node.record)
  if (record === undefined) {
    issues.push({ path: [...here, 'record'], message: `unknown record: ${node.record}` })
  } else if (node.columns !== undefined) {
    const seen = new Set<string>()
    node.columns.forEach((column, columnIndex) => {
      const columnPath = [...here, 'columns', columnIndex]
      if (seen.has(column.field)) {
        issues.push({ path: [...columnPath, 'field'], message: `duplicate column field: ${column.field}` })
      }
      seen.add(column.field)
      const field = fieldIndexOf(record).get(column.field)
      if (field === undefined) {
        issues.push({ path: [...columnPath, 'field'], message: `unknown field: ${column.field}` })
      } else if (column.widget !== undefined && !widgetFits(column.widget, { ...field, kind: record.kind })) {
        issues.push({ path: [...columnPath, 'widget'], message: `widget ${column.widget} does not fit field ${column.field}` })
      }
      ;(column.actions ?? []).forEach((actionId, actionIndex) => {
        checkTableAction(actionId, 'all', [...columnPath, 'actions', actionIndex], record)
      })
      if (column.toggle !== undefined) {
        // 一括トグルは全行のオン・オフを 1 つのスイッチで表すので、bool の列にだけ置ける(D-073)
        if (field !== undefined && field.type !== 'bool') {
          issues.push({ path: [...columnPath, 'toggle'], message: `column toggle needs a bool field: ${column.field}` })
        }
        checkTableAction(column.toggle.on, 'all', [...columnPath, 'toggle', 'on'], record, 'column toggle')
        checkTableAction(column.toggle.off, 'all', [...columnPath, 'toggle', 'off'], record, 'column toggle')
      }
    })
  }

  ;(node.rowActions ?? []).forEach((actionId, actionIndex) => {
    checkTableAction(actionId, 'row', [...here, 'rowActions', actionIndex], record)
  })
  ;(node.tableActions ?? []).forEach((actionId, actionIndex) => {
    checkTableAction(actionId, 'all', [...here, 'tableActions', actionIndex], record, 'table action')
  })
  // 行の追加・削除は保持値の行を作る・消す操作なので、保持値を持たない trigger のレコードの表には置けない(D-075)
  if (node.editRows === true && record !== undefined && record.kind !== 'state') {
    issues.push({ path: [...here, 'editRows'], message: `editRows needs a state record: ${record.id}` })
  }

  /**
   * 表の中に置くアクション(rowActions は scope:'row'、列の actions は scope:'all'。D-066)。
   * 表の行と同じキー集合を対象にしないと、押した行・見えている行と送る行が食い違うので keysFrom の一覧も揃える
   */
  function checkTableAction(
    actionId: string,
    scope: 'row' | 'all',
    actionPath: IssuePath,
    target: SurfaceRecord | undefined,
    owner: string = scope === 'row' ? 'row action' : 'column action',
  ): void {
    const action = actionsById.get(actionId)
    if (action === undefined) {
      issues.push({ path: actionPath, message: `unknown action: ${actionId}` })
      return
    }
    if (action.scope !== scope) {
      issues.push({ path: actionPath, message: `${owner} must have scope ${scope}: ${actionId}` })
      return
    }
    if (target === undefined) return
    const lists = keysListsOf(action)
    if (lists.size > 1 || (lists.size === 1 && !lists.has(target.keysFrom.list))) {
      issues.push({ path: actionPath, message: `${owner} records must share the keysFrom list of record ${target.id}` })
    }
  }
}

/** アクションの selector step が指す結び付けの id(定義順・重複なし)。 */
export function selectorReferences(definition: Pick<SurfaceDefinitionStructure, 'actions'>): string[] {
  const ids = new Set<string>()
  for (const action of definition.actions ?? []) {
    for (const step of action.steps) if ('selector' in step) ids.add(step.selector)
  }
  return [...ids]
}

/**
 * OSC の結び付け(D-117)の検証。本体の id と結び付けが 1 対 1 で、アドレスの規則(D-054・D-061 の衝突、
 * D-075 の UI で管理する一覧、HID-166 の match)が守られているか。結び付けがあるときだけ見る
 */
function collectOscBindingIssues(definition: SurfaceDefinitionStructure, osc: OscBindings, issues: SurfaceDefinitionIssue[]): void {
  const base: IssuePath = ['bindings', 'osc']
  const checkBound = (
    section: 'parameters' | 'records' | 'lists' | 'selectors',
    label: 'parameter' | 'record' | 'list' | 'selector',
    expected: readonly string[],
    bound: readonly { id: string }[],
  ) => {
    const wanted = new Set(expected)
    const seen = new Set<string>()
    bound.forEach((binding, index) => {
      if (seen.has(binding.id)) {
        issues.push({ path: [...base, section, index, 'id'], message: `duplicate ${label} binding: ${binding.id}` })
      } else if (!wanted.has(binding.id)) {
        issues.push({ path: [...base, section, index, 'id'], message: `unknown ${label}: ${binding.id}` })
      }
      seen.add(binding.id)
    })
    for (const id of wanted) {
      if (!seen.has(id)) issues.push({ path: [...base, section], message: `${label} has no osc binding: ${id}` })
    }
  }
  const listIds = [...new Set(listReferences(definition).map(reference => reference.list))]
  checkBound('parameters', 'parameter', definition.parameters.map(parameter => parameter.id), osc.parameters)
  checkBound('records', 'record', (definition.records ?? []).map(record => record.id), osc.records ?? [])
  checkBound('lists', 'list', listIds, osc.lists ?? [])
  checkBound('selectors', 'selector', selectorReferences(definition), osc.selectors ?? [])

  // 値のアドレス = パラメータの address ∪ レコードの address(D-061)
  const valueAddresses = new Set<string>()
  osc.parameters.forEach((binding, index) => {
    if (valueAddresses.has(binding.address)) {
      issues.push({ path: [...base, 'parameters', index, 'address'], message: 'duplicate parameter address' })
    }
    valueAddresses.add(binding.address)
  })
  ;(osc.records ?? []).forEach((binding, index) => {
    if (valueAddresses.has(binding.address)) {
      issues.push({ path: [...base, 'records', index, 'address'], message: 'record address must not be a parameter or record address' })
    }
    valueAddresses.add(binding.address)
  })

  // 一覧・要求のアドレスの衝突(D-054、D-061 でレコードへ拡張)。一覧も要求も値のアドレスと重なると、一覧が値の
  // エコーと区別できず保持値や表示を壊す。また Unity はどのアドレスもエコーするので、要求アドレスが一覧のアドレスと
  // 重なると、要求(引数なし)のエコーが「空の一覧」として届いてしまう。同じ要求を複数の一覧で共有するのは可。
  // 一覧どうしでアドレスを共有すると、届いた一覧がどちらのものか決まらないので id ごとに別のアドレスにする
  const lists = osc.lists ?? []
  const listAddresses = new Set(lists.map(binding => binding.address))
  const uiLists = new Set((definition.records ?? []).filter(record => record.keysFrom.source === 'ui').map(record => record.keysFrom.list))
  const seenListAddresses = new Set<string>()
  lists.forEach((binding, index) => {
    const path: IssuePath = [...base, 'lists', index]
    if (seenListAddresses.has(binding.address)) {
      issues.push({ path: [...path, 'address'], message: 'duplicate list address' })
    }
    seenListAddresses.add(binding.address)
    if (valueAddresses.has(binding.address)) {
      issues.push({ path: [...path, 'address'], message: 'list address must not be a parameter or record address' })
    }
    if (binding.request === undefined) return
    // UI で管理する一覧(D-075)はブリッジが持ってターゲットへ送る側なので、要求を持てない
    if (uiLists.has(binding.id)) {
      issues.push({ path: [...path, 'request'], message: 'list of a keysFrom with source ui must not have a request' })
    }
    if (valueAddresses.has(binding.request)) {
      issues.push({ path: [...path, 'request'], message: 'list request must not be a parameter or record address' })
    }
    if (listAddresses.has(binding.request)) {
      issues.push({ path: [...path, 'request'], message: 'list request must not be a list address' })
    }
  })

  // selector(アクションの match。HID-166)は少なくとも 1 件に当たり、展開後のまとめ送りは上限(512)以内
  const parameterAddresses = new Map<string, string>()
  for (const binding of osc.parameters) if (!parameterAddresses.has(binding.id)) parameterAddresses.set(binding.id, binding.address)
  const addressesInOrder = definition.parameters.map(parameter => parameterAddresses.get(parameter.id))
  const selectorsById = indexById(osc.selectors ?? [])
  const hitsOf = new Map<string, number>()
  const countHits = (match: string, cap: number) => {
    let hits = 0
    for (const address of addressesInOrder) {
      if (address !== undefined && matchesPattern(match, address)) hits += 1
      if (hits > cap) break
    }
    return hits
  }
  ;(osc.selectors ?? []).forEach((binding, index) => {
    const hits = countHits(binding.match, OSC_BATCH.MAX_MESSAGES)
    hitsOf.set(binding.id, hits)
    if (hits === 0) issues.push({ path: [...base, 'selectors', index, 'match'], message: `match hits no parameter: ${binding.match}` })
  })
  ;(definition.actions ?? []).forEach((action, actionIndex) => {
    if (action.scope !== undefined || action.steps.length > OSC_BATCH.MAX_MESSAGES) return
    if (!action.steps.some(step => 'selector' in step)) return
    let total = 0
    for (const step of action.steps) {
      if ('param' in step) total += 1
      else if ('selector' in step && selectorsById.has(step.selector)) total += hitsOf.get(step.selector) ?? 0
      if (total > OSC_BATCH.MAX_MESSAGES) break
    }
    if (total > OSC_BATCH.MAX_MESSAGES) {
      issues.push({ path: ['actions', actionIndex, 'steps'], message: `action expands to more than ${OSC_BATCH.MAX_MESSAGES} messages` })
    }
  })
}

/**
 * 構造検証を通った定義に対する意味検証(JSON Schema では書けない規則)。
 * Python 側 `oscdesk_ui.surface_definition` が同じ規則を実装し、
 * `protocol/surface-definition-samples.json` で判定の一致を担保する。
 */
export function collectSurfaceDefinitionIssues(definition: SurfaceDefinitionStructure): SurfaceDefinitionIssue[] {
  const issues: SurfaceDefinitionIssue[] = []
  const ids = new Map<string, SurfaceParameter>()

  definition.parameters.forEach((parameter, index) => {
    if (ids.has(parameter.id)) {
      issues.push({ path: ['parameters', index, 'id'], message: 'duplicate parameter id' })
    }
    ids.set(parameter.id, parameter)
    collectValueSpecIssues(parameter, parameter.kind, 'parameter', ['parameters', index], issues)
    if (parameter.widget !== undefined && !widgetFits(parameter.widget, parameter)) {
      issues.push({ path: ['parameters', index, 'widget'], message: `widget ${parameter.widget} does not fit parameter ${parameter.id}` })
    }
  })

  collectRecordIssues(definition, new Set(ids.keys()), issues)
  collectKeySourceIssues(definition, issues)
  const fieldIndexOf = createFieldIndex()
  collectActionIssues(definition, fieldIndexOf, issues)

  const actionsById = indexById(definition.actions ?? [])
  const recordsById = indexById(definition.records ?? [])
  // 同じアクションを多数の rowActions が参照しても steps を毎回走査しないよう、アクションごとに 1 回だけ集める
  // (rowActions 数 × steps 数の総当たりは 1 MiB の定義で数秒〜数十秒ブロックする)
  const keysListCache = new Map<SurfaceAction, Set<string>>()
  const keysListsOf = (action: SurfaceAction): ReadonlySet<string> => {
    let lists = keysListCache.get(action)
    if (lists === undefined) {
      lists = new Set<string>()
      for (const step of action.steps) {
        const target = 'record' in step ? recordsById.get(step.record) : undefined
        if (target !== undefined) lists.add(target.keysFrom.list)
      }
      keysListCache.set(action, lists)
    }
    return lists
  }
  const screenIds = new Set<string>()
  definition.screens.forEach((screen, screenIndex) => {
    if (screenIds.has(screen.id)) {
      issues.push({ path: ['screens', screenIndex, 'id'], message: 'duplicate screen id' })
    }
    screenIds.add(screen.id)

    const visit = (nodes: SurfaceLayoutNode[], nodePath: (string | number)[]): void => {
      nodes.forEach((node, nodeIndex) => {
        const here = [...nodePath, nodeIndex]
        if (node.kind === 'control') {
          // control はパラメータ id だけを参照する(レコード id は record ノードで置く)
          const parameter = ids.get(node.param)
          if (parameter === undefined) {
            issues.push({ path: [...here, 'param'], message: `unknown parameter: ${node.param}` })
          } else if (node.widget !== undefined && !widgetFits(node.widget, parameter)) {
            issues.push({ path: [...here, 'widget'], message: `widget ${node.widget} does not fit parameter ${node.param}` })
          }
        } else if (node.kind === 'action') {
          const action = actionsById.get(node.action)
          if (action === undefined) {
            issues.push({ path: [...here, 'action'], message: `unknown action: ${node.action}` })
          } else if (action.scope === 'row') {
            // 行が決まらないので、行のアクションは record ノードの rowActions にだけ置ける
            issues.push({ path: [...here, 'action'], message: `row-scoped action must be placed in rowActions: ${node.action}` })
          }
        } else if (node.kind === 'record') {
          collectRecordNodeIssues(node, here, recordsById, actionsById, keysListsOf, fieldIndexOf, issues)
        } else if (node.kind === 'tabs') {
          node.tabs.forEach((tab, tabIndex) => visit(tab.children, [...here, 'tabs', tabIndex, 'children']))
        } else {
          visit(node.children, [...here, 'children'])
        }
      })
    }
    visit(screen.children, ['screens', screenIndex, 'children'])
  })

  const osc = definition.bindings?.osc
  if (osc !== undefined) collectOscBindingIssues(definition, osc, issues)

  return issues
}

export const SurfaceDefinitionSchema = SurfaceDefinitionStructureSchema.superRefine((definition, context) => {
  for (const issue of collectSurfaceDefinitionIssues(definition)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: issue.path, message: issue.message })
  }
})

export type SurfaceDefinition = SurfaceDefinitionStructure

/** UI へ配る本体(結び付けを外したもの)と、結び付けに分ける(D-117)。 */
export function splitSurfaceBindings(definition: SurfaceDefinition): { definition: SurfaceDefinition; bindings: SurfaceBindings | undefined } {
  const { bindings, ...body } = definition
  return { definition: body, bindings }
}

/**
 * アクションの selector がどのパラメータに当たるか(定義順)。UI は結び付け(OSC のアドレス)を見ずに selector の step を
 * 展開できるよう、surface フレームでこれを受け取る(D-117)。結び付けの無い selector は空
 */
export function resolveSelectors(definition: SurfaceDefinition): { selector: string; params: string[] }[] {
  const osc = definition.bindings?.osc
  const addressOf = new Map((osc?.parameters ?? []).map(binding => [binding.id, binding.address]))
  return selectorReferences(definition).map(selector => {
    const match = osc?.selectors?.find(binding => binding.id === selector)?.match
    const params = match === undefined
      ? []
      : definition.parameters.filter(parameter => {
          const address = addressOf.get(parameter.id)
          return address !== undefined && matchesPattern(match, address)
        }).map(parameter => parameter.id)
    return { selector, params }
  })
}
