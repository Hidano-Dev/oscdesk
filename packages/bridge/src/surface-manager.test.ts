import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DownstreamFrame } from '@oscdesk/shared'

import { SAMPLE_DEFINITION } from './surface-fixture'
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

  it('leaves other frame types to the caller', () => {
    const { manager } = setup()
    expect(manager.handleUiFrame({ v: 1, type: 'manifestRequest' }, 'c1')).toBe(false)
  })
})
