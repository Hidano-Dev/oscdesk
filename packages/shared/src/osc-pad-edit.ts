import { z } from 'zod'

import { OSC_PAD } from './osc-pad'

// OSC パッド(D-080)の編集命令(D-126)。サーフェス定義の編集命令(D-123)と同じ形で、編集の規則はブリッジ
// (packages/bridge/src/pad-editor.ts)だけが持ち、UI は「何をしたいか」をこの形で送る。作業コピーは UI が持ち、
// 命令ごとに丸ごと送る(ブリッジは編集中の状態を持たない)。OSC 専用の機能なので、フレームは osc.padEdit / osc.padEdited

const strictObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict()

export const OSC_PAD_EDIT = {
  // 入力欄の文字列の歯止め。規則の上限(ラベル 64・アドレス 256・文字列の引数 1024 文字)を超えた入力にも、フレームとして
  // 捨てずに規則の理由(「ラベルは 64 文字までです」など)を返せるよう、上限より十分大きくする
  MAX_TEXT_CHARS: 64 * 1024,
  // 画像のバイト列(base64)の歯止め。1 枚の上限(256 KiB)を超えた画像にも、大きさの理由を返せるよう 2 倍まで受ける
  MAX_IMAGE_BASE64_CHARS: Math.ceil((OSC_PAD.MAX_IMAGE_BYTES * 2) / 3) * 4,
} as const

// 添字・行数・列数は規則で範囲を見る(格子の外・引数の無い添字は理由を返す)。ここは桁外れの値だけを捨てる
const IndexSchema = z.number().int().min(0).max(1000)
const TextSchema = z.string().max(OSC_PAD_EDIT.MAX_TEXT_CHARS)
const ButtonRefSchema = z.string().min(1).max(OSC_PAD_EDIT.MAX_TEXT_CHARS)
const ArgTypeSchema = z.enum(['i', 'f', 's'])

// コピーしたボタンの設定(ラベル・背景色・画像・アドレス・引数)。id と位置はマスに属するので持たない。
// 中身の正否は当てた後のパッド全体の検証(保存と同じ)で見る
export const OscPadButtonSettingsSchema = strictObject({
  label: TextSchema,
  color: TextSchema.optional(),
  image: z.string().max(OSC_PAD_EDIT.MAX_IMAGE_BASE64_CHARS + 64).optional(),
  address: TextSchema,
  args: z.array(z.unknown()).max(OSC_PAD.MAX_ARGS),
})

export const OscPadEditSchema = z.discriminatedUnion('op', [
  // 空きマスにボタンを足す。id はブリッジが振り(b1, b2, ...)、アドレスは仮の正しい値(/pad/<id>)で始める
  strictObject({ op: z.literal('addButton'), row: IndexSchema, column: IndexSchema }),
  strictObject({ op: z.literal('removeButton'), button: ButtonRefSchema }),
  // 既存のボタンの設定をコピーした設定で置き換える(id と位置は保つ。写した側に無い背景色・画像は外れる)
  strictObject({ op: z.literal('pasteSettings'), button: ButtonRefSchema, settings: OscPadButtonSettingsSchema }),
  strictObject({ op: z.literal('setLabel'), button: ButtonRefSchema, label: TextSchema }),
  // 背景色(#rrggbb、大文字へ揃える)。null か空で既定の色に戻す
  strictObject({ op: z.literal('setColor'), button: ButtonRefSchema, color: TextSchema.nullable() }),
  strictObject({ op: z.literal('setAddress'), button: ButtonRefSchema, address: TextSchema }),
  // 画像のバイト列(base64。data URL ではない)。種類は先頭のバイトでブリッジが決める。null で外す
  strictObject({ op: z.literal('setImage'), button: ButtonRefSchema, data: z.string().max(OSC_PAD_EDIT.MAX_IMAGE_BASE64_CHARS).nullable() }),
  strictObject({ op: z.literal('addArg'), button: ButtonRefSchema, type: ArgTypeSchema }),
  strictObject({ op: z.literal('removeArg'), button: ButtonRefSchema, index: IndexSchema }),
  strictObject({ op: z.literal('moveArg'), button: ButtonRefSchema, index: IndexSchema, delta: z.union([z.literal(-1), z.literal(1)]) }),
  // 型を変える。いまの値が新しい型として読めれば引き継ぎ、読めなければ既定値にする
  strictObject({ op: z.literal('setArgType'), button: ButtonRefSchema, index: IndexSchema, type: ArgTypeSchema }),
  // 入力欄の文字列のまま送る。型どおりの読み取り(i は int32、f は float32 に収まる有限の数)はブリッジ
  strictObject({ op: z.literal('setArgValue'), button: ButtonRefSchema, index: IndexSchema, raw: TextSchema }),
  // 格子の大きさ。はみ出すボタンがあれば黙って消さずに断る
  strictObject({ op: z.literal('resize'), rows: IndexSchema, columns: IndexSchema }),
])

export type OscPadButtonSettings = z.infer<typeof OscPadButtonSettingsSchema>
export type OscPadEdit = z.infer<typeof OscPadEditSchema>
