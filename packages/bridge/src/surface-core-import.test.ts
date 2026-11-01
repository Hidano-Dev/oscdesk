import { describe, expect, it, vi } from 'vitest'

import { SYS, type DownstreamFrame, type SurfaceDefinition } from '@oscdesk/shared'

import type { PersistedDesired } from './desired-values'
import { createSurfaceCore, type BridgeConfig } from './surface-core'

// プロジェクトの取り込み(D-090)。保持値を置き換えるが Unity へは送らず、全宛先への resend まで自動の再送を止める

const BRIDGE_CONFIG: BridgeConfig = {
  unity: { name: 'unity', host: '127.0.0.1', sendPort: 9000, secondary: [] },
  bridge: { oscListenHost: '0.0.0.0', oscListenPort: 9001, wsHost: '0.0.0.0', wsPort: 8080 },
  ui: { host: '0.0.0.0', port: 8080 },
  debug: false,
  boolFallbackToInt: false,
  diagnostics: { ringBufferSize: 200, lossRateWindow: 30, ndjsonDir: 'logs/diagnostics', ndjsonMaxTotalBytes: 52_428_800 },
  oscUi: { enabled: false, staticPeers: [], peerTtlMs: 0 },
  surfaces: { dir: 'surfaces' },
  destinations: { scanTimeoutMs: 8_000 },
  network: {},
}

const DEFINITION: SurfaceDefinition = {
  format: 'oscdesk-surface',
  version: 1,
  name: 'T',
  parameters: [
    { id: 'level', address: '/light/level', label: 'Level', type: 'f', kind: 'state', range: [0, 1], default: 0.5 },
    { id: 'mode', address: '/light/mode', label: 'Mode', type: 's', kind: 'state', options: ['a', 'b'], default: 'a' },
  ],
  records: [
    {
      id: 'member', address: '/vp/member', label: 'Member', kind: 'state',
      keysFrom: { address: '/vp/members/list' },
      fields: [{ id: 'active', label: 'Active', type: 'bool', default: false }],
    },
    {
      id: 'mb', address: '/mb/row', label: 'MB', kind: 'state',
      keysFrom: { address: '/mb/rows', source: 'ui' },
      fields: [{ id: 'port', label: 'Port', type: 'i', default: 1 }],
    },
  ],
  screens: [],
}

const IMPORTED: PersistedDesired = {
  values: [{ id: 'level', address: '/light/level', type: 'f', args: [{ type: 'f', value: 0.875 }] }],
  records: [
    // Unity の一覧にまだ無いキーの行も捨てずに持つ(後でそのキーが届いたら使う)
    { id: 'member', address: '/vp/member', key: 'Absent', fields: [{ id: 'active', type: 'bool', arg: { type: 'i', value: 1 } }] },
    { id: 'mb', address: '/mb/row', key: 'row-1', fields: [{ id: 'port', type: 'i', arg: { type: 'i', value: 7 } }] },
  ],
  keyLists: [{ address: '/mb/rows', rows: [{ id: 'row-1', name: 'MB 1' }] }],
}

const UNITY = { host: '127.0.0.1', port: 9000 }

// 定義名ごとのファイルを Map で持つ store(採用の切り替えで印がどのファイルに残るかを見る)
function setupWithFiles(files: Map<string, PersistedDesired>) {
  return setup(null, {
    load: vi.fn((name: string) => files.get(name) ?? null),
    save: vi.fn((name: string, values: PersistedDesired) => { files.set(name, values) }),
    unsentSince: (name: string) => files.get(name)?.unsentSince,
  })
}

function setup(saved: PersistedDesired | null = null, fileStore?: {
  load: (name: string) => PersistedDesired | null
  save: (name: string, values: PersistedDesired) => void
  unsentSince: (name: string) => string | undefined
}) {
  let tick: (() => void) | undefined
  let clock = 1_000
  const store = fileStore ?? { load: vi.fn((_name: string) => saved), save: vi.fn(), unsentSince: (_name: string) => saved?.unsentSince }
  const sendFn = vi.fn()
  const publish = vi.fn<(frame: DownstreamFrame, target?: string) => void>()
  const core = createSurfaceCore({
    config: BRIDGE_CONFIG, sendFn, publish, desiredValuesStore: store,
    setIntervalFn: vi.fn((callback: () => void) => { tick = callback; return 1 as never }),
    now: () => clock,
    logInfo: vi.fn(), logWarn: vi.fn(),
  })
  core.start()
  let seq = 1
  const pong = () => {
    tick?.()
    core.handleOscIn({ address: SYS.PONG, args: [{ type: 'i', value: seq++ }], from: UNITY })
  }
  const sentValues = () => sendFn.mock.calls.filter(call => call[2] !== SYS.PING).map(call => [call[2], ...call.slice(3)])
  const statusFrames = () => publish.mock.calls.map(call => call[0]).filter(frame => frame.type === 'desiredStatus')
  return { core, sendFn, publish, store, pong, sentValues, statusFrames, advance: (ms: number) => { clock += ms } }
}

describe('importing a project into the held values (D-090)', () => {
  it('replaces the held values without sending anything to a reachable Unity', () => {
    const { core, publish, sendFn, pong, sentValues, statusFrames } = setup()
    core.setDefinition(DEFINITION, 'stage')
    pong()
    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/light/mode', args: [{ type: 's', value: 'b' }] }, 'ui-1')
    sendFn.mockClear(); publish.mockClear()

    core.setDefinition(DEFINITION, 'stage', IMPORTED)

    expect(sentValues()).toEqual([])
    // プロジェクトに無い mode は取り込み前の値でなく default に戻る
    expect(publish).toHaveBeenCalledWith({
      v: 1, type: 'desired', full: true, values: [
        { address: '/light/level', args: [{ type: 'f', value: 0.875 }] },
        { address: '/light/mode', args: [{ type: 's', value: 'a' }] },
        { address: '/vp/member', args: [{ type: 's', value: 'Absent' }, { type: 'i', value: 1 }] },
        { address: '/mb/row', args: [{ type: 's', value: 'row-1' }, { type: 's', value: 'MB 1' }, { type: 'i', value: 7 }] },
      ],
    }, undefined)
    expect(statusFrames().at(-1)).toEqual({ v: 1, type: 'desiredStatus', unsent: true, since: new Date(1_000).toISOString() })
  })

  it('holds back automatic resends until a resend to every target is requested', () => {
    const { core, sendFn, pong, sentValues, statusFrames, store } = setup()
    core.setDefinition(DEFINITION, 'stage', IMPORTED)
    pong() // 初回の到達でも送らない
    expect(sentValues()).toEqual([])
    expect(store.save).toHaveBeenLastCalledWith('stage', expect.objectContaining({ unsentSince: new Date(1_000).toISOString() }))

    core.handleUiFrame({ v: 1, type: 'resend', target: 'unity' }, 'ui-1')
    expect(sentValues().length).toBeGreaterThan(0)
    // 宛先を絞った再送では他の台に届いたことにならないので、印は残る
    expect(statusFrames().at(-1)).toMatchObject({ unsent: true })

    sendFn.mockClear()
    core.handleUiFrame({ v: 1, type: 'resend' }, 'ui-1')
    expect(sentValues()).toEqual([
      ['/mb/rows', { type: 's', value: 'row-1' }],
      ['/light/level', { type: 'f', value: 0.875 }],
      ['/light/mode', { type: 's', value: 'a' }],
      ['/vp/member', { type: 's', value: 'Absent' }, { type: 'i', value: 1 }],
      ['/mb/row', { type: 's', value: 'row-1' }, { type: 's', value: 'MB 1' }, { type: 'i', value: 7 }],
    ])
    expect(statusFrames().at(-1)).toEqual({ v: 1, type: 'desiredStatus', unsent: false, since: null })
    const lastSaved = vi.mocked(store.save).mock.calls.at(-1)?.[1] as PersistedDesired
    expect(lastSaved.unsentSince).toBeUndefined()
  })

  it('resumes automatic resends once the imported values were sent', () => {
    const { core, sendFn, pong, sentValues } = setup()
    core.setDefinition(DEFINITION, 'stage', IMPORTED)
    core.handleUiFrame({ v: 1, type: 'resend' }, 'ui-1')
    sendFn.mockClear()
    pong()
    expect(sentValues()).toContainEqual(['/light/level', { type: 'f', value: 0.875 }])
  })

  it('keeps holding back resends after a bridge restart while the file says unsent', () => {
    const { core, pong, sentValues, statusFrames } = setup({ ...IMPORTED, unsentSince: '2026-10-28T00:00:00.000Z' })
    core.setDefinition(DEFINITION, 'stage')
    pong()
    expect(sentValues()).toEqual([])
    expect(statusFrames().at(-1)).toEqual({ v: 1, type: 'desiredStatus', unsent: true, since: '2026-10-28T00:00:00.000Z' })
  })

  it('still sends what the operator changes after an import', () => {
    const { core, pong, sentValues } = setup()
    core.setDefinition(DEFINITION, 'stage', IMPORTED)
    pong()
    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/light/level', args: [{ type: 'f', value: 0.25 }] }, 'ui-1')
    expect(sentValues()).toEqual([['/light/level', { type: 'f', value: 0.25 }]])
  })

  it('drops UI-managed rows that the project does not have', () => {
    const { core, publish } = setup()
    core.setDefinition(DEFINITION, 'stage')
    core.handleUiFrame({ v: 1, type: 'recordKeyAdd', record: 'mb', key: 'Local' }, 'ui-1')
    publish.mockClear()
    core.setDefinition(DEFINITION, 'stage', { ...IMPORTED, keyLists: [] , records: IMPORTED.records.filter(row => row.id !== 'mb') })
    const options = publish.mock.calls.map(call => call[0]).find(frame => frame.type === 'runtimeOptions')
    expect(options).toMatchObject({ keys: expect.arrayContaining([{ record: 'mb', keys: [], names: [] }]) })
  })

  it('does not spread the mark or the unsent values to another definition, and keeps it in the imported one', () => {
    const files = new Map<string, PersistedDesired>()
    const { core, pong, sentValues, statusFrames } = setupWithFiles(files)
    core.setDefinition(DEFINITION, 'stage', IMPORTED)
    pong()
    core.setDefinition(DEFINITION, 'other')
    // 別の定義へは送っていない値を引き継がない(other のファイルが無いので default)。印も移さない
    expect(files.get('other')?.unsentSince).toBeUndefined()
    expect(files.get('other')?.values).toContainEqual({ id: 'level', address: '/light/level', type: 'f', args: [{ type: 'f', value: 0.5 }] })
    expect(files.get('stage')?.unsentSince).toBe(new Date(1_000).toISOString())
    expect(statusFrames().at(-1)).toMatchObject({ unsent: false })
    // other では送ってよい(取り込んだ値ではない)。送っても stage の印は消えない
    core.handleUiFrame({ v: 1, type: 'resend' }, 'ui-1')
    expect(files.get('stage')?.unsentSince).toBe(new Date(1_000).toISOString())
    expect(sentValues()).not.toContainEqual(['/light/level', { type: 'f', value: 0.875 }])
  })

  it('brings the unsent mark and values back when the imported definition is adopted again later', () => {
    const files = new Map<string, PersistedDesired>()
    const { core, pong, sentValues, statusFrames, sendFn } = setupWithFiles(files)
    core.setDefinition(DEFINITION, 'stage', IMPORTED)
    core.setDefinition(DEFINITION, 'other')
    core.handleUiFrame({ v: 1, type: 'osc.message', address: '/light/level', args: [{ type: 'f', value: 0.1 }] }, 'ui-1')
    sendFn.mockClear()
    core.setDefinition(DEFINITION, 'stage')
    pong()
    expect(sentValues()).toEqual([])
    expect(statusFrames().at(-1)).toMatchObject({ unsent: true })
    expect(core.exportDesired().values).toContainEqual({ id: 'level', address: '/light/level', type: 'f', args: [{ type: 'f', value: 0.875 }] })
  })

  it('creates but does not send rows for newly listed keys while unsent, and sends rows the operator adds', () => {
    const { core, pong, sentValues, publish } = setup()
    core.setDefinition(DEFINITION, 'stage', IMPORTED)
    pong()
    core.handleOscIn({ address: '/vp/members/list', args: [{ type: 's', value: 'New' }], from: UNITY })
    expect(sentValues().filter(call => call[0] === '/vp/member')).toEqual([])
    const partial = publish.mock.calls.map(call => call[0]).filter(frame => frame.type === 'desired' && !frame.full)
    expect(partial).toEqual([
      { v: 1, type: 'desired', full: false, values: [{ address: '/vp/member', args: [{ type: 's', value: 'New' }, { type: 'i', value: 0 }] }] },
    ])
    core.handleUiFrame({ v: 1, type: 'recordKeyAdd', record: 'mb', key: 'MB 2' }, 'ui-1')
    expect(sentValues().filter(call => call[0] === '/mb/row')).toHaveLength(1)
  })

  it('holds back list requests (automatic and from the UI) until the imported values are sent', () => {
    const withRequest: SurfaceDefinition = {
      ...DEFINITION,
      records: DEFINITION.records!.map(record => record.id === 'member'
        ? { ...record, keysFrom: { address: '/vp/members/list', request: '/cue/go' } }
        : record),
    }
    const { core, publish, pong, sentValues } = setup()
    pong()
    core.setDefinition(withRequest, 'stage', IMPORTED)
    pong()
    core.handleUiFrame({ v: 1, type: 'runtimeOptionsRefresh' }, 'ui-1')
    core.handleUiFrame({ v: 1, type: 'runtimeOptionsRefresh', request: '/cue/go' }, 'ui-1')
    expect(sentValues().filter(call => call[0] === '/cue/go')).toEqual([])
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'notice', code: 'runtime-options-refresh-rejected', detail: 'unsent-project' }), 'ui-1')
    core.handleUiFrame({ v: 1, type: 'resend' }, 'ui-1')
    expect(sentValues().filter(call => call[0] === '/cue/go')).toEqual([['/cue/go']])
  })

  it('does not send rows for keys Unity reports after a bridge restart while still unsent', () => {
    const { core, pong, sentValues } = setup({ ...IMPORTED, unsentSince: '2026-10-28T00:00:00.000Z' })
    core.setDefinition(DEFINITION, 'stage')
    pong()
    core.handleOscIn({ address: '/vp/members/list', args: [{ type: 's', value: 'new-key' }], from: UNITY })
    core.handleUiFrame({ v: 1, type: 'runtimeOptionsApply' }, 'ui-1')
    expect(sentValues()).toEqual([])
  })

  it('publishes the status even without an adopted definition', () => {
    const { core, publish } = setup()
    core.publishDesiredStatus('ui-1')
    expect(publish).toHaveBeenCalledWith({ v: 1, type: 'desiredStatus', unsent: false, since: null }, 'ui-1')
  })

  it('exports the held values with the UI-managed lists', () => {
    const { core } = setup()
    core.setDefinition(DEFINITION, 'stage', IMPORTED)
    expect(core.exportDesired()).toEqual({
      values: [
        { id: 'level', address: '/light/level', type: 'f', args: [{ type: 'f', value: 0.875 }] },
        { id: 'mode', address: '/light/mode', type: 's', args: [{ type: 's', value: 'a' }] },
      ],
      records: [
        { id: 'member', address: '/vp/member', key: 'Absent', fields: [{ id: 'active', type: 'bool', arg: { type: 'i', value: 1 } }] },
        { id: 'mb', address: '/mb/row', key: 'row-1', fields: [{ id: 'port', type: 'i', arg: { type: 'i', value: 7 } }] },
      ],
      keyLists: [{ address: '/mb/rows', rows: [{ id: 'row-1', name: 'MB 1' }] }],
    })
  })
})
