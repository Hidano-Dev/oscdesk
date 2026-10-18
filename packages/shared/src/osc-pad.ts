import { z } from 'zod'

import { SENT_LOG } from './limits'
import { PARAMETER_ADDRESS_PATTERN } from './surface-definition'

// OSC パッド(D-080)。サーフェス定義とは別の、ユーザーが自由にアドレスと引数を書いて撃つボタンの格子。
// 収録回ごとに違う特殊な Unity 実装を発火させる用途で、定義(パラメータ層)を毎回書き換えずに済ませる。
// 正はブリッジが持ち、名前付きで保存・切り替える。押下は即時 1 メッセージで、保持値にも再送にも載せない。

export const OSC_PAD_FORMAT = 'oscdesk-pad'
export const OSC_PAD_VERSION = 1

export const OSC_PAD = {
  MAX_ROWS: 12,
  MAX_COLUMNS: 12,
  // 送信ログ(D-067)が切り詰めずに見せられる個数に揃える(押した内容がログで全部見えるように)
  MAX_ARGS: SENT_LOG.MAX_ARGS,
  MAX_LABEL_CHARS: 64,
  MAX_STRING_ARG_CHARS: 1024,
  // 画像はパッドの JSON に data URL で埋め込む(D-080)。1 枚と合計の上限で、pad フレーム(全 UI へ配る)の大きさを抑える
  MAX_IMAGE_BYTES: 256 * 1024,
  MAX_TOTAL_IMAGE_BYTES: 4 * 1024 * 1024,
  // アドレスの長さ(JS の length)。上限が無いと、巨大なアドレス 1 つで pad フレームが UI の受信上限を超える
  MAX_ADDRESS_CHARS: 256,
  // 保存・採用するパッドの JSON(UTF-8)の上限。pad フレームは全 UI へ配り、UI の受信上限は 16 MiB(D-071)なので、
  // 画像の合計 4 MiB(base64 で約 5.4 MiB)を収めつつ十分な余裕を残す値にする。超えたパッドは採用しない
  MAX_SERIALIZED_BYTES: 8 * 1024 * 1024,
} as const

const INT32_MIN = -2147483648
const INT32_MAX = 2147483647

const IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/
// SVG は受けない(スクリプトを含められ、ブラウザに描かせる画像として扱いにくい)
const IMAGE_DATA_URL_PATTERN = /^data:image\/(?:png|jpeg|gif|webp);base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/

/** data URL の base64 部分から元のバイト数を出す(Python 側の image_data_url_bytes と同じ数え方)。 */
export function imageDataUrlBytes(dataUrl: string): number | null {
  const match = IMAGE_DATA_URL_PATTERN.exec(dataUrl)
  if (match === null) return null
  const body = match[1]!
  const padding = body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0
  return (body.length / 4) * 3 - padding
}

// 引数は既存の wire 型のうち UI で書ける i / f / s だけ。OSC 1.0 の T / F は wire に無く、bool は D-017 どおり i の 0 / 1 で書く。
// b(blob)は手で書く用途が無いので持たない
export const OscPadArgSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('i'), value: z.number().int().min(INT32_MIN).max(INT32_MAX) }).strict(),
  // OSC の f は float32。有限でも float32 に収まらない値(1e300 など)は Unity で +Inf になるので、float32 へ丸めて有限なものだけ受ける
  z.object({ type: z.literal('f'), value: z.number().finite().refine(value => Number.isFinite(Math.fround(value)), { message: 'f must fit in float32' }) }).strict(),
  z.object({ type: z.literal('s'), value: z.string().max(OSC_PAD.MAX_STRING_ARG_CHARS) }).strict(),
])

export const OscPadButtonSchema = z.object({
  id: z.string().regex(IDENTIFIER_PATTERN),
  // 0 始まりのマス。格子の外・重なりは意味検証で拒否する
  row: z.number().int().min(0).max(OSC_PAD.MAX_ROWS - 1),
  column: z.number().int().min(0).max(OSC_PAD.MAX_COLUMNS - 1),
  // 画像や色だけのボタンもあり得るので空を許す
  label: z.string().max(OSC_PAD.MAX_LABEL_CHARS),
  color: z.string().regex(COLOR_PATTERN).optional(),
  image: z.string().regex(IMAGE_DATA_URL_PATTERN).optional(),
  // サーフェス定義と同じ具体アドレスの規則(/sys/*・/oscdesk/* と、パターン文字・空白・空パートを拒否)
  address: z.string().max(OSC_PAD.MAX_ADDRESS_CHARS).regex(new RegExp(PARAMETER_ADDRESS_PATTERN)),
  args: z.array(OscPadArgSchema).max(OSC_PAD.MAX_ARGS),
}).strict()

export const OscPadStructureSchema = z.object({
  format: z.literal(OSC_PAD_FORMAT),
  version: z.literal(OSC_PAD_VERSION),
  rows: z.number().int().min(1).max(OSC_PAD.MAX_ROWS),
  columns: z.number().int().min(1).max(OSC_PAD.MAX_COLUMNS),
  buttons: z.array(OscPadButtonSchema).max(OSC_PAD.MAX_ROWS * OSC_PAD.MAX_COLUMNS),
}).strict()

export type OscPadArg = z.infer<typeof OscPadArgSchema>
export type OscPadButton = z.infer<typeof OscPadButtonSchema>
export type OscPad = z.infer<typeof OscPadStructureSchema>

export interface OscPadIssue {
  path: (string | number)[]
  message: string
}

/** 構造(zod)で表せない規則。Python 側の collect_pad_issues と同じ判定・同じ文言にする。 */
export function collectOscPadIssues(pad: OscPad): OscPadIssue[] {
  const issues: OscPadIssue[] = []
  const ids = new Set<string>()
  const cells = new Set<string>()
  let totalImageBytes = 0
  pad.buttons.forEach((button, index) => {
    if (ids.has(button.id)) issues.push({ path: ['buttons', index, 'id'], message: `duplicate button id "${button.id}"` })
    ids.add(button.id)
    if (button.row >= pad.rows || button.column >= pad.columns) {
      issues.push({ path: ['buttons', index], message: `button "${button.id}" is outside the ${String(pad.rows)}x${String(pad.columns)} grid` })
    }
    const cell = `${String(button.row)},${String(button.column)}`
    if (cells.has(cell)) issues.push({ path: ['buttons', index], message: `button "${button.id}" overlaps another button` })
    cells.add(cell)
    if (button.image !== undefined) {
      const bytes = imageDataUrlBytes(button.image) ?? 0
      totalImageBytes += bytes
      if (bytes > OSC_PAD.MAX_IMAGE_BYTES) {
        issues.push({ path: ['buttons', index, 'image'], message: `image of "${button.id}" exceeds ${String(OSC_PAD.MAX_IMAGE_BYTES)} bytes` })
      }
    }
  })
  if (totalImageBytes > OSC_PAD.MAX_TOTAL_IMAGE_BYTES) {
    issues.push({ path: ['buttons'], message: `images exceed ${String(OSC_PAD.MAX_TOTAL_IMAGE_BYTES)} bytes in total` })
  }
  return issues
}

export const OscPadSchema = OscPadStructureSchema.superRefine((pad, context) => {
  for (const issue of collectOscPadIssues(pad)) context.addIssue({ code: z.ZodIssueCode.custom, ...issue })
})

/** パッドの JSON(区切りの空白なし)の UTF-8 のバイト数。保存・採用の上限(MAX_SERIALIZED_BYTES)と比べる。 */
export function oscPadSerializedBytes(pad: OscPad): number {
  return new TextEncoder().encode(JSON.stringify(pad)).length
}

/**
 * ブリッジが保存・読み込み・採用するときの検証。形と意味(OscPadSchema)に加えて JSON の大きさを見る。
 * 大きさはフレームの形式(wire)には入れない: 言語ごとに JSON の書き方が少し違い、境界で判定が割れるため、
 * 保存の正を持つブリッジだけが判定する(UI は送る前に同じ数え方で目安を確かめる)
 */
export const OscPadStoredSchema = OscPadSchema.superRefine((pad, context) => {
  const bytes = oscPadSerializedBytes(pad)
  if (bytes > OSC_PAD.MAX_SERIALIZED_BYTES) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: [], message: `pad is ${String(bytes)} bytes as JSON (limit ${String(OSC_PAD.MAX_SERIALIZED_BYTES)})` })
  }
})