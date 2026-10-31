import { afterEach, describe, expect, test } from 'vitest'

import type { DownstreamFrame } from '../../packages/shared/src'

import { startStack, type Stack } from './helpers/stack'

type DeliveryFrame = Extract<DownstreamFrame, { type: 'delivery' }>
const deliveryWhere = (address: string, result: string) =>
  (frame: DownstreamFrame): frame is DeliveryFrame =>
    frame.type === 'delivery' && frame.events.some(event => event.address === address && event.result === result)

describe('delivery events (D-106)', () => {
  let stack: Stack | undefined
  afterEach(async () => {
    await stack?.stop().catch(() => undefined)
    stack = undefined
  })

  test('echo is ok, /sys/ignored is ignored, /sys/failed is failed — per sent address', async () => {
    stack = await startStack({ mockArgs: ['--known-address', '/known', '--known-address', '/bad', '--failing', '/bad=exception'] })
    const { client } = stack
    await client.waitForFrame(frame => frame.type === 'hello')
    const send = (address: string) => client.send({ v: 1, type: 'osc', address, args: [{ type: 'i', value: 1 }] })

    send('/known')
    const ok = await client.waitForFrame(deliveryWhere('/known', 'ok'), 10_000)
    expect(ok.events[0]).toMatchObject({ host: '127.0.0.1', result: 'ok', address: '/known' })
    expect(ok.events[0]!.elapsedMs).toBeGreaterThanOrEqual(0)

    // 同じ (ホスト, 結果) のイベントは 100ms に 1 回までに間引かれる(スライダーの連続操作用)ので、間を空ける
    await new Promise(resolve => setTimeout(resolve, 150))
    send('/missing')
    await client.waitForFrame(deliveryWhere('/missing', 'ok'), 10_000)
    const ignored = await client.waitForFrame(deliveryWhere('/missing', 'ignored'), 10_000)
    expect(ignored.events[0]).toMatchObject({ host: '127.0.0.1', result: 'ignored' })

    await new Promise(resolve => setTimeout(resolve, 150))
    send('/bad')
    await client.waitForFrame(deliveryWhere('/bad', 'failed'), 10_000)
  }, 60_000)

  test('a receiver that reports nothing only ever lights green', async () => {
    stack = await startStack()
    const { client } = stack
    await client.waitForFrame(frame => frame.type === 'hello')
    client.send({ v: 1, type: 'osc', address: '/anything', args: [{ type: 'i', value: 1 }] })
    await client.waitForFrame(deliveryWhere('/anything', 'ok'), 10_000)
  }, 60_000)
})
