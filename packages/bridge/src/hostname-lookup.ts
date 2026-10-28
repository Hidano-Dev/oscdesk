import dns from 'node:dns'
import net from 'node:net'

// 宛先タブの端末のホスト名(D-085)。IP と MAC だけでは端末を見分けられないので、走査で見つかった端末の名前を引く。
// 実ネットワークに触る部分はこのファイルに閉じ、destinations には HostnameResolver として渡す(単体テストで差し替える)。

/**
 * 引いた結果。名前が引けたホストは名前、問い合わせが終わって名前が無かったホストは null。
 * 時間切れ・中断で問い合わせが終わらなかったホストは含めない(呼び出し側は前回の名前を保つ)
 */
export type HostnameResults = ReadonlyMap<string, string | null>

export interface HostnameResolver {
  resolve(hosts: readonly string[], signal: AbortSignal): Promise<HostnameResults>
}

/** 名前を引かない(走査結果を差し替えるテスト用。実ネットワークの DNS へ問い合わせない)。 */
export const NO_HOSTNAMES: HostnameResolver = { resolve: () => Promise.resolve(new Map()) }

const DEFAULT_REVERSE_TIMEOUT_MS = 1_000
const DEFAULT_BUDGET_MS = 3_000

/**
 * 逆引き(DNS の PTR)と OS の名前解決(getnameinfo)で名前を引く。
 *
 * - まず全ホストを c-ares の逆引きで並列に引く。ルーターの DHCP や社内 DNS が名前を返す。libuv のスレッドプールを使わず、
 *   中断で取り消せる
 * - 引けなかったホストだけ、OS の名前解決(Windows では NetBIOS・LLMNR・mDNS も引く)で 1 台ずつ引く。getnameinfo は
 *   スレッドプール(既定 4 本)を塞ぎ、取り消せない。並列に投げると、診断ログや保持値のファイル書き込みが待たされるので、
 *   同時に 1 本だけにし、前回の問い合わせが終わっていなければ今回は使わない
 * - 全体の時間は budgetMs で打ち切る(終わらなかったホストは結果に含めない)
 */
export function createSystemHostnameResolver(options: {
  reverseTimeoutMs?: number
  budgetMs?: number
  reverse?: (host: string, signal: AbortSignal) => Promise<readonly string[]>
  lookupService?: (host: string) => Promise<string>
  now?: () => number
} = {}): HostnameResolver {
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS
  const reverse = options.reverse ?? createReverse(options.reverseTimeoutMs ?? DEFAULT_REVERSE_TIMEOUT_MS)
  const lookupService = options.lookupService ?? (async (host: string) => (await dns.promises.lookupService(host, 0)).hostname)
  const now = options.now ?? Date.now
  // 終わっていない OS の名前解決(取り消せないので、終わるまで次を投げない)
  let systemLookup: Promise<unknown> | null = null

  return {
    async resolve(hosts, outerSignal) {
      const results = new Map<string, string | null>()
      const unique = [...new Set(hosts)].filter(host => net.isIPv4(host))
      if (unique.length === 0) return results
      const deadline = now() + budgetMs
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(new Error('hostname lookup budget exceeded')), budgetMs)
      const onOuterAbort = () => controller.abort(outerSignal.reason)
      outerSignal.addEventListener('abort', onOuterAbort, { once: true })
      const signal = controller.signal
      try {
        await Promise.all(unique.map(async host => {
          try {
            const name = (await reverse(host, signal)).map(cleanHostname).find((value): value is string => value !== null)
            if (name !== undefined) results.set(host, name)
          } catch {
            // 名前が無い・DNS が答えない。OS の名前解決に回す
          }
        }))
        for (const host of unique) {
          if (results.has(host)) continue
          if (signal.aborted || systemLookup !== null) break
          const remaining = deadline - now()
          if (remaining <= 0) break
          const pending = lookupService(host)
          systemLookup = pending
          void pending.catch(() => undefined).finally(() => {
            if (systemLookup === pending) systemLookup = null
          })
          const outcome = await raceAbort(pending, signal)
          if (outcome.kind === 'aborted') break
          results.set(host, outcome.kind === 'value' ? cleanHostname(outcome.value) : null)
        }
      } finally {
        clearTimeout(timer)
        outerSignal.removeEventListener('abort', onOuterAbort)
      }
      return results
    },
  }
}

function createReverse(timeoutMs: number): (host: string, signal: AbortSignal) => Promise<readonly string[]> {
  return async (host, signal) => {
    // Resolver ごとに取り消せるので、1 回の問い合わせに 1 つ作る(中断で他の問い合わせを巻き込まない)
    const resolver = new dns.promises.Resolver({ timeout: timeoutMs, tries: 1 })
    const cancel = () => resolver.cancel()
    signal.addEventListener('abort', cancel, { once: true })
    try {
      return await resolver.reverse(host)
    } finally {
      signal.removeEventListener('abort', cancel)
    }
  }
}

type RaceOutcome = { kind: 'value'; value: string } | { kind: 'failed' } | { kind: 'aborted' }

function raceAbort(promise: Promise<string>, signal: AbortSignal): Promise<RaceOutcome> {
  if (signal.aborted) return Promise.resolve({ kind: 'aborted' })
  return new Promise(resolve => {
    const onAbort = () => resolve({ kind: 'aborted' })
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      value => resolve({ kind: 'value', value }),
      () => resolve({ kind: 'failed' }),
    ).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

/**
 * 表示に使える名前だけを残す。末尾のドットを外し、IP のままの答え(getnameinfo は名前が無いと数値を返す実装がある)・
 * localhost(この PC のループバックの名前で、端末を見分ける役に立たない)・長すぎる名前・制御文字を含む名前は捨てる
 */
export function cleanHostname(value: string): string | null {
  const name = value.trim().replace(/\.$/, '')
  if (name === '' || name.length > 253 || net.isIP(name) !== 0) return null
  if (/[\u0000-\u001f\u007f\s]/.test(name)) return null
  if (/^localhost(?:\.localdomain)?$/i.test(name)) return null
  return name
}
