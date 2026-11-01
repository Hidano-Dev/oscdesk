import { describe, expect, it } from 'vitest'

import { OSC_BATCH } from './limits'
import { SurfaceDefinitionSchema, type SurfaceDefinition, type SurfaceLayoutNode, type SurfaceParameter } from './surface-definition'
import { buildSurfaceView, defaultWidget, isColorComposite, SurfaceViewSchema, type ViewNode } from './surface-view'

// 部品の木(D-124)の組み立て。UI(Python)はこの木を読むだけなので、部品の決め方の規則はここで確かめる
// (HID-401 で UI の test_surface_model.py・test_composite.py の規則の検査をここへ移した)

function definition(parts: Partial<SurfaceDefinition> & { children?: SurfaceLayoutNode[] }): SurfaceDefinition {
  const { children, ...rest } = parts
  const parameters = rest.parameters ?? []
  const raw = {
    format: 'oscdesk-surface',
    version: 2,
    name: 'Test',
    parameters,
    screens: [{ id: 'main', label: 'Main', children: children ?? parameters.map(parameter => ({ kind: 'control', param: parameter.id })) }],
    ...rest,
    bindings: rest.bindings ?? {
      osc: { parameters: parameters.map(parameter => ({ id: parameter.id, address: `/p/${parameter.id}` })) },
    },
  }
  const parsed = SurfaceDefinitionSchema.safeParse(raw)
  if (!parsed.success) throw new Error(`test definition is invalid: ${JSON.stringify(parsed.error.issues)}`)
  return parsed.data
}

const view = (source: SurfaceDefinition) => {
  const built = buildSurfaceView(source)
  // 配る形は wire の検査(SurfaceViewSchema)に通る
  expect(SurfaceViewSchema.safeParse(built).success).toBe(true)
  return built
}

const controlOf = (node: ViewNode | undefined) => (node?.kind === 'control' ? node.control : undefined)

describe('defaultWidget', () => {
  it('follows the display hint, then the type and constraints (D-103)', () => {
    expect(defaultWidget({ id: 'p', label: 'P', kind: 'state', type: 'i', range: [0, 3] })).toBe('slider')
    expect(defaultWidget({ id: 'p', label: 'P', kind: 'state', type: 'i' })).toBe('input')
    expect(defaultWidget({ id: 'p', label: 'P', kind: 'state', type: 'f' })).toBe('input')
    expect(defaultWidget({ id: 'p', label: 'P', kind: 'state', type: 's' })).toBe('input')
    expect(defaultWidget({ id: 'p', label: 'P', kind: 'state', type: 's', options: ['a'] })).toBe('select')
    expect(defaultWidget({ id: 'p', label: 'P', kind: 'state', type: 's', optionsFrom: { list: 'segments' } })).toBe('select')
    expect(defaultWidget({ id: 'p', label: 'P', kind: 'state', type: 'bool' })).toBe('switch')
    expect(defaultWidget({ id: 'p', label: 'P', kind: 'trigger', type: 's' })).toBe('button')
    expect(defaultWidget({ id: 'p', label: 'P', kind: 'state', type: 'f', range: [0, 1], widget: 'input' })).toBe('input')
  })

  it('gives the color picker only to a color composite of three or four 0..1 floats', () => {
    const rgba = (overrides: Partial<Extract<SurfaceParameter, { type: 'composite' }>> = {}): SurfaceParameter => ({
      id: 'tint', label: 'Tint', kind: 'state', type: 'composite', hint: 'color',
      fields: ['r', 'g', 'b', 'a'].map(id => ({ id, label: id, type: 'f' as const, range: [0, 1] as [number, number], default: 1 })),
      ...overrides,
    })
    expect(defaultWidget(rgba())).toBe('color')
    expect(isColorComposite(rgba({ fields: ['r', 'g', 'b'].map(id => ({ id, label: id, type: 'f' as const, range: [0, 255] as [number, number], default: 1 })) }))).toBe(false)
    expect(isColorComposite(rgba({ kind: 'trigger' }))).toBe(false)
    expect(defaultWidget(rgba({ hint: 'acme.light' }))).toBe('composite')
  })
})

describe('buildSurfaceView', () => {
  it('turns parameters into controls with their type, range, default and value', () => {
    const built = view(definition({
      parameters: [
        { id: 'level', label: 'Level', type: 'f', kind: 'state', range: [0, 1], step: 0.1, default: 0.5 },
        { id: 'go', label: 'Go', type: 'i', kind: 'trigger', value: 1 },
        { id: 'solo', label: 'Solo', type: 'bool', kind: 'state', default: false, standalone: false },
      ],
    }))
    expect(built.parameters).toEqual([
      { param: 'level', label: 'Level', type: 'f', kind: 'state', widget: 'slider', standalone: true, range: [0, 1], step: 0.1, default: 0.5 },
      { param: 'go', label: 'Go', type: 'i', kind: 'trigger', widget: 'button', standalone: true, value: 1 },
      { param: 'solo', label: 'Solo', type: 'bool', kind: 'state', widget: 'switch', standalone: false, default: false },
    ])
  })

  it('offers Sync only for lists with a request, and keeps an empty choice list for a select fed by a list', () => {
    const built = view(definition({
      parameters: [
        { id: 'segment', label: 'Segment', type: 's', kind: 'state', options: ['(none)'], optionsFrom: { list: 'segments' } },
        { id: 'pick', label: 'Pick', type: 's', kind: 'state', optionsFrom: { list: 'picks' } },
      ],
      bindings: {
        osc: {
          parameters: [{ id: 'segment', address: '/segment' }, { id: 'pick', address: '/pick' }],
          lists: [{ id: 'segments', address: '/segments', request: '/segments/get' }, { id: 'picks', address: '/picks' }],
        },
      },
    }))
    expect(built.parameters[0]).toMatchObject({ widget: 'select', options: ['(none)'], optionsFrom: 'segments', optionsSync: 'segments' })
    expect(built.parameters[1]).toMatchObject({ widget: 'select', options: [], optionsFrom: 'picks' })
    expect(built.parameters[1]).not.toHaveProperty('optionsSync')
  })

  it('applies the layout widget and label, and turns a select without choices into an input', () => {
    const built = view(definition({
      parameters: [
        { id: 'count', label: 'Count', type: 'i', kind: 'state', range: [0, 10], default: 3 },
        { id: 'name', label: 'Name', type: 's', kind: 'state', default: '' },
      ],
      children: [
        { kind: 'control', param: 'count' },
        { kind: 'control', param: 'count', widget: 'input', label: 'Count (typed)', width: 6 },
        { kind: 'control', param: 'name', width: 'auto' },
      ],
    }))
    const [first, second, third] = built.screens[0]!.children
    expect(controlOf(first)).toMatchObject({ widget: 'slider', label: 'Count' })
    expect(second).toMatchObject({ width: 6, control: { widget: 'input', label: 'Count (typed)' } })
    // 'auto' は描画側に任せるので幅を持たない
    expect(third).not.toHaveProperty('width')
    expect(controlOf(third)?.widget).toBe('input')
  })

  it('keeps the nested layout in order', () => {
    const parameters = ['a', 'b', 'c', 'd'].map(id => ({ id, label: id.toUpperCase(), type: 'i' as const, kind: 'state' as const }))
    const built = view(definition({
      parameters,
      children: [
        { kind: 'row', children: [{ kind: 'control', param: 'a' }, { kind: 'column', children: [{ kind: 'control', param: 'b' }] }] },
        { kind: 'group', label: 'G', children: [{ kind: 'control', param: 'c' }] },
        { kind: 'tabs', tabs: [{ label: 'T1', children: [{ kind: 'control', param: 'd' }] }] },
      ],
    }))
    const [row, group, tabs] = built.screens[0]!.children
    expect(row).toMatchObject({ kind: 'row', children: [{ kind: 'control' }, { kind: 'column', children: [{ kind: 'control' }] }] })
    expect(group).toMatchObject({ kind: 'group', label: 'G', collapsed: false })
    expect(tabs).toMatchObject({ kind: 'tabs', tabs: [{ label: 'T1', children: [{ kind: 'control', control: { param: 'd' } }] }] })
  })

  it('expands action steps in definition order, with fixed values and the selector targets', () => {
    const parameters = [
      { id: 'slot1', label: 'Slot 1', type: 'f' as const, kind: 'state' as const, default: 0 },
      { id: 'slot2', label: 'Slot 2', type: 'f' as const, kind: 'state' as const, default: 0 },
      { id: 'mode', label: 'Mode', type: 's' as const, kind: 'state' as const, options: ['a', 'b'], default: 'a' },
    ]
    const built = view(definition({
      parameters,
      actions: [{ id: 'all', label: 'All', steps: [{ param: 'mode', value: 'b' }, { selector: 'slots' }] }],
      children: [{ kind: 'action', action: 'all', label: 'Send all' }],
      bindings: {
        osc: {
          parameters: [{ id: 'slot1', address: '/slot/1' }, { id: 'slot2', address: '/slot/2' }, { id: 'mode', address: '/mode' }],
          selectors: [{ id: 'slots', match: '/slot/*' }],
        },
      },
    }))
    const action = built.actions[0]!
    expect('targets' in action && action.targets.map(target => [target.control.param, target.fixed])).toEqual([['mode', 'b'], ['slot1', undefined], ['slot2', undefined]])
    expect(built.screens[0]!.children[0]).toEqual({ kind: 'action', action: 'all', label: 'Send all' })
  })

  it('stops expanding an action just past the batch limit (the check that refuses such a definition runs before adoption)', () => {
    const parameters = Array.from({ length: OSC_BATCH.MAX_MESSAGES + 5 }, (_, index) => ({ id: `p${String(index)}`, label: `P${String(index)}`, type: 'f' as const, kind: 'state' as const, default: 0 }))
    // 採用の判定は上限を超える定義を断るので、構造だけを通した定義で展開の打ち切りを確かめる
    const built = buildSurfaceView({
      format: 'oscdesk-surface', version: 2, name: 'Big', parameters,
      actions: [{ id: 'all', label: 'All', steps: [{ selector: 'every' }] }],
      screens: [],
      bindings: { osc: { parameters: parameters.map(parameter => ({ id: parameter.id, address: `/p/${parameter.id}` })), selectors: [{ id: 'every', match: '/p/*' }] } },
    })
    const action = built.actions[0]!
    expect('targets' in action && action.targets.length).toBe(OSC_BATCH.MAX_MESSAGES + 1)
  })

  it('builds records, record tables and row-scoped actions', () => {
    const built = view(definition({
      parameters: [],
      records: [
        {
          id: 'member', label: 'Member', kind: 'state', keysFrom: { list: 'members', source: 'ui', max: 8 },
          fields: [
            { id: 'active', label: 'Active', type: 'bool', default: false },
            { id: 'slot', label: 'Slot', type: 'i', range: [1, 64], default: 1 },
          ],
        },
        { id: 'cue', label: 'Cue', kind: 'trigger', key: { label: 'Name' }, keysFrom: { list: 'cues' }, fields: [{ id: 'go', label: 'Go', type: 'i', value: 1 }] },
      ],
      actions: [
        { id: 'on', label: 'On', scope: 'all', steps: [{ record: 'member', value: { active: true } }] },
        { id: 'off', label: 'Off', scope: 'all', steps: [{ record: 'member', value: { active: false } }] },
        { id: 'send', label: 'Send', scope: 'row', steps: [{ record: 'member' }] },
      ],
      children: [
        {
          kind: 'record', record: 'member', rowActions: ['send'], tableActions: ['on'],
          columns: [{ field: 'slot', widget: 'input', label: 'No.' }, { field: 'active', toggle: { label: 'All', on: 'on', off: 'off' } }],
        },
        { kind: 'record', record: 'cue' },
      ],
      bindings: {
        osc: {
          parameters: [],
          records: [{ id: 'member', address: '/member' }, { id: 'cue', address: '/cue' }],
          lists: [{ id: 'members', address: '/members' }, { id: 'cues', address: '/cues', request: '/cues/get' }],
        },
      },
    }))
    expect(built.records[0]).toMatchObject({ record: 'member', keyLabel: 'キー', keysSource: 'ui', keysMax: 8, initialValues: [false, 1] })
    expect(built.records[1]).toMatchObject({ record: 'cue', keyLabel: 'Name', keysSource: 'unity', keysSync: 'cues', initialValues: [1] })
    const [member, cue] = built.screens[0]!.children
    expect(member).toMatchObject({
      kind: 'record', label: 'Member', rowActions: ['send'], tableActions: ['on'], editRows: true,
      columns: [
        { field: 1, control: { widget: 'input', label: 'No.' }, actions: [] },
        { field: 0, control: { widget: 'switch' }, toggle: { label: 'All', on: 'on', off: 'off' } },
      ],
    })
    // 列を書かなければ全フィールドを定義順に。trigger のレコードには行の追加・削除を出さない
    expect(cue).toMatchObject({ kind: 'record', editRows: false, columns: [{ field: 0, control: { widget: 'button' } }] })
    expect(built.actions[0]).toEqual({ action: 'on', label: 'On', scope: 'all', steps: [{ record: 'member', fixed: [{ field: 0, value: true }] }] })
    expect(built.actions[2]).toEqual({ action: 'send', label: 'Send', scope: 'row', steps: [{ record: 'member', fixed: [] }] })
  })

  it('carries composite fields with the field widgets and the hint', () => {
    const built = view(definition({
      parameters: [{
        id: 'light', label: 'Light', type: 'composite', kind: 'state', hint: 'acme.light',
        fields: [
          { id: 'level', label: 'Level', type: 'f', range: [0, 1], default: 0.5 },
          { id: 'on', label: 'On', type: 'bool', default: true },
          { id: 'mode', label: 'Mode', type: 's', options: ['a', 'b'], default: 'a' },
        ],
      }],
    }))
    const light = built.parameters[0]!
    expect(light).toMatchObject({ type: 'composite', widget: 'composite', hint: 'acme.light' })
    expect(light.fields?.map(field => [field.param, field.widget, field.default])).toEqual([['level', 'slider', 0.5], ['on', 'switch', true], ['mode', 'select', 'a']])
  })
})
