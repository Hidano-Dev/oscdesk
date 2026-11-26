// 試作の SPA(HID-461)をブリッジが配る経路。--spa-prototype を渡したときだけ /spa/ を配り、ブリッジ自身が配ったページ
// (Origin が Host と同じで名前が IP の直書き)からの WebSocket だけを受ける。渡さなければ既定どおり(D-082)
import path from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'
import { WebSocket } from 'ws'

import { DownstreamFrameSchema } from '../../packages/shared/src'
import { startBridge, type BridgeProcess } from './helpers'

const SPA_DIST = path.resolve('packages/spa-prototype/dist')

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

describe('SPA prototype served by the bridge (HID-461)', () => {
  let bridge: BridgeProcess | undefined

  afterEach(async () => {
    await bridge?.stop().catch(() => undefined)
    bridge = undefined
  })

  test('is not served and browser origins stay rejected without the flag', async () => {
    bridge = await startBridge({ unityHost: '127.0.0.1' })
    const port = bridge.ready.wsPort
    expect((await fetch(`http://127.0.0.1:${port}/spa/`)).status).toBe(404)
    expect(await handshake(`ws://127.0.0.1:${port}/`, { Origin: `http://127.0.0.1:${port}` })).toEqual({ status: 403 })
  })

  test('serves the built page and accepts only the same IP-literal origin', async () => {
    bridge = await startBridge({ unityHost: '127.0.0.1', extraArgs: ['--spa-prototype', SPA_DIST] })
    const port = bridge.ready.wsPort
    const base = `http://127.0.0.1:${port}`

    const page = await fetch(`${base}/spa/`)
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toMatch(/^text\/html/)
    expect(await page.text()).toContain('<script type="module" src="app.js">')
    const script = await fetch(`${base}/spa/app.js`)
    expect(script.status).toBe(200)
    expect(script.headers.get('content-type')).toMatch(/^text\/javascript/)
    // 決まったファイルだけを配る(dist の外は読ませない)
    expect((await fetch(`${base}/spa/..%2F..%2Fpackage.json`)).status).toBe(404)
    expect((await fetch(`${base}/spa/build.mjs`)).status).toBe(404)

    // ブリッジ自身が配ったページ: 下りのフレームは shared のスキーマどおり
    const accepted = await handshake(`ws://127.0.0.1:${port}/`, { Origin: base })
    expect('frames' in accepted).toBe(true)
    const frames = 'frames' in accepted ? accepted.frames.map((raw) => DownstreamFrameSchema.parse(JSON.parse(raw))) : []
    expect(frames[0]?.type).toBe('hello')
    expect(frames.some((frame) => frame.type === 'destinations')).toBe(true)

    // 第三者のページ・別のポートのページ・DNS の再束縛(名前が IP の直書きでない)は断る
    expect(await handshake(`ws://127.0.0.1:${port}/`, { Origin: 'http://evil.example' })).toEqual({ status: 403 })
    expect(await handshake(`ws://127.0.0.1:${port}/`, { Origin: `http://127.0.0.1:${port + 1}` })).toEqual({ status: 403 })
    expect(await handshake(`ws://127.0.0.1:${port}/`, { Origin: `http://evil.example:${port}`, Host: `evil.example:${port}` })).toEqual({ status: 403 })
  })
})
