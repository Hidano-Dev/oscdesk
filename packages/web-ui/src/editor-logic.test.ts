// 編集モードの読み取りと行の上限(D-144・HID-405)
import { describe, expect, it } from 'vitest'

import { SurfaceEditSchema, type SurfaceDefinition } from '@oscdesk/shared'

import {
  countNodes,
  joinBindings,
  newDefinition,
  nodeAt,
  parameterFields,
  parameterForm,
  recordSummary,
  safeFilename,
  sameDefinition,
  suggestParameterId,
  treeRows,
  unplacedParameterIds,
  widthFromText,
} from './editor-logic'

const definition: SurfaceDefinition = {
  format: 'oscdesk-surface',
  version: 2,
  name: 'Stage',
  parameters: [
    { id: 'master', label: 'Master', type: 'f', kind: 'state', range: [0, 1], step: 0.1, default: 0.5 },
    { id: 'scene', label: 'Scene', type: 's', kind: 'state', options: ['a', 'b'], optionsFrom: { list: 'scenes' }, default: 'a' },
    { id: 'go', label: 'Go', type: 'bool', kind: 'trigger', value: true, standalone: false },
  ],
  records: [{ id: 'cams', label: 'Cams', kind: 'state', keysFrom: { list: 'camList' }, fields: [{ id: 'on', label: 'On', type: 'bool', default: false }] }],
  screens: [
    {
      id: 'main',
      label: 'Main',
      children: [
        { kind: 'control', param: 'master', width: 6 },
        { kind: 'group', label: 'G', children: [{ kind: 'record', record: 'cams' }] },
        { kind: 'tabs', tabs: [{ label: 'T1', children: [{ kind: 'control', param: 'master', label: 'M2' }] }] },
      ],
    },
    { id: 'second', label: 'Second', children: [{ kind: 'row', children: [] }] },
  ],
  bindings: {
    osc: {
      parameters: [{ id: 'master', address: '/mix/master' }],
      records: [{ id: 'cams', address: '/cams' }],
      lists: [{ id: 'scenes', address: '/scenes', request: '/scenes/get' }, { id: 'camList', address: '/cams/keys' }],
    },
  },
}

describe('editor logic', () => {
  it('finds nodes through groups and tabs, and returns null for a stale reference', () => {
    expect(nodeAt(definition, { screen: 0, steps: [1], index: 0 })).toMatchObject({ kind: 'record', record: 'cams' })
    expect(nodeAt(definition, { screen: 0, steps: [[2, 0]], index: 0 })).toMatchObject({ label: 'M2' })
    expect(nodeAt(definition, { screen: 0, steps: [0], index: 0 })).toBeNull() // control は子を持たない
    expect(nodeAt(definition, { screen: 3, steps: [], index: 0 })).toBeNull()
  })

  it('lists the tree in drawing order with references the bridge understands', () => {
    const { rows, hidden } = treeRows(definition, 200)
    expect(hidden).toBe(0)
    expect(rows.map((row) => row.type)).toEqual(['screen', 'node', 'node', 'node', 'node', 'tab', 'node', 'screen', 'node'])
    const tabChild = rows[6]
    if (tabChild.type !== 'node') throw new Error('not a node')
    expect(tabChild.ref).toEqual({ screen: 0, steps: [[2, 0]], index: 0 })
    // 送る形はブリッジの命令のスキーマに通る
    expect(SurfaceEditSchema.safeParse({ op: 'removeNode', ref: tabChild.ref }).success).toBe(true)
  })

  it('stops drawing rows at the limit and counts what it left out, including descendants and later screens', () => {
    expect(countNodes(definition.screens[0].children)).toBe(5)
    const { rows, hidden } = treeRows(definition, 2)
    expect(rows.filter((row) => row.type === 'node')).toHaveLength(2)
    // 2 つ目の行(グループ)の子 1・タブの 2・次の画面の 1
    expect(hidden).toBe(4)
    expect(rows.some((row) => row.type === 'screen' && row.label === 'Second')).toBe(false)
  })

  it('reads the bindings for the address fields and lists the unplaced parameters', () => {
    expect(unplacedParameterIds(definition)).toEqual(['scene', 'go'])
    const fields = parameterFields(definition, definition.parameters[1])
    expect(fields).toMatchObject({ id: 'scene', address: '/', options: 'a,b', optionsFromAddress: '/scenes', optionsFromRequest: '/scenes/get', optionsFromList: 'scenes', default: 'a' })
    expect(parameterFields(definition, definition.parameters[0])).toMatchObject({ address: '/mix/master', min: '0', max: '1', step: '0.1', default: '0.5' })
    expect(parameterFields(definition, definition.parameters[2])).toMatchObject({ value: 'true', standalone: false })
    expect(recordSummary(definition, definition.records![0], true)).toBe('cams  /cams  (state, キー: /cams/keys, on:bool)')
    expect(recordSummary(definition, definition.records![0], false)).toBe('cams    (state, キー: camList, on:bool)')
  })

  it('starts a new parameter with an unused id and puts the OSC fields only when the bridge has the OSC adapter', () => {
    const fields = parameterFields({ ...definition, parameters: [...definition.parameters, { id: 'param1', label: 'p', type: 'i', kind: 'state' }] }, null)
    expect(fields.id).toBe('param2')
    const osc = parameterForm(fields, true)
    expect(osc.osc).toEqual({ address: '/', listAddress: '', listRequest: '' })
    expect(osc.optionsFromList).toBeUndefined()
    const plain = parameterForm({ ...fields, optionsFromList: 'scenes' }, false)
    expect(plain.osc).toBeUndefined()
    expect(plain.optionsFromList).toBe('scenes')
    expect(SurfaceEditSchema.safeParse({ op: 'setParameter', original: null, form: osc }).success).toBe(true)
    expect(SurfaceEditSchema.safeParse({ op: 'setParameter', original: 'x', form: plain }).success).toBe(true)
  })

  it('joins the bindings to the body and compares definitions regardless of key order', () => {
    const { bindings, ...body } = definition
    expect(joinBindings(body, bindings ?? {})).toEqual(definition)
    expect(joinBindings(body, {})).toEqual(body)
    expect(sameDefinition({ a: 1, b: [{ c: 2, d: 3 }] }, { b: [{ d: 3, c: 2 }], a: 1 })).toBe(true)
    expect(sameDefinition({ a: 1 }, { a: 2 })).toBe(false)
    expect(newDefinition('New', false).bindings).toBeUndefined()
    expect(newDefinition().bindings).toEqual({ osc: { parameters: [] } })
  })

  it('reads the small inputs', () => {
    expect(widthFromText('')).toBeNull()
    expect(widthFromText('auto')).toBe('auto')
    expect(widthFromText('7')).toBe(7)
    expect(suggestParameterId(new Set(['param1', 'param2']))).toBe('param3')
    expect(safeFilename('My stage/1')).toBe('My_stage_1')
    expect(safeFilename('')).toBe('surface')
  })
})
