import http from 'node:http'

import { WebSocketServer, type WebSocket } from 'ws'

// OSCQuery を話す見本のターゲット(D-168)。受け口(oscdesk-unity。HID-490)と同じ取り決めで答える。
// - `GET /?HOST_INFO` は HOST_INFO(OSC_IP は出さない。WS_PORT と EXTENSIONS は明示する。起動 ID は X_OSCDESK_BOOT_ID)
// - `GET /<パス>` はそのノード(FULL_PATH を埋めた木)。`?VALUE` などの属性のクエリは 204(未対応)
// - 同じポートの WebSocket で、名前空間が変わったら PATH_CHANGED を送る(LISTEN は受けても何もしない)

export interface OscQueryNode {
  [key: string]: unknown
  CONTENTS?: Record<string, OscQueryNode>
}

export interface MockOscQueryServer {
  readonly port: number
  /** 名前空間を差し替え、つないでいる WebSocket へ PATH_CHANGED を送る */
  setNamespace(root: OscQueryNode): void
  close(): Promise<void>
}

/** 部品の推定(HID-484 §5)の種類が一通りそろう見本の名前空間 */
export const DEFAULT_OSCQUERY_NAMESPACE: OscQueryNode = {
  DESCRIPTION: 'mock-unity',
  CONTENTS: {
    scene: {
      CONTENTS: {
        start: { TYPE: 'N', ACCESS: 2, DESCRIPTION: '開始' },
        enabled: { TYPE: 'T', ACCESS: 3, DESCRIPTION: '有効' },
        level: { TYPE: 'f', ACCESS: 3, RANGE: [{ MIN: 0, MAX: 1 }], VALUE: [0.5], DESCRIPTION: '音量' },
        count: { TYPE: 'i', ACCESS: 3, DESCRIPTION: '回数' },
        mode: { TYPE: 's', ACCESS: 3, RANGE: [{ VALS: ['a', 'b', 'c'] }], DESCRIPTION: 'モード' },
        title: { TYPE: 's', ACCESS: 2 },
        tint: { TYPE: 'r', ACCESS: 3 },
        pos: { TYPE: 'ff', ACCESS: 3, RANGE: [{ MIN: -1, MAX: 1 }, { MIN: -1, MAX: 1 }] },
        stamp: { TYPE: 't', ACCESS: 2 },
        fps: { TYPE: 'f', ACCESS: 1, VALUE: [60] },
      },
    },
  },
}

export async function startMockOscQueryServer(options: {
  port: number
  host?: string
  namespace: OscQueryNode
  hostInfo: () => Record<string, unknown>
}): Promise<MockOscQueryServer> {
  let root = withFullPaths(options.namespace, '/')
  const server = http.createServer((request, response) => {
    // 外から来る URL は壊れていることがある(`/%` のような不正なパーセントエンコード)。例外で mock ごと落とさず 400 で断る
    let url: URL
    let attribute: string | null
    let pathname: string
    try {
      url = new URL(request.url ?? '/', 'http://localhost')
      attribute = url.search.length > 1 ? decodeURIComponent(url.search.slice(1)) : null
      pathname = decodeURIComponent(url.pathname)
    } catch {
      response.writeHead(400).end()
      return
    }
    if (request.method !== 'GET') {
      response.writeHead(405).end()
      return
    }
    if (attribute === 'HOST_INFO') {
      sendJson(response, options.hostInfo())
      return
    }
    if (attribute !== null) {
      // 属性のクエリは実装しない(HID-484 §6.1。受け口と同じく 204)
      response.writeHead(204).end()
      return
    }
    const node = findNode(root, pathname)
    if (node === undefined) {
      response.writeHead(404).end()
      return
    }
    sendJson(response, node)
  })
  const sockets = new WebSocketServer({ server })
  // 待ち受けの失敗は listen の側で知らせる。ここで受けないと ws が error を投げ直して mock が落ちる
  sockets.on('error', () => undefined)
  const clients = new Set<WebSocket>()
  sockets.on('connection', socket => {
    clients.add(socket)
    socket.on('close', () => clients.delete(socket))
    socket.on('error', () => clients.delete(socket))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, options.host ?? '0.0.0.0', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : options.port
  return {
    port,
    setNamespace(next) {
      root = withFullPaths(next, '/')
      const message = JSON.stringify({ COMMAND: 'PATH_CHANGED', DATA: '/' })
      for (const client of clients) client.send(message)
    },
    async close() {
      for (const client of clients) client.terminate()
      await new Promise<void>(resolve => sockets.close(() => resolve()))
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
}

function sendJson(response: http.ServerResponse, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  response.writeHead(200, { 'content-type': 'application/json', 'content-length': String(body.length) }).end(body)
}

function withFullPaths(node: OscQueryNode, path: string): OscQueryNode {
  const { CONTENTS, ...rest } = node
  const filled: OscQueryNode = { ...rest, FULL_PATH: path }
  if (CONTENTS !== undefined) {
    filled.CONTENTS = Object.fromEntries(Object.entries(CONTENTS).map(([key, child]) =>
      [key, withFullPaths(child, path === '/' ? `/${key}` : `${path}/${key}`)]))
  }
  return filled
}

function findNode(root: OscQueryNode, path: string): OscQueryNode | undefined {
  if (path === '/' || path === '') return root
  let node: OscQueryNode | undefined = root
  for (const part of path.split('/').filter(segment => segment.length > 0)) {
    node = node?.CONTENTS?.[part]
    if (node === undefined) return undefined
  }
  return node
}
