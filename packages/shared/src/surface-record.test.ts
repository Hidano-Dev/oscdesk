import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { OSC_BATCH } from './limits'
import { resolveActionSteps, SurfaceDefinitionSchema, type SurfaceDefinition } from './surface-definition'
import { recordArgs, recordInitialValues, recordKeyOf, resolveRecordActionSteps } from './surface-record'

const samplesPath = path.resolve(__dirname, '../../../protocol/surface-definition-samples.json')
const samples = (JSON.parse(readFileSync(samplesPath, 'utf8')) as { cases: { name: string; definition: unknown }[] }).cases
const definition: SurfaceDefinition = SurfaceDefinitionSchema.parse(samples.find(sample => sample.name === 'records-basic')!.definition)
const records = definition.records!
const member = records[0]!
const memberUpdate = records[1]!
const action = (id: string) => definition.actions!.find(candidate => candidate.id === id)!

describe('recordInitialValues / recordArgs', () => {
  it('builds [s:key, fields in declaration order] from the field defaults, bool as int 0/1', () => {
    expect(recordInitialValues(member)).toEqual([false, 1, '', '(none)'])
    expect(recordArgs(member, '天音カナタ', recordInitialValues(member))).toEqual([
      { type: 's', value: '天音カナタ' },
      { type: 'i', value: 0 },
      { type: 'i', value: 1 },
      { type: 's', value: '' },
      { type: 's', value: '(none)' },
    ])
  })

  it('uses the fixed values of a trigger record (key only when it has no fields)', () => {
    expect(recordArgs(memberUpdate, 'A', recordInitialValues(memberUpdate))).toEqual([{ type: 's', value: 'A' }])
  })

  it('rejects a value list that does not match the fields', () => {
    expect(() => recordArgs(member, 'A', [true])).toThrow()
  })
})

describe('recordKeyOf', () => {
  const row = (...rest: { type: 'i' | 'f' | 's'; value: number | string }[]) => [{ type: 's' as const, value: 'A' }, ...rest] as never

  it('returns the key of a well-formed row', () => {
    expect(recordKeyOf(member, row({ type: 'i', value: 1 }, { type: 'f', value: 64 }, { type: 's', value: '10.0.0.1' }, { type: 's', value: 'Intro' }))).toBe('A')
  })

  it('rejects rows with the wrong arity, a non-string key, wrong types or out-of-range values', () => {
    expect(recordKeyOf(member, row({ type: 'i', value: 1 }))).toBeUndefined()
    expect(recordKeyOf(member, [{ type: 'i', value: 1 }, { type: 'i', value: 1 }, { type: 'i', value: 1 }, { type: 's', value: '' }, { type: 's', value: '' }])).toBeUndefined()
    expect(recordKeyOf(member, row({ type: 'i', value: 2 }, { type: 'i', value: 1 }, { type: 's', value: '' }, { type: 's', value: '' }))).toBeUndefined()
    expect(recordKeyOf(member, row({ type: 'i', value: 1 }, { type: 'i', value: 65 }, { type: 's', value: '' }, { type: 's', value: '' }))).toBeUndefined()
    expect(recordKeyOf(member, row({ type: 'i', value: 1 }, { type: 'i', value: 1 }, { type: 'i', value: 0 }, { type: 's', value: '' }))).toBeUndefined()
  })

  it('rejects non-finite numbers even without a range (they would serialize as null in desired)', () => {
    const loose = { ...member, fields: [{ id: 'gain', label: 'Gain', type: 'f' as const, default: 0 }, { id: 'n', label: 'N', type: 'i' as const, default: 0 }] }
    expect(recordKeyOf(loose, row({ type: 'f', value: 0.5 }, { type: 'i', value: 3 }))).toBe('A')
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(recordKeyOf(loose, row({ type: 'f', value: bad }, { type: 'i', value: 3 })), String(bad)).toBeUndefined()
      expect(recordKeyOf(loose, row({ type: 'f', value: 0.5 }, { type: 'f', value: bad })), String(bad)).toBeUndefined()
    }
  })

  it('accepts a bare key for a trigger record without fields', () => {
    expect(recordKeyOf(memberUpdate, row())).toBe('A')
  })
})

describe('resolveRecordActionSteps', () => {
  it('expands a row action for the given key in step order', () => {
    expect(resolveRecordActionSteps(action('update'), records, ['A']).map(step => [step.record.id, step.key, step.fixedValues])).toEqual([
      ['member', 'A', undefined],
      ['memberUpdate', 'A', undefined],
    ])
  })

  it('expands an all action row by row (all steps of row 1, then row 2)', () => {
    expect(resolveRecordActionSteps(action('updateAll'), records, ['A', 'B']).map(step => `${step.record.id}:${step.key}`)).toEqual([
      'member:A', 'memberUpdate:A', 'member:B', 'memberUpdate:B',
    ])
    expect(resolveRecordActionSteps(action('allActive'), records, ['A']).map(step => step.fixedValues)).toEqual([{ active: true }])
  })

  it('stops once past the bundle limit', () => {
    const keys = Array.from({ length: 400 }, (_, index) => `m${index}`)
    expect(resolveRecordActionSteps(action('updateAll'), records, keys).length).toBe(OSC_BATCH.MAX_MESSAGES + 1)
  })

  it('is ignored by resolveActionSteps (record steps need a row key)', () => {
    expect(resolveActionSteps(action('updateAll'), definition.parameters)).toEqual([])
  })
})
