import { SURFACE_DEFINITION_VERSION } from './surface-definition'

// 版 1 のサーフェス定義(パラメータに address を直接書く形)を版 2(本体と bindings.osc。D-117)へ移す。
// 保存済みのファイル・HTTP のアップロード・上りの surfaceSave・プロジェクトファイルの取り込みで、検証の前に通す。
// 移すのは形だけで、検証は移した後の版 2 の定義で行う(版 1 で不正だった定義は版 2 でも不正のまま残す)。
// そのため不正な値もそのまま運び、知らないキーも捨てない(捨てると不正な定義が有効になりうる)。

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

/** 版 1 の定義か(format は見ない。format が違えば移した後の検証で落ちる)。 */
export function isLegacySurfaceDefinition(value: unknown): boolean {
  return isObject(value) && value.version === 1
}

// アドレスから結び付けの id を作る(英字で始まる 64 文字まで。別のアドレスが同じ形になれば番号を付ける)。
// 設計図から作る画面(D-112)のパラメータの id と同じ作り方
export function idFromAddress(prefix: string, address: string, taken: Set<string>): string {
  const base = `${prefix}${address.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`.slice(0, 56)
  let id = base === prefix ? `${prefix}x` : base
  for (let n = 2; taken.has(id); n += 1) id = `${base}_${String(n)}`
  taken.add(id)
  return id
}

/**
 * 版 1 の定義を版 2 へ移す。版 1 でなければそのまま返す。
 * - パラメータ・レコードの address → bindings.osc.parameters / records
 * - optionsFrom・keysFrom の address / request → 一覧の id(同じアドレスは同じ一覧)と bindings.osc.lists。
 *   同じ一覧のアドレスに別々の要求が書かれていたら、最初に書かれた要求を使う(版 1 では箇所ごとに要求を持てた)
 * - アクションの match → selector の id(同じパターンは同じ id)と bindings.osc.selectors
 */
export function migrateSurfaceDefinition(input: unknown): unknown {
  if (!isLegacySurfaceDefinition(input)) return input
  const source = input as Json
  const listTaken = new Set<string>()
  const lists = new Map<string, { id: string; address: unknown; request?: unknown }>()
  const listKey = (address: unknown) => typeof address === 'string' ? address : JSON.stringify(address)
  const listRef = (from: unknown): unknown => {
    if (!isObject(from) || !('address' in from)) return from
    const { address, request, ...rest } = from
    const key = listKey(address)
    let list = lists.get(key)
    if (list === undefined) {
      list = { id: idFromAddress('l_', typeof address === 'string' ? address : 'list', listTaken), address }
      lists.set(key, list)
    }
    if (request !== undefined && list.request === undefined) list.request = request
    return { list: list.id, ...rest }
  }
  const parameterBindings: Json[] = []
  const recordBindings: Json[] = []
  const selectorTaken = new Set<string>()
  const selectors = new Map<string, { id: string; match: unknown }>()

  const parameters = Array.isArray(source.parameters)
    ? source.parameters.map((parameter: unknown) => {
        if (!isObject(parameter)) return parameter
        const { address, ...rest } = parameter
        if (address !== undefined) parameterBindings.push({ id: parameter.id, address })
        return 'optionsFrom' in rest ? { ...rest, optionsFrom: listRef(rest.optionsFrom) } : rest
      })
    : source.parameters
  const records = Array.isArray(source.records)
    ? source.records.map((record: unknown) => {
        if (!isObject(record)) return record
        const { address, ...rest } = record
        if (address !== undefined) recordBindings.push({ id: record.id, address })
        return {
          ...rest,
          ...('keysFrom' in rest ? { keysFrom: listRef(rest.keysFrom) } : {}),
          ...(Array.isArray(rest.fields)
            ? { fields: rest.fields.map((field: unknown) => isObject(field) && 'optionsFrom' in field ? { ...field, optionsFrom: listRef(field.optionsFrom) } : field) }
            : {}),
        }
      })
    : source.records
  const actions = Array.isArray(source.actions)
    ? source.actions.map((action: unknown) => {
        if (!isObject(action) || !Array.isArray(action.steps)) return action
        return {
          ...action,
          steps: action.steps.map((step: unknown) => {
            if (!isObject(step) || !('match' in step)) return step
            const { match, ...rest } = step
            const key = listKey(match)
            let selector = selectors.get(key)
            if (selector === undefined) {
              selector = { id: idFromAddress('m_', typeof match === 'string' ? match : 'match', selectorTaken), match }
              selectors.set(key, selector)
            }
            return { selector: selector.id, ...rest }
          }),
        }
      })
    : source.actions

  const osc: Json = { parameters: parameterBindings }
  if (recordBindings.length > 0) osc.records = recordBindings
  if (lists.size > 0) {
    osc.lists = [...lists.values()].map(list => ({ id: list.id, address: list.address, ...(list.request === undefined ? {} : { request: list.request }) }))
  }
  if (selectors.size > 0) osc.selectors = [...selectors.values()].map(selector => ({ id: selector.id, match: selector.match }))

  const migrated: Json = { ...source, version: SURFACE_DEFINITION_VERSION }
  if ('parameters' in source) migrated.parameters = parameters
  if ('records' in source) migrated.records = records
  if ('actions' in source) migrated.actions = actions
  // 版 1 には bindings が無い。あれば版 1 として不正なので、移した結び付けで上書きせずに残して検証で落とす
  if (!('bindings' in source)) migrated.bindings = { osc }
  return migrated
}
