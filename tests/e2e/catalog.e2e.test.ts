import { afterEach, describe, expect, test } from 'vitest'

import { catalogAddArgs, catalogDigest, CATALOG_ADDRESSES, type CatalogItem, type DownstreamFrame } from '../../packages/shared/src'

import { createOscTestClient } from './helpers/osc-client'
import { startStack, type Stack } from './helpers/stack'

const smile: CatalogItem = { address: '/avatar/smile', kind: 'state', type: 'f', props: [{ key: 'max', arg: { type: 'f', value: 1 } }] }
const pose: CatalogItem = { address: '/avatar/pose', kind: 'state', type: 's', props: [{ key: 'options', arg: { type: 's', value: 'sit' } }] }

type CatalogFrame = Extract<DownstreamFrame, { type: 'catalog' }>
const catalogWhere = (predicate: (frame: CatalogFrame) => boolean) =>
  (frame: DownstreamFrame): frame is CatalogFrame => frame.type === 'catalog' && predicate(frame)

describe('blueprint Sync (D-104)', () => {
  let stack: Stack | undefined
  afterEach(async () => {
    await stack?.stop().catch(() => undefined)
    stack = undefined
  })

  test('Sync fetches the blueprint from the target and holds it per PC', async () => {
    stack = await startStack({ mockArgs: ['--catalog-json', JSON.stringify({ name: 'PC1', items: [smile, pose] })] })
    const { client } = stack
    await client.waitForFrame(frame => frame.type === 'hello')

    client.send({ v: 1, type: 'catalogRequest' })
    const frame = await client.waitForFrame(catalogWhere(f => f.pcs.some(pc => pc.items.length === 2)), 10_000)
    expect(frame.pcs).toHaveLength(1)
    expect(frame.pcs[0]).toMatchObject({ name: 'PC1', host: '127.0.0.1', verified: true })
    expect(frame.pcs[0]!.items.map(item => item.address).sort()).toEqual(['/avatar/pose', '/avatar/smile'])

    // 後から接続した UI にも全量が届く
    const late = await (await import('./helpers/ws-client')).connectWsE2eClient(`ws://127.0.0.1:${stack.bridge.ready.wsPort}`)
    try {
      await late.waitForFrame(catalogWhere(f => f.pcs.length === 1 && f.pcs[0]!.items.length === 2), 5_000)
    } finally {
      await late.close()
    }
  }, 60_000)

  test('a CRC mismatch is reported as a notice and verified=false', async () => {
    stack = await startStack({ mockArgs: ['--catalog-json', JSON.stringify({ name: 'PC1', items: [smile], corruptDigest: true })] })
    const { client } = stack
    await client.waitForFrame(frame => frame.type === 'hello')
    client.send({ v: 1, type: 'catalogRequest' })
    await client.waitForFrame(frame => frame.type === 'notice' && frame.code === 'catalog-mismatch', 10_000)
    await client.waitForFrame(catalogWhere(f => f.pcs[0]?.verified === false && f.pcs[0].items.length === 1), 5_000)
  }, 60_000)

  test('a second PC keeps its own blueprint, and remove/digest from the target update it', async () => {
    stack = await startStack()
    const { client } = stack
    await client.waitForFrame(frame => frame.type === 'hello')
    const osc = await createOscTestClient({ host: '127.0.0.2' })
    try {
      const bridgePort = stack.bridge.ready.oscListenPort
      const full = [smile, pose]
      const digest = catalogDigest(full)
      await osc.send('127.0.0.1', bridgePort, CATALOG_ADDRESSES.BEGIN, [{ type: 's', value: 'PC2' }, { type: 'i', value: 2 }])
      for (const item of full) await osc.send('127.0.0.1', bridgePort, CATALOG_ADDRESSES.ADD, catalogAddArgs(item))
      await osc.send('127.0.0.1', bridgePort, CATALOG_ADDRESSES.END, [{ type: 'i', value: digest.count }, { type: 'i', value: digest.crc }])
      await client.waitForFrame(catalogWhere(f => f.pcs.some(pc => pc.host === '127.0.0.2' && pc.verified === true && pc.items.length === 2)), 10_000)

      const rest = catalogDigest([pose])
      await osc.send('127.0.0.1', bridgePort, CATALOG_ADDRESSES.REMOVE, [{ type: 's', value: smile.address }])
      await osc.send('127.0.0.1', bridgePort, CATALOG_ADDRESSES.DIGEST, [{ type: 'i', value: rest.count }, { type: 'i', value: rest.crc }])
      await client.waitForFrame(catalogWhere(f => f.pcs.some(pc => pc.host === '127.0.0.2' && pc.verified === true && pc.items.length === 1)), 10_000)
    } finally {
      await osc.close()
    }
  }, 60_000)
})
