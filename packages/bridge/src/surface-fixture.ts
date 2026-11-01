import {
  migrateSurfaceDefinition,
  type OscSurfaceDefinition,
  type SurfaceDefinition,
} from '@oscdesk/shared'

// 単体テストの定義の見本。版 1 の形(パラメータに address)で書き、版 2(本体と bindings.osc。D-117)へ移して使う
// (アドレスを並べて書く既存のテストをそのまま読めるようにするため)
export const SAMPLE_DEFINITION = {
  format: 'oscdesk-surface',
  version: 1,
  name: 'Stage',
  parameters: [
    { id: 'master', address: '/mix/master', label: 'Master', type: 'f', kind: 'state', range: [0, 1], default: 0.5 },
  ],
  screens: [{ id: 'main', label: 'Main', children: [{ kind: 'control', param: 'master', widget: 'slider' }] }],
}

/** 版 1 の形で書いた定義を版 2 にする(テスト用)。一覧の id は `l_` + アドレス、selector の id は `m_` + パターン */
export function v2(definition: OscSurfaceDefinition | Record<string, unknown>): SurfaceDefinition {
  return migrateSurfaceDefinition(definition) as SurfaceDefinition
}
