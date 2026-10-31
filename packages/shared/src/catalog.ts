import { z } from 'zod'

import type { OscArg } from './osc-types'

// 設計図(Catalog。D-101 / D-104)の形と要約値。ターゲットが /sys/catalog/* で送る内容を、OSC に寄せない形で持つ。
// OSC への書き方(1 項目 1 メッセージ)は通信アダプタの 1 つで、ここの型は WebSocket のフレームにもそのまま載る
// (HID-373 の汎用化と両立させるため)。このファイルは OSC ライブラリに依存しない。

export const CATALOG_ADDRESSES = {
  BEGIN: '/sys/catalog/begin',
  ADD: '/sys/catalog/add',
  REMOVE: '/sys/catalog/remove',
  END: '/sys/catalog/end',
  DIGEST: '/sys/catalog/digest',
  REQUEST: '/sys/catalog/request',
} as const

// 受け側のメモリを守る上限。LAN に認証が無く、誰でも設計図を送れるため、PC 数・項目数・文字数を縛る
export const CATALOG = {
  MAX_PCS: 64,
  MAX_ITEMS_PER_PC: 4096,
  MAX_PROPS_PER_ITEM: 32,
  MAX_STRING_CHARS: 1024,
  MAX_NAME_CHARS: 64,
  // 1 項目を JSON にした大きさの上限。1 項目 1 メッセージで送るため、1 データグラム(60 KiB)に余裕を持って収める
  MAX_ITEM_BYTES: 8 * 1024,
  // 全 PC の項目を JSON にした大きさの目安の上限。catalog フレームは 1 フレームで全量を送るため、UI の受信上限(16 MiB)に余裕を持って収める
  MAX_TOTAL_BYTES: 8 * 1024 * 1024,
} as const

const PROP_KEY_PATTERN = /^[A-Za-z0-9_.-]{1,32}$/

export const CatalogPropValueSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('i'), value: z.number().int().min(-2_147_483_648).max(2_147_483_647) }).strict(),
  // 無限大・NaN は JSON で null になり、フレーム全体(全 PC)が UI で読めなくなるため受けない
  z.object({ type: z.literal('f'), value: z.number().finite() }).strict(),
  z.object({ type: z.literal('s'), value: z.string().max(CATALOG.MAX_STRING_CHARS) }).strict(),
])

export const CatalogPropSchema = z.object({
  key: z.string().regex(PROP_KEY_PATTERN),
  arg: CatalogPropValueSchema,
}).strict()

// kind / type は後から値を足せるよう文字列のまま持つ(知らない値は読み飛ばさず保持し、画面側が扱えるものだけ使う)
export const CatalogItemSchema = z.object({
  address: z.string().startsWith('/').max(CATALOG.MAX_STRING_CHARS),
  kind: z.string().min(1).max(32),
  type: z.string().min(1).max(32),
  // 同じキーを繰り返してよい(options は 1 回に 1 つ)。並びは送られた順
  props: z.array(CatalogPropSchema).max(CATALOG.MAX_PROPS_PER_ITEM),
}).strict().refine(item => Buffer.byteLength(JSON.stringify(item), 'utf8') <= CATALOG.MAX_ITEM_BYTES, {
  message: `item is larger than ${String(CATALOG.MAX_ITEM_BYTES)} bytes`,
})

export type CatalogItem = z.infer<typeof CatalogItemSchema>
export type CatalogProp = z.infer<typeof CatalogPropSchema>

export interface CatalogDigest {
  readonly count: number
  /** 設計図全体の CRC32(符号付き int32。OSC の i にそのまま載る) */
  readonly crc: number
}

const CRC_TABLE: readonly number[] = (() => {
  const table: number[] = []
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table.push(c >>> 0)
  }
  return table
})()

/** CRC-32(IEEE 802.3。zlib・C# の一般的な実装と同じ多項式)を符号付き int32 で返す。 */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) | 0
}

function escapeField(text: string): string {
  return text.replace(/%/g, '%25').replace(/\t/g, '%09').replace(/\n/g, '%0A').replace(/\r/g, '%0D')
}

function floatBitsHex(value: number): string {
  const view = new DataView(new ArrayBuffer(4))
  view.setFloat32(0, value, false)
  return view.getUint32(0, false).toString(16).padStart(8, '0')
}

function propText(prop: CatalogProp): string {
  const { arg } = prop
  // f は float32 のビット列で書く(10 進の最短表記は言語ごとに違い、C# と TS で同じ文字列にならないため)
  const text = arg.type === 'i' ? String(arg.value) : arg.type === 'f' ? floatBitsHex(arg.value) : escapeField(arg.value)
  return `${prop.key}=${arg.type}:${text}`
}

function compareBytes(a: string, b: string): number {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  return Buffer.compare(left, right)
}

/**
 * 要約値の元になる正規形。アドレスの UTF-8 バイト順に並べ、1 項目を 1 行(末尾は LF)にする。
 * 行は `address TAB kind TAB type` に、キー順(UTF-8 バイト順。同じキーは送られた順)に並べた `key=T:value` を TAB で続ける。
 * 文字列は % TAB LF CR だけを %XX にする。docs/UNITY_PROTOCOL.md の「設計図の要約値」と同じ規則で、C# も同じ文字列を作る。
 */
export function canonicalCatalogText(items: readonly CatalogItem[]): string {
  const sorted = [...items].sort((a, b) => compareBytes(a.address, b.address))
  return sorted.map(item => {
    const props = item.props
      .map((prop, index) => ({ prop, index }))
      .sort((a, b) => compareBytes(a.prop.key, b.prop.key) || a.index - b.index)
      .map(entry => propText(entry.prop))
    return [escapeField(item.address), escapeField(item.kind), escapeField(item.type), ...props].join('\t') + '\n'
  }).join('')
}

export function catalogDigest(items: readonly CatalogItem[]): CatalogDigest {
  return { count: items.length, crc: crc32(Buffer.from(canonicalCatalogText(items), 'utf8')) }
}

/** `/sys/catalog/add` の引数 `<address> <kind> <type> [key value]…` を項目にする。読めなければ理由を返す。 */
export function parseCatalogAdd(args: readonly OscArg[]): { ok: true; item: CatalogItem } | { ok: false; reason: string } {
  const [address, kind, type, ...rest] = args
  if (address?.type !== 's' || kind?.type !== 's' || type?.type !== 's') return { ok: false, reason: 'address, kind and type must be strings' }
  if (rest.length % 2 !== 0) return { ok: false, reason: 'properties must be key/value pairs' }
  const props: unknown[] = []
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index]!
    const value = rest[index + 1]!
    if (key.type !== 's') return { ok: false, reason: 'property key must be a string' }
    if (value.type === 'b') return { ok: false, reason: 'property value must be i, f or s' }
    props.push({ key: key.value, arg: { type: value.type, value: value.value } })
  }
  const parsed = CatalogItemSchema.safeParse({ address: address.value, kind: kind.value, type: type.value, props })
  return parsed.success ? { ok: true, item: parsed.data } : { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid item' }
}

/** 項目を `/sys/catalog/add` の引数に直す(mock-unity と C# の送信側の見本)。 */
export function catalogAddArgs(item: CatalogItem): OscArg[] {
  return [
    { type: 's', value: item.address },
    { type: 's', value: item.kind },
    { type: 's', value: item.type },
    ...item.props.flatMap((prop): OscArg[] => [{ type: 's', value: prop.key }, { type: prop.arg.type, value: prop.arg.value } as OscArg]),
  ]
}

export const CatalogPcSchema = z.object({
  host: z.string().min(1),
  name: z.string().min(1).max(CATALOG.MAX_NAME_CHARS),
  receivedAt: z.string().datetime({ offset: true }),
  // 要約値の照合結果。true = 一致、false = 食い違い(Sync で取り直す)、null = まだ照合していない
  verified: z.boolean().nullable(),
  items: z.array(CatalogItemSchema),
}).strict()

export type CatalogPc = z.infer<typeof CatalogPcSchema>
