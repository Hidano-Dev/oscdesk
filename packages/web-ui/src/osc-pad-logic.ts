// OSC パッド(D-080)の作業コピーを描くための読み取りだけの関数。
// 編集の規則と検証はブリッジの pad-editor.ts(D-126)にあり、ここには写さない。上限の数は選択肢と入力欄の歯止めにだけ使う
import { OSC_PAD, OSC_PAD_FORMAT, OSC_PAD_VERSION, type OscPad, type OscPadArg, type OscPadButton, type OscPadButtonSettings, type OscPadEdit } from '@oscdesk/shared'

export const DEFAULT_ROWS = 4
export const DEFAULT_COLUMNS = 4
export const DEFAULT_BUTTON_COLOR = '#546E7A'
export const DEFAULT_SAVE_NAME = 'pad'
export const ARG_TYPES = ['i', 'f', 's'] as const
/** 編集命令の答えを待つ上限。 */
export const EDIT_TIMEOUT_MS = 15_000

export const BUSY_MESSAGE = '前の変更を反映しています。反映してからもう一度操作してください'

/** 採用中のパッドが無いとき・「新規」の編集の出発点(空の格子)。 */
export function newPad(rows: number = DEFAULT_ROWS, columns: number = DEFAULT_COLUMNS): OscPad {
  return { format: OSC_PAD_FORMAT, version: OSC_PAD_VERSION, rows, columns, buttons: [] }
}

export function findButton(pad: OscPad, id: string): OscPadButton | undefined {
  return pad.buttons.find((button) => button.id === id)
}

export function buttonAt(pad: OscPad, row: number, column: number): OscPadButton | undefined {
  return pad.buttons.find((button) => button.row === row && button.column === column)
}

/** rows × columns の格子に収まらないボタン(実行中に表示の行数・列数を減らしたときに隠れるもの)。 */
export function buttonsOutside(pad: OscPad, rows: number, columns: number): OscPadButton[] {
  return pad.buttons.filter((button) => button.row >= rows || button.column >= columns)
}

/** ボタンの設定(ラベル・背景色・画像・アドレス・引数)の写し。id と位置はマスに属するので写さない。 */
export function buttonSettings(button: OscPadButton): OscPadButtonSettings {
  const settings: OscPadButtonSettings = { label: button.label, address: button.address, args: button.args.map((arg) => ({ ...arg })) }
  if (button.color !== undefined) settings.color = button.color
  if (button.image !== undefined) settings.image = button.image
  return settings
}

/** 引数の値の入力欄に出す書き方(整数の f は 1.0)。 */
export function formatArgValue(arg: OscPadArg): string {
  if (arg.type === 'f' && Number.isInteger(arg.value)) return arg.value.toFixed(1)
  return String(arg.value)
}

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

/** マスのインライン style(背景色・画像・文字色)。 */
export function cellStyle(button: OscPadButton): Record<string, string> {
  const color = button.color ?? DEFAULT_BUTTON_COLOR
  const style: Record<string, string> = { backgroundColor: color, color: textColorFor(color) }
  if (button.image !== undefined) style.backgroundImage = `url("${button.image}")`
  return style
}

/** 畳んだ「外観」の見出しの補足。設定済みの項目を畳んだままでも見えるようにする。 */
export function appearanceCaption(button: OscPadButton): string {
  const parts: string[] = []
  if (button.color !== undefined) parts.push(button.color)
  if (button.image !== undefined) parts.push('画像あり')
  return parts.join(' / ') || '既定'
}

/** 格子の大きさの選択肢。 */
export const ROW_CHOICES = Array.from({ length: OSC_PAD.MAX_ROWS }, (_, index) => index + 1)
export const COLUMN_CHOICES = Array.from({ length: OSC_PAD.MAX_COLUMNS }, (_, index) => index + 1)

// 答えを待つ間に打ち続けられる入力欄の命令。どれもボタンの id と引数の添字を変えないので、答えを待つ間に届いた分を
// 欄ごとに最後の 1 つだけ預かって順に送っても、別のボタン・引数に当たらない(構造を変える命令は D-123 と同じく断る)
const FIELD_OPS = new Set<OscPadEdit['op']>(['setLabel', 'setAddress', 'setColor', 'setArgValue'])

/** 入力欄の命令なら欄を表す鍵、そうでなければ null。 */
export function fieldKey(edit: OscPadEdit): string | null {
  if (!FIELD_OPS.has(edit.op)) return null
  return fieldKeyOf(edit.op, 'button' in edit ? edit.button : '', 'index' in edit ? edit.index : undefined)
}

/** 画面が欄の理由(store の fieldErrors)を引く鍵。fieldKey と同じ形。 */
export function fieldKeyOf(op: OscPadEdit['op'], button: string, index?: number): string {
  return `${op}|${button}|${index === undefined ? '' : String(index)}`
}

/** 2 つのパッドが同じ内容か(キーの並びに依らない)。保存・切り替えの応答の照合と、答えで作業コピーが変わったかに使う。 */
export function samePad(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const other = b as unknown[]
    return a.length === other.length && a.every((item, index) => samePad(item, other[index]))
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && samePad(left[key], right[key]))
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
