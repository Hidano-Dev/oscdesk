import { hasLoneSurrogate, OSC_PAD, PAD_ADDRESS_PATTERN } from '@oscdesk/shared'

// パッドの編集の規則(pad-document-editor.ts。D-167・D-126)が使う、入力欄の読み取りと画像の取り込み。純粋関数。
// 版 1 のパッドの編集(pad-editor.ts)とサーフェス定義の編集(surface-editor.ts)から移した(どちらも撤去した。D-175)。
// 理由の文言は画面にそのまま出す日本語

/** 編集の規則に合わない(理由は画面にそのまま出す日本語) */
export class PadEditError extends Error {}

const INT32_MIN = -2147483648
const INT32_MAX = 2147483647
const ADDRESS_PATTERN = new RegExp(PAD_ADDRESS_PATTERN)
// 標準の base64(パディング付き)だけを受ける。Buffer.from は読めない文字を黙って飛ばすので、先に形を確かめる
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const INTEGER_PATTERN = /^[+-]?\d(?:_?\d)*$/
// 10 進の数の書き方(UI から移す前の Python の float() と同じく、数字の間の _ を区切りとして受ける)。
// JS の Number() は 0x10・0b11 なども読むので、そのまま使うと 16・3 が黙って入る
const DECIMAL = /^[+-]?(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?$/
const ARG_TYPES = ['i', 'f', 's'] as const
const KIB = 1024
const MIB = 1024 * 1024

// 画像の先頭バイトで種類を決める(ブラウザが付ける content type は当てにしない)。SVG は受けない(スクリプトを含められる)
const IMAGE_SIGNATURES: readonly (readonly [readonly number[], string])[] = [
  [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'image/png'],
  [[0xff, 0xd8, 0xff], 'image/jpeg'],
  [[0x47, 0x49, 0x46, 0x38, 0x37, 0x61], 'image/gif'],
  [[0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 'image/gif'],
]

/** 10 進の数として読む(読めなければ NaN)。数字の間の _ は区切り */
export function parseDecimal(text: string): number {
  return DECIMAL.test(text) ? Number(text.replaceAll('_', '')) : Number.NaN
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

function sniffImageMime(bytes: Buffer): string | null {
  for (const [signature, mime] of IMAGE_SIGNATURES) {
    if (bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte)) return mime
  }
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'image/webp'
  return null
}

/**
 * アップロードされた画像のバイト列(base64)を data URL にする。種類は先頭のバイトで決め(ブラウザが付ける content type は
 * 当てにしない)、1 枚の大きさと、ほかの部品の画像(otherBytes)と合わせたパッド全体の大きさの上限を確かめる
 */
export function imageDataUrlOf(data: string, otherBytes: number): string {
  if (!BASE64_PATTERN.test(data)) throw new PadEditError('画像のデータを読めません')
  const bytes = Buffer.from(data, 'base64')
  const mime = sniffImageMime(bytes)
  if (mime === null) throw new PadEditError('PNG / JPEG / GIF / WebP の画像だけを登録できます')
  if (bytes.length > OSC_PAD.MAX_IMAGE_BYTES) {
    throw new PadEditError(`画像は ${String(OSC_PAD.MAX_IMAGE_BYTES / KIB)} KiB までです(${String(Math.floor(bytes.length / KIB))} KiB)`)
  }
  if (otherBytes + bytes.length > OSC_PAD.MAX_TOTAL_IMAGE_BYTES) {
    throw new PadEditError(`パッド全体の画像が ${String(OSC_PAD.MAX_TOTAL_IMAGE_BYTES / MIB)} MiB を超えます`)
  }
  return `data:${mime};base64,${bytes.toString('base64')}`
}

/** 入力欄の文字列を型どおりの値にする。i は int32、f は float32 に収まる有限の数(OSC の f は float32) */
export function parseArgValue(type: string, raw: string): number | string {
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
