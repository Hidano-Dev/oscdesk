import {
  PAD_DOCUMENT,
  PAD_ROW_KEY_PATTERN,
  PROJECT_FILE,
  hasLoneSurrogate,
  isHoldingWidget,
  type OscArg,
  type PadArg,
  type PadCompositeWidget,
  type PadDocument,
  type PadField,
  type PadTableColumn,
  type PadTableWidget,
  type PadValue,
  type PadValueWidget,
} from '@oscdesk/shared'

// パッドの保持値(D-169)。サーフェス定義のパラメータに代わって、パッドの値を持つ部品(表は行と欄)を保持値の単位にする。
// 値は型タグの無い JSON の値で持ち、OSC の引数へは部品の型と値域から直す(判定の正はブリッジだけ。D-122)。
// I/O を持たない純粋な状態で、保存・送信・配信は pad-manager が受け持つ。
//
// 同じアドレスの値の部品(スライダーと数値の入力を並べる使い方。D-167 の限界)は、値を先に置いた部品(文書の widgets の
// 並びで最初の、表示だけでない値の部品)が持つ。後の部品の操作は、自分の値域で確かめたうえで持ち主の型で送り、持ち主の値に入れる。
// 同じアドレスへ 2 つの保持値を持つと、再送でどちらが後に届くかで食い違うため

type ValueHolder = PadValueWidget | PadCompositeWidget
/** 値を持つ操作(値の部品・組み合わせの引数・表の欄)の、送る型を決める欄だけ */
type Control = Pick<PadValueWidget | PadField | PadTableColumn, 'kind' | 'type'> & {
  min?: number | undefined
  max?: number | undefined
  maxLength?: number | undefined
  options?: readonly { value: number | string }[] | undefined
}

export type ArgsResult = { ok: true; args: OscArg[] } | { ok: false; reason: string }

export interface HeldWidgetValue { widget: string; address: string; value: PadValue }
export interface HeldCellValue { widget: string; key: string; column: string; address: string; value: PadValue }
/** 保存とプロジェクトの書き出しに使う全量 */
export interface PersistedPadValues { widgets: HeldWidgetValue[]; rows: HeldCellValue[] }

export interface PadValueEntries {
  widgets: { widget: string; value: PadValue }[]
  rows: { widget: string; key: string; column: string; value: PadValue }[]
}
export interface PadEchoEntries {
  widgets: { widget: string; value?: PadValue }[]
  rows: { widget: string; key: string; column: string; value?: PadValue }[]
}

/**
 * 値の変更の検査の結果。commit を呼んだときだけ保持値に入れる(送れなかった値を保持値に残さないよう、送ってから入れる)。
 * commit は変わったか(changed)と、配る部品ごとの値を返す
 */
export type PadSetResult =
  | { ok: true; address: string; args: OscArg[]; commit: () => { changed: boolean; entries: PadValueEntries } }
  | { ok: false; reason: string }

export const MAX_HELD_CELLS = PROJECT_FILE.MAX_HELD_ROWS
const INT32_MIN = -2_147_483_648
const INT32_MAX = 2_147_483_647

const fitsFloat32 = (value: number) => Number.isFinite(value) && Number.isFinite(Math.fround(value))
const isInt32 = (value: number) => Number.isInteger(value) && value >= INT32_MIN && value <= INT32_MAX
const isOscText = (value: string, max: number) => value.length <= max && !value.includes('\0') && !hasLoneSurrogate(value)

/** 表の 1 マスのアドレス(/<表のアドレス>/<行のキー>/<欄のアドレス>。D-164) */
export function cellAddress(table: Pick<PadTableWidget, 'address'>, key: string, relative: string): string {
  return `${table.address}/${key}/${relative}`
}

export function isRowKey(key: string): boolean {
  return PAD_ROW_KEY_PATTERN.test(key)
}

/**
 * プロジェクトファイル(版 3。D-172)の保持値(部品・行・欄の id と値)に、そのパッドでのアドレスを付ける。パッドに無い部品・
 * 値を持たない部品・欄に当たらないものは落とす(adopt が型・値域・行で確かめ直すので、ここは住所を引くだけ)
 */
export function withAddresses(pad: PadDocument, values: PadValueEntries): PersistedPadValues {
  const widgets = new Map(pad.widgets.map(widget => [widget.id, widget]))
  const result: PersistedPadValues = { widgets: [], rows: [] }
  for (const entry of values.widgets) {
    const widget = widgets.get(entry.widget)
    if (widget === undefined || !isHoldingWidget(widget) || widget.kind === 'table') continue
    result.widgets.push({ widget: widget.id, address: widget.address, value: entry.value })
  }
  for (const entry of values.rows) {
    const table = widgets.get(entry.widget)
    if (table?.kind !== 'table' || !isRowKey(entry.key)) continue
    const column = table.columns.find(candidate => candidate.id === entry.column)
    if (column === undefined) continue
    result.rows.push({ widget: table.id, key: entry.key, column: column.id, address: cellAddress(table, entry.key, column.address), value: entry.value })
  }
  return result
}

/** 決まった値(ボタン・表のアクション)の引数を OSC の引数にする。T / F は値を持たない型タグのまま送る(HID-492・D-167) */
export function padArgsToOsc(args: readonly PadArg[]): ArgsResult {
  return { ok: true, args: args.map(arg => ({ ...arg })) }
}

/** 1 つの値を、値を持つ操作の型と値域で 1 つの OSC の引数にする(組み合わせの型の引数・表の欄と、色以外の部品) */
function scalarArg(control: Control, value: PadValue): OscArg | string {
  const label = control.kind
  switch (control.kind) {
    case 'toggle':
      if (typeof value !== 'boolean') return `type-mismatch: ${label} expects a boolean`
      // bool は部品のアドレスの型に従う(D-167): T は OSC 1.0 の T / F の型タグ、i は 0 / 1(D-017)
      if (control.type === 'T') return { type: value ? 'T' : 'F' }
      return { type: 'i', value: value ? 1 : 0 }
    case 'slider':
    case 'number': {
      if (typeof value !== 'number') return `type-mismatch: ${label} expects a number`
      if (control.type === 'i' ? !isInt32(value) : !fitsFloat32(value)) return `type-mismatch: ${label} expects ${control.type === 'i' ? 'an int32' : 'a float32'}`
      if ((control.min !== undefined && value < control.min) || (control.max !== undefined && value > control.max)) return `out-of-range: ${String(value)}`
      return { type: control.type as 'i' | 'f', value }
    }
    case 'select': {
      const options = control.options ?? []
      if (!options.some(option => option.value === value)) return 'not-an-option'
      if (control.type === 's') return typeof value === 'string' ? { type: 's', value } : 'type-mismatch: select expects a string'
      if (typeof value !== 'number') return 'type-mismatch: select expects a number'
      return { type: control.type as 'i' | 'f', value }
    }
    case 'text':
      if (typeof value !== 'string') return 'type-mismatch: text expects a string'
      if (!isOscText(value, control.maxLength ?? PAD_DOCUMENT.MAX_STRING_CHARS)) return 'invalid-text'
      return { type: 's', value }
    default:
      return `type-mismatch: ${label} needs several arguments`
  }
}

/** 値を持つ部品・組み合わせの型の値を OSC の引数にする(型と値域を確かめる) */
export function holderArgs(widget: ValueHolder, value: PadValue): ArgsResult {
  if (widget.kind === 'composite') {
    if (!Array.isArray(value) || value.length !== widget.fields.length) return { ok: false, reason: `type-mismatch: ${widget.id} expects ${String(widget.fields.length)} values` }
    const args: OscArg[] = []
    for (const [index, field] of widget.fields.entries()) {
      const arg = scalarArg(field, value[index]!)
      if (typeof arg === 'string') return { ok: false, reason: `${arg} (${widget.id}.${field.id})` }
      args.push(arg)
    }
    return { ok: true, args }
  }
  if (widget.kind === 'color') {
    // ffff は 0〜1 の小数 4 つ。r(RGBA の 32 ビット)は wire と osc-codec がまだ運べない(T / F は HID-492 で運べるようになった)
    if (widget.type !== 'ffff') return { ok: false, reason: `unsupported-type: ${widget.type}` }
    if (!Array.isArray(value) || value.length !== 4 || !value.every(part => typeof part === 'number' && part >= 0 && part <= 1)) {
      return { ok: false, reason: `type-mismatch: ${widget.id} expects four numbers between 0 and 1` }
    }
    return { ok: true, args: (value as number[]).map(part => ({ type: 'f' as const, value: part })) }
  }
  if (Array.isArray(value)) return { ok: false, reason: `type-mismatch: ${widget.id} expects a single value` }
  const arg = scalarArg(widget, value)
  return typeof arg === 'string' ? { ok: false, reason: `${arg} (${widget.id})` } : { ok: true, args: [arg] }
}

/** 表の欄の値を OSC の引数にする */
export function columnArgs(column: PadTableColumn, value: PadValue): ArgsResult {
  if (Array.isArray(value)) return { ok: false, reason: `type-mismatch: ${column.id} expects a single value` }
  const arg = scalarArg(column, value)
  return typeof arg === 'string' ? { ok: false, reason: `${arg} (${column.id})` } : { ok: true, args: [arg] }
}

// f は float32 で往復するので、端の値はわずかに外へ出て返ることがある。float32 に丸めた端までは受けて端に寄せる
function withinRange(value: number, min: number | undefined, max: number | undefined, float: boolean): number | undefined {
  const low = min === undefined ? undefined : float ? Math.fround(min) : min
  const high = max === undefined ? undefined : float ? Math.fround(max) : max
  if ((low !== undefined && value < Math.min(low, min!)) || (high !== undefined && value > Math.max(high, max!))) return undefined
  if (min !== undefined && value < min) return min
  if (max !== undefined && value > max) return max
  return value
}

/** 受けた 1 つの引数を、操作の値として読む(エコーの表示用)。読めなければ undefined */
function scalarValue(control: Control, arg: OscArg | undefined): PadValue | undefined {
  if (arg === undefined) return undefined
  switch (control.kind) {
    case 'toggle':
      if (control.type === 'T') return arg.type === 'T' ? true : arg.type === 'F' ? false : undefined
      if (arg.type !== 'i' || (arg.value !== 0 && arg.value !== 1)) return undefined
      return arg.value === 1
    case 'slider':
    case 'number':
      if ((arg.type !== 'i' && arg.type !== 'f') || arg.type !== control.type || !Number.isFinite(arg.value)) return undefined
      return withinRange(arg.value, control.min, control.max, arg.type === 'f')
    case 'select': {
      if ((arg.type !== 'i' && arg.type !== 'f' && arg.type !== 's') || arg.type !== control.type) return undefined
      const received = arg.value
      const option = (control.options ?? []).find(candidate => arg.type === 'f' && typeof candidate.value === 'number'
        ? Math.fround(candidate.value) === Math.fround(received as number)
        : candidate.value === received)
      return option?.value
    }
    case 'text':
      return arg.type === 's' ? arg.value : undefined
    default:
      return undefined
  }
}

export function holderValue(widget: ValueHolder, args: readonly OscArg[]): PadValue | undefined {
  if (widget.kind === 'composite') {
    if (args.length !== widget.fields.length) return undefined
    const values: (boolean | number | string)[] = []
    for (const [index, field] of widget.fields.entries()) {
      const value = scalarValue(field, args[index])
      if (value === undefined || Array.isArray(value)) return undefined
      values.push(value)
    }
    return values
  }
  if (widget.kind === 'color') {
    if (widget.type !== 'ffff' || args.length !== 4) return undefined
    const parts: number[] = []
    for (const arg of args) {
      if (arg.type !== 'f') return undefined
      const part = withinRange(arg.value, 0, 1, true)
      if (part === undefined) return undefined
      parts.push(part)
    }
    return parts
  }
  return args.length === 1 ? scalarValue(widget, args[0]) : undefined
}

function columnValue(column: PadTableColumn, args: readonly OscArg[]): PadValue | undefined {
  return args.length === 1 ? scalarValue(column, args[0]) : undefined
}

// 保持値とエコーを比べる。f は float32 で往復するので丸めて比べる
function sameArgs(a: readonly OscArg[], b: readonly OscArg[]): boolean {
  if (a.length !== b.length) return false
  return a.every((arg, index) => {
    const other = b[index]!
    if (arg.type !== other.type) return false
    if (arg.type === 'f') return Math.fround(arg.value) === Math.fround((other as { value: number }).value)
    // T / F は型タグだけで値を持たない(型が同じなら同じ)
    if (arg.type === 'T' || arg.type === 'F') return true
    if (arg.type === 'b' || other.type === 'b' || other.type === 'T' || other.type === 'F') return false
    return arg.value === other.value
  })
}

const sameValue = (a: PadValue, b: PadValue) => JSON.stringify(a) === JSON.stringify(b)
const cellId = (widget: string, key: string, column: string) => `${widget}\u0000${key}\u0000${column}`

export interface PadValues {
  /**
   * パッドを採用し、保持値を from(保存した値か、同じパッドの今の値)で置き換える。今のパッドで成り立つものだけを残す:
   * 値の部品はアドレスに持ち主の部品があり、その型と値域で読める値。表のマスは同じ id の表と欄があり、アドレスが変わっておらず、
   * キーが正しく(UI で管理する行は一覧にあり)、欄の型と値域で読める値。落とした数を返す
   */
  adopt(pad: PadDocument, from: PersistedPadValues): number
  set(widgetId: string, value: PadValue): PadSetResult
  setCell(widgetId: string, key: string, columnId: string, value: PadValue): PadSetResult
  /** 表のアクションの送るもの(row は key の行、all は全行。ターゲットが持つ行は保持値にある行) */
  actionMessages(widgetId: string, actionId: string, key: string | undefined): { ok: true; messages: { address: string; args: OscArg[] }[] } | { ok: false; reason: string }
  /** 自動の再送と手動の同期で送るもの(「送り直す」の部品だけ。UI で管理する行の一覧を先に置く) */
  resendMessages(): { address: string; args: OscArg[] }[]
  /** 受けたエコーを部品の語彙に直し、保持値のある単位ごとに食い違うかを添える。当たる部品が無ければ空 */
  echo(address: string, args: readonly OscArg[]): PadEchoEntries & { checked: { unit: string; mismatch: boolean }[] }
  entries(): PadValueEntries
  snapshot(): PersistedPadValues
  /** 持ち主の部品ごとの値(プロジェクトファイルの書き出し。D-172)。同じアドレスの後の部品には載せない */
  snapshotEntries(): PadValueEntries
  /** ロックの単位が採用中のパッドにあるか */
  isLockable(widget: string, key?: string): boolean
  /**
   * そのアドレスへの送信が当たるパッドのロックの単位(同じアドレスの値の部品と、表の行。表の行は行の根の下のどのアドレスも
   * その行に当たる)。osc.message・osc.batch・表のアクションからパッドのロックを素通りさせないために使う
   */
  lockRefsOfAddress(address: string): ({ widget: string } | { widget: string; key: string })[]
  /** 値の部品の、ロックを確かめる単位(同じアドレスの部品すべて。どの部品からの操作も同じ保持値を書き換えるため) */
  lockWidgetsOf(widgetId: string): string[]
}

export function createPadValues(): PadValues {
  let pad: PadDocument | null = null
  // アドレス → 値を持つ部品(持ち主)と、同じアドレスの部品(持ち主を含む。表示だけの部品も載せる)
  let owners = new Map<string, ValueHolder>()
  let sharing = new Map<string, ValueHolder[]>()
  let widgetsById = new Map<string, PadDocument['widgets'][number]>()
  // 値は持ち主のアドレスで持つ(同じアドレスへ 2 つの値を持たない)
  let held = new Map<string, HeldWidgetValue>()
  let cells = new Map<string, HeldCellValue>()
  // 表ごとの保持値にある行のキー(ターゲットが持つ行の数の上限と、全行のアクションの送り先に使う)
  let rowKeys = new Map<string, Set<string>>()
  const noteRow = (widgetId: string, key: string) => {
    const keys = rowKeys.get(widgetId) ?? new Set<string>()
    keys.add(key)
    rowKeys.set(widgetId, keys)
  }

  const holderOf = (id: string): ValueHolder | undefined => {
    const widget = widgetsById.get(id)
    return widget !== undefined && isHoldingWidget(widget) && widget.kind !== 'table' ? widget : undefined
  }
  const tableOf = (id: string): PadTableWidget | undefined => {
    const widget = widgetsById.get(id)
    return widget?.kind === 'table' ? widget : undefined
  }
  const knownRow = (table: PadTableWidget, key: string) =>
    isRowKey(key) && (table.rows.source !== 'ui' || table.rows.keys.some(row => row.key === key))

  // 持ち主の値を、同じアドレスの部品すべての値として載せる
  const widgetEntries = (address: string, value: PadValue) =>
    (sharing.get(address) ?? []).map(widget => ({ widget: widget.id, value }))

  const index = (next: PadDocument) => {
    pad = next
    widgetsById = new Map(next.widgets.map(widget => [widget.id, widget]))
    owners = new Map()
    sharing = new Map()
    for (const widget of next.widgets) {
      if (!isHoldingWidget(widget) || widget.kind === 'table') continue
      sharing.set(widget.address, [...(sharing.get(widget.address) ?? []), widget])
      if (widget.readOnly !== true && !owners.has(widget.address)) owners.set(widget.address, widget)
    }
  }

  const keepWidget = (entry: HeldWidgetValue): HeldWidgetValue | null => {
    const owner = owners.get(entry.address)
    if (owner === undefined || !holderArgs(owner, entry.value).ok) return null
    return { widget: owner.id, address: entry.address, value: entry.value }
  }
  const keepCell = (entry: HeldCellValue): HeldCellValue | null => {
    const table = tableOf(entry.widget)
    const column = table?.columns.find(candidate => candidate.id === entry.column)
    if (table === undefined || column === undefined || !knownRow(table, entry.key)) return null
    if (cellAddress(table, entry.key, column.address) !== entry.address || !columnArgs(column, entry.value).ok) return null
    return { ...entry }
  }

  return {
    adopt(next, from) {
      index(next)
      held = new Map()
      cells = new Map()
      rowKeys = new Map()
      let dropped = 0
      for (const entry of from.widgets) {
        const kept = keepWidget(entry)
        if (kept === null || held.has(kept.address)) dropped += 1
        else held.set(kept.address, kept)
      }
      for (const entry of from.rows) {
        const kept = cells.size < MAX_HELD_CELLS ? keepCell(entry) : null
        const id = kept === null ? '' : cellId(kept.widget, kept.key, kept.column)
        const table = kept === null ? undefined : tableOf(kept.widget)
        const keys = kept === null ? undefined : rowKeys.get(kept.widget)
        const overTable = kept !== null && table?.rows.source === 'target' && !(keys?.has(kept.key) ?? false) && (keys?.size ?? 0) >= PAD_DOCUMENT.MAX_TABLE_ROWS
        if (kept === null || cells.has(id) || overTable) dropped += 1
        else {
          cells.set(id, kept)
          noteRow(kept.widget, kept.key)
        }
      }
      return dropped
    },

    set(widgetId, value) {
      const widget = holderOf(widgetId)
      if (widget === undefined) return { ok: false, reason: widgetsById.has(widgetId) ? `not-a-value-widget: ${widgetId}` : `unknown-widget: ${widgetId}` }
      if (widget.readOnly === true) return { ok: false, reason: `read-only: ${widgetId}` }
      // 操作した部品の値域で確かめてから、持ち主の型で送る(同じアドレスの型を 1 つに揃える)
      const own = holderArgs(widget, value)
      if (!own.ok) return own
      const owner = owners.get(widget.address)!
      const sent = owner === widget ? own : holderArgs(owner, value)
      if (!sent.ok) return { ok: false, reason: `owner-mismatch: ${owner.id} ${sent.reason}` }
      const address = widget.address
      return {
        ok: true, address, args: sent.args,
        commit: () => {
          const previous = held.get(address)
          held.set(address, { widget: owner.id, address, value })
          return { changed: previous === undefined || !sameValue(previous.value, value), entries: { widgets: widgetEntries(address, value), rows: [] } }
        },
      }
    },

    setCell(widgetId, key, columnId, value) {
      const table = tableOf(widgetId)
      if (table === undefined) return { ok: false, reason: widgetsById.has(widgetId) ? `not-a-table: ${widgetId}` : `unknown-widget: ${widgetId}` }
      const column = table.columns.find(candidate => candidate.id === columnId)
      if (column === undefined) return { ok: false, reason: `unknown-column: ${widgetId}.${columnId}` }
      if (!knownRow(table, key)) return { ok: false, reason: `unknown-row: ${widgetId}[${key}]` }
      const converted = columnArgs(column, value)
      if (!converted.ok) return converted
      const id = cellId(widgetId, key, columnId)
      // ターゲットが持つ行のキーは外から来るので、持てる数を超えたら新しい行を断る(保持値と保存が際限なく膨らまないように)
      if (!cells.has(id) && cells.size >= MAX_HELD_CELLS) return { ok: false, reason: `too-many-rows: limit ${String(MAX_HELD_CELLS)}` }
      // ターゲットが持つ行は 1 つの表で UI で管理する行と同じ数まで(全行のアクションが 1 回の押下で送る数を抑える)
      const keys = rowKeys.get(widgetId)
      if (table.rows.source === 'target' && !(keys?.has(key) ?? false) && (keys?.size ?? 0) >= PAD_DOCUMENT.MAX_TABLE_ROWS) {
        return { ok: false, reason: `too-many-rows: limit ${String(PAD_DOCUMENT.MAX_TABLE_ROWS)} per table` }
      }
      const address = cellAddress(table, key, column.address)
      return {
        ok: true, address, args: converted.args,
        commit: () => {
          const previous = cells.get(id)
          cells.set(id, { widget: widgetId, key, column: columnId, address, value })
          noteRow(widgetId, key)
          return { changed: previous === undefined || !sameValue(previous.value, value), entries: { widgets: [], rows: [{ widget: widgetId, key, column: columnId, value }] } }
        },
      }
    },

    actionMessages(widgetId, actionId, key) {
      const table = tableOf(widgetId)
      if (table === undefined) return { ok: false, reason: `unknown-widget: ${widgetId}` }
      const action = (table.actions ?? []).find(candidate => candidate.id === actionId)
      if (action === undefined) return { ok: false, reason: `unknown-action: ${widgetId}.${actionId}` }
      const args = padArgsToOsc(action.args)
      if (!args.ok) return args
      let keys: string[]
      if (action.scope === 'row') {
        if (key === undefined || !knownRow(table, key)) return { ok: false, reason: `unknown-row: ${widgetId}[${String(key)}]` }
        keys = [key]
      } else {
        // ターゲットが持つ行(source target)の一覧は OSCQuery の名前空間から来る(HID-488・HID-489)。それまでは保持値にある行
        keys = table.rows.source === 'ui'
          ? table.rows.keys.map(row => row.key)
          : [...(rowKeys.get(widgetId) ?? [])]
      }
      return { ok: true, messages: keys.map(row => ({ address: cellAddress(table, row, action.address), args: args.args.map(arg => ({ ...arg })) })) }
    },

    resendMessages() {
      if (pad === null) return []
      const messages: { address: string; args: OscArg[] }[] = []
      // UI で管理する行の一覧は行の並びと削除をターゲットへ伝えるので、行の値より先に送る(D-075 と同じ)
      for (const widget of pad.widgets) {
        if (widget.kind === 'table' && widget.rows.source === 'ui' && widget.rows.keysAddress !== undefined) {
          messages.push({ address: widget.rows.keysAddress, args: widget.rows.keys.map(row => ({ type: 's' as const, value: row.key })) })
        }
      }
      for (const widget of pad.widgets) {
        if (!isHoldingWidget(widget) || widget.kind === 'table') continue
        if (owners.get(widget.address) !== widget || !widget.resend) continue
        const value = held.get(widget.address)
        if (value === undefined) continue
        const args = holderArgs(widget, value.value)
        if (args.ok) messages.push({ address: widget.address, args: args.args })
      }
      for (const widget of pad.widgets) {
        if (widget.kind !== 'table') continue
        for (const cell of cells.values()) {
          if (cell.widget !== widget.id) continue
          const column = widget.columns.find(candidate => candidate.id === cell.column)
          if (column === undefined || !column.resend) continue
          const args = columnArgs(column, cell.value)
          if (args.ok) messages.push({ address: cell.address, args: args.args })
        }
      }
      return messages
    },

    echo(address, args) {
      const result: PadEchoEntries & { checked: { unit: string; mismatch: boolean }[] } = { widgets: [], rows: [], checked: [] }
      if (pad === null) return result
      const widgets = sharing.get(address)
      if (widgets !== undefined) {
        const owner = owners.get(address) ?? widgets[0]!
        const value = holderValue(owner, args)
        for (const widget of widgets) result.widgets.push(value === undefined ? { widget: widget.id } : { widget: widget.id, value })
        const own = held.get(address)
        if (own !== undefined) {
          const expected = holderArgs(owner, own.value)
          if (expected.ok) result.checked.push({ unit: owner.id, mismatch: !sameArgs(expected.args, args) })
        }
      }
      for (const table of pad.widgets) {
        if (table.kind !== 'table' || !address.startsWith(`${table.address}/`)) continue
        const rest = address.slice(table.address.length + 1)
        const slash = rest.indexOf('/')
        if (slash <= 0) continue
        const key = rest.slice(0, slash)
        const column = table.columns.find(candidate => candidate.address === rest.slice(slash + 1))
        if (column === undefined || !knownRow(table, key)) continue
        const value = columnValue(column, args)
        result.rows.push(value === undefined ? { widget: table.id, key, column: column.id } : { widget: table.id, key, column: column.id, value })
        const own = cells.get(cellId(table.id, key, column.id))
        if (own !== undefined) {
          const expected = columnArgs(column, own.value)
          if (expected.ok) result.checked.push({ unit: `${table.id}[${key}].${column.id}`, mismatch: !sameArgs(expected.args, args) })
        }
      }
      return result
    },

    entries() {
      return {
        widgets: [...held.values()].flatMap(entry => widgetEntries(entry.address, entry.value)),
        rows: [...cells.values()].map(cell => ({ widget: cell.widget, key: cell.key, column: cell.column, value: cell.value })),
      }
    },

    snapshot() {
      return { widgets: [...held.values()].map(entry => ({ ...entry })), rows: [...cells.values()].map(cell => ({ ...cell })) }
    },

    isLockable(widgetId, key) {
      if (key === undefined) return holderOf(widgetId) !== undefined
      const table = tableOf(widgetId)
      return table !== undefined && knownRow(table, key)
    },

    snapshotEntries() {
      return {
        widgets: [...held.values()].map(entry => ({ widget: entry.widget, value: entry.value })),
        rows: [...cells.values()].map(cell => ({ widget: cell.widget, key: cell.key, column: cell.column, value: cell.value })),
      }
    },

    lockRefsOfAddress(address) {
      if (pad === null) return []
      const refs: ({ widget: string } | { widget: string; key: string })[] = (sharing.get(address) ?? []).map(widget => ({ widget: widget.id }))
      for (const table of pad.widgets) {
        if (table.kind !== 'table' || !address.startsWith(`${table.address}/`)) continue
        const rest = address.slice(table.address.length + 1)
        const slash = rest.indexOf('/')
        const key = slash <= 0 ? rest : rest.slice(0, slash)
        if (isRowKey(key)) refs.push({ widget: table.id, key })
      }
      return refs
    },

    lockWidgetsOf(widgetId) {
      const widget = holderOf(widgetId)
      if (widget === undefined) return [widgetId]
      // 別の部品をロックした持ち主の値を、同じアドレスの別の部品から書き換えさせない(操作した部品を先に見る)
      return [widgetId, ...(sharing.get(widget.address) ?? []).map(shared => shared.id).filter(id => id !== widgetId)]
    },
  }
}
