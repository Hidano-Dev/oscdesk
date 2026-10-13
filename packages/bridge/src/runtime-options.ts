import type { DownstreamFrame, OscArg, SurfaceDefinition } from '@oscdesk/shared'

// Unity が実行時に持つ文字列の一覧(D-053)。定義の optionsFrom が宣言したアドレスへ届く「値」で、
// 宛先ごとに保持して全台の和集合を選択肢にする。定義は書き換えず、保持値(desired-values)にも触れない。
// 純粋ロジックに留め、受信の振り分け・要求の送信・配信は呼び出し側(surface-core)が行う。

type RuntimeOptionsFrame = Extract<DownstreamFrame, { type: 'runtimeOptions' }>

export type ReceiveResult = 'changed' | 'unchanged' | 'invalid'

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
  frame(): RuntimeOptionsFrame
}

interface Choice {
  param: string
  address: string
  options: readonly string[]
}

/** @param targetNames 主系を先頭に config の順で並べた宛先名(和集合の順序に使う)。 */
export function createRuntimeOptions(targetNames: readonly string[]): RuntimeOptions {
  // 一覧のアドレス → 宛先名 → 最後に届いた一覧。到達不能になった台の一覧も残す(D-053)
  let lists = new Map<string, Map<string, readonly string[]>>()
  let requests: string[] = []
  let choices: Choice[] = []

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

  return {
    setDefinition(definition) {
      const previousAddresses = new Set(lists.keys())
      const previousRequests = new Set(requests)
      // 参照が残るアドレスの一覧だけを、定義の順に並べ直して引き継ぐ
      const nextLists = new Map<string, Map<string, readonly string[]>>()
      const nextChoices: Choice[] = []
      const nextRequests: string[] = []
      const added: string[] = []
      for (const param of definition?.parameters ?? []) {
        if (param.type !== 's' || param.optionsFrom === undefined) continue
        const { address, request } = param.optionsFrom
        nextChoices.push({ param: param.id, address, options: param.options ?? [] })
        if (!nextLists.has(address)) nextLists.set(address, lists.get(address) ?? new Map())
        if (request === undefined) continue
        if (!nextRequests.includes(request)) nextRequests.push(request)
        // 一覧のアドレスか要求のアドレスが新しいときだけ取りに行く
        // (レイアウトだけの保存のたびに全台へ要求を撒かないため)
        if ((!previousAddresses.has(address) || !previousRequests.has(request)) && !added.includes(request)) {
          added.push(request)
        }
      }
      lists = nextLists
      choices = nextChoices
      requests = nextRequests
      return added
    },
    isListAddress: address => lists.has(address),
    isRequestAddress: address => requests.includes(address),
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
      }
    },
  }
}

function sameNames(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, index) => name === b[index])
}
