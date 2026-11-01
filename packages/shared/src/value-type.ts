import { z } from 'zod'

import { CATALOG, type CatalogItem } from './catalog'
import { IDENTIFIER_PATTERN, VALUE_HINT_PATTERN } from './surface-definition'

// 拡張パッケージが定義する型(HID-380・D-121)。送受信の型は OSC 1.0 の標準の型だけで、独自の型タグは足さない
// (UE など別のターゲットと同じコントローラーを共有するため)。新しい型は「基本型(i / f / s / bool)・Record・配列の
// 組み合わせ + 制約 + 表示ヒントの名前」で表し、その構造(スキーマ)を設計図(/sys/catalog/*)の項目に載せる。
// 例: color = Record(f × 4、範囲 0〜1)、ヒント color。
// 型の仕組みは最初から入れ子(Record の中の Record・配列)を表せるが、OSC の引数で送れるのは基本型だけを並べた
// Record(フラットな構造)まで。入れ子・可変長は将来 CBOR の Blob で送る方針で、今はスキーマとしては受けるが
// 画面には出さず、定義(サーフェス定義の composite パラメータ)にもできない(HID-397)。
// このファイルは OSC に依存しない(スキーマは JSON の値)。

/** 設計図の項目の type。基本型の項目(i / f / s / bool …)と区別するため、組み合わせの型はすべてこの 1 つで表す */
export const CATALOG_COMPOSITE_TYPE = 'composite'
/** 型のスキーマを JSON の文字列で運ぶキー。1 つの文字列は 1024 文字までなので、同じキーを繰り返した値を順に連結して読む */
export const CATALOG_SCHEMA_KEY = 'schema'

export const VALUE_TYPE = {
  // 入れ子の深さ(最上位の Record が 1)。受け側の再帰を縛る
  MAX_DEPTH: 8,
  // 1 つの Record のフィールドの数。OSC の 1 メッセージの引数として並べるので、受け口の 1 メッセージの大きさに収まる数に抑える
  MAX_FIELDS: 64,
  // スキーマ全体の要素(フィールド・配列の要素の型)の数
  MAX_NODES: 512,
  MAX_ARRAY_ITEMS: 1024,
} as const

const hintSchema = z.string().regex(new RegExp(VALUE_HINT_PATTERN))
const identifierSchema = z.string().regex(new RegExp(IDENTIFIER_PATTERN))
const rangeSchema = z.tuple([z.number().finite(), z.number().finite()])

export type ValueType =
  | { type: 'i' | 'f'; hint?: string | undefined; range?: [number, number] | undefined; step?: number | undefined; default?: number | undefined }
  | { type: 's'; hint?: string | undefined; options?: string[] | undefined; default?: string | undefined }
  | { type: 'bool'; hint?: string | undefined; default?: boolean | undefined }
  | { type: 'record'; hint?: string | undefined; fields: ValueTypeField[] }
  | { type: 'array'; hint?: string | undefined; items: ValueType; maxItems?: number | undefined }
export type ValueTypeField = ValueType & { id: string; label?: string | undefined }
/** 名前の付いた型(設計図の composite の項目のスキーマ)。最上位は Record か配列 */
export type CompositeType = Extract<ValueType, { type: 'record' | 'array' }> & { name: string }

const scalarShapes = {
  number: <T extends 'i' | 'f'>(type: T) => ({
    type: z.literal(type),
    hint: hintSchema.optional(),
    range: rangeSchema.optional(),
    step: z.number().finite().positive().optional(),
    default: z.number().finite().optional(),
  }),
  string: {
    type: z.literal('s'),
    hint: hintSchema.optional(),
    options: z.array(z.string().max(CATALOG.MAX_STRING_CHARS)).min(1).optional(),
    default: z.string().max(CATALOG.MAX_STRING_CHARS).optional(),
  },
  bool: { type: z.literal('bool'), hint: hintSchema.optional(), default: z.boolean().optional() },
}

const fieldExtras = { id: identifierSchema, label: z.string().min(1).max(CATALOG.MAX_STRING_CHARS).optional() }

// 要素の型(id を持たない)とフィールド(id とラベルを持つ)は同じ型の集まりで、入れ子の分だけ lazy で辿る
export const ValueTypeSchema: z.ZodType<ValueType> = z.lazy(() => z.discriminatedUnion('type', [
  z.object(scalarShapes.number('i')).strict(),
  z.object(scalarShapes.number('f')).strict(),
  z.object(scalarShapes.string).strict(),
  z.object(scalarShapes.bool).strict(),
  z.object({ type: z.literal('record'), hint: hintSchema.optional(), fields: z.array(ValueTypeFieldSchema).min(1).max(VALUE_TYPE.MAX_FIELDS) }).strict(),
  z.object({
    type: z.literal('array'),
    hint: hintSchema.optional(),
    items: ValueTypeSchema,
    maxItems: z.number().int().min(1).max(VALUE_TYPE.MAX_ARRAY_ITEMS).optional(),
  }).strict(),
]))

export const ValueTypeFieldSchema: z.ZodType<ValueTypeField> = z.lazy(() => z.discriminatedUnion('type', [
  z.object({ ...scalarShapes.number('i'), ...fieldExtras }).strict(),
  z.object({ ...scalarShapes.number('f'), ...fieldExtras }).strict(),
  z.object({ ...scalarShapes.string, ...fieldExtras }).strict(),
  z.object({ ...scalarShapes.bool, ...fieldExtras }).strict(),
  z.object({
    type: z.literal('record'), hint: hintSchema.optional(), fields: z.array(ValueTypeFieldSchema).min(1).max(VALUE_TYPE.MAX_FIELDS), ...fieldExtras,
  }).strict(),
  z.object({
    type: z.literal('array'),
    hint: hintSchema.optional(),
    items: ValueTypeSchema,
    maxItems: z.number().int().min(1).max(VALUE_TYPE.MAX_ARRAY_ITEMS).optional(),
    ...fieldExtras,
  }).strict(),
]))

const typeNameSchema = z.string().regex(new RegExp(VALUE_HINT_PATTERN))

export const CompositeTypeSchema: z.ZodType<CompositeType> = z.discriminatedUnion('type', [
  z.object({ name: typeNameSchema, type: z.literal('record'), hint: hintSchema.optional(), fields: z.array(ValueTypeFieldSchema).min(1).max(VALUE_TYPE.MAX_FIELDS) }).strict(),
  z.object({
    name: typeNameSchema,
    type: z.literal('array'),
    hint: hintSchema.optional(),
    items: ValueTypeSchema,
    maxItems: z.number().int().min(1).max(VALUE_TYPE.MAX_ARRAY_ITEMS).optional(),
  }).strict(),
])

/** 型の木の深さ(基本型は 0、基本型だけの Record は 1)と要素の数。上限の検査に使う */
function measure(type: ValueType, depth: number, budget: { nodes: number }): number {
  budget.nodes += 1
  if (budget.nodes > VALUE_TYPE.MAX_NODES || depth > VALUE_TYPE.MAX_DEPTH) return Number.POSITIVE_INFINITY
  if (type.type === 'record') return Math.max(...type.fields.map(field => measure(field, depth + 1, budget)), depth)
  if (type.type === 'array') return measure(type.items, depth + 1, budget)
  return depth
}

/**
 * 組み合わせの型のスキーマ(JSON の値)を検証する。読めなければ理由を返す。
 * 入れ子の深さと要素の数も縛る(認証の無い LAN から深い木を送られて受け側の再帰で落ちないように)
 */
export function parseCompositeType(value: unknown): { ok: true; type: CompositeType } | { ok: false; reason: string } {
  // zod の lazy は深い木で再帰が深くなるので、検証の前に JSON の入れ子の深さを見ておく
  if (jsonDepth(value, 0) > VALUE_TYPE.MAX_DEPTH * 3 + 4) return { ok: false, reason: 'schema is nested too deeply' }
  const parsed = CompositeTypeSchema.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { ok: false, reason: issue === undefined ? 'invalid schema' : `${issue.path.join('/') || '(root)'}: ${issue.message}` }
  }
  if (measure(parsed.data, 0, { nodes: 0 }) === Number.POSITIVE_INFINITY) {
    return { ok: false, reason: `schema exceeds ${String(VALUE_TYPE.MAX_DEPTH)} levels or ${String(VALUE_TYPE.MAX_NODES)} nodes` }
  }
  const duplicate = duplicateFieldId(parsed.data)
  if (duplicate !== undefined) return { ok: false, reason: `duplicate field id: ${duplicate}` }
  return { ok: true, type: parsed.data }
}

function jsonDepth(value: unknown, depth: number): number {
  if (depth > VALUE_TYPE.MAX_DEPTH * 3 + 4) return depth
  if (Array.isArray(value)) return Math.max(depth, ...value.map(item => jsonDepth(item, depth + 1)))
  if (value !== null && typeof value === 'object') return Math.max(depth, ...Object.values(value).map(item => jsonDepth(item, depth + 1)))
  return depth
}

function duplicateFieldId(type: ValueType): string | undefined {
  if (type.type === 'array') return duplicateFieldId(type.items)
  if (type.type !== 'record') return undefined
  const seen = new Set<string>()
  for (const field of type.fields) {
    if (seen.has(field.id)) return field.id
    seen.add(field.id)
    const inner = duplicateFieldId(field)
    if (inner !== undefined) return inner
  }
  return undefined
}

/**
 * 設計図の composite の項目から型のスキーマを読む。キー `schema` の値(文字列)を送られた順に連結した JSON。
 * composite でない項目・スキーマの無い項目・読めないスキーマは理由を返す(項目は設計図の側に残り、画面に出ないだけ)
 */
export function catalogItemType(item: Pick<CatalogItem, 'type' | 'props'>): { ok: true; type: CompositeType } | { ok: false; reason: string } {
  if (item.type !== CATALOG_COMPOSITE_TYPE) return { ok: false, reason: `not a ${CATALOG_COMPOSITE_TYPE} item` }
  const parts = item.props.filter(prop => prop.key === CATALOG_SCHEMA_KEY)
  if (parts.length === 0) return { ok: false, reason: 'composite item has no schema' }
  if (parts.some(prop => prop.arg.type !== 's')) return { ok: false, reason: 'schema must be a string' }
  let value: unknown
  try {
    value = JSON.parse(parts.map(prop => prop.arg.value as string).join(''))
  } catch {
    return { ok: false, reason: 'schema is not JSON' }
  }
  return parseCompositeType(value)
}

export type FlatFieldType = Extract<ValueTypeField, { type: 'i' | 'f' | 's' | 'bool' }>

/**
 * OSC の引数として並べて送れる形(基本型のフィールドだけの Record)ならそのフィールドを返す。
 * 入れ子(Record の中の Record)・可変長(配列)は CBOR で送る方針で今は送れないので、理由を返す(HID-397)
 */
export function flatCompositeFields(type: CompositeType): { ok: true; fields: FlatFieldType[] } | { ok: false; reason: 'nested' | 'variable-length' } {
  if (type.type === 'array') return { ok: false, reason: 'variable-length' }
  const fields: FlatFieldType[] = []
  for (const field of type.fields) {
    if (field.type === 'array') return { ok: false, reason: 'variable-length' }
    if (field.type === 'record') return { ok: false, reason: 'nested' }
    fields.push(field)
  }
  return { ok: true, fields }
}

/** スキーマを設計図のキー `schema` の値に分ける(1024 文字ごと)。mock-unity と C# の送信側の見本 */
export function compositeSchemaProps(type: CompositeType): { key: string; arg: { type: 's'; value: string } }[] {
  const text = JSON.stringify(type)
  const props: { key: string; arg: { type: 's'; value: string } }[] = []
  let index = 0
  while (index < text.length) {
    let end = Math.min(text.length, index + CATALOG.MAX_STRING_CHARS)
    // サロゲートの組の間で切ると、どちらの断片も UTF-8 にできない文字列になる(受け口はそういう組を落とす)
    const last = text.charCodeAt(end - 1)
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end -= 1
    props.push({ key: CATALOG_SCHEMA_KEY, arg: { type: 's', value: text.slice(index, end) } })
    index = end
  }
  return props
}
