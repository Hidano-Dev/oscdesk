import http from 'node:http'

import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'

import { createOscQueryClient } from './oscquery-client'

const servers: { close(): void }[] = []
afterEach(() => {
  for (const server of servers.splice(0)) server.close()
})

async function serve(handler: http.RequestListener): Promise<{ port: number; server: http.Server }> {
  const server = http.createServer(handler)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  servers.push({ close: () => { server.closeAllConnections(); server.close() } })
  const address = server.address()
  if (typeof address !== 'object' || address === null) throw new Error('no address')
  return { port: address.port, server }
}

const signal = () => new AbortController().signal

describe('createOscQueryClient', () => {
  it('reads JSON and asks HOST_INFO with the attribute query', async () => {
    const seen: string[] = []
    const { port } = await serve((request, response) => {
      seen.push(request.url ?? '')
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: request.url }))
    })
    const client = createOscQueryClient()
    expect(await client.read('127.0.0.1', port, 'HOST_INFO', signal())).toEqual({ kind: 'json', value: { ok: '/?HOST_INFO' } })
    expect(await client.read('127.0.0.1', port, null, signal())).toEqual({ kind: 'json', value: { ok: '/' } })
    expect(seen).toEqual(['/?HOST_INFO', '/'])
  })

  it('reports 204 and 400 as unsupported and other statuses as errors', async () => {
    let status = 204
    const { port } = await serve((_request, response) => response.writeHead(status).end())
    const client = createOscQueryClient()
    expect(await client.read('127.0.0.1', port, 'HOST_INFO', signal())).toEqual({ kind: 'unsupported', status: 204 })
    status = 400
    expect(await client.read('127.0.0.1', port, 'HOST_INFO', signal())).toEqual({ kind: 'unsupported', status: 400 })
    status = 302
    await expect(client.read('127.0.0.1', port, null, signal())).rejects.toThrow('HTTP 302')
  })

  it('refuses responses over the size limit, with or without Content-Length', async () => {
    let declare = true
    const { port } = await serve((_request, response) => {
      const body = JSON.stringify({ pad: 'x'.repeat(200) })
      response.writeHead(200, declare ? { 'content-length': String(body.length) } : {})
      response.end(body)
    })
    const client = createOscQueryClient({ maxBytes: 100 })
    await expect(client.read('127.0.0.1', port, null, signal())).rejects.toThrow('larger than 100 bytes')
    declare = false
    await expect(client.read('127.0.0.1', port, null, signal())).rejects.toThrow('larger than 100 bytes')
  })

  it('settles when the connection closes in the middle of a 400, a 204-style or a 200 body', async () => {
    let status = 400
    const { port } = await serve((_request, response) => {
      response.writeHead(status, { 'content-length': '100' })
      response.write('{"partial":')
      setTimeout(() => response.socket?.destroy(), 20)
    })
    const client = createOscQueryClient()
    await expect(client.read('127.0.0.1', port, 'HOST_INFO', signal())).rejects.toThrow()
    status = 200
    await expect(client.read('127.0.0.1', port, null, signal())).rejects.toThrow()
  })

  it('settles on abort while a 400 body is still arriving', async () => {
    const { port } = await serve((_request, response) => {
      response.writeHead(400, { 'content-length': '100' })
      response.write('x')
    })
    const controller = new AbortController()
    const pending = createOscQueryClient().read('127.0.0.1', port, 'HOST_INFO', controller.signal)
    await new Promise(resolve => setTimeout(resolve, 50))
    controller.abort(new Error('timed out after 50 ms'))
    await expect(pending).rejects.toThrow('timed out after 50 ms')
  })

  it('rejects invalid JSON and stops on abort', async () => {
    let hang = false
    const { port } = await serve((_request, response) => {
      if (!hang) response.writeHead(200).end('{nope')
    })
    const client = createOscQueryClient()
    await expect(client.read('127.0.0.1', port, null, signal())).rejects.toThrow('invalid JSON')
    hang = true
    const controller = new AbortController()
    const pending = client.read('127.0.0.1', port, null, controller.signal)
    controller.abort(new Error('timed out after 5 ms'))
    await expect(pending).rejects.toThrow('timed out after 5 ms')
  })

  it('passes PATH_* commands from the WebSocket and reports the close once', async () => {
    const { port, server } = await serve((_request, response) => response.writeHead(404).end())
    const sockets = new WebSocketServer({ server })
    sockets.on('connection', socket => {
      socket.send(JSON.stringify({ COMMAND: 'PATH_ADDED', DATA: '/a' }))
      socket.send(JSON.stringify({ COMMAND: 'IGNORE', DATA: '/a' }))
      socket.send(Buffer.from([1, 2, 3]), { binary: true })
      socket.send('not json')
      socket.send(JSON.stringify({ COMMAND: 'PATH_REMOVED', DATA: '/a' }), () => socket.close())
    })
    const events: string[] = []
    const closes: string[] = []
    await new Promise<void>(resolve => {
      createOscQueryClient().watch('127.0.0.1', port, {
        onPathEvent: command => events.push(command),
        onClose: reason => {
          closes.push(reason)
          resolve()
        },
      })
    })
    sockets.close()
    expect(events).toEqual(['PATH_ADDED', 'PATH_REMOVED'])
    expect(closes).toHaveLength(1)
  })
})
