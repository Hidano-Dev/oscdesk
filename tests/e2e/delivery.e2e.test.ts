import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import type { DownstreamFrame } from '../../packages/shared/src'

import { frameWithin, startStack, type Stack } from './helpers/stack'
import type { WsE2eClient } from './helpers/ws-client'

type DeliveryFrame = Extract<DownstreamFrame, { type: 'delivery' }>
type DeliveryEvent = DeliveryFrame['events'][number]
const deliveryWhere = (match: (event: DeliveryEvent) => boolean) =>
  (frame: DownstreamFrame): frame is DeliveryFrame => frame.type === 'delivery' && frame.events.some(match)

const DEFINITION = {
  format: 'oscdesk-surface',
  version: 1,
  name: 'Delivery',
  parameters: [
    { id: 'level', address: '/level', label: 'Level', type: 'f', kind: 'state', range: [0, 1], default: 0.5 },
  ],
  screens: [{ id: 'main', label: 'Main', children: [{ kind: 'control', param: 'level', widget: 'slider' }] }],
}

/** いまキューにある delivery を捨てる(定義の採用で再送した保持値の分などを、次の送信の結果と混ぜないため) */
async function drainDeliveries(client: WsE2eClient): Promise<void> {
  while (await frameWithin(client, frame => frame.type === 'delivery', 200) !== null) { /* 捨てる */ }
}

/** durationMs の間に届いた delivery のイベントを、届いた順に集める */
async function collectDeliveries(client: WsE2eClient, durationMs: number): Promise<DeliveryEvent[]> {
  const events: DeliveryEvent[] = []
  const deadline = Date.now() + durationMs
  for (;;) {
    const left = deadline - Date.now()
    if (left <= 0) return events
    const frame = await frameWithin(client, f => f.type === 'delivery', left)
    if (frame === null) return events
    if (frame.type === 'delivery') events.push(...frame.events)
  }
}

describe('delivery events (D-116)', () => {
  let stack: Stack | undefined
  let workDir: string | undefined
  afterEach(async () => {
    await stack?.stop().catch(() => undefined)
    stack = undefined
    if (workDir !== undefined) fs.rmSync(workDir, { recursive: true, force: true })
    workDir = undefined
  })

  test('delivered is ok, /sys/ignored is ignored, /sys/failed is failed — per sent message', async () => {
    stack = await startStack({ mockArgs: ['--known-address', '/known', '--known-address', '/bad', '--failing', '/bad=exception'] })
    const { client } = stack
    await client.waitForFrame(frame => frame.type === 'hello')
    const send = (address: string) => client.sendOsc(address, [{ type: 'i', value: 1 }])

    send('/known')
    const ok = await client.waitForFrame(deliveryWhere(event => event.result === 'ok'), 10_000)
    expect(ok.events[0]).toMatchObject({ host: '127.0.0.1', target: 'unity', result: 'ok', param: null })
    expect(ok.events[0]!.elapsedMs).toBeGreaterThanOrEqual(0)

    // 同じ (宛先, ホスト, 結果) のイベントは 100ms に 1 回までに間引かれる(スライダーの連続操作用)ので、間を空ける
    await new Promise(resolve => setTimeout(resolve, 150))
    send('/missing')
    const ignored = await client.waitForFrame(deliveryWhere(event => event.result === 'ignored'), 10_000)
    expect(ignored.events[0]).toMatchObject({ host: '127.0.0.1', result: 'ignored' })

    await new Promise(resolve => setTimeout(resolve, 150))
    send('/bad')
    await client.waitForFrame(deliveryWhere(event => event.result === 'failed'), 10_000)
  }, 60_000)

  test('a receiver that reports nothing only ever lights green', async () => {
    stack = await startStack()
    const { client } = stack
    await client.waitForFrame(frame => frame.type === 'hello')
    client.sendOsc('/anything', [{ type: 'i', value: 1 }])
    await client.waitForFrame(deliveryWhere(event => event.result === 'ok'), 10_000)
    expect(await frameWithin(client, deliveryWhere(event => event.result !== 'ok'), 1_000)).toBeNull()
  }, 60_000)

  test('several PCs: one never answers, one ignores, one is late — each shows up as expected', async () => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-e2e-delivery-'))
    stack = await startStack({
      configOverrides: { surfaces: { dir: path.join(workDir, 'surfaces') } },
      extraTargets: [
        { name: 'silent', host: '127.0.0.2', mockArgs: ['--fault', 'silent'] },
        { name: 'ignoring', host: '127.0.0.3', mockArgs: ['--known-address', '/other'] },
        { name: 'late', host: '127.0.0.4', mockArgs: ['--fault', 'delay-echo:800'] },
      ],
    })
    const { client } = stack
    await client.waitForFrame(frame => frame.type === 'hello')
    const reachable = (name: string) => (frame: DownstreamFrame) =>
      frame.type === 'link' && frame.targets.some(target => target.name === name && target.reachability === 'reachable')
    await client.waitForFrame(frame => ['unity', 'ignoring', 'late'].every(name => reachable(name)(frame)), 15_000)

    client.send({ v: 1, type: 'surfaceSave', name: 'delivery', definition: DEFINITION })
    await client.waitForFrame(frame => frame.type === 'surface')
    // 採用で保持値が全宛先へ再送される。遅れる台のその返事(800ms 後)まで待ってから捨て、次の送信と混ぜない
    await new Promise(resolve => setTimeout(resolve, 1_500))
    await drainDeliveries(client)

    client.send({ v: 1, type: 'set', param: 'level', value: 0.25 })
    const events = await collectDeliveries(client, 3_000)
    const of = (target: string) => events.filter(event => event.target === target)

    // 送り先に選んだのに届かない PC はイベントが無い(光らないことで気づく)
    expect(of('silent')).toEqual([])
    // ふつうに届いた PC は緑だけ。パラメータ id が載り、OSC のアドレスは載らない
    expect(of('unity').map(event => [event.host, event.result, event.param])).toEqual([['127.0.0.1', 'ok', 'level']])
    // 届いたが対象がいない PC は緑と黄
    expect(of('ignoring').map(event => [event.host, event.result]).sort()).toEqual([['127.0.0.3', 'ignored'], ['127.0.0.3', 'ok']])
    // 遅れて届いた PC は、遅れた時点で(他より後に)経過つきで出る
    const late = of('late')
    expect(late.map(event => [event.host, event.result])).toEqual([['127.0.0.4', 'ok']])
    expect(late[0]!.elapsedMs).toBeGreaterThanOrEqual(700)
    expect(events.indexOf(late[0]!)).toBe(events.length - 1)
    expect(of('unity')[0]!.elapsedMs).toBeLessThan(late[0]!.elapsedMs)
  }, 90_000)
})
