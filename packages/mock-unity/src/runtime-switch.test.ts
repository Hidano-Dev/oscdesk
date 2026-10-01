import { describe, expect, it } from 'vitest'

import { ManifestSchema, MANIFEST_SIZE } from '@oscdesk/shared'

import { ScenarioRuntime, ScenarioSchema, type ScenarioDefinition } from './scenario'
import { RuntimeSectionSchema, effectiveId, isTriggerValue } from './runtime-switch'

const BOOT_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

function row(name: string, extra: Record<string, unknown> = {}) {
  return {
    address: `/dev/row/${name}/value`,
    label: `Row ${name}`,
    type: 'f',
    widget: 'fader',
    range: [0, 1],
    default: 0.1,
    ...extra,
  }
}

const TRIGGERS = ['/dev/switch', '/dev/restore', '/dev/reuse', '/t/1', '/t/2', '/t/big', '/t/fits'].map((address) => ({
  address,
  label: address,
  type: 'i',
  widget: 'button',
  default: 0,
}))

function scenario(runtime: Record<string, unknown>, overrides: Record<string, unknown> = {}): ScenarioDefinition {
  return ScenarioSchema.parse({
    projectId: 'proj',
    entries: [row('a'), row('b'), row('c'), ...TRIGGERS],
    runtime,
    ...overrides,
  })
}

function create(runtime: Record<string, unknown>, overrides: Record<string, unknown> = {}, legacyOrigin = false) {
  return new ScenarioRuntime(scenario(runtime, overrides), { bootId: BOOT_ID, legacyOrigin })
}

function addresses(json: string): string[] {
  return ManifestSchema.parse(JSON.parse(json)).entries.map((entry) => entry.address)
}

function defaultOf(json: string, address: string) {
  return ManifestSchema.parse(JSON.parse(json)).entries.find((entry) => entry.address === address)?.default
}

describe('origin fields', () => {
  it('puts bootId and structureGeneration=1 into the manifest right after projectId', () => {
    const json = create({ variants: {}, switches: [] }).manifestJson()

    expect(json.startsWith(`{"version":1,"projectId":"proj","bootId":"${BOOT_ID}","structureGeneration":1,`)).toBe(true)
    expect(ManifestSchema.parse(JSON.parse(json))).toMatchObject({ bootId: BOOT_ID, structureGeneration: 1 })
  })

  it('generates a 32 hex digit bootId per runtime when none is injected', () => {
    const first = new ScenarioRuntime(scenario({ variants: {}, switches: [] })).originFields()
    const second = new ScenarioRuntime(scenario({ variants: {}, switches: [] })).originFields()

    expect(first?.bootId).toMatch(/^[0-9a-f]{32}$/)
    expect(first?.bootId).not.toBe(second?.bootId)
    expect(first?.structureGeneration).toBe(1)
  })

  it('omits the pair entirely in legacy origin mode', () => {
    const runtime = create({ variants: {}, switches: [] }, {}, true)

    expect(runtime.originFields()).toBeNull()
    expect(runtime.manifestJson()).not.toContain('bootId')
    expect(runtime.manifestJson()).not.toContain('structureGeneration')
  })

  it('works without a runtime section', () => {
    const runtime = new ScenarioRuntime(
      ScenarioSchema.parse({ projectId: 'p', entries: [row('a')] }),
      { bootId: BOOT_ID },
    )

    expect(runtime.trySwitch('/dev/switch', 1)).toEqual({ kind: 'not-a-trigger' })
  })

  it('does not put entry ids on the wire', () => {
    const runtime = new ScenarioRuntime(
      ScenarioSchema.parse({ projectId: 'p', entries: [row('a', { id: 'row-a' })] }),
      { bootId: BOOT_ID },
    )

    expect(runtime.manifestJson()).not.toContain('row-a')
    expect(effectiveId({ address: '/x', id: 'k' })).toBe('k')
    expect(effectiveId({ address: '/x' })).toBe('/x')
  })
})

describe('runtime section schema', () => {
  it('rejects a switch trigger under /sys/ and an unknown variant name', () => {
    const variants = { v: { entries: [row('a')] } }

    expect(RuntimeSectionSchema.safeParse({ variants, switches: [{ trigger: '/sys/x', variant: 'v' }] }).success).toBe(false)
    expect(RuntimeSectionSchema.safeParse({ variants, switches: [{ trigger: '/t', variant: 'nope' }] }).success).toBe(false)
    expect(RuntimeSectionSchema.safeParse({ variants, switches: [{ trigger: '/t', variant: 'v' }] }).success).toBe(true)
  })

  it('only checks entry shapes at load time (reuse and size violations load fine)', () => {
    expect(() =>
      scenario({
        variants: { bad: { entries: [row('a', { id: 'other' })] } },
        switches: [{ trigger: '/dev/switch', variant: 'bad' }],
      }),
    ).not.toThrow()
    expect(() => scenario({ variants: { bad: { entries: [{ address: '/x' }] } }, switches: [] })).toThrow()
  })
})

describe('trySwitch guards and carry-over exclusions', () => {
  const removeB = { entries: [row('a'), row('c'), ...TRIGGERS] }
  const runtimeOf = () =>
    create({ variants: { removeB }, switches: [{ trigger: '/dev/switch', variant: 'removeB' }] })

  it('does not carry a pressed trigger value over as the new default', () => {
    const runtime = runtimeOf()
    runtime.recordValue('/dev/switch', 1)

    const result = runtime.trySwitch('/dev/switch', 1)

    expect(result.kind).toBe('switched')
    if (result.kind !== 'switched') return
    expect(defaultOf(result.manifestJson, '/dev/switch')).toBe(0)
  })

  it('does not fire for a trigger that is not a currently bound entry', () => {
    const runtime = create({
      variants: { removeB: { entries: [row('a')] } },
      switches: [{ trigger: '/gone', variant: 'removeB' }],
    })

    expect(runtime.trySwitch('/gone', 1)).toEqual({ kind: 'not-a-trigger' })
  })

  it('does not fire when the value fails the entry type check or is not finite', () => {
    const runtime = runtimeOf()

    expect(runtime.trySwitch('/dev/switch', 1.5)).toEqual({ kind: 'not-a-trigger' })
    expect(runtime.trySwitch('/dev/switch', 'x')).toEqual({ kind: 'not-a-trigger' })
    expect(isTriggerValue(Number.NaN)).toBe(false)
    expect(isTriggerValue(Number.POSITIVE_INFINITY)).toBe(false)
  })

  it('drops applied records for addresses removed by a switch', () => {
    const runtime = create(
      { variants: { removeB: { entries: [row('a'), ...TRIGGERS], staging: { staged: ['/dev/row/a/value'], triggers: [{ address: '/dev/switch', appliesTo: ['/dev/row/*/*'] }] } } }, switches: [{ trigger: '/dev/restore', variant: 'removeB' }] },
      {
        staging: {
          staged: ['/dev/row/a/value', '/dev/row/b/value'],
          triggers: [{ address: '/dev/switch', appliesTo: ['/dev/row/*/*'] }],
          expansions: [],
        },
      },
    )
    runtime.recordValue('/dev/row/a/value', 0.2)
    runtime.recordValue('/dev/row/b/value', 0.3)
    runtime.recordValue('/dev/switch', 1)
    expect(runtime.stagingSnapshot().appliedValues.has('/dev/row/b/value')).toBe(true)

    expect(runtime.trySwitch('/dev/restore', 1).kind).toBe('switched')

    const snapshot = runtime.stagingSnapshot()
    expect(snapshot.appliedValues.has('/dev/row/b/value')).toBe(false)
    expect(snapshot.appliedValues.has('/dev/row/a/value')).toBe(true)
    expect(snapshot.applyLog[0]?.values.map((write) => write.address)).toEqual(['/dev/row/a/value'])
  })
})

describe('trySwitch', () => {
  const removeB = { entries: [row('a'), row('c'), ...TRIGGERS] }

  it('returns not-a-trigger for other addresses and zero values', () => {
    const runtime = create({ variants: { removeB }, switches: [{ trigger: '/dev/switch', variant: 'removeB' }] })

    expect(runtime.trySwitch('/dev/row/a/value', 1)).toEqual({ kind: 'not-a-trigger' })
    expect(runtime.trySwitch('/dev/switch', 0)).toEqual({ kind: 'not-a-trigger' })
    expect(runtime.trySwitch('/dev/switch', false)).toEqual({ kind: 'not-a-trigger' })
    expect(runtime.originFields()?.structureGeneration).toBe(1)
  })

  it('removes a middle row, advances the generation and carries current values over', () => {
    const runtime = create({ variants: { removeB }, switches: [{ trigger: '/dev/switch', variant: 'removeB' }] })
    runtime.recordValue('/dev/row/c/value', 0.9)

    const result = runtime.trySwitch('/dev/switch', 1)

    expect(result.kind).toBe('switched')
    if (result.kind !== 'switched') return
    expect(result.variant).toBe('removeB')
    expect(result.structureGeneration).toBe(2)
    expect(addresses(result.manifestJson)).toEqual(['/dev/row/a/value', '/dev/row/c/value', ...TRIGGERS.map((trigger) => trigger.address)])
    expect(defaultOf(result.manifestJson, '/dev/row/c/value')).toBe(0.9)
    expect(ManifestSchema.parse(JSON.parse(result.manifestJson))).toMatchObject({ bootId: BOOT_ID, structureGeneration: 2 })
    expect(runtime.manifestJson()).toBe(result.manifestJson)
    expect(runtime.originFields()).toEqual({ bootId: BOOT_ID, structureGeneration: 2 })
  })

  it('accepts bool true as a non-zero trigger value on a bool entry', () => {
    const boolTrigger = { address: '/dev/flag', label: 'Flag', type: 'bool', widget: 'toggle', default: false }
    const runtime = create(
      { variants: { v: { entries: [row('a'), boolTrigger] } }, switches: [{ trigger: '/dev/flag', variant: 'v' }] },
      { entries: [row('a'), boolTrigger] },
    )

    expect(runtime.trySwitch('/dev/flag', false)).toEqual({ kind: 'not-a-trigger' })
    expect(runtime.trySwitch('/dev/flag', true).kind).toBe('switched')
  })

  it('adds a row seeded with its own default', () => {
    const addD = { entries: [row('a'), row('b'), row('c'), row('d', { default: 0.7 }), ...TRIGGERS] }
    const runtime = create({ variants: { addD }, switches: [{ trigger: '/dev/switch', variant: 'addD' }] })

    const result = runtime.trySwitch('/dev/switch', 1)

    expect(result.kind).toBe('switched')
    if (result.kind !== 'switched') return
    expect(defaultOf(result.manifestJson, '/dev/row/d/value')).toBe(0.7)
  })

  it('carries over unapplied staged values', () => {
    const runtime = create(
      { variants: { removeB: { ...removeB, staging: { staged: ['/dev/row/a/value'] } } }, switches: [{ trigger: '/dev/switch', variant: 'removeB' }] },
      { staging: { staged: ['/dev/row/a/value'], triggers: [], expansions: [] } },
    )
    runtime.recordValue('/dev/row/a/value', 0.55)

    const result = runtime.trySwitch('/dev/switch', 1)

    expect(result.kind).toBe('switched')
    if (result.kind !== 'switched') return
    expect(defaultOf(result.manifestJson, '/dev/row/a/value')).toBe(0.55)
    expect(ManifestSchema.parse(JSON.parse(result.manifestJson)).entries[0]).toMatchObject({ staged: true })
  })

  it('seeds with the new default when the type or address of an identity changes', () => {
    const changed = {
      entries: [
        row('a', { id: '/dev/row/a/value', type: 'i', default: 5 }),
        { ...row('b2'), id: '/dev/row/b/value', default: 0.3 },
        row('c'),
        ...TRIGGERS,
      ],
    }
    const runtime = create({ variants: { changed }, switches: [{ trigger: '/dev/switch', variant: 'changed' }] })
    runtime.recordValue('/dev/row/a/value', 0.9)
    runtime.recordValue('/dev/row/b/value', 0.8)
    runtime.recordValue('/dev/row/c/value', 0.7)

    const result = runtime.trySwitch('/dev/switch', 1)

    expect(result.kind).toBe('switched')
    if (result.kind !== 'switched') return
    expect(defaultOf(result.manifestJson, '/dev/row/a/value')).toBe(5)
    expect(defaultOf(result.manifestJson, '/dev/row/b2/value')).toBe(0.3)
    expect(defaultOf(result.manifestJson, '/dev/row/c/value')).toBe(0.7)
  })

  it('accepts the same identity coming back to the same address after removal', () => {
    const runtime = create({
      variants: { removeB, restore: { entries: [row('a'), row('b', { default: 0.4 }), row('c'), ...TRIGGERS] } },
      switches: [
        { trigger: '/dev/switch', variant: 'removeB' },
        { trigger: '/dev/restore', variant: 'restore' },
      ],
    })
    runtime.trySwitch('/dev/switch', 1)

    const result = runtime.trySwitch('/dev/restore', 1)

    expect(result.kind).toBe('switched')
    if (result.kind !== 'switched') return
    expect(result.structureGeneration).toBe(3)
    expect(defaultOf(result.manifestJson, '/dev/row/b/value')).toBe(0.4)
  })

  it('rejects reusing a bound address for a different identity, even after the row was removed', () => {
    const runtime = create({
      variants: {
        removeB,
        reuse: { entries: [row('a'), row('b', { id: 'someone-else' }), row('c'), ...TRIGGERS] },
      },
      switches: [
        { trigger: '/dev/switch', variant: 'removeB' },
        { trigger: '/dev/reuse', variant: 'reuse' },
      ],
    })
    runtime.trySwitch('/dev/switch', 1)
    const before = runtime.manifestJson()

    const result = runtime.trySwitch('/dev/reuse', 1)

    expect(result).toMatchObject({ kind: 'rejected', reason: 'address-reused' })
    expect(runtime.manifestJson()).toBe(before)
    expect(runtime.originFields()?.structureGeneration).toBe(2)
  })

  it('rejects a projectId that differs from the baseline', () => {
    const runtime = create({
      variants: { other: { ...removeB, projectId: 'other-proj' } },
      switches: [{ trigger: '/dev/switch', variant: 'other' }],
    })

    expect(runtime.trySwitch('/dev/switch', 1)).toMatchObject({ kind: 'rejected', reason: 'project-mismatch' })
    expect(runtime.originFields()?.structureGeneration).toBe(1)
  })

  it('accepts a variant projectId equal to the baseline', () => {
    const runtime = create({
      variants: { same: { ...removeB, projectId: 'proj' } },
      switches: [{ trigger: '/dev/switch', variant: 'same' }],
    })

    expect(runtime.trySwitch('/dev/switch', 1).kind).toBe('switched')
  })

  it('rejects an entry set that fails the manifest schema (dangling optionsRef)', () => {
    const runtime = create({
      variants: {
        dangling: { entries: [{ address: '/dev/sel', label: 'S', type: 's', widget: 'select', optionsRef: 'nope' }, ...TRIGGERS] },
      },
      switches: [{ trigger: '/dev/switch', variant: 'dangling' }],
    })

    expect(runtime.trySwitch('/dev/switch', 1)).toMatchObject({ kind: 'rejected', reason: 'schema' })
  })

  it('checks the schema before projectId and projectId before reuse', () => {
    const runtime = create({
      variants: {
        both: { entries: [{ address: '/dev/sel', label: 'S', type: 's', widget: 'select', optionsRef: 'nope' }], projectId: 'x' },
        pidAndReuse: { entries: [row('a', { id: 'z' })], projectId: 'x' },
      },
      switches: [
        { trigger: '/t/1', variant: 'both' },
        { trigger: '/t/2', variant: 'pidAndReuse' },
      ],
    })

    expect(runtime.trySwitch('/t/1', 1)).toMatchObject({ reason: 'schema' })
    expect(runtime.trySwitch('/t/2', 1)).toMatchObject({ reason: 'project-mismatch' })
  })

  it('rejects a staging declaration that does not compile', () => {
    const runtime = create({
      variants: { badStaging: { ...removeB, staging: { staged: ['/dev/row/a/value'], triggers: [{ address: '/dev/switch', appliesTo: ['/dev/nothing/*'] }] } } },
      switches: [{ trigger: '/dev/switch', variant: 'badStaging' }],
    })

    expect(runtime.trySwitch('/dev/switch', 1)).toMatchObject({ kind: 'rejected', reason: 'compile' })
  })

  it('rejects when the generation+1 manifest exceeds the practical limit, accepts just below', () => {
    const big = (count: number) => ({
      entries: Array.from({ length: count }, (_, index) => row(`r${index}`, { label: 'x'.repeat(200) })),
    })
    const runtime = create({
      variants: { big: big(400), fits: big(100) },
      switches: [
        { trigger: '/t/big', variant: 'big' },
        { trigger: '/t/fits', variant: 'fits' },
      ],
    })

    const rejected = runtime.trySwitch('/t/big', 1)
    expect(rejected).toMatchObject({ kind: 'rejected', reason: 'too-large' })
    expect(runtime.originFields()?.structureGeneration).toBe(1)

    const accepted = runtime.trySwitch('/t/fits', 1)
    expect(accepted.kind).toBe('switched')
    if (accepted.kind === 'switched') {
      expect(Buffer.byteLength(accepted.manifestJson)).toBeLessThanOrEqual(MANIFEST_SIZE.PRACTICAL_LIMIT_BYTES)
    }
  })

  it('updates only option lists for a choices-only variant without changing entry values', () => {
    const runtime = create(
      {
        variants: {
          choices: {
            entries: [{ address: '/dev/sel', label: 'S', type: 's', widget: 'select', optionsRef: 'devs', default: 'A' }, ...TRIGGERS],
            optionLists: { devs: ['A', 'B', 'C'] },
          },
        },
        switches: [{ trigger: '/dev/switch', variant: 'choices' }],
      },
      {
        entries: [{ address: '/dev/sel', label: 'S', type: 's', widget: 'select', optionsRef: 'devs', default: 'A' }, ...TRIGGERS],
        optionLists: { devs: ['A', 'B'] },
      },
    )
    runtime.recordValue('/dev/sel', 'B')

    const result = runtime.trySwitch('/dev/switch', 1)

    expect(result.kind).toBe('switched')
    if (result.kind !== 'switched') return
    expect(ManifestSchema.parse(JSON.parse(result.manifestJson)).optionLists).toEqual({ devs: ['A', 'B', 'C'] })
    expect(defaultOf(result.manifestJson, '/dev/sel')).toBe('B')
  })
})
