import { z } from 'zod'

import {
  PAD_ADDRESS_PATTERN,
  PAD_DOCUMENT,
  collectControlIssues,
  type PadArg,
  type PadField,
  type PadOption,
  type PadWidget,
  type PadWidgetKind,
} from './pad-document'

// OSCQuery のノードからパッドの部品を決める規則(D-167。調査は HID-484 の §5)。純粋関数で、ブリッジ(パレットの配信と
// 編集の規則)が使う。入力は OSCQuery のノードの属性のうち部品を決めるのに要るものだけを写した最小の形で、名前空間を
// 読むクライアント(HID-488)がこの形に直して渡す。
//
// | TYPE                                    | RANGE・その他                 | 部品                         |
// | 無い・N・I                               |                               | ボタン(引数なしで送る)       |
// | T / F                                   |                               | トグル(T / F で送る)         |
// | i                                       | VALS が [0,1]、か MIN 0・MAX 1 | トグル(0 / 1 で送る)         |
// | i / f / s                               | VALS あり                     | 選択                         |
// | i / f                                   | MIN と MAX あり               | スライダー                   |
// | i / f                                   | 範囲なし                      | 数値の入力                   |
// | s                                       | VALS なし                     | 文字の入力                   |
// | r、か ffff(0〜1)で EXTENDED_TYPE が色   |                               | 色                           |
// | 2 文字以上(上に当たらないもの)          |                               | 組み合わせ(引数ごとの部品)   |
// | h・d・t・b・[] などそのほか              |                               | 出さない(未対応として返す)   |
//
// ACCESS 1(読むだけ)は表示だけ(readOnly)。送り直すかの既定は ACCESS 3 なら送り直す、2 なら送るだけ(D-165)。
// ACCESS が無いノードは 3 とみなす(OSCQuery の多くの実装は書ける値に ACCESS を省かず付けるが、省いたものを
// 送るだけに倒すと、利用者が気づかないまま再送から漏れるため)。部品の種類と送り直すかは利用者が上書きできる。

const OscQueryRangeSchema = z.object({
  MIN: z.number().optional(),
  MAX: z.number().optional(),
  VALS: z.array(z.unknown()).optional(),
}).passthrough()

/** 部品を決めるのに要る OSCQuery のノードの属性(名前は OSCQuery の大文字の属性を小文字にしたもの) */
export const OscQueryNodeInfoSchema = z.object({
  /** FULL_PATH */
  address: z.string().max(PAD_DOCUMENT.MAX_ADDRESS_CHARS),
  /** TYPE(OSC の型タグの並び。無ければ値を持たない) */
  type: z.string().max(256).optional(),
  /** RANGE。引数ごとの配列(OSCQuery の正しい形)か、引数 1 つのときの 1 つのオブジェクト。null は「範囲なし」 */
  // 引数ごとの配列は TYPE の上限(256 文字)と同じ数まで
  range: z.union([z.array(OscQueryRangeSchema.nullable()).max(256), OscQueryRangeSchema]).optional(),
  /** ACCESS(0: 値なし、1: 読むだけ、2: 書くだけ、3: 読み書き) */
  access: z.number().int().min(0).max(3).optional(),
  /** EXTENDED_TYPE。引数ごとの配列か 1 つの文字列 */
  extendedType: z.union([z.array(z.string().max(256).nullable()).max(256), z.string().max(256)]).optional(),
  /** DESCRIPTION(部品のラベルにする) */
  description: z.string().optional(),
}).strict()

export type OscQueryRange = z.infer<typeof OscQueryRangeSchema>
export type OscQueryNodeInfo = z.infer<typeof OscQueryNodeInfoSchema>

/** 部品のうち、置き場所(id・row・column と広がり)を除いたもの。編集の規則が id と位置を足してパッドに置く */
export type PadWidgetSpec = PadWidget extends infer W ? W extends PadWidget ? Omit<W, 'id' | 'row' | 'column' | 'rowSpan' | 'columnSpan'> : never : never

/** ノードから作れる部品の種類(表は複数のノードからできるので、ここでは作らない) */
export type NodeWidgetKind = Exclude<PadWidgetKind, 'table'>

export type NodeWidgetResult =
  | { ok: true; widget: PadWidgetSpec; kinds: NodeWidgetKind[] }
  | { ok: false; reason: 'unsupported-type' | 'invalid-address' | 'read-only-without-value' | 'kind-not-allowed'; detail: string; kinds: NodeWidgetKind[] }

export interface NodeWidgetOverrides {
  /** 部品の種類の上書き。ノードの型で作れる種類(結果の kinds)だけを受ける */
  kind?: NodeWidgetKind
  /** 送り直すか(D-165)の上書き。値を持つ部品だけに効く */
  resend?: boolean
}

// 1 つの引数に置ける型タグ。これ以外(h・d・t・b・c・m・S・[ ] など)を含むノードは部品にしない
const SCALAR_TAGS = new Set(['i', 'f', 's', 'T', 'F'])
const VALUELESS_TAGS = new Set(['N', 'I'])
const ADDRESS = new RegExp(PAD_ADDRESS_PATTERN)

type ScalarTag = 'i' | 'f' | 's' | 'T' | 'F'
type Field = PadField extends infer F ? F extends PadField ? Omit<F, 'id' | 'label'> : never : never

function rangeAt(node: OscQueryNodeInfo, index: number): OscQueryRange | undefined {
  if (node.range === undefined) return undefined
  if (Array.isArray(node.range)) return node.range[index] ?? undefined
  return index === 0 ? node.range : undefined
}

function extendedTypes(node: OscQueryNodeInfo): string[] {
  if (node.extendedType === undefined) return []
  return (Array.isArray(node.extendedType) ? node.extendedType : [node.extendedType]).filter((value): value is string => typeof value === 'string')
}

const INT32_MIN = -2147483648
const INT32_MAX = 2147483647
const fitsNumber = (tag: 'i' | 'f', value: unknown): value is number => typeof value === 'number' && (tag === 'i'
  ? Number.isInteger(value) && value >= INT32_MIN && value <= INT32_MAX
  : Number.isFinite(value) && Number.isFinite(Math.fround(value)))

/** VALS のうち型に合う値(重なりは除く)。合う値が無いか多すぎれば undefined(選択にしない) */
function optionsOf(tag: 'i' | 'f' | 's', range: OscQueryRange | undefined): PadOption[] | undefined {
  // 候補の上限を超える VALS は読まずに選択にしない(重なりを除いても上限に収まる VALS はまれで、巨大な VALS を
  // 毎回走査しない。この関数は 1 つのノードにつき何度も呼ばれる。PR #172 のレビュー)
  if (range?.VALS === undefined || range.VALS.length > PAD_DOCUMENT.MAX_OPTIONS) return undefined
  const values = new Set<number | string>()
  for (const value of range.VALS) {
    if (tag === 's') {
      if (typeof value === 'string' && value.length <= PAD_DOCUMENT.MAX_STRING_CHARS) values.add(value)
    } else if (fitsNumber(tag, value)) {
      values.add(value)
    }
  }
  if (values.size === 0) return undefined
  const options = [...values].map(value => ({ value }))
  // NUL・孤立サロゲートなど OSC に載せられない候補が混ざっていれば、選択にしない
  return collectControlIssues({ kind: 'select', type: tag, options }, []).length === 0 ? options : undefined
}

/** MIN と MAX を型の値域に収めた範囲。i は内側の整数へ丸める。読めなければ片側ずつ undefined */
function boundsOf(tag: 'i' | 'f', range: OscQueryRange | undefined): { min?: number; max?: number } {
  const bound = (value: number | undefined, round: (value: number) => number) => {
    if (value === undefined) return undefined
    const rounded = tag === 'i' ? round(value) : value
    return fitsNumber(tag, rounded) ? rounded : undefined
  }
  const min = bound(range?.MIN, Math.ceil)
  const max = bound(range?.MAX, Math.floor)
  return { ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) }
}

const isBinaryInt = (range: OscQueryRange | undefined): boolean => {
  if (range === undefined) return false
  if (range.VALS !== undefined) return range.VALS.length === 2 && range.VALS.includes(0) && range.VALS.includes(1)
  return range.MIN === 0 && range.MAX === 1
}

/** 引数 1 つの既定の操作(トグル・選択・スライダー・数値・文字) */
function fieldFor(tag: ScalarTag, range: OscQueryRange | undefined): Field {
  if (tag === 'T' || tag === 'F') return { kind: 'toggle', type: 'T' }
  if (tag === 'i' && isBinaryInt(range)) return { kind: 'toggle', type: 'i' }
  const options = optionsOf(tag, range)
  if (options !== undefined) return { kind: 'select', type: tag, options }
  if (tag === 's') return { kind: 'text', type: 's' }
  const { min, max } = boundsOf(tag, range)
  if (min !== undefined && max !== undefined && min < max) return { kind: 'slider', type: tag, min, max }
  return { kind: 'number', type: tag, ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) }
}

/** 引数 1 つに置ける操作の種類(上書きの候補) */
function fieldKindsFor(tag: ScalarTag, range: OscQueryRange | undefined): PadField['kind'][] {
  if (tag === 'T' || tag === 'F') return ['toggle']
  const kinds: PadField['kind'][] = []
  if (tag === 'i') kinds.push('toggle')
  if (optionsOf(tag, range) !== undefined) kinds.push('select')
  if (tag === 's') return [...kinds, 'text']
  const { min, max } = boundsOf(tag, range)
  if (min !== undefined && max !== undefined && min < max) kinds.push('slider')
  return [...kinds, 'number']
}

/** 種類を指定した引数 1 つの操作。作れなければ undefined */
function fieldOfKind(kind: PadField['kind'], tag: ScalarTag, range: OscQueryRange | undefined): Field | undefined {
  if (!fieldKindsFor(tag, range).includes(kind)) return undefined
  const preferred = fieldFor(tag, range)
  if (preferred.kind === kind) return preferred
  switch (kind) {
    case 'toggle': return { kind: 'toggle', type: tag === 'i' ? 'i' : 'T' }
    case 'text': return { kind: 'text', type: 's' }
    case 'select': return { kind: 'select', type: tag as 'i' | 'f' | 's', options: optionsOf(tag as 'i' | 'f' | 's', range)! }
    case 'slider': {
      const { min, max } = boundsOf(tag as 'i' | 'f', range)
      return { kind: 'slider', type: tag as 'i' | 'f', min: min!, max: max! }
    }
    case 'number': {
      const { min, max } = boundsOf(tag as 'i' | 'f', range)
      return { kind: 'number', type: tag as 'i' | 'f', ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) }
    }
  }
}

/** ボタンに上書きしたときに送る決まった値(型ごとの既定値) */
function defaultArg(tag: ScalarTag): PadArg {
  switch (tag) {
    case 'i': return { type: 'i', value: 0 }
    case 'f': return { type: 'f', value: 0 }
    case 's': return { type: 's', value: '' }
    case 'T': return { type: 'T' }
    case 'F': return { type: 'F' }
  }
}

function labelOf(node: OscQueryNodeInfo): string {
  const description = node.description?.trim() ?? ''
  const text = description !== '' ? description : node.address.split('/').filter(part => part !== '').pop() ?? node.address
  // 64 文字(JS の length)で切る。サロゲートの対の途中で切っても、ラベルは画面に出すだけなので受ける
  return text.slice(0, PAD_DOCUMENT.MAX_LABEL_CHARS)
}

const isColorExtended = (node: OscQueryNodeInfo): boolean => extendedTypes(node).some(value => /colou?r/i.test(value))

const isUnitRange = (node: OscQueryNodeInfo, count: number): boolean => {
  for (let index = 0; index < count; index += 1) {
    const range = rangeAt(node, index)
    if (range === undefined) continue
    if ((range.MIN !== undefined && range.MIN !== 0) || (range.MAX !== undefined && range.MAX !== 1)) return false
  }
  return true
}

/**
 * ノードの型から作れる部品の種類と、既定の種類。作れない型なら kinds は空。
 * ボタンへの上書きは、決まった値(型ごとの既定値)を 1 回送る使い方のため、値を持つ型でも選べる
 */
function analyze(node: OscQueryNodeInfo): { preferred: NodeWidgetKind | null; kinds: NodeWidgetKind[]; tags: string[] } {
  const tags = [...(node.type ?? '')]
  if (tags.length === 0 || tags.every(tag => VALUELESS_TAGS.has(tag))) return { preferred: 'button', kinds: ['button'], tags }
  if (tags.length === 1 && tags[0] === 'r') return { preferred: 'color', kinds: ['color'], tags }
  if (!tags.every(tag => SCALAR_TAGS.has(tag))) return { preferred: null, kinds: [], tags }
  if (tags.length === 1) {
    const tag = tags[0] as ScalarTag
    const fieldKinds = fieldKindsFor(tag, rangeAt(node, 0))
    return { preferred: fieldFor(tag, rangeAt(node, 0)).kind, kinds: [...fieldKinds, 'button'], tags }
  }
  if (tags.length > PAD_DOCUMENT.MAX_FIELDS) return { preferred: null, kinds: [], tags }
  const color = tags.length === 4 && tags.every(tag => tag === 'f') && isUnitRange(node, 4)
  return {
    preferred: color && isColorExtended(node) ? 'color' : 'composite',
    kinds: [...(color ? ['color' as const] : []), 'composite' as const, 'button' as const],
    tags,
  }
}

/**
 * OSCQuery のノードからパッドの部品(置き場所を除く)を決める。overrides で種類と送り直すかを上書きできる。
 * 部品にできないノード(未対応の型・予約やパターン文字を含むアドレス・値の無い読むだけのノード)は理由を返す
 * (パレットは「未対応」として一覧に載せる)
 */
export function padWidgetFromNode(node: OscQueryNodeInfo, overrides: NodeWidgetOverrides = {}): NodeWidgetResult {
  const { preferred, kinds, tags } = analyze(node)
  if (!ADDRESS.test(node.address) || node.address.includes('\0')) {
    return { ok: false, reason: 'invalid-address', detail: `${node.address} はパッドから送れないアドレスです(/sys・/oscdesk・空白・パターン文字・空のパート)`, kinds: [] }
  }
  if (preferred === null) return { ok: false, reason: 'unsupported-type', detail: `型 ${node.type ?? ''} の部品はありません`, kinds: [] }
  const readOnly = node.access === 1
  if (readOnly && preferred === 'button') return { ok: false, reason: 'read-only-without-value', detail: '値を持たない読むだけのノードです', kinds: [] }
  // 読むだけのノードは表示だけの部品にする(決まった値を送るボタンにはできない)
  const allowed = readOnly ? kinds.filter(kind => kind !== 'button') : kinds
  const kind = overrides.kind ?? preferred
  if (!allowed.includes(kind)) return { ok: false, reason: 'kind-not-allowed', detail: `型 ${node.type ?? ''} のノードは ${kind} にできません`, kinds: allowed }
  const label = labelOf(node)
  const address = node.address
  if (kind === 'button') {
    return { ok: true, kinds: allowed, widget: { kind: 'button', label, address, args: tags.filter(tag => SCALAR_TAGS.has(tag)).map(tag => defaultArg(tag as ScalarTag)) } }
  }
  const holding = {
    resend: readOnly ? false : overrides.resend ?? node.access !== 2,
    ...(readOnly ? { readOnly: true } : {}),
  }
  if (kind === 'color') {
    return { ok: true, kinds: allowed, widget: { kind: 'color', type: tags.length === 1 ? 'r' : 'ffff', label, address, ...holding } }
  }
  if (kind === 'composite') {
    const fields = tags.map((tag, index): PadField => ({
      id: `a${String(index + 1)}`,
      // OSCQuery は引数ごとの名前を持たないので、並びの番号をラベルにする(利用者が書き換える)
      label: String(index + 1),
      ...fieldFor(tag as ScalarTag, rangeAt(node, index)),
    } as PadField))
    const hint = extendedTypes(node).length === 1 ? extendedTypes(node)[0] : undefined
    return {
      ok: true,
      kinds: allowed,
      widget: { kind: 'composite', label, address, ...(hint !== undefined && /^[A-Za-z][A-Za-z0-9_.-]{0,31}$/.test(hint) ? { hint } : {}), fields, ...holding },
    }
  }
  const field = fieldOfKind(kind, tags[0] as ScalarTag, rangeAt(node, 0))!
  return { ok: true, kinds: allowed, widget: { ...field, label, address, ...holding } as PadWidgetSpec }
}
