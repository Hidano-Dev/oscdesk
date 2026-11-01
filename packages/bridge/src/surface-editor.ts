import {
  idFromAddress,
  matchesPattern,
  migrateSurfaceDefinition,
  SurfaceDefinitionSchema,
  type EditStep,
  type NodeRef,
  type OscBindings,
  type ParameterForm,
  type SurfaceActionStep,
  type SurfaceDefinition,
  type SurfaceLayoutNode,
  type SurfaceEdit,
  type SurfaceParameter,
} from '@oscdesk/shared'

/**
 * サーフェス定義(版 2。D-117)の編集の規則(D-123)。UI から移した純粋関数で、作業コピーを丸ごと複製して変えた新しい定義を返す。
 * 失敗しても元の定義は壊れず、呼び出し側(applySurfaceEdit)は検証に通ったものだけを返す。
 *
 * パラメータの本体と OSC の結び付け(bindings.osc)を分けて持ち、パラメータの追加・変更・削除では結び付けも一緒に揃える
 * (保存は結び付けの欠けた・余った定義を断るため)。結び付けを持たない定義(OSC のアダプタが無いブリッジ)では触れない。
 *
 * ノードの指し方(NodeRef)は screen(screens の添字)・steps(そこから降りる入れ子。行・列・グループへは子の添字、
 * タブへは [子の添字, タブの添字])・index(降りた先の children の中の添字)。
 */

export type SurfaceEditResult = { ok: true; definition: SurfaceDefinition } | { ok: false; detail: string }

/** 編集の規則に合わない(理由は画面にそのまま出す日本語) */
export class EditError extends Error {}

const WRAP_KINDS = new Set(['row', 'column', 'group'])
type Container = Extract<SurfaceLayoutNode, { children: SurfaceLayoutNode[] }>
type OscListBinding = NonNullable<OscBindings['lists']>[number]

/** 作業コピーの検証。保存と同じ SurfaceDefinitionSchema(結び付けを省いた本体だけの定義も構造としては有効) */
function validate(candidate: unknown): SurfaceEditResult {
  const parsed = SurfaceDefinitionSchema.safeParse(candidate)
  if (!parsed.success) {
    return { ok: false, detail: parsed.error.issues.slice(0, 3).map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ') }
  }
  return { ok: true, definition: parsed.data }
}

/**
 * 作業コピーに編集を 1 つ当てて検証する(上り surfaceEdit。D-123)。作業コピーは UI が持ち、編集のたびに丸ごと送ってくる
 * (サーバーは編集中の状態を持たない)。作業コピーそのものが検証に通らなければ編集しない。replace は作業コピーを使わず、
 * 定義のファイル(版 1 はパラメータに address を書く形)を版 2 へ移してから検証する
 */
export function applySurfaceEdit(draft: unknown, edit: SurfaceEdit): SurfaceEditResult {
  if (edit.op === 'replace') return validate(migrateSurfaceDefinition(edit.definition))
  const base = SurfaceDefinitionSchema.safeParse(draft)
  if (!base.success) return { ok: false, detail: `作業中の定義が不正です: ${base.error.issues[0]?.message ?? 'invalid'}` }
  let candidate: SurfaceDefinition
  try {
    candidate = applyEdit(base.data, edit)
  } catch (error) {
    if (error instanceof EditError) return { ok: false, detail: error.message }
    throw error
  }
  return validate(candidate)
}

function applyEdit(definition: SurfaceDefinition, edit: Exclude<SurfaceEdit, { op: 'replace' }>): SurfaceDefinition {
  switch (edit.op) {
    case 'setParameter': {
      const parameter = buildParameter(edit.form, definition)
      const osc = parameterOscBinding(edit.form)
      return edit.original === null ? addParameter(definition, parameter, osc) : updateParameter(definition, edit.original, parameter, osc)
    }
    case 'removeParameter': return removeParameter(definition, edit.param)
    case 'addControl': return addControl(definition, edit.screen, edit.param, edit.steps)
    case 'removeNode': return removeNode(definition, edit.ref)
    case 'moveNode': return moveNode(definition, edit.ref, edit.delta)
    case 'wrapNode': return wrapNode(definition, edit.ref, edit.kind, edit.label)
    case 'mergeWithNext': return mergeWithNext(definition, edit.ref)
    case 'unwrapNode': return unwrapNode(definition, edit.ref)
    case 'setWidth': return setWidth(definition, edit.ref, edit.width)
    case 'setCollapsed': return setCollapsed(definition, edit.ref, edit.collapsed)
    case 'setLabel': return setLabel(definition, edit.ref, edit.label)
    case 'rename': return { ...structuredClone(definition), name: edit.name }
  }
}

// --- 木の辿り方 ---------------------------------------------------------------

function childrenAt(definition: SurfaceDefinition, screen: number, steps: readonly EditStep[]): SurfaceLayoutNode[] {
  let nodes: SurfaceLayoutNode[] | undefined = definition.screens[screen]?.children
  for (const step of steps) {
    if (nodes === undefined) break
    if (Array.isArray(step)) {
      const [index, tab] = step
      const node: SurfaceLayoutNode | undefined = nodes[index]
      nodes = node?.kind === 'tabs' ? node.tabs[tab]?.children : undefined
    } else {
      const node: SurfaceLayoutNode | undefined = nodes[step]
      nodes = node !== undefined && 'children' in node ? node.children : undefined
    }
  }
  if (nodes === undefined) throw new EditError('対象の場所が見つかりません')
  return nodes
}

function locate(definition: SurfaceDefinition, ref: NodeRef): { nodes: SurfaceLayoutNode[]; index: number; node: SurfaceLayoutNode } {
  const nodes = childrenAt(definition, ref.screen, ref.steps)
  const node = nodes[ref.index]
  if (node === undefined) throw new EditError('対象の部品が見つかりません')
  return { nodes, index: ref.index, node }
}

function visit(nodes: readonly SurfaceLayoutNode[], action: (node: SurfaceLayoutNode) => void): void {
  for (const node of nodes) {
    action(node)
    if (node.kind === 'tabs') for (const tab of node.tabs) visit(tab.children, action)
    else if ('children' in node) visit(node.children, action)
  }
}

/** 条件に合う葉(部品・アクション)を木から外す。行・列・グループ・タブは空になっても残す(UI で消せる) */
function withoutLeaves(nodes: SurfaceLayoutNode[], drop: (node: SurfaceLayoutNode) => boolean): SurfaceLayoutNode[] {
  const kept: SurfaceLayoutNode[] = []
  for (const node of nodes) {
    if (drop(node)) continue
    if (node.kind === 'tabs') for (const tab of node.tabs) tab.children = withoutLeaves(tab.children, drop)
    else if ('children' in node) node.children = withoutLeaves(node.children, drop)
    kept.push(node)
  }
  return kept
}

// --- パラメータ層 -------------------------------------------------------------

function referencedLists(definition: SurfaceDefinition): Set<string> {
  const lists = new Set<string>()
  for (const parameter of definition.parameters) if ('optionsFrom' in parameter && parameter.optionsFrom !== undefined) lists.add(parameter.optionsFrom.list)
  for (const record of definition.records ?? []) {
    lists.add(record.keysFrom.list)
    for (const field of record.fields) if ('optionsFrom' in field && field.optionsFrom !== undefined) lists.add(field.optionsFrom.list)
  }
  return lists
}

/** その OSC のアドレスで一覧を受けるときの一覧の id。同じアドレスの一覧が既にあればそれを共有する */
function listIdFor(definition: SurfaceDefinition, address: string): string {
  const lists = definition.bindings?.osc?.lists ?? []
  const existing = lists.find(binding => binding.address === address)
  if (existing !== undefined) return existing.id
  return idFromAddress('l_', address, new Set([...lists.map(binding => binding.id), ...referencedLists(definition)]))
}

interface ParameterOscInput { address: string; list: { address: string; request: string } | null }

function parameterOscBinding(form: ParameterForm): ParameterOscInput | null {
  if (form.osc === undefined) return null
  const listAddress = form.osc.listAddress.trim()
  const listRequest = form.osc.listRequest.trim()
  return { address: form.osc.address.trim(), list: listAddress === '' ? null : { address: listAddress, request: listRequest } }
}

function setParameterBinding(result: SurfaceDefinition, parameter: SurfaceParameter, osc: ParameterOscInput): void {
  result.bindings ??= {}
  result.bindings.osc ??= { parameters: [] }
  const bindings = result.bindings.osc
  const current = bindings.parameters.find(binding => binding.id === parameter.id)
  if (current !== undefined) current.address = osc.address
  else bindings.parameters.push({ id: parameter.id, address: osc.address })
  if (osc.list === null || !('optionsFrom' in parameter) || parameter.optionsFrom === undefined) return
  const listId = parameter.optionsFrom.list
  const entry: OscListBinding = { id: listId, address: osc.list.address, ...(osc.list.request === '' ? {} : { request: osc.list.request }) }
  bindings.lists ??= []
  const index = bindings.lists.findIndex(binding => binding.id === listId)
  if (index >= 0) bindings.lists[index] = entry
  else bindings.lists.push(entry)
}

/** 結び付けを本体に合わせる。消えたパラメータ・使われなくなった一覧の結び付けを外す(保存は余分な結び付けを断る) */
function syncBindings(result: SurfaceDefinition): void {
  const osc = result.bindings?.osc
  if (osc === undefined) return
  const paramIds = new Set(result.parameters.map(parameter => parameter.id))
  osc.parameters = osc.parameters.filter(binding => paramIds.has(binding.id))
  if (osc.lists !== undefined) {
    const used = referencedLists(result)
    osc.lists = osc.lists.filter(binding => used.has(binding.id))
    if (osc.lists.length === 0) delete osc.lists
  }
}

function addParameter(definition: SurfaceDefinition, parameter: SurfaceParameter, osc: ParameterOscInput | null): SurfaceDefinition {
  const result = structuredClone(definition)
  result.parameters.push(structuredClone(parameter))
  if (osc !== null) setParameterBinding(result, parameter, osc)
  syncBindings(result)
  return result
}

/** paramId のパラメータを丸ごと差し替える。id を変えたときは配置・アクション・結び付けの参照も追従させる */
function updateParameter(definition: SurfaceDefinition, paramId: string, parameter: SurfaceParameter, osc: ParameterOscInput | null): SurfaceDefinition {
  const result = structuredClone(definition)
  const index = result.parameters.findIndex(current => current.id === paramId)
  if (index < 0) throw new EditError(`パラメータ ${paramId} がありません`)
  result.parameters[index] = structuredClone(parameter)
  const newId = parameter.id
  if (newId !== paramId) {
    for (const screen of result.screens) visit(screen.children, node => { if (node.kind === 'control' && node.param === paramId) node.param = newId })
    for (const action of result.actions ?? []) for (const step of action.steps) if ('param' in step && step.param === paramId) step.param = newId
    for (const binding of result.bindings?.osc?.parameters ?? []) if (binding.id === paramId) binding.id = newId
  }
  if (osc !== null) setParameterBinding(result, parameter, osc)
  syncBindings(result)
  // アドレスの変更で selector(match)が何にも当たらなくなった場合に備える
  pruneActions(result)
  return result
}

/** パラメータを消す。それを参照する配置上の部品も一緒に消す(参照が宙に浮かないように) */
function removeParameter(definition: SurfaceDefinition, paramId: string): SurfaceDefinition {
  const result = structuredClone(definition)
  const before = result.parameters.length
  result.parameters = result.parameters.filter(parameter => parameter.id !== paramId)
  if (result.parameters.length === before) throw new EditError(`パラメータ ${paramId} がありません`)
  for (const screen of result.screens) screen.children = withoutLeaves(screen.children, node => node.kind === 'control' && node.param === paramId)
  syncBindings(result)
  pruneActions(result)
  return result
}

/**
 * パラメータの削除・アドレス変更で宙に浮いた step を外す(param の参照切れ、何にも当たらない selector)。
 * steps が空になったアクションは配置ごと消す(空の steps は定義として無効)。selector は OSC の結び付けの match で判定し、
 * 結び付けを持たない定義では残す(当たるかどうかが分からない)
 */
function pruneActions(result: SurfaceDefinition): void {
  if (result.actions === undefined) return
  const paramIds = new Set(result.parameters.map(parameter => parameter.id))
  const osc = result.bindings?.osc
  const addresses = (osc?.parameters ?? []).filter(binding => paramIds.has(binding.id)).map(binding => binding.address)
  const matches = new Map((osc?.selectors ?? []).map(binding => [binding.id, binding.match]))
  const alive = (step: SurfaceActionStep): boolean => {
    // レコード(D-061)はパラメータの編集では消えない。step を残さないと scope のアクションが空になる
    if ('record' in step) return true
    if ('param' in step) return paramIds.has(step.param)
    if (osc === undefined) return true
    const match = matches.get(step.selector)
    return match !== undefined && addresses.some(address => matchesPattern(match, address))
  }
  const emptied = new Set<string>()
  for (const action of result.actions) {
    action.steps = action.steps.filter(alive)
    if (action.steps.length === 0) emptied.add(action.id)
  }
  if (emptied.size > 0) {
    result.actions = result.actions.filter(action => !emptied.has(action.id))
    if (result.actions.length === 0) delete result.actions
    for (const screen of result.screens) screen.children = withoutLeaves(screen.children, node => node.kind === 'action' && emptied.has(node.action))
  }
  // 外した selector の結び付けも外す(使われない結び付けは保存が断る)。アクションが残る場合も行う(PR #111 の指摘)
  if (osc?.selectors !== undefined) {
    const used = new Set((result.actions ?? []).flatMap(action => action.steps.flatMap(step => 'selector' in step ? [step.selector] : [])))
    osc.selectors = osc.selectors.filter(binding => used.has(binding.id))
    if (osc.selectors.length === 0) delete osc.selectors
  }
}

// 10 進の数の書き方(UI から移す前の Python の float() と同じく、数字の間の _ を区切りとして受ける)。
// JS の Number() は 0x10・0b11 なども読むので、そのまま使うと 16・3 が黙って入る
const DECIMAL = /^[+-]?(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?$/

/** 空欄は null。有限の 10 進の数として読めなければ断る(整数かどうか・値域は定義の検証が見る) */
function numberOrNull(raw: string, label: string): number | null {
  const text = raw.trim()
  if (text === '') return null
  const number = DECIMAL.test(text) ? Number(text.replaceAll('_', '')) : Number.NaN
  if (!Number.isFinite(number)) throw new EditError(`${label} は数値で入力してください`)
  return number
}

/**
 * 編集フォームの入力から、パラメータ定義(本体)を組み立てる。空欄はキーごと省く。値域や相互関係の正否はここでは見ず、
 * 定義全体の検証に任せる。OSC のアドレスは本体に入れず、parameterOscBinding が結び付けへ渡す。
 * 実行時の一覧は、OSC の一覧のアドレス(form.osc.listAddress)か一覧の id(form.optionsFromList)で指定する
 */
function buildParameter(form: ParameterForm, definition: SurfaceDefinition): SurfaceParameter {
  const { kind, type } = form
  const parameter: Record<string, unknown> = { id: form.id.trim(), label: form.label.trim(), kind, type }
  if (!form.standalone) parameter.standalone = false
  // 表示ヒントは空欄なら省く。合うかどうかは定義全体の検証に任せる(D-103)
  const widget = form.widget.trim()
  if (widget !== '') parameter.widget = widget
  const numeric = type === 'i' || type === 'f'
  const low = numberOrNull(form.min, '最小')
  const high = numberOrNull(form.max, '最大')
  if (numeric && kind === 'state' && (low !== null || high !== null)) {
    if (low === null || high === null) throw new EditError('範囲は最小と最大を両方入力してください')
    parameter.range = [low, high]
  }
  const step = numberOrNull(form.step, '刻み')
  if (numeric && kind === 'state' && step !== null) parameter.step = step
  const options = form.options.split(',').map(item => item.trim()).filter(item => item !== '')
  if (type === 's' && kind === 'state' && options.length > 0) parameter.options = options
  // ターゲットから一覧を受ける(D-054)
  const listAddress = (form.osc?.listAddress ?? '').trim()
  const listRequest = (form.osc?.listRequest ?? '').trim()
  const listId = (form.optionsFromList ?? '').trim()
  if (listAddress !== '' || listRequest !== '' || listId !== '') {
    // 型や kind を変えたときに黙って捨てると、宣言が消えたことに気づけない
    if (type !== 's' || kind !== 'state') throw new EditError('Unity の一覧は s 型の state だけに設定できます。一覧のアドレスを空にしてください')
    if (listRequest !== '' && listAddress === '') throw new EditError('一覧の要求アドレスを書くときは一覧のアドレスも入力してください')
    parameter.optionsFrom = { list: listAddress !== '' ? listIdFor(definition, listAddress) : listId }
  }
  for (const key of ['default', 'value'] as const) {
    if (key === 'default' && kind !== 'state') continue
    if (key === 'value' && kind !== 'trigger') continue
    const raw = form[key]
    if (type === 'bool') {
      if (raw === 'true' || raw === 'false') parameter[key] = raw === 'true'
    } else if (numeric) {
      const number = numberOrNull(raw, key === 'default' ? '既定値' : '送信値')
      if (number !== null) parameter[key] = number
    } else if (raw !== '') {
      parameter[key] = raw
    }
  }
  // 形の正否は定義全体の検証で見る(ここで作った形をそのまま検証に渡す)
  return parameter as SurfaceParameter
}

// --- 画面層 -------------------------------------------------------------------

function addControl(definition: SurfaceDefinition, screen: number, paramId: string, steps: readonly EditStep[]): SurfaceDefinition {
  if (!definition.parameters.some(parameter => parameter.id === paramId)) throw new EditError(`パラメータ ${paramId} がありません`)
  const result = structuredClone(definition)
  childrenAt(result, screen, steps).push({ kind: 'control', param: paramId })
  return result
}

function removeNode(definition: SurfaceDefinition, ref: NodeRef): SurfaceDefinition {
  const result = structuredClone(definition)
  const { nodes, index } = locate(result, ref)
  nodes.splice(index, 1)
  return result
}

/** 同じ入れ子の中で 1 つ前/後ろへ動かす。端では動かさない(エラーにはしない) */
function moveNode(definition: SurfaceDefinition, ref: NodeRef, delta: -1 | 1): SurfaceDefinition {
  const result = structuredClone(definition)
  const { nodes, index, node } = locate(result, ref)
  const target = index + delta
  const other = nodes[target]
  if (other !== undefined) {
    nodes[index] = other
    nodes[target] = node
  }
  return result
}

/** 対象を行・列・グループで包む(横並び・グループ化の入口) */
function wrapNode(definition: SurfaceDefinition, ref: NodeRef, kind: string, label = 'グループ'): SurfaceDefinition {
  if (!WRAP_KINDS.has(kind)) throw new EditError(`包めない種類です: ${kind}`)
  const result = structuredClone(definition)
  const { nodes, index, node } = locate(result, ref)
  nodes[index] = kind === 'group' ? { kind: 'group', label, children: [node] } : { kind: kind as 'row' | 'column', children: [node] }
  return result
}

/** 対象とすぐ後ろの兄弟を 1 つの行にまとめる(横並びにする基本操作)。対象が行ならその末尾へ、そうでなければ行で包む */
function mergeWithNext(definition: SurfaceDefinition, ref: NodeRef): SurfaceDefinition {
  const result = structuredClone(definition)
  const { nodes, index, node } = locate(result, ref)
  const next = nodes[index + 1]
  if (next === undefined) throw new EditError('後ろに並べる部品がありません')
  nodes.splice(index + 1, 1)
  if (node.kind === 'row') node.children.push(next)
  else nodes[index] = { kind: 'row', children: [node, next] }
  return result
}

/** 行・列・グループを解いて、中身をその場に展開する */
function unwrapNode(definition: SurfaceDefinition, ref: NodeRef): SurfaceDefinition {
  const result = structuredClone(definition)
  const { nodes, index, node } = locate(result, ref)
  if (!WRAP_KINDS.has(node.kind)) throw new EditError('解けるのは行・列・グループだけです')
  replaceAt(nodes, index, (node as Container).children)
  return result
}

/**
 * nodes[index] を items に置き換える(その場で書き換える)。splice(index, 1, ...items) と同じだが、items を関数の引数に
 * 展開しない(子の多い正当な定義で引数の上限を超えてスタックが溢れ、ブリッジが落ちていた。Codex のセキュリティレビュー)
 */
export function replaceAt<T>(nodes: T[], index: number, items: readonly T[]): void {
  const tail = nodes.slice(index + 1)
  nodes.length = index
  for (const item of items) nodes.push(item)
  for (const item of tail) nodes.push(item)
}

/** 幅を変える。null は指定なし(キーを消す)。範囲の検証は定義の検証に任せる */
function setWidth(definition: SurfaceDefinition, ref: NodeRef, width: number | 'auto' | null): SurfaceDefinition {
  const result = structuredClone(definition)
  const { node } = locate(result, ref)
  if (width === null) delete node.width
  else node.width = width
  return result
}

function setCollapsed(definition: SurfaceDefinition, ref: NodeRef, collapsed: boolean): SurfaceDefinition {
  const result = structuredClone(definition)
  const { node } = locate(result, ref)
  if (node.kind !== 'group') throw new EditError('折りたたみの初期状態はグループだけが持ちます')
  node.collapsed = collapsed
  return result
}

function setLabel(definition: SurfaceDefinition, ref: NodeRef, label: string): SurfaceDefinition {
  const result = structuredClone(definition)
  const { node } = locate(result, ref)
  if (node.kind !== 'group' && node.kind !== 'control' && node.kind !== 'action' && node.kind !== 'record') {
    throw new EditError('表示名を持つのはグループ・部品・アクション・レコード表だけです')
  }
  node.label = label
  return result
}
