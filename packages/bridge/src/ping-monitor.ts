import type { SurfaceStatus } from '@oscdesk/shared'

type PendingPing = {
  seq: number
  sentAtMs: number
}

export type PongResult = {
  accepted: boolean
  recoveredFromLoss: boolean
}

export class PingMonitor {
  private nextSeq = 1
  private pending: PendingPing | null = null
  private lastRttMs: number | null = null
  private consecutiveLosses = 0
  private lastPongSeq: number | null = null

  /** 返事待ちの ping の seq。複数宛先で seq を共有空間にし、pong の出所を特定するのに使う。 */
  pendingSeq(): number | null {
    return this.pending?.seq ?? null
  }

  /** seq を渡すと採番を外部に委ねる(複数宛先で一意な seq を振るため。省略時は内部採番)。 */
  nextPing(nowMs: number, assignedSeq?: number): number {
    if (this.pending !== null) {
      this.consecutiveLosses += 1
    }

    const seq = assignedSeq ?? this.nextSeq
    this.nextSeq = Math.max(this.nextSeq, seq + 1)
    this.pending = {
      seq,
      sentAtMs: nowMs,
    }

    return seq
  }

  onPong(seq: number, nowMs: number): PongResult {
    if (this.pending === null || this.pending.seq !== seq) {
      return {
        accepted: false,
        recoveredFromLoss: false,
      }
    }

    const recoveredFromLoss = this.consecutiveLosses >= 1
    this.lastRttMs = Math.max(0, nowMs - this.pending.sentAtMs)
    this.consecutiveLosses = 0
    this.lastPongSeq = seq
    this.pending = null

    return {
      accepted: true,
      recoveredFromLoss,
    }
  }

  snapshot(): SurfaceStatus {
    return {
      lastRttMs: this.lastRttMs,
      consecutiveLosses: this.consecutiveLosses,
      lastPongSeq: this.lastPongSeq,
    }
  }
}
