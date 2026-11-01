import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { frameWithin, startStack, type Stack } from './helpers/stack'

const DEFINITION = {
  format: 'oscdesk-surface',
  version: 1,
  name: 'Persisted',
  parameters: [
    { id: 'level', address: '/persist/level', label: 'Level', type: 'f', kind: 'state', range: [0, 1], default: 0.5 },
    { id: 'mode', address: '/persist/mode', label: 'Mode', type: 's', kind: 'state', options: ['a', 'b'], default: 'a' },
    { id: 'fire', address: '/persist/fire', label: 'Fire', type: 'i', kind: 'trigger', value: 1 },
  ],
  screens: [{ id: 'main', label: 'Main', children: [{ kind: 'control', param: 'level', widget: 'slider' }] }],
}

const echoOf = (address: string, value: unknown) => (frame: { type: string; address?: string; args?: { value: unknown }[] }) =>
  frame.type === 'osc.message' && frame.address === address && frame.args?.[0]?.value === value

describe('desired values persisted across bridge restarts (D-058)', () => {
  let workDir: string
  let surfacesDir: string
  let stack: Stack | undefined

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-e2e-persist-'))
    surfacesDir = path.join(workDir, 'surfaces')
    fs.mkdirSync(surfacesDir, { recursive: true })
    fs.writeFileSync(path.join(surfacesDir, 'stage.json'), JSON.stringify(DEFINITION))
  })

  afterEach(async () => {
    await stack?.stop().catch(() => undefined)
    stack = undefined
    fs.rmSync(workDir, { recursive: true, force: true })
  })

  const valuesFile = () => path.join(surfacesDir, '.values', 'stage.values.json')

  // 間引きのあと書かれるのを待つ(Windows のプロセス停止はシグナルを経ないので、終了時の書き出しに頼らない)
  async function waitForSavedLevel(value: number): Promise<void> {
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      try {
        const saved = JSON.parse(fs.readFileSync(valuesFile(), 'utf8')) as { values: { id: string; args: { value: unknown }[] }[] }
        if (saved.values.find(entry => entry.id === 'level')?.args[0]?.value === value) return
      } catch {
        // まだ無い・置き換え中
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error(`desired values file never recorded level=${String(value)}`)
  }

  test('restores held values into desired and resends them to Unity after a bridge restart', async () => {
    stack = await startStack({ configOverrides: { surfaces: { dir: surfacesDir, defaultName: 'stage' } } })

    // 初回の到達で既定値が送られる(エコーで確認)
    await stack.client.waitForFrame(echoOf('/persist/level', 0.5), 15_000)
    stack.client.send({ v: 1, type: 'osc.message', address: '/persist/level', args: [{ type: 'f', value: 0.875 }] })
    stack.client.send({ v: 1, type: 'osc.message', address: '/persist/mode', args: [{ type: 's', value: 'b' }] })
    stack.client.send({ v: 1, type: 'osc.message', address: '/persist/fire', args: [{ type: 'i', value: 1 }] })
    await stack.client.waitForFrame(echoOf('/persist/fire', 1))
    await waitForSavedLevel(0.875)
    const saved = JSON.parse(fs.readFileSync(valuesFile(), 'utf8')) as { format: string; version: number; values: { id: string }[] }
    expect(saved).toMatchObject({ format: 'oscdesk-desired-values', version: 5, surface: 'stage', records: [] })
    expect(saved.values.map(entry => entry.id)).toEqual(['level', 'mode']) // trigger は保存しない

    // ブリッジだけを再起動する(mock-unity は前の値を持ったまま。再送はエコーで観測する)
    await stack.restartBridge()
    const { client } = stack
    const resentLevel = await client.waitForFrame(echoOf('/persist/level', 0.875), 15_000)
    expect(resentLevel).toBeDefined()
    await client.waitForFrame(echoOf('/persist/mode', 'b'), 5_000)
    // trigger は保存も再送もされないので、押下は再現されない
    expect(await frameWithin(client, echoOf('/persist/fire', 1), 3_000)).toBeNull()

    client.send({ v: 1, type: 'surfaceRequest' })
    const full = await client.waitForFrame(frame => frame.type === 'desired' && frame.full)
    expect(full).toMatchObject({
      values: [
        { address: '/persist/level', args: [{ type: 'f', value: 0.875 }] },
        { address: '/persist/mode', args: [{ type: 's', value: 'b' }] },
      ],
    })
  }, 90_000)

  test('a broken values file is reported and the bridge starts from defaults', async () => {
    fs.mkdirSync(path.dirname(valuesFile()), { recursive: true })
    fs.writeFileSync(valuesFile(), '{ broken')
    stack = await startStack({ configOverrides: { surfaces: { dir: surfacesDir, defaultName: 'stage' } } })

    stack.client.send({ v: 1, type: 'surfaceRequest' })
    const full = await stack.client.waitForFrame(frame => frame.type === 'desired' && frame.full)
    expect(full).toMatchObject({
      values: [
        { address: '/persist/level', args: [{ type: 'f', value: 0.5 }] },
        { address: '/persist/mode', args: [{ type: 's', value: 'a' }] },
      ],
    })
    expect(stack.bridge.stderrSnapshot() + stack.bridge.stdoutSnapshot()).toMatch(/\(WARN, BRIDGE\).*Desired values for surface "stage" not restored/)
  }, 60_000)
})
