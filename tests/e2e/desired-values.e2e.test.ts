import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { frameWithin, startReinjectStack, type ReinjectStack } from './helpers/reinject-stack'

const DEFINITION = {
  format: 'oscdesk-surface',
  version: 1,
  name: 'Desired',
  parameters: [
    { id: 'level', address: '/desired/level', label: 'Level', type: 'f', kind: 'state', range: [0, 1], default: 0.5 },
    { id: 'fire', address: '/desired/fire', label: 'Fire', type: 'i', kind: 'trigger', value: 1 },
  ],
  screens: [{ id: 'main', label: 'Main', children: [{ kind: 'control', param: 'level', widget: 'slider' }] }],
}

const echoOf = (address: string) => (frame: { type: string; address?: string }) => frame.type === 'osc' && frame.address === address

describe('desired values (D-045)', () => {
  let workDir: string
  let stack: ReinjectStack | undefined

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-e2e-desired-'))
  })

  afterEach(async () => {
    await stack?.stop().catch(() => undefined)
    stack = undefined
    fs.rmSync(workDir, { recursive: true, force: true })
  })

  test('held state values are resent after mock-unity restarts, and triggers are not', async () => {
    stack = await startReinjectStack({
      scenario: 'default',
      configOverrides: { surfaces: { dir: path.join(workDir, 'surfaces') } },
    })
    const { client } = stack

    client.send({ v: 1, type: 'surfaceSave', name: 'desired', definition: DEFINITION })
    await client.waitForFrame(frame => frame.type === 'surface')

    // 初回の到達で既定値が Unity へ送られ、mock のエコーが返る
    const first = await client.waitForFrame(echoOf('/desired/level'), 15_000)
    expect(first).toMatchObject({ args: [{ type: 'f', value: 0.5 }] })

    // UI の操作で保持値が変わる。トリガは保持されない
    client.send({ v: 1, type: 'osc', address: '/desired/level', args: [{ type: 'f', value: 0.875 }] })
    await client.waitForFrame(frame => frame.type === 'desired' && !frame.full && frame.values[0]?.address === '/desired/level')
    // 再起動前のエコーはここで消費する(再起動後の再送と取り違えないため)
    await client.waitForFrame(frame => echoOf('/desired/level')(frame) && frame.type === 'osc' && frame.args[0]?.value === 0.875)
    client.send({ v: 1, type: 'osc', address: '/desired/fire', args: [{ type: 'i', value: 1 }] })
    await client.waitForFrame(echoOf('/desired/fire'))

    // 再接続した UI には保持値の全量が配られる
    client.send({ v: 1, type: 'surfaceRequest' })
    const full = await client.waitForFrame(
      frame => frame.type === 'desired' && frame.full && frame.values[0]?.args[0]?.value === 0.875,
    )
    expect(full).toMatchObject({ values: [{ address: '/desired/level', args: [{ type: 'f', value: 0.875 }] }] })

    // mock-unity 再起動(新しいインスタンスは何も覚えていない)→ 保持値だけが再送される
    await stack.restartMock()
    const resent = await client.waitForFrame(
      frame => echoOf('/desired/level')(frame) && frame.type === 'osc' && frame.args[0]?.value === 0.875,
      30_000,
    )
    expect(resent).toBeDefined()
    expect(await frameWithin(client, echoOf('/desired/fire'), 4_000)).toBeNull()
  }, 90_000)
})
