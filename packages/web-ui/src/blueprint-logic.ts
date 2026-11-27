// 設計図のタブ(HID-386)の文言と表示の目安(D-152)。UI を持たない純粋関数。
// 画面を作るのも、保存した画面を優先するのもブリッジで、ここは表示だけ。組み合わせの型(D-121)を画面に出せるかの
// 目安は、写しを持たずに shared の parseCompositeType・flatCompositeFields(ブリッジが画面を作るときと同じ関数)で見る

import {
  CATALOG_COMPOSITE_TYPE,
  CATALOG_SCHEMA_KEY,
  flatCompositeFields,
  parseCompositeType,
} from '@oscdesk/shared'

import type { FrameOf } from './bridge-link'

export type CatalogPc = FrameOf<'catalog'>['pcs'][number]
export type CatalogFrameItem = CatalogPc['items'][number]

/** 照合の結果の表示(文言と色の class)。食い違いは Sync で取り直す。 */
export function verifiedLabel(verified: boolean | null): { text: string; tone: 'positive' | 'negative' | 'muted' } {
  if (verified === true) return { text: '一致', tone: 'positive' }
  if (verified === false) return { text: '食い違い(「設計図を取り直す」で取り直してください)', tone: 'negative' }
  return { text: '未照合', tone: 'muted' }
}

export type CompositeSupport = 'flat' | 'nested' | 'variable-length' | 'invalid'

/** 組み合わせの型の項目なら、画面に出せるか(flat)・出せないか。組み合わせの型でない項目は null。 */
export function compositeSupport(item: CatalogFrameItem): CompositeSupport | null {
  if (item.type !== CATALOG_COMPOSITE_TYPE) return null
  const text = item.props
    .filter((prop) => prop.key === CATALOG_SCHEMA_KEY && typeof prop.value === 'string')
    .map((prop) => prop.value as string)
    .join('')
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return 'invalid'
  }
  // 届いた JSON は LAN の誰でも送れる。形と深さの検査は shared の関数に任せ、合わないものは読めないものとして示す
  const parsed = parseCompositeType(value)
  if (!parsed.ok) return 'invalid'
  const flat = flatCompositeFields(parsed.type)
  return flat.ok ? 'flat' : flat.reason
}

/** 組み合わせの型の項目の数と、画面に出せないものの数の文言。組み合わせの型が無ければ null。 */
export function compositeNote(items: readonly CatalogFrameItem[]): string | null {
  const composites = items.map(compositeSupport).filter((value): value is CompositeSupport => value !== null)
  if (composites.length === 0) return null
  const hidden = composites.filter((value) => value !== 'flat').length
  const note = `組み合わせの型 ${String(composites.length)} 項目`
  return hidden === 0 ? note : `${note}(うち ${String(hidden)} 項目は入れ子・可変長などで画面に出せません)`
}

/**
 * 届いた catalog を手元の一覧に当てる(D-131)。1 フレームは変わった PC だけで、host が同じ PC を丸ごと置き換え、
 * hosts に無い PC を捨て、hosts の順に並べる
 */
export function mergeCatalog(held: readonly CatalogPc[], frame: FrameOf<'catalog'>): CatalogPc[] {
  const byHost = new Map(held.map((pc) => [pc.host, pc]))
  for (const pc of frame.pcs) byHost.set(pc.host, pc)
  return [...new Set(frame.hosts)].flatMap((host) => {
    const pc = byHost.get(host)
    return pc === undefined ? [] : [pc]
  })
}

const pad2 = (value: number) => String(value).padStart(2, '0')

/** 受信の時刻をこの端末の時刻で見せる(読めなければそのまま)。 */
export function receivedAtLabel(receivedAt: string): string {
  const at = new Date(receivedAt)
  if (Number.isNaN(at.getTime())) return receivedAt
  return `${pad2(at.getMonth() + 1)}/${pad2(at.getDate())} ${pad2(at.getHours())}:${pad2(at.getMinutes())}:${pad2(at.getSeconds())}`
}
