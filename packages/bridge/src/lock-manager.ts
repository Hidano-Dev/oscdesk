import { LOCK, type DownstreamFrame, type LockRef, type UpstreamFrame } from '@oscdesk/shared'

import type { ClientId } from './surface-core'

// 操作中のロック(HID-378・D-111)。部品(パラメータ)と Record の行を単位に、短い期限つきで持ち主に与える。
// 持ち主は「接続(clientId)+ ページ(holder)」。UI のプロセスは複数のブラウザのページを 1 本の接続にまとめるので、
// 接続だけでは「別のブラウザ」を区別できない。期限の無いロックは作らない(本番中に操作者の画面が止まると、
// 誰も介入できなくなるため)。期限切れ・解放・切断で外し、変わるたびに全 UI へ全量を配る。
// 時計とタイマーは引数で受け取る(単体テストでプロセスを起こさずに期限切れを確かめるため)

export interface LockOwner {
  readonly clientId: ClientId
  readonly holder: string
  readonly label: string
}

interface Lease extends LockOwner {
  readonly ref: LockRef
  expiresAt: number
}

type TimerHandle = ReturnType<typeof setInterval> | number

export interface LockManagerDeps {
  publish: (frame: DownstreamFrame, target?: ClientId) => void
  now?: () => number
  leaseMs?: number
  setIntervalFn?: (callback: () => void, ms: number) => TimerHandle
  clearIntervalFn?: (handle: TimerHandle) => void
}

export interface LockManager {
  /** lock / unlock のフレームなら処理して true。 */
  handleUiFrame(frame: UpstreamFrame, clientId: ClientId): boolean
  /** 接続直後の UI へ今のロックを送る。 */
  publish(clientId: ClientId): void
  /** 切断した接続のロックをすべて外す。 */
  releaseConnection(clientId: ClientId): void
  /**
   * 値の変更を通してよいか。refs のどれかをほかの持ち主が持っていれば、その持ち主を返す(通してよければ null)。
   * holder の無い変更(旧い UI・外部のクライアント)は、ロック中の部品には通さない
   */
  blockingOwner(refs: readonly LockRef[], clientId: ClientId, holder: string | undefined): LockOwner | null
  close(): void
}

export function lockKey(ref: LockRef): string {
  // 区切りに NUL を使う(ID・キーに出ない文字。':' などはキーに含まれ得る)
  return 'param' in ref ? `p\u0000${ref.param}` : `r\u0000${ref.record}\u0000${ref.key}`
}

// 1 つの接続と全体で持てるロックの上限。認証の無い LAN で、無いパラメータへの lock を際限なく送られて
// 全量の配信(locks)が膨らまないようにする。UI のプロセスは多くのページをまとめるので、接続あたりは余裕を持たせる
export const MAX_LOCKS_PER_CONNECTION = 256
export const MAX_LOCKS_TOTAL = 1024

// 期限切れの掃除と、間引いた配信の送り出しの間隔。期限(2 秒)より十分短くし、外れたことが遅れて見えないようにする
const SWEEP_INTERVAL_MS = 100
// 全量(locks)を全 UI へ配る最短の間隔。取得と解放を繰り返されても、配信が操作の数だけ増えないようにする
// (PR #102 の Codex 指摘)。間引いた変化は次の掃除で 1 回にまとめて配る
export const MIN_BROADCAST_INTERVAL_MS = 100

export function createLockManager(deps: LockManagerDeps): LockManager {
  const now = deps.now ?? Date.now
  const leaseMs = deps.leaseMs ?? LOCK.LEASE_MS
  const leases = new Map<string, Lease>()
  const setIntervalFn = deps.setIntervalFn ?? setInterval
  const clearIntervalFn = deps.clearIntervalFn ?? clearInterval
  const sameOwner = (lease: LockOwner, clientId: ClientId, holder: string | undefined) =>
    lease.clientId === clientId && holder !== undefined && lease.holder === holder

  const frame = (): DownstreamFrame => ({
    v: 1,
    type: 'locks',
    locks: [...leases.values()].map(lease => ({ ref: lease.ref, clientId: lease.clientId, holder: lease.holder, label: lease.label })),
  })
  let lastBroadcastAt = -Infinity
  let pending = false
  const flush = () => {
    pending = false
    lastBroadcastAt = now()
    deps.publish(frame())
  }
  const broadcast = () => {
    if (now() - lastBroadcastAt >= MIN_BROADCAST_INTERVAL_MS) flush()
    else pending = true
  }

  const sweep = () => {
    const at = now()
    let changed = false
    for (const [key, lease] of leases) {
      if (lease.expiresAt <= at) {
        leases.delete(key)
        changed = true
      }
    }
    if (changed) broadcast()
    if (pending && now() - lastBroadcastAt >= MIN_BROADCAST_INTERVAL_MS) flush()
  }
  const timer = setIntervalFn(sweep, SWEEP_INTERVAL_MS)

  return {
    handleUiFrame(uiFrame, clientId) {
      if (uiFrame.type === 'lock') {
        sweep()
        const key = lockKey(uiFrame.ref)
        const current = leases.get(key)
        if (current !== undefined && !sameOwner(current, clientId, uiFrame.holder)) {
          deps.publish({ v: 1, type: 'notice', level: 'warn', code: 'lock-rejected', detail: `held: ${current.label}` }, clientId)
          return true
        }
        if (current !== undefined) {
          // 延長は期限だけを延ばし、全量を配り直さない(操作中は 0.5 秒ごとに届く)。表示名は取得時のものを保つ
          // (延長のたびに名前を変えて全量を配らせ続けることができないように)
          current.expiresAt = now() + leaseMs
          return true
        }
        const owned = [...leases.values()].filter(lease => lease.clientId === clientId).length
        if (owned >= MAX_LOCKS_PER_CONNECTION || leases.size >= MAX_LOCKS_TOTAL) {
          deps.publish({ v: 1, type: 'notice', level: 'warn', code: 'lock-rejected', detail: 'too-many-locks' }, clientId)
          return true
        }
        leases.set(key, { ref: uiFrame.ref, clientId, holder: uiFrame.holder, label: uiFrame.label, expiresAt: now() + leaseMs })
        broadcast()
        return true
      }
      if (uiFrame.type === 'unlock') {
        const key = lockKey(uiFrame.ref)
        const current = leases.get(key)
        if (current !== undefined && sameOwner(current, clientId, uiFrame.holder)) {
          leases.delete(key)
          broadcast()
        }
        return true
      }
      return false
    },
    publish(clientId) {
      sweep()
      deps.publish(frame(), clientId)
    },
    releaseConnection(clientId) {
      let changed = false
      for (const [key, lease] of leases) {
        if (lease.clientId === clientId) {
          leases.delete(key)
          changed = true
        }
      }
      if (changed) broadcast()
    },
    blockingOwner(refs, clientId, holder) {
      const at = now()
      for (const ref of refs) {
        const lease = leases.get(lockKey(ref))
        if (lease !== undefined && lease.expiresAt > at && !sameOwner(lease, clientId, holder)) return lease
      }
      return null
    },
    close() {
      clearIntervalFn(timer)
    },
  }
}
