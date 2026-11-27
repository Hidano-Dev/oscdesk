// ブリッジが既定の設定で SPA(packages/web-ui/dist)を HTTP の / に配る経路と、ブラウザからの接続の判定(D-138)。
// - 決まった名前のファイルだけを、gzip を受けるブラウザには gzip で配る
// - Host が IP の直書きかこの PC の名前でなければ(DNS の再束縛)、HTTP 全体(既存の /surfaces を含む)と WebSocket を 403 で断る
// - Origin 付きの WebSocket・状態を変える HTTP は、ブリッジ自身が配ったページ(Origin が Host と同じ)からのものだけを受ける
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

import { afterEach, describe, expect, test } from 'vitest'
import { WebSocket } from 'ws'

import { DownstreamFrameSchema } from '../../packages/shared/src'
import { reserveTcpPort, reserveUdpPort, startBridge, type BridgeProcess } from './helpers'

interface RawResponse { status: number; headers: http.IncomingHttpHeaders; body: Buffer }

/** fetch は Host を書き換えられないので、node:http で送る。 */
function request(port: number, options: { path: string; method?: string; headers?: Record<string, string>; body?: string }): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: options.path, method: options.method ?? 'GET', headers: options.headers }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }))
    })
    req.once('error', reject)
    req.end(options.body)
  })
}

function handshake(url: string, headers: Record<string, string>): Promise<{ status: number } | { frames: string[] }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers })
    const frames: string[] = []
    socket.once('unexpected-response', (_request, response) => resolve({ status: response.statusCode ?? 0 }))
    socket.on('message', (data) => {
      frames.push(String(data))
      // hello の後に destinations まで届けば十分
      if (frames.some((frame) => frame.includes('"type":"destinations"'))) {
        socket.close()
        resolve({ frames })
      }
    })
    socket.once('error', (error) => frames.length === 0 ? undefined : reject(error))
  })
}

describe('web UI served by the bridge (D-138)', () => {
  let bridge: BridgeProcess | undefined

  afterEach(async () => {
    await bridge?.stop().catch(() => undefined)
    bridge = undefined
  })

  test('serves the built SPA at / by default, gzipped, and only its fixed files', async () => {
    bridge = await startBridge({ unityHost: '127.0.0.1' })
    const port = bridge.ready.wsPort
    expect(bridge.ready.webUiPath).toBe('/')

    const page = await request(port, { path: '/' })
    expect(page.status).toBe(200)
    expect(page.headers['content-type']).toMatch(/^text\/html/)
    expect(page.headers['x-frame-options']).toBe('DENY')
    expect(page.body.toString('utf8')).toContain('<script type="module" src="app.js">')

    const script = await request(port, { path: '/app.js', headers: { 'Accept-Encoding': 'gzip, deflate' } })
    expect(script.status).toBe(200)
    expect(script.headers['content-type']).toMatch(/^text\/javascript/)
    expect(script.headers['content-encoding']).toBe('gzip')
    const plain = zlib.gunzipSync(script.body)
    expect(plain.length).toBeGreaterThan(script.body.length)
    // 中身が同じなら 304 で済む
    const again = await request(port, { path: '/app.js', headers: { 'If-None-Match': String(script.headers.etag) } })
    expect(again.status).toBe(304)
    expect((await request(port, { path: '/app.css' })).headers['content-type']).toMatch(/^text\/css/)

    // 決まったファイルだけを配る(dist の外は読ませない)
    expect((await request(port, { path: '/..%2F..%2Fpackage.json' })).status).toBe(404)
    expect((await request(port, { path: '/build.mjs' })).status).toBe(404)
    expect((await request(port, { path: '/app.js', method: 'POST' })).status).toBe(405)
  })

  test('rejects an unexpected Host (DNS rebinding) on the whole HTTP and on the WebSocket', async () => {
    bridge = await startBridge({ unityHost: '127.0.0.1' })
    const port = bridge.ready.wsPort

    for (const path of ['/', '/surfaces']) {
      const rebound = await request(port, { path, headers: { Host: `evil.example:${port}` } })
      expect(rebound.status, path).toBe(403)
      expect(rebound.body.toString('utf8')).toContain('この名前(evil.example')
    }
    expect((await request(port, { path: '/surfaces', headers: { Host: `127.0.0.1:${port}` } })).status).toBe(200)
    expect((await request(port, { path: '/surfaces', headers: { Host: `${os.hostname()}:${port}` } })).status).toBe(200)
    expect((await request(port, { path: '/surfaces', headers: { Host: `localhost:${port}` } })).status).toBe(200)

    expect(await handshake(`ws://127.0.0.1:${port}/`, { Host: `evil.example:${port}` })).toEqual({ status: 403 })
    expect(await handshake(`ws://127.0.0.1:${port}/`, { Origin: `http://evil.example:${port}`, Host: `evil.example:${port}` })).toEqual({ status: 403 })
  })

  test('accepts the page the bridge served itself and rejects third-party pages', async () => {
    bridge = await startBridge({ unityHost: '127.0.0.1' })
    const port = bridge.ready.wsPort
    const base = `http://127.0.0.1:${port}`

    // ブリッジ自身が配ったページ: 下りのフレームは shared のスキーマどおり
    const accepted = await handshake(`ws://127.0.0.1:${port}/`, { Origin: base })
    expect('frames' in accepted).toBe(true)
    const frames = 'frames' in accepted ? accepted.frames.map((raw) => DownstreamFrameSchema.parse(JSON.parse(raw))) : []
    expect(frames[0]?.type).toBe('hello')
    expect(frames.some((frame) => frame.type === 'destinations')).toBe(true)

    // 第三者のページ・別のポートのページは断る
    expect(await handshake(`ws://127.0.0.1:${port}/`, { Origin: 'http://evil.example' })).toEqual({ status: 403 })
    expect(await handshake(`ws://127.0.0.1:${port}/`, { Origin: `http://127.0.0.1:${port + 1}` })).toEqual({ status: 403 })

    // 状態を変える HTTP も同じ: 同じオリジンのページは本文の検証まで届き(400)、第三者のページは 403 で案内を返す
    const put = (headers: Record<string, string>) => request(port, { path: '/surfaces/same-origin-probe.json', method: 'PUT', headers, body: 'not json' })
    expect((await put({ Origin: base, 'Sec-Fetch-Site': 'same-origin' })).status).toBe(400)
    const thirdParty = await put({ Origin: 'http://evil.example' })
    expect(thirdParty.status).toBe(403)
    expect(thirdParty.body.toString('utf8')).toContain('ほかのサイトのページからの操作は受け付けません')
    expect((await put({ Origin: base, 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403)
  })

  test('does not serve the SPA when webUi.enabled is false', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-web-ui-off-'))
    const configPath = path.join(dir, 'oscdesk.config.json')
    fs.writeFileSync(configPath, JSON.stringify({
      unity: { host: '127.0.0.1', sendPort: await reserveUdpPort() },
      bridge: { oscListenPort: await reserveUdpPort(), wsPort: await reserveTcpPort() },
      debug: false,
      boolFallbackToInt: false,
      webUi: { enabled: false },
    }))
    bridge = await startBridge({ configPath })
    expect(bridge.ready.webUiPath).toBeNull()
    expect((await request(bridge.ready.wsPort, { path: '/' })).status).toBe(404)
    await bridge.stop()
    bridge = undefined
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
