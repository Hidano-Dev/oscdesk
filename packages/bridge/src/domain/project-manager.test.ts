import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PadDocumentStoredSchema, PROJECT_FILE, upgradePadDocument, type DownstreamFrame } from '@oscdesk/shared'

import { createNamedJsonStore } from '../adapters/named-json-store'
import { createPadActiveFile } from '../adapters/pad-active-file'
import { createPadManager, type FirePad } from './pad-manager'
import type { PersistedPadValues } from './pad-values'
import { createProjectManager } from './project-manager'

// プロジェクトファイルの版 3(D-175)。パッド(pad-manager)と組んで、書き出し・検査・取り込みを確かめる

const PAD_V2 = {
  format: 'oscdesk-pad', version: 2, rows: 2, columns: 2,
  widgets: [
    { id: 'go', kind: 'button', row: 0, column: 0, label: 'Go', address: '/fx/go', args: [{ type: 'i', value: 1 }] },
    { id: 'level', kind: 'slider', row: 0, column: 1, label: 'Level', address: '/mixer/level', type: 'f', min: 0, max: 1 },
    { id: 'members', kind: 'table', row: 1, column: 0, columnSpan: 2, label: '', address: '/member',
      rows: { source: 'ui', keys: [{ key: 'm01', label: 'A' }] },
      columns: [{ id: 'active', kind: 'toggle', label: '', address: 'active', type: 'i' }] },
  ],
}
const PAD_V1 = { format: 'oscdesk-pad', version: 1, rows: 1, columns: 2, buttons: [{ id: 'b1', row: 0, column: 0, label: 'Fire', address: '/fx/fire', args: [{ type: 'i', value: 1 }] }] }
const V3 = (overrides: Record<string, unknown> = {}) => ({
  format: 'oscdesk-project', version: 3, exportedAt: '2026-11-28T10:00:00.000Z',
  osc: {
    pad: { name: 'take-02', pad: PAD_V2 },
    values: { widgets: [{ widget: 'level', value: 0.75 }], rows: [{ widget: 'members', key: 'm01', column: 'active', value: true }] },
  },
  destinations: [{ host: '192.168.1.20', port: 7090, name: 'unity' }],
  ...overrides,
})

let dir: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-project-')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

function setup() {
  const publish = vi.fn<(frame: DownstreamFrame, target?: string) => void>()
  const fire = vi.fn<FirePad>(() => ({ ok: true }))
  const saved = new Map<string, PersistedPadValues>()
  const store = createNamedJsonStore({ dir, schema: PadDocumentStoredSchema, upgrade: upgradePadDocument, logInfo: vi.fn() })
  const pads = createPadManager({
    store, activeStore: createPadActiveFile({ dir, fs }), publish, fire,
    valuesStore: { load: name => saved.get(name) ?? null, save: (name, values) => saved.set(name, values) },
    logInfo: vi.fn(), logWarn: vi.fn(), epoch: 'run1', now: () => Date.parse('2026-11-28T10:00:00.000Z'),
  })
  const projects = createProjectManager({
    pads, publish, destinations: () => [{ host: '10.0.0.5', port: 9000, name: 'unity' }],
    now: () => Date.parse('2026-11-28T11:00:00.000Z'), logInfo: vi.fn(), logWarn: vi.fn(),
  })
  const frames = () => publish.mock.calls.map(([frame]) => frame)
  const notices = () => frames().flatMap(frame => (frame.type === 'notice' ? [`${frame.code}: ${frame.detail}`] : []))
  return { pads, projects, publish, fire, saved, store, frames, notices }
}

describe('project manager (D-175)', () => {
  it('exports the adopted pad, its held values and the current destinations, and refuses without a pad', () => {
    const { pads, projects, publish, frames, notices } = setup()
    projects.handleUiFrame({ v: 1, type: 'projectExport', requestId: 'e0' }, 'c1')
    expect(notices()).toEqual(['project-export-rejected: empty: no pad is adopted'])

    pads.handleUiFrame({ v: 1, type: 'osc.padSave', name: 'live', pad: PAD_V2 }, 'c1')
    pads.handleUiFrame({ v: 1, type: 'osc.padSet', name: 'live', version: 'run1-1', widget: 'level', value: 0.5 }, 'c1')
    publish.mockClear()
    projects.handleUiFrame({ v: 1, type: 'projectExport', requestId: 'e1' }, 'c1')
    expect(frames()).toEqual([{
      v: 1, type: 'project', requestId: 'e1',
      project: {
        format: 'oscdesk-project', version: 3, exportedAt: '2026-11-28T11:00:00.000Z',
        osc: { pad: { name: 'live', pad: expect.objectContaining({ version: 2 }) }, values: { widgets: [{ widget: 'level', value: 0.5 }], rows: [] } },
        destinations: [{ host: '10.0.0.5', port: 9000, name: 'unity' }],
      },
    }])
    expect(publish.mock.calls[0]?.[1]).toBe('c1')
  })

  it('inspects a file without changing anything, with the counts of what it would import', () => {
    const { projects, frames, store } = setup()
    projects.handleUiFrame({ v: 1, type: 'projectInspect', requestId: 'i1', project: V3() }, 'c1')
    expect(frames()).toEqual([{
      v: 1, type: 'projectInspection', requestId: 'i1',
      result: {
        ok: true,
        summary: {
          exportedAt: '2026-11-28T10:00:00.000Z', sourceVersion: 3, pad: { name: 'take-02', widgets: 3 },
          values: { widgets: 1, rows: 1 }, destinations: 1, droppedSurface: null,
        },
      },
    }])
    expect(store.list()).toEqual([])
  })

  it('imports the pad and replaces its held values with the file, sending nothing to the targets', () => {
    const { pads, projects, fire, saved, frames, notices } = setup()
    // 同じ名前のパッドを採用中で、ファイルと違う値を持っていても、取り込んだ値で置き換える(今の値を引き継がない)
    pads.handleUiFrame({ v: 1, type: 'osc.padSave', name: 'take-02', pad: PAD_V2 }, 'c1')
    pads.handleUiFrame({ v: 1, type: 'osc.padSet', name: 'take-02', version: 'run1-1', widget: 'level', value: 0.1 }, 'c1')
    fire.mockClear()
    projects.handleUiFrame({ v: 1, type: 'projectImport', project: V3() }, 'c2')
    expect(fire).not.toHaveBeenCalled()
    expect(pads.exportProject()?.values).toEqual({
      widgets: [{ widget: 'level', value: 0.75 }],
      rows: [{ widget: 'members', key: 'm01', column: 'active', value: true }],
    })
    expect(saved.get('take-02')?.widgets).toEqual([{ widget: 'level', address: '/mixer/level', value: 0.75 }])
    expect(frames().filter(frame => frame.type === 'osc.padValues').at(-1)).toMatchObject({ full: true, widgets: [{ widget: 'level', value: 0.75 }] })
    expect(notices().at(-1)).toBe('project-imported: pad "take-02", 2 value(s)')
  })

  it('keeps only the owner value of an address shared by two widgets, whatever the order in the file, and marks the values as replaced', () => {
    const { pads, projects, frames } = setup()
    const shared = { ...PAD_V2, rows: 3, widgets: [...PAD_V2.widgets, { id: 'alias', kind: 'number', row: 2, column: 0, label: '', address: '/mixer/level', type: 'f', min: 0, max: 1 }] }
    const values = { widgets: [{ widget: 'alias', value: 0.1 }, { widget: 'level', value: 0.9 }], rows: [] }
    projects.handleUiFrame({ v: 1, type: 'projectImport', project: V3({ osc: { pad: { name: 'take-02', pad: shared }, values } }) }, 'c1')
    expect(pads.exportProject()?.values.widgets).toEqual([{ widget: 'level', value: 0.9 }])
    expect(frames().filter(frame => frame.type === 'osc.padValues').at(-1)).toMatchObject({ full: true, replaced: true })
  })

  it('drops the values that do not fit the pad and says how many', () => {
    const { pads, projects, notices } = setup()
    const values = {
      widgets: [{ widget: 'level', value: 5 }, { widget: 'ghost', value: 1 }, { widget: 'go', value: 1 }],
      rows: [{ widget: 'members', key: 'm99', column: 'active', value: true }],
    }
    projects.handleUiFrame({ v: 1, type: 'projectImport', project: V3({ osc: { pad: { name: 'take-02', pad: PAD_V2 }, values } }) }, 'c1')
    expect(pads.exportProject()?.values).toEqual({ widgets: [], rows: [] })
    expect(notices().at(-1)).toBe('project-imported: pad "take-02", 0 value(s), 4 value(s) that do not fit the pad were dropped')
  })

  it('moves a version 2 file to version 3 and tells that its surface definition was not imported', () => {
    const { pads, projects, frames, notices } = setup()
    const v2 = {
      format: 'oscdesk-project', version: 2, exportedAt: '2026-10-28T10:00:00.000Z',
      surface: { name: 'stage', definition: {}, values: { values: [{}], rows: [] } }, osc: { pad: { name: 'take-01', pad: PAD_V1 } },
    }
    projects.handleUiFrame({ v: 1, type: 'projectInspect', requestId: 'i2', project: v2 }, 'c1')
    expect(frames().at(-1)).toMatchObject({ result: { ok: true, summary: { sourceVersion: 2, pad: { name: 'take-01', widgets: 1 }, droppedSurface: { name: 'stage', values: 1, rows: 0 } } } })
    projects.handleUiFrame({ v: 1, type: 'projectImport', project: v2 }, 'c1')
    expect(pads.exportProject()).toMatchObject({ name: 'take-01', pad: { version: 2, widgets: [{ id: 'b1', kind: 'button' }] } })
    expect(notices().at(-1)).toBe('project-imported: pad "take-01", 0 value(s), surface definition "stage" was not imported')
  })

  it('refuses a surface-only file, a surface definition file, a too large file and a broken one, changing nothing', () => {
    const { pads, projects, notices, frames } = setup()
    projects.handleUiFrame({ v: 1, type: 'projectImport', project: { format: 'oscdesk-project', version: 1, exportedAt: '2026-10-28T10:00:00.000Z', surface: { name: 'stage' }, pad: null } }, 'c1')
    projects.handleUiFrame({ v: 1, type: 'projectImport', project: { format: 'oscdesk-surface', version: 2 } }, 'c1')
    projects.handleUiFrame({ v: 1, type: 'projectImport', project: { ...V3(), padding: 'x'.repeat(PROJECT_FILE.MAX_SERIALIZED_BYTES) } }, 'c1')
    projects.handleUiFrame({ v: 1, type: 'projectImport', project: V3({ destinations: 'nope' }) }, 'c1')
    expect(notices().map(text => text.split(':').slice(0, 2).join(':'))).toEqual([
      'project-import-rejected: surface-only',
      'project-import-rejected: surface-file',
      'project-import-rejected: too-large',
      'project-import-rejected: invalid',
    ])
    expect(pads.exportProject()).toBeNull()
    projects.handleUiFrame({ v: 1, type: 'projectInspect', requestId: 'i3', project: { format: 'oscdesk-project', version: 9 } }, 'c1')
    expect(frames().at(-1)).toMatchObject({ type: 'projectInspection', requestId: 'i3', result: { ok: false, detail: expect.stringMatching(/^unsupported-version/) } })
  })

  it('leaves other frames to the caller', () => {
    const { projects } = setup()
    expect(projects.handleUiFrame({ v: 1, type: 'osc.padDocumentRequest' }, 'c1')).toBe(false)
  })
})
