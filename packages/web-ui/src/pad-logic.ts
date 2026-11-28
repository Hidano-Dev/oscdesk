// パッドの主画面(版 2 の文書。D-167・D-170)を描くための、DOM と接続を持たない関数。
// 編集の規則と検証はブリッジ(pad-document-editor.ts)、値の型と値域の判定もブリッジ(pad-values.ts)にあり、ここには写さない。
// ここが持つのは、文書を格子に並べる・保持値を表示キャッシュの組にする・入力欄を押した場で直せるように手前で止める、だけ
// (送った後にもブリッジが断りうる)。上限の数は選択肢と入力欄の歯止めにだけ使う
import {
  OSC_PAD_FORMAT,
  PAD_DOCUMENT,
  PAD_DOCUMENT_VERSION,
  padTargetRowKeys,
  padTargetRows,
  type PadArg,
  type PadControl,
  type PadDocument,
  type PadDocumentEdit,
  type PadTableWidget,
  type PadValue,
  type PadWidget,
  type PadWidgetKind,
} from '@oscdesk/shared'

import { asNumber, type Scalar, type Values } from './value-channel'

/** 背景色の上で読める文字色(白か黒)。相対輝度で決める。 */
export function textColorFor(color: string): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color)
  if (match === null) return '#FFFFFF'
  const linear = (hex: string) => {
    const channel = parseInt(hex, 16) / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * linear(match[1]) + 0.7152 * linear(match[2]) + 0.0722 * linear(match[3])
  return luminance > 0.45 ? '#000000' : '#FFFFFF'
}

/** 画像のファイルのバイト列を base64 にする(種類と大きさの判定と data URL への変換はブリッジ。D-126)。 */
export function base64Of(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

export const DEFAULT_ROWS = 4
export const DEFAULT_COLUMNS = 4
export const DEFAULT_SAVE_NAME = 'pad'
export const DEFAULT_WIDGET_COLOR = '#546E7A'
/** 編集命令の答えを待つ上限。 */
export const EDIT_TIMEOUT_MS = 15_000
export const BUSY_MESSAGE = '前の変更を反映しています。反映してからもう一度操作してください'

export const KIND_LABELS: Record<PadWidgetKind, string> = {
  button: 'ボタン', toggle: 'トグル', slider: 'スライダー', select: '選択', number: '数値の入力', text: '文字の入力',
  color: '色', composite: '組み合わせ', table: '表',
}
/** 組み合わせの引数・表の欄に置ける種類 */
export const FIELD_KINDS = ['toggle', 'slider', 'select', 'number', 'text'] as const
/** 種類ごとに選べる値の型(pad-document.ts の controlShapes と同じ並び。判定はブリッジ) */
export const VALUE_TYPES: Record<string, readonly string[]> = {
  toggle: ['T', 'i'], slider: ['i', 'f'], select: ['i', 'f', 's'], number: ['i', 'f'], text: ['s'], color: ['ffff', 'r'],
}
export const ARG_TYPES = ['i', 'f', 's', 'T', 'F'] as const

export const ROW_CHOICES = Array.from({ length: PAD_DOCUMENT.MAX_ROWS }, (_, index) => index + 1)
export const COLUMN_CHOICES = Array.from({ length: PAD_DOCUMENT.MAX_COLUMNS }, (_, index) => index + 1)

/** 採用中のパッドが無いとき・「新規」の編集の出発点(空の格子)。 */
export function newPadDocument(rows: number = DEFAULT_ROWS, columns: number = DEFAULT_COLUMNS): PadDocument {
  return { format: OSC_PAD_FORMAT, version: PAD_DOCUMENT_VERSION, rows, columns, widgets: [] }
}

export function findWidget(pad: PadDocument, id: string): PadWidget | undefined {
  return pad.widgets.find((widget) => widget.id === id)
}

/** マス(行・列)を占める部品の表。広がりを持つ部品は占めるマスすべてに載る。格子の外のマスは載せない */
export function occupancy(pad: PadDocument): Map<string, PadWidget> {
  const cells = new Map<string, PadWidget>()
  for (const widget of pad.widgets) {
    // 格子の大きさで縛る(届いた文書は検証済みだが、広がりの数だけ回すので念のため上限で止める)
    const rowEnd = Math.min(widget.row + (widget.rowSpan ?? 1), pad.rows)
    const columnEnd = Math.min(widget.column + (widget.columnSpan ?? 1), pad.columns)
    for (let row = widget.row; row < rowEnd; row += 1) {
      for (let column = widget.column; column < columnEnd; column += 1) cells.set(cellName(row, column), widget)
    }
  }
  return cells
}

export function cellName(row: number, column: number): string {
  return `${String(row)},${String(column)}`
}

/** 左上から右へ、上から下へ見て最初の空きマス。無ければ null */
export function firstEmptyCell(pad: PadDocument): { row: number; column: number } | null {
  const cells = occupancy(pad)
  for (let row = 0; row < pad.rows; row += 1) {
    for (let column = 0; column < pad.columns; column += 1) if (!cells.has(cellName(row, column))) return { row, column }
  }
  return null
}

/** マスのインライン style(背景色・画像・文字色)。版 1 のボタンと同じ見た目 */
export function widgetCellStyle(widget: { color?: string; image?: string }): Record<string, string> {
  const color = widget.color ?? DEFAULT_WIDGET_COLOR
  const style: Record<string, string> = { backgroundColor: color, color: textColorFor(color) }
  if (widget.image !== undefined) style.backgroundImage = `url("${widget.image}")`
  return style
}

/** 部品の設定の写し(id と位置はマスに属するので写さない)。貼り付け(pasteSettings)に使う */
export function widgetSettings(widget: PadWidget): Record<string, unknown> {
  const { id: _id, row: _row, column: _column, rowSpan: _rowSpan, columnSpan: _columnSpan, ...settings } = widget
  return JSON.parse(JSON.stringify(settings)) as Record<string, unknown>
}

// --- 値 -------------------------------------------------------------------------------

/** 表のマスの表示キャッシュの鍵。部品の id・行のキー・欄の id はどれも NUL を含まないので区切りに使えば衝突しない */
export function cellKey(widget: string, key: string, column: string): string {
  return `${widget}\u0000${key}\u0000${column}`
}

/** 保持値を表示キャッシュの組にする(組み合わせの型と ffff の色は引数の並び、ほかは 1 つの値) */
export function valuesOfPadValue(value: PadValue): Values {
  return Array.isArray(value) ? value : [value]
}

/** 値が 1 つでなく引数の並びになる部品か */
export function isTupleWidget(widget: PadWidget): boolean {
  return widget.kind === 'composite' || (widget.kind === 'color' && widget.type === 'ffff')
}

/** 表示キャッシュの組を osc.padSet の値にする。組の形が合わなければ null(送らない) */
export function padValueOf(widget: PadWidget, values: Values): PadValue | null {
  if (widget.kind === 'composite') return values.length === widget.fields.length ? [...values] : null
  if (widget.kind === 'color' && widget.type === 'ffff') return values.length === 4 ? [...values] : null
  return values.length === 1 ? values[0]! : null
}

/** 値がまだ無い操作の既定の値(組み合わせの型で、触っていない引数を埋める)。ブリッジは値域の外を断るので値域の中から選ぶ */
export function defaultControlValue(control: PadControl): Scalar {
  switch (control.kind) {
    case 'toggle': return false
    case 'slider': return control.min ?? 0
    case 'select': return control.options?.[0]?.value ?? (control.type === 's' ? '' : 0)
    case 'number': {
      const min = control.min ?? Number.NEGATIVE_INFINITY
      const max = control.max ?? Number.POSITIVE_INFINITY
      return Math.min(Math.max(0, min), max)
    }
    default: return ''
  }
}

export type Confirmed = { ok: true; value: Scalar } | { ok: false; error: string }

const INT32_MIN = -2_147_483_648
const INT32_MAX = 2_147_483_647

/**
 * 数値・文字の入力欄の確定の検証。範囲外は寄せずに断る(寄せると打った値と違う値が送られる)。
 * 判定の正はブリッジ(送った後にも断られうる)で、ここは押した場で直せるように手前で止めるだけ
 */
export function validateControlInput(control: PadControl, raw: string): Confirmed {
  if (control.kind === 'text') {
    if (control.maxLength !== undefined && raw.length > control.maxLength) return { ok: false, error: `${String(control.maxLength)} 文字までです` }
    if (raw.length > PAD_DOCUMENT.MAX_STRING_CHARS) return { ok: false, error: `${String(PAD_DOCUMENT.MAX_STRING_CHARS)} 文字までです` }
    if (raw.includes('\u0000')) return { ok: false, error: 'NUL は送れません' }
    return { ok: true, value: raw }
  }
  const text = raw.trim()
  const value = text === '' ? Number.NaN : Number(text)
  if (control.type === 'i') {
    if (!Number.isInteger(value)) return { ok: false, error: '整数を入力してください' }
    if (value < INT32_MIN || value > INT32_MAX) return { ok: false, error: 'int32 の範囲の外です' }
  } else {
    if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value))) return { ok: false, error: '数を入力してください' }
  }
  if (control.min !== undefined && value < control.min) return { ok: false, error: `${String(control.min)} 以上にしてください` }
  if (control.max !== undefined && value > control.max) return { ok: false, error: `${String(control.max)} 以下にしてください` }
  return { ok: true, value }
}

/** 入力欄に出す文字。値が無ければ空。 */
export function inputTextOf(control: PadControl, value: Scalar | null | undefined): string {
  if (value === null || value === undefined) return ''
  if (control.kind === 'text') return String(value)
  return typeof value === 'number' ? String(value) : ''
}

/** スライダーの刻み。書いた step、無ければ i は 1(小数を送るとブリッジの int32 の検査で断られる)、f は範囲の 1/1000。 */
export function sliderStepOf(control: PadControl): number {
  if (control.step !== undefined) return control.step
  if (control.type === 'i') return 1
  const span = Math.abs((control.max ?? 1) - (control.min ?? 0))
  return span === 0 ? 0.01 : span / 1000
}

export function clampTo(control: PadControl, value: number): number {
  return Math.min(Math.max(value, control.min ?? Number.NEGATIVE_INFINITY), control.max ?? Number.POSITIVE_INFINITY)
}

/** 選択の候補のうち値が当たる位置(-1 は候補に無い)。数の候補は数として比べる(1 と 1.0 は同じ候補) */
export function optionIndex(control: PadControl, value: Scalar | null): number {
  if (value === null) return -1
  return (control.options ?? []).findIndex((option) => option.value === value || (typeof option.value === 'number' && asNumber(value) === option.value && typeof value !== 'boolean'))
}

// --- 表 -------------------------------------------------------------------------------

export interface TableRow { key: string; label: string }

/** ターゲットが持つ行(source: target)のキー。規則はブリッジの全行のアクションと共用する(shared の padTargetRowKeys。HID-500) */
export function targetRowKeys(table: Pick<PadTableWidget, 'address'>, addresses: Iterable<string>): string[] {
  return padTargetRowKeys(table.address, addresses)
}

/** 表に出す行。UI で管理する行は文書の一覧、ターゲットが持つ行は保持値にある行と名前空間から拾った行(先に保持値の順) */
export function tableRows(table: PadTableWidget, heldKeys: readonly string[], namespaceKeys: readonly string[]): TableRow[] {
  if (table.rows.source === 'ui') return table.rows.keys.map((row) => ({ key: row.key, label: row.label === '' ? row.key : row.label }))
  return padTargetRows(heldKeys, namespaceKeys).map((key) => ({ key, label: key }))
}

/** 一括トグル(全行を同じ値にする)の見せ方。全行がオンならオン、それ以外はオフで、混在なら注記を出す(D-094) */
export function bulkState(values: readonly (Values | null)[]): { on: boolean; mixed: boolean } {
  const states = new Set(values.map((row) => row !== null && row[0] === true))
  if (states.size === 0) states.add(false)
  return { on: states.size === 1 && states.has(true), mixed: states.size > 1 }
}

// --- 編集の入力欄 -----------------------------------------------------------------------

// 答えを待つ間に打ち続けられる入力欄の命令。どれも部品の id・引数・欄・行の並びを変えないので、答えを待つ間に届いた分を
// 欄ごとに最後の 1 つだけ預かって順に送っても、別の部品・引数に当たらない(構造を変える命令は D-123 と同じく断る)
const FIELD_OPS = new Set<PadDocumentEdit['op']>(['setLabel', 'setAddress', 'setColor', 'setArgValue', 'setRange', 'setStep', 'setOption', 'setRowLabel'])

function partName(part: unknown): string {
  if (typeof part !== 'object' || part === null) return ''
  if ('field' in part) return `f${String((part as { field: number }).field)}`
  if ('column' in part) return `c${String((part as { column: string }).column)}`
  if ('action' in part) return `a${String((part as { action: string }).action)}`
  return ''
}

/** 入力欄の命令なら欄を表す鍵、そうでなければ null。 */
export function fieldKey(edit: PadDocumentEdit): string | null {
  if (!FIELD_OPS.has(edit.op)) return null
  return fieldKeyOf(
    edit.op,
    'widget' in edit ? edit.widget : '',
    'part' in edit ? partName(edit.part) : '',
    'index' in edit ? edit.index : undefined,
    'key' in edit ? edit.key : undefined,
  )
}

/** 画面が欄の理由(store の fieldErrors)と打った文字を引く鍵。fieldKey と同じ形。 */
export function fieldKeyOf(op: PadDocumentEdit['op'], widget: string, part = '', index?: number, key?: string): string {
  return `${op}|${widget}|${part}|${index === undefined ? '' : String(index)}|${key ?? ''}`
}

export function partKeyOf(part: { field: number } | { column: string } | { action: string } | undefined): string {
  return partName(part)
}

/** 引数の値の入力欄に出す書き方(整数の f は 1.0。T / F は値を持たない)。 */
export function formatArg(arg: PadArg): string {
  if (arg.type === 'T' || arg.type === 'F') return ''
  if (arg.type === 'f' && Number.isInteger(arg.value)) return arg.value.toFixed(1)
  return String(arg.value)
}

/**
 * 編集命令に載せる値の文字列(選択肢の値など)。表示用の丸め(formatValue の小数 3 桁)をせず、ブリッジが読み直すと同じ値に戻る書き方にする。
 * 丸めると、表示名だけを変えた命令でも値が丸めた値に変わり、その選択肢の保持値まで捨てられる(PR #177 のレビュー)。JS の数の文字列は
 * 往復できる最短の表現で、指数表記もブリッジの数の読み取りが受ける
 */
export function editText(value: number | string): string {
  return typeof value === 'string' ? value : String(value)
}

/** 範囲・刻みの入力欄に出す書き方(無ければ空。往復できる表現) */
export function numberText(value: number | undefined): string {
  return value === undefined ? '' : String(value)
}

/** 2 つの値が同じ内容か(キーの並びに依らない)。保存・切り替えの応答の照合と、答えで作業コピーが変わったかに使う。 */
export function sameDocument(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const other = b as unknown[]
    return a.length === other.length && a.every((item, index) => sameDocument(item, other[index]))
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && sameDocument(left[key], right[key]))
}
