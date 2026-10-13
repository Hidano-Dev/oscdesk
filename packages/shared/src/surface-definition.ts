import { z } from 'zod'

import { matchesPattern } from './address-pattern'
import { OSC_BATCH } from './limits'

// サーフェス定義(D-043)。OscDesk 側の JSON ファイルが操作対象の正典で、
// 「パラメータ層」(何を送るか)と「画面層」(どう並べるか)の 2 層に分ける。
// 画面層は NiceGUI 以外の描画方式でも読めるよう、ウィジェットは「ヒント」に留める。

export const SURFACE_DEFINITION_FORMAT = 'oscdesk-surface'
export const SURFACE_DEFINITION_VERSION = 1

const INT32_MIN = -2147483648
const INT32_MAX = 2147483647

// 予約名前空間(/sys/* と /oscdesk/*)を先読みで弾く。JSON Schema の pattern にそのまま出て、
// Python 側の jsonschema 検証でも同じ拒否になる(二重実装を避けるため正規表現を 1 つに保つ)。
// `*` `?` `[` `]` `{` `}` `,` と空白は具体アドレスに使えず、空パートと末尾 `/` も許さない。
// 末尾は `$` でなく `(?![\\s\\S])`: Python の re では `$` が末尾の改行の手前にも一致し、JS と判定が割れるため。
const PARAMETER_ADDRESS_PATTERN = '^(?!/(?:sys|oscdesk)(?:/|(?![\\s\\S])))(?:/[^\\s/?\\[\\]{},*]+)+(?![\\s\\S])'
// アクションの match 用。`*` を許す以外は具体アドレスと同じ形(予約名前空間は定義済みパラメータにしか当たらないので検査不要)。
const ADDRESS_MATCH_PATTERN = '^(?:/[^\\s/?\\[\\]{},]+)+(?![\\s\\S])'
const IDENTIFIER_PATTERN = '^[A-Za-z][A-Za-z0-9_-]{0,63}(?![\\s\\S])'

const identifierSchema = z.string().regex(new RegExp(IDENTIFIER_PATTERN))
const labelSchema = z.string().min(1)
const concreteAddressSchema = z.string().regex(new RegExp(PARAMETER_ADDRESS_PATTERN))

const parameterBaseFields = {
  id: identifierSchema,
  address: concreteAddressSchema,
  label: labelSchema,
  // state: Unity の現在値を表し、再接続時に再送する。trigger: 押した瞬間だけの「きっかけ」で再送しない。
  kind: z.enum(['state', 'trigger']),
  // false なら単独では送れず、複数メッセージ列の一部としてのみ送る(HID-166)。省略時は true。
  standalone: z.boolean().optional(),
}

const rangeSchema = z.tuple([z.number(), z.number()])

const numericParameter = <T extends 'i' | 'f'>(type: T) =>
  z
    .object({
      ...parameterBaseFields,
      type: z.literal(type),
      range: rangeSchema.optional(),
      step: z.number().positive().optional(),
      default: z.number().optional(),
      // trigger が押下で送る引数。state では使わない(意味層で検査)。
      value: z.number().optional(),
    })
    .strict()

export const SurfaceParameterSchema = z.discriminatedUnion('type', [
  numericParameter('i'),
  numericParameter('f'),
  z
    .object({
      ...parameterBaseFields,
      type: z.literal('s'),
      // 静的な候補。optionsFrom と併記したときは、Unity の一覧の前に固定で付く候補になる(D-053)
      options: z.array(z.string()).min(1).optional(),
      // Unity が実行時に持つ文字列の一覧を受けるアドレス(D-053)。一覧は値であり、定義は書き換えない。
      // request を書くとブリッジがそこへ引数なしの要求を送る。省略時は Unity の自発送信だけを待つ
      optionsFrom: z.object({ address: concreteAddressSchema, request: concreteAddressSchema.optional() }).strict().optional(),
      default: z.string().optional(),
      value: z.string().optional(),
    })
    .strict(),
  z
    .object({
      ...parameterBaseFields,
      type: z.literal('bool'),
      default: z.boolean().optional(),
      value: z.boolean().optional(),
    })
    .strict(),
])

// アクション(HID-166): 押すと複数のパラメータの値を 1 つの OSC bundle でまとめて送る。
// 「何を送るか」なのでパラメータ層に置き、画面層は kind:'action' のノードで配置するだけにする。
const actionStepSchema = z.union([
  // param: そのパラメータ 1 件。value があれば固定値、無ければ state は現在値・trigger は定義の value
  z.object({ param: identifierSchema, value: z.union([z.number(), z.string(), z.boolean()]).optional() }).strict(),
  // match: アドレスパターン(`*` は 1 パート内の 0 文字以上)に合う全パラメータを定義順に。現在値(trigger は定義の value)を送る
  z.object({ match: z.string().regex(new RegExp(ADDRESS_MATCH_PATTERN)) }).strict(),
])

export const SurfaceActionSchema = z
  .object({
    id: identifierSchema,
    label: labelSchema,
    steps: z.array(actionStepSchema).min(1),
  })
  .strict()

// 12 分割グリッドの占有幅。'auto' は描画側に任せる。
const widthSchema = z.union([z.literal('auto'), z.number().int().min(1).max(12)])

export const SURFACE_WIDGET_HINTS = ['slider', 'switch', 'button', 'input', 'select'] as const

export type SurfaceControlNode = {
  kind: 'control'
  param: string
  widget?: (typeof SURFACE_WIDGET_HINTS)[number] | undefined
  label?: string | undefined
  width?: 'auto' | number | undefined
}
export type SurfaceActionNode = {
  kind: 'action'
  action: string
  label?: string | undefined
  width?: 'auto' | number | undefined
}
export type SurfaceLayoutNode =
  | SurfaceControlNode
  | SurfaceActionNode
  | { kind: 'row' | 'column'; children: SurfaceLayoutNode[]; width?: 'auto' | number | undefined }
  | { kind: 'group'; label: string; collapsed?: boolean | undefined; children: SurfaceLayoutNode[]; width?: 'auto' | number | undefined }
  | { kind: 'tabs'; tabs: { label: string; children: SurfaceLayoutNode[] }[]; width?: 'auto' | number | undefined }

export const SurfaceLayoutNodeSchema: z.ZodType<SurfaceLayoutNode> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('control'),
        param: identifierSchema,
        widget: z.enum(SURFACE_WIDGET_HINTS).optional(),
        label: labelSchema.optional(),
        width: widthSchema.optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('action'),
        action: identifierSchema,
        label: labelSchema.optional(),
        width: widthSchema.optional(),
      })
      .strict(),
    z.object({ kind: z.literal('row'), children: z.array(SurfaceLayoutNodeSchema), width: widthSchema.optional() }).strict(),
    z.object({ kind: z.literal('column'), children: z.array(SurfaceLayoutNodeSchema), width: widthSchema.optional() }).strict(),
    z
      .object({
        kind: z.literal('group'),
        label: labelSchema,
        collapsed: z.boolean().optional(),
        children: z.array(SurfaceLayoutNodeSchema),
        width: widthSchema.optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('tabs'),
        tabs: z
          .array(z.object({ label: labelSchema, children: z.array(SurfaceLayoutNodeSchema) }).strict())
          .min(1),
        width: widthSchema.optional(),
      })
      .strict(),
  ]),
)

export const SurfaceScreenSchema = z
  .object({
    id: identifierSchema,
    label: labelSchema,
    children: z.array(SurfaceLayoutNodeSchema),
  })
  .strict()

/** 構造だけの検証。JSON Schema はこの形から生成する(参照・値域などの意味検証は含まない)。 */
export const SurfaceDefinitionStructureSchema = z
  .object({
    format: z.literal(SURFACE_DEFINITION_FORMAT),
    version: z.literal(SURFACE_DEFINITION_VERSION),
    name: labelSchema,
    parameters: z.array(SurfaceParameterSchema),
    // 省略可。無い定義(HID-166 以前)もそのまま有効
    actions: z.array(SurfaceActionSchema).optional(),
    screens: z.array(SurfaceScreenSchema),
  })
  .strict()

export type SurfaceAction = z.infer<typeof SurfaceActionSchema>
export type SurfaceParameter = z.infer<typeof SurfaceParameterSchema>
export type SurfaceScreen = z.infer<typeof SurfaceScreenSchema>
export type SurfaceDefinitionStructure = z.infer<typeof SurfaceDefinitionStructureSchema>

export interface SurfaceDefinitionIssue {
  path: (string | number)[]
  message: string
}

function widgetFits(widget: string, parameter: SurfaceParameter): boolean {
  switch (widget) {
    case 'slider':
      return parameter.kind === 'state' && (parameter.type === 'i' || parameter.type === 'f') && parameter.range !== undefined
    case 'switch':
      return parameter.kind === 'state' && parameter.type === 'bool'
    case 'button':
      return parameter.kind === 'trigger'
    case 'select':
      return parameter.kind === 'state' && parameter.type === 's' && (parameter.options !== undefined || parameter.optionsFrom !== undefined)
    case 'input':
      return parameter.kind === 'state' && (parameter.type === 's' || parameter.type === 'i' || parameter.type === 'f')
    default:
      return false
  }
}

function checkNumber(parameter: SurfaceParameter, field: 'default' | 'value', issues: SurfaceDefinitionIssue[], index: number): void {
  if (parameter.type !== 'i' && parameter.type !== 'f') return
  const current = parameter[field]
  if (current === undefined) return
  if (parameter.type === 'i' && (!Number.isInteger(current) || current < INT32_MIN || current > INT32_MAX)) {
    issues.push({ path: ['parameters', index, field], message: 'type i requires an int32 value' })
  }
  if (parameter.range !== undefined && (current < parameter.range[0] || current > parameter.range[1])) {
    issues.push({ path: ['parameters', index, field], message: `${field} must be within range` })
  }
}


/** id で索引化する。重複 id は(従来の find と同じく)先勝ち。重複自体は別の検証が報告する。 */
function indexById(parameters: readonly SurfaceParameter[]): Map<string, SurfaceParameter> {
  const index = new Map<string, SurfaceParameter>()
  for (const parameter of parameters) if (!index.has(parameter.id)) index.set(parameter.id, parameter)
  return index
}

export interface ResolvedActionStep {
  parameter: SurfaceParameter
  /** step で固定された値。無ければ呼び出し側が現在値(state)または定義の value(trigger)を使う。 */
  fixedValue?: number | string | boolean | undefined
}

/** アクションの steps を定義順の送信対象へ展開する。未知の param は無視する(意味検証が別に報告する)。 */
export function resolveActionSteps(
  action: SurfaceAction,
  parameters: readonly SurfaceParameter[],
): ResolvedActionStep[] {
  const resolved: ResolvedActionStep[] = []
  // 巨大な定義で steps × parameters を総当たりすると数十秒ブロックするため、id は事前に索引化し、
  // 1 bundle の上限(512 件)を超えた時点で展開を打ち切る(超過は意味検証が別に報告する)
  const byId = indexById(parameters)
  for (const step of action.steps) {
    if (resolved.length > OSC_BATCH.MAX_MESSAGES) break
    if ('param' in step) {
      const parameter = byId.get(step.param)
      if (parameter !== undefined) resolved.push({ parameter, fixedValue: step.value })
    } else {
      for (const parameter of parameters) {
        if (matchesPattern(step.match, parameter.address)) resolved.push({ parameter })
        if (resolved.length > OSC_BATCH.MAX_MESSAGES) break
      }
    }
  }
  return resolved
}

/** step の固定値がパラメータの型・値域・options に収まらなければ理由を返す。 */
function fixedValueProblem(parameter: SurfaceParameter, value: number | string | boolean): string | undefined {
  switch (parameter.type) {
    case 'bool':
      return typeof value === 'boolean' ? undefined : 'type bool requires a boolean value'
    case 's':
      if (typeof value !== 'string') return 'type s requires a string value'
      // optionsFrom の候補は実行時にしか分からないので、静的な options への所属を問わない(D-054)
      return parameter.options !== undefined && parameter.optionsFrom === undefined && !parameter.options.includes(value)
        ? 'value must be one of options'
        : undefined
    case 'i':
    case 'f':
      if (typeof value !== 'number') return `type ${parameter.type} requires a number value`
      if (parameter.type === 'i' && (!Number.isInteger(value) || value < INT32_MIN || value > INT32_MAX)) {
        return 'type i requires an int32 value'
      }
      if (parameter.range !== undefined && (value < parameter.range[0] || value > parameter.range[1])) {
        return 'value must be within range'
      }
      return undefined
  }
}

function collectActionIssues(definition: SurfaceDefinitionStructure, issues: SurfaceDefinitionIssue[]): void {
  const actionIds = new Set<string>()
  const parametersById = indexById(definition.parameters)
  ;(definition.actions ?? []).forEach((action, actionIndex) => {
    if (actionIds.has(action.id)) {
      issues.push({ path: ['actions', actionIndex, 'id'], message: 'duplicate action id' })
    }
    actionIds.add(action.id)

    // step は最低 1 件に展開されるので、上限超の steps は展開するまでもなく送れない。
    // 数千 step × 数千 parameter の総当たりで検証が数十秒ブロックするのを防ぐため、ここで打ち切る
    if (action.steps.length > OSC_BATCH.MAX_MESSAGES) {
      issues.push({ path: ['actions', actionIndex, 'steps'], message: `action has more than ${OSC_BATCH.MAX_MESSAGES} steps` })
      return
    }

    let total = 0
    action.steps.forEach((step, stepIndex) => {
      const at = (field: string): (string | number)[] => ['actions', actionIndex, 'steps', stepIndex, field]
      if ('param' in step) {
        const parameter = parametersById.get(step.param)
        if (parameter === undefined) {
          issues.push({ path: at('param'), message: `unknown parameter: ${step.param}` })
          return
        }
        total += 1
        if (step.value !== undefined) {
          if (parameter.kind === 'trigger') {
            issues.push({ path: at('value'), message: 'trigger parameter keeps its own value; step cannot override it' })
          } else {
            const problem = fixedValueProblem(parameter, step.value)
            if (problem !== undefined) issues.push({ path: at('value'), message: problem })
          }
        }
      } else {
        // 上限を超えた後は件数が要らない(超過は後段で報告)ので、1 件でも当たれば足りる
        const hits =
          total > OSC_BATCH.MAX_MESSAGES
            ? Number(definition.parameters.some((parameter) => matchesPattern(step.match, parameter.address)))
            : definition.parameters.filter((parameter) => matchesPattern(step.match, parameter.address)).length
        if (hits === 0) issues.push({ path: at('match'), message: `match hits no parameter: ${step.match}` })
        total += hits
      }
    })
    // 1 bundle に載せる上限(bridge の oscBatch と同じ)。超えると実行時に送れないので定義で止める
    if (total > OSC_BATCH.MAX_MESSAGES) {
      issues.push({ path: ['actions', actionIndex, 'steps'], message: `action expands to more than ${OSC_BATCH.MAX_MESSAGES} messages` })
    }
  })
}

/**
 * optionsFrom のアドレスの衝突(D-054)。一覧も要求もパラメータのアドレスと重なると、
 * 一覧が値のエコーと区別できず保持値や表示を壊す。また Unity はどのアドレスもエコーするので、
 * 要求アドレスが一覧のアドレスと重なると、要求(引数なし)のエコーが「空の一覧」として届いてしまう。
 * 複数のパラメータが同じ一覧・同じ要求を共有するのは可。
 */
function collectOptionsFromIssues(
  definition: SurfaceDefinitionStructure,
  parameterAddresses: ReadonlySet<string>,
  issues: SurfaceDefinitionIssue[],
): void {
  const listAddresses = new Set<string>()
  for (const parameter of definition.parameters) {
    if (parameter.type === 's' && parameter.optionsFrom !== undefined) listAddresses.add(parameter.optionsFrom.address)
  }
  definition.parameters.forEach((parameter, index) => {
    if (parameter.type !== 's' || parameter.optionsFrom === undefined) return
    const { address, request } = parameter.optionsFrom
    if (parameterAddresses.has(address)) {
      issues.push({ path: ['parameters', index, 'optionsFrom', 'address'], message: 'optionsFrom address must not be a parameter address' })
    }
    if (request === undefined) return
    if (parameterAddresses.has(request)) {
      issues.push({ path: ['parameters', index, 'optionsFrom', 'request'], message: 'optionsFrom request must not be a parameter address' })
    }
    if (listAddresses.has(request)) {
      issues.push({ path: ['parameters', index, 'optionsFrom', 'request'], message: 'optionsFrom request must not be an optionsFrom address' })
    }
  })
}

/**
 * 構造検証を通った定義に対する意味検証(JSON Schema では書けない規則)。
 * Python 側 `oscdesk_ui.surface_definition` が同じ規則を実装し、
 * `protocol/surface-definition-samples.json` で判定の一致を担保する。
 */
export function collectSurfaceDefinitionIssues(definition: SurfaceDefinitionStructure): SurfaceDefinitionIssue[] {
  const issues: SurfaceDefinitionIssue[] = []
  const ids = new Map<string, SurfaceParameter>()
  const addresses = new Set<string>()

  definition.parameters.forEach((parameter, index) => {
    if (ids.has(parameter.id)) {
      issues.push({ path: ['parameters', index, 'id'], message: 'duplicate parameter id' })
    }
    ids.set(parameter.id, parameter)
    if (addresses.has(parameter.address)) {
      issues.push({ path: ['parameters', index, 'address'], message: 'duplicate parameter address' })
    }
    addresses.add(parameter.address)

    if (parameter.kind === 'state') {
      if (parameter.value !== undefined) {
        issues.push({ path: ['parameters', index, 'value'], message: 'state parameter cannot define value' })
      }
    } else {
      if (parameter.value === undefined) {
        issues.push({ path: ['parameters', index, 'value'], message: 'trigger parameter requires value' })
      }
      for (const field of ['default', 'range', 'options', 'step', 'optionsFrom'] as const) {
        if (field in parameter) {
          issues.push({ path: ['parameters', index, field], message: `trigger parameter cannot define ${field}` })
        }
      }
    }

    if ((parameter.type === 'i' || parameter.type === 'f') && parameter.range !== undefined) {
      if (parameter.range[0] >= parameter.range[1]) {
        issues.push({ path: ['parameters', index, 'range'], message: 'range minimum must be less than maximum' })
      }
      if (parameter.step !== undefined && parameter.step > parameter.range[1] - parameter.range[0]) {
        issues.push({ path: ['parameters', index, 'step'], message: 'step must not exceed the range width' })
      }
      if (parameter.type === 'i' && !parameter.range.every((bound) => Number.isInteger(bound) && bound >= INT32_MIN && bound <= INT32_MAX)) {
        issues.push({ path: ['parameters', index, 'range'], message: 'type i requires int32 range bounds' })
      }
    }
    if (parameter.type === 'i' && parameter.step !== undefined && !Number.isInteger(parameter.step)) {
      issues.push({ path: ['parameters', index, 'step'], message: 'type i requires an integer step' })
    }
    checkNumber(parameter, 'default', issues, index)
    checkNumber(parameter, 'value', issues, index)

    if (parameter.type === 's' && parameter.options !== undefined) {
      if (new Set(parameter.options).size !== parameter.options.length) {
        issues.push({ path: ['parameters', index, 'options'], message: 'options must be unique' })
      }
      // optionsFrom を持つなら default は Unity の一覧にある名前でもよい(D-053 / D-054)。value は state では別に拒否される
      for (const field of parameter.optionsFrom === undefined ? (['default', 'value'] as const) : (['value'] as const)) {
        const current = parameter[field]
        if (current !== undefined && !parameter.options.includes(current)) {
          issues.push({ path: ['parameters', index, field], message: `${field} must be one of options` })
        }
      }
    }
  })

  collectOptionsFromIssues(definition, addresses, issues)
  collectActionIssues(definition, issues)

  const actionIds = new Set((definition.actions ?? []).map((action) => action.id))
  const screenIds = new Set<string>()
  definition.screens.forEach((screen, screenIndex) => {
    if (screenIds.has(screen.id)) {
      issues.push({ path: ['screens', screenIndex, 'id'], message: 'duplicate screen id' })
    }
    screenIds.add(screen.id)

    const visit = (nodes: SurfaceLayoutNode[], nodePath: (string | number)[]): void => {
      nodes.forEach((node, nodeIndex) => {
        const here = [...nodePath, nodeIndex]
        if (node.kind === 'control') {
          const parameter = ids.get(node.param)
          if (parameter === undefined) {
            issues.push({ path: [...here, 'param'], message: `unknown parameter: ${node.param}` })
          } else if (node.widget !== undefined && !widgetFits(node.widget, parameter)) {
            issues.push({ path: [...here, 'widget'], message: `widget ${node.widget} does not fit parameter ${node.param}` })
          }
        } else if (node.kind === 'action') {
          if (!actionIds.has(node.action)) {
            issues.push({ path: [...here, 'action'], message: `unknown action: ${node.action}` })
          }
        } else if (node.kind === 'tabs') {
          node.tabs.forEach((tab, tabIndex) => visit(tab.children, [...here, 'tabs', tabIndex, 'children']))
        } else {
          visit(node.children, [...here, 'children'])
        }
      })
    }
    visit(screen.children, ['screens', screenIndex, 'children'])
  })

  return issues
}

export const SurfaceDefinitionSchema = SurfaceDefinitionStructureSchema.superRefine((definition, context) => {
  for (const issue of collectSurfaceDefinitionIssues(definition)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: issue.path, message: issue.message })
  }
})

export type SurfaceDefinition = SurfaceDefinitionStructure
