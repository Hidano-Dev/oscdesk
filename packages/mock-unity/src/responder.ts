import { SYS } from '@oscdesk/shared'
import type { OscMessagePacket, OscPacket } from '@oscdesk/shared'

export type FaultMode =
  | { kind: 'none' }
  | { kind: 'drop-pong' }
  | { kind: 'silent' }
  | { kind: 'random-loss'; rate: number }
  | { kind: 'delay'; ms: number }
  // pong 以外の返事(エコー・/sys/ignored・/sys/failed など)だけを遅らせる。生存確認は間に合ったまま、
  // 送ったものが遅れて届く PC を再現する(送り先ブロックの点灯の E2E。D-116)
  | { kind: 'delay-echo'; ms: number }
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

/**
 * 実機の受け口の /sys/ignored・/sys/failed(D-105)の E2E 用の再現。mock は対応表を持たないので、設定で与える。
 * `known` を与えると、そこに無いアドレスの受信を「行が無い」として /sys/ignored で報告する。
 * `failing` のアドレス(アドレス → 理由)の受信は /sys/failed で報告する。どちらもエコーの後に、bundle 1 個につき各 1 メッセージ。
 * 未指定なら報告しない(古い受け口と同じ)。
 */
export interface OutcomeConfig {
  known?: readonly string[]
  failing?: Readonly<Record<string, string>>
}

export const DEFAULT_FAULT_MODE: FaultMode = { kind: 'none' }
const CORRUPT_PAYLOAD = Uint8Array.from([0xde, 0xad, 0xbe, 0xef])

export class MockUnityResponder {
  private pongReplyCount = 0
  /**
   * 起動 ID(D-164)。null でなければ pong の第 2 引数に載せる(`/sys/pong` は int seq, string bootId)。
   * main は起動ごとの GUID を入れる。単体テストの既定は null(pong は seq だけ)
   */
  bootId: string | null = null

  constructor(
    private readonly faultMode: FaultMode = DEFAULT_FAULT_MODE,
    private readonly outcomes: OutcomeConfig = {},
    /** 同期の合図(/sys/sync/begin・/sys/sync/end。D-169)を受けるたびに 1 行を渡す(E2E が標準出力で確かめる) */
    private readonly log?: (line: string) => void,
  ) {}

  handlePacket(packet: OscPacket): MockUnityReply[] {
    const replies: MockUnityReply[] = []
    const report: OutcomeReport = { ignored: [], failed: [] }
    this.visitPacket(packet, replies, report)
    this.flushReport(replies, report)
    return replies
  }

  // 実機と同じく、エコーの後にデータグラムごとにまとめて各 1 メッセージ
  private flushReport(replies: MockUnityReply[], report: OutcomeReport): void {
    if (report.ignored.length > 0) {
      this.pushReply(replies, { address: SYS.IGNORED, args: report.ignored.map(value => ({ type: 's', value })) })
    }
    if (report.failed.length > 0) {
      this.pushReply(replies, { address: SYS.FAILED, args: report.failed.map(value => ({ type: 's', value })) })
    }
  }

  // 実機(OscDeliveryReport)と同じ上限。無いと大きな bundle から送れない大きさの報告ができ、mock が落ちる
  private observe(address: string, report: OutcomeReport): void {
    const reason = this.outcomes.failing?.[address]
    if (reason !== undefined) {
      if (report.failed.length < OUTCOME_MAX_FAILED * 2) report.failed.push(clipText(address), clipText(reason))
    } else if (this.outcomes.known !== undefined && !this.outcomes.known.includes(address)) {
      const text = clipText(address)
      if (report.ignored.length < OUTCOME_MAX_IGNORED && !report.ignored.includes(text)) report.ignored.push(text)
    }
  }

  private visitPacket(packet: OscPacket, replies: MockUnityReply[], report: OutcomeReport): void {
    if (isBundlePacket(packet)) {
      for (const nestedPacket of packet.packets) {
        this.visitPacket(nestedPacket, replies, report)
      }
      return
    }

    if (packet.address === SYS.PING) {
      const seq = packet.args.slice(0, 1)
      this.pushReply(replies, { address: SYS.PONG, args: this.bootId === null ? packet.args : [...seq, { type: 's', value: this.bootId }] })
      return
    }

    // 同期の合図(D-169)。受け口と同じく返事はしない。E2E が受けたことを確かめられるよう 1 行を出す
    if (packet.address === SYS.SYNC_BEGIN || packet.address === SYS.SYNC_END) {
      const head = packet.args[0]
      this.log?.(`MOCK_UNITY_SYNC ${packet.address === SYS.SYNC_BEGIN ? 'begin' : 'end'}${head?.type === 's' ? ` ${head.value}` : ''}`)
      return
    }

    // 未知の /sys/* には応えない(Unity 側の実装が増えても mock が勝手に応答しないため)
    if (packet.address.startsWith('/sys/')) {
      return
    }

    // 値の確定は Unity のエコーだけ(CLAUDE.md の原則)。mock は受けた値をそのまま返す
    this.pushReply(replies, { address: packet.address, args: packet.args })
    this.observe(packet.address, report)

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
      case 'delay-echo':
        return packet.address === SYS.PONG
          ? { kind: 'message', packet }
          : { kind: 'message', packet, delayMs: this.faultMode.ms }
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

const OUTCOME_MAX_IGNORED = 32
const OUTCOME_MAX_FAILED = 16
const OUTCOME_MAX_TEXT = 128

function clipText(text: string): string {
  if (text.length <= OUTCOME_MAX_TEXT) return text
  const code = text.charCodeAt(OUTCOME_MAX_TEXT - 1)
  // サロゲートペアを割らない
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? OUTCOME_MAX_TEXT - 1 : OUTCOME_MAX_TEXT)
}

interface OutcomeReport {
  ignored: string[]
  failed: string[]
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

  if (raw.startsWith('delay-echo:')) {
    const ms = Number(raw.slice('delay-echo:'.length))

    if (!Number.isInteger(ms) || ms < 0) {
      throw new Error(`Invalid fault mode for --fault: ${raw}`)
    }

    return { kind: 'delay-echo', ms }
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
