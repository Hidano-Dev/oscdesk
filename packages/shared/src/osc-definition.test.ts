import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { OSC_BATCH } from './limits'
import {
  OscSurfaceDefinitionStructureSchema,
  resolveActionSteps,
  resolveOscSurface,
  type OscSurfaceParameter,
} from './osc-definition'
import { SurfaceDefinitionSchema, splitSurfaceBindings } from './surface-definition'

const samplesPath = path.resolve(__dirname, '../../../protocol/surface-definition-samples.json')
type Sample = { name: string; valid: boolean; definition: unknown }
const samples = (JSON.parse(readFileSync(samplesPath, 'utf8')) as { cases: Sample[] }).cases
const resolved = (name: string) => resolveOscSurface(SurfaceDefinitionSchema.parse(samples.find(sample => sample.name === name)!.definition))

describe('resolveOscSurface', () => {
  it('puts the osc bindings back into the shape the bridge works with', () => {
    for (const sample of samples.filter(candidate => candidate.valid)) {
      const definition = SurfaceDefinitionSchema.parse(sample.definition)
      if (definition.bindings?.osc === undefined) continue
      const result = OscSurfaceDefinitionStructureSchema.safeParse(resolveOscSurface(definition))
      expect(result.success, sample.name).toBe(true)
    }
  })

  it('resolves lists, records and selectors to their addresses', () => {
    const definition = resolved('bindings-minimal')
    expect(definition.parameters.map(parameter => parameter.address)).toEqual(['/mix/master', '/mix/scene'])
    expect(definition.parameters[1]).toMatchObject({ optionsFrom: { address: '/mix/scenes', request: '/mix/scenes/request' } })
    expect(definition.actions?.[0]?.steps).toEqual([{ match: '/mix/*' }])
    const records = resolved('records-basic').records!
    expect(records[0]).toMatchObject({ address: '/vp/member', keysFrom: { address: '/vp/members/list', request: '/vp/members/request' } })
  })

  it('refuses a definition without osc bindings', () => {
    const { definition } = splitSurfaceBindings(SurfaceDefinitionSchema.parse(samples.find(sample => sample.name === 'bindings-minimal')!.definition))
    expect(() => resolveOscSurface(definition)).toThrow(/no osc bindings/)
  })
})

describe('resolveActionSteps', () => {
  const definition = resolved('action-sequence')

  it('expands match and param steps in definition order with fixed values', () => {
    const action = { id: 'x', label: 'X', steps: [{ param: 'mode', value: 'b' }, { match: '/slot/*' }] }
    const steps = resolveActionSteps(action, definition.parameters)
    expect(steps.map(step => [step.parameter.id, step.fixedValue])).toEqual([
      ['mode', 'b'],
      ['slot01', undefined],
      ['slot02', undefined],
      ['mode', undefined],
    ])
  })

  it('ignores unknown parameters (reported by the semantic check instead)', () => {
    expect(resolveActionSteps({ id: 'x', label: 'X', steps: [{ param: 'ghost' }] }, definition.parameters)).toEqual([])
  })

  it('stops expanding once past the bundle limit instead of scanning every step', () => {
    const parameters: OscSurfaceParameter[] = Array.from({ length: 600 }, (_, index) => ({ ...definition.parameters[0]!, id: `p${index}`, address: `/bulk/${index}` }))
    const steps = resolveActionSteps({ id: 'x', label: 'X', steps: [{ match: '/bulk/*' }, { match: '/bulk/*' }] }, parameters)
    expect(steps.length).toBe(OSC_BATCH.MAX_MESSAGES + 1)
  })
})
