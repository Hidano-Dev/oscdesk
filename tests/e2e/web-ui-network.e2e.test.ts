// SPA のブラウザの接続をブリッジだけが判定すること(D-113・D-153)。SPA はブリッジへ直接つなぐので、許可と締め出しは
// その接続の送信元で決まり、ページの HTTP(/)も WebSocket も同じ許可リストで断られる。この PC の localhost(127.0.0.1)は
// 常に許可されるので、「別の PC のブラウザ」は送信元を 127.0.0.2・127.0.0.3 にした接続で作る(network-settings.e2e と同じ)
import http from 'node:http'

import { afterEach, describe, expect, test } from 'vitest'

import type { DownstreamFrame } from '../../packages/shared/src'
import { connectWsE2eClient, startBridge, type BridgeProcess, type WsE2eClient } from './helpers'

const BROWSER_A = '127.0.0.2'
const BROWSER_B = '127.0.0.3'

type NetworkSettingsFrame = Extract<DownstreamFrame, { type: 'networkSettings' }>

function getPage(port: number, localAddress?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/', localAddress }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.once('error', reject)
    req.end()
  })
}

describe('SPA browsers are judged by the bridge alone (D-153)', () => {
  let bridge: BridgeProcess | undefined
  const clients: WsE2eClient[] = []

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close().catch(() => undefined)))
    await bridge?.stop().catch(() => undefined)
    bridge = undefined
  })

  // ブリッジが配ったページ(Origin が Host と同じ)からの接続として、指定した送信元でつなぐ
  const connectAsSpa = async (localAddress?: string) => {
    const port = bridge!.ready.wsPort
    const client = await connectWsE2eClient(`ws://127.0.0.1:${port}/`, { origin: `http://127.0.0.1:${port}`, ...(localAddress === undefined ? {} : { localAddress }) })
    clients.push(client)
    return client
  }

  test('tells the SPA its own address, locks out nobody by its word, and turns away browsers outside the range on HTTP and WebSocket', async () => {
    bridge = await startBridge({ unityHost: '127.0.0.1' })
    const port = bridge.ready.wsPort

    // 既定(すべて許可)では、別の PC のブラウザもページを開いてつなげる。hello にブリッジから見た送信元が載る
    expect((await getPage(port, BROWSER_A)).status).toBe(200)
    const a = await connectAsSpa(BROWSER_A)
    await expect(a.waitForFrame((frame) => frame.type === 'hello')).resolves.toMatchObject({ peer: BROWSER_A })
    await a.waitForFrame((frame) => frame.type === 'networkSettings')

    // SPA は browser を名乗らない。ブリッジは接続の送信元(このブラウザ)で締め出しを判定する
    a.send({ v: 1, type: 'networkSettingsSet', revision: 0, targetInterface: null, targetRanges: [], allowedBrowsers: ['127.0.0.1/32'] })
    await expect(a.waitForFrame((frame) => frame.type === 'notice' && frame.code === 'network-settings-rejected'))
      .resolves.toMatchObject({ detail: `would-lock-out: ${BROWSER_A}` })

    // 自分を入れた許可リストは通る。範囲の外になった B は、ページも WebSocket も 403 で断られる
    a.send({ v: 1, type: 'networkSettingsSet', revision: 0, targetInterface: null, targetRanges: [], allowedBrowsers: [`${BROWSER_A}/32`] })
    await a.waitForFrame((frame) => frame.type === 'networkSettings' && (frame as NetworkSettingsFrame).revision === 1)
    // 通ったことは要求元にだけ知らせる(ほかのブラウザの変更で版が進んだのと見分けるため)
    await expect(a.waitForFrame((frame) => frame.type === 'notice' && frame.code === 'network-settings-applied'))
      .resolves.toMatchObject({ level: 'info', detail: 'revision: 1' })
    const refused = await getPage(port, BROWSER_B)
    expect(refused.status).toBe(403)
    expect(refused.body).toContain(`このブラウザ(接続元 ${BROWSER_B})`)
    await expect(connectAsSpa(BROWSER_B)).rejects.toThrow(/403/)
    expect((await getPage(port, BROWSER_A)).status).toBe(200)

    // サーバー PC の localhost からは常に開けて、許可リストを localhost だけにできる。A の接続は切られ、ページも開けなくなる
    expect((await getPage(port)).status).toBe(200)
    const local = await connectAsSpa()
    await expect(local.waitForFrame((frame) => frame.type === 'hello')).resolves.toMatchObject({ peer: '127.0.0.1' })
    local.send({ v: 1, type: 'networkSettingsSet', revision: 1, targetInterface: null, targetRanges: [], allowedBrowsers: [] })
    await local.waitForFrame((frame) => frame.type === 'networkSettings' && (frame as NetworkSettingsFrame).revision === 2)
    await local.waitForFrame((frame) => frame.type === 'notice' && frame.code === 'network-settings-applied')
    await waitUntil(() => !a.isOpen)
    expect((await getPage(port, BROWSER_A)).status).toBe(403)
    await expect(connectAsSpa(BROWSER_A)).rejects.toThrow(/403/)
    expect(local.isOpen).toBe(true)
  })
})

async function waitUntil(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the condition.')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}
