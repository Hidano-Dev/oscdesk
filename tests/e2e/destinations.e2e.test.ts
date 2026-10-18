import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import type { DownstreamFrame } from '../../packages/shared/src'

import { startBridge, type BridgeProcess } from './helpers/bridge'
import { reserveTcpPort, reserveUdpPort } from './helpers/ports'
import { ProcessHarness } from './helpers/process'
import { frameWithin } from './helpers/stack'
import { connectWsE2eClient, type WsE2eClient } from './helpers/ws-client'

// 宛先タブ(D-078)。同じ PC に「別の IP の Unity」を 2 台立てる(mock-unity を 127.0.0.2 と 127.0.0.3 に待ち受けさせる)。
// 走査は OSCDESK_TEST_LAN_SCAN_FILE のファイルの中身を結果として返させ、実ネットワークに依存させない。

const DEFINITION = {
  format: 'oscdesk-surface',
  version: 1,
  name: 'Destinations',
  parameters: [
    { id: 'level', address: '/dest/level', label: 'Level', type: 'f', kind: 'state', range: [0, 1], default: 0.5 },
  ],
  screens: [{ id: 'main', label: 'Main', children: [{ kind: 'control', param: 'level', widget: 'slider' }] }],
}

type DestinationsFrame = Extract<DownstreamFrame, { type: 'destinations' }>
const isDestinations = (predicate: (frame: DestinationsFrame) => boolean) => (frame: DownstreamFrame) =>
  frame.type === 'destinations' && predicate(frame)
const echoFrom = (host: string, value: number) => (frame: DownstreamFrame) =>
  frame.type === 'osc' && frame.address === '/dest/level' && frame.from.host === host && frame.args[0]?.value === value

describe('destinations tab (D-078)', () => {
  let workDir: string
  let bridge: BridgeProcess | undefined
  let client: WsE2eClient | undefined
  const mocks = new ProcessHarness()

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-e2e-destinations-'))
  })

  afterEach(async () => {
    await client?.close().catch(() => undefined)
    await mocks.stopAll().catch(() => undefined)
    await bridge?.stop().catch(() => undefined)
    client = undefined
    bridge = undefined
    fs.rmSync(workDir, { recursive: true, force: true })
  })

  test('sends only to the checked device, reflects rescans, and keeps the selection across a bridge restart', async () => {
    const wsPort = await reserveTcpPort()
    const oscListenPort = await reserveUdpPort()
    const unityPort = await reserveUdpPort()
    const scanFile = path.join(workDir, 'scan.json')
    fs.writeFileSync(scanFile, JSON.stringify(['127.0.0.2', '127.0.0.3']))
    const configPath = path.join(workDir, 'oscdesk.config.json')
    const baseConfig = JSON.parse(fs.readFileSync(path.resolve('config/oscdesk.config.json'), 'utf8')) as Record<string, unknown>
    fs.writeFileSync(configPath, JSON.stringify({
      ...baseConfig,
      unity: { name: 'unity', host: '127.0.0.2', sendPort: unityPort },
      surfaces: { dir: path.join(workDir, 'surfaces') },
      destinations: { file: path.join(workDir, 'destinations.json') },
    }))
    const bridgeOptions = { configPath, wsPort, oscListenPort, env: { OSCDESK_TEST_LAN_SCAN_FILE: scanFile } }

    bridge = await startBridge(bridgeOptions)
    for (const host of ['127.0.0.2', '127.0.0.3']) {
      await mocks.start({
        command: process.execPath,
        args: [
          path.resolve('packages/mock-unity/dist/mock-unity.js'),
          '--listen-host', host,
          '--listen-port', String(unityPort),
          '--reply-host', '127.0.0.1',
          '--reply-port', String(bridge.ready.oscListenPort),
        ],
        readyPattern: /^MOCK_UNITY_READY /m,
        readyTimeoutMs: 10_000,
      })
    }
    client = await connectWsE2eClient(`ws://127.0.0.1:${bridge.ready.wsPort}`)

    // ブリッジは起動時に走査しない(UI が未走査を見て頼む)。未保存の間は設定ファイルの宛先が選ばれている
    const initial = await client.waitForFrame(frame => frame.type === 'destinations') as DestinationsFrame
    expect(initial).toMatchObject({ scanning: false, scannedAt: null })
    client.send({ v: 1, type: 'destinationsScan' })
    const scanned = await client.waitForFrame(isDestinations(frame => !frame.scanning && frame.scannedAt !== null), 15_000) as DestinationsFrame
    expect(scanned.devices.filter(device => device.found).map(device => device.host)).toEqual(expect.arrayContaining(['127.0.0.2', '127.0.0.3']))
    expect(scanned.selection).toEqual({ source: 'config', allDevices: false, hosts: ['127.0.0.2'] })

    client.send({ v: 1, type: 'surfaceSave', name: 'destinations', definition: DEFINITION })
    await client.waitForFrame(frame => frame.type === 'surface')

    // 127.0.0.3 だけにチェックを付け替える
    client.send({ v: 1, type: 'destinationsSelect', allDevices: false, hosts: ['127.0.0.3'] })
    const selected = await client.waitForFrame(isDestinations(frame => frame.selection.source === 'saved')) as DestinationsFrame
    expect(selected.selection.hosts).toEqual(['127.0.0.3'])
    expect(selected.targets).toEqual([{ name: 'ip-127-0-0-3', host: '127.0.0.3', sendPort: unityPort, primary: true, broadcast: false }])
    await client.waitForFrame(frame => frame.type === 'link'
      && frame.targets.some(target => target.name === 'ip-127-0-0-3' && target.reachability === 'reachable'), 15_000)

    client.send({ v: 1, type: 'osc', address: '/dest/level', args: [{ type: 'f', value: 0.875 }] })
    await client.waitForFrame(echoFrom('127.0.0.3', 0.875))
    // 外した端末には届かない(届いていればそのエコーが 127.0.0.2 から返る)
    expect(await frameWithin(client, echoFrom('127.0.0.2', 0.875), 1_500)).toBeNull()

    // 更新ボタン: 端末の増減が一覧に反映される(設定の宛先は見つからなくても残る)
    fs.writeFileSync(scanFile, JSON.stringify(['127.0.0.3', '127.0.0.4']))
    client.send({ v: 1, type: 'destinationsScan' })
    await client.waitForFrame(isDestinations(frame => frame.scanning))
    const rescanned = await client.waitForFrame(isDestinations(frame => !frame.scanning
      && frame.devices.some(device => device.host === '127.0.0.4')), 15_000) as DestinationsFrame
    expect(rescanned.devices.find(device => device.host === '127.0.0.2')).toMatchObject({ configured: true, found: false })
    expect(rescanned.devices.find(device => device.host === '127.0.0.3')).toMatchObject({ found: true })

    // 空の選択は断られる
    client.send({ v: 1, type: 'destinationsSelect', allDevices: false, hosts: [] })
    await client.waitForFrame(frame => frame.type === 'notice' && frame.code === 'destinations-rejected' && frame.detail === 'empty-selection')

    // ブリッジを再起動しても選択は保たれ、外した端末には送らない
    await client.close()
    await bridge.stop()
    bridge = await startBridge(bridgeOptions)
    client = await connectWsE2eClient(`ws://127.0.0.1:${bridge.ready.wsPort}`)
    const hello = await client.waitForFrame(frame => frame.type === 'hello')
    expect(hello).toMatchObject({ targets: [{ name: 'ip-127-0-0-3', host: '127.0.0.3', primary: true }] })
    const restored = await client.waitForFrame(frame => frame.type === 'destinations') as DestinationsFrame
    expect(restored.selection).toEqual({ source: 'saved', allDevices: false, hosts: ['127.0.0.3'] })

    client.send({ v: 1, type: 'surfaceLoad', name: 'destinations' })
    await client.waitForFrame(frame => frame.type === 'surface')
    await client.waitForFrame(frame => frame.type === 'link'
      && frame.targets.some(target => target.name === 'ip-127-0-0-3' && target.reachability === 'reachable'), 15_000)
    client.send({ v: 1, type: 'osc', address: '/dest/level', args: [{ type: 'f', value: 0.25 }] })
    await client.waitForFrame(echoFrom('127.0.0.3', 0.25))
    expect(await frameWithin(client, echoFrom('127.0.0.2', 0.25), 1_500)).toBeNull()

    // 設定ファイルの宛先に戻すと 127.0.0.2 へ送る
    client.send({ v: 1, type: 'destinationsReset' })
    await client.waitForFrame(isDestinations(frame => frame.selection.source === 'config'))
    await client.waitForFrame(frame => frame.type === 'link'
      && frame.targets.some(target => target.name === 'unity' && target.reachability === 'reachable'), 15_000)
    client.send({ v: 1, type: 'osc', address: '/dest/level', args: [{ type: 'f', value: 0.5 }] })
    await client.waitForFrame(echoFrom('127.0.0.2', 0.5))
    expect(fs.existsSync(path.join(workDir, 'destinations.json'))).toBe(false)
  }, 120_000)
})
