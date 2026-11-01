import { WebSocket } from 'ws'
import { afterEach, describe, expect, it } from 'vitest'

import { startUiHub, type UiHub } from './ui-hub'

const open = (port: number, path = '/ignored/path') => new Promise<WebSocket>((resolve, reject) => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`)
  socket.once('open', () => resolve(socket))
  socket.once('error', reject)
})

const nextMessage = (socket: WebSocket) => new Promise<unknown>(resolve => {
  socket.once('message', data => resolve(JSON.parse(data.toString())))
})

const closeSocket = (socket: WebSocket) => new Promise<void>(resolve => {
  if (socket.readyState === WebSocket.CLOSED) return resolve()
  socket.once('close', () => resolve())
  socket.close()
})

describe('UiHub', () => {
  let hub: UiHub | undefined

  afterEach(async () => {
    if (hub) await hub.close()
    hub = undefined
  })

  it('starts, sends to all or one client, and closes', async () => {
    const connected: string[] = []
    hub = await startUiHub({
      port: 0,
      onConnect: id => connected.push(id),
      onDisconnect: () => undefined,
      onFrame: () => undefined,
      onInvalidFrame: () => undefined,
    })
    const first = await open(hub.port)
    const second = await open(hub.port)
    expect(hub.clientCount).toBe(2)

    const frame = { v: 1 as const, type: 'notice' as const, level: 'info' as const, code: 'test', detail: 'hello' }
    const firstBroadcast = nextMessage(first)
    const secondBroadcast = nextMessage(second)
    hub.broadcast(frame)
    await expect(firstBroadcast).resolves.toEqual(frame)
    await expect(secondBroadcast).resolves.toEqual(frame)

    const onlyFirst = nextMessage(first)
    hub.sendTo(connected[0], { ...frame, detail: 'private' })
    await expect(onlyFirst).resolves.toMatchObject({ detail: 'private' })
    await closeSocket(first)
    await closeSocket(second)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(hub.clientCount).toBe(0)
  })

  it('rejects handshakes carrying an Origin header but accepts ones without', async () => {
    const rejected: string[] = []
    hub = await startUiHub({
      port: 0,
      onConnect: () => undefined,
      onDisconnect: () => undefined,
      onFrame: () => undefined,
      onInvalidFrame: () => undefined,
      onHandshakeRejected: origin => rejected.push(origin),
    })
    const browser = new WebSocket(`ws://127.0.0.1:${hub.port}/`, { origin: 'http://evil.example' })
    const status = await new Promise<number>(resolve => {
      browser.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0))
      browser.once('error', () => undefined)
    })
    expect(status).toBe(403)
    expect(rejected).toEqual(['http://evil.example'])
    expect(hub.clientCount).toBe(0)

    const client = await open(hub.port)
    expect(hub.clientCount).toBe(1)
    await closeSocket(client)
  })

  it('rejects state-changing HTTP requests from browsers but serves plain ones and reads', async () => {
    const rejected: string[] = []
    const handled: string[] = []
    hub = await startUiHub({
      port: 0,
      onConnect: () => undefined,
      onDisconnect: () => undefined,
      onFrame: () => undefined,
      onInvalidFrame: () => undefined,
      onHttpRejected: (method, origin) => rejected.push(`${method} ${origin}`),
      onHttpRequest: (request, response) => {
        handled.push(request.method ?? '')
        response.writeHead(204)
        response.end()
        return true
      },
    })
    const url = `http://127.0.0.1:${hub.port}/surfaces/x`
    const status = async (method: string, headers: Record<string, string> = {}) => (await fetch(url, { method, headers })).status

    expect(await status('PUT', { Origin: 'http://evil.example' })).toBe(403)
    expect(await status('POST', { 'Sec-Fetch-Site': 'cross-site' })).toBe(403)
    expect(rejected).toEqual(['PUT http://evil.example', 'POST '])
    expect(handled).toEqual([])

    expect(await status('PUT')).toBe(204)
    expect(await status('GET', { Origin: 'http://evil.example' })).toBe(204)
    expect(handled).toEqual(['PUT', 'GET'])
  })

  it('propagates a bind failure', async () => {
    const first = await startUiHub({ port: 0, onConnect: () => undefined, onDisconnect: () => undefined, onFrame: () => undefined, onInvalidFrame: () => undefined })
    const port = first.port
    await expect(startUiHub({ port, onConnect: () => undefined, onDisconnect: () => undefined, onFrame: () => undefined, onInvalidFrame: () => undefined })).rejects.toBeTruthy()
    await first.close()
  })

  it('keeps the connection after an invalid frame and reports a valid frame', async () => {
    const received: unknown[] = []
    const invalid: Array<{ reason: string; preview: string }> = []
    hub = await startUiHub({
      port: 0,
      onConnect: () => undefined,
      onDisconnect: () => undefined,
      onFrame: frame => received.push(frame),
      onInvalidFrame: (_id, reason, preview) => invalid.push({ reason, preview }),
    })
    const socket = await open(hub.port, '/anything')
    const notice = nextMessage(socket)
    socket.send('x'.repeat(250))
    await expect(notice).resolves.toMatchObject({ type: 'notice', code: 'invalid-frame' })
    expect(invalid[0].preview).toHaveLength(200)

    socket.send(JSON.stringify({ v: 1, type: 'heartbeatAck', t: 1 }))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(received).toEqual([{ v: 1, type: 'heartbeatAck', t: 1 }])
    await closeSocket(socket)
  })

  it('answers a frame whose handling throws with an internal-error notice and keeps the connection (HID-406)', async () => {
    const received: string[] = []
    const logged: unknown[][] = []
    hub = await startUiHub({
      port: 0,
      onConnect: () => undefined,
      onDisconnect: () => undefined,
      onFrame: (frame) => {
        if (frame.type === 'surfaceRequest') throw new TypeError('boom')
        received.push(frame.type)
      },
      onInvalidFrame: () => undefined,
      logError: (...args) => logged.push(args),
    })
    const socket = await open(hub.port)
    const notice = nextMessage(socket)
    socket.send(JSON.stringify({ v: 1, type: 'surfaceRequest' }))
    await expect(notice).resolves.toEqual({ v: 1, type: 'notice', level: 'error', code: 'internal-error', detail: 'surfaceRequest: boom' })
    expect(logged).toHaveLength(1)
    expect(logged[0][0]).toBe('(ERROR, BRIDGE)')
    expect(String(logged[0][1])).toContain('surfaceRequest')

    // 同じ接続の次のフレームは普通に処理される
    socket.send(JSON.stringify({ v: 1, type: 'heartbeatAck', t: 1 }))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(received).toEqual(['heartbeatAck'])
    expect(hub.clientCount).toBe(1)
    await closeSocket(socket)
  })

  it('answers 500 when the HTTP handler throws and keeps serving (HID-406)', async () => {
    const logged: unknown[][] = []
    let fail = true
    hub = await startUiHub({
      port: 0,
      onConnect: () => undefined,
      onDisconnect: () => undefined,
      onFrame: () => undefined,
      onInvalidFrame: () => undefined,
      onHttpRequest: (_request, response) => {
        if (fail) throw new Error('boom')
        response.writeHead(204)
        response.end()
        return true
      },
      logError: (...args) => logged.push(args),
    })
    const url = `http://127.0.0.1:${hub.port}/surfaces/x.json?secret=1`
    expect((await fetch(url)).status).toBe(500)
    expect(logged).toHaveLength(1)
    expect(String(logged[0][1])).toBe('Unexpected error while handling HTTP GET /surfaces/x.json')
    fail = false
    expect((await fetch(url)).status).toBe(204)
  })

  it('rejects binary frames visibly and keeps the connection', async () => {
    const invalid: string[] = []
    hub = await startUiHub({
      port: 0,
      onConnect: () => undefined,
      onDisconnect: () => undefined,
      onFrame: () => undefined,
      onInvalidFrame: (_id, reason) => invalid.push(reason),
    })
    const socket = await open(hub.port)
    const notice = nextMessage(socket)
    socket.send(Buffer.from([0x01, 0x02, 0x03]))
    await expect(notice).resolves.toMatchObject({ type: 'notice', code: 'invalid-frame', detail: 'binary-frame' })
    expect(invalid).toEqual(['binary-frame'])
    expect(hub.clientCount).toBe(1)
    await closeSocket(socket)
  })

  it('disconnects a client after heartbeat timeout', async () => {
    let now = 0
    let heartbeat: (() => void) | undefined
    let disconnectedResolve: ((id: string) => void) | undefined
    const disconnected = new Promise<string>(resolve => { disconnectedResolve = resolve })
    hub = await startUiHub({
      port: 0,
      heartbeat: { intervalMs: 10, timeoutMs: 20 },
      now: () => now,
      setIntervalFn: callback => { heartbeat = callback; return 1 },
      clearIntervalFn: () => undefined,
      onConnect: () => undefined,
      onDisconnect: (id, reason) => { if (reason === 'heartbeat-timeout') disconnectedResolve?.(id) },
      onFrame: () => undefined,
      onInvalidFrame: () => undefined,
    })
    const socket = await open(hub.port)
    now = 21
    heartbeat?.()
    await expect(disconnected).resolves.toBeTruthy()
    await closeSocket(socket)
  })

  it('turns away peers outside the allowed range and closes connections that fall outside it later (D-113)', async () => {
    const allowed = new Set(['127.0.0.1', '127.0.0.2'])
    const rejected: string[] = []
    const connected: string[] = []
    const frames: string[] = []
    hub = await startUiHub({
      port: 0,
      onConnect: id => connected.push(id),
      onDisconnect: () => undefined,
      onFrame: (_frame, id) => frames.push(id),
      onInvalidFrame: () => undefined,
      isPeerAllowed: address => allowed.has(address.replace(/^::ffff:/, '')),
      onPeerRejected: (kind, peer) => rejected.push(`${kind} ${peer.replace(/^::ffff:/, '')}`),
    })
    const port = hub.port
    const fromSecond = await new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/`, { localAddress: '127.0.0.2' })
      socket.once('open', () => resolve(socket))
      socket.once('error', reject)
    })
    expect(hub.peerOf(connected[0]!)?.replace(/^::ffff:/, '')).toBe('127.0.0.2')
    const local = await open(port)
    expect(hub.clientCount).toBe(2)

    // 範囲を狭めると、外になった接続だけを 1008 で切る
    allowed.delete('127.0.0.2')
    const closed = new Promise<number>(resolve => fromSecond.once('close', code => resolve(code)))
    expect(hub.closeDisallowed()).toBe(1)
    // 切った後、Close のやり取りが終わるまでに届いたフレームは処理しない
    fromSecond.send(JSON.stringify({ v: 1, type: 'heartbeatAck', t: 1 }))
    await expect(closed).resolves.toBe(1008)
    expect(frames).not.toContain(connected[0])
    expect(hub.clientCount).toBe(1)

    const status = await new Promise<number>(resolve => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/`, { localAddress: '127.0.0.2' })
      socket.once('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0))
      socket.once('error', () => resolve(-1))
    })
    expect(status).toBe(403)
    const http = await import('node:http')
    const httpStatus = await new Promise<number>((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: '/', localAddress: '127.0.0.2' }, response => {
        response.resume()
        resolve(response.statusCode ?? 0)
      }).once('error', reject)
    })
    expect(httpStatus).toBe(403)
    expect(rejected).toEqual(['websocket 127.0.0.2', 'http 127.0.0.2'])
    await closeSocket(local)
  })
})
