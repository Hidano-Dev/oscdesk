// パッドの主画面(D-170)のテストの見本の文書とフレーム。本体(main.tsx から辿れるもの)からは import しない
import { PadDocumentSchema, type PadDocument } from '@oscdesk/shared'

/** 値の部品・組み合わせ・表を 1 つずつ置いた見本のパッド(3 行 × 4 列) */
export const STAGE_PAD: PadDocument = PadDocumentSchema.parse({
  format: 'oscdesk-pad', version: 2, rows: 3, columns: 4,
  widgets: [
    { id: 'fire', kind: 'button', row: 0, column: 0, label: 'Fire', address: '/fx/fire', args: [{ type: 'i', value: 1 }] },
    { id: 'mute', kind: 'toggle', row: 0, column: 1, label: 'Mute', address: '/mix/mute', type: 'T' },
    { id: 'level', kind: 'slider', row: 0, column: 2, columnSpan: 2, label: 'Level', address: '/mix/level', type: 'f', min: 0, max: 1 },
    { id: 'mode', kind: 'select', row: 1, column: 0, label: 'Mode', address: '/scene/mode', type: 's', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
    { id: 'count', kind: 'number', row: 1, column: 1, label: 'Count', address: '/scene/count', type: 'i', min: 0, max: 10, resend: false },
    { id: 'pose', kind: 'composite', row: 1, column: 2, label: 'Pose', address: '/rig/pose', fields: [
      { id: 'a1', label: 'x', kind: 'number', type: 'f' },
      { id: 'a2', label: 'on', kind: 'toggle', type: 'T' },
    ] },
    { id: 'members', kind: 'table', row: 2, column: 0, columnSpan: 4, label: 'Members', address: '/member',
      rows: { source: 'ui', keys: [{ key: 'm01', label: 'Alice' }, { key: 'm02', label: 'Bob' }] },
      columns: [{ id: 'active', label: 'Active', address: 'active', kind: 'toggle', type: 'T', bulk: true }],
      actions: [{ id: 'reset', label: 'Reset', scope: 'row', address: 'reset', args: [] }, { id: 'all', label: 'All off', scope: 'all', address: 'off', args: [] }],
    },
  ],
})

export const PAD_NAME = 'stage'
export const PAD_VERSION = 'epoch-1'

/** 採用中のパッドの osc.padDocument(ふつうはブリッジが配る) */
export function padDocumentFrame(pad: PadDocument = STAGE_PAD, options: { name?: string; version?: string; revision?: number } = {}) {
  return {
    v: 1, type: 'osc.padDocument', name: options.name ?? PAD_NAME, revision: options.revision ?? 1, version: options.version ?? PAD_VERSION,
    at: '2026-11-27T10:00:00.000Z', pad,
  }
}

/** パッドの一覧(osc.padList) */
export function padListFrame(active: string | null = PAD_NAME, names: string[] = active === null ? [] : [active]) {
  return { v: 1, type: 'osc.padList', names, active }
}

/** 保持値(osc.padValues) */
export function padValuesFrame(
  widgets: { widget: string; value: unknown }[],
  rows: { widget: string; key: string; column: string; value: unknown }[] = [],
  options: { full?: boolean; version?: string; name?: string } = {},
) {
  return { v: 1, type: 'osc.padValues', name: options.name ?? PAD_NAME, version: options.version ?? PAD_VERSION, full: options.full ?? true, widgets, rows }
}
