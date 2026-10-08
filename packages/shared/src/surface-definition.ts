import { z } from 'zod'

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
const IDENTIFIER_PATTERN = '^[A-Za-z][A-Za-z0-9_-]{0,63}(?![\\s\\S])'

const identifierSchema = z.string().regex(new RegExp(IDENTIFIER_PATTERN))
const labelSchema = z.string().min(1)

const parameterBaseFields = {
  id: identifierSchema,
  address: z.string().regex(new RegExp(PARAMETER_ADDRESS_PATTERN)),
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
      options: z.array(z.string()).min(1).optional(),
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
export type SurfaceLayoutNode =
  | SurfaceControlNode
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
    screens: z.array(SurfaceScreenSchema),
  })
  .strict()

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
      return parameter.kind === 'state' && parameter.type === 's' && parameter.options !== undefined
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
      for (const field of ['default', 'range', 'options', 'step'] as const) {
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
      for (const field of ['default', 'value'] as const) {
        const current = parameter[field]
        if (current !== undefined && !parameter.options.includes(current)) {
          issues.push({ path: ['parameters', index, field], message: `${field} must be one of options` })
        }
      }
    }
  })

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
