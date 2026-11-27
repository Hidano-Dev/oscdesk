import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { migrateOscPadV1, OSC_PAD, PadDocumentStoredSchema, upgradePadDocument, type DownstreamFrame, type OscPad, type UpstreamFrame } from '@oscdesk/shared'

import { createPadActiveFile } from '../adapters/pad-active-file'
import { createNamedJsonStore } from '../adapters/surface-store'
import { createPadManager, type FirePad } from './pad-manager'
import { createPadResendSettings } from './pad-resend'
import type { PersistedPadValues } from './pad-values'

const PAD: OscPad = {
  format: 'oscdesk-pad',
  version: 1,
  rows: 2,
  columns: 2,
  buttons: [
    { id: 'b1', row: 0, column: 0, label: 'Fire', address: '/fx/fire', args: [{ type: 'i', value: 1 }, { type: 's', value: 'A' }] },
  ],
}

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-pads-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

function setup(fire: FirePad = vi.fn<FirePad>(() => ({ ok: true }))) {
  const publish = vi.fn<(frame: DownstreamFrame, target?: string) => void>()
  const logWarn = vi.fn()
  const store = createNamedJsonStore({ dir, schema: PadDocumentStoredSchema, upgrade: upgradePadDocument, logInfo: vi.fn() })
  const activeStore = createPadActiveFile({ dir, fs, logWarn })
  // epoch はブリッジの起動ごとに変わる値。create のたびに別の起動として扱う
  let starts = 0
  const create = (epoch = `run${String(++starts)}`) => createPadManager({
    store, activeStore, publish, fire, logWarn, logInfo: vi.fn(), now: () => Date.UTC(2026, 9, 18, 10, 0, 0), epoch,
  })
  return { manager: create(), create, publish, store, fire, logWarn }
}

const types = (publish: ReturnType<typeof setup>['publish']) => publish.mock.calls.map(([frame, target]) => [frame.type, target])
// 採用のたびに配るフレーム(版 2 の全体・版 1 の写し・一覧・保持値の全量。D-169)
const ADOPTED = [['osc.padDocument', undefined], ['osc.pad', undefined], ['osc.padList', undefined], ['osc.padValues', undefined]]

describe('createPadManager', () => {
  it('answers a request with only the list while no pad is adopted', () => {
    const { manager, publish } = setup()
    manager.start()
    expect(manager.handleUiFrame({ v: 1, type: 'osc.padRequest' }, 'c1')).toBe(true)
    expect(publish.mock.calls).toEqual([[{ v: 1, type: 'osc.padList', names: [], active: null }, 'c1']])
  })

  it('saves, adopts and broadcasts a pad, bumping the revision on each save', () => {
    const { manager, publish } = setup()
    manager.handleUiFrame({ v: 1, type: 'osc.padSave', name: 'take-01', pad: PAD }, 'c1')
    manager.handleUiFrame({ v: 1, type: 'osc.padSave', name: 'take-01', pad: PAD }, 'c1')
    expect(types(publish)).toEqual([...ADOPTED, ...ADOPTED])
    expect(publish.mock.calls[5][0]).toMatchObject({ type: 'osc.pad', name: 'take-01', revision: 2, version: 'run1-2', at: '2026-10-18T10:00:00.000Z', pad: PAD })
    expect(publish.mock.calls[4][0]).toMatchObject({ type: 'osc.padDocument', name: 'take-01', revision: 2, version: 'run1-2', pad: migrateOscPadV1(PAD) })
    expect(publish.mock.calls[6][0]).toEqual({ v: 1, type: 'osc.padList', names: ['take-01'], active: 'take-01' })
    expect(publish.mock.calls[7][0]).toEqual({ v: 1, type: 'osc.padValues', name: 'take-01', version: 'run1-2', full: true, widgets: [], rows: [] })
  })

  it('answers an edit command to the requester only, without saving or adopting anything (D-126)', () => {
    const { manager, publish, store } = setup()
    const draft = PAD as unknown as Record<string, unknown>
    manager.handleUiFrame({ v: 1, type: 'osc.padEdit', requestId: 'p1', draft, edit: { op: 'setLabel', button: 'b1', label: 'Go' } }, 'c1')
    manager.handleUiFrame({ v: 1, type: 'osc.padEdit', requestId: 'p2', draft, edit: { op: 'removeButton', button: 'zz' } }, 'c1')
    expect(types(publish)).toEqual([['osc.padEdited', 'c1'], ['osc.padEdited', 'c1']])
    expect(publish.mock.calls[0]?.[0]).toMatchObject({ requestId: 'p1', result: { ok: true, pad: { buttons: [{ id: 'b1', label: 'Go' }] } } })
    expect(publish.mock.calls[1]?.[0]).toEqual({ v: 1, type: 'osc.padEdited', requestId: 'p2', result: { ok: false, detail: 'ボタン zz がありません' } })
    expect(store.list()).toEqual([])
    expect(manager.active()).toBeNull()
  })

  it('answers instead of throwing when a pad edit fails unexpectedly', () => {
    const { manager, publish, logWarn } = setup()
    // 想定外の例外(ここでは読むと投げる作業コピー)でブリッジごと落ちないこと
    const draft = { get format(): never { throw new Error('boom') } } as unknown as Record<string, unknown>
    expect(() => manager.handleUiFrame({ v: 1, type: 'osc.padEdit', requestId: 'p3', draft, edit: { op: 'resize', rows: 1, columns: 1 } }, 'c1')).not.toThrow()
    expect(publish.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'osc.padEdited', requestId: 'p3', result: { ok: false, detail: '編集できませんでした: boom' } })
    expect(logWarn).toHaveBeenCalled()
  })

  it('keeps the previous pad and tells only the sender why a save was refused', () => {
    const { manager, publish, store } = setup()
    manager.handleUiFrame({ v: 1, type: 'osc.padSave', name: 'take-01', pad: PAD }, 'c1')
    publish.mockClear()

    const bad = { ...PAD, buttons: [{ ...PAD.buttons[0]!, address: '/sys/ping' }] }
    manager.handleUiFrame({ v: 1, type: 'osc.padSave', name: 'take-01', pad: bad }, 'c2')
    expect(publish.mock.calls).toHaveLength(1)
    expect(publish.mock.calls[0]).toEqual([expect.objectContaining({ type: 'notice', level: 'error', code: 'pad-rejected' }), 'c2'])
    expect(store.read('take-01')).toMatchObject({ ok: true, value: migrateOscPadV1(PAD) })
  })

  it('restores the last adopted pad after a restart', () => {
    const { manager, create, publish } = setup()
    manager.handleUiFrame({ v: 1, type: 'osc.padSave', name: 'take-01', pad: PAD }, 'c1')
    manager.handleUiFrame({ v: 1, type: 'osc.padSave', name: 'take-02', pad: { ...PAD, rows: 3 } }, 'c1')
    manager.handleUiFrame({ v: 1, type: 'osc.padLoad', name: 'take-01' }, 'c1')
    publish.mockClear()

    const restarted = create()
    restarted.start()
    publish.mockClear()
    restarted.handleUiFrame({ v: 1, type: 'osc.padRequest' }, 'c9')
    expect(publish.mock.calls).toEqual([
      [{ v: 1, type: 'osc.padList', names: ['take-01', 'take-02'], active: 'take-01' }, 'c9'],
      [expect.objectContaining({ type: 'osc.pad', name: 'take-01', revision: 1, version: 'run2-1', pad: PAD }), 'c9'],
    ])
  })

  it('warns when the selection file exists but cannot be read, and stays silent when it is absent', () => {
    const absent = setup()
    absent.manager.start()
    expect(absent.logWarn).not.toHaveBeenCalled()

    fs.mkdirSync(path.join(dir, '.active.json'))
    const unreadable = setup()
    unreadable.manager.start()
    expect(unreadable.logWarn).toHaveBeenCalledWith('(WARN, BRIDGE)', expect.stringContaining('Failed to read pad selection file'), expect.anything())
  })

  it('starts without a pad when the selection file is broken or names a missing pad', () => {
    fs.writeFileSync(path.join(dir, '.active.json'), '{ broken')
    const broken = setup()
    broken.manager.start()
    expect(broken.logWarn).toHaveBeenCalled()

    fs.writeFileSync(path.join(dir, '.active.json'), JSON.stringify({ format: 'oscdesk-pad-active', active: 'gone' }))
    const missing = setup()
    missing.manager.start()
    expect(missing.logWarn).toHaveBeenCalledWith('(WARN, BRIDGE)', expect.stringContaining('pad "gone" not found'))
    missing.manager.handleUiFrame({ v: 1, type: 'osc.padRequest' }, 'c1')
    expect(types(missing.publish)).toEqual([['osc.padList', 'c1']])
  })

  it('rejects loading a missing pad', () => {
    const { manager, publish } = setup()
    manager.handleUiFrame({ v: 1, type: 'osc.padLoad', name: 'nope' }, 'c1')
    expect(publish.mock.calls[0]).toEqual([expect.objectContaining({ type: 'notice', code: 'pad-rejected' }), 'c1'])
  })

  it('fires the stored address and arguments of the pressed button', () => {
    const fire = vi.fn<FirePad>(() => ({ ok: true }))
    const { manager, publish } = setup(fire)
    manager.handleUiFrame({ v: 1, type: 'osc.padSave', name: 'take-01', pad: PAD }, 'c1')
    publish.mockClear()

    expect(manager.handleUiFrame({ v: 1, type: 'osc.padPress', name: 'take-01', version: 'run1-1', button: 'b1' }, 'c1')).toBe(true)
    expect(fire).toHaveBeenCalledWith('/fx/fire', [{ type: 'i', value: 1 }, { type: 's', value: 'A' }], 'pad')
    expect(publish).not.toHaveBeenCalled()
  })

  it('refuses presses from a stale pad, for unknown buttons and when the core refuses to send', () => {
    const fire = vi.fn<FirePad>(() => ({ ok: false, reason: 'option-list-address: /fx/fire' }))
    const { manager, publish } = setup(fire)
    manager.handleUiFrame({ v: 1, type: 'osc.padPress', name: 'take-01', version: 'run1-1', button: 'b1' }, 'c1')
    manager.handleUiFrame({ v: 1, type: 'osc.padSave', name: 'take-01', pad: PAD }, 'c1')
    publish.mockClear()

    manager.handleUiFrame({ v: 1, type: 'osc.padPress', name: 'take-02', version: 'run1-1', button: 'b1' }, 'c1')
    manager.handleUiFrame({ v: 1, type: 'osc.padPress', name: 'take-01', version: 'run1-1', button: 'zz' }, 'c1')
    manager.handleUiFrame({ v: 1, type: 'osc.padPress', name: 'take-01', version: 'run1-1', button: 'b1' }, 'c1')
    expect(publish.mock.calls.map(([frame, target]) => [frame.type === 'notice' && frame.detail, target])).toEqual([
      ['stale-pad: take-02@run1-1', 'c1'],
      ['unknown-button: zz', 'c1'],
      ['option-list-address: /fx/fire', 'c1'],
    ])
    expect(fire).toHaveBeenCalledTimes(1)
  })

  it('refuses a press from the previous version after the same name was saved over', () => {
    const fire = vi.fn<FirePad>(() => ({ ok: true }))
    const { manager, publish } = setup(fire)
    manager.handleUiFrame({ v: 1, type: 'osc.padSave', name: 'take-01', pad: PAD }, 'c1')
    const changed = { ...PAD, buttons: [{ ...PAD.buttons[0]!, address: '/fx/other' }] }
    manager.handleUiFrame({ v: 1, type: 'osc.padSave', name: 'take-01', pad: changed }, 'c2')
    publish.mockClear()

    manager.handleUiFrame({ v: 1, type: 'osc.padPress', name: 'take-01', version: 'run1-1', button: 'b1' }, 'c1')
    expect(fire).not.toHaveBeenCalled()
    expect(publish.mock.calls[0]).toEqual([expect.objectContaining({ code: 'pad-press-rejected', detail: 'stale-pad: take-01@run1-1' }), 'c1'])

    manager.handleUiFrame({ v: 1, type: 'osc.padPress', name: 'take-01', version: 'run1-2', button: 'b1' }, 'c1')
    expect(fire).toHaveBeenCalledWith('/fx/other', PAD.buttons[0]!.args, 'pad')
  })

  it('refuses a press from a page drawn before a bridge restart, even though revisions start over', () => {
    const fire = vi.fn<FirePad>(() => ({ ok: true }))
    const { manager, create, publish } = setup(fire)
    manager.handleUiFrame({ v: 1, type: 'osc.padSave', name: 'take-01', pad: PAD }, 'c1')
    const before = publish.mock.calls.map(([frame]) => frame).find(frame => frame.type === 'osc.pad')
    expect(before).toMatchObject({ revision: 1, version: 'run1-1' })

    // 再起動後に別の内容で上書き保存すると、revision はまた 1 になるが版の印は違う
    const restarted = create()
    restarted.start()
    restarted.handleUiFrame({ v: 1, type: 'osc.padSave', name: 'take-01', pad: { ...PAD, buttons: [{ ...PAD.buttons[0]!, address: '/fx/new' }] } }, 'c2')
    publish.mockClear()

    restarted.handleUiFrame({ v: 1, type: 'osc.padPress', name: 'take-01', version: 'run1-1', button: 'b1' }, 'c1')
    expect(fire).not.toHaveBeenCalled()
    expect(publish.mock.calls[0]).toEqual([expect.objectContaining({ code: 'pad-press-rejected', detail: 'stale-pad: take-01@run1-1' }), 'c1'])
    restarted.handleUiFrame({ v: 1, type: 'osc.padPress', name: 'take-01', version: 'run2-2', button: 'b1' }, 'c1')
    expect(fire).toHaveBeenCalledWith('/fx/new', PAD.buttons[0]!.args, 'pad')
  })

  it('uses a random epoch per bridge instance by default', () => {
    const versionOfFirstSave = () => {
      const frames: DownstreamFrame[] = []
      const manager = createPadManager({
        store: createNamedJsonStore({ dir, schema: PadDocumentStoredSchema, upgrade: upgradePadDocument, logInfo: vi.fn() }), activeStore: createPadActiveFile({ dir, fs }),
        publish: frame => frames.push(frame), fire: vi.fn(), logInfo: vi.fn(), logWarn: vi.fn(),
      })
      manager.handleUiFrame({ v: 1, type: 'osc.padSave', name: 'take-01', pad: PAD }, 'c1')
      const frame = frames.find(item => item.type === 'osc.pad')
      return frame?.type === 'osc.pad' ? frame.version : ''
    }
    const [first, second] = [versionOfFirstSave(), versionOfFirstSave()]
    expect(first).toMatch(/^[0-9a-f]{12}-1$/)
    expect(second).not.toBe(first)
  })
  it('refuses to save a pad whose JSON exceeds the size limit and does not adopt one at startup', () => {
    // 1 つずつは正しい(文字列 1,024 文字 × 16 個、画像は合計 4 MiB まで)ボタンを 144 個並べ、JSON を上限より大きくする
    const image = `data:image/png;base64,${'AAAA'.repeat(Math.floor(OSC_PAD.MAX_IMAGE_BYTES / 3))}`
    const imageCount = OSC_PAD.MAX_TOTAL_IMAGE_BYTES / OSC_PAD.MAX_IMAGE_BYTES
    const big: OscPad = {
      ...PAD,
      rows: 12,
      columns: 12,
      buttons: Array.from({ length: 144 }, (_, index) => ({
        id: `b${String(index)}`, row: Math.floor(index / 12), column: index % 12, label: '', address: '/x',
        ...(index < imageCount ? { image } : {}),
        args: Array.from({ length: OSC_PAD.MAX_ARGS }, () => ({ type: 's' as const, value: 'あ'.repeat(OSC_PAD.MAX_STRING_ARG_CHARS) })),
      })),
    }
    const { manager, create, publish, logWarn } = setup()
    manager.handleUiFrame({ v: 1, type: 'osc.padSave', name: 'big', pad: big }, 'c1')
    expect(publish.mock.calls).toEqual([[expect.objectContaining({ code: 'pad-rejected', detail: expect.stringContaining('bytes as JSON') }), 'c1']])
    expect(fs.existsSync(path.join(dir, 'big.json'))).toBe(false)

    // 上限の導入前などに保存された大きなパッドが選ばれていても、起動時に採用しない
    fs.writeFileSync(path.join(dir, 'big.json'), JSON.stringify(big))
    fs.writeFileSync(path.join(dir, '.active.json'), JSON.stringify({ format: 'oscdesk-pad-active', active: 'big' }))
    const restarted = create()
    restarted.start()
    expect(logWarn).toHaveBeenCalledWith('(WARN, BRIDGE)', expect.stringContaining('bytes as JSON'))
    publish.mockClear()
    restarted.handleUiFrame({ v: 1, type: 'osc.padRequest' }, 'c2')
    expect(publish.mock.calls.map(([frame]) => frame.type)).toEqual(['osc.padList'])
  })

  it('leaves other frame types to the caller', () => {
    const { manager } = setup()
    expect(manager.handleUiFrame({ v: 1, type: 'surfaceRequest' }, 'c1')).toBe(false)
  })
})

const V2 = {
  format: 'oscdesk-pad', version: 2, rows: 2, columns: 2,
  widgets: [
    { id: 'go', kind: 'button', row: 0, column: 0, label: 'Go', address: '/fx/go', args: [{ type: 'i', value: 1 }] },
    { id: 'level', kind: 'slider', row: 0, column: 1, label: 'Level', address: '/mixer/level', type: 'f', min: 0, max: 1 },
    { id: 'title', kind: 'text', row: 1, column: 0, label: 'Title', address: '/scene/title', type: 's', resend: false },
  ],
}

function setupV2(options: { auto?: boolean; locked?: string | null } = {}) {
  const publish = vi.fn<(frame: DownstreamFrame, target?: string) => void>()
  const fire = vi.fn<FirePad>(() => ({ ok: true }))
  const sync = vi.fn()
  const saved = new Map<string, PersistedPadValues>()
  const valuesStore = { load: (name: string) => saved.get(name) ?? null, save: (name: string, values: PersistedPadValues) => saved.set(name, values) }
  const resend = createPadResendSettings({ publish, logInfo: vi.fn() })
  if (options.auto === true) resend.handleUiFrame({ v: 1, type: 'osc.padResendSet', auto: true }, 'c0')
  const logWarn = vi.fn()
  let clock = Date.UTC(2026, 10, 27, 10, 0, 0)
  const store = createNamedJsonStore({ dir, schema: PadDocumentStoredSchema, upgrade: upgradePadDocument, logInfo: vi.fn() })
  const create = (epoch: string) => createPadManager({
    store, activeStore: createPadActiveFile({ dir, fs }), publish, fire, valuesStore, resend, sync,
    syncTargets: selection => selection.target === 'nope' ? { ok: false, reason: 'unknown-target: nope' } : { ok: true, targets: [{ name: 'unity', host: '10.0.0.1', port: 9000 }] },
    lockedBy: () => options.locked ?? null,
    logInfo: vi.fn(), logWarn, now: () => clock, epoch,
  })
  const manager = create('run1')
  manager.handleUiFrame({ v: 1, type: 'osc.padSave', name: 'live', pad: V2 }, 'c1')
  publish.mockClear()
  return { manager, create, publish, fire, sync, saved, logWarn, store, advance: (ms: number) => { clock += ms } }
}

const set = (widget: string, value: unknown, version = 'run1-1') =>
  ({ v: 1, type: 'osc.padSet', name: 'live', version, widget, value } as unknown as UpstreamFrame)
const noticeOf = (publish: ReturnType<typeof setupV2>['publish']) => publish.mock.calls.flatMap(([frame]) => frame.type === 'notice' ? [`${frame.code}: ${frame.detail}`] : [])

describe('pad held values and sync (D-169)', () => {
  it('sends a value widget to every target, holds it and broadcasts the change', () => {
    const { manager, fire, publish, saved } = setupV2()
    manager.handleUiFrame(set('level', 0.5), 'c1')
    expect(fire).toHaveBeenCalledWith('/mixer/level', [{ type: 'f', value: 0.5 }], 'ui')
    expect(publish.mock.calls).toEqual([[{ v: 1, type: 'osc.padValues', name: 'live', version: 'run1-1', full: false, widgets: [{ widget: 'level', value: 0.5 }], rows: [] }, undefined]])
    expect(saved.get('live')).toEqual({ widgets: [{ widget: 'level', address: '/mixer/level', value: 0.5 }], rows: [] })
  })

  it('refuses stale pads, bad values, locked widgets and values the core could not send, without holding them', () => {
    const locked = setupV2({ locked: '192.168.1.5' })
    locked.manager.handleUiFrame(set('level', 0.5), 'c1')
    expect(noticeOf(locked.publish)).toEqual(['locked: locked: level by 192.168.1.5'])
    expect(locked.fire).not.toHaveBeenCalled()

    const { manager, fire, publish, saved } = setupV2()
    manager.handleUiFrame(set('level', 0.5, 'old-1'), 'c1')
    manager.handleUiFrame(set('level', 3), 'c1')
    fire.mockReturnValueOnce({ ok: false, reason: 'option-list-address: /mixer/level' })
    manager.handleUiFrame(set('level', 0.5), 'c1')
    expect(noticeOf(publish)).toEqual([
      'pad-set-rejected: stale-pad: live@old-1',
      'pad-set-rejected: out-of-range: 3 (level)',
      'pad-set-rejected: option-list-address: /mixer/level',
    ])
    expect(saved.get('live')).toBeUndefined()
  })

  it('answers a document request with the list, the v2 pad, the held values and the resend setting', () => {
    const { manager, publish } = setupV2()
    manager.handleUiFrame(set('level', 0.25), 'c1')
    publish.mockClear()
    manager.handleUiFrame({ v: 1, type: 'osc.padDocumentRequest' }, 'c2')
    expect(types(publish)).toEqual([['osc.padList', 'c2'], ['osc.padDocument', 'c2'], ['osc.padValues', 'c2'], ['osc.padResend', 'c2']])
    expect(publish.mock.calls[2]?.[0]).toMatchObject({ full: true, widgets: [{ widget: 'level', value: 0.25 }] })
  })

  it('restores the held values of a pad after a bridge restart, and keeps them across a save of the same pad', () => {
    const { manager, create, publish } = setupV2()
    manager.handleUiFrame(set('level', 0.25), 'c1')
    manager.handleUiFrame({ v: 1, type: 'osc.padSave', name: 'live', pad: V2 }, 'c1')
    expect(publish.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'osc.padValues', full: true, version: 'run1-2', widgets: [{ widget: 'level', value: 0.25 }] })
    const restarted = create('run2')
    publish.mockClear()
    restarted.start()
    expect(publish.mock.calls.find(([frame]) => frame.type === 'osc.padValues')?.[0]).toMatchObject({ full: true, widgets: [{ widget: 'level', value: 0.25 }] })
  })

  it('drops held values that no longer fit after the pad changes', () => {
    const { manager, saved } = setupV2()
    manager.handleUiFrame(set('level', 0.25), 'c1')
    const moved = { ...V2, widgets: V2.widgets.map(widget => widget.id === 'level' ? { ...widget, address: '/mixer/other' } : widget) }
    manager.handleUiFrame({ v: 1, type: 'osc.padSave', name: 'live', pad: moved }, 'c1')
    expect(saved.get('live')).toEqual({ widgets: [], rows: [] })
  })

  it('syncs the widgets that are resent to the chosen targets and answers with the request id', () => {
    const { manager, sync, publish } = setupV2()
    manager.handleUiFrame(set('level', 0.25), 'c1')
    manager.handleUiFrame(set('title', 'A'), 'c1')
    publish.mockClear()
    manager.handleUiFrame({ v: 1, type: 'osc.padSync', target: 'unity', requestId: 'r1' }, 'c1')
    expect(sync).toHaveBeenCalledWith({ name: 'unity', host: '10.0.0.1', port: 9000 }, 'manual', expect.any(Function))
    // 値は送る段ごとに今の保持値から取る(同期の途中で操作された値も今の値で送る)
    const current = sync.mock.calls[0]?.[2] as () => unknown
    expect(current()).toEqual([{ address: '/mixer/level', args: [{ type: 'f', value: 0.25 }] }])
    manager.handleUiFrame(set('level', 0.75), 'c1')
    expect(current()).toEqual([{ address: '/mixer/level', args: [{ type: 'f', value: 0.75 }] }])
    expect(publish.mock.calls.filter(([frame]) => frame.type === 'notice')).toEqual([[{ v: 1, type: 'notice', level: 'info', code: 'pad-synced', detail: 'unity (10.0.0.1): 1 value(s)', requestId: 'r1' }, 'c1']])
    manager.handleUiFrame({ v: 1, type: 'osc.padSync', target: 'nope' }, 'c1')
    expect(noticeOf(publish).at(-1)).toBe('pad-sync-rejected: unknown-target: nope')
  })

  it('resends on a target start only while automatic resend is on', () => {
    const off = setupV2()
    off.manager.handleUiFrame(set('level', 0.25), 'c1')
    off.manager.onTargetStarted({ name: 'unity', host: '10.0.0.1', port: 9000 })
    expect(off.sync).not.toHaveBeenCalled()

    const on = setupV2({ auto: true })
    on.manager.handleUiFrame(set('level', 0.25), 'c1')
    on.manager.onTargetStarted({ name: 'unity', host: '10.0.0.1', port: 9000 })
    expect(on.sync).toHaveBeenCalledWith({ name: 'unity', host: '10.0.0.1', port: 9000 }, 'boot', expect.any(Function))
    expect((on.sync.mock.calls[0]?.[2] as () => unknown)()).toEqual([{ address: '/mixer/level', args: [{ type: 'f', value: 0.25 }] }])
  })

  it('publishes primary echoes in the widget vocabulary and warns once about a mismatch after the settle time', () => {
    const { manager, publish, logWarn, advance } = setupV2()
    manager.handleUiFrame(set('level', 0.25), 'c1')
    publish.mockClear()
    manager.handleEcho('/mixer/level', [{ type: 'f', value: 0.75 }], { name: 'unity', primary: true })
    expect(logWarn).not.toHaveBeenCalled()
    advance(2_000)
    manager.handleEcho('/mixer/level', [{ type: 'f', value: 0.75 }], { name: 'unity', primary: true })
    manager.handleEcho('/mixer/level', [{ type: 'f', value: 0.75 }], { name: 'unity', primary: true })
    expect(logWarn).toHaveBeenCalledTimes(1)
    manager.handleEcho('/mixer/level', [{ type: 'f', value: 0.75 }], { name: 'backup', primary: false })
    expect(logWarn).toHaveBeenCalledTimes(2)
    expect(types(publish)).toEqual([['osc.padEcho', undefined], ['osc.padEcho', undefined], ['osc.padEcho', undefined]])
    expect(publish.mock.calls[0]?.[0]).toEqual({ v: 1, type: 'osc.padEcho', version: 'run1-1', widgets: [{ widget: 'level', value: 0.75 }], rows: [] })
  })

  it('keeps the v1 view of a pad with value widgets to its buttons and refuses a v1 save over it', () => {
    const { manager, publish, store } = setupV2()
    manager.handleUiFrame({ v: 1, type: 'osc.padRequest' }, 'c1')
    expect(publish.mock.calls[1]?.[0]).toMatchObject({ type: 'osc.pad', pad: { version: 1, buttons: [{ id: 'go', address: '/fx/go' }] } })
    expect(manager.active()).toEqual({ name: 'live', pad: null })
    manager.handleUiFrame({ v: 1, type: 'osc.padSave', name: 'live', pad: PAD }, 'c1')
    expect(noticeOf(publish).at(-1)).toContain('has widgets that a version 1 pad cannot keep')
    expect(store.read('live')).toMatchObject({ ok: true, value: { version: 2, widgets: [{ id: 'go' }, { id: 'level' }, { id: 'title' }] } })
  })

  it('answers a v2 edit command to the requester only', () => {
    const { manager, publish } = setupV2()
    manager.handleUiFrame({ v: 1, type: 'osc.padDocumentEdit', requestId: 'e1', draft: V2 as unknown as Record<string, unknown>, edit: { op: 'removeWidget', widget: 'title' } } as UpstreamFrame, 'c1')
    expect(publish.mock.calls[0]?.[1]).toBe('c1')
    expect(publish.mock.calls[0]?.[0]).toMatchObject({ type: 'osc.padDocumentEdited', requestId: 'e1', result: { ok: true, pad: { widgets: [{ id: 'go' }, { id: 'level' }] } } })
  })

  it('knows the lock units of the adopted pad', () => {
    const { manager } = setupV2()
    expect(manager.isLockableRef({ widget: 'level' })).toBe(true)
    expect(manager.isLockableRef({ widget: 'go' })).toBe(false)
    expect(manager.isLockableRef({ param: 'level' })).toBe(false)
  })
})