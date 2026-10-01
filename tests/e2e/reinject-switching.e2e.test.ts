import { afterEach, describe, expect, test } from 'vitest'

import {
  addressesOf,
  frameWithin,
  startReinjectStack,
  trigger,
  waitForManifest,
  type ReinjectStack,
} from './helpers/reinject-stack'
import { createOscTestClient } from './helpers/osc-client'

// ブリッジの既定: stats の照合は 4 秒間隔、tick(ping・要求)は 2 秒間隔。
// 取りこぼしからの回復は「次の照合 + tick の粒度」で決まるので、余裕を見て 12 秒を上限にする。
const RECOVERY_BUDGET_MS = 12_000

describe('runtime manifest reinjection E2E: switching, loss recovery, restart, legacy origin', () => {
  let stack: ReinjectStack | undefined

  afterEach(async () => {
    await stack?.stop()
    stack = undefined
  })

  test('trigger-driven row removal and addition arrive as new adoptions of the same boot', async () => {
    stack = await startReinjectStack({ scenario: 'runtime-switch' })
    const { client } = stack

    const initial = await waitForManifest(client)
    expect(initial.manifest.structureGeneration).toBe(1)
    expect(initial.manifest.bootId).toMatch(/^[0-9a-f]{32}$/)
    expect(addressesOf(initial.manifest)).toContain('/dev/row/b/value')

    trigger(client, '/dev/switch/remove-middle')
    const removed = await waitForManifest(client, (frame) => frame.adoption.seq > initial.adoption.seq)
    expect(removed.adoption.seq).toBe(initial.adoption.seq + 1)
    expect(removed.manifest.bootId).toBe(initial.manifest.bootId)
    expect(removed.manifest.structureGeneration).toBe(2)
    expect(addressesOf(removed.manifest)).not.toContain('/dev/row/b/value')
    expect(addressesOf(removed.manifest)).toEqual(expect.arrayContaining(['/dev/row/a/value', '/dev/row/c/value']))

    trigger(client, '/dev/switch/add-row')
    const added = await waitForManifest(client, (frame) => frame.adoption.seq > removed.adoption.seq)
    expect(added.adoption.seq).toBe(removed.adoption.seq + 1)
    expect(added.manifest.structureGeneration).toBe(3)
    expect(addressesOf(added.manifest)).toEqual(
      expect.arrayContaining(['/dev/row/a/value', '/dev/row/b/value', '/dev/row/c/value', '/dev/row/d/value']),
    )

    // 世代が進んだ後に同じ内容が再送されても、新しい採用にはならない。
    await frameWithin(client, () => false, 100)
    expect(await frameWithin(client, (frame) => frame.type === 'manifest', 1_500)).toBeNull()
  })

  test('recovers the new rows within the stats/request interval when the switch manifest is dropped', async () => {
    stack = await startReinjectStack({ scenario: 'runtime-switch', mockArgs: ['--fault', 'drop-reinject-manifest'] })
    const { client } = stack

    const initial = await waitForManifest(client)
    expect(addressesOf(initial.manifest)).toContain('/dev/row/b/value')

    const startedAt = Date.now()
    trigger(client, '/dev/switch/add-row')
    // 切り替えのマニフェストは落ちる。値のエコーだけが届き、すぐには採用されない。
    await client.waitForFrame((frame) => frame.type === 'osc' && frame.address === '/dev/switch/add-row')
    expect(await frameWithin(client, (frame) => frame.type === 'manifest', 800)).toBeNull()

    const recovered = await waitForManifest(client, (frame) => frame.adoption.seq > initial.adoption.seq, RECOVERY_BUDGET_MS)
    expect(Date.now() - startedAt).toBeLessThan(RECOVERY_BUDGET_MS)
    expect(recovered.manifest.bootId).toBe(initial.manifest.bootId)
    expect(recovered.manifest.structureGeneration).toBe(2)
    expect(addressesOf(recovered.manifest)).toContain('/dev/row/d/value')
  })

  test('adopts the manifest of a restarted mock (new bootId) without passing through unreachable', async () => {
    stack = await startReinjectStack({ scenario: 'runtime-switch' })
    const { client } = stack

    const initial = await waitForManifest(client)
    trigger(client, '/dev/switch/remove-middle')
    const switched = await waitForManifest(client, (frame) => frame.adoption.seq > initial.adoption.seq)
    expect(switched.manifest.structureGeneration).toBe(2)

    // 世代の数値は大小で比べない: 再起動後は世代 1(< 2)でも、新しい起動の識別子なら採用される。
    await stack.restartMock()
    const restarted = await waitForManifest(
      client,
      (frame) => frame.manifest.bootId !== switched.manifest.bootId,
      RECOVERY_BUDGET_MS,
    )
    expect(restarted.manifest.structureGeneration).toBe(1)
    expect(restarted.adoption.seq).toBeGreaterThan(switched.adoption.seq)
    expect(addressesOf(restarted.manifest)).toContain('/dev/row/b/value')
    expect(
      await frameWithin(client, (frame) => frame.type === 'link' && frame.unity.reachability === 'lost', 300),
    ).toBeNull()
  })

  test('legacy-origin mock: no reconciliation, every received manifest is adopted as before', async () => {
    stack = await startReinjectStack({
      scenario: 'runtime-switch',
      mockArgs: ['--legacy-origin', '--fault', 'drop-reinject-manifest'],
    })
    const { client } = stack

    const initial = await waitForManifest(client)
    expect(initial.manifest.bootId).toBeUndefined()
    expect(initial.manifest.structureGeneration).toBeUndefined()

    // 組を持たない送信元は、受け取るたびに新しい採用になる(同じ内容でも)。
    const udp = await createOscTestClient()
    try {
      await udp.send('127.0.0.1', stack.unityPort, '/sys/manifest/request', [])
      const again = await waitForManifest(client, (frame) => frame.adoption.seq > initial.adoption.seq)
      expect(again.manifest).toEqual(initial.manifest)
    } finally {
      await udp.close()
    }

    // 切り替えのマニフェストが落ちても、stats の照合が無いので取り直されない(stats の間隔 4 秒を 2 周以上待つ)。
    trigger(client, '/dev/switch/add-row')
    await client.waitForFrame((frame) => frame.type === 'osc' && frame.address === '/dev/switch/add-row')
    expect(await frameWithin(client, (frame) => frame.type === 'manifest', 9_000)).toBeNull()
  })
})
