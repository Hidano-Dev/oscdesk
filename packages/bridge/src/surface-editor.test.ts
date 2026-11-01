import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import type { NodeRef, OscSurfaceDefinition, OscSurfaceParameter, ParameterForm, SurfaceDefinition, SurfaceEdit, SurfaceLayoutNode } from '@oscdesk/shared'

import { applySurfaceEdit } from './surface-editor'
import { v2 } from './surface-fixture'

// UI(Python)の surface_editor.py から移した規則の検査(D-123)。定義は版 1 の書き方で作って版 2 へ移す(D-117)
const param = (id: string, address: string, type: 'bool' | 'f', label: string, extra: Record<string, unknown> = {}): OscSurfaceParameter =>
  ({ id, address, label, kind: 'state', type, ...(type === 'bool' ? { default: false } : { default: 0 }), ...extra }) as OscSurfaceParameter
const control = (id: string): SurfaceLayoutNode => ({ kind: 'control', param: id })
const PARAMS = [param('a', '/a', 'bool', 'A'), param('b', '/b', 'f', 'B', { range: [0, 1] }), param('c', '/c', 'bool', 'C')]

function definition(parameters: OscSurfaceParameter[] = PARAMS, children?: SurfaceLayoutNode[], extra: Partial<OscSurfaceDefinition> = {}): SurfaceDefinition {
  return v2({
    format: 'oscdesk-surface', version: 1, name: 'Stage', parameters,
    screens: [{ id: 'main', label: 'Main', children: children ?? parameters.map(parameter => control(parameter.id)) }],
    ...extra,
  } as OscSurfaceDefinition)
}

/** 採用中の定義が無いときの編集の出発点(UI の surface_editor.new_definition と同じ形) */
function newSurfaceDefinition(name = 'New', options: { osc: boolean } = { osc: true }): SurfaceDefinition {
  return {
    format: 'oscdesk-surface', version: 2, name, parameters: [], screens: [{ id: 'main', label: 'Main', children: [] }],
    ...(options.osc ? { bindings: { osc: { parameters: [] } } } : {}),
  }
}

const at = (index: number, steps: NodeRef['steps'] = []): NodeRef => ({ screen: 0, steps, index })

function edit(draft: SurfaceDefinition, change: SurfaceEdit): SurfaceDefinition {
  const result = applySurfaceEdit(draft, change)
  if (!result.ok) throw new Error(result.detail)
  return result.definition
}

function rejected(draft: unknown, change: SurfaceEdit): string {
  const result = applySurfaceEdit(draft, change)
  if (result.ok) throw new Error('expected a rejection')
  return result.detail
}

const kinds = (defn: SurfaceDefinition) => defn.screens[0]?.children.map(node => node.kind)
const params = (nodes: SurfaceLayoutNode[] | undefined) => (nodes ?? []).map(node => node.kind === 'control' ? node.param : node.kind)
const address = (defn: SurfaceDefinition, id: string) => defn.bindings?.osc?.parameters.find(binding => binding.id === id)?.address

type FormInput = Partial<Omit<ParameterForm, 'osc'>> & { address?: string; listAddress?: string; listRequest?: string; noOsc?: boolean }

/** フォームの入力。address・listAddress・listRequest は OSC の欄(osc)へ入れる。noOsc なら OSC の欄を持たない */
function form(overrides: FormInput = {}): ParameterForm {
  const { address = '/x', listAddress = '', listRequest = '', noOsc = false, ...rest } = overrides
  return {
    id: 'x', label: 'X', kind: 'state', type: 'f', standalone: true, widget: '',
    min: '', max: '', step: '', options: '', default: '', value: '', ...rest,
    ...(noOsc ? {} : { osc: { address, listAddress, listRequest } }),
  }
}

describe('surface editor (D-123, moved from the UI)', () => {
  it('never mutates the source definition', () => {
    const source = definition()
    const snapshot = structuredClone(source)
    edit(source, { op: 'moveNode', ref: at(0), delta: 1 })
    edit(source, { op: 'wrapNode', ref: at(0), kind: 'group' })
    edit(source, { op: 'removeParameter', param: 'a' })
    expect(source).toEqual(snapshot)
  })

  it('moves neighbours and stops at the ends', () => {
    expect(params(edit(definition(), { op: 'moveNode', ref: at(0), delta: 1 }).screens[0]?.children)).toEqual(['b', 'a', 'c'])
    expect(edit(definition(), { op: 'moveNode', ref: at(0), delta: -1 })).toEqual(definition())
  })

  it('wraps in a group and unwraps back', () => {
    const wrapped = edit(definition(), { op: 'wrapNode', ref: at(1), kind: 'group', label: 'G' })
    expect(wrapped.screens[0]?.children[1]).toEqual({ kind: 'group', label: 'G', children: [control('b')] })
    expect(edit(wrapped, { op: 'unwrapNode', ref: at(1) })).toEqual(definition())
    expect(rejected(definition(), { op: 'unwrapNode', ref: at(0) })).toContain('解けるのは')
  })

  it('merges with the next sibling into a row and extends it', () => {
    const merged = edit(definition(), { op: 'mergeWithNext', ref: at(0) })
    expect(kinds(merged)).toEqual(['row', 'control'])
    const extended = edit(merged, { op: 'mergeWithNext', ref: at(0) })
    expect(kinds(extended)).toEqual(['row'])
    expect(extended.screens[0]?.children[0]).toMatchObject({ children: [control('a'), control('b'), control('c')] })
    expect(rejected(extended, { op: 'mergeWithNext', ref: at(0) })).toContain('後ろに並べる部品がありません')
  })

  it('sets the width and the collapsed state, and rejects an invalid width through the schema', () => {
    const wrapped = edit(definition(), { op: 'wrapNode', ref: at(0), kind: 'group', label: 'G' })
    const collapsed = edit(wrapped, { op: 'setCollapsed', ref: at(0), collapsed: true })
    expect(collapsed.screens[0]?.children[0]).toMatchObject({ collapsed: true })
    const widened = edit(collapsed, { op: 'setWidth', ref: at(0), width: 6 })
    expect(widened.screens[0]?.children[0]).toMatchObject({ width: 6 })
    expect(edit(widened, { op: 'setWidth', ref: at(0), width: null }).screens[0]?.children[0]).not.toHaveProperty('width')
    expect(rejected(definition(), { op: 'setCollapsed', ref: at(0), collapsed: true })).toContain('グループだけ')
    expect(rejected(definition(), { op: 'setWidth', ref: at(0), width: 13 })).toContain('width')
  })

  it('reaches inside rows and tabs', () => {
    const defn = definition(PARAMS, [
      { kind: 'row', children: [control('a'), control('b')] },
      { kind: 'tabs', tabs: [{ label: 'T', children: [control('c')] }] },
    ])
    const insideRow = edit(defn, { op: 'removeNode', ref: at(0, [0]) })
    expect(insideRow.screens[0]?.children[0]).toEqual({ kind: 'row', children: [control('b')] })
    const insideTab = edit(defn, { op: 'removeNode', ref: at(0, [[1, 0]]) })
    expect(insideTab.screens[0]?.children[1]).toEqual({ kind: 'tabs', tabs: [{ label: 'T', children: [] }] })
    expect(rejected(defn, { op: 'removeNode', ref: at(0, [9]) })).toContain('対象の場所が見つかりません')
    expect(rejected(defn, { op: 'removeNode', ref: at(5) })).toContain('対象の部品が見つかりません')
  })

  it('removes a parameter with its controls and its binding', () => {
    const defn = definition(PARAMS, [{ kind: 'group', label: 'G', children: [control('a')] }, control('b'), control('c')])
    const result = edit(defn, { op: 'removeParameter', param: 'a' })
    expect(result.parameters.map(parameter => parameter.id)).toEqual(['b', 'c'])
    expect(result.screens[0]?.children[0]).toEqual({ kind: 'group', label: 'G', children: [] })
    expect(result.bindings?.osc?.parameters.map(binding => binding.id)).toEqual(['b', 'c'])
    expect(rejected(defn, { op: 'removeParameter', param: 'missing' })).toContain('パラメータ missing がありません')
  })

  it('drops an unused selector binding even if the action stays (PR #111)', () => {
    const defn = definition(
      [param('a', '/sel/a', 'f', 'A'), param('b', '/other/b', 'f', 'B')],
      [control('a'), control('b')],
      { actions: [{ id: 'x', label: 'X', steps: [{ match: '/sel/*' }, { param: 'b' }] }] },
    )
    const result = edit(defn, { op: 'removeParameter', param: 'a' })
    expect(result.actions).toEqual([{ id: 'x', label: 'X', steps: [{ param: 'b' }] }])
    expect(result.bindings?.osc).not.toHaveProperty('selectors')
  })

  it('follows an id rename in the layout and the bindings', () => {
    const result = edit(definition(), { op: 'setParameter', original: 'a', form: form({ id: 'alpha', address: '/a', label: 'A', type: 'bool', default: 'false' }) })
    expect(params(result.screens[0]?.children)).toEqual(['alpha', 'b', 'c'])
    expect(address(result, 'alpha')).toBe('/a')
  })

  it('adds a parameter with its OSC binding, and leaves the bindings alone without the OSC fields', () => {
    const added = edit(definition(), { op: 'setParameter', original: null, form: form({ id: 'd', address: '/d' }) })
    expect(address(added, 'd')).toBe('/d')
    const result = edit(newSurfaceDefinition('Plain', { osc: false }), { op: 'setParameter', original: null, form: form({ id: 'd', noOsc: true }) })
    expect(result.bindings).toBeUndefined()
  })

  it('places unplaced parameters', () => {
    const defn = definition(PARAMS, [control('a')])
    const placed = edit(defn, { op: 'addControl', screen: 0, steps: [], param: 'b' })
    expect(params(placed.screens[0]?.children)).toEqual(['a', 'b'])
    expect(rejected(defn, { op: 'addControl', screen: 0, steps: [], param: 'missing' })).toContain('パラメータ missing がありません')
  })

  it('rejects an edit that breaks the definition and the draft is left as sent', () => {
    // 範囲の逆転は検証で断る(作業コピーは UI が持ち、断られたら変えない)
    const detail = rejected(definition(), { op: 'setParameter', original: 'b', form: form({ id: 'b', address: '/b', label: 'B', min: '1', max: '0' }) })
    expect(detail).toMatch(/range/)
    expect(rejected({ format: 'nope' }, { op: 'moveNode', ref: at(0), delta: 1 })).toMatch(/^作業中の定義が不正です/)
  })

  it('replaces the draft with an uploaded definition, moving version 1 to version 2', () => {
    const legacy = { format: 'oscdesk-surface', version: 1, name: 'L', parameters: [param('a', '/a', 'bool', 'A')], screens: [] }
    // 作業コピーは使わない(壊れた作業コピーでもアップロードで直せる)
    expect(applySurfaceEdit(null, { op: 'replace', definition: legacy })).toMatchObject({ ok: true, definition: { version: 2, bindings: { osc: { parameters: [{ id: 'a', address: '/a' }] } } } })
    expect(applySurfaceEdit(definition(), { op: 'replace', definition: { format: 'nope' } })).toMatchObject({ ok: false })
  })

  it('builds numeric ranges, steps and defaults from the form', () => {
    const result = edit(newSurfaceDefinition(), { op: 'setParameter', original: null, form: form({ min: '0', max: '10', step: '0.5', default: '5' }) })
    // アドレスは本体に入れない(結び付けへ。D-117)
    expect(result.parameters[0]).toEqual({ id: 'x', label: 'X', kind: 'state', type: 'f', range: [0, 10], step: 0.5, default: 5 })
    expect(rejected(newSurfaceDefinition(), { op: 'setParameter', original: null, form: form({ min: '0' }) })).toContain('最小と最大を両方')
    expect(rejected(newSurfaceDefinition(), { op: 'setParameter', original: null, form: form({ min: 'a', max: '1' }) })).toContain('最小 は数値で入力してください')
    // 10 進の数だけを読む(JS の Number() が読む 0x10・0b11 は断り、Python の float() と同じく数字の間の _ は受ける)
    expect(rejected(newSurfaceDefinition(), { op: 'setParameter', original: null, form: form({ min: '0x10', max: '20' }) })).toContain('最小 は数値で入力してください')
    expect(rejected(newSurfaceDefinition(), { op: 'setParameter', original: null, form: form({ min: '0', max: '0b11' }) })).toContain('最大 は数値で入力してください')
    expect(rejected(newSurfaceDefinition(), { op: 'setParameter', original: null, form: form({ min: '0', max: 'Infinity' }) })).toContain('最大 は数値で入力してください')
    const separated = edit(newSurfaceDefinition(), { op: 'setParameter', original: null, form: form({ min: '-1_000', max: '1e3', step: '.5' }) })
    expect(separated.parameters[0]).toMatchObject({ range: [-1000, 1000], step: 0.5 })
  })

  it('keeps the display hint and omits a blank one', () => {
    const hinted = edit(newSurfaceDefinition(), { op: 'setParameter', original: null, form: form({ min: '0', max: '1', widget: 'input' }) })
    expect(hinted.parameters[0]).toMatchObject({ widget: 'input' })
    const blank = edit(newSurfaceDefinition(), { op: 'setParameter', original: null, form: form({ min: '0', max: '1' }) })
    expect(blank.parameters[0]).not.toHaveProperty('widget')
  })

  it('builds triggers, selects, bools and the standalone flag', () => {
    const trigger = edit(newSurfaceDefinition(), { op: 'setParameter', original: null, form: form({ kind: 'trigger', type: 'bool', value: 'true', default: 'false' }) })
    expect(trigger.parameters[0]).toMatchObject({ value: true })
    expect(trigger.parameters[0]).not.toHaveProperty('default')
    const select = edit(newSurfaceDefinition(), { op: 'setParameter', original: null, form: form({ type: 's', options: 'a, b', default: 'a' }) })
    expect(select.parameters[0]).toMatchObject({ options: ['a', 'b'], default: 'a' })
    const grouped = edit(newSurfaceDefinition(), { op: 'setParameter', original: null, form: form({ standalone: false }) })
    expect(grouped.parameters[0]).toMatchObject({ standalone: false })
  })

  it('keeps optionsFrom for string states and rejects it elsewhere', () => {
    const edited = form({ type: 's', options: '(none)', listAddress: ' /mb/segments ', listRequest: '/mb/segments/get' })
    const result = edit(newSurfaceDefinition(), { op: 'setParameter', original: null, form: edited })
    // 一覧は id で指し、アドレスと要求は結び付けへ(D-117)
    expect(result.parameters[0]).toMatchObject({ optionsFrom: { list: 'l_mb_segments' } })
    expect(result.bindings?.osc?.lists).toEqual([{ id: 'l_mb_segments', address: '/mb/segments', request: '/mb/segments/get' }])
    const plain = edit(newSurfaceDefinition('P', { osc: false }), { op: 'setParameter', original: null, form: form({ type: 's', optionsFromList: 'segments', noOsc: true }) })
    expect(plain.parameters[0]).toMatchObject({ optionsFrom: { list: 'segments' } })
    // s の state 以外では黙って捨てず、入力を直させる
    expect(rejected(newSurfaceDefinition(), { op: 'setParameter', original: null, form: form({ type: 'f', listAddress: '/mb/segments' }) })).toContain('s 型の state')
    expect(rejected(newSurfaceDefinition(), { op: 'setParameter', original: null, form: form({ type: 's', kind: 'trigger', value: 'x', listAddress: '/mb/segments' }) })).toContain('s 型の state')
    expect(rejected(newSurfaceDefinition(), { op: 'setParameter', original: null, form: form({ type: 's', listRequest: '/mb/segments/get' }) })).toContain('一覧のアドレスも')
  })

  it('keeps optionsFrom and the list binding when only the label is edited through the form', () => {
    const segment = { id: 'segment', address: '/member/1/segment', label: 'Segment', kind: 'state', type: 's', options: ['(none)'], default: 'Intro',
      optionsFrom: { address: '/mb/segments', request: '/mb/segments/get' } } as unknown as OscSurfaceParameter
    const defn = definition([segment], [control('segment')])
    const edited = form({ id: 'segment', address: '/member/1/segment', label: 'Seg', type: 's', options: '(none)', default: 'Intro',
      listAddress: '/mb/segments', listRequest: '/mb/segments/get' })
    const result = edit(defn, { op: 'setParameter', original: 'segment', form: edited })
    expect(result.parameters[0]).toMatchObject({ label: 'Seg', optionsFrom: { list: 'l_mb_segments' } })
    expect(result.bindings?.osc?.lists).toEqual([{ id: 'l_mb_segments', address: '/mb/segments', request: '/mb/segments/get' }])
  })

  describe('actions (moved from test_actions.py)', () => {
    const slot = (id: string, address: string, extra: Record<string, unknown> = {}) =>
      ({ id, address, label: id, kind: 'state', type: 'f', range: [0, 1], default: 0, standalone: false, ...extra }) as unknown as OscSurfaceParameter
    const PARAMS_A = [
      slot('slot1', '/slot/01'),
      slot('slot2', '/slot/02'),
      { id: 'mode', address: '/slot/mode', label: 'Mode', kind: 'state', type: 's', options: ['a', 'b'], default: 'a', standalone: false } as unknown as OscSurfaceParameter,
      { id: 'apply', address: '/cue/apply', label: 'Apply', kind: 'trigger', type: 'i', value: 1 } as unknown as OscSurfaceParameter,
    ]
    const ACTIONS = [
      { id: 'applyAll', label: 'Apply all', steps: [{ match: '/slot/*' }, { param: 'apply' }] },
      { id: 'reset', label: 'Reset', steps: [{ param: 'slot1', value: 0 }, { param: 'mode', value: 'b' }] },
    ]
    const withActions = () => definition(PARAMS_A, [control('slot1'), { kind: 'action', action: 'applyAll' }, { kind: 'action', action: 'reset' }], { actions: ACTIONS } as Partial<OscSurfaceDefinition>)

    it('keeps actions consistent when a parameter is renamed or removed', () => {
      const renamed = edit(withActions(), { op: 'setParameter', original: 'slot1', form: form({ id: 'first', address: '/slot/01', label: 'slot1', min: '0', max: '1', default: '0', standalone: false }) })
      expect(renamed.actions?.[1]?.steps[0]).toEqual({ param: 'first', value: 0 })
      const removed = edit(withActions(), { op: 'removeParameter', param: 'mode' })
      expect(removed.actions?.[1]?.steps).toEqual([{ param: 'slot1', value: 0 }])
      const emptied = edit(removed, { op: 'removeParameter', param: 'slot1' })
      expect(emptied.actions?.map(action => action.id)).toEqual(['applyAll'])
      expect(emptied.screens[0]?.children.some(node => node.kind === 'action' && node.action === 'reset')).toBe(false)
    })

    it('drops selector steps that no longer hit anything, with their bindings', () => {
      const onlySlots = definition([PARAMS_A[0] as OscSurfaceParameter], [control('slot1'), { kind: 'action', action: 'all' }],
        { actions: [{ id: 'all', label: 'All', steps: [{ match: '/slot/*' }] }] } as Partial<OscSurfaceDefinition>)
      const removed = edit(onlySlots, { op: 'removeParameter', param: 'slot1' })
      expect(removed).not.toHaveProperty('actions')
      expect(removed.screens[0]?.children).toEqual([])
      // アドレスの変更で selector が何にも当たらなくなれば、そのアクションと selector の結び付けも外す(D-117)
      const moved = edit(onlySlots, { op: 'setParameter', original: 'slot1', form: form({ id: 'slot1', address: '/elsewhere/01', label: 'slot1', min: '0', max: '1', default: '0', standalone: false }) })
      expect(moved).not.toHaveProperty('actions')
      expect(moved.bindings?.osc).not.toHaveProperty('selectors')
    })
  })

  describe('records (moved from test_records.py)', () => {
    const sample = (name: string): SurfaceDefinition => {
      const cases = (JSON.parse(readFileSync(path.resolve(__dirname, '../../../protocol/surface-definition-samples.json'), 'utf8')) as { cases: { name: string; definition: SurfaceDefinition }[] }).cases
      const found = cases.find(item => item.name === name)
      if (found === undefined) throw new Error(`no sample ${name}`)
      return structuredClone(found.definition)
    }
    const recordNode = (defn: SurfaceDefinition) => defn.screens[0]?.children.find(node => node.kind === 'record')

    it('keeps records, record nodes and scoped actions through edits', () => {
      const basic = sample('records-basic')
      let draft = edit(basic, { op: 'moveNode', ref: at(1), delta: 1 })
      draft = edit(draft, { op: 'setLabel', ref: at(2), label: '表' })
      draft = edit(draft, { op: 'removeParameter', param: 'master' })
      draft = edit(draft, { op: 'setParameter', original: null, form: form({ id: 'gain', label: 'Gain', address: '/mix/gain' }) })
      expect(draft.records).toEqual(basic.records)
      expect(draft.actions).toEqual(basic.actions)
      expect(kinds(draft)).toEqual(['action', 'record', 'action'])
    })

    it('keeps column actions, the column toggle and the table actions through edits', () => {
      const columns = sample('records-column-actions')
      const moved = edit(edit(columns, { op: 'moveNode', ref: at(1), delta: 1 }), { op: 'removeParameter', param: 'master' })
      const columnsOf = (node: SurfaceLayoutNode | undefined) => node?.kind === 'record' ? node : undefined
      expect(columnsOf(recordNode(moved))?.columns?.[0]?.actions).toEqual(['allActive', 'allInactive'])
      expect(moved.actions).toEqual(columns.actions)
      const toggle = edit(sample('records-column-toggle-and-table-actions'), { op: 'removeParameter', param: 'master' })
      expect(columnsOf(recordNode(toggle))?.columns?.[0]?.toggle).toEqual({ label: 'All Active', on: 'allActive', off: 'allInactive' })
      expect(columnsOf(recordNode(toggle))?.tableActions).toEqual(['updateAll'])
    })
  })

  it('renames the definition and sets labels', () => {
    expect(edit(definition(), { op: 'rename', name: 'Other' }).name).toBe('Other')
    expect(edit(definition(), { op: 'setLabel', ref: at(0), label: 'Alpha' }).screens[0]?.children[0]).toEqual({ kind: 'control', param: 'a', label: 'Alpha' })
  })
})
