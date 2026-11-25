// delivery-tracker.ts — 送ったものが送り先の PC に届いたかの突き合わせ(DESIGN.md D-116)。純粋ロジックで、時計と配信は引数で受け取る。
// 受信の種類(届いた・対象なし・処理失敗)は通信アダプタ(target-adapter.ts。D-110)が振り分けたものを受け、OSC のアドレスは読まない
import type { DownstreamFrame } from '@oscdesk/shared'

export type DeliveryResult = 'ok' | 'ignored' | 'failed'

export interface DeliveryTrackerOptions {
  publish: (frame: DownstreamFrame) => void
  now: () => number
  /** 送った先の結び付け(OSC ではアドレス)をパラメータ id に引く。当たらなければ null。送った時点の定義で引く */
  paramOf?: (binding: string) => string | null
  /** 同じ (送り先, ホスト, 結果) のイベントを配る最小の間隔(ms)。スライダーの連続操作で大量に出るのを抑える */
  minIntervalMs?: number
  /** 送った記録を覚えておく上限。超えたら古いものから忘れる */
  capacity?: number
  /** 送った記録の寿命(ms)。これを過ぎた返事は、どの送信への返事か分からないので捨てる */
  ttlMs?: number
}

export interface DeliveryTracker {
  /** 送り先(宛先名)へ結び付けを送ったことを記録する。同じ (送り先, 結び付け) は新しい送信で置き換える */
  noteSent(target: string, binding: string): void
  /** 送り先のホストから「届いた」が来た(アダプタの delivered。OSC ではエコー) */
  onDelivered(target: string, host: string, binding: string): void
  /** アダプタの unbound(対象なし)・failed(処理失敗)。refs の結び付けごとに、直近の送信と突き合わせる */
  onReport(target: string, host: string, result: 'ignored' | 'failed', refs: readonly string[]): void
}

interface Pending {
  readonly target: string
  readonly binding: string
  readonly param: string | null
  readonly sentAt: number
  /** この送信に対して、結果ごとに報告済みのホスト */
  readonly reported: Set<string>
}

/**
 * 受け口(OscDeliveryReport)は報告のアドレスを 128 文字(UTF-16)で切り詰める。長いアドレスでも報告を取りこぼさないよう、
 * 記録の照合は同じ規則で切り詰めた結び付けで行う(切り詰めると別のアドレスが同じ記録に当たりうるが、
 * 128 文字を超える同じ先頭のアドレスを同じ宛先へ同時に送る場面は想定せず、当たっても緑・黄・赤の向きが誤る程度に収まる)
 */
export const DELIVERY_BINDING_MAX = 128
function clip(binding: string): string {
  if (binding.length <= DELIVERY_BINDING_MAX) return binding
  const code = binding.charCodeAt(DELIVERY_BINDING_MAX - 1)
  return binding.slice(0, code >= 0xd800 && code <= 0xdbff ? DELIVERY_BINDING_MAX - 1 : DELIVERY_BINDING_MAX)
}

export const DELIVERY_MIN_INTERVAL_MS = 100
export const DELIVERY_PENDING_CAPACITY = 1024
export const DELIVERY_PENDING_TTL_MS = 30_000

/**
 * 送信ごとに (送り先, 結び付け) を記録し、返事を突き合わせて到達のイベントにする。
 * - 送っていないもののエコーや、送り先でないホストの返事はイベントにしない(記録が無い)。
 * - 1 回の送信に対する同じ (ホスト, 結果) は 1 回だけ(ブロードキャストで複数台が答えても台ごとに 1 回)。
 * - 頻度の上限は (送り先, ホスト, 結果) ごと。結果ごとに分けるのは、連続する緑が 1 回の赤・黄を押し流さないため。
 *   間隔内のイベントは捨てる(先頭を残す)。赤・黄は ok の流量に巻き込まれず、それぞれの間隔で必ず通る。
 */
export function createDeliveryTracker(options: DeliveryTrackerOptions): DeliveryTracker {
  const minInterval = options.minIntervalMs ?? DELIVERY_MIN_INTERVAL_MS
  const capacity = options.capacity ?? DELIVERY_PENDING_CAPACITY
  const ttl = options.ttlMs ?? DELIVERY_PENDING_TTL_MS
  const paramOf = options.paramOf ?? (() => null)
  const pending = new Map<string, Pending>()
  const lastPublished = new Map<string, number>()

  const keyOf = (target: string, binding: string) => `${target}\u0000${binding}`

  const emit = (entry: Pending, host: string, result: DeliveryResult) => {
    const at = options.now()
    const reportedKey = `${host}\u0000${result}`
    if (entry.reported.has(reportedKey)) return
    entry.reported.add(reportedKey)
    const rateKey = `${entry.target}\u0000${host}\u0000${result}`
    const last = lastPublished.get(rateKey)
    if (last !== undefined && at - last < minInterval) return
    lastPublished.delete(rateKey)
    lastPublished.set(rateKey, at)
    // 間隔の記録も無制限に増やさない(ホストはブロードキャストの応答で増えうる)
    if (lastPublished.size > capacity) {
      const oldest = lastPublished.keys().next().value
      if (oldest !== undefined) lastPublished.delete(oldest)
    }
    options.publish({
      v: 1,
      type: 'delivery',
      events: [{ host, target: entry.target, result, param: entry.param, elapsedMs: Math.max(0, Math.round(at - entry.sentAt)) }],
    })
  }

  const find = (target: string, binding: string): Pending | undefined => {
    const key = keyOf(target, binding)
    const entry = pending.get(key)
    if (entry === undefined) return undefined
    if (options.now() - entry.sentAt > ttl) {
      pending.delete(key)
      return undefined
    }
    return entry
  }

  return {
    noteSent(target, rawBinding) {
      const binding = clip(rawBinding)
      const key = keyOf(target, binding)
      pending.delete(key) // 挿入順を新しく保つ(古い順に忘れるため)
      pending.set(key, { target, binding, param: paramOf(rawBinding), sentAt: options.now(), reported: new Set() })
      if (pending.size > capacity) {
        const oldest = pending.keys().next().value
        if (oldest !== undefined) pending.delete(oldest)
      }
    },
    onDelivered(target, host, binding) {
      const entry = find(target, clip(binding))
      if (entry !== undefined) emit(entry, host, 'ok')
    },
    onReport(target, host, result, refs) {
      for (const ref of refs) {
        const entry = find(target, clip(ref))
        if (entry !== undefined) emit(entry, host, result)
      }
    },
  }
}
