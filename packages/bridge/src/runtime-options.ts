import type { DownstreamFrame, OscArg, SurfaceDefinition } from '@oscdesk/shared'

// Unity が実行時に持つ文字列の一覧(D-053)。定義の optionsFrom / keysFrom が宣言したアドレスへ届く「値」で、
// 宛先ごとに保持して全台の和集合を選択肢とレコードのキー(D-062)にする。定義は書き換えず、保持値(desired-values)にも触れない。
// 純粋ロジックに留め、受信の振り分け・要求の送信・配信は呼び出し側(surface-core)が行う。

type RuntimeOptionsFrame = Extract<DownstreamFrame, { type: 'runtimeOptions' }>

export type ReceiveResult = 'changed' | 'unchanged' | 'invalid'

export interface RecordKeys {
  record: string
  keys: string[]
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

/** @param targetNames 主系を先頭に config の順で並べた宛先名(和集合の順序に使う)。 */
export function createRuntimeOptions(targetNames: readonly string[]): RuntimeOptions {
  // 一覧のアドレス → 宛先名 → 最後に届いた一覧。到達不能になった台の一覧も残す(D-053)
  let lists = new Map<string, Map<string, readonly string[]>>()
  // 定義順を保つ配列と、受信のたびの判定用の Set(エコーの経路で毎回引くため)
  let requests: string[] = []
  let requestSet = new Set<string>()
  let choices: Choice[] = []
  let fieldChoices: FieldChoice[] = []
  let keySources: KeySource[] = []

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
    keySources.map(source => ({ record: source.record, keys: unionOf(source.address, []).filter(key => key !== '') }))

  return {
    setDefinition(definition) {
      const previousAddresses = new Set(lists.keys())
      const previousRequests = new Set(requests)
      // 参照が残るアドレスの一覧だけを、定義の順に並べ直して引き継ぐ
      const nextLists = new Map<string, Map<string, readonly string[]>>()
      const nextChoices: Choice[] = []
      const nextFieldChoices: FieldChoice[] = []
      const nextKeySources: KeySource[] = []
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
        addSource(record.keysFrom)
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
      requests = nextRequests
      requestSet = new Set(nextRequests)
      return added
    },
    isListAddress: address => lists.has(address),
    isRequestAddress: address => requestSet.has(address),
    receive(target, address, args) {
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
  }
}

function sameNames(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, index) => name === b[index])
}
