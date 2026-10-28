import { randomUUID } from 'node:crypto'

import type { DownstreamFrame, OscArg, SurfaceDefinition } from '@oscdesk/shared'

// Unity が実行時に持つ文字列の一覧(D-053)。定義の optionsFrom / keysFrom が宣言したアドレスへ届く「値」で、
// 宛先ごとに保持して全台の和集合を選択肢とレコードのキー(D-062)にする。定義は書き換えず、保持値(desired-values)にも触れない。
// 純粋ロジックに留め、受信の振り分け・要求の送信・配信は呼び出し側(surface-core)が行う。

type RuntimeOptionsFrame = Extract<DownstreamFrame, { type: 'runtimeOptions' }>

export type ReceiveResult = 'changed' | 'unchanged' | 'invalid'

export interface RecordKeys {
  record: string
  keys: string[]
  /** UI で管理する一覧(D-086)だけ。keys(行の ID)と同じ並びの Name */
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
  /** その宛先から届いた一覧で置き換える。s 以外の引数を含むものは捨てる。 */
  receive(target: string, address: string, args: readonly OscArg[]): ReceiveResult
  /** 採用中の定義の要求アドレス(重複なし・定義順)。 */
  requestAddresses(): string[]
  /** レコードごとのキーの和集合(定義順。空文字と重複を除く)。新しい行の生成にも使う(D-062)。 */
  recordKeys(): RecordKeys[]
  frame(): RuntimeOptionsFrame
  /**
   * UI で管理するキーの一覧(keysFrom.source 'ui'。D-075)。アドレスごとに追加した順で持ち、Unity からは受けない。
   * 定義の採用をまたいで、同じアドレスが 'ui' のまま残る間は引き継ぐ。行は変わらない ID と変えられる Name を持つ(D-086)
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
   * その宛先名の一覧を全アドレスから捨てる(宛先タブで同じ名前の別の宛先に差し替えたとき。D-078)。
   * 捨てないと、新しい宛先が一覧を返すまで以前の宛先の一覧がその名前の一覧として残る
   */
  forgetTarget(target: string): void
}

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
 * @param newRowId UI で管理する行の ID を振る(D-086)。Name と無関係なランダムな値にする(Name から作ると改名で変わる)
 */
export function createRuntimeOptions(targetNames: readonly string[], newRowId: () => string = randomUUID): RuntimeOptions {
  // 一覧のアドレス → 宛先名 → 最後に届いた一覧。到達不能になった台の一覧も残す(D-053)
  let lists = new Map<string, Map<string, readonly string[]>>()
  // 定義順を保つ配列と、受信のたびの判定用の Set(エコーの経路で毎回引くため)
  let requests: string[] = []
  let requestSet = new Set<string>()
  let choices: Choice[] = []
  let fieldChoices: FieldChoice[] = []
  let keySources: KeySource[] = []
  // UI で管理するキー(D-075)。アドレス → 上限と、追加順の行(ID と Name。D-086)
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
    const byTarget = lists.get(address)
    for (const name of targetNames) add(byTarget?.get(name) ?? [])
    return result
  }

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
      const nextLists = new Map<string, Map<string, readonly string[]>>()
      const nextChoices: Choice[] = []
      const nextFieldChoices: FieldChoice[] = []
      const nextKeySources: KeySource[] = []
      const nextUiKeys = new Map<string, UiKeys>()
      const nextRequests: string[] = []
      const added: string[] = []
      // optionsFrom と keysFrom は同じ一覧の仕組みに載せる(同じアドレスなら 1 つの一覧を共有する。D-061)
      const addSource = (source: { address: string; request?: string | undefined }) => {
        const { address, request } = source
        if (!nextLists.has(address)) nextLists.set(address, lists.get(address) ?? new Map())
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
    receive(target, address, args) {
      // UI で管理する一覧は Unity から受けない(届くのはブリッジが送った一覧のエコー)
      if (uiKeys.has(address)) return 'unchanged'
      const byTarget = lists.get(address)
      if (byTarget === undefined) return 'unchanged'
      if (!args.every(arg => arg.type === 's')) return 'invalid'
      const names = args.map(arg => arg.value as string)
      const before = byTarget.get(target)
      if (before !== undefined && sameNames(before, names)) return 'unchanged'
      byTarget.set(target, names)
      return 'changed'
    },
    requestAddresses: () => [...requests],
    recordKeys,
    frame() {
      return {
        v: 1,
        type: 'runtimeOptions',
        lists: [...lists].map(([address, byTarget]) => ({
          address,
          targets: targetNames.flatMap(name => {
            const options = byTarget.get(name)
            return options === undefined ? [] : [{ name, options: [...options] }]
          }),
        })),
        choices: choices.map(choice => ({ param: choice.param, options: unionOf(choice.address, choice.options) })),
        // レコードの欄は UI が無い場合に備えて省略可能だが、ブリッジは常に載せる(D-062)
        keys: recordKeys(),
        fieldChoices: fieldChoices.map(choice => ({
          record: choice.record, field: choice.field, options: unionOf(choice.address, choice.options),
        })),
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
      for (const byTarget of lists.values()) byTarget.delete(target)
    },
  }
}

function sameNames(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, index) => name === b[index])
}
