import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DownstreamFrame } from '@oscdesk/shared'

import { SAMPLE_DEFINITION, v2 } from './surface-fixture'
import { createSurfaceManager } from './surface-manager'
import { createSurfaceStore } from './surface-store'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-surfaces-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

function setup() {
  const publish = vi.fn<(frame: DownstreamFrame, target?: string) => void>()
  const logWarn = vi.fn()
  const store = createSurfaceStore({ dir })
  const manager = createSurfaceManager({
    store, publish, logWarn, logInfo: vi.fn(), now: () => Date.UTC(2026, 9, 8, 10, 0, 0),
  })
  return { manager, publish, store, logWarn }
}

const types = (publish: ReturnType<typeof setup>['publish']) => publish.mock.calls.map(([frame, target]) => [frame.type, target])

describe('createSurfaceManager', () => {
  it('adopts the default definition at startup and answers a request only to the requester', () => {
    const { manager, publish, store } = setup()
    store.save('stage', SAMPLE_DEFINITION)
    manager.start('stage')
    publish.mockClear()

    expect(manager.handleUiFrame({ v: 1, type: 'surfaceRequest' }, 'c1')).toBe(true)
    expect(types(publish)).toEqual([['surfaceList', 'c1'], ['surface', 'c1']])
    expect(publish.mock.calls[1][0]).toMatchObject({ name: 'stage', revision: 1, at: '2026-10-08T10:00:00.000Z' })
  })

  it('warns and stays without an active definition when the default is broken', () => {
    const { manager, publish, logWarn } = setup()
    manager.start('missing')
    expect(logWarn).toHaveBeenCalled()
    manager.handleUiFrame({ v: 1, type: 'surfaceRequest' }, 'c1')
    expect(publish.mock.calls).toEqual([[{ v: 1, type: 'surfaceList', names: [], active: null }, 'c1']])
  })

  it('broadcasts a saved definition to everyone and bumps the revision', () => {
    const { manager, publish } = setup()
    manager.handleUiFrame({ v: 1, type: 'surfaceSave', name: 'stage', definition: SAMPLE_DEFINITION }, 'c1')
    manager.handleUiFrame({ v: 1, type: 'surfaceSave', name: 'stage', definition: SAMPLE_DEFINITION }, 'c1')
    const surfaces = publish.mock.calls.map(([frame]) => frame).filter(frame => frame.type === 'surface')
    expect(surfaces.map(frame => frame.type === 'surface' && frame.revision)).toEqual([1, 2])
    expect(publish.mock.calls.every(([, target]) => target === undefined)).toBe(true)
  })

  it('saves without adopting when activate is false', () => {
    const { manager, publish } = setup()
    manager.handleUiFrame({ v: 1, type: 'surfaceSave', name: 'draft', definition: SAMPLE_DEFINITION, activate: false }, 'c1')
    expect(publish.mock.calls).toEqual([[{ v: 1, type: 'surfaceList', names: ['draft'], active: null }]])
  })

  it('keeps the previous definition and tells only the sender why a save was refused', () => {
    const { manager, publish } = setup()
    manager.handleUiFrame({ v: 1, type: 'surfaceSave', name: 'stage', definition: SAMPLE_DEFINITION }, 'c1')
    publish.mockClear()

    manager.handleUiFrame({ v: 1, type: 'surfaceSave', name: 'stage', definition: { ...SAMPLE_DEFINITION, extra: 1 } }, 'c2')
    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish.mock.calls[0][1]).toBe('c2')
    expect(publish.mock.calls[0][0]).toMatchObject({ type: 'notice', level: 'error', code: 'surface-rejected' })

    publish.mockClear()
    manager.handleUiFrame({ v: 1, type: 'surfaceRequest' }, 'c3')
    expect(publish.mock.calls[1][0]).toMatchObject({ type: 'surface', name: 'stage', revision: 1 })
  })

  it('loads a stored definition and rejects a missing one', () => {
    const { manager, publish, store } = setup()
    store.save('stage', SAMPLE_DEFINITION)
    manager.handleUiFrame({ v: 1, type: 'surfaceLoad', name: 'stage' }, 'c1')
    expect(types(publish)).toEqual([['surface', undefined], ['surfaceList', undefined]])

    publish.mockClear()
    manager.handleUiFrame({ v: 1, type: 'surfaceLoad', name: 'nope' }, 'c1')
    expect(publish.mock.calls[0][0]).toMatchObject({ type: 'notice', code: 'surface-rejected' })
  })

  it('answers an edit command to the requester only, without saving or adopting anything (D-123)', () => {
    const { manager, publish, store } = setup()
    const draft = v2(SAMPLE_DEFINITION) as unknown as Record<string, unknown>
    manager.handleUiFrame({ v: 1, type: 'surfaceEdit', requestId: 'e1', draft, edit: { op: 'rename', name: 'Renamed' } }, 'c1')
    manager.handleUiFrame({ v: 1, type: 'surfaceEdit', requestId: 'e2', draft, edit: { op: 'removeParameter', param: 'missing' } }, 'c1')
    expect(types(publish)).toEqual([['surfaceEdited', 'c1'], ['surfaceEdited', 'c1']])
    expect(publish.mock.calls[0]?.[0]).toMatchObject({ requestId: 'e1', result: { ok: true, definition: { name: 'Renamed' } } })
    expect(publish.mock.calls[1]?.[0]).toMatchObject({ requestId: 'e2', result: { ok: false, detail: 'パラメータ missing がありません' } })
    expect(store.list()).toEqual([])
  })

  it('answers instead of throwing when an edit fails unexpectedly', () => {
    const { manager, publish } = setup()
    // 深すぎる木の再帰などの想定外の例外でブリッジごと落ちないこと。ここでは循環する作業コピーで structuredClone 前の検証を壊す
    let deep: Record<string, unknown> = { kind: 'row', children: [] }
    const root = deep
    for (let index = 0; index < 20_000; index += 1) {
      const child: Record<string, unknown> = { kind: 'row', children: [] }
      ;(deep.children as unknown[]).push(child)
      deep = child
    }
    const draft = { ...(v2(SAMPLE_DEFINITION) as unknown as Record<string, unknown>), screens: [{ id: 'main', label: 'Main', children: [root] }] }
    expect(() => manager.handleUiFrame({ v: 1, type: 'surfaceEdit', requestId: 'e3', draft, edit: { op: 'rename', name: 'x' } }, 'c1')).not.toThrow()
    expect(publish.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'surfaceEdited', requestId: 'e3', result: { ok: false } })
  })

  it('leaves other frame types to the caller', () => {
    const { manager } = setup()
    expect(manager.handleUiFrame({ v: 1, type: 'heartbeatAck', t: 1 }, 'c1')).toBe(false)
  })
})

describe('definition version 2 on the wire (HID-389・D-117)', () => {
  const body = {
    format: 'oscdesk-surface', version: 2, name: 'Stage',
    parameters: [
      { id: 'slot1', label: 'Slot 1', type: 'f', kind: 'state', default: 0 },
      { id: 'slot2', label: 'Slot 2', type: 'f', kind: 'state', default: 0 },
    ],
    actions: [{ id: 'all', label: 'All', steps: [{ selector: 'slots' }] }],
    screens: [],
  }
  const bindings = { osc: { parameters: [{ id: 'slot1', address: '/slot/1' }, { id: 'slot2', address: '/slot/2' }], selectors: [{ id: 'slots', match: '/slot/*' }] } }
  const lastSurface = (publish: ReturnType<typeof setup>['publish']) =>
    publish.mock.calls.map(([frame]) => frame).filter(frame => frame.type === 'surface').at(-1)

  it('saves the body and its bindings as one definition and sends them apart, with what each selector hits', () => {
    const { manager, publish, store } = setup()
    manager.handleUiFrame({ v: 1, type: 'surfaceSave', name: 'stage', definition: body, bindings }, 'c1')
    expect(lastSurface(publish)).toMatchObject({ definition: body, bindings })
    const surface = lastSurface(publish)
    // selector が当たるパラメータは部品の木のアクションの送り先として添える(D-124)
    const action = surface?.type === 'surface' ? surface.view.actions[0] : undefined
    expect(action !== undefined && 'targets' in action ? action.targets.map(target => target.control.param) : []).toEqual(['slot1', 'slot2'])
    expect(surface?.type === 'surface' && 'bindings' in surface.definition).toBe(false)
    const stored = store.read('stage')
    expect(stored.ok && stored.value.bindings).toEqual(bindings)
  })

  it('refuses a body without osc bindings (the bridge could not send it)', () => {
    const { manager, publish } = setup()
    manager.handleUiFrame({ v: 1, type: 'surfaceSave', name: 'stage', definition: body }, 'c1')
    expect(publish.mock.calls[0]?.[0]).toMatchObject({ type: 'notice', code: 'surface-rejected', detail: expect.stringContaining('osc bindings are required') })
  })

  it('moves a stored version 1 file to version 2 when it reads it, keeping the old file as a backup', () => {
    const { manager, publish, store } = setup()
    fs.writeFileSync(path.join(dir, 'stage.json'), JSON.stringify(SAMPLE_DEFINITION), 'utf8')
    manager.start('stage')
    expect(lastSurface(publish)).toMatchObject({ definition: { version: 2 }, bindings: { osc: { parameters: [{ id: 'master', address: '/mix/master' }] } } })
    const raw = store.readRaw('stage')
    expect(raw.ok && (JSON.parse(raw.value) as { version: number }).version).toBe(2)
    const backups = fs.readdirSync(path.join(dir, '.backups'))
    expect(backups).toHaveLength(1)
    expect((JSON.parse(fs.readFileSync(path.join(dir, '.backups', backups[0]!), 'utf8')) as { version: number }).version).toBe(1)
  })
})
