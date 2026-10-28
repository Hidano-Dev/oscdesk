import { randomUUID } from 'node:crypto'

import type { DownstreamFrame, OscArg, SurfaceDefinition } from '@oscdesk/shared'

// Unity が実行時に持つ文字列の一覧(D-053)。定義の optionsFrom / keysFrom が宣言したアドレスへ届く「値」で、
// 宛先ごとに保持して全台の和集合を選択肢とレコードのキー(D-062)にする。定義は書き換えず、保持値(desired-values)にも触れない。
// 純粋ロジックに留め、受信の振り分け・要求の送信・配信は呼び出し側(surface-core)が行う。
// 一覧は「届いた一覧」と「反映済みの一覧」に分けて出所(宛先、ブロードキャストの宛先では答えたホスト)ごとに持ち、
// 画面に使うのは反映済みだけ(D-088)。宛先の初報は自動で反映し、その後の変化と別のホストの一覧は apply を呼ぶまで反映しない。
// 収録に使っていない PC の Unity が誤って答えても、操作なしに画面の行と選択肢が書き換わらないようにするため

type RuntimeOptionsFrame = Extract<DownstreamFrame, { type: 'runtimeOptions' }>

/**
 * changed = 反映済みの一覧が変わった(出所の初報)。held = 届いた一覧だけが変わり、反映待ちの状態が変わった
 * (反映済みの一覧に戻って食い違いが消えた場合も含む)。どちらも配り直しが要るが、行を作るのは changed だけ
 */
export type ReceiveResult = 'changed' | 'held' | 'unchanged' | 'invalid'

export interface RecordKeys {
  record: string
  keys: string[]
  /** UI で管理する一覧(D-087)だけ。keys(行の ID)と同じ並びの Name */
  names?: string[]
}

export interface RuntimeOptions {
  /**
   * 定義の採用。参照が消えたアドレスの一覧は捨て、残ったアドレスの一覧は引き継ぐ。
   * 戻り値は、今回の定義で新たに必要になった要求アドレス(到達可能な宛先へ送る)。
   */
  setDefinition(definition: SurfaceDefinition | null): string[]
  /** 採用中の定義が一覧を受けるアドレスか(一覧は osc フレームとして UI へ流さない)。 */
  isListAddress(address: string): boolean
  /** 採用中の定義の要求アドレスか(要求のエコーは UI へ流さない)。 */
  isRequestAddress(address: string): boolean
  /**
   * その出所から届いた一覧で、届いた一覧を置き換える。s 以外の引数を含むものは捨てる。
   * host はブロードキャストの宛先(D-079)で答えたホスト。複数のホストが同じ宛先名で答えるので、ホストごとに分けて持つ
   */
  receive(target: string, address: string, args: readonly OscArg[], host?: string): ReceiveResult
  /**
   * 届いた一覧を反映済みの一覧に取り込む(D-088)。address を省くと全一覧。反映済みの一覧が変わったら 'applied'、
   * 食い違いが無ければ 'unchanged'、Unity から受ける一覧のアドレスでなければ 'unknown'
   */
  apply(address?: string): 'applied' | 'unchanged' | 'unknown'
  /** 採用中の定義の要求アドレス(重複なし・定義順)。 */
  requestAddresses(): string[]
  /** レコードごとのキーの和集合(定義順。空文字と重複を除く)。新しい行の生成にも使う(D-062)。 */
  recordKeys(): RecordKeys[]
  frame(): RuntimeOptionsFrame
  /**
   * UI で管理するキーの一覧(keysFrom.source 'ui'。D-075)。アドレスごとに追加した順で持ち、Unity からは受けない。
   * 定義の採用をまたいで、同じアドレスが 'ui' のまま残る間は引き継ぐ。行は変わらない ID と変えられる Name を持つ(D-087)
   */
  uiKeyLists(): UiKeyList[]
  /** Name の行を末尾に足す。ID はここで振る。既にある Name は 'exists'、上限は 'full'、'ui' のアドレスでなければ 'unknown'。 */
  addUiKey(address: string, name: string): { result: 'added'; id: string } | { result: 'exists' | 'full' | 'unknown' }
  /** ID の行を消したら true。 */
  removeUiKey(address: string, id: string): boolean
  /** ID の行の Name を変える。同じ Name なら 'unchanged'、他の行と重なれば 'exists'、無い行は 'not-found'。 */
  renameUiKey(address: string, id: string, name: string): 'renamed' | 'unchanged' | 'exists' | 'not-found' | 'unknown'
  /** UI で管理する一覧の、ID の行の Name(無ければ undefined)。 */
  uiRowName(address: string, id: string): string | undefined
  /** 保存から戻す。採用中の定義で 'ui' のアドレスだけを、空の ID・Name、重複、上限を超える分を除いて置き換える。 */
  restoreUiKeys(saved: readonly UiKeyList[]): void
  /**
   * その宛先名の一覧(届いた一覧と反映済みの一覧の両方)を全アドレスから捨てる(宛先タブで同じ名前の別の宛先に
   * 差し替えたとき。D-078)。捨てないと、新しい宛先が一覧を返すまで以前の宛先の一覧がその名前の一覧として残る。
   * 捨てた宛先の次の一覧は初報として自動で反映される(宛先の切り替えは人の明示的な操作のため。D-088)
   */
  forgetTarget(target: string): void
}

interface SourceList {
  target: string
  host: string | undefined
  names: readonly string[]
}

/** 出所のキー → 一覧。Map の挿入順(最初に届いた順)が、同じ宛先の中のホストの並びになる */
type ListsBySource = Map<string, SourceList>

interface ListState {
  received: ListsBySource
  applied: ListsBySource
}

const sourceKey = (target: string, host: string | undefined) => host === undefined ? target : `${target}\u0000${host}`

export interface UiKeyRow {
  id: string
  name: string
}

export interface UiKeyList {
  address: string
  rows: UiKeyRow[]
}

interface UiKeys {
  max: number | undefined
  rows: UiKeyRow[]
}

interface Choice {
  param: string
  address: string
  options: readonly string[]
}

interface FieldChoice {
  record: string
  field: string
  address: string
  options: readonly string[]
}

interface KeySource {
  record: string
  address: string
}

/**
 * @param targetNames 主系を先頭に config の順で並べた宛先名(和集合の順序に使う)。
 * @param newRowId UI で管理する行の ID を振る(D-087)。Name と無関係なランダムな値にする(Name から作ると改名で変わる)
 */
export function createRuntimeOptions(targetNames: readonly string[], newRowId: () => string = randomUUID): RuntimeOptions {
  // 一覧のアドレス → 届いた一覧と反映済みの一覧(出所ごと)。到達不能になった台の一覧も残す(D-053)
  let lists = new Map<string, ListState>()
  // 定義順を保つ配列と、受信のたびの判定用の Set(エコーの経路で毎回引くため)
  let requests: string[] = []
  let requestSet = new Set<string>()
  let choices: Choice[] = []
  let fieldChoices: FieldChoice[] = []
  let keySources: KeySource[] = []
  // UI で管理するキー(D-075)。アドレス → 上限と、追加順の行(ID と Name。D-087)
  let uiKeys = new Map<string, UiKeys>()

  const unionOf = (address: string, head: readonly string[]): string[] => {
    const seen = new Set<string>()
    const result: string[] = []
    const add = (names: readonly string[]) => {
      for (const name of names) {
        if (seen.has(name)) continue
        seen.add(name)
        result.push(name)
      }
    }
    add(head)
    const applied = lists.get(address)?.applied
    for (const name of targetNames) {
      for (const source of sourcesOf(applied, name)) add(source.names)
    }
    return result
  }

  // その宛先名の出所(ユニキャストなら 1 つ、ブロードキャストなら答えたホストの数)を最初に届いた順に
  const sourcesOf = (bySource: ListsBySource | undefined, target: string): SourceList[] =>
    [...bySource?.values() ?? []].filter(source => source.target === target)

  // 宛先ごとの一覧(frame の lists)。ホストが 1 つなら届いたまま(空文字・重複も)、複数なら和集合にする
  const targetOptions = (sources: readonly SourceList[]): string[] =>
    sources.length === 1 ? [...sources[0]!.names] : [...new Set(sources.flatMap(source => source.names))]

  const pending = (): NonNullable<RuntimeOptionsFrame['pending']> =>
    [...lists].flatMap(([address, state]) => targetNames.flatMap(name =>
      sourcesOf(state.received, name).flatMap(source => {
        const applied = state.applied.get(sourceKey(source.target, source.host))?.names ?? []
        if (sameNames(applied, source.names)) return []
        const before = new Set(applied)
        const after = new Set(source.names)
        return [{
          address,
          target: source.target,
          ...source.host === undefined ? {} : { host: source.host },
          added: [...after].filter(item => !before.has(item)),
          removed: [...before].filter(item => !after.has(item)),
        }]
      })))

  // 空のキーは行として扱わない(キーの列が空の行は UI でもブリッジでも他の行と区別できないため)
  const recordKeys = (): RecordKeys[] =>
    keySources.map(source => {
      const ui = uiKeys.get(source.address)
      if (ui !== undefined) {
        return { record: source.record, keys: ui.rows.map(row => row.id), names: ui.rows.map(row => row.name) }
      }
      return { record: source.record, keys: unionOf(source.address, []).filter(key => key !== '') }
    })

  return {
    setDefinition(definition) {
      const previousAddresses = new Set(lists.keys())
      const previousRequests = new Set(requests)
      // 参照が残るアドレスの一覧だけを、定義の順に並べ直して引き継ぐ
      const nextLists = new Map<string, ListState>()
      const nextChoices: Choice[] = []
      const nextFieldChoices: FieldChoice[] = []
      const nextKeySources: KeySource[] = []
      const nextUiKeys = new Map<string, UiKeys>()
      const nextRequests: string[] = []
      const added: string[] = []
      // optionsFrom と keysFrom は同じ一覧の仕組みに載せる(同じアドレスなら 1 つの一覧を共有する。D-061)
      const addSource = (source: { address: string; request?: string | undefined }) => {
        const { address, request } = source
        if (!nextLists.has(address)) nextLists.set(address, lists.get(address) ?? { received: new Map(), applied: new Map() })
        if (request === undefined) return
        if (!nextRequests.includes(request)) nextRequests.push(request)
        // 一覧のアドレスか要求のアドレスが新しいときだけ取りに行く
        // (レイアウトだけの保存のたびに全台へ要求を撒かないため)
        if ((!previousAddresses.has(address) || !previousRequests.has(request)) && !added.includes(request)) {
          added.push(request)
        }
      }
      for (const param of definition?.parameters ?? []) {
        if (param.type !== 's' || param.optionsFrom === undefined) continue
        nextChoices.push({ param: param.id, address: param.optionsFrom.address, options: param.options ?? [] })
        addSource(param.optionsFrom)
      }
      for (const record of definition?.records ?? []) {
        nextKeySources.push({ record: record.id, address: record.keysFrom.address })
        if (record.keysFrom.source === 'ui') {
          // Unity からは受けない(要求も送らない)。上限が下がったら、超えた分は後ろから落とす
          const { address, max } = record.keysFrom
          if (!nextUiKeys.has(address)) {
            const rows = [...(uiKeys.get(address)?.rows ?? [])]
            nextUiKeys.set(address, { max, rows: max === undefined ? rows : rows.slice(0, max) })
          }
        } else {
          addSource(record.keysFrom)
        }
        for (const field of record.fields) {
          if (field.type !== 's' || field.optionsFrom === undefined) continue
          nextFieldChoices.push({ record: record.id, field: field.id, address: field.optionsFrom.address, options: field.options ?? [] })
          addSource(field.optionsFrom)
        }
      }
      lists = nextLists
      choices = nextChoices
      fieldChoices = nextFieldChoices
      keySources = nextKeySources
      uiKeys = nextUiKeys
      requests = nextRequests
      requestSet = new Set(nextRequests)
      return added
    },
    // UI で管理するキーのアドレスも一覧扱いにする。ブリッジが Unity へ送った一覧のエコーを、値の osc として UI へ流さないため
    isListAddress: address => lists.has(address) || uiKeys.has(address),
    isRequestAddress: address => requestSet.has(address),
    receive(target, address, args, host) {
      // UI で管理する一覧は Unity から受けない(届くのはブリッジが送った一覧のエコー)
      if (uiKeys.has(address)) return 'unchanged'
      const state = lists.get(address)
      if (state === undefined) return 'unchanged'
      if (!args.every(arg => arg.type === 's')) return 'invalid'
      const names = args.map(arg => arg.value as string)
      const key = sourceKey(target, host)
      const before = state.received.get(key)
      if (before !== undefined && sameNames(before.names, names)) return 'unchanged'
      const entry: SourceList = { target, host, names }
      state.received.set(key, entry)
      // その宛先の初報(どのホストの反映済みの一覧もまだ無い)はボタンを待たずに反映する。ブリッジの起動直後・宛先の
      // 追加の直後に画面が空のまま操作者の反映を待たせないため(反映済みの一覧は保存せず、起動のたびに初報から始める)。
      // ホストごとに判定しないのは、「全てのデバイス」に後から誤って答えた PC の一覧まで初報として反映してしまうため
      if (sourcesOf(state.applied, target).length === 0) {
        state.applied.set(key, entry)
        return 'changed'
      }
      return 'held'
    },
    apply(address) {
      if (address !== undefined && !lists.has(address)) return 'unknown'
      let changed = false
      for (const [listAddress, state] of lists) {
        if (address !== undefined && listAddress !== address) continue
        for (const [key, entry] of state.received) {
          const applied = state.applied.get(key)
          if (applied !== undefined && sameNames(applied.names, entry.names)) continue
          state.applied.set(key, entry)
          changed = true
        }
      }
      return changed ? 'applied' : 'unchanged'
    },
    requestAddresses: () => [...requests],
    recordKeys,
    frame() {
      return {
        v: 1,
        type: 'runtimeOptions',
        lists: [...lists].map(([address, state]) => ({
          address,
          targets: targetNames.flatMap(name => {
            const sources = sourcesOf(state.applied, name)
            return sources.length === 0 ? [] : [{ name, options: targetOptions(sources) }]
          }),
        })),
        choices: choices.map(choice => ({ param: choice.param, options: unionOf(choice.address, choice.options) })),
        // レコードの欄は UI が無い場合に備えて省略可能だが、ブリッジは常に載せる(D-062)
        keys: recordKeys(),
        fieldChoices: fieldChoices.map(choice => ({
          record: choice.record, field: choice.field, options: unionOf(choice.address, choice.options),
        })),
        pending: pending(),
      }
    },
    uiKeyLists: () => [...uiKeys].map(([address, list]) => ({ address, rows: list.rows.map(row => ({ ...row })) })),
    addUiKey(address, name) {
      const list = uiKeys.get(address)
      if (list === undefined) return { result: 'unknown' }
      // Name の重複は認めない(Unity は行を Name でも扱うので、同じ Name の 2 行を区別させない)
      if (list.rows.some(row => row.name === name)) return { result: 'exists' }
      if (list.max !== undefined && list.rows.length >= list.max) return { result: 'full' }
      let id = newRowId()
      // 振った ID が既存の行と重なることは実質無いが、重なると 2 行が 1 行に潰れるので振り直す
      while (list.rows.some(row => row.id === id)) id = newRowId()
      list.rows.push({ id, name })
      return { result: 'added', id }
    },
    removeUiKey(address, id) {
      const list = uiKeys.get(address)
      const index = list?.rows.findIndex(row => row.id === id) ?? -1
      if (list === undefined || index < 0) return false
      list.rows.splice(index, 1)
      return true
    },
    renameUiKey(address, id, name) {
      const list = uiKeys.get(address)
      if (list === undefined) return 'unknown'
      const row = list.rows.find(candidate => candidate.id === id)
      if (row === undefined) return 'not-found'
      if (row.name === name) return 'unchanged'
      if (list.rows.some(candidate => candidate.name === name)) return 'exists'
      row.name = name
      return 'renamed'
    },
    uiRowName: (address, id) => uiKeys.get(address)?.rows.find(row => row.id === id)?.name,
    restoreUiKeys(saved) {
      for (const { address, rows } of saved) {
        const list = uiKeys.get(address)
        if (list === undefined) continue
        const ids = new Set<string>()
        const names = new Set<string>()
        const unique: UiKeyRow[] = []
        for (const row of rows) {
          if (row.id === '' || row.name === '' || ids.has(row.id) || names.has(row.name)) continue
          ids.add(row.id)
          names.add(row.name)
          unique.push({ id: row.id, name: row.name })
        }
        list.rows = list.max === undefined ? unique : unique.slice(0, list.max)
      }
    },
    forgetTarget(target) {
      for (const state of lists.values()) {
        for (const bySource of [state.received, state.applied]) {
          for (const [key, source] of bySource) if (source.target === target) bySource.delete(key)
        }
      }
    },
  }
}

function sameNames(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, index) => name === b[index])
}
