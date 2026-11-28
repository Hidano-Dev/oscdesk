import { z } from 'zod'

import { OSC_PAD } from './osc-pad'
import { PAD_ARG_TYPES, PAD_FIELD_KINDS, PAD_WIDGET_KINDS } from './pad-document'
import { OscQueryNodeInfoSchema } from './pad-from-node'

// 版 2 のパッド(D-167)の編集命令(osc.padDocumentEdit)。編集の規則はブリッジ(packages/bridge/src/domain/pad-document-editor.ts)だけが持ち、
// UI は「何をしたいか」をこの形で送る(D-126)。作業コピーは UI が持ち、命令ごとに丸ごと送る。数・文字の入力欄は打った文字列のまま送り、
// 型どおりの読み取りはブリッジが行う

const strictObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict()

export const OSC_PAD_EDIT = {
  // 入力欄の文字列の歯止め。規則の上限(ラベル 64・アドレス 256・文字列の引数 1024 文字)を超えた入力にも、フレームとして
  // 捨てずに規則の理由(「ラベルは 64 文字までです」など)を返せるよう、上限より十分大きくする
  MAX_TEXT_CHARS: 64 * 1024,
  // 画像のバイト列(base64)の歯止め。1 枚の上限(256 KiB)を超えた画像にも、大きさの理由を返せるよう 2 倍まで受ける
  MAX_IMAGE_BASE64_CHARS: Math.ceil((OSC_PAD.MAX_IMAGE_BYTES * 2) / 3) * 4,
} as const

// 添字・行数・列数は規則で範囲を見る。ここは桁外れの値だけを捨てる
const IndexSchema = z.number().int().min(0).max(1000)
const TextSchema = z.string().max(OSC_PAD_EDIT.MAX_TEXT_CHARS)
const RefSchema = z.string().min(1).max(OSC_PAD_EDIT.MAX_TEXT_CHARS)
const DeltaSchema = z.union([z.literal(-1), z.literal(1)])
const WidgetKindSchema = z.enum(PAD_WIDGET_KINDS)
const FieldKindSchema = z.enum(PAD_FIELD_KINDS)
const ArgTypeSchema = z.enum(PAD_ARG_TYPES)
// 値の型。部品の種類ごとに使える型は規則が見る(トグルは T / i、スライダーは i / f など)
const ValueTypeSchema = z.enum(['i', 'f', 's', 'T', 'r', 'ffff'])

/**
 * 命令が当たる部品の中の場所。省略は部品そのもの。field: 組み合わせの型の引数(添字)、column: 表の欄(id)、
 * action: 表のアクション(id)
 */
const PartSchema = z.union([
  strictObject({ field: IndexSchema }),
  strictObject({ column: RefSchema }),
  strictObject({ action: RefSchema }),
])

const widget = { widget: RefSchema }
const part = { part: PartSchema.optional() }

export const PadDocumentEditSchema = z.discriminatedUnion('op', [
  // 空きマスに部品を足す。id はブリッジが振り(w1, w2, ...)、アドレスは仮の正しい値(/pad/<id>)で始める
  strictObject({ op: z.literal('addWidget'), kind: WidgetKindSchema, row: IndexSchema, column: IndexSchema }),
  // OSCQuery のノード(パレットの候補)から部品を足す。種類と送り直すかは上書きできる(pad-from-node.ts の規則)
  strictObject({ op: z.literal('addWidgetFromNode'), row: IndexSchema, column: IndexSchema, node: OscQueryNodeInfoSchema, kind: WidgetKindSchema.exclude(['table']).optional(), resend: z.boolean().optional() }),
  strictObject({ op: z.literal('removeWidget'), ...widget }),
  strictObject({ op: z.literal('moveWidget'), ...widget, row: IndexSchema, column: IndexSchema }),
  strictObject({ op: z.literal('spanWidget'), ...widget, rowSpan: IndexSchema, columnSpan: IndexSchema }),
  // 種類を変える。アドレス・ラベル・色は引き継ぎ、種類ごとの欄は既定値から始める。part が field / column なら
  // その引数・欄の操作の種類を変える(kind は組み合わせの引数・表の欄に置ける種類だけ)
  strictObject({ op: z.literal('setKind'), ...widget, ...part, kind: WidgetKindSchema }),
  // 既存の部品の設定をコピーした設定で置き換える(id と位置は保つ)。中身の正否は当てた後のパッド全体の検証で見る
  strictObject({ op: z.literal('pasteSettings'), ...widget, settings: z.record(z.string(), z.unknown()) }),
  strictObject({ op: z.literal('setLabel'), ...widget, ...part, label: TextSchema }),
  // 背景色(#rrggbb、大文字へ揃える)。null か空で既定の色に戻す
  strictObject({ op: z.literal('setColor'), ...widget, color: TextSchema.nullable() }),
  // 部品のアドレス。part が column / action なら行のアドレスの後ろに付ける相対のパス
  strictObject({ op: z.literal('setAddress'), ...widget, ...part, address: TextSchema }),
  // ボタンの画像のバイト列(base64)。null で外す
  strictObject({ op: z.literal('setImage'), ...widget, data: z.string().max(OSC_PAD_EDIT.MAX_IMAGE_BASE64_CHARS).nullable() }),
  // 決まった値(ボタンの引数、part が action なら表のアクションの引数)
  strictObject({ op: z.literal('addArg'), ...widget, ...part, type: ArgTypeSchema }),
  strictObject({ op: z.literal('removeArg'), ...widget, ...part, index: IndexSchema }),
  strictObject({ op: z.literal('moveArg'), ...widget, ...part, index: IndexSchema, delta: DeltaSchema }),
  strictObject({ op: z.literal('setArgType'), ...widget, ...part, index: IndexSchema, type: ArgTypeSchema }),
  strictObject({ op: z.literal('setArgValue'), ...widget, ...part, index: IndexSchema, raw: TextSchema }),
  // 値を持つ操作の型・範囲・刻み・候補(部品、part が field / column ならその引数・欄)
  strictObject({ op: z.literal('setValueType'), ...widget, ...part, type: ValueTypeSchema }),
  // 範囲。null か空で外す(スライダーは両側が要る)
  strictObject({ op: z.literal('setRange'), ...widget, ...part, min: TextSchema.nullable(), max: TextSchema.nullable() }),
  strictObject({ op: z.literal('setStep'), ...widget, ...part, step: TextSchema.nullable() }),
  strictObject({ op: z.literal('addOption'), ...widget, ...part, raw: TextSchema, label: TextSchema.optional() }),
  strictObject({ op: z.literal('removeOption'), ...widget, ...part, index: IndexSchema }),
  strictObject({ op: z.literal('moveOption'), ...widget, ...part, index: IndexSchema, delta: DeltaSchema }),
  strictObject({ op: z.literal('setOption'), ...widget, ...part, index: IndexSchema, raw: TextSchema, label: TextSchema.optional() }),
  // 送り直す(D-165)。part が column なら表の欄ごと
  strictObject({ op: z.literal('setResend'), ...widget, ...part, resend: z.boolean() }),
  strictObject({ op: z.literal('setReadOnly'), ...widget, readOnly: z.boolean() }),
  // 組み合わせの型の引数
  strictObject({ op: z.literal('addField'), ...widget, kind: FieldKindSchema }),
  strictObject({ op: z.literal('removeField'), ...widget, index: IndexSchema }),
  strictObject({ op: z.literal('moveField'), ...widget, index: IndexSchema, delta: DeltaSchema }),
  // 表の行の出どころと、UI で管理する行
  strictObject({ op: z.literal('setRowSource'), ...widget, source: z.enum(['target', 'ui']) }),
  strictObject({ op: z.literal('addRow'), ...widget, key: TextSchema, label: TextSchema }),
  strictObject({ op: z.literal('removeRow'), ...widget, key: RefSchema }),
  strictObject({ op: z.literal('setRowLabel'), ...widget, key: RefSchema, label: TextSchema }),
  strictObject({ op: z.literal('moveRow'), ...widget, key: RefSchema, delta: DeltaSchema }),
  // 表の欄とアクション
  strictObject({ op: z.literal('addColumn'), ...widget, kind: FieldKindSchema }),
  strictObject({ op: z.literal('removeColumn'), ...widget, column: RefSchema }),
  strictObject({ op: z.literal('moveColumn'), ...widget, column: RefSchema, delta: DeltaSchema }),
  strictObject({ op: z.literal('setColumnBulk'), ...widget, column: RefSchema, bulk: z.boolean() }),
  strictObject({ op: z.literal('addAction'), ...widget, scope: z.enum(['row', 'all']) }),
  strictObject({ op: z.literal('removeAction'), ...widget, action: RefSchema }),
  strictObject({ op: z.literal('setActionScope'), ...widget, action: RefSchema, scope: z.enum(['row', 'all']) }),
  // 格子の大きさ。はみ出す部品があれば黙って消さずに断る
  strictObject({ op: z.literal('resize'), rows: IndexSchema, columns: IndexSchema }),
])

export type PadDocumentEdit = z.infer<typeof PadDocumentEditSchema>
export type PadDocumentEditPart = z.infer<typeof PartSchema>
