import type { OscArg } from './osc-types'

// 組み合わせの型のパラメータ(HID-380・D-121)の値と OSC の引数の相互変換。値は JSON のオブジェクト(フィールド id → 値)、
// OSC ではフィールドを宣言順に並べた引数(独自の型タグは使わない。bool は i の 0/1)。ブリッジの送信・保持値・エコー・
// プロジェクトファイルが同じ規則を使う。UI(Python)は同じ規則を surface_model.py に持つ

export type CompositeFieldValue = number | string | boolean
export type CompositeValue = Record<string, CompositeFieldValue>

/** 判定に要るフィールドの宣言(サーフェス定義のフィールドと OSC に解決したフィールドの両方が当てはまる形) */
export interface CompositeFieldSpec {
  id: string
  type: 'i' | 'f' | 's' | 'bool'
  range?: readonly [number, number] | undefined
  options?: readonly string[] | undefined
}

type ScalarArg = Extract<OscArg, { type: 'i' | 'f' | 's' }>

const INT32_MIN = -2147483648
const INT32_MAX = 2147483647

function fieldArg(field: CompositeFieldSpec, value: unknown): ScalarArg | string {
  switch (field.type) {
    case 'i':
      if (typeof value !== 'number' || !Number.isInteger(value) || value < INT32_MIN || value > INT32_MAX) return 'expects an int32'
      break
    case 'f':
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'expects a number'
      break
    case 's':
      if (typeof value !== 'string') return 'expects a string'
      if (field.options !== undefined && !field.options.includes(value)) return 'must be one of options'
      return { type: 's', value }
    case 'bool':
      if (typeof value !== 'boolean') return 'expects a boolean'
      return { type: 'i', value: value ? 1 : 0 }
  }
  if (field.range !== undefined && (value < field.range[0] || value > field.range[1])) return 'out of range'
  return { type: field.type, value }
}

/**
 * 値(フィールド id → 値)を、フィールドを宣言順に並べた OSC の引数にする。全フィールドが揃い、型・値域・options に
 * 収まらなければ理由を返す(半端な値を送ると受け口が別のフィールドとして読む)
 */
export function compositeArgs(fields: readonly CompositeFieldSpec[], value: unknown): { ok: true; args: ScalarArg[] } | { ok: false; reason: string } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'expects an object of field values' }
  const record = value as Record<string, unknown>
  const unknown = Object.keys(record).find(key => !fields.some(field => field.id === key))
  if (unknown !== undefined) return { ok: false, reason: `unknown field ${unknown}` }
  const args: ScalarArg[] = []
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(record, field.id)) return { ok: false, reason: `missing field ${field.id}` }
    const arg = fieldArg(field, record[field.id])
    if (typeof arg === 'string') return { ok: false, reason: `field ${field.id} ${arg}` }
    args.push(arg)
  }
  return { ok: true, args }
}

/**
 * OSC の引数を値にする。引数の数がフィールドと同じで、型(数値は i と f のどちらでも受ける)・値域・options に
 * 収まるときだけ返す。有限でない数は受けない(desired の JSON で null になり、UI がフレームごと捨てるため)
 */
export function compositeValueOf(fields: readonly CompositeFieldSpec[], args: readonly OscArg[]): CompositeValue | undefined {
  if (args.length !== fields.length) return undefined
  const value: CompositeValue = {}
  for (const [index, field] of fields.entries()) {
    const arg = args[index]!
    if (field.type === 's') {
      if (arg.type !== 's' || (field.options !== undefined && !field.options.includes(arg.value))) return undefined
      value[field.id] = arg.value
      continue
    }
    if ((arg.type !== 'i' && arg.type !== 'f') || !Number.isFinite(arg.value)) return undefined
    if (field.type === 'bool') {
      if (arg.value !== 0 && arg.value !== 1) return undefined
      value[field.id] = arg.value === 1
      continue
    }
    // 送る側(fieldArg)と同じく int32 に収まる整数だけ。範囲の無い i でも、送れない値(4294967296 など)を保持しない(HID-398)
    if (field.type === 'i' && (!Number.isInteger(arg.value) || arg.value < INT32_MIN || arg.value > INT32_MAX)) return undefined
    if (field.range !== undefined && !withinRange(field.type, arg.value, field.range)) return undefined
    value[field.id] = arg.value
  }
  return value
}

/**
 * 範囲の内か。f は OSC の float32 を経由して届く(0.1 は 0.10000000149011612 になる)ので、範囲の端も float32 に丸めて比べる
 * (正しく送った境界値のエコーを範囲外として捨てないため。HID-398)。i はそのまま比べる
 */
function withinRange(type: 'i' | 'f' | 'bool', value: number, range: readonly [number, number]): boolean {
  if (value >= range[0] && value <= range[1]) return true
  if (type !== 'f') return false
  const rounded = Math.fround(value)
  return rounded >= Math.fround(range[0]) && rounded <= Math.fround(range[1])
}

/** state のフィールドの default(trigger は value)を集めた値。検証済みの定義だけを渡す */
export function compositeInitialValue(
  kind: 'state' | 'trigger',
  fields: readonly (CompositeFieldSpec & { default?: CompositeFieldValue | undefined; value?: CompositeFieldValue | undefined })[],
): CompositeValue {
  const value: CompositeValue = {}
  for (const field of fields) {
    const chosen = kind === 'state' ? field.default : field.value
    if (chosen === undefined) throw new Error(`composite field ${field.id} has no ${kind === 'state' ? 'default' : 'value'}`)
    value[field.id] = chosen
  }
  return value
}
