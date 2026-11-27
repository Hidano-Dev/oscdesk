import { z } from 'zod'

// OSCQuery(D-164・D-168)。ターゲットが HTTP の JSON で公開する HOST_INFO と名前空間を読み、パッドに置ける部品の候補
// (パレット)を作る。判定の正はブリッジで、SPA はパレットのフレームを受けるだけ(UI に判定の写しを持たせない)。
// OSCQuery の JSON はほかの道具も出すので、知らない属性(CLIPMODE・UNIT・TAGS など)は読み捨てる(strict にすると
// 仕様の範囲内の拡張で名前空間ごと読めなくなる)。読み捨てても、ここで決めた属性の型と値域は縛る

export const OSCQUERY = {
  /** mDNS のサービスの種類 */
  SERVICE_TYPE: '_oscjson._tcp.local',
  /** 起動 ID(D-164)。HOST_INFO の独自の拡張。起動ごとの GUID の文字列 */
  BOOT_ID_KEY: 'X_OSCDESK_BOOT_ID',
  /** HTTP の応答の大きさの上限(いまの設計図の上限と同じ 8 MiB を目安にした) */
  MAX_RESPONSE_BYTES: 8 * 1024 * 1024,
  /** 木の深さの上限(根を 0 とする)。再帰で読むので、深すぎる木でスタックを使い切らないように */
  MAX_DEPTH: 32,
  /** 1 つの名前空間で読むノードの上限 */
  MAX_NODES: 20_000,
  /** パレットに載せる部品の上限(下りのフレームを際限なく膨らませない) */
  MAX_PALETTE_ITEMS: 4_096,
  /** 未対応として一覧に載せる件数の上限 */
  MAX_UNSUPPORTED_ITEMS: 512,
  /** 1 つのターゲットの VALS の件数の上限(選択の選択肢) */
  MAX_VALS: 256,
  MAX_DESCRIPTION_CHARS: 256,
  MAX_STRING_CHARS: 256,
  MAX_ADDRESS_CHARS: 512,
  MAX_TYPE_CHARS: 32,
  MAX_TARGETS: 64,
} as const

// ---- HOST_INFO ----

const PortNumberSchema = z.number().int().min(1).max(65535)

/**
 * HOST_INFO(`GET /?HOST_INFO`)。OSC_IP は読まない(送り先は HTTP を取ったアドレス。複数の NIC の曖昧さを避ける。HID-484 §6.7)。
 * 型の合わない項目は無いものとして扱う(ほかの項目まで読めなくしない)
 */
export const OscQueryHostInfoSchema = z.object({
  NAME: z.string().max(OSCQUERY.MAX_STRING_CHARS).optional().catch(undefined),
  OSC_PORT: PortNumberSchema.optional().catch(undefined),
  OSC_TRANSPORT: z.string().max(16).optional().catch(undefined),
  WS_PORT: PortNumberSchema.optional().catch(undefined),
  EXTENSIONS: z.record(z.unknown()).optional().catch(undefined),
  [OSCQUERY.BOOT_ID_KEY]: z.string().min(1).max(64).optional().catch(undefined),
})
export type OscQueryHostInfo = z.infer<typeof OscQueryHostInfoSchema>

/** パスの変化を WebSocket で知らせてくれるか(HOST_INFO の EXTENSIONS。どれか 1 つでも true なら木を取り直すきっかけに使う) */
export const OSCQUERY_PATH_EXTENSIONS = ['PATH_CHANGED', 'PATH_ADDED', 'PATH_REMOVED', 'PATH_RENAMED'] as const

export function supportsPathEvents(hostInfo: OscQueryHostInfo): boolean {
  return OSCQUERY_PATH_EXTENSIONS.some(key => hostInfo.EXTENSIONS?.[key] === true)
}

// ---- パレット(SPA へ配る部品の候補) ----

export const PALETTE_KINDS = ['button', 'toggle', 'select', 'slider', 'number', 'text', 'color', 'composite'] as const
export type PaletteKind = typeof PALETTE_KINDS[number]

const RangeValueSchema = z.union([z.number().finite(), z.string().max(OSCQUERY.MAX_STRING_CHARS), z.boolean()])
export const PaletteRangeSchema = z.object({
  min: z.number().finite().nullable(),
  max: z.number().finite().nullable(),
  vals: z.array(RangeValueSchema).max(OSCQUERY.MAX_VALS).nullable(),
}).strict()
export type PaletteRange = z.infer<typeof PaletteRangeSchema>

/**
 * パレットの 1 項目(書けるノード 1 つ)。range は引数ごと(RANGE が無い引数・読めない引数は null)。
 * kind は推定した部品の種類の候補(HID-484 §5)。hold は保持して送り直す既定(ACCESS 3 なら true、2 なら送るだけ。D-165)
 */
export const PaletteItemSchema = z.object({
  address: z.string().min(2).max(OSCQUERY.MAX_ADDRESS_CHARS),
  type: z.string().max(OSCQUERY.MAX_TYPE_CHARS).nullable(),
  access: z.union([z.literal(2), z.literal(3)]),
  description: z.string().max(OSCQUERY.MAX_DESCRIPTION_CHARS).nullable(),
  extendedType: z.array(z.string().max(OSCQUERY.MAX_STRING_CHARS)).max(16).nullable(),
  range: z.array(PaletteRangeSchema.nullable()).max(OSCQUERY.MAX_TYPE_CHARS),
  kind: z.enum(PALETTE_KINDS),
  hold: z.boolean(),
}).strict()
export type PaletteItem = z.infer<typeof PaletteItemSchema>

/** 書けるが部品にできないノード(型が未対応など)。利用者に「出さなかったもの」を見せるため */
export const PaletteUnsupportedSchema = z.object({
  address: z.string().min(1).max(OSCQUERY.MAX_ADDRESS_CHARS),
  type: z.string().max(OSCQUERY.MAX_TYPE_CHARS).nullable(),
  reason: z.enum(['unsupported-type', 'invalid-address']),
}).strict()
export type PaletteUnsupported = z.infer<typeof PaletteUnsupportedSchema>

export interface Palette {
  items: PaletteItem[]
  unsupported: PaletteUnsupported[]
  /** 上限で切った件数(載せなかった項目の数) */
  dropped: number
}

// ---- 名前空間を読む ----

const AccessSchema = z.number().int().min(0).max(3)

// ノード 1 つの属性。CONTENTS の中身はここでは見ない(深さとノード数を数えながら下で辿る)
const NodeAttrsSchema = z.object({
  FULL_PATH: z.string().optional().catch(undefined),
  CONTENTS: z.record(z.unknown()).optional().catch(undefined),
  TYPE: z.string().optional().catch(undefined),
  ACCESS: AccessSchema.optional().catch(undefined),
  DESCRIPTION: z.string().optional().catch(undefined),
  EXTENDED_TYPE: z.union([z.string(), z.array(z.unknown())]).optional().catch(undefined),
  RANGE: z.unknown().optional(),
  // VALUE は読まない。値の無い VALUE は省略・[]・{} のどれでも来る(HID-484 §6.2)が、パレットは値を使わないので同じに扱える
})

/** 名前空間の木から取り出した、メソッド(TYPE を持つか、CONTENTS を持たない末端)のノード */
export interface OscQueryMethod {
  address: string
  type: string | null
  access: number | null
  description: string | null
  extendedType: string[] | null
  range: (PaletteRange | null)[]
}

export type NamespaceResult =
  | { ok: true; methods: OscQueryMethod[] }
  | { ok: false; reason: 'not-an-object' | 'too-deep' | 'too-many-nodes' }

/**
 * 名前空間の木(`GET /` の JSON)を辿ってメソッドを取り出す。属性のクエリ(`?VALUE` など)には頼らず、木の全体を読む
 * (未対応の属性への応答が 204 か 400 かで実装が割れているため。HID-484 §6.1)。深さとノード数が上限を超えたら読むのをやめる
 */
export function parseOscQueryNamespace(raw: unknown): NamespaceResult {
  if (!isPlainObject(raw)) return { ok: false, reason: 'not-an-object' }
  const methods: OscQueryMethod[] = []
  let count = 0
  // 再帰でなく明示のスタックで辿る(深さの上限があっても、深い再帰はテストの環境ごとに限界が違う)
  const stack: { node: Record<string, unknown>; path: string; depth: number }[] = [{ node: raw, path: '/', depth: 0 }]
  while (stack.length > 0) {
    const { node, path, depth } = stack.pop()!
    count += 1
    if (count > OSCQUERY.MAX_NODES) return { ok: false, reason: 'too-many-nodes' }
    if (depth > OSCQUERY.MAX_DEPTH) return { ok: false, reason: 'too-deep' }
    const attrs = NodeAttrsSchema.parse(node)
    // FULL_PATH を正とする(キーと食い違う実装があっても、ターゲットが受けるのは FULL_PATH)。無ければ親のパスとキーから作る
    const address = attrs.FULL_PATH ?? path
    const children = attrs.CONTENTS
    if (address !== '/' && (attrs.TYPE !== undefined || children === undefined)) {
      methods.push({
        address,
        type: attrs.TYPE ?? null,
        access: attrs.ACCESS ?? null,
        description: attrs.DESCRIPTION === undefined ? null : attrs.DESCRIPTION.slice(0, OSCQUERY.MAX_DESCRIPTION_CHARS),
        extendedType: normalizeExtendedType(attrs.EXTENDED_TYPE),
        range: normalizeRange(attrs.RANGE),
      })
    }
    if (children === undefined) continue
    // 並びを保つため逆順に積む
    for (const key of Object.keys(children).reverse()) {
      const child = children[key]
      if (!isPlainObject(child)) continue
      stack.push({ node: child, path: address === '/' ? `/${key}` : `${address}/${key}`, depth: depth + 1 })
    }
  }
  return { ok: true, methods }
}

function normalizeExtendedType(raw: unknown): string[] | null {
  if (raw === undefined) return null
  const list = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw : []
  const strings = list.filter((entry): entry is string => typeof entry === 'string').slice(0, 16)
    .map(entry => entry.slice(0, OSCQUERY.MAX_STRING_CHARS))
  return strings.length === 0 ? null : strings
}

// RANGE は引数ごとの配列が仕様だが、引数 1 つの実装は配列で包まずに 1 つのオブジェクトを出すことがあるので受ける
function normalizeRange(raw: unknown): (PaletteRange | null)[] {
  if (raw === undefined || raw === null) return []
  const list = Array.isArray(raw) ? raw : [raw]
  return list.slice(0, OSCQUERY.MAX_TYPE_CHARS).map(entry => {
    if (!isPlainObject(entry)) return null
    const min = finiteOrNull(entry.MIN)
    const max = finiteOrNull(entry.MAX)
    const vals = Array.isArray(entry.VALS)
      ? entry.VALS.filter(value => RangeValueSchema.safeParse(value).success).slice(0, OSCQUERY.MAX_VALS) as (number | string | boolean)[]
      : null
    if (min === null && max === null && vals === null) return null
    return { min, max, vals }
  })
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ---- ノードから部品の種類を推定する(HID-484 §5) ----

// 組み合わせ(2 文字以上の TYPE)の引数に使える型。これ以外の文字(h・d・t・b・[ ] や c・m・S など)を含む TYPE は出さない
const COMPOSITE_TAGS = new Set(['i', 'f', 's', 'T', 'F', 'r'])
const UNSUPPORTED_TAGS = new Set(['h', 'd', 't', 'b', '[', ']'])

/**
 * パスに使える文字か。OSCQuery のパスは ASCII に限る取り決め(HID-484 §6.9)で、OSC のアドレスのパターンの文字
 * (`?*[]{},#` と空白)はアドレスとしては送れないので候補にしない
 */
export function isPaletteAddress(address: string): boolean {
  return /^\/[\x21-\x7e]*$/.test(address)
    && address.length <= OSCQUERY.MAX_ADDRESS_CHARS
    && ![...address].some(character => '?*[]{},#'.includes(character))
    && !address.includes('//')
    && !address.endsWith('/')
}

/** 部品の種類を推定する。部品にできない TYPE なら null。 */
export function inferPaletteKind(type: string | null, range: readonly (PaletteRange | null)[], extendedType: readonly string[] | null): PaletteKind | null {
  if (type === null || type === '' || type === 'N' || type === 'I') return 'button'
  if ([...type].some(tag => UNSUPPORTED_TAGS.has(tag))) return null
  const first = range[0] ?? null
  const isColor = extendedType?.some(entry => entry.toLowerCase().includes('color')) ?? false
  if (type === 'r' || (type === 'ffff' && isColor)) return 'color'
  if (type === 'T' || type === 'F') return 'toggle'
  if (type.length === 1) {
    const hasVals = first?.vals !== null && first?.vals !== undefined && first.vals.length > 0
    if (type === 'i' && first !== null && isZeroOne(first)) return 'toggle'
    if ((type === 'i' || type === 'f' || type === 's') && hasVals) return 'select'
    if ((type === 'i' || type === 'f') && first?.min !== null && first?.min !== undefined && first.max !== null) return 'slider'
    if (type === 'i' || type === 'f') return 'number'
    if (type === 's') return 'text'
    return null
  }
  return [...type].every(tag => COMPOSITE_TAGS.has(tag)) ? 'composite' : null
}

function isZeroOne(range: PaletteRange): boolean {
  if (range.vals !== null && range.vals.length === 2) {
    const sorted = [...range.vals].sort()
    return sorted[0] === 0 && sorted[1] === 1
  }
  return range.vals === null && range.min === 0 && range.max === 1
}

/** 取り出したメソッドからパレットを作る。書けるもの(ACCESS が 2 か 3)だけを載せる */
export function buildPalette(methods: readonly OscQueryMethod[]): Palette {
  const items: PaletteItem[] = []
  const unsupported: PaletteUnsupported[] = []
  let dropped = 0
  for (const method of methods) {
    if (method.access !== 2 && method.access !== 3) continue
    const type = method.type === null ? null : method.type.slice(0, OSCQUERY.MAX_TYPE_CHARS)
    if (!isPaletteAddress(method.address)) {
      if (unsupported.length < OSCQUERY.MAX_UNSUPPORTED_ITEMS) unsupported.push({ address: method.address.slice(0, OSCQUERY.MAX_ADDRESS_CHARS) || '/', type, reason: 'invalid-address' })
      else dropped += 1
      continue
    }
    const kind = inferPaletteKind(type, method.range, method.extendedType)
    if (kind === null) {
      if (unsupported.length < OSCQUERY.MAX_UNSUPPORTED_ITEMS) unsupported.push({ address: method.address, type, reason: 'unsupported-type' })
      else dropped += 1
      continue
    }
    if (items.length >= OSCQUERY.MAX_PALETTE_ITEMS) {
      dropped += 1
      continue
    }
    items.push({
      address: method.address,
      type,
      access: method.access,
      description: method.description,
      extendedType: method.extendedType,
      range: method.range.slice(0, OSCQUERY.MAX_TYPE_CHARS),
      kind,
      hold: method.access === 3,
    })
  }
  return { items, unsupported, dropped }
}
