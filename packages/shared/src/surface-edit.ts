import { z } from 'zod'

// サーフェス定義の編集命令(D-123)。編集の規則はブリッジ(packages/bridge/src/surface-editor.ts)だけが持ち、UI は
// 「何をしたいか」をこの形で送る。作業コピーは UI が持ち、命令ごとに丸ごと送る(ブリッジは編集中の状態を持たない)

const strictObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict()

// 配置の木の深さ・フォームの文字列の長さの歯止め(認証の無い LAN から巨大な命令を送られても舐めきれる大きさに抑える)
export const SURFACE_EDIT = {
  MAX_STEPS: 32,
  MAX_FORM_CHARS: 4096,
} as const

const IndexSchema = z.number().int().min(0).max(100_000)
const FormTextSchema = z.string().max(SURFACE_EDIT.MAX_FORM_CHARS)

// 入れ子の降り方。行・列・グループへは子の添字、タブへは [子の添字, タブの添字]
export const EditStepSchema = z.union([IndexSchema, z.tuple([IndexSchema, IndexSchema])])
// 配置のノードの指し方。screen は screens の添字、steps はそこから降りる入れ子、index は降りた先の children の添字
export const NodeRefSchema = strictObject({
  screen: IndexSchema,
  steps: z.array(EditStepSchema).max(SURFACE_EDIT.MAX_STEPS),
  index: IndexSchema,
})

// パラメータの編集フォームの入力(文字列中心。空欄は「指定なし」)。数値の読み取りと型ごとの規則はブリッジが行う。
// osc は通信アダプタ専用の欄(ブリッジが OSC のアダプタを持つときだけ UI が出す。D-117)。無ければ結び付けに触れない
export const ParameterFormSchema = strictObject({
  id: FormTextSchema,
  label: FormTextSchema,
  kind: FormTextSchema,
  type: FormTextSchema,
  standalone: z.boolean(),
  widget: FormTextSchema,
  min: FormTextSchema,
  max: FormTextSchema,
  step: FormTextSchema,
  options: FormTextSchema,
  default: FormTextSchema,
  value: FormTextSchema,
  // OSC の欄が無いときの実行時の一覧の id
  optionsFromList: FormTextSchema.optional(),
  osc: strictObject({ address: FormTextSchema, listAddress: FormTextSchema, listRequest: FormTextSchema }).optional(),
})

export const SurfaceEditSchema = z.discriminatedUnion('op', [
  // original が null なら追加、パラメータ id なら差し替え(id を変えたら配置・アクション・結び付けも追従する)
  strictObject({ op: z.literal('setParameter'), original: FormTextSchema.nullable(), form: ParameterFormSchema }),
  strictObject({ op: z.literal('removeParameter'), param: FormTextSchema }),
  strictObject({ op: z.literal('addControl'), screen: IndexSchema, steps: z.array(EditStepSchema).max(SURFACE_EDIT.MAX_STEPS), param: FormTextSchema }),
  strictObject({ op: z.literal('removeNode'), ref: NodeRefSchema }),
  strictObject({ op: z.literal('moveNode'), ref: NodeRefSchema, delta: z.union([z.literal(-1), z.literal(1)]) }),
  strictObject({ op: z.literal('wrapNode'), ref: NodeRefSchema, kind: z.enum(['row', 'column', 'group']), label: FormTextSchema.optional() }),
  strictObject({ op: z.literal('mergeWithNext'), ref: NodeRefSchema }),
  strictObject({ op: z.literal('unwrapNode'), ref: NodeRefSchema }),
  strictObject({ op: z.literal('setWidth'), ref: NodeRefSchema, width: z.union([z.number().int(), z.literal('auto'), z.null()]) }),
  strictObject({ op: z.literal('setCollapsed'), ref: NodeRefSchema, collapsed: z.boolean() }),
  strictObject({ op: z.literal('setLabel'), ref: NodeRefSchema, label: FormTextSchema }),
  strictObject({ op: z.literal('rename'), name: FormTextSchema }),
  // 作業コピーを丸ごと差し替える(定義のファイルのアップロード)。版 1 の定義は版 2 へ移してから検証する。作業コピーは要らない
  strictObject({ op: z.literal('replace'), definition: z.unknown() }),
])

export type EditStep = z.infer<typeof EditStepSchema>
export type NodeRef = z.infer<typeof NodeRefSchema>
export type ParameterForm = z.infer<typeof ParameterFormSchema>
export type SurfaceEdit = z.infer<typeof SurfaceEditSchema>
