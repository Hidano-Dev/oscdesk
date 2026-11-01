import { z } from 'zod'

import {
  IDENTIFIER_PATTERN,
  resolveSelectors,
  type SurfaceAction,
  type SurfaceDefinition,
  type SurfaceLayoutNode,
  type SurfaceParameter,
  type SurfaceRecord,
  type SurfaceRecordColumn,
  type SurfaceRecordField,
} from './surface-definition'
import { OSC_BATCH } from './limits'

// 表示する部品の木(HID-401・D-124)。ブリッジが採用した定義から組み立てて surface フレームの view で配り、UI はこれを描くだけにする。
// 部品の種類の決め方(表示ヒント・型と制約・色の選択に使えるか)、ラベルの上書き、取り直しのボタンを出すか、レコード表の列と
// 行の追加・削除を出すか、アクションの対象の展開は、ここだけが持つ(UI 技術を差し替えても作り直さないため)。
// 値の扱い(操作中の保護・送信の間引き・下書き)は操作の手触りに関わるので UI に残す(D-124)

type Scalar = number | string | boolean

export type ViewWidget = 'slider' | 'switch' | 'button' | 'input' | 'select' | 'color' | 'composite'

/** 1 つのパラメータ(またはレコードのフィールド・組み合わせの型のフィールド)を 1 か所に置いたときの部品。 */
export interface ViewControl {
  /** パラメータ id(レコードと組み合わせの型ではフィールド id) */
  param: string
  label: string
  type: 'i' | 'f' | 's' | 'bool' | 'composite'
  kind: 'state' | 'trigger'
  widget: ViewWidget
  standalone: boolean
  range?: [number, number]
  step?: number
  /** state の初期値。定義に書かれたときだけ持つ(組み合わせの型ではフィールドの側に持つ) */
  default?: Scalar
  /** 先頭の固定の候補。実行時の一覧(optionsFrom)の select では、固定の候補が無くても空の配列で持つ */
  options?: string[]
  /** 実行時の一覧の id(D-053)。あれば options は先頭の固定の候補で、値の所属を問わない */
  optionsFrom?: string
  /** その一覧を取り直せる(要求を持つ)ときの一覧の id。select の近くに Sync を出す(D-077) */
  optionsSync?: string
  /** trigger が押下で送る値 */
  value?: Scalar
  /** 組み合わせの型(D-121)のフィールド。kind はパラメータの kind */
  fields?: ViewControl[]
  /** 組み合わせの型の表示ヒントの名前 */
  hint?: string
}

export interface ViewRecord {
  record: string
  label: string
  kind: 'state' | 'trigger'
  keyLabel: string
  keysFrom: string
  keysSource: 'unity' | 'ui'
  keysMax?: number
  keysSync?: string
  fields: ViewControl[]
  /** 新しい行の値(フィールドの宣言順。state は default、trigger は value) */
  initialValues: Scalar[]
}

export type ViewAction =
  | { action: string; label: string; targets: { control: ViewControl; fixed?: Scalar }[] }
  | { action: string; label: string; scope: 'row' | 'all'; steps: { record: string; fixed: { field: number; value: Scalar }[] }[] }

export interface ViewRecordColumn {
  /** レコードのフィールドの添字(宣言順) */
  field: number
  control: ViewControl
  actions: string[]
  toggle?: { label: string; on: string; off: string }
}

export type ViewNode =
  | { kind: 'control'; control: ViewControl; width?: number }
  | { kind: 'action'; action: string; label: string; width?: number }
  | {
      kind: 'record'
      record: string
      label: string
      columns: ViewRecordColumn[]
      rowActions: string[]
      tableActions: string[]
      editRows: boolean
      width?: number
    }
  | { kind: 'row' | 'column'; children: ViewNode[]; width?: number }
  | { kind: 'group'; label: string; collapsed: boolean; children: ViewNode[]; width?: number }
  | { kind: 'tabs'; tabs: { label: string; children: ViewNode[] }[]; width?: number }

export interface SurfaceView {
  /** パラメータごとに 1 件(既定の部品)。値の調停と通知の表示名に使う */
  parameters: ViewControl[]
  records: ViewRecord[]
  actions: ViewAction[]
  screens: { id: string; label: string; children: ViewNode[] }[]
}

const idSchema = z.string().regex(new RegExp(IDENTIFIER_PATTERN))
const scalarSchema = z.union([z.number().finite(), z.string(), z.boolean()])
const widthSchema = z.number().int().min(1).max(12).optional()

export const ViewControlSchema: z.ZodType<ViewControl> = z.lazy(() =>
  z
    .object({
      param: idSchema,
      label: z.string().min(1),
      type: z.enum(['i', 'f', 's', 'bool', 'composite']),
      kind: z.enum(['state', 'trigger']),
      widget: z.enum(['slider', 'switch', 'button', 'input', 'select', 'color', 'composite']),
      standalone: z.boolean(),
      range: z.tuple([z.number().finite(), z.number().finite()]).optional(),
      step: z.number().positive().optional(),
      default: scalarSchema.optional(),
      options: z.array(z.string()).optional(),
      optionsFrom: idSchema.optional(),
      optionsSync: idSchema.optional(),
      value: scalarSchema.optional(),
      fields: z.array(ViewControlSchema).optional(),
      hint: z.string().optional(),
    })
    .strict(),
)

const ViewRecordSchema = z
  .object({
    record: idSchema,
    label: z.string().min(1),
    kind: z.enum(['state', 'trigger']),
    keyLabel: z.string().min(1),
    keysFrom: idSchema,
    keysSource: z.enum(['unity', 'ui']),
    keysMax: z.number().int().positive().optional(),
    keysSync: idSchema.optional(),
    fields: z.array(ViewControlSchema),
    initialValues: z.array(scalarSchema),
  })
  .strict()

const ViewActionSchema = z.union([
  z
    .object({
      action: idSchema,
      label: z.string().min(1),
      targets: z.array(z.object({ control: ViewControlSchema, fixed: scalarSchema.optional() }).strict()).max(OSC_BATCH.MAX_MESSAGES + 1),
    })
    .strict(),
  z
    .object({
      action: idSchema,
      label: z.string().min(1),
      scope: z.enum(['row', 'all']),
      steps: z.array(
        z
          .object({
            record: idSchema,
            fixed: z.array(z.object({ field: z.number().int().nonnegative(), value: scalarSchema }).strict()),
          })
          .strict(),
      ),
    })
    .strict(),
])

const ViewNodeSchema: z.ZodType<ViewNode> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('control'), control: ViewControlSchema, width: widthSchema }).strict(),
    z.object({ kind: z.literal('action'), action: idSchema, label: z.string().min(1), width: widthSchema }).strict(),
    z
      .object({
        kind: z.literal('record'),
        record: idSchema,
        label: z.string().min(1),
        columns: z.array(
          z
            .object({
              field: z.number().int().nonnegative(),
              control: ViewControlSchema,
              actions: z.array(idSchema),
              toggle: z.object({ label: z.string().min(1), on: idSchema, off: idSchema }).strict().optional(),
            })
            .strict(),
        ),
        rowActions: z.array(idSchema),
        tableActions: z.array(idSchema),
        editRows: z.boolean(),
        width: widthSchema,
      })
      .strict(),
    z.object({ kind: z.literal('row'), children: z.array(ViewNodeSchema), width: widthSchema }).strict(),
    z.object({ kind: z.literal('column'), children: z.array(ViewNodeSchema), width: widthSchema }).strict(),
    z
      .object({ kind: z.literal('group'), label: z.string().min(1), collapsed: z.boolean(), children: z.array(ViewNodeSchema), width: widthSchema })
      .strict(),
    z
      .object({
        kind: z.literal('tabs'),
        tabs: z.array(z.object({ label: z.string().min(1), children: z.array(ViewNodeSchema) }).strict()).min(1),
        width: widthSchema,
      })
      .strict(),
  ]),
)

export const SurfaceViewSchema: z.ZodType<SurfaceView> = z
  .object({
    parameters: z.array(ViewControlSchema),
    records: z.array(ViewRecordSchema),
    actions: z.array(ViewActionSchema),
    screens: z.array(z.object({ id: idSchema, label: z.string().min(1), children: z.array(ViewNodeSchema) }).strict()),
  })
  .strict()

/** 部品の種類の判定に使う形。レコードと組み合わせの型のフィールドは「kind が持ち主の kind のパラメータ」とみなす(D-061) */
type WidgetSource = (SurfaceParameter | SurfaceRecordField) & { kind: 'state' | 'trigger' }

/**
 * 色の選択で表せる組み合わせの型か。ヒント color の state で、範囲 0〜1 の f が 3 つ(RGB)か 4 つ(RGBA)。
 * 形が合わなければ(範囲が 0〜255 など)ヒントが color でもフィールドごとの部品にする(値を色の選択で壊さないため)
 */
export function isColorComposite(parameter: SurfaceParameter): boolean {
  if (parameter.type !== 'composite' || parameter.hint !== 'color' || parameter.kind !== 'state') return false
  const { fields } = parameter
  return (fields.length === 3 || fields.length === 4)
    && fields.every(field => field.type === 'f' && field.range !== undefined && field.range[0] === 0 && field.range[1] === 1)
}

/** 画面層に widget の指定が無いときの部品。パラメータの表示ヒントがあればそれ、無ければ型と制約から決める(D-103) */
export function defaultWidget(source: WidgetSource): ViewWidget {
  if ('widget' in source && source.widget !== undefined) return source.widget
  if (source.type === 'composite') return isColorComposite(source) ? 'color' : 'composite'
  if (source.kind === 'trigger') return 'button'
  if (source.type === 'bool') return 'switch'
  if (source.type === 's') return source.options !== undefined || source.optionsFrom !== undefined ? 'select' : 'input'
  return source.range !== undefined ? 'slider' : 'input'
}

function asSource(value: SurfaceParameter | SurfaceRecordField, kind: 'state' | 'trigger'): WidgetSource {
  return { ...value, kind } as WidgetSource
}

function control(source: WidgetSource, widget: ViewWidget, label: string, syncable: ReadonlySet<string>): ViewControl {
  const standalone = 'standalone' in source ? source.standalone ?? true : true
  if (source.type === 'composite') {
    // フィールドの近くには Sync を出さない(候補を出す select が組み合わせの部品の中に無い)
    const fields = source.fields.map(field => {
      const fieldSource = asSource(field, source.kind)
      return control(fieldSource, defaultWidget(fieldSource), field.label, new Set())
    })
    return {
      param: source.id,
      label,
      type: 'composite',
      kind: source.kind,
      // 組み合わせの型には基本型の部品のヒントが合わない(定義の検証で断る)ので、ここで決めた部品だけを使う
      widget: widget === 'color' || widget === 'composite' ? widget : (isColorComposite(source) ? 'color' : 'composite'),
      standalone,
      fields,
      ...(source.hint === undefined ? {} : { hint: source.hint }),
    }
  }
  const optionsFrom = source.type === 's' ? source.optionsFrom?.list : undefined
  const staticOptions = source.type === 's' ? source.options : undefined
  // 候補の無い select は描けないので入力欄にする
  const chosen: ViewWidget = widget === 'select' && staticOptions === undefined && optionsFrom === undefined ? 'input' : widget
  // optionsFrom の select は固定の候補が無くても候補(ターゲットの一覧)が後から届くので、空の候補で持つ
  const options = staticOptions !== undefined ? [...staticOptions] : (optionsFrom !== undefined && chosen === 'select' ? [] : undefined)
  const range = source.type === 'i' || source.type === 'f' ? source.range : undefined
  const step = source.type === 'i' || source.type === 'f' ? source.step : undefined
  return {
    param: source.id,
    label,
    type: source.type,
    kind: source.kind,
    widget: chosen,
    standalone,
    ...(range === undefined ? {} : { range: [range[0], range[1]] as [number, number] }),
    ...(step === undefined ? {} : { step }),
    ...(source.default === undefined ? {} : { default: source.default }),
    ...(options === undefined ? {} : { options }),
    ...(optionsFrom === undefined ? {} : { optionsFrom }),
    ...(optionsFrom !== undefined && syncable.has(optionsFrom) ? { optionsSync: optionsFrom } : {}),
    ...(source.value === undefined ? {} : { value: source.value }),
  }
}

function widthOf(node: { width?: 'auto' | number | undefined }): { width?: number } {
  // 'auto' は描画側に任せる(欄を持たない)。数値は 12 分割グリッドの占有幅
  return typeof node.width === 'number' ? { width: node.width } : {}
}

function fieldIndex(record: SurfaceRecord, fieldId: string): number {
  return record.fields.findIndex(field => field.id === fieldId)
}

function buildRecord(record: SurfaceRecord, syncable: ReadonlySet<string>): ViewRecord {
  const keysList = record.keysFrom.list
  return {
    record: record.id,
    label: record.label,
    kind: record.kind,
    keyLabel: record.key?.label ?? 'キー',
    keysFrom: keysList,
    keysSource: record.keysFrom.source ?? 'unity',
    ...(record.keysFrom.max === undefined ? {} : { keysMax: record.keysFrom.max }),
    ...(syncable.has(keysList) ? { keysSync: keysList } : {}),
    fields: record.fields.map(field => {
      const source = asSource(field, record.kind)
      return control(source, defaultWidget(source), field.label, syncable)
    }),
    // 検証済みの定義では state のフィールドは default、trigger のフィールドは value を必ず持つ
    initialValues: record.fields.map(field => (record.kind === 'state' ? field.default : field.value) ?? ''),
  }
}

function buildAction(
  action: SurfaceAction,
  parameters: readonly SurfaceParameter[],
  records: ReadonlyMap<string, SurfaceRecord>,
  selectors: ReadonlyMap<string, readonly string[]>,
): ViewAction {
  if (action.scope !== undefined) {
    const steps: { record: string; fixed: { field: number; value: Scalar }[] }[] = []
    for (const step of action.steps) {
      if (!('record' in step)) continue
      const record = records.get(step.record)
      if (record === undefined) continue // 検証済みなので通常は無い
      const fixed = record.kind === 'state' && step.value !== undefined
        ? Object.entries(step.value).map(([id, value]) => ({ field: fieldIndex(record, id), value })).filter(item => item.field >= 0)
        : []
      steps.push({ record: record.id, fixed })
    }
    return { action: action.id, label: action.label, scope: action.scope, steps }
  }
  // 巨大な定義で総当たりしないよう id は索引化し、まとめ送りの上限(512 件)を超えたら展開を打ち切る(UI は上限超を送らずに知らせる)
  const byId = new Map<string, SurfaceParameter>()
  for (const parameter of parameters) if (!byId.has(parameter.id)) byId.set(parameter.id, parameter)
  const targets: { control: ViewControl; fixed?: Scalar }[] = []
  const push = (parameter: SurfaceParameter, fixed: Scalar | undefined) => {
    const source = asSource(parameter, parameter.kind)
    targets.push({ control: control(source, defaultWidget(source), parameter.label, new Set()), ...(fixed === undefined ? {} : { fixed }) })
  }
  for (const step of action.steps) {
    if (targets.length > OSC_BATCH.MAX_MESSAGES) break
    if ('param' in step) {
      const parameter = byId.get(step.param)
      if (parameter !== undefined) push(parameter, step.value)
    } else if ('selector' in step) {
      for (const id of selectors.get(step.selector) ?? []) {
        const parameter = byId.get(id)
        if (parameter !== undefined) push(parameter, undefined)
        if (targets.length > OSC_BATCH.MAX_MESSAGES) break
      }
    }
  }
  return { action: action.id, label: action.label, targets }
}

/**
 * 採用した定義(結び付けを含む全体)から、表示する部品の木を組み立てる。判定はしない(採用の前に SurfaceDefinitionSchema が済ませている)。
 * 取り直せる一覧(要求を持つ一覧)とアクションの selector が当たるパラメータは結び付けから決まるので、ここで解いて
 * 部品の木に入れる(UI は結び付けを見ない。D-117)
 */
export function buildSurfaceView(definition: SurfaceDefinition): SurfaceView {
  const syncable = new Set((definition.bindings?.osc?.lists ?? []).filter(list => list.request !== undefined).map(list => list.id))
  const selectors = new Map(resolveSelectors(definition).map(item => [item.selector, item.params]))
  const parametersById = new Map<string, SurfaceParameter>()
  for (const parameter of definition.parameters) parametersById.set(parameter.id, parameter)
  const records = new Map((definition.records ?? []).map(record => [record.id, record]))
  const actionsById = new Map((definition.actions ?? []).map(action => [action.id, action]))
  const actions = (definition.actions ?? []).map(action => buildAction(action, definition.parameters, records, selectors))

  const recordNode = (node: Extract<SurfaceLayoutNode, { kind: 'record' }>): ViewNode => {
    const record = records.get(node.record)!
    const columnsDef: SurfaceRecordColumn[] = node.columns ?? record.fields.map(field => ({ field: field.id }))
    const columns = columnsDef.map(column => {
      const index = fieldIndex(record, column.field)
      const field = record.fields[index]!
      const source = asSource(field, record.kind)
      return {
        field: index,
        control: control(source, column.widget ?? defaultWidget(source), column.label ?? field.label, syncable),
        actions: column.actions ?? [],
        ...(column.toggle === undefined ? {} : { toggle: { ...column.toggle } }),
      }
    })
    return {
      kind: 'record',
      record: record.id,
      label: node.label ?? record.label,
      columns,
      rowActions: node.rowActions ?? [],
      tableActions: node.tableActions ?? [],
      // trigger のレコードは保持値を持たないので、行を作る・消す操作を出さない
      editRows: record.kind === 'state' && (node.editRows ?? (record.keysFrom.source === 'ui')),
      ...widthOf(node),
    }
  }

  const nodes = (children: readonly SurfaceLayoutNode[]): ViewNode[] => children.map(node => {
    switch (node.kind) {
      case 'control': {
        const parameter = parametersById.get(node.param)!
        const source = asSource(parameter, parameter.kind)
        return { kind: 'control', control: control(source, node.widget ?? defaultWidget(source), node.label ?? parameter.label, syncable), ...widthOf(node) }
      }
      case 'action':
        return { kind: 'action', action: node.action, label: node.label ?? actionsById.get(node.action)!.label, ...widthOf(node) }
      case 'record':
        return recordNode(node)
      case 'tabs':
        return { kind: 'tabs', tabs: node.tabs.map(tab => ({ label: tab.label, children: nodes(tab.children) })), ...widthOf(node) }
      case 'group':
        return { kind: 'group', label: node.label, collapsed: node.collapsed ?? false, children: nodes(node.children), ...widthOf(node) }
      default:
        return { kind: node.kind, children: nodes(node.children), ...widthOf(node) }
    }
  })

  return {
    parameters: definition.parameters.map(parameter => {
      const source = asSource(parameter, parameter.kind)
      return control(source, defaultWidget(source), parameter.label, syncable)
    }),
    records: [...records.values()].map(record => buildRecord(record, syncable)),
    actions,
    screens: definition.screens.map(screen => ({ id: screen.id, label: screen.label, children: nodes(screen.children) })),
  }
}
