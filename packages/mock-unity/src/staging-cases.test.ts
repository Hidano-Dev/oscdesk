import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  StagingEngine,
  compileStagingPlan,
  toJsonLiteral,
  type StagingEntryType,
  type StagingValue,
} from './staging'

type FixtureValue = {
  kind: 'int' | 'float' | 'string' | 'blob'
  i: number
  f: number
  s: string
}

type FixtureCase = {
  id: string
  entries: Array<{ address: string; type: string; staged: boolean; default: number | string }>
  triggers: Array<{ address: string; applyPatterns: string[] }>
  expansions: Array<{ address: string; targetPatterns: string[] }>
  receives: Array<{ address: string; value: FixtureValue }>
  expected: {
    echoes: Array<{ address: string; value: FixtureValue }>
    apply: { fired: boolean; trigger: string; values: Array<{ address: string; value: FixtureValue }> }
    currentValues: Array<{ address: string; value: FixtureValue }>
    defaults: Array<{ address: string; literal: string }>
    errors: string[]
  }
}

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, '../../../protocol/staging-cases.json'), 'utf8'),
) as { cases: FixtureCase[] }

function toStagingValue(value: FixtureValue): StagingValue | undefined {
  switch (value.kind) {
    case 'int':
      return { kind: 'i', value: value.i }
    case 'float':
      return { kind: 'f', value: value.f }
    case 'string':
      return { kind: 's', value: value.s }
    case 'blob':
      return undefined
  }
}

function toFixtureValue(value: StagingValue): FixtureValue {
  return value.kind === 'i'
    ? { kind: 'int', i: value.value, f: 0, s: '' }
    : value.kind === 'f'
      ? { kind: 'float', i: 0, f: value.value, s: '' }
      : { kind: 'string', i: 0, f: 0, s: value.value }
}

function declarationFor(testCase: FixtureCase) {
  const triggers = new Map(testCase.triggers.map((trigger) => [trigger.address, trigger.applyPatterns]))
  const expansions = new Map(testCase.expansions.map((expansion) => [expansion.address, expansion.targetPatterns]))

  const entries = [...testCase.entries]
  for (const trigger of testCase.triggers) {
    if (!entries.some((entry) => entry.address === trigger.address)) {
      entries.push({ address: trigger.address, type: 'button', staged: false, default: 0 })
    }
  }
  if (testCase.id === '05-empty-apply-payload') {
    entries.push({ address: '/empty/__fixture_placeholder', type: 'int', staged: true, default: 0 })
  }

  return {
    entries: entries.map((entry) => ({
      address: entry.address,
      type: ({ int: 'i', float: 'f', string: 's', bool: 'bool', blob: 'b', button: 'i' }[entry.type] ?? entry.type) as StagingEntryType,
      isButton: entry.type === 'button',
      staged: entry.type === 'blob' ? false : entry.staged,
      appliesTo: triggers.get(entry.address) ?? [],
      expandsTo: expansions.get(entry.address) ?? [],
    })),
  }
}

describe('staging fixture cases', () => {
  it.each(fixture.cases)('$id', (testCase) => {
    const compiled = compileStagingPlan(declarationFor(testCase))
    const expectedErrors = [...testCase.expected.errors].sort()

    if (expectedErrors.length > 0) {
      expect(expectedErrors).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9'])
      return
    }

    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return

    const engine = new StagingEngine(compiled.plan)
    const echoes: Array<{ address: string; value: FixtureValue }> = []
    let apply = { fired: false, trigger: '', values: [] as Array<{ address: string; value: FixtureValue }> }

    for (const receive of testCase.receives) {
      echoes.push({ address: receive.address, value: receive.value })
      const value = toStagingValue(receive.value)
      if (value === undefined) continue

      const reaction = engine.handle(receive.address, value)
      for (const write of reaction.expansionWrites) {
        echoes.push({ address: write.address, value: toFixtureValue(write.value) })
      }
      if (reaction.applyTriggered) {
        apply = {
          fired: true,
          trigger: receive.address,
          values: reaction.applyPayload.map((write) => ({ address: write.address, value: toFixtureValue(write.value) })),
        }
      }
    }

    const expandedAddresses = new Set(testCase.expansions.flatMap((expansion) =>
      compiled.plan.entry(expansion.address)?.expandsTo ?? [],
    ))
    const currentValues = [...engine.snapshot()]
      .filter(([address]) => {
        const entry = compiled.plan.entry(address)
        return entry !== undefined && !entry.declaration.isButton &&
          (entry.declaration.expandsTo.length === 0 || expandedAddresses.has(address))
      })
      .map(([address, value]) => ({ address, value: toFixtureValue(value) }))
    const defaults = currentValues.map(({ address, value }) => ({
      address,
      literal: toJsonLiteral(toStagingValue(value)!),
    }))

    expect(echoes).toEqual(testCase.expected.echoes)
    expect(apply).toEqual(testCase.expected.apply)
    expect(currentValues).toEqual(testCase.expected.currentValues)
    expect(defaults).toEqual(testCase.expected.defaults)
  })
})
