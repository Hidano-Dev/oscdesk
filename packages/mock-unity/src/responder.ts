import { SYS } from '@oscdesk/shared'
import type { OscMessagePacket, OscPacket } from '@oscdesk/shared'

export type FaultMode =
  | { kind: 'none' }
  | { kind: 'drop-pong' }
  | { kind: 'silent' }
  | { kind: 'random-loss'; rate: number }
  | { kind: 'delay'; ms: number }
  | { kind: 'corrupt' }

export type MockUnityReply =
  | {
      kind: 'message'
      packet: OscMessagePacket
      delayMs?: number
    }
  | {
      kind: 'raw'
      payload: Uint8Array
      delayMs?: number
    }

export const DEFAULT_FAULT_MODE: FaultMode = { kind: 'none' }
const CORRUPT_PAYLOAD = Uint8Array.from([0xde, 0xad, 0xbe, 0xef])

export class MockUnityResponder {
  private pongReplyCount = 0

  constructor(private readonly faultMode: FaultMode = DEFAULT_FAULT_MODE) {}

  handlePacket(packet: OscPacket): MockUnityReply[] {
    const replies: MockUnityReply[] = []
    this.visitPacket(packet, replies)
    return replies
  }

  private visitPacket(packet: OscPacket, replies: MockUnityReply[]): void {
    if (isBundlePacket(packet)) {
      for (const nestedPacket of packet.packets) {
        this.visitPacket(nestedPacket, replies)
      }
      return
    }

    if (packet.address === SYS.PING) {
      this.pushReply(replies, { address: SYS.PONG, args: packet.args })
      return
    }

    // 未知の /sys/* には応えない(Unity 側の実装が増えても mock が勝手に応答しないため)
    if (packet.address.startsWith('/sys/')) {
      return
    }

    // 値の確定は Unity のエコーだけ(CLAUDE.md の原則)。mock は受けた値をそのまま返す
    this.pushReply(replies, { address: packet.address, args: packet.args })
  }

  private pushReply(replies: MockUnityReply[], packet: OscMessagePacket): void {
    const filteredReply = this.applyFault(packet)

    if (filteredReply !== null) {
      replies.push(filteredReply)
    }
  }

  private applyFault(packet: OscMessagePacket): MockUnityReply | null {
    switch (this.faultMode.kind) {
      case 'none':
        return {
          kind: 'message',
          packet,
        }
      case 'silent':
        return null
      case 'drop-pong':
        return packet.address === SYS.PONG ? null : { kind: 'message', packet }
      case 'random-loss':
        if (packet.address !== SYS.PONG) {
          return {
            kind: 'message',
            packet,
          }
        }

        this.pongReplyCount += 1

        return shouldDropPong(this.pongReplyCount, this.faultMode.rate)
          ? null
          : {
              kind: 'message',
              packet,
            }
      case 'delay':
        return packet.address === SYS.PONG
          ? {
              kind: 'message',
              packet,
              delayMs: this.faultMode.ms,
            }
          : {
              kind: 'message',
              packet,
            }
      case 'corrupt':
        return {
          kind: 'raw',
          payload: CORRUPT_PAYLOAD.slice(),
        }
      default:
        return assertNever(this.faultMode)
    }
  }
}

function isBundlePacket(packet: OscPacket): packet is Extract<OscPacket, { packets: OscPacket[] }> {
  return 'timeTag' in packet && 'packets' in packet
}

function shouldDropPong(sequence: number, rate: number): boolean {
  return Math.floor(sequence * rate) > Math.floor((sequence - 1) * rate)
}

export function parseFaultMode(raw: string): FaultMode {
  switch (raw) {
    case 'drop-pong':
      return { kind: 'drop-pong' }
    case 'silent':
      return { kind: 'silent' }
    case 'corrupt':
      return { kind: 'corrupt' }
  }

  if (raw.startsWith('random-loss:')) {
    const rate = Number(raw.slice('random-loss:'.length))

    if (!Number.isFinite(rate) || rate <= 0 || rate >= 1) {
      throw new Error(`Invalid fault mode for --fault: ${raw}`)
    }

    return { kind: 'random-loss', rate }
  }

  if (raw.startsWith('delay:')) {
    const ms = Number(raw.slice('delay:'.length))

    if (!Number.isInteger(ms) || ms < 0) {
      throw new Error(`Invalid fault mode for --fault: ${raw}`)
    }

    return { kind: 'delay', ms }
  }

  throw new Error(`Invalid fault mode for --fault: ${raw}`)
}

function assertNever(value: never): never {
  throw new Error(`Unsupported fault mode: ${JSON.stringify(value)}`)
}
