import { randomUUID } from 'node:crypto'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'

import { WebSocketServer, WebSocket, type RawData } from 'ws'

import {
  parseUpstreamFrame,
  type DownstreamFrame,
  type FrameRejectReason,
  type UpstreamFrame,
} from '@oscdesk/shared'

export type TimerHandle = ReturnType<typeof setInterval> | number
export type ClientId = string

export interface UiHub {
  readonly port: number
  readonly clientCount: number
  broadcast(frame: DownstreamFrame): void
  sendTo(clientId: ClientId, frame: DownstreamFrame): void
  close(): Promise<void>
}

export interface UiHubOptions {
  host?: string
  port: number
  heartbeat?: { intervalMs: number; timeoutMs: number }
  onConnect: (clientId: ClientId, peer: { host: string; port: number }) => void
  onDisconnect: (clientId: ClientId, reason: 'client-closed' | 'heartbeat-timeout' | 'server-closed') => void
  onFrame: (frame: UpstreamFrame, clientId: ClientId) => void
  onInvalidFrame: (clientId: ClientId, reason: FrameRejectReason, rawPreview: string) => void
  /** 通常の HTTP リクエスト(WebSocket アップグレード以外)。true を返したら処理済み。未指定・false は 404。 */
  onHttpRequest?: (request: IncomingMessage, response: ServerResponse) => boolean
  now?: () => number
  setIntervalFn?: (cb: () => void, ms: number) => TimerHandle
  clearIntervalFn?: (handle: TimerHandle) => void
}

interface Client {
  socket: WebSocket
  lastReceivedAt: number
  disconnected: boolean
}

const DEFAULT_HEARTBEAT = { intervalMs: 15_000, timeoutMs: 30_000 }

export function startUiHub(options: UiHubOptions): Promise<UiHub> {
  const heartbeat = options.heartbeat ?? DEFAULT_HEARTBEAT
  if (heartbeat.timeoutMs <= heartbeat.intervalMs) {
    return Promise.reject(new Error('heartbeat.timeoutMs must be greater than heartbeat.intervalMs'))
  }

  const now = options.now ?? Date.now
  const setIntervalFn = options.setIntervalFn ?? setInterval
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval
  const clients = new Map<ClientId, Client>()
  // 定義のダウンロード・アップロード用に、WebSocket と同じポートで HTTP も受ける
  const httpServer = http.createServer((request, response) => {
    if (options.onHttpRequest?.(request, response) === true) return
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('not found')
  })
  const server = new WebSocketServer({ server: httpServer })
  // ws は外部 HTTP サーバの 'error' を自分の 'error' として再発行する。起動失敗は
  // httpServer 側で受けて reject するので、ここで握らないと未処理例外になる。
  server.on('error', () => undefined)
  let timer: TimerHandle | null = null
  let closing = false

  const disconnect = (clientId: ClientId, reason: 'client-closed' | 'heartbeat-timeout' | 'server-closed') => {
    const client = clients.get(clientId)
    if (!client || client.disconnected) return
    client.disconnected = true
    clients.delete(clientId)
    options.onDisconnect(clientId, reason)
  }

  server.on('connection', (socket, request) => {
    const clientId = randomUUID()
    const client: Client = {
      socket,
      lastReceivedAt: now(),
      disconnected: false,
    }
    clients.set(clientId, client)
    options.onConnect(clientId, {
      host: request.socket.remoteAddress ?? '',
      port: request.socket.remotePort ?? 0,
    })

    socket.on('message', (data: RawData, isBinary: boolean) => {
      if (isBinary) {
        // バイナリは無条件で破棄する(仕様)。ただし黙殺せず不正フレームとして
        // 記録・通知し、生存確認にも数えない(バイナリしか送らない誤設定クライアントを
        // 心拍タイムアウトで切れるようにするため)
        options.onInvalidFrame(clientId, 'binary-frame', '')
        sendFrame(socket, {
          v: 1,
          type: 'notice',
          level: 'warn',
          code: 'invalid-frame',
          detail: 'binary-frame',
        })
        return
      }
      client.lastReceivedAt = now()

      const raw = rawText(data)
      const parsed = parseUpstreamFrame(raw)
      if (!parsed.ok) {
        const preview = raw.slice(0, 200)
        options.onInvalidFrame(clientId, parsed.error, preview)
        sendFrame(socket, {
          v: 1,
          type: 'notice',
          level: 'warn',
          code: 'invalid-frame',
          detail: parsed.error,
        })
        return
      }
      options.onFrame(parsed.value, clientId)
    })
    socket.once('close', () => disconnect(clientId, closing ? 'server-closed' : 'client-closed'))
    socket.on('error', () => {
      // ws emits close after an error; lifecycle notification is centralized there.
    })
  })

  const handleHeartbeat = () => {
    const timestamp = now()
    for (const [clientId, client] of clients) {
      if (timestamp - client.lastReceivedAt > heartbeat.timeoutMs) {
        disconnect(clientId, 'heartbeat-timeout')
        client.socket.terminate()
        continue
      }
      if (client.socket.readyState === WebSocket.OPEN) {
        sendFrame(client.socket, { v: 1, type: 'heartbeat', t: timestamp })
      }
    }
  }

  const clearTimer = () => {
    if (timer !== null) {
      clearIntervalFn(timer)
      timer = null
    }
  }

  const ready = new Promise<UiHub>((resolve, reject) => {
    const onListening = () => {
      httpServer.off('error', onStartupError)
      timer = setIntervalFn(handleHeartbeat, heartbeat.intervalMs)
      const address = httpServer.address()
      const port = typeof address === 'object' && address ? address.port : options.port
      resolve({
        get port() { return port },
        get clientCount() { return clients.size },
        broadcast(frame) {
          for (const client of clients.values()) sendFrame(client.socket, frame)
        },
        sendTo(clientId, frame) {
          const client = clients.get(clientId)
          if (client) sendFrame(client.socket, frame)
        },
        close() {
          closing = true
          clearTimer()
          for (const [clientId, client] of clients) {
            disconnect(clientId, 'server-closed')
            client.socket.close()
          }
          return new Promise<void>((done, fail) => {
            server.close((error) => {
              if (error) return fail(error)
              httpServer.close(httpError => httpError ? fail(httpError) : done())
              // keep-alive の HTTP 接続が残ると close が終わらない
              httpServer.closeAllConnections()
            })
          })
        },
      })
    }
    const onStartupError = (error: Error) => {
      httpServer.off('listening', onListening)
      server.close(() => undefined)
      httpServer.close(() => undefined)
      reject(error)
    }
    httpServer.once('listening', onListening)
    httpServer.once('error', onStartupError)
    httpServer.listen(options.port, options.host ?? '0.0.0.0')
  })

  return ready
}

function rawText(data: RawData): string {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  const chunks = Array.isArray(data) ? data : [data]
  return Buffer.concat(chunks.map(chunk => Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))).toString('utf8')
}

function sendFrame(socket: WebSocket, frame: DownstreamFrame): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame))
}
