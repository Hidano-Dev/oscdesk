import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import type { DownstreamFrame } from '../../packages/shared/src'

import { startReinjectStack, type ReinjectStack } from './helpers/reinject-stack'

const DEFINITION = {
  format: 'oscdesk-surface',
  version: 1,
  name: 'Redundant',
  parameters: [
    { id: 'level', address: '/desired/level', label: 'Level', type: 'f', kind: 'state', range: [0, 1], default: 0.5 },
  ],
  screens: [{ id: 'main', label: 'Main', children: [{ kind: 'control', param: 'level', widget: 'slider' }] }],
}

type LinkFrame = Extract<DownstreamFrame, { type: 'link' }>
const reachable = (name: string) => (frame: DownstreamFrame): frame is LinkFrame =>
  frame.type === 'link' && frame.targets.some(target => target.name === name && target.reachability === 'reachable')

async function waitUntil(condition: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the condition.')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

describe('redundant Unity targets (D-046)', () => {
  let workDir: string
  let stack: ReinjectStack | undefined

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-e2e-redundant-'))
  })

  afterEach(async () => {
    await stack?.stop().catch(() => undefined)
    stack = undefined
    fs.rmSync(workDir, { recursive: true, force: true })
  })

  test('a restarted backup catches up alone, and the UI can resend to one target', async () => {
    stack = await startReinjectStack({
      scenario: 'default',
      withBackup: true,
      configOverrides: { surfaces: { dir: path.join(workDir, 'surfaces') } },
    })
    const { client } = stack

    // 接続直後の hello / link は宛先ごとの状態を持つ
    const hello = await client.waitForFrame(frame => frame.type === 'hello')
    expect(hello).toMatchObject({ targets: [{ name: 'unity', primary: true }, { name: 'backup', primary: false }] })
    await client.waitForFrame(frame => reachable('unity')(frame) && reachable('backup')(frame), 15_000)

    client.send({ v: 1, type: 'surfaceSave', name: 'redundant', definition: DEFINITION })
    await client.waitForFrame(frame => frame.type === 'surface')
    client.send({ v: 1, type: 'osc', address: '/desired/level', args: [{ type: 'f', value: 0.875 }] })
    await client.waitForFrame(frame => frame.type === 'osc' && frame.address === '/desired/level' && frame.args[0]?.value === 0.875)

    // 副系だけ再起動する。新しい個体は何も覚えていないが、保持値がその台だけへ再送される
    const resendLines = () => stack!.bridge.stdoutSnapshot().split('\n').filter(line => line.includes('Resending'))
    const before = resendLines().length
    await stack.restartBackup()
    await waitUntil(() => resendLines().slice(before).some(line => line.includes('"backup"')), 30_000)
    expect(resendLines().slice(before).filter(line => line.includes('"unity"'))).toEqual([])

    // UI からの再送要求は指定した宛先だけへ届く。未知の宛先は notice で拒否される
    const afterRecovery = resendLines().length
    client.send({ v: 1, type: 'resend', target: 'backup' })
    await waitUntil(() => resendLines().length > afterRecovery, 10_000)
    expect(resendLines().slice(afterRecovery).every(line => line.includes('"backup"'))).toBe(true)
    client.send({ v: 1, type: 'resend', target: 'nope' })
    await client.waitForFrame(frame => frame.type === 'notice' && frame.code === 'resend-rejected')
  }, 90_000)
})
