// 主画面(サーフェスの操作画面。HID-464・D-141)の、DOM と接続を持たない規則。
//
// 部品の種類・ラベル・取り直しのボタン・レコード表の列・アクションの対象の展開はブリッジが部品の木(surface.view。D-124)で
// 決めて配るので、ここには写さない。ここが持つのは操作の手触り(操作中の保護・送信の間引き・下書き)と、表示キャッシュの値と
// JSON の値の出し入れ、まとめ送りのエコーの照合だけ(NiceGUI 版の value_store・surface_model の値の部分・entry_rules・
// state/echo_match・state/records の行の並びに当たる)。
//
// CLAUDE.md の絶対規律「値の正は OscDesk(ブリッジ)が持つ。UI は表示キャッシュ」の UI 側の層で、値の正は保持値(desired)。
// - 操作中(hold)は自分の値を表示し、エコーと保持値の配り直しは「離したときに戻る値」(編集前の値)だけを差し替える
// - 指を離したらエコー(と保持値)が正になる
// - 連続操作の送信は間引き、最後の値だけは必ず送る(取りこぼすと Unity と食い違う)

import { signal, type ReadonlySignal } from '@preact/signals'

import { OSC_BATCH, type ParamValue, type ViewAction, type ViewControl, type ViewRecord } from '@oscdesk/shared'

export type Scalar = number | string | boolean
/** 表示キャッシュの値。1 つの値の部品は要素 1 個の組、組み合わせの型(D-121)はフィールドの値を宣言順に並べた組。 */
export type Values = readonly Scalar[]

/** 連続操作(スライダー)の送信の最短の間隔(NiceGUI 版の DEFAULT_MIN_SEND_INTERVAL_S と同じ 30 Hz)。 */
export const MIN_SEND_INTERVAL_MS = 1000 / 30
/** ポインタの解放を取りこぼしても、いつまでもエコーを無視し続けないための保険。 */
export const HOLD_TIMEOUT_MS = 2_000
/**
 * 入力欄の操作の期限。フォーカス中は store の tick が延長し続けるので通常は切れない。タブが止まった(閉じた・眠った)のに
 * blur が届かなかったときに、操作中の印が残り続けないようにする保険
 */
export const INPUT_HOLD_TIMEOUT_MS = 120_000
/** 操作中のロック(HID-378)の延長の間隔。期限(LOCK.LEASE_MS = 2 秒)より十分短くし、1 回取りこぼしても切れないようにする。 */
export const LOCK_RENEW_INTERVAL_MS = 500
/** まとめ送りのエコー待ち。LAN 内の往復に十分で、押した直後の失敗に気づける長さ。 */
export const ACTION_ECHO_TIMEOUT_MS = 2_000
/** 値の無い・時間切れの保留を見て回る間隔(NiceGUI 版のページの同期タイマーと同じ 20 Hz)。 */
export const TICK_MS = 50

export const OSC_BATCH_MAX_MESSAGES = OSC_BATCH.MAX_MESSAGES

export function holdTimeoutOf(widget: string | undefined): number {
  return widget === 'input' ? INPUT_HOLD_TIMEOUT_MS : HOLD_TIMEOUT_MS
}

export function sameTuple(a: Values | null, b: Values | null): boolean {
  if (a === b) return true
  if (a === null || b === null || a.length !== b.length) return false
  return a.every((value, index) => value === b[index])
}

/**
 * 1 つのパラメータ(またはレコードの 1 行)の表示値と送信の状態(NiceGUI 版の ValueChannel)。表示値は signal に持ち、
 * 部品は shown を読むだけで描き直される
 */
export class ValueChannel {
  readonly key: string
  readonly minSendIntervalMs: number
  private readonly current = signal<Values | null>(null)
  holding = false
  holdStartedAt: number | null = null
  holdTimeoutMs = HOLD_TIMEOUT_MS
  draft: string | null = null
  preEditValues: Values | null = null
  private pending: Values | null = null
  private lastSentAt: number | null = null

  constructor(key: string, minSendIntervalMs = MIN_SEND_INTERVAL_MS) {
    this.key = key
    this.minSendIntervalMs = minSendIntervalMs
  }

  get shown(): ReadonlySignal<Values | null> {
    return this.current
  }

  get values(): Values | null {
    return this.current.peek()
  }

  /** 間引きで保留した、まだ送っていない値があるか。 */
  get hasPending(): boolean {
    return this.pending !== null
  }

  beginHold(now: number, timeoutMs = HOLD_TIMEOUT_MS): void {
    if (!this.holding) this.preEditValues = this.values
    this.holding = true
    this.holdStartedAt = now
    this.holdTimeoutMs = timeoutMs
  }

  /**
   * 操作の終わり。間引きで保留していた最後の値があれば、間隔を無視して送る値として返す。
   * ホールドしていなければ何もしない(期限切れの後に届いた pointerup などで、表示を編集前の値へ戻さないため)
   */
  endHold(now: number): Values | null {
    if (!this.holding) return null
    this.holding = false
    this.holdStartedAt = null
    const values = this.takePending(now)
    this.finishHold(values)
    return values
  }

  /** 期限切れのホールドを解き、保留値があれば送る値として返す。期限の前なら何もしない。 */
  expireHold(now: number): Values | null {
    if (!this.holding || this.holdStartedAt === null) return null
    if (now - this.holdStartedAt < this.holdTimeoutMs) return null
    this.holding = false
    this.holdStartedAt = null
    const values = this.takePending(now)
    this.finishHold(values)
    return values
  }

  /** 送らずに打ち切る(画面の作り直し)。保留中の値と下書きを捨て、表示は編集前の値へ戻す。 */
  cancelHold(): void {
    if (!this.holding) return
    this.holding = false
    this.holdStartedAt = null
    this.pending = null
    this.finishHold(null)
  }

  /** 入力中の文字(下書き)。ホールドの外では受けない(部品を描き直しても打ちかけの文字を戻せるように持つ)。 */
  setDraft(raw: string): void {
    if (this.holding) this.draft = raw
  }

  /** 連続操作の値。送る値を返す(間引くなら null。間引いた値は flushDue か endHold が送る)。 */
  onLocal(values: Values, now: number): Values | null {
    this.setValues(values)
    if (this.lastSentAt !== null && now - this.lastSentAt < this.minSendIntervalMs) {
      this.pending = values
      return null
    }
    this.pending = null
    this.lastSentAt = now
    return values
  }

  /** トグル・選択・入力の確定のような離散の操作。間引かずに必ず送る。 */
  onLocalImmediate(values: Values, now: number): Values {
    this.setValues(values)
    this.pending = null
    this.lastSentAt = now
    this.draft = null
    // このホールドの確定なので、離したときに編集前の値へ戻さない
    this.preEditValues = values
    return values
  }

  flushDue(now: number): Values | null {
    if (this.pending === null) return null
    if (this.lastSentAt !== null && now - this.lastSentAt < this.minSendIntervalMs) return null
    return this.takePending(now)
  }

  /** エコー・保持値。操作中は表示を変えず、離したときに戻る値だけを差し替える。表示を変えたら true。 */
  onEcho(values: Values): boolean {
    if (this.holding) {
      this.preEditValues = values
      return false
    }
    return this.setValues(values)
  }

  /** 操作中の表示を差し替える(レコードの行で、操作していない欄にだけエコーを映すため)。 */
  showDuringHold(values: Values): boolean {
    if (!this.holding) return false
    return this.setValues(values)
  }

  /** 送信途中の状態を捨てる(切断。古い値を後から流さない)。 */
  resetSendState(): void {
    this.pending = null
    this.lastSentAt = null
  }

  /** 表示値を消す(保持値の全量に値が無い)。操作中は表示を据え置き、離したときに消えるようにする。 */
  clear(): boolean {
    if (this.holding) {
      this.preEditValues = null
      return false
    }
    if (this.values === null) return false
    this.current.value = null
    return true
  }

  /** 定義の default を入れる。値があれば残す(続く desired の全量で揃う)。操作中は値が無いときだけ。 */
  seed(values: Values): void {
    if (this.values === null) this.current.value = values
  }

  private takePending(now: number): Values | null {
    const pending = this.pending
    if (pending === null) return null
    this.pending = null
    this.lastSentAt = now
    return pending
  }

  private finishHold(sent: Values | null): void {
    if (sent === null && !sameTuple(this.preEditValues, this.values)) {
      this.current.value = this.preEditValues
    }
    this.draft = null
    this.preEditValues = null
  }

  private setValues(values: Values): boolean {
    if (sameTuple(this.values, values)) return false
    this.current.value = values
    return true
  }
}

/** キーごとの ValueChannel(NiceGUI 版の ValueStore)。パラメータは id、レコードの行は rowKey で引く。 */
export class ValueStore {
  private readonly channels = new Map<string, ValueChannel>()

  constructor(private readonly minSendIntervalMs = MIN_SEND_INTERVAL_MS) {}

  channel(key: string): ValueChannel {
    let channel = this.channels.get(key)
    if (channel === undefined) {
      channel = new ValueChannel(key, this.minSendIntervalMs)
      this.channels.set(key, channel)
    }
    return channel
  }

  get(key: string): ValueChannel | undefined {
    return this.channels.get(key)
  }

  valuesOf(key: string): Values | null {
    return this.channels.get(key)?.values ?? null
  }

  flushDue(now: number): [string, Values][] {
    const flushed: [string, Values][] = []
    for (const [key, channel] of this.channels) {
      const values = channel.flushDue(now)
      if (values !== null) flushed.push([key, values])
    }
    return flushed
  }

  /** 期限の切れたホールドを解く。解いたキーと、送る値(保留値が無ければ null)を返す。 */
  expireHolds(now: number): [string, Values | null][] {
    const released: [string, Values | null][] = []
    for (const [key, channel] of this.channels) {
      if (!channel.holding) continue
      const values = channel.expireHold(now)
      if (!channel.holding) released.push([key, values])
    }
    return released
  }

  cancelAllHolds(): string[] {
    const cancelled: string[] = []
    for (const channel of this.channels.values()) {
      if (!channel.holding) continue
      channel.cancelHold()
      cancelled.push(channel.key)
    }
    return cancelled
  }

  resetSendState(): void {
    for (const channel of this.channels.values()) channel.resetSendState()
  }

  /**
   * 保持値の全量で表示値を置き換える。keys のうち値の無いものは表示を消す(定義の再採用で値が決まり直らなかったパラメータに
   * 古い表示を残さない)。操作中は表示を据え置き、離したときに戻る値だけを差し替える
   */
  replaceAll(keys: Iterable<string>, values: ReadonlyMap<string, Values>): void {
    for (const key of keys) {
      const next = values.get(key)
      if (next === undefined) this.channels.get(key)?.clear()
      else this.channel(key).onEcho(next)
    }
  }
}

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
 * 入力欄の確定の検証(NiceGUI 版の validate_input_confirmation)。範囲外は寄せずに断る(寄せると打った値と違う値が送られる)。
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

export function formatValue(value: Scalar): string {
  if (typeof value === 'boolean') return value ? 'on' : 'off'
  if (typeof value === 'number' && !Number.isInteger(value)) return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
  return String(value)
}

export function formatValues(values: Values | null): string {
  return values === null ? '-' : values.map(formatValue).join(', ')
}

export function asNumber(value: Scalar | null | undefined): number | null {
  if (typeof value === 'boolean') return value ? 1 : 0
  return typeof value === 'number' ? value : null
}

export function asBool(value: Scalar | null | undefined): boolean | null {
  const number = asNumber(value)
  return number === null ? null : number !== 0
}

/** スライダーの刻み。定義の step、無ければ i は 1(小数を送るとブリッジの int32 の検査で断られる)、f は範囲の 1/1000。 */
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

/** 範囲 0〜1 の RGB(先頭 3 つ)を #rrggbb にする。 */
export function colorHex(values: readonly number[]): string {
  return `#${values.slice(0, 3).map((value) => Math.round(Math.min(Math.max(value, 0), 1) * 255).toString(16).padStart(2, '0')).join('')}`
}

/** 色の選択の値(#rgb / #rrggbb。末尾の不透明度は無視)を範囲 0〜1 の RGB にする。読めなければ null。 */
export function parseColorHex(text: string): [number, number, number] | null {
  if (!text.startsWith('#')) return null
  let digits = text.slice(1)
  if (digits.length === 3 || digits.length === 4) digits = [...digits.slice(0, 3)].map((digit) => digit + digit).join('')
  else if (digits.length === 6 || digits.length === 8) digits = digits.slice(0, 6)
  else return null
  if (!/^[0-9a-fA-F]{6}$/.test(digits)) return null
  return [0, 2, 4].map((index) => parseInt(digits.slice(index, index + 2), 16) / 255) as [number, number, number]
}

// これより狭くなる項目は折り返して次の行へ送る。スマホ幅(360px 前後)でも横スクロールを出さない(NiceGUI 版の layout と同じ)
export const MIN_ITEM_WIDTH_PX = 160

/** 行の子 1 件の flex の指定。数値の幅(12 分割)は残りの幅を比で分け合い、下限を割ると折り返す。 */
export function itemStyle(width: number | undefined): string {
  if (width === undefined) return `flex:1 1 ${MIN_ITEM_WIDTH_PX}px;min-width:min(100%,${MIN_ITEM_WIDTH_PX}px)`
  return `flex:${width} 1 0;min-width:min(100%,${MIN_ITEM_WIDTH_PX}px)`
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

// --- 操作中のロック(HID-378) --------------------------------------------------

/**
 * ほかのブラウザに出す持ち主の名前(ロックの label)。NiceGUI 版はページの IP を出していたが、SPA のページは自分の IP を
 * 知らないので、ブラウザの種類と端末の種類から短い名前を作る(D-142)
 */
export function holderLabel(userAgent: string): string {
  const device = /iPad/.test(userAgent) ? 'iPad'
    : /iPhone/.test(userAgent) ? 'iPhone'
      : /Android/.test(userAgent) ? 'Android'
        : /Windows/.test(userAgent) ? 'Windows'
          : /Mac OS X|Macintosh/.test(userAgent) ? 'Mac'
            : /Linux/.test(userAgent) ? 'Linux' : ''
  const browser = /Edg\//.test(userAgent) ? 'Edge'
    : /Firefox\//.test(userAgent) ? 'Firefox'
      : /Chrome\/|CriOS\//.test(userAgent) ? 'Chrome'
        : /Safari\//.test(userAgent) ? 'Safari' : ''
  const parts = [device, browser].filter((part) => part !== '')
  return parts.length === 0 ? 'ブラウザ' : `${parts.join(' の ')}`
}

/** このページの印(holder)。タブごとに振る(1 つのタブ = 1 本の WebSocket = 1 つのページ)。 */
export function newHolder(random: () => number = Math.random): string {
  let text = ''
  for (let index = 0; index < 16; index += 1) text += Math.floor(random() * 16).toString(16)
  return `spa-${text}`
}
