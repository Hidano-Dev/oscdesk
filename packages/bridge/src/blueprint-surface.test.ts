import { describe, expect, it, vi } from 'vitest'

import { collectSurfaceDefinitionIssues, type CatalogItem, type DownstreamFrame, type SurfaceDefinition } from '@oscdesk/shared'

import { createBlueprintManager } from './blueprint-manager'
import { absentParameters, blueprintSurfaceName, buildBlueprintSurface } from './blueprint-surface'

const item = (address: string, kind: string, type: string, props: [string, number | string][] = []): CatalogItem => ({
  address, kind, type,
  props: props.map(([key, value]) => ({ key, arg: typeof value === 'string' ? { type: 's' as const, value } : Number.isInteger(value) ? { type: 'i' as const, value } : { type: 'f' as const, value } })),
})

const ITEMS = [
  item('/fx/light/level', 'state', 'f', [['min', 0], ['max', 1], ['step', 0.5], ['label', 'Level'], ['default', 0.5]]),
  item('/fx/light/on', 'state', 'bool', [['default', 1]]),
  item('/fx/light/go', 'trigger', 'i'),
  item('/char/a/mode', 'state', 's', [['options', 'idle'], ['options', 'run'], ['widget', 'select']]),
  item('/top', 'state', 'i', [['widget', 'nope']]),
  item('/fx/unknown', 'future', 'f'),
  item('/fx/vec', 'state', 'vec3'),
]

describe('buildBlueprintSurface', () => {
  it('makes a valid definition grouped by package and target, skipping kinds and types it does not know', () => {
    const definition = buildBlueprintSurface('PC1', ITEMS)
    expect(collectSurfaceDefinitionIssues(definition)).toEqual([])
    expect(definition.parameters.map(parameter => parameter.address)).toEqual(['/char/a/mode', '/fx/light/go', '/fx/light/level', '/fx/light/on', '/top'])
    expect(definition.parameters.find(parameter => parameter.address === '/fx/light/level')).toMatchObject({
      label: 'Level', type: 'f', kind: 'state', range: [0, 1], step: 0.5, default: 0.5,
    })
    expect(definition.parameters.find(parameter => parameter.address === '/fx/light/on')).toMatchObject({ type: 'bool', default: true })
    expect(definition.parameters.find(parameter => parameter.address === '/fx/light/go')).toMatchObject({ kind: 'trigger', value: 1 })
    expect(definition.parameters.find(parameter => parameter.address === '/char/a/mode')).toMatchObject({ options: ['idle', 'run'], widget: 'select' })
    // 知らない表示ヒントは付けない
    expect(definition.parameters.find(parameter => parameter.address === '/top')).not.toHaveProperty('widget')
    const screen = definition.screens[0]!
    expect(screen.children.map(node => node.kind === 'group' ? node.label : node.kind)).toEqual(['char / a', 'fx / light', 'top'])
  })

  it('names the screen after the PC within the surface name rule', () => {
    expect(blueprintSurfaceName('Stage PC 1')).toBe('blueprint-Stage-PC-1')
    expect(blueprintSurfaceName('舞台')).toBe('blueprint-pc')
    expect(blueprintSurfaceName('x'.repeat(100))).toHaveLength(64)
  })

  it('lists the parameters a saved screen has but the blueprint does not', () => {
    const definition = buildBlueprintSurface('PC1', ITEMS)
    expect(absentParameters(definition, ITEMS.filter(entry => entry.address !== '/top'))).toEqual([
      definition.parameters.find(parameter => parameter.address === '/top')!.id,
    ])
  })
})

describe('createBlueprintManager', () => {
  function makeManager(active: { name: string; definition: SurfaceDefinition } | null = null) {
    const publish = vi.fn<(frame: DownstreamFrame, target?: string) => void>()
    let current = active
    const adoptBlueprint = vi.fn((name: string, generated: SurfaceDefinition) => {
      current = { name, definition: generated }
      return { ok: true as const, saved: false }
    })
    const manager = createBlueprintManager({
      pcs: () => [{ host: '10.0.0.5', name: 'PC1', items: ITEMS }],
      active: () => current,
      adoptBlueprint,
      publish,
      logInfo: () => {},
    })
    return { manager, publish, adoptBlueprint }
  }

  it('adopts the default screen of a PC and rejects an unknown PC', () => {
    const { manager, publish, adoptBlueprint } = makeManager()
    expect(manager.handleUiFrame({ v: 1, type: 'catalogAdopt', host: '10.0.0.5' }, 'c1')).toBe(true)
    expect(adoptBlueprint).toHaveBeenCalledWith('blueprint-PC1', expect.objectContaining({ name: 'PC1' }))
    manager.handleUiFrame({ v: 1, type: 'catalogAdopt', host: '10.0.0.9' }, 'c1')
    expect(publish.mock.calls.map(([frame]) => frame.type === 'notice' ? frame.code : frame.type)).toEqual(['catalog-adopted', 'catalog-adopt-rejected'])
    expect(manager.handleUiFrame({ v: 1, type: 'catalogRequest' }, 'c1')).toBe(false)
  })

  it('reports the absent parameters of the adopted blueprint screen only when they change', () => {
    const saved = buildBlueprintSurface('PC1', [...ITEMS, item('/gone/x/y', 'state', 'f')])
    const { manager, publish } = makeManager({ name: 'blueprint-PC1', definition: saved })
    manager.refresh()
    manager.refresh()
    const frames = publish.mock.calls.map(([frame]) => frame)
    expect(frames).toEqual([{ v: 1, type: 'blueprintStatus', pc: { host: '10.0.0.5', name: 'PC1' }, absent: [saved.parameters.find(parameter => parameter.address === '/gone/x/y')!.id] }])
  })
})
