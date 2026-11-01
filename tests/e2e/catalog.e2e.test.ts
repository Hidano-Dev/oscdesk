import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { catalogAddArgs, catalogDigest, CATALOG_ADDRESSES, compositeSchemaProps, type CatalogItem, type CompositeType, type DownstreamFrame } from '../../packages/shared/src'

import { blueprintSurfaceName } from '../../packages/bridge/src/blueprint-surface'

import { createOscTestClient } from './helpers/osc-client'
import { startStack, type Stack } from './helpers/stack'

const smile: CatalogItem = { address: '/avatar/smile', kind: 'state', type: 'f', props: [{ key: 'max', arg: { type: 'f', value: 1 } }] }
const pose: CatalogItem = { address: '/avatar/pose', kind: 'state', type: 's', props: [{ key: 'options', arg: { type: 's', value: 'sit' } }] }

const BLUEPRINT_NAME = blueprintSurfaceName('PC1')

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
    // 項目はパラメータの語彙(param と値)に直して配る(HID-389)
    expect(frame.pcs[0]!.items.map(item => item.param).sort()).toEqual(['p_avatar_pose', 'p_avatar_smile'])
    expect(JSON.stringify(frame)).not.toContain('/avatar/')

    // 後から接続した UI にも全量が届く
    const late = await (await import('./helpers/ws-client')).connectWsE2eClient(`ws://127.0.0.1:${stack.bridge.ready.wsPort}`)
    try {
      await late.waitForFrame(catalogWhere(f => f.pcs.length === 1 && f.pcs[0]!.items.length === 2), 5_000)
    } finally {
      await late.close()
    }
  }, 60_000)

  test('builds and adopts a default screen from a PC blueprint, and keeps a saved one over regenerating (HID-386)', async () => {
    const surfacesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-blueprint-e2e-'))
    try {
      stack = await startStack({
        mockArgs: ['--catalog-json', JSON.stringify({ name: 'PC1', items: [smile, pose] })],
        configOverrides: { surfaces: { dir: surfacesDir } },
      })
      const { client } = stack
      await client.waitForFrame(frame => frame.type === 'hello')
      client.send({ v: 1, type: 'catalogRequest' })
      await client.waitForFrame(catalogWhere(f => f.pcs.some(pc => pc.items.length === 2)), 10_000)

      client.send({ v: 1, type: 'catalogAdopt', host: '127.0.0.1' })
      const surface = await client.waitForFrame(frame => frame.type === 'surface' && frame.name === BLUEPRINT_NAME, 10_000)
      expect(surface.type === 'surface' && surface.bindings.osc?.parameters.map(binding => binding.address).sort()).toEqual(['/avatar/pose', '/avatar/smile'])
      await client.waitForFrame(frame => frame.type === 'blueprintStatus' && frame.pc?.name === 'PC1' && frame.absent.length === 0, 5_000)

      // 並べ替えて保存した画面(ここでは設計図に無いパラメータを足したもの)は、作り直しで上書きせずに採用し、無いものを知らせる
      if (surface.type !== 'surface') throw new Error('unexpected frame')
      const osc = surface.bindings.osc!
      client.send({
        v: 1, type: 'surfaceSave', name: BLUEPRINT_NAME, activate: true,
        definition: { ...surface.definition, parameters: [...surface.definition.parameters, { id: 'extra', label: 'Extra', type: 'f', kind: 'state' }] },
        bindings: { osc: { ...osc, parameters: [...osc.parameters, { id: 'extra', address: '/avatar/extra' }] } },
      })
      await client.waitForFrame(frame => frame.type === 'blueprintStatus' && frame.absent.includes('extra'), 5_000)
      client.send({ v: 1, type: 'catalogAdopt', host: '127.0.0.1' })
      const again = await client.waitForFrame(frame => frame.type === 'surface' && frame.name === BLUEPRINT_NAME
        && frame.definition.parameters.some(parameter => parameter.id === 'extra'), 10_000)
      expect(again.type).toBe('surface')

      client.send({ v: 1, type: 'catalogAdopt', host: '10.255.255.1' })
      await client.waitForFrame(frame => frame.type === 'notice' && frame.code === 'catalog-adopt-rejected', 5_000)
    } finally {
      await stack?.stop().catch(() => undefined)
      stack = undefined
      fs.rmSync(surfacesDir, { recursive: true, force: true })
    }
  }, 60_000)

  test('a composite type in the blueprint becomes a composite parameter that sends its fields as one message (D-121)', async () => {
    const surfacesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-composite-e2e-'))
    const color: CompositeType = {
      name: 'color', type: 'record', hint: 'color',
      fields: ['r', 'g', 'b', 'a'].map(id => ({ id, type: 'f' as const, range: [0, 1] as [number, number], default: 1 })),
    }
    const tint: CatalogItem = { address: '/fx/light/tint', kind: 'state', type: 'composite', props: [{ key: 'label', arg: { type: 's', value: 'Tint' } }, ...compositeSchemaProps(color)] }
    // 入れ子は設計図に残るが、画面には出さない(CBOR で送る方針。HID-397)
    const nested: CatalogItem = {
      address: '/fx/light/rig', kind: 'state', type: 'composite',
      props: compositeSchemaProps({ name: 'rig', type: 'record', fields: [{ id: 'tint', type: 'record', fields: color.fields }] }),
    }
    try {
      stack = await startStack({
        mockArgs: ['--catalog-json', JSON.stringify({ name: 'PC1', items: [tint, nested] })],
        configOverrides: { surfaces: { dir: surfacesDir } },
      })
      const { client } = stack
      await client.waitForFrame(frame => frame.type === 'hello')
      client.send({ v: 1, type: 'catalogRequest' })
      const catalog = await client.waitForFrame(catalogWhere(f => f.pcs.some(pc => pc.items.length === 2 && pc.verified === true)), 10_000)
      expect(catalog.pcs[0]!.items.find(item => item.param === 'p_fx_light_tint')).toMatchObject({ type: 'composite' })

      client.send({ v: 1, type: 'catalogAdopt', host: '127.0.0.1' })
      const surface = await client.waitForFrame(frame => frame.type === 'surface' && frame.name === BLUEPRINT_NAME, 10_000)
      if (surface.type !== 'surface') throw new Error('unexpected frame')
      expect(surface.definition.parameters.map(parameter => parameter.id)).toEqual(['p_fx_light_tint'])
      expect(surface.definition.parameters[0]).toMatchObject({ type: 'composite', hint: 'color', kind: 'state' })

      // フィールドを宣言順に並べた 1 メッセージで送り、Unity(mock)のエコーがオブジェクトの値として戻る
      client.send({ v: 1, type: 'set', param: 'p_fx_light_tint', value: { r: 1, g: 0.5, b: 0, a: 1 }, revision: surface.revision })
      await client.waitForFrame(frame => frame.type === 'echo' && frame.values.some(value =>
        value.param === 'p_fx_light_tint' && JSON.stringify(value.value) === JSON.stringify({ r: 1, g: 0.5, b: 0, a: 1 })), 10_000)
      await client.waitForFrame(frame => frame.type === 'desired' && frame.values.some(value =>
        value.param === 'p_fx_light_tint' && typeof value.value === 'object' && (value.value as Record<string, number>).g === 0.5), 5_000)
    } finally {
      await stack?.stop().catch(() => undefined)
      stack = undefined
      fs.rmSync(surfacesDir, { recursive: true, force: true })
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
