import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OSC_PAD, OscPadStoredSchema, type DownstreamFrame, type OscPad } from '@oscdesk/shared'

import { createPadActiveFile, createPadManager, type FirePad } from './pad-manager'
import { createNamedJsonStore } from './surface-store'

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
  const store = createNamedJsonStore({ dir, schema: OscPadStoredSchema })
  const activeStore = createPadActiveFile({ dir, fs, logWarn })
  // epoch はブリッジの起動ごとに変わる値。create のたびに別の起動として扱う
  let starts = 0
  const create = (epoch = `run${String(++starts)}`) => createPadManager({
    store, activeStore, publish, fire, logWarn, logInfo: vi.fn(), now: () => Date.UTC(2026, 9, 18, 10, 0, 0), epoch,
  })
  return { manager: create(), create, publish, store, fire, logWarn }
}

const types = (publish: ReturnType<typeof setup>['publish']) => publish.mock.calls.map(([frame, target]) => [frame.type, target])

describe('createPadManager', () => {
  it('answers a request with only the list while no pad is adopted', () => {
    const { manager, publish } = setup()
    manager.start()
    expect(manager.handleUiFrame({ v: 1, type: 'padRequest' }, 'c1')).toBe(true)
    expect(publish.mock.calls).toEqual([[{ v: 1, type: 'padList', names: [], active: null }, 'c1']])
  })

  it('saves, adopts and broadcasts a pad, bumping the revision on each save', () => {
    const { manager, publish } = setup()
    manager.handleUiFrame({ v: 1, type: 'padSave', name: 'take-01', pad: PAD }, 'c1')
    manager.handleUiFrame({ v: 1, type: 'padSave', name: 'take-01', pad: PAD }, 'c1')
    expect(types(publish)).toEqual([['pad', undefined], ['padList', undefined], ['pad', undefined], ['padList', undefined]])
    expect(publish.mock.calls[2][0]).toMatchObject({ type: 'pad', name: 'take-01', revision: 2, version: 'run1-2', at: '2026-10-18T10:00:00.000Z', pad: PAD })
    expect(publish.mock.calls[3][0]).toEqual({ v: 1, type: 'padList', names: ['take-01'], active: 'take-01' })
  })

  it('keeps the previous pad and tells only the sender why a save was refused', () => {
    const { manager, publish, store } = setup()
    manager.handleUiFrame({ v: 1, type: 'padSave', name: 'take-01', pad: PAD }, 'c1')
    publish.mockClear()

    const bad = { ...PAD, buttons: [{ ...PAD.buttons[0]!, address: '/sys/ping' }] }
    manager.handleUiFrame({ v: 1, type: 'padSave', name: 'take-01', pad: bad }, 'c2')
    expect(publish.mock.calls).toHaveLength(1)
    expect(publish.mock.calls[0]).toEqual([expect.objectContaining({ type: 'notice', level: 'error', code: 'pad-rejected' }), 'c2'])
    expect(store.read('take-01')).toMatchObject({ ok: true, value: PAD })
  })

  it('restores the last adopted pad after a restart', () => {
    const { manager, create, publish } = setup()
    manager.handleUiFrame({ v: 1, type: 'padSave', name: 'take-01', pad: PAD }, 'c1')
    manager.handleUiFrame({ v: 1, type: 'padSave', name: 'take-02', pad: { ...PAD, rows: 3 } }, 'c1')
    manager.handleUiFrame({ v: 1, type: 'padLoad', name: 'take-01' }, 'c1')
    publish.mockClear()

    const restarted = create()
    restarted.start()
    publish.mockClear()
    restarted.handleUiFrame({ v: 1, type: 'padRequest' }, 'c9')
    expect(publish.mock.calls).toEqual([
      [{ v: 1, type: 'padList', names: ['take-01', 'take-02'], active: 'take-01' }, 'c9'],
      [expect.objectContaining({ type: 'pad', name: 'take-01', revision: 1, version: 'run2-1', pad: PAD }), 'c9'],
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
    missing.manager.handleUiFrame({ v: 1, type: 'padRequest' }, 'c1')
    expect(types(missing.publish)).toEqual([['padList', 'c1']])
  })

  it('rejects loading a missing pad', () => {
    const { manager, publish } = setup()
    manager.handleUiFrame({ v: 1, type: 'padLoad', name: 'nope' }, 'c1')
    expect(publish.mock.calls[0]).toEqual([expect.objectContaining({ type: 'notice', code: 'pad-rejected' }), 'c1'])
  })

  it('fires the stored address and arguments of the pressed button', () => {
    const fire = vi.fn<FirePad>(() => ({ ok: true }))
    const { manager, publish } = setup(fire)
    manager.handleUiFrame({ v: 1, type: 'padSave', name: 'take-01', pad: PAD }, 'c1')
    publish.mockClear()

    expect(manager.handleUiFrame({ v: 1, type: 'padPress', name: 'take-01', version: 'run1-1', button: 'b1' }, 'c1')).toBe(true)
    expect(fire).toHaveBeenCalledWith('/fx/fire', [{ type: 'i', value: 1 }, { type: 's', value: 'A' }])
    expect(publish).not.toHaveBeenCalled()
  })

  it('refuses presses from a stale pad, for unknown buttons and when the core refuses to send', () => {
    const fire = vi.fn<FirePad>(() => ({ ok: false, reason: 'option-list-address: /fx/fire' }))
    const { manager, publish } = setup(fire)
    manager.handleUiFrame({ v: 1, type: 'padPress', name: 'take-01', version: 'run1-1', button: 'b1' }, 'c1')
    manager.handleUiFrame({ v: 1, type: 'padSave', name: 'take-01', pad: PAD }, 'c1')
    publish.mockClear()

    manager.handleUiFrame({ v: 1, type: 'padPress', name: 'take-02', version: 'run1-1', button: 'b1' }, 'c1')
    manager.handleUiFrame({ v: 1, type: 'padPress', name: 'take-01', version: 'run1-1', button: 'zz' }, 'c1')
    manager.handleUiFrame({ v: 1, type: 'padPress', name: 'take-01', version: 'run1-1', button: 'b1' }, 'c1')
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
    manager.handleUiFrame({ v: 1, type: 'padSave', name: 'take-01', pad: PAD }, 'c1')
    const changed = { ...PAD, buttons: [{ ...PAD.buttons[0]!, address: '/fx/other' }] }
    manager.handleUiFrame({ v: 1, type: 'padSave', name: 'take-01', pad: changed }, 'c2')
    publish.mockClear()

    manager.handleUiFrame({ v: 1, type: 'padPress', name: 'take-01', version: 'run1-1', button: 'b1' }, 'c1')
    expect(fire).not.toHaveBeenCalled()
    expect(publish.mock.calls[0]).toEqual([expect.objectContaining({ code: 'pad-press-rejected', detail: 'stale-pad: take-01@run1-1' }), 'c1'])

    manager.handleUiFrame({ v: 1, type: 'padPress', name: 'take-01', version: 'run1-2', button: 'b1' }, 'c1')
    expect(fire).toHaveBeenCalledWith('/fx/other', PAD.buttons[0]!.args)
  })

  it('refuses a press from a page drawn before a bridge restart, even though revisions start over', () => {
    const fire = vi.fn<FirePad>(() => ({ ok: true }))
    const { manager, create, publish } = setup(fire)
    manager.handleUiFrame({ v: 1, type: 'padSave', name: 'take-01', pad: PAD }, 'c1')
    const before = publish.mock.calls.map(([frame]) => frame).find(frame => frame.type === 'pad')
    expect(before).toMatchObject({ revision: 1, version: 'run1-1' })

    // 再起動後に別の内容で上書き保存すると、revision はまた 1 になるが版の印は違う
    const restarted = create()
    restarted.start()
    restarted.handleUiFrame({ v: 1, type: 'padSave', name: 'take-01', pad: { ...PAD, buttons: [{ ...PAD.buttons[0]!, address: '/fx/new' }] } }, 'c2')
    publish.mockClear()

    restarted.handleUiFrame({ v: 1, type: 'padPress', name: 'take-01', version: 'run1-1', button: 'b1' }, 'c1')
    expect(fire).not.toHaveBeenCalled()
    expect(publish.mock.calls[0]).toEqual([expect.objectContaining({ code: 'pad-press-rejected', detail: 'stale-pad: take-01@run1-1' }), 'c1'])
    restarted.handleUiFrame({ v: 1, type: 'padPress', name: 'take-01', version: 'run2-2', button: 'b1' }, 'c1')
    expect(fire).toHaveBeenCalledWith('/fx/new', PAD.buttons[0]!.args)
  })

  it('uses a random epoch per bridge instance by default', () => {
    const versionOfFirstSave = () => {
      const frames: DownstreamFrame[] = []
      const manager = createPadManager({
        store: createNamedJsonStore({ dir, schema: OscPadStoredSchema }), activeStore: createPadActiveFile({ dir, fs }),
        publish: frame => frames.push(frame), fire: vi.fn(), logInfo: vi.fn(), logWarn: vi.fn(),
      })
      manager.handleUiFrame({ v: 1, type: 'padSave', name: 'take-01', pad: PAD }, 'c1')
      const frame = frames.find(item => item.type === 'pad')
      return frame?.type === 'pad' ? frame.version : ''
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
    manager.handleUiFrame({ v: 1, type: 'padSave', name: 'big', pad: big }, 'c1')
    expect(publish.mock.calls).toEqual([[expect.objectContaining({ code: 'pad-rejected', detail: expect.stringContaining('bytes as JSON') }), 'c1']])
    expect(fs.existsSync(path.join(dir, 'big.json'))).toBe(false)

    // 上限の導入前などに保存された大きなパッドが選ばれていても、起動時に採用しない
    fs.writeFileSync(path.join(dir, 'big.json'), JSON.stringify(big))
    fs.writeFileSync(path.join(dir, '.active.json'), JSON.stringify({ format: 'oscdesk-pad-active', active: 'big' }))
    const restarted = create()
    restarted.start()
    expect(logWarn).toHaveBeenCalledWith('(WARN, BRIDGE)', expect.stringContaining('bytes as JSON'))
    publish.mockClear()
    restarted.handleUiFrame({ v: 1, type: 'padRequest' }, 'c2')
    expect(publish.mock.calls.map(([frame]) => frame.type)).toEqual(['padList'])
  })

  it('leaves other frame types to the caller', () => {
    const { manager } = setup()
    expect(manager.handleUiFrame({ v: 1, type: 'surfaceRequest' }, 'c1')).toBe(false)
  })
})
