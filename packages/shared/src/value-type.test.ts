import { describe, expect, it } from 'vitest'

import type { CatalogItem } from './catalog'
import { compositeArgs, compositeInitialValue, compositeValueOf } from './composite-value'
import {
  catalogItemType,
  compositeSchemaProps,
  flatCompositeFields,
  parseCompositeType,
  VALUE_TYPE,
  type CompositeType,
} from './value-type'

const COLOR: CompositeType = {
  name: 'color',
  type: 'record',
  hint: 'color',
  fields: ['r', 'g', 'b', 'a'].map(id => ({ id, type: 'f' as const, range: [0, 1] as [number, number], default: 1 })),
}

const item = (props: CatalogItem['props'], type = 'composite'): CatalogItem => ({ address: '/fx/light/tint', kind: 'state', type, props })

describe('parseCompositeType (D-121)', () => {
  it('accepts a flat record and nested records and arrays in the schema', () => {
    expect(parseCompositeType(COLOR)).toEqual({ ok: true, type: COLOR })
    const nested = {
      name: 'light', type: 'record',
      fields: [
        { id: 'tint', type: 'record', hint: 'color', fields: COLOR.fields },
        { id: 'stops', type: 'array', items: { type: 'record', fields: [{ id: 'at', type: 'f' }] }, maxItems: 8 },
      ],
    }
    expect(parseCompositeType(nested).ok).toBe(true)
    expect(parseCompositeType({ name: 'list', type: 'array', items: { type: 's' } }).ok).toBe(true)
  })

  it('reads the schema the Unity package writes (OscValueTypeTests.ColorSchema)', () => {
    // C# の OscValueType.ToSchemaJson が書く文字列と同じ。どちらかを変えたら両方を揃える
    const fromUnity = '{"name":"color","type":"record","hint":"color","fields":['
      + '{"id":"r","label":"R","type":"f","range":[0,1],"default":1},'
      + '{"id":"g","type":"f","range":[0,1],"step":0.5},'
      + '{"id":"n","type":"i","range":[0,10],"default":3},'
      + '{"id":"mode","type":"s","options":["a","\\"b\\""],"default":"a"},'
      + '{"id":"on","type":"bool","default":true}]}'
    const parsed = parseCompositeType(JSON.parse(fromUnity))
    expect(parsed.ok).toBe(true)
    expect(parsed.ok && flatCompositeFields(parsed.type).ok).toBe(true)
    expect(parsed.ok && parsed.type.type === 'record' ? parsed.type.fields.map(field => field.type) : []).toEqual(['f', 'f', 'i', 's', 'bool'])
  })

  it('rejects unknown keys, scalar tops, duplicate field ids and trees that are too deep', () => {
    expect(parseCompositeType({ ...COLOR, extra: 1 }).ok).toBe(false)
    expect(parseCompositeType({ name: 'x', type: 'f' }).ok).toBe(false)
    expect(parseCompositeType({ ...COLOR, fields: [COLOR.fields[0], COLOR.fields[0]] })).toEqual({ ok: false, reason: 'duplicate field id: r' })
    let deep: Record<string, unknown> = { id: 'leaf', type: 'f' }
    for (let depth = 0; depth < VALUE_TYPE.MAX_DEPTH + 2; depth += 1) deep = { id: `n${String(depth)}`, type: 'record', fields: [deep] }
    expect(parseCompositeType({ name: 'deep', type: 'record', fields: [deep] }).ok).toBe(false)
  })
})

describe('catalogItemType (D-121)', () => {
  it('reads the schema from the repeated schema props joined in order', () => {
    const props = compositeSchemaProps(COLOR)
    expect(catalogItemType(item(props))).toEqual({ ok: true, type: COLOR })
    // 1024 文字を超えるスキーマは同じキーを繰り返して分ける
    const long: CompositeType = { ...COLOR, fields: Array.from({ length: 40 }, (_, index) => ({ id: `field${String(index)}`, label: '色'.repeat(10), type: 'f' as const })) }
    const split = compositeSchemaProps(long)
    expect(split.length).toBeGreaterThan(1)
    expect(split.every(prop => prop.arg.value.length <= 1024)).toBe(true)
    expect(catalogItemType(item(split))).toEqual({ ok: true, type: long })
  })

  it('explains why an item has no usable schema', () => {
    expect(catalogItemType(item([], 'f')).ok).toBe(false)
    expect(catalogItemType(item([]))).toEqual({ ok: false, reason: 'composite item has no schema' })
    expect(catalogItemType(item([{ key: 'schema', arg: { type: 's', value: '{' } }]))).toEqual({ ok: false, reason: 'schema is not JSON' })
    expect(catalogItemType(item([{ key: 'schema', arg: { type: 'i', value: 1 } }]))).toEqual({ ok: false, reason: 'schema must be a string' })
  })
})

describe('flatCompositeFields (D-121)', () => {
  it('returns the fields of a record of basic types and refuses nested or variable-length types (HID-397)', () => {
    expect(flatCompositeFields(COLOR)).toEqual({ ok: true, fields: COLOR.fields })
    expect(flatCompositeFields({ name: 'n', type: 'record', fields: [{ id: 'c', type: 'record', fields: COLOR.fields }] })).toEqual({ ok: false, reason: 'nested' })
    expect(flatCompositeFields({ name: 'a', type: 'record', fields: [{ id: 'l', type: 'array', items: { type: 'f' } }] })).toEqual({ ok: false, reason: 'variable-length' })
    expect(flatCompositeFields({ name: 'a', type: 'array', items: { type: 'f' } })).toEqual({ ok: false, reason: 'variable-length' })
  })
})

describe('composite values (D-121)', () => {
  const fields = [
    { id: 'x', type: 'f' as const, range: [0, 1] as const },
    { id: 'n', type: 'i' as const },
    { id: 'on', type: 'bool' as const },
    { id: 'mode', type: 's' as const, options: ['a', 'b'] },
  ]

  it('turns the value into the field arguments in declaration order and back', () => {
    const value = { on: true, mode: 'b', n: 3, x: 0.5 }
    const converted = compositeArgs(fields, value)
    expect(converted).toEqual({ ok: true, args: [{ type: 'f', value: 0.5 }, { type: 'i', value: 3 }, { type: 'i', value: 1 }, { type: 's', value: 'b' }] })
    expect(compositeValueOf(fields, converted.ok ? converted.args : [])).toEqual(value)
  })

  it('refuses missing, unknown, mistyped and out-of-range fields', () => {
    expect(compositeArgs(fields, { x: 0.5, n: 3, on: true })).toEqual({ ok: false, reason: 'missing field mode' })
    expect(compositeArgs(fields, { x: 0.5, n: 3, on: true, mode: 'a', y: 1 })).toEqual({ ok: false, reason: 'unknown field y' })
    expect(compositeArgs(fields, { x: 2, n: 3, on: true, mode: 'a' })).toEqual({ ok: false, reason: 'field x out of range' })
    expect(compositeArgs(fields, { x: 0.5, n: 1.5, on: true, mode: 'a' }).ok).toBe(false)
    expect(compositeArgs(fields, { x: 0.5, n: 1, on: 1, mode: 'a' }).ok).toBe(false)
    expect(compositeArgs(fields, { x: 0.5, n: 1, on: true, mode: 'c' }).ok).toBe(false)
    expect(compositeArgs(fields, 1).ok).toBe(false)
    expect(compositeArgs(fields, [0.5, 1, true, 'a']).ok).toBe(false)
  })

  it('reads only arguments with the declared count, types and ranges', () => {
    expect(compositeValueOf(fields, [{ type: 'f', value: 0.5 }])).toBeUndefined()
    expect(compositeValueOf(fields, [{ type: 'f', value: 2 }, { type: 'i', value: 1 }, { type: 'i', value: 0 }, { type: 's', value: 'a' }])).toBeUndefined()
    expect(compositeValueOf(fields, [{ type: 'f', value: Number.NaN }, { type: 'i', value: 1 }, { type: 'i', value: 0 }, { type: 's', value: 'a' }])).toBeUndefined()
    expect(compositeValueOf(fields, [{ type: 'i', value: 1 }, { type: 'f', value: 2 }, { type: 'i', value: 0 }, { type: 's', value: 'a' }])).toEqual({ x: 1, n: 2, on: false, mode: 'a' })
  })

  it('accepts a range bound echoed through float32 and refuses integers outside int32 (HID-398)', () => {
    const narrow = [{ id: 'x', type: 'f' as const, range: [0, 0.1] as const }]
    // 0.1 を float32 で送るとエコーは 0.10000000149011612 で届く。範囲の端として受け、端に寄せて持つ(D-124。UI は検査し直さない)
    expect(compositeValueOf(narrow, [{ type: 'f', value: Math.fround(0.1) }])).toEqual({ x: 0.1 })
    expect(compositeValueOf(narrow, [{ type: 'f', value: 0.11 }])).toBeUndefined()
    const counts = [{ id: 'n', type: 'i' as const }]
    expect(compositeValueOf(counts, [{ type: 'f', value: 4294967296 }])).toBeUndefined()
    expect(compositeValueOf(counts, [{ type: 'f', value: -2147483649 }])).toBeUndefined()
    expect(compositeValueOf(counts, [{ type: 'i', value: 2147483647 }])).toEqual({ n: 2147483647 })
  })

  it('collects the defaults (state) or the values (trigger)', () => {
    expect(compositeInitialValue('state', [{ id: 'a', type: 'f', default: 1 }])).toEqual({ a: 1 })
    expect(compositeInitialValue('trigger', [{ id: 'a', type: 'f', value: 2 }])).toEqual({ a: 2 })
    expect(() => compositeInitialValue('state', [{ id: 'a', type: 'f' }])).toThrow()
  })
})
