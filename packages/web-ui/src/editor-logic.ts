// 編集モードの純粋な部分(D-144)。
// 編集の規則(木の操作・フォームの読み取り・結び付けとアクションの追従・検証)はブリッジの surface-editor.ts にあり(D-123)、
// ここに写さない。ここに置くのは、作業コピーを描くための読み取り(どれも作業コピーを書き換えない)と、フォームの入力を
// 編集命令の形へ詰めることだけ

import {
  SURFACE_DEFINITION_FORMAT,
  SURFACE_DEFINITION_VERSION,
  type EditStep,
  type NodeRef,
  type OscBindings,
  type ParameterForm,
  type SurfaceBindings,
  type SurfaceDefinition,
  type SurfaceLayoutNode,
  type SurfaceParameter,
} from '@oscdesk/shared'

export type LayoutKind = SurfaceLayoutNode['kind']
export type Width = number | 'auto' | null

export const WRAP_KINDS: readonly LayoutKind[] = ['row', 'column', 'group']
// 子を持たない配置のノード。record(D-061)はレコード表で、children を持たない
export const LEAF_KINDS: readonly LayoutKind[] = ['control', 'action', 'record']

export const KIND_NAMES: Record<LayoutKind, string> = {
  control: '部品',
  action: 'アクション',
  record: 'レコード表',
  row: '行',
  column: '列',
  group: 'グループ',
  tabs: 'タブ',
}

/** 幅の選択肢(値は select の value の文字列)。 */
export const WIDTH_OPTIONS: readonly { value: string; label: string }[] = [
  { value: '', label: '指定なし' },
  { value: 'auto', label: '自動' },
  ...Array.from({ length: 12 }, (_, index) => ({ value: String(index + 1), label: `${index + 1}/12` })),
]

// 一覧(画面の部品・未配置のパラメータ・パラメータ・レコード)ごとに一度に描く行の数(HID-405)。
// SPA は変わった部品だけを描き直すが、1 万個の部品を一度に DOM にすると最初の描画でブラウザが固まるのは同じ
export const EDITOR_ROWS_STEP = 200
export type EditorSection = 'nodes' | 'unplaced' | 'parameters' | 'records'
export const EDITOR_SECTIONS: readonly EditorSection[] = ['nodes', 'unplaced', 'parameters', 'records']

export function widthText(width: SurfaceLayoutNode['width']): string {
  return width === undefined ? '' : String(width)
}

export function widthFromText(text: string): Width {
  if (text === '') return null
  if (text === 'auto') return 'auto'
  return Number.parseInt(text, 10)
}

function childrenOf(node: SurfaceLayoutNode): SurfaceLayoutNode[] | null {
  return node.kind === 'row' || node.kind === 'column' || node.kind === 'group' ? node.children : null
}

/** ref のノード(無ければ null)。描画が今の値と比べるためだけに使う(書き換えはブリッジの編集命令)。 */
export function nodeAt(definition: SurfaceDefinition, ref: NodeRef): SurfaceLayoutNode | null {
  let nodes: SurfaceLayoutNode[] | undefined = definition.screens[ref.screen]?.children
  for (const step of ref.steps) {
    if (nodes === undefined) return null
    if (Array.isArray(step)) {
      const node: SurfaceLayoutNode | undefined = nodes[step[0]]
      nodes = node?.kind === 'tabs' ? node.tabs[step[1]]?.children : undefined
    } else {
      const node: SurfaceLayoutNode | undefined = nodes[step]
      nodes = node === undefined ? undefined : childrenOf(node) ?? undefined
    }
  }
  return nodes?.[ref.index] ?? null
}

/** ノードとその子孫の数(タブの中を含む)。 */
export function countNodes(nodes: readonly SurfaceLayoutNode[]): number {
  let total = 0
  for (const node of nodes) {
    total += 1
    if (node.kind === 'tabs') {
      for (const tab of node.tabs) total += countNodes(tab.children)
    } else {
      const children = childrenOf(node)
      if (children !== null) total += countNodes(children)
    }
  }
  return total
}

export type TreeRow =
  | { type: 'screen'; key: string; label: string }
  | { type: 'tab'; key: string; label: string; depth: number }
  | { type: 'node'; key: string; ref: NodeRef; node: SurfaceLayoutNode; depth: number }

/**
 * 画面ごとの配置の木を、描く順の行の並びにする。上限(limit)を超えた行は描かず、その数(子孫を含む)を hidden に数える。
 * 画面の見出しとタブの見出しは行に数えない。上限に達した後の画面は見出しごと省く
 */
export function treeRows(definition: SurfaceDefinition, limit: number): { rows: TreeRow[]; hidden: number } {
  const rows: TreeRow[] = []
  let left = limit
  let hidden = 0
  const keyOf = (ref: NodeRef) => `${ref.screen}/${ref.steps.map((step) => (Array.isArray(step) ? `${step[0]}.${step[1]}` : String(step))).join('/')}/${ref.index}`
  const visit = (nodes: readonly SurfaceLayoutNode[], screen: number, steps: EditStep[], depth: number) => {
    nodes.forEach((node, index) => {
      if (left <= 0) {
        hidden += countNodes([node])
        return
      }
      left -= 1
      const ref: NodeRef = { screen, steps, index }
      rows.push({ type: 'node', key: keyOf(ref), ref, node, depth })
      if (node.kind === 'tabs') {
        node.tabs.forEach((tab, tabIndex) => {
          rows.push({ type: 'tab', key: `${keyOf(ref)}#${tabIndex}`, label: tab.label, depth: depth + 1 })
          visit(tab.children, screen, [...steps, [index, tabIndex]], depth + 1)
        })
        return
      }
      const children = childrenOf(node)
      if (children !== null) visit(children, screen, [...steps, index], depth + 1)
    })
  }
  definition.screens.forEach((screen, screenIndex) => {
    if (left <= 0) {
      hidden += countNodes(screen.children)
      return
    }
    rows.push({ type: 'screen', key: `screen-${screenIndex}`, label: screen.label })
    visit(screen.children, screenIndex, [], 0)
  })
  return { rows, hidden }
}

/** 一覧の先頭 limit 件と、描かなかった数。 */
export function budgeted<T>(items: readonly T[], limit: number): { shown: readonly T[]; hidden: number } {
  return { shown: items.slice(0, limit), hidden: Math.max(0, items.length - limit) }
}

export function nodeText(node: SurfaceLayoutNode): string {
  switch (node.kind) {
    case 'control':
      return `部品: ${node.label || node.param} (${node.param})`
    case 'action':
      return `アクション: ${node.label || node.action} (${node.action})`
    case 'record':
      return `レコード表: ${node.label || node.record} (${node.record})`
    case 'group':
      return `グループ: ${node.label}`
    default:
      return KIND_NAMES[node.kind]
  }
}

/** 定義の OSC の結び付け(bindings.osc)。無ければ null(OSC のアダプタが無いブリッジの定義)。 */
export function oscBindings(definition: SurfaceDefinition): OscBindings | null {
  return definition.bindings?.osc ?? null
}

/** パラメータの OSC のアドレス(結び付けに無ければ null)。編集モードのアドレスの欄に出す。 */
export function parameterAddress(definition: SurfaceDefinition, paramId: string): string | null {
  return oscBindings(definition)?.parameters.find((binding) => binding.id === paramId)?.address ?? null
}

export function recordAddress(definition: SurfaceDefinition, recordId: string): string | null {
  return oscBindings(definition)?.records?.find((binding) => binding.id === recordId)?.address ?? null
}

/** 一覧の結び付け({id, address, request?})。無ければ null。 */
export function listBinding(definition: SurfaceDefinition, listId: string): { id: string; address: string; request?: string | undefined } | null {
  return oscBindings(definition)?.lists?.find((binding) => binding.id === listId) ?? null
}

export function unplacedParameterIds(definition: SurfaceDefinition): string[] {
  const placed = new Set<string>()
  const visit = (nodes: readonly SurfaceLayoutNode[]) => {
    for (const node of nodes) {
      if (node.kind === 'control') placed.add(node.param)
      if (node.kind === 'tabs') for (const tab of node.tabs) visit(tab.children)
      else visit(childrenOf(node) ?? [])
    }
  }
  for (const screen of definition.screens) visit(screen.children)
  return definition.parameters.map((parameter) => parameter.id).filter((id) => !placed.has(id))
}

/** 採用中の定義が無いときの編集の出発点(画面を 1 つ持たせ、すぐ部品を置ける)。osc なら空の OSC の結び付けも持たせる。 */
export function newDefinition(name = 'New', osc = true): SurfaceDefinition {
  return {
    format: SURFACE_DEFINITION_FORMAT,
    version: SURFACE_DEFINITION_VERSION,
    name,
    parameters: [],
    screens: [{ id: 'main', label: 'Main', children: [] }],
    ...(osc ? { bindings: { osc: { parameters: [] } } } : {}),
  }
}

/** 本体と結び付けを 1 つの定義にする(編集の作業コピー用)。結び付けが空なら本体だけ。 */
export function joinBindings(body: SurfaceDefinition, bindings: SurfaceBindings): SurfaceDefinition {
  const { bindings: _ignored, ...rest } = body
  return Object.keys(bindings).length > 0 ? { ...rest, bindings } : rest
}

/** 保存のフレーム用に、作業コピーを本体と結び付けに分ける(D-117)。 */
export function splitForSave(definition: SurfaceDefinition): { body: Record<string, unknown>; bindings: Record<string, unknown> | undefined } {
  const { bindings, ...body } = definition
  return { body, bindings }
}

// キーの順に依らない比較。ブリッジの答え(zod を通した定義)は、キーの順が送った作業コピーと同じとは限らない
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    )
  }
  return value
}

export function sameDefinition(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
}

/** 重複しない id の候補(base1, base2 ...)。 */
export function suggestParameterId(existing: ReadonlySet<string>, base = 'param'): string {
  let number = 1
  while (existing.has(`${base}${number}`)) number += 1
  return `${base}${number}`
}

export function safeFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_') || 'surface'
}

function boolText(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return value === undefined || value === null ? '' : String(value)
}

/** パラメータの編集フォームの入力(すべて文字列。kind・type・standalone は選択)。 */
export interface ParameterFields {
  id: string
  address: string
  label: string
  kind: string
  type: string
  standalone: boolean
  widget: string
  min: string
  max: string
  step: string
  options: string
  optionsFromAddress: string
  optionsFromRequest: string
  optionsFromList: string
  default: string
  value: string
}

/**
 * フォームの初期値。parameter が null なら追加(重複しない id の候補で始める)。組み合わせの型(D-121)はフォームで表せないので
 * 呼び出し側が開かない(フォームで作り直すとフィールドを失う)
 */
export function parameterFields(definition: SurfaceDefinition, parameter: SurfaceParameter | null): ParameterFields {
  if (parameter === null) {
    return {
      id: suggestParameterId(new Set(definition.parameters.map((item) => item.id))),
      address: '/',
      label: '',
      kind: 'state',
      type: 'f',
      standalone: true,
      widget: '',
      min: '',
      max: '',
      step: '',
      options: '',
      optionsFromAddress: '',
      optionsFromRequest: '',
      optionsFromList: '',
      default: '',
      value: '',
    }
  }
  const scalar = parameter.type === 'composite' ? null : parameter
  const range = scalar !== null && 'range' in scalar ? scalar.range : undefined
  const optionsFrom = scalar?.type === 's' ? scalar.optionsFrom : undefined
  const listSource = optionsFrom === undefined ? null : listBinding(definition, optionsFrom.list)
  return {
    id: parameter.id,
    address: parameterAddress(definition, parameter.id) ?? '/',
    label: parameter.label ?? '',
    kind: parameter.kind,
    type: parameter.type,
    standalone: parameter.standalone ?? true,
    widget: parameter.widget ?? '',
    min: range === undefined ? '' : String(range[0]),
    max: range === undefined ? '' : String(range[1]),
    step: scalar !== null && 'step' in scalar && scalar.step !== undefined ? String(scalar.step) : '',
    options: scalar?.type === 's' ? (scalar.options ?? []).join(',') : '',
    optionsFromAddress: listSource?.address ?? '',
    optionsFromRequest: listSource?.request ?? '',
    optionsFromList: optionsFrom?.list ?? '',
    default: boolText(scalar?.default),
    value: boolText(scalar?.value),
  }
}

/**
 * フォームの入力を編集命令の form にする。読み取りと型ごとの規則はブリッジ(D-123)。OSC の欄(アドレス・一覧のアドレスと要求)は
 * ブリッジが OSC のアダプタを持つときだけ osc に入れ、無ければ実行時の一覧の id を送る(D-117)
 */
export function parameterForm(fields: ParameterFields, hasOsc: boolean): ParameterForm {
  const base = {
    id: fields.id,
    label: fields.label,
    kind: fields.kind,
    type: fields.type,
    standalone: fields.standalone,
    widget: fields.widget,
    min: fields.min,
    max: fields.max,
    step: fields.step,
    options: fields.options,
    default: fields.default,
    value: fields.value,
  }
  return hasOsc
    ? { ...base, osc: { address: fields.address, listAddress: fields.optionsFromAddress, listRequest: fields.optionsFromRequest } }
    : { ...base, optionsFromList: fields.optionsFromList }
}

export function parameterSummary(definition: SurfaceDefinition, parameter: SurfaceParameter, hasOsc: boolean): string {
  const address = hasOsc ? parameterAddress(definition, parameter.id) ?? '' : ''
  return `${parameter.id}  ${address}  (${parameter.type}, ${parameter.kind})`
}

export function recordSummary(definition: SurfaceDefinition, record: NonNullable<SurfaceDefinition['records']>[number], hasOsc: boolean): string {
  const fields = record.fields.map((field) => `${field.id}:${field.type}`).join(', ') || 'フィールドなし'
  let keys = record.keysFrom.list
  let address = ''
  if (hasOsc) {
    address = recordAddress(definition, record.id) ?? ''
    keys = listBinding(definition, keys)?.address ?? keys
  }
  return `${record.id}  ${address}  (${record.kind}, キー: ${keys}, ${fields})`
}
