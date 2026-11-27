// ブリッジの WebSocket(7080)への接続(D-137・D-138)。どのパネルもこの 1 本を共有する。
//
// - 届いたフレームは shared の zod スキーマで検証してから種類ごとの受け手へ渡す。不正なフレームはそれだけを捨てて
//   接続は保つ(開発標準)。上りも同じスキーマで確かめてから送る(ブリッジが断るものを送らない)
// - heartbeat には heartbeatAck を返す(返さないとブリッジが 30 秒で切る。docs/BRIDGE_PROTOCOL.md)
// - 切れたら 1 秒ごとにつなぎ直す。ブリッジが「接続してよいブラウザの範囲の外」として閉じた(1008)ときは、
//   範囲を戻すまでつながらないので、その旨を status で示す(つなぎ直しは続ける。範囲を戻せば自然に復帰する)
//
// - hello を受けたら、接続ごとの初期の要求(osc.padDocumentRequest)をここから 1 回だけ送る(D-155・D-170)
//
// 状態の正はブリッジにある。ここが持つのは接続の状態と hello(設定の要約)だけで、パネルごとの表示キャッシュは
// 各パネルの store が on() で受けて持つ

import { signal, type ReadonlySignal } from '@preact/signals'

import {
  DownstreamFrameSchema,
  UpstreamFrameSchema,
  WIRE_PROTOCOL_VERSION,
  type DownstreamFrame,
  type UpstreamFrame,
} from '@oscdesk/shared'

/**
 * ブラウザの WebSocket のうち使う部分。テストでは偽物を渡す(test-support の FakeSocket)。ハンドラの引数を never に
 * しているのは、ブラウザの WebSocket(引数が Event / MessageEvent / CloseEvent)も偽物もそのまま代入できるようにするため
 */
export interface SocketLike {
  send(data: string): void
  close(): void
  onopen: ((event: never) => void) | null
  onmessage: ((event: never) => void) | null
  onclose: ((event: never) => void) | null
  onerror: ((event: never) => void) | null
}

export type LinkStatus = 'connecting' | 'open' | 'reconnecting' | 'not-allowed'
export type FrameOf<T extends DownstreamFrame['type']> = Extract<DownstreamFrame, { type: T }>
export type HelloFrame = FrameOf<'hello'>

/** WebSocket の close code 1008(policy violation)。ブリッジは許可の外になった接続をこれで閉じる(D-113)。 */
export const CLOSE_NOT_ALLOWED = 1008
export const RECONNECT_MS = 1_000

export interface BridgeLinkDeps {
  url: string
  createSocket: (url: string) => SocketLike
  setTimer?: (callback: () => void, ms: number) => unknown
  logWarn?: (...args: unknown[]) => void
}

export interface BridgeLink {
  readonly status: ReadonlySignal<LinkStatus>
  /** status が open か(多くの画面は「送れるか」だけを見る)。 */
  readonly connected: ReadonlySignal<boolean>
  /** 直近の接続でブリッジが送った hello(切れたら null)。 */
  readonly hello: ReadonlySignal<HelloFrame | null>
  /** 上りのフレームを検証して送る。つながっていない・検証に通らないなら送らずに false。 */
  send(frame: UpstreamFrame): boolean
  /** その種類の下りのフレームを受ける。戻り値は受けるのをやめる関数。 */
  on<T extends DownstreamFrame['type']>(type: T, handler: (frame: FrameOf<T>) => void): () => void
  /** つながった・切れたときに呼ぶ(接続ごとの表示キャッシュを捨てるのに使う)。 */
  onConnectionChange(handler: (connected: boolean) => void): () => void
  start(): void
  close(): void
}

/** ページの URL からブリッジの WebSocket の URL を作る(SPA はブリッジ自身が配るので同じ host:port)。 */
export function bridgeUrlOf(location: { protocol: string; host: string }): string {
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/`
}

export function createBridgeLink(deps: BridgeLinkDeps): BridgeLink {
  const setTimer = deps.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms))
  const logWarn = deps.logWarn ?? console.warn
  const status = signal<LinkStatus>('connecting')
  const connected = signal(false)
  const hello = signal<HelloFrame | null>(null)
  const handlers = new Map<string, Set<(frame: never) => void>>()
  const connectionHandlers = new Set<(connected: boolean) => void>()
  let socket: SocketLike | null = null
  let closed = false

  const dispatch = (frame: DownstreamFrame) => {
    for (const handler of handlers.get(frame.type) ?? []) {
      try {
        (handler as (frame: DownstreamFrame) => void)(frame)
      } catch (error) {
        // 1 つのパネルの不具合で、ほかのパネルへの配信と接続を止めない
        logWarn('(WARN, SPA)', `A handler for "${frame.type}" threw`, error)
      }
    }
  }

  const setConnected = (next: boolean) => {
    if (connected.value === next) return
    connected.value = next
    for (const handler of connectionHandlers) handler(next)
  }

  const send = (candidate: UpstreamFrame): boolean => {
    if (socket === null || !connected.value) return false
    const checked = UpstreamFrameSchema.safeParse(candidate)
    if (!checked.success) {
      logWarn('(WARN, SPA)', 'Refused to send an invalid frame', candidate.type, checked.error.issues)
      return false
    }
    socket.send(JSON.stringify(checked.data))
    return true
  }

  const onMessage = (raw: unknown) => {
    let json: unknown
    try {
      json = JSON.parse(typeof raw === 'string' ? raw : String(raw))
    } catch {
      logWarn('(WARN, SPA)', 'Dropped a frame that is not JSON')
      return
    }
    const parsed = DownstreamFrameSchema.safeParse(json)
    if (!parsed.success) {
      logWarn('(WARN, SPA)', 'Dropped an invalid frame', parsed.error.issues.slice(0, 3))
      return
    }
    const frame = parsed.data
    if (frame.type === 'heartbeat') send({ v: WIRE_PROTOCOL_VERSION, type: 'heartbeatAck', t: frame.t })
    if (frame.type === 'hello') hello.value = frame
    dispatch(frame)
    if (frame.type === 'hello') sendInitialRequests(frame)
  }

  /**
   * 接続ごとの初期の要求(D-155)。ブリッジは接続しただけでは採用中のパッド・保持値を送らず、要求して初めてこの接続へ配る
   * (BRIDGE_PROTOCOL の osc.padDocumentRequest)。どのパネルも答えのフレームを on() で受けるだけにして、要求はここの 1 か所で送る
   * (パネルごとに送ると、パネルを足すたびに同じ要求が増え、どれかが送り忘れるとそのパネルだけが空のままになる)。hello の後に
   * 送るのは、パッドの要求が hello の adapters(OSC の有無)で決まるため。主画面をパッドにした(D-170)ので、サーフェス定義の
   * surfaceRequest と版 1 のパッドの osc.padRequest は送らない(宛先・ネットワーク・ロック・OSCQuery のターゲットはブリッジが接続時に送る)
   */
  const sendInitialRequests = (frame: HelloFrame) => {
    if (frame.adapters.includes('osc')) send({ v: WIRE_PROTOCOL_VERSION, type: 'osc.padDocumentRequest' })
  }

  const connect = () => {
    if (closed) return
    const next = deps.createSocket(deps.url)
    socket = next
    next.onopen = () => {
      if (socket !== next) return
      status.value = 'open'
      setConnected(true)
    }
    next.onmessage = (event: { data: unknown }) => {
      if (socket === next) onMessage(event.data)
    }
    next.onerror = () => undefined
    next.onclose = (event: { code?: number } | undefined) => {
      if (socket !== next) return
      const opened = status.value === 'open'
      socket = null
      hello.value = null
      // 範囲の外で閉じられた後のつなぎ直しは、ハンドシェイクで断られて 1006 で閉じる。つながるまでは「範囲の外」の案内を残す
      const notAllowed = event?.code === CLOSE_NOT_ALLOWED || (!opened && status.value === 'not-allowed')
      status.value = notAllowed ? 'not-allowed' : 'reconnecting'
      setConnected(false)
      if (!closed) setTimer(connect, RECONNECT_MS)
    }
  }

  return {
    status,
    connected,
    hello,
    send,
    on(type, handler) {
      let set = handlers.get(type)
      if (set === undefined) {
        set = new Set()
        handlers.set(type, set)
      }
      set.add(handler as (frame: never) => void)
      return () => set.delete(handler as (frame: never) => void)
    },
    onConnectionChange(handler) {
      connectionHandlers.add(handler)
      return () => connectionHandlers.delete(handler)
    },
    start: connect,
    close() {
      closed = true
      socket?.close()
    },
  }
}
