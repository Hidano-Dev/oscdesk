import { afterEach, describe, expect, test } from 'vitest'

import {
  addressesOf,
  entryOf,
  frameWithin,
  startReinjectStack,
  trigger,
  waitForManifest,
  waitUntil,
  type ReinjectStack,
} from './helpers/reinject-stack'
import { createOscTestClient } from './helpers/osc-client'

// stats の照合間隔(4 秒)を 1 周以上またいで「何も起きない」ことを確かめる待ち時間。
const QUIET_MS = 5_000

describe('runtime manifest reinjection E2E: rejection, in-place updates, carry-over', () => {
  let stack: ReinjectStack | undefined

  afterEach(async () => {
    await stack?.stop()
    stack = undefined
  })

  test.each([
    { trigger: '/dev/switch/reuse-violation', reason: 'address-reused' },
    { trigger: '/dev/switch/project-mismatch', reason: 'project-mismatch' },
  ])('rejected switch $reason causes no adoption and keeps the client manifest', async (testCase) => {
    stack = await startReinjectStack({ scenario: 'runtime-switch' })
    const { client } = stack
    const initial = await waitForManifest(client)

    trigger(client, testCase.trigger)
    await waitUntil(
      () => stack!.mock().stderrSnapshot().includes(`${testCase.trigger} `) && stack!.mock().stderrSnapshot().includes(testCase.reason),
      `MOCK_UNITY_SWITCH_REJECTED ${testCase.reason}`,
    )
    expect(stack.mock().stderrSnapshot()).toContain('MOCK_UNITY_SWITCH_REJECTED')

    expect(await frameWithin(client, (frame) => frame.type === 'manifest', QUIET_MS)).toBeNull()

    // ブリッジが持つ(= クライアントが見る)マニフェストは切り替え前のまま。
    client.requestManifest()
    const current = await waitForManifest(client)
    expect(current.adoption.seq).toBe(initial.adoption.seq)
    expect(current.manifest).toEqual(initial.manifest)
  })

  test('choices-only switch updates the options and a direct manifest request is then not re-adopted', async () => {
    stack = await startReinjectStack({ scenario: 'runtime-switch' })
    const { client } = stack
    const initial = await waitForManifest(client)
    expect(initial.manifest.optionLists?.devices).toEqual(['Device A', 'Device B'])

    trigger(client, '/dev/switch/choices-only')
    const updated = await waitForManifest(client, (frame) => frame.adoption.seq > initial.adoption.seq)
    expect(updated.manifest.optionLists?.devices).toEqual(['Device A', 'Device B', 'Device C'])
    expect(addressesOf(updated.manifest)).toEqual(addressesOf(initial.manifest))
    expect(entryOf(updated.manifest, '/dev/sel/device').default).toBe('Device A')

    // 同じ組のマニフェストを mock へ直接要求して届けさせても、新しい採用は起きない。
    const udp = await createOscTestClient()
    try {
      await udp.send('127.0.0.1', stack.unityPort, '/sys/manifest/request', [])
      expect(await frameWithin(client, (frame) => frame.type === 'manifest', 2_000)).toBeNull()
    } finally {
      await udp.close()
    }
    client.requestManifest()
    const current = await waitForManifest(client)
    expect(current.adoption.seq).toBe(updated.adoption.seq)
  })

  test('widget-kind-only switch is a new adoption, changes the widget and keeps the current value as default', async () => {
    stack = await startReinjectStack({ scenario: 'runtime-switch' })
    const { client } = stack
    const initial = await waitForManifest(client)
    expect(entryOf(initial.manifest, '/dev/gain')).toMatchObject({ widget: 'fader', default: 0.5 })

    client.sendOsc('/dev/gain', [{ type: 'f', value: 0.75 }])
    await client.waitForFrame((frame) => frame.type === 'osc' && frame.address === '/dev/gain')

    trigger(client, '/dev/switch/widget-only')
    const switched = await waitForManifest(client, (frame) => frame.adoption.seq > initial.adoption.seq)
    expect(entryOf(switched.manifest, '/dev/gain')).toMatchObject({ widget: 'input', default: 0.75 })
    expect(entryOf(switched.manifest, '/dev/row/a/value').default).toBe(0.1)
  })

  test('a staged value survives a row-removing switch and is what the mock applies afterwards', async () => {
    stack = await startReinjectStack({ scenario: 'runtime-switch-staging' })
    const { client } = stack
    const initial = await waitForManifest(client)
    expect(entryOf(initial.manifest, '/dev/stg/a/name')).toMatchObject({ staged: true, default: 'A0' })

    client.sendOsc('/dev/stg/a/name', [{ type: 's', value: 'Edited' }])
    await client.waitForFrame((frame) => frame.type === 'osc' && frame.address === '/dev/stg/a/name')

    trigger(client, '/dev/switch/remove-b')
    const switched = await waitForManifest(client, (frame) => frame.adoption.seq > initial.adoption.seq)
    expect(addressesOf(switched.manifest)).not.toContain('/dev/stg/b/name')
    const carried = entryOf(switched.manifest, '/dev/stg/a/name').default
    expect(carried).toBe('Edited')

    trigger(client, '/dev/stg/apply')
    await waitUntil(() => stack!.mock().stderrSnapshot().includes('MOCK_UNITY_APPLY /dev/stg/apply'), 'MOCK_UNITY_APPLY')
    const line = stack.mock().stderrSnapshot().split('\n').find((candidate) => candidate.startsWith('MOCK_UNITY_APPLY /dev/stg/apply'))!
    const applied = JSON.parse(line.slice(line.indexOf('['))) as Array<{ address: string; value: unknown }>
    expect(applied).toEqual([{ address: '/dev/stg/a/name', value: carried }])
  })
})
