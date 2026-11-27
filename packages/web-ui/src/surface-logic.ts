// 主画面(サーフェスの操作画面。HID-464・D-141)の、DOM と接続を持たない規則。
//
// 部品の種類・ラベル・取り直しのボタン・レコード表の列・アクションの対象の展開はブリッジが部品の木(surface.view。D-124)で
// 決めて配るので、ここには写さない。ここが持つのは操作の手触り(操作中の保護・送信の間引き・下書き)と、表示キャッシュの値と
// JSON の値の出し入れ、まとめ送りのエコーの照合と、レコードの行の並びだけ。
//
// CLAUDE.md の絶対規律「値の正は OscDesk(ブリッジ)が持つ。UI は表示キャッシュ」の UI 側の層で、値の正は保持値(desired)。
// - 操作中(hold)は自分の値を表示し、エコーと保持値の配り直しは「離したときに戻る値」(編集前の値)だけを差し替える
// - 指を離したらエコー(と保持値)が正になる
// - 連続操作の送信は間引き、最後の値だけは必ず送る(取りこぼすと Unity と食い違う)

import { OSC_BATCH, type ParamValue, type ViewAction, type ViewControl, type ViewRecord } from '@oscdesk/shared'

import { asBool, type Scalar, type Values } from './value-channel'

// 値の手触りの規則はパッドの部品と共用するので value-channel.ts へ移した(D-170)。主画面の import はここから引き続き読める
export {
  HOLD_TIMEOUT_MS, INPUT_HOLD_TIMEOUT_MS, LOCK_RENEW_INTERVAL_MS, MIN_SEND_INTERVAL_MS, TICK_MS, ValueChannel, ValueStore,
  asBool, asNumber, colorHex, formatValue, formatValues, holdTimeoutOf, holderLabel, newHolder, parseColorHex, sameTuple,
  type Scalar, type Values,
} from './value-channel'

/** まとめ送りのエコー待ち。LAN 内の往復に十分で、押した直後の失敗に気づける長さ。 */
export const ACTION_ECHO_TIMEOUT_MS = 2_000

export const OSC_BATCH_MAX_MESSAGES = OSC_BATCH.MAX_MESSAGES

// --- 値と JSON の値 -----------------------------------------------------------

/** 基本型の値を型どおりの JSON の値に揃える(bool は true/false。0/1 への直しはブリッジ)。 */
export function jsonValue(spec: Pick<ViewControl, 'type'>, value: Scalar): Scalar {
  if (spec.type === 'bool') return typeof value === 'string' ? value !== '' : Boolean(value)
  if (spec.type === 'f') return Number(value)
  if (spec.type === 'i') return Math.trunc(Number(value))
  return value
}

/** 表示キャッシュの組を set・batch の値にする。組の形が合わなければ null(送らない)。 */
export function wireValue(spec: ViewControl, values: Values): ParamValue | null {
  if (spec.type === 'composite') {
    const fields = spec.fields ?? []
    if (values.length !== fields.length) return null
    return Object.fromEntries(fields.map((field, index) => [field.param, jsonValue(field, values[index]!)]))
  }
  if (values.length !== 1) return null
  return jsonValue(spec, values[0]!)
}

/**
 * desired・echo の値を表示キャッシュの組にする。形にできなければ null。型と値域の判定はブリッジが配る前に済ませている
 * (D-124)ので、形だけを見る(組み合わせの型はフィールドの揃ったオブジェクト、ほかは 1 つの値)
 */
export function valuesFromWire(spec: ViewControl, value: ParamValue | undefined): Values | null {
  if (value === undefined) return null
  if (spec.type !== 'composite') return typeof value === 'object' ? null : [value]
  if (typeof value !== 'object' || value === null) return null
  const fields = spec.fields ?? []
  const keys = Object.keys(value)
  if (keys.length !== fields.length || !fields.every((field) => Object.prototype.hasOwnProperty.call(value, field.param))) return null
  return fields.map((field) => value[field.param]!)
}

/** 定義の default を表示キャッシュの組にしたもの。state で default が無ければ null。 */
export function defaultValues(spec: ViewControl): Values | null {
  if (spec.kind !== 'state') return null
  if (spec.type === 'composite') {
    const fields = spec.fields ?? []
    return fields.every((field) => field.default !== undefined) ? fields.map((field) => field.default!) : null
  }
  return spec.default === undefined ? null : [spec.default]
}

/** trigger が押下で送る値(定義の value)。 */
export function triggerValues(spec: ViewControl): Values {
  if (spec.type === 'composite') return (spec.fields ?? []).map((field) => jsonValue(field, field.value ?? ''))
  return [jsonValue(spec, spec.value ?? '')]
}

// --- エコーの照合(まとめ送りの確認) -------------------------------------------

// Unity は float32 で受けて返すので、期待値も float32 へ丸めてから比べる。往復の揺れ(1〜2 ULP)だけを許し、
// 値の大きさに比例して緩む相対許容差は使わない。0 付近は ULP が極小で表示の丸めまで落とすので、絶対許容差だけ残す
const FLOAT32_MAX_ULP = 2
const FLOAT_TOLERANCE = 1e-4
const f32 = new Float32Array(1)
const i32 = new Int32Array(f32.buffer)

/** float32 を、大小の順と整数の大小の順が一致する整数へ写す(隣り合う float32 は 1 違う)。float32 で表せなければ null。 */
function float32Order(value: number): number | null {
  if (!Number.isFinite(Math.fround(value))) return null
  f32[0] = value
  const bits = i32[0]!
  return bits >= 0 ? bits : -0x80000000 - bits
}

function sameFloat32(want: number, got: number): boolean {
  const wantOrder = float32Order(want)
  const gotOrder = float32Order(got)
  if (wantOrder === null || gotOrder === null) return want === got
  if (Math.abs(want - got) <= FLOAT_TOLERANCE) return true
  return Math.abs(wantOrder - gotOrder) <= FLOAT32_MAX_ULP
}

const asNumberForMatch = (value: Scalar): number | null => (typeof value === 'boolean' ? (value ? 1 : 0) : typeof value === 'number' ? value : null)

/**
 * エコーの値が送った値と同じか。types は要素ごとの型(f なら float32 で比べる)。文字列は厳密に比べる(数値の文字列を
 * 数として読むと "1" が 1 で確認されてしまう)。整数同士は厳密に比べる(int32 は 2^24 を超えると float32 で別の値が同じになる)
 */
export function sameValues(expected: Values, actual: Values, types: readonly string[] = []): boolean {
  if (expected.length !== actual.length) return false
  return expected.every((want, index) => {
    const got = actual[index]!
    if (typeof want === 'string' || typeof got === 'string') return want === got
    const a = asNumberForMatch(want)
    const b = asNumberForMatch(got)
    if (a === null || b === null) return false
    if (types[index] !== 'f' && Number.isInteger(a) && Number.isInteger(b)) return a === b
    return sameFloat32(a, b)
  })
}

/** 照合に使う要素ごとの型。 */
export function matchTypes(spec: ViewControl): string[] {
  return spec.type === 'composite' ? (spec.fields ?? []).map((field) => field.type) : [spec.type]
}

// --- 入力欄 -----------------------------------------------------------------------

export type Confirmed = { ok: true; value: Scalar } | { ok: false; error: string }

/**
 * 入力欄の確定の検証。範囲外は寄せずに断る(寄せると打った値と違う値が送られる)。
 * 型と値域の判定の正はブリッジ(送った後にも断られうる)で、ここは押した場で直せるように手前で止めるだけ
 */
export function validateInput(spec: ViewControl, raw: string): Confirmed {
  if (spec.type === 's') {
    if (spec.options !== undefined && spec.optionsFrom === undefined && !spec.options.includes(raw)) {
      return { ok: false, error: 'value is not one of the declared options' }
    }
    return { ok: true, value: raw }
  }
  const text = raw.trim()
  const value = text === '' ? Number.NaN : Number(text)
  if (spec.type === 'i') {
    if (!Number.isInteger(value)) return { ok: false, error: 'an integer value is required' }
    if (value < -2_147_483_648 || value > 2_147_483_647) return { ok: false, error: 'integer value is outside the int32 range' }
  } else if (spec.type === 'f') {
    if (text === '' || Number.isNaN(value)) return { ok: false, error: 'a numeric value is required' }
    if (!Number.isFinite(value)) return { ok: false, error: 'value must be finite' }
  } else {
    return { ok: false, error: 'input widget requires type s, i, or f' }
  }
  if (spec.range !== undefined && (value < spec.range[0] || value > spec.range[1])) {
    return { ok: false, error: 'value is outside the declared range' }
  }
  return { ok: true, value }
}

/** 入力欄に出す文字。値が無ければ空。 */
export function inputText(spec: ViewControl, value: Scalar | null | undefined): string {
  if (value === null || value === undefined) return ''
  if (spec.type === 's') return String(value)
  return typeof value === 'number' ? String(value) : ''
}

// --- 表示 ---------------------------------------------------------------------------

export function sliderStep(spec: ViewControl): number {
  if (spec.step !== undefined) return spec.step
  if (spec.type === 'i') return 1
  const [low, high] = spec.range ?? [0, 1]
  const span = Math.abs(high - low)
  return span === 0 ? 0.01 : span / 1000
}

export function clamp(spec: ViewControl, value: number): number {
  if (spec.range === undefined) return value
  return Math.min(Math.max(value, spec.range[0]), spec.range[1])
}

export const NOT_IN_LIST_SUFFIX = '(一覧に無い)'

/**
 * select の見せ方。現在値が候補に無いときは消さずに表示だけで残す(保持値は一覧から消えても残る。D-053)。
 * Unity の一覧から来た欄では、一覧が届いた後だけ「一覧に無い」の印を付ける(届く前は無いと言えない)
 */
export function selectView(value: string | null, options: readonly string[], fromRuntime: boolean): { selected: string | null; display: string | null } {
  if (value === null) return { selected: null, display: null }
  if (options.includes(value)) return { selected: value, display: null }
  return { selected: null, display: fromRuntime ? `${value}${NOT_IN_LIST_SUFFIX}` : value }
}

// これより狭くなる項目は折り返して次の行へ送る。スマホ幅(360px 前後)でも横スクロールを出さない
export const MIN_ITEM_WIDTH_PX = 160

/** 行の子 1 件の flex の指定。数値の幅(12 分割)は残りの幅を比で分け合い、下限を割ると折り返す。 */
export function itemStyle(width: number | undefined): string {
  if (width === undefined) return `flex:1 1 ${MIN_ITEM_WIDTH_PX}px;min-width:min(100%,${MIN_ITEM_WIDTH_PX}px)`
  return `flex:${width} 1 0;min-width:min(100%,${MIN_ITEM_WIDTH_PX}px)`
}

// 画面の端から空ける幅
const MENU_MARGIN_PX = 8
// ボタンとメニューのあいだ
const MENU_GAP_PX = 2

export interface Box { readonly top: number; readonly bottom: number; readonly left: number; readonly right: number }
export interface Size { readonly width: number; readonly height: number }

/**
 * ボタンの下に出すメニューの画面上の位置(position: fixed の top・left。HID-478)。レコード表は横スクロールの領域
 * (overflow-y: hidden)の中にあるので、領域の中に絶対配置すると末尾の行のメニューが下で切れる。画面に対して置き、
 * 下に入りきらなければ上に開く。上下どちらにも入りきらなければ広い側に出して画面の中へ寄せる。横は画面の右端で左へ寄せる。
 */
export function menuPosition(anchor: Box, menu: Size, viewport: Size): { top: number; left: number } {
  const below = viewport.height - MENU_MARGIN_PX - (anchor.bottom + MENU_GAP_PX)
  const above = anchor.top - MENU_GAP_PX - MENU_MARGIN_PX
  let top: number
  if (menu.height <= below || below >= above) top = anchor.bottom + MENU_GAP_PX
  else top = anchor.top - MENU_GAP_PX - menu.height
  top = Math.max(MENU_MARGIN_PX, Math.min(top, viewport.height - MENU_MARGIN_PX - menu.height))
  const left = Math.max(MENU_MARGIN_PX, Math.min(anchor.left, viewport.width - MENU_MARGIN_PX - menu.width))
  return { top, left }
}

/**
 * メニューを開いたボタンがまだ見えているか(中心が画面の中にあり、clip(表のスクロール領域)があればその中にもある)。
 * 見えなくなったボタンのメニューを画面の端に寄せて残すと、どの行の削除か分からないまま押せてしまう(HID-478)。
 */
export function anchorVisible(anchor: Box, viewport: Size, clip?: Box): boolean {
  const x = (anchor.left + anchor.right) / 2
  const y = (anchor.top + anchor.bottom) / 2
  if (x < 0 || x > viewport.width || y < 0 || y > viewport.height) return false
  return clip === undefined || (x >= clip.left && x <= clip.right && y >= clip.top && y <= clip.bottom)
}

// --- レコード(D-064) ------------------------------------------------------------

/** レコードの 1 行の表示キャッシュのキー。レコード id は NUL を含まず、行のキーも NUL を送れないので区切りに使えば衝突しない。 */
export function rowKey(record: string, key: string): string {
  return `${record}\u0000${key}`
}

export interface RecordRow {
  /** 行を指す識別子(UI で管理する行では ID。D-087) */
  key: string
  /** 表示する名前(それ以外の行では key と同じ) */
  name: string
  listed: boolean
  /** 「一覧に無い」の印(一覧が届いていて、そこに無いキー) */
  marked: boolean
}

/**
 * 行の順: キーの一覧の順 → 一覧に無いが保持値を持つキーを desired に現れた順。
 * 一覧が一度も届いていない間は「一覧に無い」と言えないので印を付けない(D-056)
 */
export function recordRows(
  listed: readonly string[],
  desiredKeys: Iterable<string>,
  names: ReadonlyMap<string, string>,
  arrived: boolean,
): RecordRow[] {
  const rows = new Map<string, RecordRow>()
  for (const key of listed) if (!rows.has(key)) rows.set(key, { key, name: names.get(key) ?? key, listed: true, marked: false })
  for (const key of desiredKeys) if (!rows.has(key)) rows.set(key, { key, name: names.get(key) ?? key, listed: false, marked: arrived })
  return [...rows.values()]
}

export interface RecordTarget { record: string; key: string; fixed: { field: number; value: Scalar }[] }

/**
 * scope を持つアクションを行のキーごとの送信の対象へ展開する(ブリッジの resolveRecordActionSteps と同じ規則)。
 * 並びは行ごとに steps を定義順。上限(512 件)を超えた時点で打ち切るので、結果が上限を超えていたら呼び手は送らずに知らせる
 */
export function resolveRecordActionSteps(action: Extract<ViewAction, { scope: 'row' | 'all' }>, keys: readonly string[]): RecordTarget[] {
  const resolved: RecordTarget[] = []
  for (const key of keys) {
    for (const step of action.steps) {
      resolved.push({ record: step.record, key, fixed: step.fixed })
      if (resolved.length > OSC_BATCH_MAX_MESSAGES) return resolved
    }
  }
  return resolved
}

/** 行の値(宣言順)をフィールド id → JSON の値にする(setRow・batch の行)。 */
export function rowPayload(record: ViewRecord, values: Values): Record<string, Scalar> {
  return Object.fromEntries(record.fields.map((field, index) => [field.param, jsonValue(field, values[index]!)]))
}

/** 届いた行の値(フィールド id → 値)を宣言順に並べる。フィールドが揃わなければ null。 */
export function rowValues(record: ViewRecord, values: Readonly<Record<string, Scalar>>): Values | null {
  if (!record.fields.every((field) => Object.prototype.hasOwnProperty.call(values, field.param))) return null
  return record.fields.map((field) => values[field.param]!)
}

/** 一括トグル(D-073)の見せ方。全行がオンならオン、それ以外はオフで、混在なら注記を出す(D-094)。 */
export function toggleState(values: readonly (Values | null)[], fieldIndex: number): { on: boolean; mixed: boolean } {
  // 値の無い行はオンとは言えないのでオフとして数える(行が無ければオフ)
  const states = new Set(values.map((row) => row !== null && asBool(row[fieldIndex]) === true))
  if (states.size === 0) states.add(false)
  return { on: states.size === 1 && states.has(true), mixed: states.size > 1 }
}
