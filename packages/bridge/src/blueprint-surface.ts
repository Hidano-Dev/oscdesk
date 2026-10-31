import {
  isValidSurfaceName,
  SURFACE_DEFINITION_FORMAT,
  SURFACE_DEFINITION_VERSION,
  SURFACE_WIDGET_HINTS,
  SurfaceDefinitionSchema,
  SurfaceParameterSchema,
  type CatalogItem,
  type SurfaceDefinition,
  type SurfaceLayoutNode,
  type SurfaceParameter,
} from '@oscdesk/shared'

// 設計図(Catalog。D-104)から既定の画面を作る(HID-386・D-108)。設計図はパラメータ層(何があるか)、作った定義は
// 画面層の出発点で、保存すればそれが優先される。作るのはサーバー(判断をサーバーに置く。HID-373 の決定 3)。
// 知らない kind / type の項目や、定義の検証を通らない項目は画面に出さない(設計図の側は捨てずに持っている)

// 1 つの設計図から作る定義の名前。保存した画面を同じ名前で引き当てる(「保存した画面を優先」)
export function blueprintSurfaceName(pcName: string): string {
  const cleaned = pcName.normalize('NFKC').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^[-_]+/, '').slice(0, 54)
  const name = `blueprint-${cleaned === '' ? 'pc' : cleaned}`.replace(/-+$/, '')
  return isValidSurfaceName(name) ? name : 'blueprint-pc'
}

const KINDS = new Set(['state', 'trigger'])
const TYPES = new Set(['i', 'f', 's', 'bool'])

function props(item: CatalogItem, key: string): (number | string)[] {
  return item.props.filter(prop => prop.key === key).map(prop => prop.arg.value)
}
const firstNumber = (values: readonly (number | string)[]) => values.find((value): value is number => typeof value === 'number')
const firstString = (values: readonly (number | string)[]) => values.find((value): value is string => typeof value === 'string')

// アドレスから定義の id を作る(英字で始まる 64 文字まで。重なれば番号を付ける)
function parameterId(address: string, taken: Set<string>): string {
  const base = `p_${address.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`.slice(0, 56)
  let id = base
  for (let n = 2; taken.has(id); n += 1) id = `${base}_${String(n)}`
  taken.add(id)
  return id
}

function toParameter(item: CatalogItem, id: string): SurfaceParameter | null {
  if (!KINDS.has(item.kind) || !TYPES.has(item.type)) return null
  const label = firstString(props(item, 'label')) ?? item.address
  const widget = firstString(props(item, 'widget'))
  const base: Record<string, unknown> = {
    id,
    address: item.address,
    label,
    kind: item.kind,
    type: item.type,
    ...(widget !== undefined && (SURFACE_WIDGET_HINTS as readonly string[]).includes(widget) ? { widget } : {}),
  }
  if (item.type === 'i' || item.type === 'f') {
    const min = firstNumber(props(item, 'min'))
    const max = firstNumber(props(item, 'max'))
    const step = firstNumber(props(item, 'step'))
    const value = firstNumber(props(item, item.kind === 'trigger' ? 'value' : 'default'))
    if (min !== undefined && max !== undefined && min < max) base.range = [min, max]
    if (step !== undefined && step > 0) base.step = step
    if (item.kind === 'trigger') base.value = value ?? 1
    else if (value !== undefined) base.default = value
  } else if (item.type === 's') {
    const options = props(item, 'options').filter((option): option is string => typeof option === 'string')
    if (options.length > 0) base.options = options
    const value = firstString(props(item, item.kind === 'trigger' ? 'value' : 'default'))
    if (item.kind === 'trigger') base.value = value ?? ''
    else if (value !== undefined) base.default = value
  } else {
    // bool は OSC の i(0/1)で来る値を真偽にする
    const raw = props(item, item.kind === 'trigger' ? 'value' : 'default')[0]
    const value = raw === undefined ? undefined : raw === 1 || raw === 'true'
    if (item.kind === 'trigger') base.value = value ?? true
    else if (value !== undefined) base.default = value
  }
  const parsed = SurfaceParameterSchema.safeParse(base)
  return parsed.success ? parsed.data : null
}

// 「パッケージ・対象」でまとめる。アドレスの先頭 2 つの区切り(/pkg/target/…)を 1 つの組にする
function groupLabel(address: string): string {
  const parts = address.split('/').filter(part => part !== '')
  return parts.length >= 3 ? `${parts[0]!} / ${parts[1]!}` : parts[0] ?? address
}

export function buildBlueprintSurface(pcName: string, items: readonly CatalogItem[]): SurfaceDefinition {
  const taken = new Set<string>()
  const groups = new Map<string, SurfaceLayoutNode[]>()
  const parameters: SurfaceParameter[] = []
  const sorted = [...items].sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0))
  for (const item of sorted) {
    const parameter = toParameter(item, parameterId(item.address, taken))
    if (parameter === null) continue
    // 1 つずつ定義として通るか確かめる(アドレスが予約名前空間など、項目単位で弾けるものを画面全体の失敗にしない)
    const alone = SurfaceDefinitionSchema.safeParse({
      format: SURFACE_DEFINITION_FORMAT, version: SURFACE_DEFINITION_VERSION, name: 'check', parameters: [parameter], screens: [],
    })
    if (!alone.success) continue
    parameters.push(parameter)
    const label = groupLabel(item.address)
    groups.set(label, [...groups.get(label) ?? [], { kind: 'control', param: parameter.id }])
  }
  const definition = {
    format: SURFACE_DEFINITION_FORMAT,
    version: SURFACE_DEFINITION_VERSION,
    name: pcName,
    parameters,
    screens: [{
      id: 'blueprint',
      label: pcName,
      children: [...groups].map(([label, children]): SurfaceLayoutNode => ({ kind: 'group', label, children })),
    }],
  }
  const parsed = SurfaceDefinitionSchema.safeParse(definition)
  // 項目ごとに通しているので失敗しないはずだが、組み合わせ(重複アドレス等)で落ちたら空の画面にして理由を残さない
  return parsed.success ? parsed.data : { ...definition, parameters: [], screens: [{ id: 'blueprint', label: pcName, children: [] }] } as SurfaceDefinition
}

/** 採用中の定義のうち、その PC の設計図に無いパラメータの id(「この PC には無い」として薄く出す)。 */
export function absentParameters(definition: SurfaceDefinition, items: readonly CatalogItem[]): string[] {
  const present = new Set(items.map(item => item.address))
  return definition.parameters.filter(parameter => !present.has(parameter.address)).map(parameter => parameter.id)
}
