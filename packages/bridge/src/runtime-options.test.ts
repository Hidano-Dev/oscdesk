import { describe, expect, it } from 'vitest'

import type { OscArg, SurfaceDefinition, SurfaceParameter } from '@oscdesk/shared'

import { createRuntimeOptions } from './runtime-options'

const segment = (id: string, extra: Partial<Extract<SurfaceParameter, { type: 's' }>> = {}): SurfaceParameter => ({
  id, address: `/member/${id}/segment`, label: id, type: 's', kind: 'state',
  optionsFrom: { address: '/mb/segments', request: '/mb/segments/get' }, ...extra,
})

const definitionOf = (...parameters: SurfaceParameter[]): SurfaceDefinition => ({
  format: 'oscdesk-surface', version: 1, name: 'T', parameters, screens: [],
})

const names = (...values: string[]): OscArg[] => values.map(value => ({ type: 's', value }))

describe('createRuntimeOptions (D-053)', () => {
  it('orders the union as static options, the primary list, then names only a secondary has, in config order', () => {
    const options = createRuntimeOptions(['unity', 'backup', 'spare'])
    options.setDefinition(definitionOf(segment('s1', { options: ['(none)', 'B'] })))
    // 届く順は副系が先でも、和集合の順序は config の宛先順で決まる
    options.receive('spare', '/mb/segments', names('D', 'A'))
    options.receive('backup', '/mb/segments', names('C', 'B', 'A'))
    options.receive('unity', '/mb/segments', names('A', 'B', 'A'))

    const frame = options.frame()
    expect(frame.choices).toEqual([{ param: 's1', options: ['(none)', 'B', 'A', 'C', 'D'] }])
    expect(frame.lists).toEqual([{
      address: '/mb/segments',
      targets: [
        { name: 'unity', options: ['A', 'B', 'A'] },
        { name: 'backup', options: ['C', 'B', 'A'] },
        { name: 'spare', options: ['D', 'A'] },
      ],
    }])
  })

  it('replaces a target list on each new list and reports unchanged repeats', () => {
    const options = createRuntimeOptions(['unity', 'backup'])
    options.setDefinition(definitionOf(segment('s1')))
    expect(options.receive('unity', '/mb/segments', names('A', 'B'))).toBe('changed')
    expect(options.receive('unity', '/mb/segments', names('A', 'B'))).toBe('unchanged')
    expect(options.receive('backup', '/mb/segments', names('C'))).toBe('changed')
    expect(options.receive('unity', '/mb/segments', names('B'))).toBe('changed')
    // 空の一覧も一覧である(その台にはもう名前が無い)
    expect(options.receive('backup', '/mb/segments', [])).toBe('changed')
    expect(options.frame().choices).toEqual([{ param: 's1', options: ['B'] }])
    expect(options.frame().lists[0]!.targets).toEqual([{ name: 'unity', options: ['B'] }, { name: 'backup', options: [] }])
  })

  it('rejects lists with non-string arguments without touching the held list', () => {
    const options = createRuntimeOptions(['unity'])
    options.setDefinition(definitionOf(segment('s1')))
    options.receive('unity', '/mb/segments', names('A'))
    expect(options.receive('unity', '/mb/segments', [{ type: 's', value: 'B' }, { type: 'i', value: 1 }])).toBe('invalid')
    expect(options.frame().choices).toEqual([{ param: 's1', options: ['A'] }])
  })

  it('keeps lists of addresses still referenced across adoptions and drops the rest', () => {
    const options = createRuntimeOptions(['unity'])
    const other = segment('s2', { optionsFrom: { address: '/mb/scenes' } })
    options.setDefinition(definitionOf(segment('s1'), other))
    options.receive('unity', '/mb/segments', names('A'))
    options.receive('unity', '/mb/scenes', names('X'))

    options.setDefinition(definitionOf(segment('s1', { label: 'renamed' })))
    expect(options.isListAddress('/mb/scenes')).toBe(false)
    expect(options.receive('unity', '/mb/scenes', names('Y'))).toBe('unchanged')
    expect(options.frame()).toEqual({
      v: 1, type: 'runtimeOptions',
      lists: [{ address: '/mb/segments', targets: [{ name: 'unity', options: ['A'] }] }],
      choices: [{ param: 's1', options: ['A'] }],
    })

    // 参照が消えて戻ってきたアドレスは、前の一覧を引き継がない。lists は定義の順に並ぶ
    options.setDefinition(definitionOf(other, segment('s1')))
    expect(options.frame().lists).toEqual([
      { address: '/mb/scenes', targets: [] },
      { address: '/mb/segments', targets: [{ name: 'unity', options: ['A'] }] },
    ])
  })

  it('shares one list per address between parameters, each with its own static options', () => {
    const options = createRuntimeOptions(['unity'])
    options.setDefinition(definitionOf(segment('s1', { options: ['(none)'] }), segment('s2')))
    options.receive('unity', '/mb/segments', names('A', '(none)'))
    const frame = options.frame()
    expect(frame.lists).toHaveLength(1)
    expect(frame.choices).toEqual([
      { param: 's1', options: ['(none)', 'A'] },
      { param: 's2', options: ['A', '(none)'] },
    ])
  })

  it('returns only the requests a new list or request address needs', () => {
    const options = createRuntimeOptions(['unity'])
    expect(options.setDefinition(definitionOf(segment('s1'), segment('s2')))).toEqual(['/mb/segments/get'])
    expect(options.requestAddresses()).toEqual(['/mb/segments/get'])
    expect(options.isRequestAddress('/mb/segments/get')).toBe(true)
    // レイアウトだけの再採用では要求しない
    expect(options.setDefinition(definitionOf(segment('s1'), segment('s2')))).toEqual([])
    // 新しい一覧のアドレス、要求のアドレスの変更は要求する。request の無い一覧は自発送信を待つだけ
    expect(options.setDefinition(definitionOf(
      segment('s1'),
      segment('s2', { optionsFrom: { address: '/mb/scenes', request: '/mb/segments/get' } }),
      segment('s3', { optionsFrom: { address: '/mb/cues' } }),
    ))).toEqual(['/mb/segments/get'])
    expect(options.setDefinition(definitionOf(segment('s1', { optionsFrom: { address: '/mb/segments', request: '/mb/list' } })))).toEqual(['/mb/list'])
    expect(options.isRequestAddress('/mb/segments/get')).toBe(false)
    expect(options.setDefinition(null)).toEqual([])
    expect(options.frame()).toEqual({ v: 1, type: 'runtimeOptions', lists: [], choices: [] })
  })
})
