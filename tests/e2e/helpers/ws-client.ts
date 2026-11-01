import { WebSocket, type ClientOptions } from 'ws'

import {
  DownstreamFrameSchema,
  type DownstreamFrame,
  type OscArg,
  type UpstreamFrame,
} from '../../../packages/shared/src'

export interface WsE2eClient {
  readonly url: string
  send(frame: UpstreamFrame): void
  sendRaw(payload: string): void
  sendOsc(address: string, args: OscArg[]): void
  nextFrame(timeoutMs?: number): Promise<DownstreamFrame>
  waitForFrame(predicate: (frame: DownstreamFrame) => boolean, timeoutMs?: number): Promise<DownstreamFrame>
  /** 接続が開いているか(ブリッジに切られていないか)。 */
  readonly isOpen: boolean
  close(): Promise<void>
}

const DEFAULT_TIMEOUT_MS = 5_000

/** options は ws の接続オプション(送信元アドレスを変える localAddress など)。 */
export async function connectWsE2eClient(url: string, options?: ClientOptions): Promise<WsE2eClient> {
  const socket = new WebSocket(url, options)
  await waitForOpen(socket)
  return new WsE2eClientImpl(url, socket)
}

class WsE2eClientImpl implements WsE2eClient {
  readonly #socket: WebSocket
  readonly #frames: DownstreamFrame[] = []
  readonly #waiters: Array<{
    predicate: (frame: DownstreamFrame) => boolean
    resolve: (frame: DownstreamFrame) => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout
  }> = []
  #closePromise?: Promise<void>

  constructor(readonly url: string, socket: WebSocket) {
    this.#socket = socket
    socket.on('message', (payload) => this.receive(payload.toString()))
  }

  send(frame: UpstreamFrame): void {
    this.assertOpen()
    this.#socket.send(JSON.stringify(frame))
  }

  get isOpen(): boolean {
    return this.#socket.readyState === WebSocket.OPEN
  }

  sendRaw(payload: string): void {
    this.assertOpen()
    this.#socket.send(payload)
  }

  sendOsc(address: string, args: OscArg[]): void {
    this.send({ v: 1, type: 'osc.message', address, args })
  }

  nextFrame(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<DownstreamFrame> {
    return this.waitForFrame(() => true, timeoutMs)
  }

  waitForFrame(
    predicate: (frame: DownstreamFrame) => boolean,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<DownstreamFrame> {
    const queuedIndex = this.#frames.findIndex(predicate)
    if (queuedIndex >= 0) {
      return Promise.resolve(this.#frames.splice(queuedIndex, 1)[0])
    }

    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = this.#waiters.indexOf(waiter)
          if (index >= 0) this.#waiters.splice(index, 1)
          reject(new Error(`Timed out waiting for a WebSocket frame from ${this.url}.`))
        }, timeoutMs),
      }
      this.#waiters.push(waiter)
    })
  }

  async close(): Promise<void> {
    if (this.#closePromise !== undefined) return this.#closePromise
    this.#closePromise = new Promise((resolve) => {
      if (this.#socket.readyState === WebSocket.CLOSED) {
        resolve()
        return
      }
      this.#socket.once('close', () => resolve())
      this.#socket.close()
    })
    await this.#closePromise
  }

  private receive(payload: string): void {
    const parsed: unknown = parseJson(payload)
    const result = DownstreamFrameSchema.safeParse(parsed)
    if (!result.success) return

    const frame = result.data
    const waiter = this.#waiters.find((candidate) => candidate.predicate(frame))
    if (waiter === undefined) {
      this.#frames.push(frame)
      return
    }

    this.#waiters.splice(this.#waiters.indexOf(waiter), 1)
    clearTimeout(waiter.timer)
    waiter.resolve(frame)
  }

  private assertOpen(): void {
    if (this.#socket.readyState !== WebSocket.OPEN) {
      throw new Error(`WebSocket client is not open: ${this.url}`)
    }
  }
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve())
    socket.once('error', reject)
  })
}

function parseJson(payload: string): unknown {
  try {
    return JSON.parse(payload)
  } catch {
    return undefined
  }
}
