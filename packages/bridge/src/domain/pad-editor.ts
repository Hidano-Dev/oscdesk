import {
  hasLoneSurrogate,
  imageDataUrlBytes,
  OSC_PAD,
  OscPadStoredSchema,
  PARAMETER_ADDRESS_PATTERN,
  type OscPad,
  type OscPadArg,
  type OscPadButton,
  type OscPadButtonSettings,
  type OscPadEdit,
} from '@oscdesk/shared'

import { parseDecimal } from './surface-editor'

/**
 * OSC パッド(D-080)の編集の規則(D-126)。UI(osc_pad.py)から移した純粋関数で、作業コピーを複製して変えた新しいパッドを返す。
 * サーフェス定義の surface-editor.ts と同じ形で、失敗しても元のパッドは壊れず、呼び出し側(applyPadEdit)は保存と同じ検証
 * (OscPadStoredSchema。形・意味・JSON の大きさ)に通ったものだけを返す。理由の文言は画面にそのまま出す日本語
 */

export type PadEditResult = { ok: true; pad: OscPad } | { ok: false; detail: string }

/** 編集の規則に合わない(理由は画面にそのまま出す日本語) */
export class PadEditError extends Error {}

const INT32_MIN = -2147483648
const INT32_MAX = 2147483647
const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/
const ADDRESS_PATTERN = new RegExp(PARAMETER_ADDRESS_PATTERN)
// 標準の base64(パディング付き)だけを受ける。Buffer.from は読めない文字を黙って飛ばすので、先に形を確かめる
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const INTEGER_PATTERN = /^[+-]?\d(?:_?\d)*$/
const ARG_TYPES = ['i', 'f', 's'] as const
const DEFAULT_ARG_VALUES = { i: 0, f: 0, s: '' } as const
const KIB = 1024
const MIB = 1024 * 1024

// 画像の先頭バイトで種類を決める(ブラウザが付ける content type は当てにしない)。SVG は受けない(スクリプトを含められる)
const IMAGE_SIGNATURES: readonly (readonly [readonly number[], string])[] = [
  [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'image/png'],
  [[0xff, 0xd8, 0xff], 'image/jpeg'],
  [[0x47, 0x49, 0x46, 0x38, 0x37, 0x61], 'image/gif'],
  [[0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 'image/gif'],
]

function validate(candidate: unknown): PadEditResult {
  const parsed = OscPadStoredSchema.safeParse(candidate)
  if (!parsed.success) {
    return { ok: false, detail: `パッドとして不正です: ${parsed.error.issues.slice(0, 3).map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ')}` }
  }
  return { ok: true, pad: parsed.data }
}

/**
 * 作業コピーに編集を 1 つ当てて検証する(上り osc.padEdit。D-126)。作業コピーは UI が持ち、編集のたびに丸ごと送ってくる
 * (サーバーは編集中の状態を持たない)。作業コピーそのものが検証に通らなければ編集しない
 */
export function applyPadEdit(draft: unknown, edit: OscPadEdit): PadEditResult {
  const base = OscPadStoredSchema.safeParse(draft)
  if (!base.success) return { ok: false, detail: `作業中のパッドが不正です: ${base.error.issues[0]?.message ?? 'invalid'}` }
  let candidate: OscPad
  try {
    candidate = applyEdit(base.data, edit)
  } catch (error) {
    if (error instanceof PadEditError) return { ok: false, detail: error.message }
    throw error
  }
  return validate(candidate)
}

function applyEdit(pad: OscPad, edit: OscPadEdit): OscPad {
  switch (edit.op) {
    case 'addButton': return addButton(pad, edit.row, edit.column)
    case 'removeButton': return replaceButton(pad, requireButton(pad, edit.button).id, null)
    case 'pasteSettings': return pasteSettings(pad, edit.button, edit.settings)
    case 'setLabel': return setLabel(pad, edit.button, edit.label)
    case 'setColor': return setColor(pad, edit.button, edit.color)
    case 'setAddress': return setAddress(pad, edit.button, edit.address)
    case 'setImage': return setImage(pad, edit.button, edit.data)
    case 'addArg': return addArg(pad, edit.button, edit.type)
    case 'removeArg': return withArgs(pad, edit.button, edit.index, args => { args.splice(edit.index, 1) })
    case 'moveArg': return moveArg(pad, edit.button, edit.index, edit.delta)
    case 'setArgType': return setArgType(pad, edit.button, edit.index, edit.type)
    case 'setArgValue': return withArgs(pad, edit.button, edit.index, (args, arg) => { args[edit.index] = typedArg(arg.type, parseArgValue(arg.type, edit.raw)) })
    case 'resize': return resize(pad, edit.rows, edit.columns)
  }
}

// --- ボタン -------------------------------------------------------------------

function requireButton(pad: OscPad, buttonId: string): OscPadButton {
  const button = pad.buttons.find(candidate => candidate.id === buttonId)
  if (button === undefined) throw new PadEditError(`ボタン ${buttonId} がありません`)
  return button
}

/** buttonId のボタンを button に置き換える(null なら外す)。並びは保つ */
function replaceButton(pad: OscPad, buttonId: string, button: OscPadButton | null): OscPad {
  const result = structuredClone(pad)
  result.buttons = result.buttons.flatMap(current => current.id !== buttonId ? [current] : button === null ? [] : [structuredClone(button)])
  return result
}

function nextButtonId(pad: OscPad): string {
  const existing = new Set(pad.buttons.map(button => button.id))
  let number = 1
  while (existing.has(`b${String(number)}`)) number += 1
  return `b${String(number)}`
}

/** 空きマスにボタンを足す。アドレスは仮の正しい値(/pad/<id>)で始め、Inspector で書き換えてもらう */
function addButton(pad: OscPad, row: number, column: number): OscPad {
  if (!(row < pad.rows && column < pad.columns)) throw new PadEditError('格子の外にはボタンを置けません')
  if (pad.buttons.some(button => button.row === row && button.column === column)) throw new PadEditError('このマスには既にボタンがあります')
  const id = nextButtonId(pad)
  const result = structuredClone(pad)
  result.buttons.push({ id, row, column, label: id, address: `/pad/${id}`, args: [] })
  return result
}

function totalImageBytes(pad: OscPad, except?: string): number {
  return pad.buttons.reduce((sum, button) => button.id === except || button.image === undefined ? sum : sum + (imageDataUrlBytes(button.image) ?? 0), 0)
}

function requireImageBudget(pad: OscPad): void {
  // 画像を貼り付けで増やすと、パッド全体の画像の上限を超えうる(1 枚の大きさはパッドの検証が見る)
  if (totalImageBytes(pad) > OSC_PAD.MAX_TOTAL_IMAGE_BYTES) {
    throw new PadEditError(`パッド全体の画像が ${String(OSC_PAD.MAX_TOTAL_IMAGE_BYTES / MIB)} MiB を超えます`)
  }
}

/** 既存のボタンの設定を settings で置き換える(id と位置は保つ。写した側に無い背景色・画像は外れる) */
function pasteSettings(pad: OscPad, buttonId: string, settings: OscPadButtonSettings): OscPad {
  const button = requireButton(pad, buttonId)
  // 形の正否は当てた後のパッド全体の検証で見る(引数の中身は未検証のまま入る)
  const pasted = { id: button.id, row: button.row, column: button.column, ...structuredClone(settings) } as OscPadButton
  const result = replaceButton(pad, buttonId, pasted)
  requireImageBudget(result)
  return result
}

function setLabel(pad: OscPad, buttonId: string, label: string): OscPad {
  if (label.length > OSC_PAD.MAX_LABEL_CHARS) throw new PadEditError(`ラベルは ${String(OSC_PAD.MAX_LABEL_CHARS)} 文字までです`)
  return replaceButton(pad, buttonId, { ...requireButton(pad, buttonId), label })
}

/** 背景色(#rrggbb)。null か空で既定の色に戻す */
function setColor(pad: OscPad, buttonId: string, color: string | null): OscPad {
  const button = { ...requireButton(pad, buttonId) }
  if (color === null || color === '') {
    delete button.color
  } else {
    const normalized = color.trim()
    if (!COLOR_PATTERN.test(normalized)) throw new PadEditError('色は #rrggbb の形で指定してください')
    button.color = normalized.toUpperCase()
  }
  return replaceButton(pad, buttonId, button)
}

/** アドレスの入力欄に出す理由(正しければ null) */
export function addressProblem(address: string): string | null {
  if (!address.startsWith('/')) return '/ で始めてください'
  if (address === '/sys' || address.startsWith('/sys/') || address === '/oscdesk' || address.startsWith('/oscdesk/')) return '/sys と /oscdesk は予約されています'
  if (address.length > OSC_PAD.MAX_ADDRESS_CHARS) return `${String(OSC_PAD.MAX_ADDRESS_CHARS)} 文字までです`
  if (address.includes('\0')) return 'NUL 文字は使えません'
  if (hasLoneSurrogate(address)) return '孤立サロゲートは使えません'
  if (!ADDRESS_PATTERN.test(address)) return '空白・* ? [ ] { } , と空のパート・末尾の / は使えません'
  return null
}

function setAddress(pad: OscPad, buttonId: string, address: string): OscPad {
  const button = requireButton(pad, buttonId)
  const problem = addressProblem(address)
  if (problem !== null) throw new PadEditError(problem)
  return replaceButton(pad, buttonId, { ...button, address })
}

function sniffImageMime(bytes: Buffer): string | null {
  for (const [signature, mime] of IMAGE_SIGNATURES) {
    if (bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte)) return mime
  }
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'image/webp'
  return null
}

/**
 * 画像を付ける・外す。data はアップロードされたファイルのバイト列の base64 で、種類は先頭のバイトで決め(ブラウザが付ける
 * content type は当てにしない)、1 枚とパッド全体の大きさの上限を確かめてから data URL にする
 */
function setImage(pad: OscPad, buttonId: string, data: string | null): OscPad {
  const button = { ...requireButton(pad, buttonId) }
  if (data === null) {
    delete button.image
    return replaceButton(pad, buttonId, button)
  }
  if (!BASE64_PATTERN.test(data)) throw new PadEditError('画像のデータを読めません')
  const bytes = Buffer.from(data, 'base64')
  const mime = sniffImageMime(bytes)
  if (mime === null) throw new PadEditError('PNG / JPEG / GIF / WebP の画像だけを登録できます')
  if (bytes.length > OSC_PAD.MAX_IMAGE_BYTES) {
    throw new PadEditError(`画像は ${String(OSC_PAD.MAX_IMAGE_BYTES / KIB)} KiB までです(${String(Math.floor(bytes.length / KIB))} KiB)`)
  }
  if (totalImageBytes(pad, buttonId) + bytes.length > OSC_PAD.MAX_TOTAL_IMAGE_BYTES) {
    throw new PadEditError(`パッド全体の画像が ${String(OSC_PAD.MAX_TOTAL_IMAGE_BYTES / MIB)} MiB を超えます`)
  }
  button.image = `data:${mime};base64,${bytes.toString('base64')}`
  return replaceButton(pad, buttonId, button)
}

/** 格子の大きさを変える。はみ出すボタンがあれば、黙って消さずに断る(先に消すか、コピーして内側へ貼り付けてもらう) */
function resize(pad: OscPad, rows: number, columns: number): OscPad {
  if (!(rows >= 1 && rows <= OSC_PAD.MAX_ROWS && columns >= 1 && columns <= OSC_PAD.MAX_COLUMNS)) {
    throw new PadEditError(`行数は 1〜${String(OSC_PAD.MAX_ROWS)}、列数は 1〜${String(OSC_PAD.MAX_COLUMNS)} です`)
  }
  const outside = pad.buttons.filter(button => button.row >= rows || button.column >= columns)
  if (outside.length > 0) throw new PadEditError(`格子の外に出るボタンがあります: ${outside.map(button => button.label || button.id).join(', ')}`)
  return { ...structuredClone(pad), rows, columns }
}

// --- 引数 ---------------------------------------------------------------------

function typedArg(type: OscPadArg['type'], value: number | string): OscPadArg {
  // 型と値の組は parseArgValue が揃える(パッド全体の検証でも確かめる)
  return { type, value } as OscPadArg
}

/** index の引数を持つボタンの引数の写しを change で変え、ボタンを置き換える */
function withArgs(pad: OscPad, buttonId: string, index: number, change: (args: OscPadArg[], arg: OscPadArg) => void): OscPad {
  const button = requireButton(pad, buttonId)
  const args = structuredClone(button.args)
  const arg = args[index]
  if (arg === undefined) throw new PadEditError('その引数はありません')
  change(args, arg)
  return replaceButton(pad, buttonId, { ...button, args })
}

function addArg(pad: OscPad, buttonId: string, type: OscPadArg['type']): OscPad {
  const button = requireButton(pad, buttonId)
  if (button.args.length >= OSC_PAD.MAX_ARGS) throw new PadEditError(`引数は ${String(OSC_PAD.MAX_ARGS)} 個までです`)
  return replaceButton(pad, buttonId, { ...button, args: [...structuredClone(button.args), typedArg(type, DEFAULT_ARG_VALUES[type])] })
}

function moveArg(pad: OscPad, buttonId: string, index: number, delta: -1 | 1): OscPad {
  const button = requireButton(pad, buttonId)
  const args = structuredClone(button.args)
  const target = index + delta
  const [first, second] = [args[index], args[target]]
  if (first === undefined || second === undefined) throw new PadEditError('これ以上動かせません')
  args[index] = second
  args[target] = first
  return replaceButton(pad, buttonId, { ...button, args })
}

/** 入力欄に出していた書き方(整数の f は 1.0)。型を変えるときに、いまの値を新しい型として読み直すのに使う */
function formatArgValue(arg: OscPadArg): string {
  if (arg.type === 'f' && Number.isInteger(arg.value) && Math.abs(arg.value) < 1e21) return arg.value.toFixed(1)
  return String(arg.value)
}

/** 引数の型を変える。いまの値が新しい型として読めれば引き継ぎ、読めなければ既定値にする */
function setArgType(pad: OscPad, buttonId: string, index: number, type: OscPadArg['type']): OscPad {
  return withArgs(pad, buttonId, index, (args, arg) => {
    let value: number | string
    try {
      value = parseArgValue(type, formatArgValue(arg))
    } catch (error) {
      if (!(error instanceof PadEditError)) throw error
      value = DEFAULT_ARG_VALUES[type]
    }
    args[index] = typedArg(type, value)
  })
}

/** 入力欄の文字列を型どおりの値にする。i は int32、f は float32 に収まる有限の数(OSC の f は float32) */
export function parseArgValue(type: OscPadArg['type'], raw: string): number | string {
  if (!(ARG_TYPES as readonly string[]).includes(type)) throw new PadEditError(`引数の型は ${ARG_TYPES.join(' / ')} です`)
  if (type === 's') {
    if (raw.length > OSC_PAD.MAX_STRING_ARG_CHARS) throw new PadEditError(`文字列は ${String(OSC_PAD.MAX_STRING_ARG_CHARS)} 文字までです`)
    if (raw.includes('\0')) throw new PadEditError('文字列に NUL 文字は使えません(OSC の文字列の終わりと見分けられないため)')
    if (hasLoneSurrogate(raw)) throw new PadEditError('文字列に孤立サロゲートは使えません(OSC の UTF-8 化で別の文字に置き換わるため)')
    return raw
  }
  const text = raw.trim()
  if (type === 'i') {
    // 10 進の整数だけ(UI から移す前の Python の int() と同じく、数字の間の _ は区切りとして受ける。0x10 や 1.5 は断る)
    if (!INTEGER_PATTERN.test(text)) throw new PadEditError('整数を入力してください')
    const value = Number(text.replaceAll('_', ''))
    if (!(value >= INT32_MIN && value <= INT32_MAX)) throw new PadEditError('int32(-2147483648〜2147483647)の範囲で入力してください')
    return value
  }
  const number = parseDecimal(text)
  if (Number.isNaN(number)) throw new PadEditError('数値を入力してください')
  if (!Number.isFinite(number)) throw new PadEditError('有限の数値を入力してください')
  // 有限でも float32 に収まらない値(1e300 など)は Unity で +Inf になる
  if (!Number.isFinite(Math.fround(number))) throw new PadEditError('float32 の範囲(±3.4028235e38 まで)で入力してください')
  return number
}
