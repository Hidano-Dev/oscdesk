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
  /** その接続の送信元アドレス(切れていれば undefined)。 */
  peerOf(clientId: ClientId): string | undefined
  /** 許可の外になった接続を切る(接続してよいブラウザの範囲を変えたとき。D-113)。切った数を返す。 */
  closeDisallowed(): number
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
  /** Origin 付き(ブラウザ発)のハンドシェイクを 403 で拒否したときの通知(D-082)。 */
  onHandshakeRejected?: (origin: string, peer: string) => void
  /** Origin 付きなど、ブラウザ発の状態を変える HTTP リクエストを 403 で拒否したときの通知(D-083)。 */
  onHttpRejected?: (method: string, origin: string, peer: string) => void
  /** 通常の HTTP リクエスト(WebSocket アップグレード以外)。true を返したら処理済み。未指定・false は 404。 */
  onHttpRequest?: (request: IncomingMessage, response: ServerResponse) => boolean
  /**
   * その送信元から受けてよいか(接続してよいブラウザの範囲。D-113)。WebSocket のハンドシェイクと HTTP の両方で見る。
   * 未指定ならすべて受ける
   */
  isPeerAllowed?: (address: string) => boolean
  /** 範囲の外の送信元を 403 で断ったときの通知(D-113)。 */
  onPeerRejected?: (kind: 'websocket' | 'http', peer: string) => void
  /** onFrame・onHttpRequest が想定外の例外を投げたときのログ(D-129)。未指定は console.error。 */
  logError?: (message?: unknown, ...optionalParams: unknown[]) => void
  now?: () => number
  setIntervalFn?: (cb: () => void, ms: number) => TimerHandle
  clearIntervalFn?: (handle: TimerHandle) => void
}

interface Client {
  socket: WebSocket
  peer: string
  lastReceivedAt: number
  disconnected: boolean
}

// 読み取り専用のメソッド。ブラウザから撃たれても、CORS ヘッダが無いので応答をページは読めない。
const SAFE_HTTP_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS'])

const DEFAULT_HEARTBEAT = { intervalMs: 15_000, timeoutMs: 30_000 }

export function startUiHub(options: UiHubOptions): Promise<UiHub> {
  const heartbeat = options.heartbeat ?? DEFAULT_HEARTBEAT
  if (heartbeat.timeoutMs <= heartbeat.intervalMs) {
    return Promise.reject(new Error('heartbeat.timeoutMs must be greater than heartbeat.intervalMs'))
  }

  const now = options.now ?? Date.now
  const logError = options.logError ?? console.error
  const setIntervalFn = options.setIntervalFn ?? setInterval
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval
  const clients = new Map<ClientId, Client>()
  // 定義のダウンロード・アップロード用に、WebSocket と同じポートで HTTP も受ける
  const peerAllowed = (address: string) => options.isPeerAllowed?.(address) ?? true
  const httpServer = http.createServer((request, response) => {
    // 範囲の外の送信元(D-113)は、読み取りも含めて何も返さない
    const peer = request.socket.remoteAddress ?? ''
    if (!peerAllowed(peer)) {
      options.onPeerRejected?.('http', peer)
      response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('forbidden')
      return
    }
    // 第三者のページからの単純な cross-origin POST / PUT でも、リクエストは届いて副作用が起きる
    // (CORS は応答の読み取りを止めるだけ)。ブラウザは Origin を外せないので、付いていれば拒否する。
    // Origin を省く GET 系の cross-site 取得は Sec-Fetch-Site で見るが、状態を変えるのは非 GET のみ(D-083)。
    const method = request.method ?? ''
    const origin = request.headers.origin
    if (!SAFE_HTTP_METHODS.has(method) && (origin !== undefined || request.headers['sec-fetch-site'] === 'cross-site')) {
      options.onHttpRejected?.(method, origin ?? '', request.socket.remoteAddress ?? '')
      response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('forbidden')
      return
    }
    try {
      if (options.onHttpRequest?.(request, response) === true) return
    } catch (error) {
      // http サーバのコールバックで投げた例外はプロセスごと落とす。認証の無い LAN から届く要求で
      // ブリッジ全体が止まらないよう、ここで受けて 500 を返す(D-129)。クエリは記録しない(長さに上限が無いため)
      logError('(ERROR, BRIDGE)', `Unexpected error while handling HTTP ${method.slice(0, 16)} ${(request.url ?? '').split('?')[0].slice(0, 200)}`, error)
      if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      if (!response.writableEnded) response.end('internal error')
      return
    }
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('not found')
  })
  // ブラウザは WebSocket のハンドシェイクに必ず Origin を付け、ページ側から外せない。
  // 正規の UI(NiceGUI のサーバ側 websockets)は付けないので、付いていれば第三者のページが
  // 利用者のブラウザを踏み台にしている。受けると認証なしで osc を撃たれる(D-082)。
  const server = new WebSocketServer({
    server: httpServer,
    verifyClient: ({ req }, done) => {
      const peer = req.socket.remoteAddress ?? ''
      if (!peerAllowed(peer)) {
        options.onPeerRejected?.('websocket', peer)
        done(false, 403, 'Forbidden')
        return
      }
      const origin = req.headers.origin
      if (origin === undefined) return done(true)
      options.onHandshakeRejected?.(origin, req.socket.remoteAddress ?? '')
      done(false, 403, 'Forbidden')
    },
  })
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
      peer: request.socket.remoteAddress ?? '',
      lastReceivedAt: now(),
      disconnected: false,
    }
    clients.set(clientId, client)
    options.onConnect(clientId, {
      host: request.socket.remoteAddress ?? '',
      port: request.socket.remotePort ?? 0,
    })

    socket.on('message', (data: RawData, isBinary: boolean) => {
      // 切った接続(許可の取り消し・心拍の時間切れ。D-113)は、Close のやり取りが終わるまでの間に届いたフレームも捨てる
      // (捨てないと、範囲の外になった送信元が切られる直前に送った networkSettingsSet などが処理されてしまう)
      if (client.disconnected) return
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
      try {
        options.onFrame(parsed.value, clientId)
      } catch (error) {
        // ws の 'message' リスナーで投げた例外は未処理例外になり、ブリッジのプロセスごと終わる(HID-405 の壊れた
        // surfaceSave で起きた)。不正フレームと同じく、そのフレームだけを捨てて接続は保ち、要求元に知らせる(D-028・D-129)。
        // フレームの中身は大きくなりうるので、ログと notice には型と例外の文言だけを載せる
        const message = error instanceof Error ? error.message : String(error)
        logError('(ERROR, BRIDGE)', `Unexpected error while handling UI frame "${parsed.value.type}"`, { clientId }, error)
        sendFrame(socket, {
          v: 1,
          type: 'notice',
          level: 'error',
          code: 'internal-error',
          detail: `${parsed.value.type}: ${message.slice(0, 200)}`,
        })
      }
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
          // 直列化は配信 1 回につき 1 回だけ行い、同じ文字列を全接続へ送る(HID-403)。
          // surface フレームは定義・結び付け・部品の木を丸ごと載せるので、ソケットごとに JSON.stringify すると
          // 大きな定義では接続数ぶん同じ直列化を繰り返す。開いている接続が無いときは直列化もしない
          let payload: string | undefined
          for (const client of clients.values()) {
            if (client.socket.readyState !== WebSocket.OPEN) continue
            payload ??= JSON.stringify(frame)
            client.socket.send(payload)
          }
        },
        sendTo(clientId, frame) {
          const client = clients.get(clientId)
          if (client) sendFrame(client.socket, frame)
        },
        peerOf(clientId) {
          return clients.get(clientId)?.peer
        },
        closeDisallowed() {
          let closed = 0
          for (const [clientId, client] of clients) {
            if (peerAllowed(client.peer)) continue
            disconnect(clientId, 'server-closed')
            // 1008 = policy violation(許可の外)。相手は再接続してもハンドシェイクで断られる
            client.socket.close(1008, 'not allowed')
            closed += 1
          }
          return closed
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
