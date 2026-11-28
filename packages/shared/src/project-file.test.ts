import { describe, expect, it } from 'vitest'

import { PROJECT_FILE, ProjectFileSchema, projectSerializedBytes, readProjectFile } from './project-file'

const PAD_V2 = {
  format: 'oscdesk-pad', version: 2, rows: 2, columns: 2,
  widgets: [
    { id: 'fire', kind: 'button', row: 0, column: 0, label: 'Fire', address: '/fx/fire', args: [{ type: 'i', value: 1 }] },
    { id: 'level', kind: 'slider', row: 0, column: 1, label: 'Level', address: '/mix/level', type: 'f', min: 0, max: 1 },
  ],
}
const PAD_V1 = { format: 'oscdesk-pad', version: 1, rows: 1, columns: 1, buttons: [{ id: 'fire', row: 0, column: 0, label: 'Fire', address: '/fx/fire', args: [] }] }
const V3 = {
  format: 'oscdesk-project',
  version: 3,
  exportedAt: '2026-11-28T10:00:00.000Z',
  osc: { pad: { name: 'take-01', pad: PAD_V2 }, values: { widgets: [{ widget: 'level', value: 0.5 }], rows: [] } },
  destinations: [{ host: '192.168.1.20', port: 7090, name: 'unity' }],
}
const SURFACE = { name: 'stage', definition: { format: 'oscdesk-surface', version: 2 }, values: { values: [{ param: 'a', value: 1 }], rows: [{ record: 'r', key: 'k', values: {} }] } }
const V2 = { format: 'oscdesk-project', version: 2, exportedAt: '2026-10-28T10:00:00.000Z', surface: SURFACE, osc: { pad: { name: 'take-01', pad: PAD_V1 } } }
const V1 = {
  format: 'oscdesk-project', version: 1, exportedAt: '2026-10-28T10:00:00.000Z',
  surface: { name: 'stage', definition: {}, values: { values: [], records: [{}, {}] } }, pad: { name: 'take-01', pad: PAD_V1 },
}

describe('ProjectFileSchema (D-175)', () => {
  it('accepts the pad, its held values and the destinations under osc and destinations', () => {
    expect(ProjectFileSchema.safeParse(V3).success).toBe(true)
  })

  it('rejects unknown keys, a missing pad, unsafe names and values outside the identifier rules', () => {
    expect(ProjectFileSchema.safeParse({ ...V3, extra: true }).success).toBe(false)
    expect(ProjectFileSchema.safeParse({ ...V3, osc: { ...V3.osc, pad: null } }).success).toBe(false)
    expect(ProjectFileSchema.safeParse({ ...V3, osc: { ...V3.osc, pad: { ...V3.osc.pad, name: 'CON' } } }).success).toBe(false)
    expect(ProjectFileSchema.safeParse({ ...V3, osc: { ...V3.osc, values: { widgets: [{ widget: '__proto__', value: 1 }], rows: [] } } }).success).toBe(false)
    expect(ProjectFileSchema.safeParse({ ...V3, osc: { ...V3.osc, values: { widgets: [], rows: [{ widget: 't', key: 'a/b', column: 'c', value: 1 }] } } }).success).toBe(false)
  })

  it('bounds the held cells and the destinations', () => {
    const rows = Array.from({ length: PROJECT_FILE.MAX_HELD_ROWS + 1 }, () => ({ widget: 't', key: 'k', column: 'c', value: 1 }))
    expect(ProjectFileSchema.safeParse({ ...V3, osc: { ...V3.osc, values: { widgets: [], rows } } }).success).toBe(false)
    const destinations = Array.from({ length: PROJECT_FILE.MAX_DESTINATIONS + 1 }, () => ({ host: 'h', port: 1 }))
    expect(ProjectFileSchema.safeParse({ ...V3, destinations }).success).toBe(false)
  })
})

describe('readProjectFile (D-175)', () => {
  it('reads version 3 as it is', () => {
    const read = readProjectFile(V3)
    expect(read).toMatchObject({ ok: true, sourceVersion: 3, dropped: { surface: null } })
  })

  it('moves version 2 and version 1 to version 3, upgrading the pad and reporting the dropped surface', () => {
    const two = readProjectFile(V2)
    expect(two.ok && two.project.osc.pad.pad.version).toBe(2)
    expect(two.ok && two.project.osc.pad.pad.widgets.map(widget => widget.id)).toEqual(['fire'])
    expect(two).toMatchObject({ ok: true, sourceVersion: 2, dropped: { surface: { name: 'stage', values: 1, rows: 1 } } })
    expect(two.ok && two.project.osc.values).toEqual({ widgets: [], rows: [] })
    const one = readProjectFile(V1)
    expect(one).toMatchObject({ ok: true, sourceVersion: 1, dropped: { surface: { name: 'stage', values: 0, rows: 2 } } })
    // パッドだけの古いファイルは何も落とさない
    expect(readProjectFile({ ...V2, surface: null })).toMatchObject({ ok: true, dropped: { surface: null } })
  })

  it('refuses a file with only a surface definition instead of importing nothing silently', () => {
    const read = readProjectFile({ ...V2, osc: { pad: null } })
    expect(read.ok === false && read.detail).toMatch(/^surface-only: .*"stage"/)
    expect(readProjectFile({ ...V1, pad: null }).ok).toBe(false)
  })

  it('explains a surface definition file, an unknown version and a broken pad', () => {
    expect(readProjectFile({ format: 'oscdesk-surface', version: 2 })).toMatchObject({ ok: false, detail: expect.stringMatching(/^surface-file:/) })
    expect(readProjectFile({ ...V3, version: 9 })).toMatchObject({ ok: false, detail: expect.stringMatching(/^unsupported-version: 9/) })
    // 文字にできない version でも例外を投げずに理由を返す(PR #187 のレビュー)
    expect(readProjectFile({ format: 'oscdesk-project', version: { toString: null } })).toMatchObject({ ok: false, detail: expect.stringMatching(/^unsupported-version: object/) })
    expect(readProjectFile({ ...V2, osc: { pad: { name: 'x', pad: { ...PAD_V1, rows: 0 } } } })).toMatchObject({ ok: false, detail: expect.stringMatching(/^invalid: pad\.pad/) })
    expect(readProjectFile([])).toMatchObject({ ok: false })
    expect(readProjectFile(null)).toMatchObject({ ok: false })
  })

  it('does not trust the shape of the dropped surface (it is only counted)', () => {
    const odd = readProjectFile({ ...V2, surface: { name: 7, values: 'x' } })
    expect(odd).toMatchObject({ ok: true, dropped: { surface: { name: null, values: 0, rows: 0 } } })
  })
})

describe('projectSerializedBytes', () => {
  it('counts UTF-8 bytes of the compact JSON', () => {
    expect(projectSerializedBytes({ a: 'あ' })).toBe(new TextEncoder().encode('{"a":"あ"}').length)
  })
})
