import { describe, expect, it, vi } from 'vitest'

import { PROJECT_FILE, type DownstreamFrame, type OscPad, type OscSurfaceDefinition, type SurfaceDefinition } from '@oscdesk/shared'

import type { PersistedDesired } from './desired-values'
import { createProjectManager } from './project-manager'
import { createSurfaceCore, type BridgeConfig } from './surface-core'
import { v2 } from './surface-fixture'

const CORE_CONFIG: BridgeConfig = {
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

// 版 1 の形で書いて版 2 へ移す(D-117)。保持値は OSC のアドレスで持ち、プロジェクトでは id と JSON の値で書く
const LEGACY_DEFINITION: OscSurfaceDefinition = {
  format: 'oscdesk-surface', version: 1, name: 'Stage',
  parameters: [{ id: 'level', address: '/light/level', label: 'Level', type: 'f', kind: 'state', range: [0, 1], default: 0.5 }],
  screens: [],
}
const DEFINITION: SurfaceDefinition = v2(LEGACY_DEFINITION)
const PAD: OscPad = {
  format: 'oscdesk-pad', version: 1, rows: 1, columns: 2,
  buttons: [{ id: 'b1', row: 0, column: 0, label: 'Fire', address: '/fx/fire', args: [{ type: 'i', value: 1 }] }],
}
const HELD: PersistedDesired = {
  values: [{ id: 'level', address: '/light/level', type: 'f', args: [{ type: 'f', value: 0.25 }] }],
  records: [],
}

function setup(options: { surface?: boolean; pad?: boolean } = {}) {
  const surfaces = {
    active: vi.fn(() => options.surface === false ? null : { name: 'stage', definition: DEFINITION }),
    importDefinition: vi.fn((_name: string, _definition: unknown, _values: PersistedDesired) => ({ ok: true as const })),
  }
  const pads = {
    active: vi.fn(() => options.pad === false ? null : { name: 'take-01', pad: PAD }),
    importPad: vi.fn((_name: string, _pad: unknown) => ({ ok: true as const })),
  }
  const publish = vi.fn<(frame: DownstreamFrame, target?: string) => void>()
  const manager = createProjectManager({
    surfaces, pads, heldValues: () => HELD, publish, now: () => Date.parse('2026-10-28T10:00:00.000Z'),
    logInfo: vi.fn(), logWarn: vi.fn(),
  })
  return { manager, surfaces, pads, publish }
}

const project = (overrides: Record<string, unknown> = {}) => ({
  format: 'oscdesk-project',
  version: 2,
  exportedAt: '2026-10-28T10:00:00.000Z',
  surface: { name: 'stage', definition: DEFINITION, values: { values: [{ param: 'level', value: 0.25 }], rows: [] } },
  osc: { pad: { name: 'take-01', pad: PAD } },
  ...overrides,
})
const legacyProject = () => ({
  format: 'oscdesk-project',
  version: 1,
  exportedAt: '2026-10-28T10:00:00.000Z',
  surface: { name: 'stage', definition: LEGACY_DEFINITION, values: { values: HELD.values, records: [] } },
  pad: { name: 'take-01', pad: PAD },
})

describe('project manager (D-090)', () => {
  it('exports the adopted surface, its held values and the adopted pad to the requester only', () => {
    const { manager, publish } = setup()
    expect(manager.handleUiFrame({ v: 1, type: 'projectExport', requestId: 'r1' }, 'ui-1')).toBe(true)
    expect(publish).toHaveBeenCalledWith({ v: 1, type: 'project', requestId: 'r1', project: project() }, 'ui-1')
  })

  it('exports a pad-only project when no surface is adopted, and rejects when nothing is adopted', () => {
    const padOnly = setup({ surface: false })
    padOnly.manager.handleUiFrame({ v: 1, type: 'projectExport', requestId: 'r1' }, 'ui-1')
    expect(padOnly.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'project', project: project({ surface: null }) }), 'ui-1')

    const empty = setup({ surface: false, pad: false })
    empty.manager.handleUiFrame({ v: 1, type: 'projectExport', requestId: 'r1' }, 'ui-1')
    expect(empty.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'notice', code: 'project-export-rejected' }), 'ui-1')
  })

  it('imports the surface with its values and then the pad, and tells the requester', () => {
    const { manager, surfaces, pads, publish } = setup()
    manager.handleUiFrame({ v: 1, type: 'projectImport', project: project() }, 'ui-1')
    expect(surfaces.importDefinition).toHaveBeenCalledWith('stage', DEFINITION, {
      values: HELD.values, records: [], keyLists: [], spawns: [],
    })
    expect(pads.importPad).toHaveBeenCalledWith('take-01', PAD)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'notice', level: 'info', code: 'project-imported' }), 'ui-1')
  })

  it('imports a version 1 project, moving its definition to version 2 (D-117)', () => {
    const { manager, surfaces, pads } = setup()
    manager.handleUiFrame({ v: 1, type: 'projectImport', project: legacyProject() }, 'ui-1')
    expect(surfaces.importDefinition).toHaveBeenCalledWith('stage', DEFINITION, {
      values: HELD.values, records: [], keyLists: [], spawns: [],
    })
    expect(pads.importPad).toHaveBeenCalledWith('take-01', PAD)
  })

  it('leaves the adopted pad alone when the project has none', () => {
    const { manager, pads } = setup()
    manager.handleUiFrame({ v: 1, type: 'projectImport', project: project({ osc: { pad: null } }) }, 'ui-1')
    expect(pads.importPad).not.toHaveBeenCalled()
  })

  it('rejects an invalid project before changing anything', () => {
    const { manager, surfaces, pads, publish } = setup()
    const broken = project({ osc: { pad: { name: 'take-01', pad: { ...PAD, buttons: [{ ...PAD.buttons[0], address: '/sys/ping' }] } } } })
    manager.handleUiFrame({ v: 1, type: 'projectImport', project: broken }, 'ui-1')
    manager.handleUiFrame({ v: 1, type: 'projectImport', project: project({ format: 'oscdesk-surface' }) }, 'ui-1')
    manager.handleUiFrame({ v: 1, type: 'projectImport', project: project({ surface: null, osc: { pad: null } }) }, 'ui-1')
    expect(surfaces.importDefinition).not.toHaveBeenCalled()
    expect(pads.importPad).not.toHaveBeenCalled()
    expect(publish.mock.calls.filter(call => call[0].type === 'notice' && call[0].code === 'project-import-rejected')).toHaveLength(3)
  })

  it('rejects a project larger than the limit', () => {
    const { manager, surfaces, publish } = setup()
    const huge = project({ note: 'x'.repeat(PROJECT_FILE.MAX_SERIALIZED_BYTES) })
    manager.handleUiFrame({ v: 1, type: 'projectImport', project: huge }, 'ui-1')
    expect(surfaces.importDefinition).not.toHaveBeenCalled()
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ code: 'project-import-rejected', detail: expect.stringMatching(/^too-large/) }), 'ui-1')
  })

  it('reports a failed surface write and does not go on to the pad', () => {
    const { manager, surfaces, pads, publish } = setup()
    surfaces.importDefinition.mockReturnValue({ ok: false, detail: 'failed to write surface "stage": EACCES' } as never)
    manager.handleUiFrame({ v: 1, type: 'projectImport', project: project() }, 'ui-1')
    expect(pads.importPad).not.toHaveBeenCalled()
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ code: 'project-import-rejected', detail: expect.stringContaining('EACCES') }), 'ui-1')
  })

  it('refuses to export a project that its own import would reject', () => {
    const records = Array.from({ length: 30 }, (_, index) => ({
      id: `r${String(index)}`, address: `/r/${String(index)}`, label: 'R', kind: 'state' as const,
      keysFrom: { address: '/rows', source: 'ui' as const },
      fields: [{ id: 'v', label: 'V', type: 'i' as const, default: 1 }],
    }))
    const definition = v2({ ...LEGACY_DEFINITION, records })
    const rows = Array.from({ length: 1000 }, (_, index) => ({ id: `id-${String(index)}`, name: `N${String(index)}` }))
    const publish = vi.fn<(frame: DownstreamFrame, target?: string) => void>()
    const manager = createProjectManager({
      surfaces: { active: () => ({ name: 'stage', definition }), importDefinition: vi.fn() },
      pads: { active: () => null, importPad: vi.fn() },
      heldValues: () => ({ values: [], records: [], keyLists: [{ address: '/rows', rows }] }),
      publish, logInfo: vi.fn(), logWarn: vi.fn(),
    })
    manager.handleUiFrame({ v: 1, type: 'projectExport', requestId: 'r1' }, 'ui-1')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'notice', code: 'project-export-rejected', detail: expect.stringMatching(/^invalid: .*30000 record rows/) }), 'ui-1')
  })

  it('reads back what it exported from a real core with 12 records sharing a 1000-row UI list', () => {
    const records = Array.from({ length: 12 }, (_, index) => ({
      id: `r${String(index)}`, address: `/r/${String(index)}`, label: 'R', kind: 'state' as const,
      keysFrom: { address: '/rows', source: 'ui' as const },
      fields: [{ id: 'v', label: 'V', type: 'i' as const, default: 1 }],
    }))
    const definition = v2({ ...LEGACY_DEFINITION, records })
    const rows = Array.from({ length: 1000 }, (_, index) => ({ id: `id-${String(index)}`, name: `N${String(index)}` }))
    const core = createSurfaceCore({
      config: CORE_CONFIG, sendFn: vi.fn(), publish: vi.fn(), logInfo: vi.fn(), logWarn: vi.fn(),
    })
    core.setDefinition(definition, 'stage', { values: [], records: [], keyLists: [{ address: '/rows', rows }] })
    const publish = vi.fn<(frame: DownstreamFrame, target?: string) => void>()
    const importDefinition = vi.fn((_name: string, _definition: SurfaceDefinition, _values: PersistedDesired) => ({ ok: true as const }))
    const manager = createProjectManager({
      surfaces: { active: () => ({ name: 'stage', definition }), importDefinition },
      pads: { active: () => null, importPad: vi.fn() },
      heldValues: () => core.exportDesired(),
      publish, logInfo: vi.fn(), logWarn: vi.fn(),
    })
    manager.handleUiFrame({ v: 1, type: 'projectExport', requestId: 'r1' }, 'ui-1')
    const exported = publish.mock.calls.map(call => call[0]).find(frame => frame.type === 'project')
    if (exported?.type !== 'project') throw new Error('export was rejected')
    expect(exported.project.surface?.values.rows).toHaveLength(12_000)
    manager.handleUiFrame({ v: 1, type: 'projectImport', project: JSON.parse(JSON.stringify(exported.project)) as Record<string, unknown> }, 'ui-1')
    expect(importDefinition).toHaveBeenCalledTimes(1)
  })

  it('inspects a project without changing anything and answers with a summary (D-122)', () => {
    const { manager, surfaces, pads, publish } = setup()
    expect(manager.handleUiFrame({ v: 1, type: 'projectInspect', requestId: 'i1', project: project() }, 'ui-1')).toBe(true)
    expect(surfaces.importDefinition).not.toHaveBeenCalled()
    expect(pads.importPad).not.toHaveBeenCalled()
    expect(publish).toHaveBeenCalledWith({
      v: 1, type: 'projectInspection', requestId: 'i1',
      result: {
        ok: true,
        summary: {
          exportedAt: '2026-10-28T10:00:00.000Z',
          surface: { name: 'stage', values: 1, rows: 0, spawns: 0 },
          pad: { name: 'take-01', buttons: 1 },
        },
      },
    }, 'ui-1')
  })

  it('summarizes a version 1 project in the imported shape and a pad-only project without a surface', () => {
    const { manager, publish } = setup()
    manager.handleUiFrame({ v: 1, type: 'projectInspect', requestId: 'i1', project: legacyProject() }, 'ui-1')
    manager.handleUiFrame({ v: 1, type: 'projectInspect', requestId: 'i2', project: project({ surface: null }) }, 'ui-1')
    const summaries = publish.mock.calls.map(call => call[0]).flatMap(frame =>
      frame.type === 'projectInspection' && frame.result.ok ? [frame.result.summary] : [])
    expect(summaries[0]?.surface).toEqual({ name: 'stage', values: 1, rows: 0, spawns: 0 })
    expect(summaries[1]).toEqual({ exportedAt: '2026-10-28T10:00:00.000Z', surface: null, pad: { name: 'take-01', buttons: 1 } })
  })

  it('answers an inspection with the same reason the import would give, and names a surface definition file', () => {
    const { manager, publish } = setup()
    const broken = project({ osc: { pad: { name: 'take-01', pad: { ...PAD, rows: 0 } } } })
    manager.handleUiFrame({ v: 1, type: 'projectInspect', requestId: 'i1', project: broken }, 'ui-1')
    manager.handleUiFrame({ v: 1, type: 'projectImport', project: broken }, 'ui-1')
    manager.handleUiFrame({ v: 1, type: 'projectInspect', requestId: 'i2', project: DEFINITION as unknown as Record<string, unknown> }, 'ui-1')
    const frames = publish.mock.calls.map(call => call[0])
    const inspection = frames.find(frame => frame.type === 'projectInspection' && frame.requestId === 'i1')
    const rejection = frames.find(frame => frame.type === 'notice' && frame.code === 'project-import-rejected')
    if (inspection?.type !== 'projectInspection' || inspection.result.ok || rejection?.type !== 'notice') throw new Error('expected a rejection')
    expect(inspection.result.detail).toBe(rejection.detail)
    expect(inspection.result.detail).toMatch(/^invalid: /)
    const surfaceFile = frames.find(frame => frame.type === 'projectInspection' && frame.requestId === 'i2')
    expect(surfaceFile).toMatchObject({ result: { ok: false, detail: expect.stringMatching(/^surface-file: /) } })
  })

  it('ignores frames that are not about projects', () => {
    const { manager } = setup()
    expect(manager.handleUiFrame({ v: 1, type: 'surfaceRequest' }, 'ui-1')).toBe(false)
  })
})
