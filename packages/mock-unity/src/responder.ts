import { SYS, StatsPayloadSchema } from '@oscdesk/shared'
import type { OscArg, OscMessagePacket, OscPacket, StatsPayload } from '@oscdesk/shared'

import type { AppliedRecord, ScenarioRuntime, StagingSnapshot } from './scenario'
import type { StagingReaction } from './staging'

export interface Clock {
  now(): Date
}

const DEFAULT_CLOCK: Clock = {
  now: () => new Date(),
}

export type FaultMode =
  | { kind: 'none' }
  | { kind: 'drop-pong' }
  | { kind: 'silent' }
  | { kind: 'random-loss'; rate: number }
  | { kind: 'delay'; ms: number }
  | { kind: 'corrupt' }
  | { kind: 'drop-reinject-manifest' }

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
  private received = 0
  private parseErrors = 0
  private lastReceivedAt = new Date(0).toISOString()
  private pongReplyCount = 0

  constructor(
    private readonly clock: Clock = DEFAULT_CLOCK,
    private readonly scenarioRuntime?: ScenarioRuntime,
    private readonly faultMode: FaultMode = DEFAULT_FAULT_MODE,
    private readonly logLine: (line: string) => void = writeStderrLine,
  ) {}

  handlePacket(packet: OscPacket): MockUnityReply[] {
    const replies: MockUnityReply[] = []
    this.visitPacket(packet, replies)
    return replies
  }

  recordParseError(): void {
    this.parseErrors += 1
  }

  statsSnapshot(): StatsPayload {
    return StatsPayloadSchema.parse({
      received: this.received,
      parseErrors: this.parseErrors,
      lastReceivedAt: this.lastReceivedAt,
      ...(this.scenarioRuntime?.originFields() ?? {}),
    })
  }

  stagingSnapshot(): StagingSnapshot | undefined {
    return this.scenarioRuntime?.stagingSnapshot()
  }

  private visitPacket(packet: OscPacket, replies: MockUnityReply[]): void {
    if (isBundlePacket(packet)) {
      for (const nestedPacket of packet.packets) {
        this.visitPacket(nestedPacket, replies)
      }
      return
    }

    this.recordReceipt()

    if (packet.address === SYS.PING) {
      this.pushReply(
        replies,
        {
          address: SYS.PONG,
          args: packet.args,
        },
      )
      return
    }

    if (packet.address === SYS.STATS_REQUEST) {
      this.pushReply(replies, {
        address: SYS.STATS,
        args: [
          {
            type: 's',
            value: JSON.stringify(this.statsSnapshot()),
          },
        ],
      })
      return
    }

    if (packet.address === SYS.MANIFEST_REQUEST) {
      if (this.scenarioRuntime !== undefined) {
        this.pushReply(replies, {
          address: SYS.MANIFEST,
          args: [
            {
              type: 's',
              value: this.scenarioRuntime.manifestJson(),
            },
          ],
        })
      }
      return
    }

    if (packet.address.startsWith('/sys/')) {
      return
    }

    let value: number | string | boolean | undefined
    for (const arg of packet.args) {
      value = toScenarioValue(arg.type, arg.value)
      if (value !== undefined) {
        break
      }
    }
    const reaction: StagingReaction | null | undefined =
      value === undefined ? undefined : this.scenarioRuntime?.recordValue(packet.address, value)

    this.pushReply(replies, {
      address: packet.address,
      args: packet.args,
    })

    for (const write of reaction?.expansionWrites ?? []) {
      this.pushReply(replies, {
        address: write.address,
        args: [toOscArg(write.value)],
      })
    }

    if (value !== undefined) {
      this.trySwitch(packet.address, value, replies)
    }
  }

  // 通常どおりエコーした後に、トリガなら切り替えを試みる。落ちたら何も送らず理由だけ stderr に出す。
  private trySwitch(address: string, value: number | string | boolean, replies: MockUnityReply[]): void {
    const result = this.scenarioRuntime?.trySwitch(address, value)
    if (result?.kind === 'switched') {
      this.pushReply(
        replies,
        { address: SYS.MANIFEST, args: [{ type: 's', value: result.manifestJson }] },
        true,
      )
    } else if (result?.kind === 'rejected') {
      this.logLine(
        `MOCK_UNITY_SWITCH_REJECTED ${address} ${result.variant} ${result.reason}: ${singleLine(result.detail)}`,
      )
    }
  }

  private recordReceipt(): void {
    this.received += 1
    this.lastReceivedAt = this.clock.now().toISOString()
  }

  private pushReply(replies: MockUnityReply[], packet: OscMessagePacket, isReinject = false): void {
    const filteredReply =
      isReinject && this.faultMode.kind === 'drop-reinject-manifest' ? null : this.applyFault(packet)

    if (filteredReply !== null) {
      replies.push(filteredReply)
    }
  }

  private applyFault(packet: OscMessagePacket): MockUnityReply | null {
    switch (this.faultMode.kind) {
      case 'none':
      case 'drop-reinject-manifest':
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

export type StagingApplyObserver = (record: AppliedRecord) => void

function toOscArg(value: { kind: 'i' | 'f' | 's'; value: number | string }): OscArg {
  switch (value.kind) {
    case 'i':
      return { type: 'i', value: value.value as number }
    case 'f':
      return { type: 'f', value: value.value as number }
    case 's':
      return { type: 's', value: value.value as string }
  }
}

function isBundlePacket(packet: OscPacket): packet is Extract<OscPacket, { packets: OscPacket[] }> {
  return 'timeTag' in packet && 'packets' in packet
}

function toScenarioValue(type: string, value: unknown): number | string | boolean | undefined {
  switch (type) {
    case 'i':
    case 'f':
      return typeof value === 'number' ? value : undefined
    case 's':
      return typeof value === 'string' ? value : undefined
    case 'T':
      return true
    case 'F':
      return false
    default:
      return undefined
  }
}

function writeStderrLine(line: string): void {
  process.stderr.write(`${line}\n`)
}

function singleLine(text: string): string {
  return text.replace(/\s+/g, ' ')
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
    case 'drop-reinject-manifest':
      return { kind: 'drop-reinject-manifest' }
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
