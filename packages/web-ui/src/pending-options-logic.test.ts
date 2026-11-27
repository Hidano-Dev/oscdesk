import { describe, expect, it } from 'vitest'

import type { SurfaceDefinition } from '@oscdesk/shared'

import { changeSummary, groupByList, listUsages, MAX_NAMES, sourceLabel, type PendingOptionList } from './pending-options-logic'

const item = (over: Partial<PendingOptionList> = {}): PendingOptionList => ({ list: 'members', target: 'unity', added: [], removed: [], ...over })

describe('pending options logic', () => {
  it('labels the source, with the host for a broadcast target', () => {
    expect(sourceLabel(item())).toBe('unity')
    expect(sourceLabel(item({ target: 'all-devices', host: '192.168.0.20' }))).toBe('all-devices(192.168.0.20)')
  })

  it('summarises added and removed names, and an order-only change', () => {
    expect(changeSummary(item({ added: ['C'], removed: ['B', ''] }))).toBe('unity の一覧が変わりました(追加: C / 削除: B、(空))')
    expect(changeSummary(item())).toBe('unity の一覧が変わりました(並び順だけが変わりました)')
    const many = Array.from({ length: MAX_NAMES + 3 }, (_, index) => `n${String(index)}`)
    expect(changeSummary(item({ added: many }))).toContain('n9 ほか 3 件')
  })

  it('groups by list, keeping the bridge order', () => {
    const groups = groupByList([item(), item({ list: 'scenes' }), item({ target: 'b' })])
    expect(groups.map((group) => [group.list, group.items.map((entry) => entry.target)])).toEqual([['members', ['unity', 'b']], ['scenes', ['unity']]])
  })

  it('names the controls that use the list', () => {
    const definition = {
      format: 'oscdesk-surface',
      version: 2,
      name: 'Stage',
      parameters: [
        { id: 'member', label: 'Member', kind: 'state', type: 's', optionsFrom: { list: 'members' } },
        { id: 'level', label: 'Level', kind: 'state', type: 'f', range: [0, 1] },
      ],
      records: [{
        id: 'mb',
        label: 'MB',
        kind: 'state',
        keysFrom: { list: 'members' },
        fields: [{ id: 'who', label: 'Who', type: 's', optionsFrom: { list: 'members' } }],
      }],
      screens: [],
    } as unknown as SurfaceDefinition
    expect(listUsages(definition, 'members')).toEqual(['Member の選択肢', 'MB の行', 'MB の Who の選択肢'])
    expect(listUsages(definition, 'other')).toEqual([])
    expect(listUsages(null, 'members')).toEqual([])
  })
})
