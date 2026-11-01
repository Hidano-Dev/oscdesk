import { z } from 'zod'

import { matchesPattern } from './address-pattern'
import { OSC_BATCH } from './limits'
import {
  ADDRESS_MATCH_PATTERN,
  IDENTIFIER_PATTERN,
  PARAMETER_ADDRESS_PATTERN,
  RECORD_KEYS_MAX,
  SURFACE_DEFINITION_FORMAT,
  SURFACE_WIDGET_HINTS,
  SurfaceScreenSchema,
  type SurfaceDefinition,
} from './surface-definition'

// OSC に解決したサーフェス定義(D-117)。版 2 の定義の本体に bindings.osc のアドレスを当てはめた形で、
// 版 1 のファイルの形と同じ。ブリッジの中(保持値・再送・一覧・行の生成・送信)はこの形で動き、
// UI とのフレームの出入りでパラメータ id の語彙へ直す(UI はこの形を見ない)。
// 版 1 のファイルは読み込むときに版 2 へ移す(surface-migration.ts)ので、ここには意味検証を置かない
// (検証は版 2 の定義で済ませ、解決した結果は検証済みの定義から作るため)。

export const OSC_DEFINITION_VERSION = 1

const identifierSchema = z.string().regex(new RegExp(IDENTIFIER_PATTERN))
const labelSchema = z.string().min(1)
const concreteAddressSchema = z.string().regex(new RegExp(PARAMETER_ADDRESS_PATTERN))
const listSourceSchema = z.object({ address: concreteAddressSchema, request: concreteAddressSchema.optional() }).strict()
const keysFromSchema = z
  .object({
    address: concreteAddressSchema,
    request: concreteAddressSchema.optional(),
    source: z.enum(['unity', 'ui']).optional(),
    max: z.number().int().min(1).max(RECORD_KEYS_MAX).optional(),
  })
  .strict()

const parameterBaseFields = {
  id: identifierSchema,
  address: concreteAddressSchema,
  label: labelSchema,
  kind: z.enum(['state', 'trigger']),
  standalone: z.boolean().optional(),
  widget: z.enum(SURFACE_WIDGET_HINTS).optional(),
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
      value: z.number().optional(),
    })
    .strict()

export const OscSurfaceParameterSchema = z.discriminatedUnion('type', [
  numericParameter('i'),
  numericParameter('f'),
  z
    .object({
      ...parameterBaseFields,
      type: z.literal('s'),
      options: z.array(z.string()).min(1).optional(),
      optionsFrom: listSourceSchema.optional(),
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

const numericRecordField = <T extends 'i' | 'f'>(type: T) =>
  z
    .object({
      id: identifierSchema,
      label: labelSchema,
      type: z.literal(type),
      range: rangeSchema.optional(),
      step: z.number().positive().optional(),
      default: z.number().optional(),
      value: z.number().optional(),
    })
    .strict()

export const OscSurfaceRecordFieldSchema = z.discriminatedUnion('type', [
  numericRecordField('i'),
  numericRecordField('f'),
  z
    .object({
      id: identifierSchema,
      label: labelSchema,
      type: z.literal('s'),
      options: z.array(z.string()).min(1).optional(),
      optionsFrom: listSourceSchema.optional(),
      default: z.string().optional(),
      value: z.string().optional(),
    })
    .strict(),
  z
    .object({
      id: identifierSchema,
      label: labelSchema,
      type: z.literal('bool'),
      default: z.boolean().optional(),
      value: z.boolean().optional(),
    })
    .strict(),
])

// 1 アドレスで [s:キー, フィールドを宣言順に] を運ぶ(D-059 / D-061)
export const OscSurfaceRecordSchema = z
  .object({
    id: identifierSchema,
    address: concreteAddressSchema,
    label: labelSchema,
    kind: z.enum(['state', 'trigger']),
    key: z.object({ label: labelSchema.optional() }).strict().optional(),
    keysFrom: keysFromSchema,
    fields: z.array(OscSurfaceRecordFieldSchema),
  })
  .strict()

const fixedValueSchema = z.union([z.number(), z.string(), z.boolean()])

const actionStepSchema = z.union([
  z.object({ param: identifierSchema, value: fixedValueSchema.optional() }).strict(),
  // match: アドレスパターン(`*` は 1 パート内の 0 文字以上)に合う全パラメータを定義順に
  z.object({ match: z.string().regex(new RegExp(ADDRESS_MATCH_PATTERN)) }).strict(),
  z.object({ record: identifierSchema, value: z.record(identifierSchema, fixedValueSchema).optional() }).strict(),
])

export const OscSurfaceActionSchema = z
  .object({
    id: identifierSchema,
    label: labelSchema,
    scope: z.enum(['row', 'all']).optional(),
    steps: z.array(actionStepSchema).min(1),
  })
  .strict()

/** OSC に解決した定義の構造(版 1 のファイルの形)。 */
export const OscSurfaceDefinitionStructureSchema = z
  .object({
    format: z.literal(SURFACE_DEFINITION_FORMAT),
    version: z.literal(OSC_DEFINITION_VERSION),
    name: labelSchema,
    parameters: z.array(OscSurfaceParameterSchema),
    records: z.array(OscSurfaceRecordSchema).optional(),
    actions: z.array(OscSurfaceActionSchema).optional(),
    screens: z.array(SurfaceScreenSchema),
  })
  .strict()

export type OscSurfaceAction = z.infer<typeof OscSurfaceActionSchema>
export type OscSurfaceActionStep = OscSurfaceAction['steps'][number]
export type OscSurfaceRecordStep = Extract<OscSurfaceActionStep, { record: string }>
export type OscSurfaceRecord = z.infer<typeof OscSurfaceRecordSchema>
export type OscSurfaceRecordField = z.infer<typeof OscSurfaceRecordFieldSchema>
export type OscSurfaceParameter = z.infer<typeof OscSurfaceParameterSchema>
export type OscSurfaceDefinition = z.infer<typeof OscSurfaceDefinitionStructureSchema>

/**
 * 検証済みの版 2 の定義を、OSC に解決した形にする。bindings.osc が無い・足りない定義は解決できない(例外)。
 * 一覧の参照(optionsFrom・keysFrom)は一覧の結び付けのアドレスと要求に、selector の step は match に戻す
 */
export function resolveOscSurface(definition: SurfaceDefinition): OscSurfaceDefinition {
  const osc = definition.bindings?.osc
  if (osc === undefined) throw new Error(`surface "${definition.name}" has no osc bindings`)
  const need = <T>(table: ReadonlyMap<string, T>, id: string, label: string): T => {
    const found = table.get(id)
    if (found === undefined) throw new Error(`surface "${definition.name}" has no osc binding for ${label} ${id}`)
    return found
  }
  const parameterAddresses = new Map(osc.parameters.map(binding => [binding.id, binding.address]))
  const recordAddresses = new Map((osc.records ?? []).map(binding => [binding.id, binding.address]))
  const lists = new Map((osc.lists ?? []).map(binding => [binding.id, binding]))
  const selectors = new Map((osc.selectors ?? []).map(binding => [binding.id, binding.match]))
  const listSource = (list: string) => {
    const binding = need(lists, list, 'list')
    return { address: binding.address, ...(binding.request === undefined ? {} : { request: binding.request }) }
  }
  const parameters = definition.parameters.map((parameter): OscSurfaceParameter => {
    const address = need(parameterAddresses, parameter.id, 'parameter')
    if (parameter.type === 's' && parameter.optionsFrom !== undefined) {
      return { ...parameter, address, optionsFrom: listSource(parameter.optionsFrom.list) }
    }
    return { ...parameter, address } as OscSurfaceParameter
  })
  const records = definition.records?.map((record): OscSurfaceRecord => {
    const { list, ...keysFrom } = record.keysFrom
    return {
      ...record,
      address: need(recordAddresses, record.id, 'record'),
      keysFrom: { ...listSource(list), ...keysFrom },
      fields: record.fields.map((field): OscSurfaceRecordField => field.type === 's' && field.optionsFrom !== undefined
        ? { ...field, optionsFrom: listSource(field.optionsFrom.list) }
        : field as OscSurfaceRecordField),
    }
  })
  const actions = definition.actions?.map((action): OscSurfaceAction => ({
    ...action,
    steps: action.steps.map((step): OscSurfaceActionStep => {
      return 'selector' in step ? { match: need(selectors, step.selector, 'selector') } : step
    }),
  }))
  return {
    format: SURFACE_DEFINITION_FORMAT,
    version: OSC_DEFINITION_VERSION,
    name: definition.name,
    parameters,
    ...(records === undefined ? {} : { records }),
    ...(actions === undefined ? {} : { actions }),
    screens: definition.screens,
  }
}

export interface ResolvedActionStep {
  parameter: OscSurfaceParameter
  /** step で固定された値。無ければ呼び出し側が現在値(state)または定義の value(trigger)を使う。 */
  fixedValue?: number | string | boolean | undefined
}

/**
 * アクションの steps を定義順の送信対象へ展開する。未知の param は無視する(意味検証が別に報告する)。
 * record step は行のキーが要るので扱わない(`resolveRecordActionSteps` を使う。D-061)。
 */
export function resolveActionSteps(
  action: OscSurfaceAction,
  parameters: readonly OscSurfaceParameter[],
): ResolvedActionStep[] {
  const resolved: ResolvedActionStep[] = []
  // 巨大な定義で steps × parameters を総当たりすると数十秒ブロックするため、id は事前に索引化し、
  // 1 bundle の上限(512 件)を超えた時点で展開を打ち切る(超過は意味検証が別に報告する)
  const byId = new Map<string, OscSurfaceParameter>()
  for (const parameter of parameters) if (!byId.has(parameter.id)) byId.set(parameter.id, parameter)
  for (const step of action.steps) {
    if (resolved.length > OSC_BATCH.MAX_MESSAGES) break
    if ('param' in step) {
      const parameter = byId.get(step.param)
      if (parameter !== undefined) resolved.push({ parameter, fixedValue: step.value })
    } else if ('match' in step) {
      for (const parameter of parameters) {
        if (matchesPattern(step.match, parameter.address)) resolved.push({ parameter })
        if (resolved.length > OSC_BATCH.MAX_MESSAGES) break
      }
    }
  }
  return resolved
}
