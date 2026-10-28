import { describe, expect, it } from 'vitest'

import type { OscArg, SurfaceDefinition, SurfaceParameter, SurfaceRecord } from '@oscdesk/shared'

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
      keys: [],
      fieldChoices: [],
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
    expect(options.frame()).toEqual({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [], fieldChoices: [] })
  })
})

describe('createRuntimeOptions: record keys and field choices (D-062)', () => {
  const member = (extra: Partial<SurfaceRecord> = {}): SurfaceRecord => ({
    id: 'member', address: '/vp/member', label: 'Member', kind: 'state',
    keysFrom: { address: '/vp/members', request: '/vp/members/get' },
    fields: [
      { id: 'active', label: 'Active', type: 'bool', default: false },
      { id: 'segment', label: 'Segment', type: 's', options: ['(none)'], optionsFrom: { address: '/mb/segments', request: '/mb/segments/get' }, default: '(none)' },
    ],
    ...extra,
  })
  const update: SurfaceRecord = {
    id: 'memberUpdate', address: '/vp/member/update', label: 'Update', kind: 'trigger',
    keysFrom: { address: '/vp/members', request: '/vp/members/get' }, fields: [],
  }
  const withRecords = (records: SurfaceRecord[], ...parameters: SurfaceParameter[]): SurfaceDefinition =>
    ({ ...definitionOf(...parameters), records })

  it('publishes keys per record as a union without empty names, and field choices like choices', () => {
    const options = createRuntimeOptions(['unity', 'backup'])
    options.setDefinition(withRecords([member(), update], segment('s1')))
    expect(options.frame()).toEqual({
      v: 1, type: 'runtimeOptions',
      lists: [{ address: '/mb/segments', targets: [] }, { address: '/vp/members', targets: [] }],
      choices: [{ param: 's1', options: [] }],
      keys: [{ record: 'member', keys: [] }, { record: 'memberUpdate', keys: [] }],
      fieldChoices: [{ record: 'member', field: 'segment', options: ['(none)'] }],
    })

    expect(options.receive('backup', '/vp/members', names('C', 'A'))).toBe('changed')
    expect(options.receive('unity', '/vp/members', names('A', '', 'B', 'A'))).toBe('changed')
    options.receive('unity', '/mb/segments', names('Intro'))
    const frame = options.frame()
    expect(frame.keys).toEqual([{ record: 'member', keys: ['A', 'B', 'C'] }, { record: 'memberUpdate', keys: ['A', 'B', 'C'] }])
    expect(options.recordKeys()).toEqual(frame.keys)
    // 宛先ごとの一覧は届いたまま(空文字・重複も)載せる
    expect(frame.lists[1]).toEqual({ address: '/vp/members', targets: [{ name: 'unity', options: ['A', '', 'B', 'A'] }, { name: 'backup', options: ['C', 'A'] }] })
    expect(frame.choices).toEqual([{ param: 's1', options: ['Intro'] }])
    expect(frame.fieldChoices).toEqual([{ record: 'member', field: 'segment', options: ['(none)', 'Intro'] }])
  })

  it('treats keysFrom like optionsFrom for list and request addresses, and for new requests on adoption', () => {
    const options = createRuntimeOptions(['unity'])
    expect(options.setDefinition(withRecords([member(), update]))).toEqual(['/vp/members/get', '/mb/segments/get'])
    expect(options.isListAddress('/vp/members')).toBe(true)
    expect(options.isRequestAddress('/vp/members/get')).toBe(true)
    expect(options.requestAddresses()).toEqual(['/vp/members/get', '/mb/segments/get'])
    expect(options.receive('unity', '/vp/members', [{ type: 'i', value: 1 }])).toBe('invalid')

    options.receive('unity', '/vp/members', names('A'))
    // レイアウトだけの再採用では要求せず、一覧も引き継ぐ
    expect(options.setDefinition(withRecords([member(), update]))).toEqual([])
    expect(options.recordKeys()).toEqual([{ record: 'member', keys: ['A'] }, { record: 'memberUpdate', keys: ['A'] }])
    // keysFrom と optionsFrom が同じ一覧を指しても 1 つの一覧になる
    options.setDefinition(withRecords([member({ keysFrom: { address: '/mb/segments' } })]))
    expect(options.frame().lists.map(list => list.address)).toEqual(['/mb/segments'])
  })

  it('gives UI-managed rows a random ID and an editable, unique name (D-087)', () => {
    let next = 0
    const options = createRuntimeOptions(['unity'], () => `r${String(++next)}`)
    const mb = member({ id: 'mb', keysFrom: { address: '/mb/keys', source: 'ui', max: 3 } })
    options.setDefinition(withRecords([mb]))

    expect(options.addUiKey('/mb/keys', 'MB 1')).toEqual({ result: 'added', id: 'r1' })
    expect(options.addUiKey('/mb/keys', 'MB 2')).toEqual({ result: 'added', id: 'r2' })
    expect(options.addUiKey('/mb/keys', 'MB 1')).toEqual({ result: 'exists' })
    expect(options.recordKeys()).toEqual([{ record: 'mb', keys: ['r1', 'r2'], names: ['MB 1', 'MB 2'] }])

    expect(options.renameUiKey('/mb/keys', 'r1', 'MB A')).toBe('renamed')
    expect(options.renameUiKey('/mb/keys', 'r1', 'MB A')).toBe('unchanged')
    expect(options.renameUiKey('/mb/keys', 'r1', 'MB 2')).toBe('exists')
    expect(options.renameUiKey('/mb/keys', 'gone', 'X')).toBe('not-found')
    expect(options.renameUiKey('/vp/members', 'r1', 'X')).toBe('unknown')
    expect(options.uiRowName('/mb/keys', 'r1')).toBe('MB A')
    // 一覧から消したら、もう Name は引けない。ID は再採用をまたいで変わらない
    expect(options.removeUiKey('/mb/keys', 'r2')).toBe(true)
    options.setDefinition(withRecords([mb]))
    expect(options.uiKeyLists()).toEqual([{ address: '/mb/keys', rows: [{ id: 'r1', name: 'MB A' }] }])

    // 戻すときは空・重複(ID か Name)を除き、上限で切る
    options.restoreUiKeys([{ address: '/mb/keys', rows: [
      { id: 'a', name: 'A' }, { id: 'a', name: 'B' }, { id: 'c', name: 'A' }, { id: '', name: 'D' }, { id: 'e', name: '' },
      { id: 'f', name: 'F' }, { id: 'g', name: 'G' }, { id: 'h', name: 'H' },
    ] }])
    expect(options.uiKeyLists()[0]!.rows.map(row => row.id)).toEqual(['a', 'f', 'g'])
  })
})
