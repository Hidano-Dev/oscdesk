// 主画面(HID-464)のテストの部品。定義をブリッジと同じ規則(shared の buildSurfaceView)で部品の木にして surface フレームを作る
// (木を手で書くと、ブリッジが配る木と食い違ったまま緑になる)。本体からは import しない
import { buildSurfaceView, DownstreamFrameSchema, SurfaceDefinitionSchema, type DownstreamFrame } from '@oscdesk/shared'

export const STAGE_DEFINITION = {
  format: 'oscdesk-surface',
  version: 2,
  name: 'Stage',
  parameters: [
    { id: 'master', label: 'Master', type: 'f', kind: 'state', range: [0, 1], default: 0.5 },
    { id: 'mute', label: 'Mute', type: 'bool', kind: 'state', default: false },
    { id: 'scene', label: 'Scene', type: 's', kind: 'state', options: ['A', 'B'], default: 'A' },
    { id: 'count', label: 'Count', type: 'i', kind: 'state', range: [0, 10], default: 3, widget: 'input' },
    { id: 'segment', label: 'Segment', type: 's', kind: 'state', options: ['(none)'], optionsFrom: { list: 'segments' }, default: '(none)' },
    { id: 'go', label: 'GO', type: 'i', kind: 'trigger', value: 1 },
    { id: 'part', label: 'Part', type: 'bool', kind: 'trigger', value: true, standalone: false },
    {
      id: 'tint', label: 'Tint', type: 'composite', kind: 'state', hint: 'color',
      fields: [
        { id: 'r', label: 'R', type: 'f', range: [0, 1], default: 1 },
        { id: 'g', label: 'G', type: 'f', range: [0, 1], default: 0 },
        { id: 'b', label: 'B', type: 'f', range: [0, 1], default: 0 },
      ],
    },
  ],
  records: [
    {
      id: 'member', label: 'Member', kind: 'state', key: { label: 'Name' }, keysFrom: { list: 'members', source: 'ui', max: 3 },
      fields: [
        { id: 'active', label: 'Active', type: 'bool', default: false },
        { id: 'slot', label: 'Slot', type: 'i', range: [1, 64], default: 1 },
      ],
    },
    { id: 'cue', label: 'Cue', kind: 'trigger', keysFrom: { list: 'cues' }, fields: [{ id: 'fire', label: 'Fire', type: 'i', value: 1 }] },
  ],
  actions: [
    { id: 'all', label: 'Send all', steps: [{ param: 'master' }, { param: 'mute' }, { param: 'go' }] },
    { id: 'on', label: 'On', scope: 'all', steps: [{ record: 'member', value: { active: true } }] },
    { id: 'off', label: 'Off', scope: 'all', steps: [{ record: 'member', value: { active: false } }] },
    { id: 'send', label: 'Send', scope: 'row', steps: [{ record: 'member' }] },
  ],
  screens: [
    {
      id: 'main', label: 'Main',
      children: [
        { kind: 'row', children: [{ kind: 'control', param: 'master', width: 8 }, { kind: 'control', param: 'mute', width: 4 }] },
        { kind: 'control', param: 'scene' },
        { kind: 'control', param: 'count' },
        { kind: 'control', param: 'segment' },
        { kind: 'group', label: 'Cue', collapsed: false, children: [{ kind: 'control', param: 'go' }, { kind: 'control', param: 'part' }] },
        { kind: 'control', param: 'tint' },
        { kind: 'action', action: 'all' },
        {
          kind: 'record', record: 'member', rowActions: ['send'], tableActions: ['on'],
          columns: [{ field: 'active', toggle: { label: 'All', on: 'on', off: 'off' } }, { field: 'slot', widget: 'input' }],
        },
      ],
    },
    { id: 'cues', label: 'Cues', children: [{ kind: 'record', record: 'cue' }] },
  ],
  bindings: {
    osc: {
      parameters: ['master', 'mute', 'scene', 'count', 'segment', 'go', 'part', 'tint'].map((id) => ({ id, address: `/p/${id}` })),
      records: [{ id: 'member', address: '/member' }, { id: 'cue', address: '/cue' }],
      lists: [{ id: 'members', address: '/members' }, { id: 'segments', address: '/segments', request: '/segments/get' }, { id: 'cues', address: '/cues' }],
    },
  },
} as const

/** 定義(結び付けを含む全体)から、ブリッジが配るのと同じ形の surface フレームを作る。 */
export function surfaceFrame(definition: unknown = STAGE_DEFINITION, revision = 1, name = 'stage'): Extract<DownstreamFrame, { type: 'surface' }> {
  const parsed = SurfaceDefinitionSchema.parse(definition)
  const { bindings, ...body } = parsed
  const frame = DownstreamFrameSchema.parse({
    v: 1, type: 'surface', name, revision, at: '2026-11-27T10:00:00.000Z', definition: body, bindings: bindings ?? {}, view: buildSurfaceView(parsed),
  })
  if (frame.type !== 'surface') throw new Error('not a surface frame')
  return frame
}
