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
// 選べるのは設定の宛先とこの PC のネットワークの中のアドレスだけ(D-078)なので、127.0.0.1/24 を外部 NIC に見せかける。
// LAN の走査は撤去した(D-172)ので、一覧はこの PC・設定の宛先・選んだホスト(と OSCQuery のターゲット)だけになる
const OWN_MAC = 'aa:bb:cc:dd:ee:01'
const interfacesAt = (address: string) =>
  JSON.stringify([{ name: 'loopback-as-lan', address, netmask: '255.255.255.0', family: 'IPv4', internal: false, mac: OWN_MAC }])

type DestinationsFrame = Extract<DownstreamFrame, { type: 'destinations' }>
const isDestinations = (predicate: (frame: DestinationsFrame) => boolean) => (frame: DownstreamFrame) =>
  frame.type === 'destinations' && predicate(frame)
const echoFrom = (host: string, value: number) => (frame: DownstreamFrame) =>
  frame.type === 'osc.message' && frame.address === '/dest/level' && frame.from.host === host
  && frame.args[0]?.type === 'f' && frame.args[0].value === value

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

  const writeConfig = (unityPort: number, destinations: Record<string, unknown>) => {
    const configPath = path.join(workDir, 'oscdesk.config.json')
    const baseConfig = JSON.parse(fs.readFileSync(path.resolve('config/oscdesk.config.json'), 'utf8')) as Record<string, unknown>
    fs.writeFileSync(configPath, JSON.stringify({
      ...baseConfig,
      unity: { name: 'unity', host: '127.0.0.2', sendPort: unityPort },
      surfaces: { dir: path.join(workDir, 'surfaces') },
      destinations,
    }))
    return configPath
  }

  test('sends only to the checked device and keeps the selection across a bridge restart', async () => {
    const wsPort = await reserveTcpPort()
    const oscListenPort = await reserveUdpPort()
    const unityPort = await reserveUdpPort()
    const configPath = writeConfig(unityPort, { file: path.join(workDir, 'destinations.json') })
    const bridgeOptions = { configPath, wsPort, oscListenPort, env: { OSCDESK_TEST_NETWORK_INTERFACES: interfacesAt('127.0.0.1') } }

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

    // 未保存の間は設定ファイルの宛先が選ばれている。一覧はこの PC と設定の宛先だけ(走査の欄は無い)
    const initial = await client.waitForFrame(frame => frame.type === 'destinations') as DestinationsFrame
    expect(initial).not.toHaveProperty('scanning')
    expect(initial).not.toHaveProperty('scannedAt')
    expect(initial.selection).toEqual({ source: 'config', allDevices: false, networks: [], hosts: ['127.0.0.2'] })
    expect(initial.devices.map(device => [device.host, device.self, device.configured])).toEqual([
      ['127.0.0.1', true, false],
      ['127.0.0.2', false, true],
    ])

    // 撤去した走査の要求はフレームごと捨て、接続は保つ
    client.sendRaw(JSON.stringify({ v: 1, type: 'destinationsScan' }))
    await client.waitForFrame(frame => frame.type === 'notice' && frame.code === 'invalid-frame')

    // 127.0.0.3 だけにチェックを付け替える(一覧に無くてもこの PC のネットワークの中なら選べ、選ぶと一覧に並ぶ)
    client.send({ v: 1, type: 'destinationsSelect', allDevices: false, networks: [], hosts: ['127.0.0.3'] })
    const selected = await client.waitForFrame(isDestinations(frame => frame.selection.source === 'saved')) as DestinationsFrame
    expect(selected.selection.hosts).toEqual(['127.0.0.3'])
    expect(selected.devices.some(device => device.host === '127.0.0.3')).toBe(true)
    expect(selected.targets).toEqual([{ name: 'ip-127-0-0-3', host: '127.0.0.3', sendPort: unityPort, primary: true, broadcast: false }])
    await client.waitForFrame(frame => frame.type === 'link'
      && frame.targets.some(target => target.name === 'ip-127-0-0-3' && target.reachability === 'reachable'), 15_000)

    client.send({ v: 1, type: 'osc.message', address: '/dest/level', args: [{ type: 'f', value: 0.875 }] })
    await client.waitForFrame(echoFrom('127.0.0.3', 0.875))
    // 外した端末には届かない(届いていればそのエコーが 127.0.0.2 から返る)
    expect(await frameWithin(client, echoFrom('127.0.0.2', 0.875), 1_500)).toBeNull()

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

  test('names devices (this PC by its MAC, others by host) and keeps the names across a bridge restart and an IP change (D-092)', async () => {
    const wsPort = await reserveTcpPort()
    const oscListenPort = await reserveUdpPort()
    const unityPort = await reserveUdpPort()
    const aliasesFile = path.join(workDir, 'aliases.json')
    const configPath = writeConfig(unityPort, { file: path.join(workDir, 'destinations.json'), aliasesFile })
    const aliasOf = (frame: DestinationsFrame, host: string) => frame.devices.find(device => device.host === host)?.alias

    bridge = await startBridge({ configPath, wsPort, oscListenPort, env: { OSCDESK_TEST_NETWORK_INTERFACES: interfacesAt('127.0.0.1') } })
    client = await connectWsE2eClient(`ws://127.0.0.1:${bridge.ready.wsPort}`)
    await client.waitForFrame(frame => frame.type === 'destinations')
    // 一覧に並べるため、別名を付ける端末を選んでおく
    client.send({ v: 1, type: 'destinationsSelect', allDevices: false, networks: [], hosts: ['127.0.0.6'] })
    await client.waitForFrame(isDestinations(frame => frame.selection.source === 'saved'))

    // MAC の分かる端末(この PC の NIC)は MAC で、分からない端末は host で覚える
    client.send({ v: 1, type: 'destinationsAlias', host: '127.0.0.1', alias: 'ブリッジ PC' })
    await client.waitForFrame(isDestinations(frame => aliasOf(frame, '127.0.0.1') === 'ブリッジ PC'))
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
      { key: `mac:${OWN_MAC}`, alias: 'ブリッジ PC', host: '127.0.0.1' },
    ])

    // 再起動後、この PC のアドレスが変わっても同じ MAC なら同じ名前が付く
    await client.close()
    await bridge.stop()
    bridge = await startBridge({ configPath, wsPort, oscListenPort, env: { OSCDESK_TEST_NETWORK_INTERFACES: interfacesAt('127.0.0.9') } })
    client = await connectWsE2eClient(`ws://127.0.0.1:${bridge.ready.wsPort}`)
    const restarted = await client.waitForFrame(frame => frame.type === 'destinations') as DestinationsFrame
    expect(aliasOf(restarted, '127.0.0.9')).toBe('ブリッジ PC')
    expect(aliasOf(restarted, '127.0.0.6')).toBe('照明卓')
    expect(restarted.devices.find(device => device.host === '127.0.0.1')).toBeUndefined()
  }, 120_000)
})
