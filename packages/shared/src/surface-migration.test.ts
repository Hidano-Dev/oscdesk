import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveOscSurface } from './osc-definition'
import { SurfaceDefinitionSchema } from './surface-definition'
import { idFromAddress, migrateSurfaceDefinition } from './surface-migration'

const samplesPath = path.resolve(__dirname, '../../../protocol/surface-definition-samples.json')
const samples = (JSON.parse(readFileSync(samplesPath, 'utf8')) as { cases: { name: string; definition: unknown }[] }).cases
const legacy = samples.find(sample => sample.name === 'legacy-version-1')!.definition

const recordsV1 = {
  format: 'oscdesk-surface',
  version: 1,
  name: 'Members',
  parameters: [
    { id: 'segment', address: '/vp/segment', label: 'Segment', type: 's', kind: 'state', optionsFrom: { address: '/vp/segments/list', request: '/vp/segments/request' } },
    { id: 'slot1', address: '/slot/1', label: 'Slot 1', type: 'f', kind: 'state', default: 0 },
    { id: 'slot2', address: '/slot/2', label: 'Slot 2', type: 'f', kind: 'state', default: 0 },
  ],
  records: [
    {
      id: 'member',
      address: '/vp/member',
      label: 'Member',
      kind: 'state',
      keysFrom: { address: '/vp/members/list', request: '/vp/members/request' },
      fields: [{ id: 'seg', label: 'Seg', type: 's', default: '', optionsFrom: { address: '/vp/segments/list', request: '/vp/segments/request' } }],
    },
  ],
  actions: [{ id: 'slots', label: 'Slots', steps: [{ match: '/slot/*' }, { param: 'segment', value: 'A' }] }],
  screens: [],
}

describe('migrateSurfaceDefinition', () => {
  it('moves version 1 addresses into bindings.osc and round-trips through resolveOscSurface', () => {
    for (const input of [legacy, recordsV1]) {
      const migrated = SurfaceDefinitionSchema.parse(migrateSurfaceDefinition(input))
      expect(migrated.version).toBe(2)
      expect(JSON.stringify({ ...migrated, bindings: undefined })).not.toMatch(/"(address|request|match)"/)
      expect(resolveOscSurface(migrated)).toEqual(input)
    }
  })

  it('shares one list between the places that named the same address', () => {
    const migrated = SurfaceDefinitionSchema.parse(migrateSurfaceDefinition(recordsV1))
    const segment = migrated.parameters[0]!
    expect(segment.type === 's' ? segment.optionsFrom : undefined).toEqual({ list: 'l_vp_segments_list' })
    expect(migrated.records?.[0]?.fields[0]).toMatchObject({ optionsFrom: { list: 'l_vp_segments_list' } })
    expect(migrated.bindings?.osc?.lists).toEqual([
      { id: 'l_vp_segments_list', address: '/vp/segments/list', request: '/vp/segments/request' },
      { id: 'l_vp_members_list', address: '/vp/members/list', request: '/vp/members/request' },
    ])
    expect(migrated.actions?.[0]?.steps[0]).toEqual({ selector: 'm_slot' })
    expect(migrated.bindings?.osc?.selectors).toEqual([{ id: 'm_slot', match: '/slot/*' }])
  })

  it('leaves version 2 and unknown input untouched', () => {
    const v2 = samples.find(sample => sample.name === 'bindings-minimal')!.definition
    expect(migrateSurfaceDefinition(v2)).toBe(v2)
    expect(migrateSurfaceDefinition('nope')).toBe('nope')
  })

  it('keeps an invalid version 1 definition invalid', () => {
    const broken = { ...recordsV1, parameters: [{ ...recordsV1.parameters[1], address: '/sys/ping' }] }
    expect(SurfaceDefinitionSchema.safeParse(migrateSurfaceDefinition(broken)).success).toBe(false)
  })
})

describe('idFromAddress', () => {
  it('makes identifiers and numbers addresses that clean up to the same text', () => {
    const taken = new Set<string>()
    expect(idFromAddress('l_', '/a/b', taken)).toBe('l_a_b')
    expect(idFromAddress('l_', '/a_b', taken)).toBe('l_a_b_2')
    expect(idFromAddress('l_', '/', taken)).toBe('l_x')
  })
})
