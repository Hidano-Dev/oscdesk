// 値の手触り(操作中の保護・送信の間引き・下書き)の規則(D-141 で主画面に置き、D-170 でパッドの部品と共用にするためにここへ移した)。
// DOM と接続を持たない。
//
// CLAUDE.md の絶対規律「値の正は OscDesk(ブリッジ)が持つ。UI は表示キャッシュ」の UI 側の層で、値の正は保持値。
// - 操作中(hold)は自分の値を表示し、エコーと保持値の配り直しは「離したときに戻る値」(編集前の値)だけを差し替える
// - 指を離したらエコー(と保持値)が正になる
// - 連続操作の送信は間引き、最後の値だけは必ず送る(取りこぼすとターゲットと食い違う)

import { signal, type ReadonlySignal } from '@preact/signals'

export type Scalar = number | string | boolean
/** 表示キャッシュの値。1 つの値の部品は要素 1 個の組、組み合わせの型はフィールドの値を宣言順に並べた組。 */
export type Values = readonly Scalar[]

/** 連続操作(スライダー)の送信の最短の間隔(30 Hz)。 */
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
/** 値の無い・時間切れの保留を見て回る間隔(20 Hz)。 */
export const TICK_MS = 50

export function holdTimeoutOf(widget: string | undefined): number {
  return widget === 'input' ? INPUT_HOLD_TIMEOUT_MS : HOLD_TIMEOUT_MS
}

export function sameTuple(a: Values | null, b: Values | null): boolean {
  if (a === b) return true
  if (a === null || b === null || a.length !== b.length) return false
  return a.every((value, index) => value === b[index])
}

/**
 * 1 つの部品(または表の 1 行・1 マス)の表示値と送信の状態。表示値は signal に持ち、
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

  /**
   * 送らずにすべて捨てる(定義・パッドの差し替え)。ホールドしていなくても間引いた値は残りうるので、ホールドの有無によらず送信待ちと
   * 下書きを捨てる。何か捨てたら true
   */
  discard(): boolean {
    const had = this.holding || this.pending !== null || this.draft !== null
    this.cancelHold()
    this.pending = null
    this.lastSentAt = null
    this.draft = null
    return had
  }
  /** 入力中の文字(下書き)。ホールドの外では受けない(部品を描き直しても打ちかけの文字を戻せるように持つ)。 */
  setDraft(raw: string): void {
    if (this.holding) this.draft = raw
  }

  /** 連続操作の値。送る値を返す(間引くなら null。間引いた値は flushDue か endHold が送る)。 */
  onLocal(values: Values, now: number): Values | null {
    this.touch(now)
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
    this.touch(now)
    this.setValues(values)
    this.pending = null
    this.lastSentAt = now
    this.draft = null
    // このホールドの確定なので、離したときに編集前の値へ戻さない
    this.preEditValues = values
    return values
  }

  /**
   * 操作が続いている印。ホールドの期限を延ばす(期限は「離したのに pointerup が届かなかった」放置された操作だけを捉える。
   * 延ばさないと、2 秒より長く動かし続けたスライダーのホールドが押したまま切れ、表示が前のエコーへ跳ねる。PR #158)
   */
  touch(now: number): void {
    if (this.holding) this.holdStartedAt = now
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

  /** 既定の値を入れる。値があれば残す(続く保持値の全量で揃う)。操作中は値が無いときだけ。 */
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

/** キーごとの ValueChannel。 */
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

  keys(): IterableIterator<string> {
    return this.channels.keys()
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

  /**
   * 差し替えで、すべてのチャンネルの操作を送らずに捨てる(ValueChannel.discard)。where を渡せば、それが true を返すキーだけ
   * (表示から消えた行。HID-475)。捨てたチャンネルの数を返す。
   */
  discardAll(where?: (key: string) => boolean): number {
    let count = 0
    for (const [key, channel] of this.channels) if ((where === undefined || where(key)) && channel.discard()) count += 1
    return count
  }

  resetSendState(): void {
    for (const channel of this.channels.values()) channel.resetSendState()
  }

  /**
   * where が true を返すチャンネルを捨てて回収する(表示から消えた表の行など)。操作中・送信待ちのものは残す(操作を黙って落とさない)。
   * 回収しないと、行が入れ替わるたびにチャンネルが増え続け、tick の走査が全履歴に広がる。回収した数を返す
   */
  remove(where: (key: string) => boolean): number {
    let count = 0
    for (const [key, channel] of [...this.channels]) {
      if (!where(key) || channel.holding || channel.hasPending) continue
      this.channels.delete(key)
      count += 1
    }
    return count
  }

  /**
   * 保持値の全量で表示値を置き換える。keys のうち値の無いものは表示を消す(再採用で値が決まり直らなかった部品に
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

/** 範囲 0〜1 の RGB(先頭 3 つ)を #rrggbb にする。 */
export function colorHex(values: readonly number[]): string {
  return `#${values.slice(0, 3).map((value) => Math.round(Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), 1) * 255).toString(16).padStart(2, '0')).join('')}`
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

// --- 操作中のロック(HID-378) --------------------------------------------------

/**
 * ほかのブラウザに出す持ち主の名前(ロックの label)。ページは自分の IP を
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

/**
 * ポインタの主の押下か(マウスの左ボタン・タッチ・ペンの先の接触。どれも button が 0)。pointerdown で送る部品は、
 * これが真のときだけ送信もホールドも始める。右・中クリックやペンのボタンで OSC の命令を送らないため(PR #158)
 */
export function isPrimaryPress(event: { button: number }): boolean {
  return event.button === 0
}
