// 「新しい一覧があります」(D-088)の文言。UI を持たない純粋関数。
// 反映はブリッジが行って全 UI へ配るので、ここは表示の組み立てだけ

import type { SurfaceDefinition } from '@oscdesk/shared'

import type { FrameOf } from './bridge-link'

export type PendingOptionList = NonNullable<FrameOf<'runtimeOptions'>['pending']>[number]

export const TITLE = '新しい一覧があります'
export const HINT = '反映するまで、画面の行と選択肢は変わりません。心当たりの無い宛先からの一覧は反映しないでください'
/** 名前を全部並べると、数百件の一覧で表示が埋まる。超えた分は件数だけ出す。 */
export const MAX_NAMES = 10

/** 出所の表示。ブロードキャストの宛先では答えたホストを添える(同じ宛先名で複数の PC が答えるため)。 */
export function sourceLabel(item: PendingOptionList): string {
  return item.host === undefined ? item.target : `${item.target}(${item.host})`
}

function names(list: readonly string[]): string {
  const shown = list.slice(0, MAX_NAMES).map((name) => (name === '' ? '(空)' : name)).join('、')
  const rest = list.length - MAX_NAMES
  return rest <= 0 ? shown : `${shown} ほか ${String(rest)} 件`
}

/** 「<宛先> の一覧が変わりました(追加: …/削除: …)」。増減が無ければ並びだけが変わった。 */
export function changeSummary(item: PendingOptionList): string {
  const parts: string[] = []
  if (item.added.length > 0) parts.push(`追加: ${names(item.added)}`)
  if (item.removed.length > 0) parts.push(`削除: ${names(item.removed)}`)
  const detail = parts.length > 0 ? parts.join(' / ') : '並び順だけが変わりました'
  return `${sourceLabel(item)} の一覧が変わりました(${detail})`
}

/** その一覧を使う欄のラベル(定義順)。どの画面の何が変わるのかを、一覧の id だけより分かりやすくする。 */
export function listUsages(definition: SurfaceDefinition | null, listId: string): string[] {
  if (definition === null) return []
  const usages: string[] = []
  for (const parameter of definition.parameters) {
    if (parameter.type === 's' && parameter.optionsFrom?.list === listId) usages.push(`${parameter.label || parameter.id} の選択肢`)
  }
  for (const record of definition.records ?? []) {
    const label = record.label || record.id
    if (record.keysFrom.list === listId) usages.push(`${label} の行`)
    for (const field of record.fields) {
      if (field.type === 's' && field.optionsFrom?.list === listId) usages.push(`${label} の ${field.label || field.id} の選択肢`)
    }
  }
  return [...new Set(usages)]
}

/** 一覧(id)ごとに、ブリッジの並び(定義順 → 宛先の順)を保ってまとめる。反映は一覧の単位なので。 */
export function groupByList(pending: readonly PendingOptionList[]): { list: string; items: PendingOptionList[] }[] {
  const groups = new Map<string, PendingOptionList[]>()
  for (const item of pending) {
    const group = groups.get(item.list)
    if (group === undefined) groups.set(item.list, [item])
    else group.push(item)
  }
  return [...groups].map(([list, items]) => ({ list, items }))
}
