import { describe, expect, it } from 'vitest'

import type { SurfaceDefinition } from '@oscdesk/shared'

import { createDesiredValues } from './desired-values'

function definition(parameters: SurfaceDefinition['parameters']): SurfaceDefinition {
  return { format: 'oscdesk-surface', version: 1, name: 'T', parameters, screens: [] }
}

const LEVEL = { id: 'level', address: '/light/level', label: 'Level', type: 'f', kind: 'state', default: 0.5 } as const
const ON = { id: 'on', address: '/light/on', label: 'On', type: 'bool', kind: 'state', default: true } as const
const NAME = { id: 'name', address: '/light/name', label: 'Name', type: 's', kind: 'state' } as const
const FIRE = { id: 'fire', address: '/light/fire', label: 'Fire', type: 'i', kind: 'trigger', value: 1 } as const

describe('createDesiredValues', () => {
  it('seeds state parameters from defaults, maps bool to i 0/1, and skips triggers and default-less parameters', () => {
    const desired = createDesiredValues()
    desired.setDefinition(definition([LEVEL, ON, NAME, FIRE]))
    expect(desired.snapshot()).toEqual([
      { address: '/light/level', args: [{ type: 'f', value: 0.5 }] },
      { address: '/light/on', args: [{ type: 'i', value: 1 }] },
    ])
  })

  it('records UI operations only for tracked state addresses', () => {
    const desired = createDesiredValues()
    desired.setDefinition(definition([LEVEL, FIRE]))
    expect(desired.record('/light/level', [{ type: 'f', value: 0.9 }])).toBe(true)
    expect(desired.record('/light/fire', [{ type: 'i', value: 1 }])).toBe(false)
    expect(desired.record('/other', [{ type: 'i', value: 1 }])).toBe(false)
    expect(desired.snapshot()).toEqual([{ address: '/light/level', args: [{ type: 'f', value: 0.9 }] }])
  })

  it('records a value for a parameter that has no default', () => {
    const desired = createDesiredValues()
    desired.setDefinition(definition([NAME]))
    desired.record('/light/name', [{ type: 's', value: 'a' }])
    expect(desired.snapshot()).toEqual([{ address: '/light/name', args: [{ type: 's', value: 'a' }] }])
  })

  it('carries values over a re-adoption only when id, address and type match', () => {
    const desired = createDesiredValues()
    desired.setDefinition(definition([LEVEL, ON]))
    desired.record('/light/level', [{ type: 'f', value: 0.9 }])
    desired.record('/light/on', [{ type: 'i', value: 0 }])
    desired.setDefinition(definition([LEVEL, { ...ON, id: 'power' }]))
    expect(desired.snapshot()).toEqual([
      { address: '/light/level', args: [{ type: 'f', value: 0.9 }] },
      { address: '/light/on', args: [{ type: 'i', value: 1 }] },
    ])
    desired.setDefinition(null)
    expect(desired.snapshot()).toEqual([])
  })

  it('compares echoes with float32 tolerance and ignores untracked addresses', () => {
    const desired = createDesiredValues()
    desired.setDefinition(definition([LEVEL, NAME]))
    expect(desired.differsFromEcho('/light/level', [{ type: 'f', value: Math.fround(0.5) }])).toBe(false)
    expect(desired.differsFromEcho('/light/level', [{ type: 'f', value: 0.7 }])).toBe(true)
    expect(desired.differsFromEcho('/light/name', [{ type: 's', value: 'x' }])).toBe(false)
    expect(desired.differsFromEcho('/nope', [{ type: 'f', value: 1 }])).toBe(false)
  })
})
