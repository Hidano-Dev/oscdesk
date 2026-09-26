import path from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { startBridge, type BridgeProcess } from './helpers/bridge'
import { ProcessHarness, type ManagedProcess } from './helpers/process'
import { reserveTcpPort, reserveUdpPort } from './helpers/ports'
import { connectWsE2eClient, type WsE2eClient } from './helpers/ws-client'

describe('apply set E2E', () => {
  const mockHarness = new ProcessHarness()
  let bridge: BridgeProcess | undefined
  let client: WsE2eClient | undefined

  afterEach(async () => {
    await client?.close().catch(() => undefined)
    client = undefined
    await mockHarness.stopAll()
    await bridge?.stop().catch(() => undefined)
    bridge = undefined
  })

  test('delivers an apply bundle, resynchronizes after restart, and reports rejection', async () => {
    const wsPort = await reserveTcpPort()
    const oscListenPort = await reserveUdpPort()
    const unityPort = await reserveUdpPort()

    bridge = await startBridge({
      wsPort,
      oscListenPort,
      unityHost: '127.0.0.1',
      unityPort,
      readyTimeoutMs: 30_000,
    })
    let mock = await startMockUnity(unityPort, bridge.ready.oscListenPort)
    client = await connectWsE2eClient(`ws://127.0.0.1:${bridge.ready.wsPort}`)

    await client.nextFrame()
    await client.nextFrame()
    const initialManifest = await client.waitForFrame((frame) => frame.type === 'manifest')
    expect(initialManifest.type).toBe('manifest')
    if (initialManifest.type !== 'manifest') throw new Error('Expected a manifest frame')
    expect(initialManifest.manifest.entries.find((entry) => entry.address === '/member/01/name'))
      .toMatchObject({ staged: true })
    expect(initialManifest.manifest.entries.find((entry) => entry.address === '/member/01/update'))
      .toMatchObject({ appliesTo: ['/member/01/*'] })

    client.send({
      v: 1,
      type: 'oscBatch',
      messages: [
        { address: '/member/01/name', args: [{ type: 's', value: 'Alicia' }] },
        { address: '/member/01/enabled', args: [{ type: 'i', value: 1 }] },
        { address: '/member/01/update', args: [{ type: 'i', value: 1 }] },
      ],
    })

    expect(await nextEcho('/member/01/name')).toEqual({ v: 1, type: 'osc', address: '/member/01/name', args: [{ type: 's', value: 'Alicia' }], from: expect.any(Object) })
    expect(await nextEcho('/member/01/enabled')).toEqual({ v: 1, type: 'osc', address: '/member/01/enabled', args: [{ type: 'i', value: 1 }], from: expect.any(Object) })
    expect(await nextEcho('/member/01/update')).toEqual({ v: 1, type: 'osc', address: '/member/01/update', args: [{ type: 'i', value: 1 }], from: expect.any(Object) })
    await waitFor(() => mock.stderrSnapshot().includes('MOCK_UNITY_APPLY /member/01/update 2'))
    expect(mock.stderrSnapshot()).toContain('"address":"/member/01/name","value":"Alicia"')
    expect(mock.stderrSnapshot()).toContain('"address":"/member/01/enabled","value":1')

    await mock.stop()
    mock = await startMockUnity(unityPort, bridge.ready.oscListenPort)
    const resyncedManifest = await client.waitForFrame(
      (frame) => frame.type === 'manifest' && frame.adoption.seq === 2,
      15_000,
    )
    expect(resyncedManifest.type).toBe('manifest')
    if (resyncedManifest.type !== 'manifest') throw new Error('Expected a resync manifest frame')
    expect(resyncedManifest.manifest.entries.find((entry) => entry.address === '/member/01/name'))
      .toMatchObject({ default: 'Alice', staged: true })

    client.send({
      v: 1,
      type: 'oscBatch',
      messages: [
        { address: '/sys/ping', args: [] },
        { address: '/member/01/update', args: [{ type: 'i', value: 1 }] },
      ],
    })
    await expect(client.waitForFrame((frame) => frame.type === 'notice' && frame.code === 'batch-rejected'))
      .resolves.toMatchObject({ level: 'error', detail: 'internal-address: /sys/ping' })
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(mock.stderrSnapshot()).not.toContain('MOCK_UNITY_APPLY /member/01/update 2')
  })

  async function startMockUnity(listenPort: number, replyPort: number): Promise<ManagedProcess> {
    return mockHarness.start({
      command: process.execPath,
      args: [
        path.resolve('packages/mock-unity/dist/mock-unity.js'),
        '--listen-port', String(listenPort),
        '--reply-host', '127.0.0.1',
        '--reply-port', String(replyPort),
        '--scenario', path.resolve('packages/mock-unity/scenarios/staging.json'),
      ],
      readyPattern: /^MOCK_UNITY_READY /m,
      readyTimeoutMs: 10_000,
    })
  }

  async function nextEcho(address: string): Promise<Extract<Awaited<ReturnType<WsE2eClient['nextFrame']>>, { type: 'osc' }>> {
    const frame = await client!.waitForFrame((candidate) => candidate.type === 'osc' && candidate.address === address)
    if (frame.type !== 'osc') throw new Error(`Expected OSC echo for ${address}`)
    return frame
  }

  async function waitFor(predicate: () => boolean): Promise<void> {
    const deadline = Date.now() + 5_000
    while (!predicate()) {
      if (Date.now() >= deadline) throw new Error('Timed out waiting for mock stderr output')
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
})
