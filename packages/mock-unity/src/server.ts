import dgram from 'node:dgram'

import type { RemoteInfo, Socket } from 'node:dgram'

import { MANIFEST_SIZE, SYS, type OscMessagePacket, type OscPacket } from '@oscdesk/shared'
import { OscDecodeError, decodeOscPacket, encodeOscPacket } from '@oscdesk/osc-codec'

import { type MockUnityReply, MockUnityResponder, type StagingApplyObserver } from './responder'

export interface ReplyTarget {
  host: string
  port: number
}

export interface MockUnityServerOptions {
  listenPort: number
  replyTarget?: ReplyTarget
  host?: string
  responder?: MockUnityResponder
  startupReplies?: MockUnityReply[]
  onStagingApply?: StagingApplyObserver
  log?: MockUnityLog
}

export type MockUnityLog = Pick<Console, 'error'> & Partial<Pick<Console, 'warn'>>

export interface MockUnityServer {
  readonly listenPort: number
  close(): Promise<void>
}

export async function startMockUnityServer(options: MockUnityServerOptions): Promise<MockUnityServer> {
  const socket = dgram.createSocket('udp4')
  const responder = options.responder ?? new MockUnityResponder()
  const host = options.host ?? '0.0.0.0'
  const log = options.log ?? console

  await bindSocket(socket, options.listenPort, host)

  // 適用ログの読み出し位置はデータグラムを跨いで保持する(毎回 0 に戻すと全件が再送出される)
  const applyCursor = { count: 0 }
  const manifestSizeMonitor = new ManifestSizeMonitor(log)

  socket.on('message', (data, remote) => {
    void handleIncomingPacket({
      data,
      remote,
      socket,
      responder,
      replyTarget: options.replyTarget,
      log,
      onStagingApply: options.onStagingApply,
      applyCursor,
      manifestSizeMonitor,
    })
  })

  socket.on('error', (error) => {
    log.error(`[mock-unity] UDP socket error: ${formatError(error)}`)
  })

  const address = socket.address()
  const listenPort = typeof address === 'string' ? options.listenPort : address.port

  if (options.replyTarget !== undefined && options.startupReplies !== undefined) {
    for (const reply of options.startupReplies) {
      manifestSizeMonitor.inspect(reply)
      await sendReply(socket, reply, options.replyTarget.port, options.replyTarget.host)
    }
  }

  return {
    listenPort,
    async close() {
      await closeSocket(socket)
    },
  }
}

interface IncomingPacketContext {
  data: Uint8Array
  remote: RemoteInfo
  socket: Socket
  responder: MockUnityResponder
  replyTarget?: ReplyTarget
  log: MockUnityLog
  onStagingApply?: StagingApplyObserver
  applyCursor: { count: number }
  manifestSizeMonitor: ManifestSizeMonitor
}

/**
 * 送信直前の /sys/manifest が警告閾値を超えたら知らせる。単一 UDP データグラムの
 * 実用上限(~60KB)に運用中どれだけ近づいているかを、手動計測なしで気づけるようにする。
 * 同じサイズを毎回の再送で繰り返し警告しないよう、サイズが変わったときだけ出す。
 */
export class ManifestSizeMonitor {
  private lastWarnedBytes: number | null = null

  constructor(private readonly log: MockUnityLog) {}

  inspect(reply: MockUnityReply): void {
    if (reply.kind !== 'message' || reply.packet.address !== SYS.MANIFEST) {
      return
    }

    const json = reply.packet.args[0]?.value
    if (typeof json !== 'string') {
      return
    }

    const bytes = Buffer.byteLength(json, 'utf8')
    if (bytes < MANIFEST_SIZE.WARNING_BYTES || bytes === this.lastWarnedBytes) {
      return
    }

    this.lastWarnedBytes = bytes
    const message =
      `[mock-unity] /sys/manifest is ${formatKb(bytes)} KB (JSON, UTF-8): ` +
      (bytes > MANIFEST_SIZE.PRACTICAL_LIMIT_BYTES
        ? `exceeds the practical single-datagram limit of ${formatKb(MANIFEST_SIZE.PRACTICAL_LIMIT_BYTES)} KB`
        : `approaching the practical single-datagram limit of ${formatKb(MANIFEST_SIZE.PRACTICAL_LIMIT_BYTES)} KB`) +
      '. Prefer optionsRef/optionLists, shorten labels, or reduce entries.'
    ;(this.log.warn ?? this.log.error).call(this.log, message)
  }
}

function formatKb(bytes: number): string {
  return (bytes / 1024).toFixed(1)
}

async function handleIncomingPacket(context: IncomingPacketContext): Promise<void> {
  let packet: OscPacket

  try {
    packet = decodeOscPacket(context.data)
  } catch (error) {
    if (error instanceof OscDecodeError) {
      context.responder.recordParseError()
      context.log.error(`[mock-unity] Failed to decode OSC packet: ${formatError(error.cause)}`)
      return
    }

    throw error
  }

  const replies = context.responder.handlePacket(packet)
  const stagingSnapshot = context.responder.stagingSnapshot()
  if (stagingSnapshot !== undefined && context.onStagingApply !== undefined) {
    for (const record of stagingSnapshot.applyLog.slice(context.applyCursor.count)) {
      context.onStagingApply(record)
    }
    context.applyCursor.count = stagingSnapshot.applyLog.length
  }
  const target = context.replyTarget ?? {
    host: context.remote.address,
    port: context.remote.port,
  }

  for (const reply of replies) {
    context.manifestSizeMonitor.inspect(reply)
    await sendReply(context.socket, reply, target.port, target.host)
  }
}

function bindSocket(socket: Socket, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const handleListening = () => {
      cleanup()
      resolve()
    }

    const handleError = (error: Error) => {
      cleanup()
      reject(error)
    }

    const cleanup = () => {
      socket.off('listening', handleListening)
      socket.off('error', handleError)
    }

    socket.once('listening', handleListening)
    socket.once('error', handleError)
    socket.bind(port, host)
  })
}

function closeSocket(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.close(() => {
      resolve()
    })
  })
}

function sendPacket(socket: Socket, payload: Uint8Array, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.send(payload, port, host, (error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

async function sendReply(
  socket: Socket,
  reply: MockUnityReply,
  port: number,
  host: string,
): Promise<void> {
  if (reply.delayMs !== undefined && reply.delayMs > 0) {
    await wait(reply.delayMs)
  }

  const payload = reply.kind === 'message' ? encodeOscPacket(reply.packet) : reply.payload
  await sendPacket(socket, payload, port, host)
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function wait(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs)
  })
}

export function isOscMessagePacket(packet: OscPacket): packet is OscMessagePacket {
  return 'address' in packet
}
