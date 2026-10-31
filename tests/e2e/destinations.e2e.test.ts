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
// 選べるのは設定の宛先とこの PC のネットワークの中のアドレスだけ(D-078)なので、127.0.0.1/24 を外部 NIC に見せかける
const TEST_INTERFACES = JSON.stringify([{ name: 'loopback-as-lan', address: '127.0.0.1', netmask: '255.255.255.0', family: 'IPv4', internal: false }])

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
  frame.type === 'osc.message' && frame.address === '/dest/level' && frame.from.host === host && frame.args[0]?.value === value

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
    const bridgeOptions = { configPath, wsPort, oscListenPort, env: { OSCDESK_TEST_LAN_SCAN_FILE: scanFile, OSCDESK_TEST_NETWORK_INTERFACES: TEST_INTERFACES } }

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
    expect(scanned.selection).toEqual({ source: 'config', allDevices: false, networks: [], hosts: ['127.0.0.2'] })

    client.send({ v: 1, type: 'surfaceSave', name: 'destinations', definition: DEFINITION })
    await client.waitForFrame(frame => frame.type === 'surface')

    // 127.0.0.3 だけにチェックを付け替える
    client.send({ v: 1, type: 'destinationsSelect', allDevices: false, networks: [], hosts: ['127.0.0.3'] })
    const selected = await client.waitForFrame(isDestinations(frame => frame.selection.source === 'saved')) as DestinationsFrame
    expect(selected.selection.hosts).toEqual(['127.0.0.3'])
    expect(selected.targets).toEqual([{ name: 'ip-127-0-0-3', host: '127.0.0.3', sendPort: unityPort, primary: true, broadcast: false }])
    await client.waitForFrame(frame => frame.type === 'link'
      && frame.targets.some(target => target.name === 'ip-127-0-0-3' && target.reachability === 'reachable'), 15_000)

    client.send({ v: 1, type: 'osc.message', address: '/dest/level', args: [{ type: 'f', value: 0.875 }] })
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

    // 空の選択・ネットワークの外のアドレス・ブロードキャストアドレスは断られる
    client.send({ v: 1, type: 'destinationsSelect', allDevices: false, networks: [], hosts: [] })
    await client.waitForFrame(frame => frame.type === 'notice' && frame.code === 'destinations-rejected' && frame.detail === 'empty-selection')
    client.send({ v: 1, type: 'destinationsSelect', allDevices: false, networks: [], hosts: ['8.8.8.8'] })
    await client.waitForFrame(frame => frame.type === 'notice' && frame.code === 'destinations-rejected' && frame.detail === 'invalid-host: 8.8.8.8')
    client.send({ v: 1, type: 'destinationsSelect', allDevices: false, networks: [], hosts: ['127.0.0.255'] })
    await client.waitForFrame(frame => frame.type === 'notice' && frame.code === 'destinations-rejected' && frame.detail === 'invalid-host: 127.0.0.255')

    // ブリッジを再起動しても選択は保たれ、外した端末には送らない
    await client.close()
    await bridge.stop()
    bridge = await startBridge(bridgeOptions)
    client = await connectWsE2eClient(`ws://127.0.0.1:${bridge.ready.wsPort}`)
    const hello = await client.waitForFrame(frame => frame.type === 'hello')
    expect(hello).toMatchObject({ targets: [{ name: 'ip-127-0-0-3', host: '127.0.0.3', primary: true }] })
    const restored = await client.waitForFrame(frame => frame.type === 'destinations') as DestinationsFrame
    expect(restored.selection).toEqual({ source: 'saved', allDevices: false, networks: [], hosts: ['127.0.0.3'] })

    client.send({ v: 1, type: 'surfaceLoad', name: 'destinations' })
    await client.waitForFrame(frame => frame.type === 'surface')
    await client.waitForFrame(frame => frame.type === 'link'
      && frame.targets.some(target => target.name === 'ip-127-0-0-3' && target.reachability === 'reachable'), 15_000)
    client.send({ v: 1, type: 'osc.message', address: '/dest/level', args: [{ type: 'f', value: 0.25 }] })
    await client.waitForFrame(echoFrom('127.0.0.3', 0.25))
    expect(await frameWithin(client, echoFrom('127.0.0.2', 0.25), 1_500)).toBeNull()

    // 設定ファイルの宛先に戻すと 127.0.0.2 へ送る
    client.send({ v: 1, type: 'destinationsReset' })
    await client.waitForFrame(isDestinations(frame => frame.selection.source === 'config'))
    await client.waitForFrame(frame => frame.type === 'link'
      && frame.targets.some(target => target.name === 'unity' && target.reachability === 'reachable'), 15_000)
    client.send({ v: 1, type: 'osc.message', address: '/dest/level', args: [{ type: 'f', value: 0.5 }] })
    await client.waitForFrame(echoFrom('127.0.0.2', 0.5))
    expect(fs.existsSync(path.join(workDir, 'destinations.json'))).toBe(false)
  }, 120_000)

  test('names devices by MAC and keeps the names across a bridge restart and an IP change (D-092)', async () => {
    const wsPort = await reserveTcpPort()
    const oscListenPort = await reserveUdpPort()
    const unityPort = await reserveUdpPort()
    const scanFile = path.join(workDir, 'scan.json')
    fs.writeFileSync(scanFile, JSON.stringify([{ host: '127.0.0.5', mac: 'AA-BB-CC-DD-EE-05' }, '127.0.0.6']))
    const configPath = path.join(workDir, 'oscdesk.config.json')
    const aliasesFile = path.join(workDir, 'aliases.json')
    const baseConfig = JSON.parse(fs.readFileSync(path.resolve('config/oscdesk.config.json'), 'utf8')) as Record<string, unknown>
    fs.writeFileSync(configPath, JSON.stringify({
      ...baseConfig,
      unity: { name: 'unity', host: '127.0.0.2', sendPort: unityPort },
      surfaces: { dir: path.join(workDir, 'surfaces') },
      destinations: { file: path.join(workDir, 'destinations.json'), aliasesFile },
    }))
    const bridgeOptions = { configPath, wsPort, oscListenPort, env: { OSCDESK_TEST_LAN_SCAN_FILE: scanFile, OSCDESK_TEST_NETWORK_INTERFACES: TEST_INTERFACES } }
    const aliasOf = (frame: DestinationsFrame, host: string) => frame.devices.find(device => device.host === host)?.alias

    bridge = await startBridge(bridgeOptions)
    client = await connectWsE2eClient(`ws://127.0.0.1:${bridge.ready.wsPort}`)
    await client.waitForFrame(frame => frame.type === 'destinations')
    client.send({ v: 1, type: 'destinationsScan' })
    await client.waitForFrame(isDestinations(frame => !frame.scanning && frame.scannedAt !== null), 15_000)

    // MAC の分かる端末は MAC で、分からない端末は host で覚える
    client.send({ v: 1, type: 'destinationsAlias', host: '127.0.0.5', alias: 'ステージ左 iPad' })
    await client.waitForFrame(isDestinations(frame => aliasOf(frame, '127.0.0.5') === 'ステージ左 iPad'))
    client.send({ v: 1, type: 'destinationsAlias', host: '127.0.0.6', alias: '照明卓' })
    await client.waitForFrame(isDestinations(frame => aliasOf(frame, '127.0.0.6') === '照明卓'))
    // 一覧に無い端末には付けられない
    client.send({ v: 1, type: 'destinationsAlias', host: '127.0.0.99', alias: 'x' })
    await client.waitForFrame(frame => frame.type === 'notice' && frame.code === 'destination-alias-rejected' && frame.detail === 'unknown-host: 127.0.0.99')
    // 上限を超える名前もフレームとしては届き、理由つきで断られる
    client.send({ v: 1, type: 'destinationsAlias', host: '127.0.0.6', alias: 'a'.repeat(65) })
    await client.waitForFrame(frame => frame.type === 'notice' && frame.code === 'destination-alias-rejected' && frame.detail.startsWith('alias-too-long'))
    expect((JSON.parse(fs.readFileSync(aliasesFile, 'utf8')) as { aliases: unknown }).aliases).toEqual([
      { key: 'host:127.0.0.6', alias: '照明卓' },
      { key: 'mac:aa:bb:cc:dd:ee:05', alias: 'ステージ左 iPad', host: '127.0.0.5' },
    ])

    // 再起動後、同じ MAC の端末が別の IP で見つかっても同じ名前が付く
    await client.close()
    await bridge.stop()
    fs.writeFileSync(scanFile, JSON.stringify([{ host: '127.0.0.7', mac: 'aa:bb:cc:dd:ee:05' }, '127.0.0.6']))
    bridge = await startBridge(bridgeOptions)
    client = await connectWsE2eClient(`ws://127.0.0.1:${bridge.ready.wsPort}`)
    await client.waitForFrame(frame => frame.type === 'destinations')
    client.send({ v: 1, type: 'destinationsScan' })
    const rescanned = await client.waitForFrame(isDestinations(frame => !frame.scanning && frame.scannedAt !== null), 15_000) as DestinationsFrame
    expect(aliasOf(rescanned, '127.0.0.7')).toBe('ステージ左 iPad')
    expect(aliasOf(rescanned, '127.0.0.6')).toBe('照明卓')
    expect(rescanned.devices.some(device => device.host === '127.0.0.5')).toBe(false)
  }, 120_000)
})
