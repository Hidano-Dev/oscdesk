import { describe, expect, it } from 'vitest'

import {
  StagingPlan,
  StagingEngine,
  compileStagingPlan,
  matchesPattern,
  toJsonLiteral,
  type StagingDeclaration,
} from './staging'

describe('matchesPattern', () => {
  it('matches whole parts, including an empty wildcard, without crossing slash boundaries', () => {
    expect(matchesPattern('/vp/member/01/*', '/vp/member/01/ip')).toBe(true)
    expect(matchesPattern('/vp/member/01/*', '/vp/member/01/')).toBe(true)
    expect(matchesPattern('/vp/member/01/*', '/vp/member/01/a/b')).toBe(false)
    expect(matchesPattern('/vp/member/*', '/vp/member/01/active')).toBe(false)
    expect(matchesPattern('/vp/member/*/*', '/vp/member/01/active')).toBe(true)
  })

  it('treats stars as the only wildcard syntax', () => {
    expect(matchesPattern('/vp/member/0?', '/vp/member/01')).toBe(false)
    expect(matchesPattern('/vp/member/[01]', '/vp/member/0')).toBe(false)
    expect(matchesPattern('/vp/member/a.b', '/vp/member/a.b')).toBe(true)
  })
})

describe('compileStagingPlan', () => {
  const entry = (address: string, overrides: Partial<StagingDeclaration['entries'][number]> = {}) => ({
    address,
    type: 'i' as const,
    isButton: false,
    staged: false,
    appliesTo: [],
    expandsTo: [],
    ...overrides,
  })

  it('collects every S1-S9 error instead of stopping at the first one', () => {
    const declaration: StagingDeclaration = {
      entries: [
        entry('/s1', { appliesTo: ['/valid/*'] }),
        entry('/s2', { isButton: true, staged: true, appliesTo: ['/valid/*'] }),
        entry('/s3', { staged: true, expandsTo: ['bad//pattern'] }),
        entry('/s4', { isButton: true, appliesTo: ['/nothing/*'] }),
        entry('/s5', { expandsTo: ['/nothing/*'] }),
        entry('/s6', { type: 'f', expandsTo: ['/target'] }),
        entry('/target', { type: 'i' }),
        entry('/s7', { expandsTo: ['/s7'] }),
        entry('/s8', { type: 'b', staged: true }),
        entry('/duplicate'),
        entry('/duplicate'),
      ],
    }

    const result = compileStagingPlan(declaration)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(new Set(result.errors.map((item) => item.code))).toEqual(
        new Set(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9']),
      )
    }
  })

  it('resolves valid declarations into stable address indexes', () => {
    const result = compileStagingPlan({
      entries: [
        entry('/all/apply', { isButton: true, appliesTo: ['/member/*/value'] }),
        entry('/member/01/value', { staged: true }),
        entry('/member/02/value', { staged: true }),
        entry('/all/value', { expandsTo: ['/member/*/value'] }),
      ],
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.plan.hasStagingDeclarations).toBe(true)
      expect(result.plan.entry('/all/apply')?.appliesTo).toEqual(['/member/01/value', '/member/02/value'])
      expect(result.plan.entry('/all/value')?.expandsTo).toEqual(['/member/01/value', '/member/02/value'])
    }
  })

  it('preserves the legacy empty plan when no staging declaration exists', () => {
    const result = compileStagingPlan({ entries: [entry('/value')] })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.plan.hasStagingDeclarations).toBe(false)
      expect(StagingPlan.empty.hasStagingDeclarations).toBe(false)
    }
  })
})

describe('toJsonLiteral', () => {
  it('uses manifest-compatible literals for integers, floats, and strings', () => {
    expect(toJsonLiteral({ kind: 'i', value: 1 })).toBe('1')
    expect(toJsonLiteral({ kind: 'f', value: 1.25 })).toBe('1.25')
    expect(toJsonLiteral({ kind: 's', value: 'a"b\\c' })).toBe('"a\\"b\\\\c"')
  })
})

describe('StagingEngine', () => {
  const entry = (address: string, overrides: Partial<StagingDeclaration['entries'][number]> = {}) => ({
    address,
    type: 'i' as const,
    isButton: false,
    staged: false,
    appliesTo: [],
    expandsTo: [],
    ...overrides,
  })

  it('records values, expands one level, and builds an ordered apply payload', () => {
    const compiled = compileStagingPlan({
      entries: [
        entry('/all/value', { expandsTo: ['/slot/*/value'] }),
        entry('/slot/01/value', { staged: true }),
        entry('/slot/02/value', { staged: true }),
        entry('/all/apply', { isButton: true, appliesTo: ['/slot/*/value'] }),
      ],
    })
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return

    const engine = new StagingEngine(compiled.plan)
    const expansion = engine.handle('/all/value', { kind: 'i', value: 9 })
    expect(expansion.expansionWrites).toEqual([
      { address: '/slot/01/value', value: { kind: 'i', value: 9 } },
      { address: '/slot/02/value', value: { kind: 'i', value: 9 } },
    ])

    const applied = engine.handle('/all/apply', { kind: 'i', value: 1 })
    expect(applied.applyTriggered).toBe(true)
    expect(applied.applyPayload.map((write) => write.address)).toEqual([
      '/slot/01/value',
      '/slot/02/value',
    ])
    expect([...engine.snapshot().keys()]).toEqual([
      '/all/value',
      '/slot/01/value',
      '/slot/02/value',
      '/all/apply',
    ])
  })

  it('accepts bool wire values only as integer 0 or 1 and exposes snapshots', () => {
    const compiled = compileStagingPlan({ entries: [entry('/enabled', { type: 'bool', staged: true })] })
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return

    const engine = new StagingEngine(compiled.plan)
    expect(engine.handle('/enabled', { kind: 'i', value: 2 }).recorded).toBe(false)
    expect(engine.handle('/enabled', { kind: 'i', value: 1 }).recorded).toBe(true)
    expect(engine.currentValue('/enabled')).toEqual({ kind: 'i', value: 1 })
  })
})
