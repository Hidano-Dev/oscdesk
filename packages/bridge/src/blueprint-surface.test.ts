import { describe, expect, it, vi } from 'vitest'

import { collectSurfaceDefinitionIssues, compositeSchemaProps, resolveOscSurface, type CatalogItem, type DownstreamFrame, type SurfaceDefinition } from '@oscdesk/shared'

import { createBlueprintManager } from './blueprint-manager'
import { absentParameters, blueprintSurfaceName, buildBlueprintSurface, catalogFrameItems } from './blueprint-surface'

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
    const built = buildBlueprintSurface('PC1', ITEMS)
    expect(collectSurfaceDefinitionIssues(built)).toEqual([])
    // 本体は id の語彙だけで、アドレスは bindings.osc に置く(D-117)
    expect(JSON.stringify({ ...built, bindings: undefined })).not.toMatch(/"address"/)
    expect(built.bindings?.osc?.parameters.map(binding => binding.address)).toEqual(['/char/a/mode', '/fx/light/go', '/fx/light/level', '/fx/light/on', '/top'])
    const definition = resolveOscSurface(built)
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
    expect(blueprintSurfaceName('Stage PC 1')).toMatch(/^blueprint-Stage-PC-1-[0-9a-f]{8}$/)
    expect(blueprintSurfaceName('舞台')).toMatch(/^blueprint-pc-[0-9a-f]{8}$/)
    expect(blueprintSurfaceName('x'.repeat(100)).length).toBeLessThanOrEqual(64)
    // 置き換えで同じ形になる別の PC 名を区別する
    expect(blueprintSurfaceName('PC.A')).not.toBe(blueprintSurfaceName('PC-A'))
    expect(blueprintSurfaceName('東京')).not.toBe(blueprintSurfaceName('大阪'))
    expect(blueprintSurfaceName('PC1')).toBe(blueprintSurfaceName('PC1'))
  })

  it('lists the parameters a saved screen has but the blueprint does not', () => {
    const definition = buildBlueprintSurface('PC1', ITEMS)
    expect(absentParameters(definition, ITEMS.filter(entry => entry.address !== '/top'))).toEqual([
      resolveOscSurface(definition).parameters.find(parameter => parameter.address === '/top')!.id,
    ])
  })
})

describe('buildBlueprintSurface with composite items (D-121)', () => {
  const composite = (address: string, kind: string, schema: unknown, label?: string): CatalogItem => ({
    address, kind, type: 'composite',
    props: [
      ...(label === undefined ? [] : [{ key: 'label', arg: { type: 's' as const, value: label } }]),
      ...compositeSchemaProps(schema as never),
    ],
  })
  const COLOR = {
    name: 'color', type: 'record', hint: 'color',
    fields: [
      { id: 'r', label: 'R', type: 'f', range: [0, 1], default: 0.5 },
      { id: 'g', type: 'f', range: [0, 1] },
      { id: 'b', type: 'f', range: [0, 1] },
      { id: 'on', type: 'bool' },
    ],
  }

  it('turns a record of basic types into a composite parameter and skips nested, variable-length and unreadable schemas', () => {
    const built = buildBlueprintSurface('PC1', [
      composite('/fx/light/tint', 'state', COLOR, 'Tint'),
      composite('/fx/light/kick', 'trigger', { name: 'vector2', type: 'record', fields: [{ id: 'x', type: 'f', range: [0, 1] }, { id: 'y', type: 'f' }] }),
      composite('/fx/light/nested', 'state', { name: 'n', type: 'record', fields: [{ id: 'c', type: 'record', fields: COLOR.fields }] }),
      composite('/fx/light/list', 'state', { name: 'l', type: 'array', items: { type: 'f' } }),
      { address: '/fx/light/broken', kind: 'state', type: 'composite', props: [{ key: 'schema', arg: { type: 's', value: '{' } }] },
    ])
    expect(collectSurfaceDefinitionIssues(built)).toEqual([])
    const definition = resolveOscSurface(built)
    expect(definition.parameters.map(parameter => parameter.address)).toEqual(['/fx/light/kick', '/fx/light/tint'])
    expect(definition.parameters.find(parameter => parameter.address === '/fx/light/tint')).toEqual({
      id: 'p_fx_light_tint', address: '/fx/light/tint', label: 'Tint', kind: 'state', type: 'composite', hint: 'color',
      fields: [
        { id: 'r', label: 'R', type: 'f', range: [0, 1], default: 0.5 },
        { id: 'g', label: 'g', type: 'f', range: [0, 1], default: 0 },
        { id: 'b', label: 'b', type: 'f', range: [0, 1], default: 0 },
        { id: 'on', label: 'on', type: 'bool', default: false },
      ],
    })
    // trigger のフィールドは制約を持てないので押下で送る値だけ。ヒントが無ければ型の名前をヒントにする
    expect(definition.parameters.find(parameter => parameter.address === '/fx/light/kick')).toMatchObject({
      kind: 'trigger', hint: 'vector2', fields: [{ id: 'x', label: 'x', type: 'f', value: 0 }, { id: 'y', label: 'y', type: 'f', value: 0 }],
    })
  })
})

describe('catalogFrameItems (HID-389)', () => {
  it('puts catalog items into the parameter vocabulary with the ids of the default screen', () => {
    const frameItems = catalogFrameItems(ITEMS)
    expect(JSON.stringify(frameItems)).not.toContain('/fx/')
    expect(frameItems[0]).toEqual({ param: 'p_fx_light_level', kind: 'state', type: 'f', props: [{ key: 'min', value: 0 }, { key: 'max', value: 1 }, { key: 'step', value: 0.5 }, { key: 'label', value: 'Level' }, { key: 'default', value: 0.5 }] })
    const ids = buildBlueprintSurface('PC1', ITEMS).parameters.map(parameter => parameter.id)
    expect(ids.every(id => frameItems.some(entry => entry.param === id))).toBe(true)
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
    expect(adoptBlueprint).toHaveBeenCalledWith(blueprintSurfaceName('PC1'), expect.objectContaining({ name: 'PC1' }))
    manager.handleUiFrame({ v: 1, type: 'catalogAdopt', host: '10.0.0.9' }, 'c1')
    expect(publish.mock.calls.map(([frame]) => frame.type === 'notice' ? frame.code : frame.type)).toEqual(['catalog-adopted', 'catalog-adopt-rejected'])
    expect(manager.handleUiFrame({ v: 1, type: 'catalogRequest' }, 'c1')).toBe(false)
  })

  it('reports the absent parameters of the adopted blueprint screen only when they change', () => {
    const saved = buildBlueprintSurface('PC1', [...ITEMS, item('/gone/x/y', 'state', 'f')])
    const { manager, publish } = makeManager({ name: blueprintSurfaceName('PC1'), definition: saved })
    manager.refresh()
    manager.refresh()
    const frames = publish.mock.calls.map(([frame]) => frame)
    expect(frames).toEqual([{ v: 1, type: 'blueprintStatus', pc: { host: '10.0.0.5', name: 'PC1' }, absent: [resolveOscSurface(saved).parameters.find(parameter => parameter.address === '/gone/x/y')!.id] }])
  })
})
