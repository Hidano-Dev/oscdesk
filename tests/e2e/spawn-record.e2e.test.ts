import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import type { DownstreamFrame } from '../../packages/shared/src'

import { startStack, type Stack } from './helpers/stack'

// 生成の記録と、再起動した PC への復元(HID-385・D-115)。mock-unity 2 台を別の IP(127.0.0.1 と 127.0.0.2)の PC として立て、
// 生成担当の再現(--spawner)と起動時の設計図の送信(--announce-catalog。起動の合図)を使う

const DEFINITION = {
  format: 'oscdesk-surface',
  version: 1,
  name: 'Spawn',
  parameters: [
    { id: 'level', address: '/desired/level', label: 'Level', type: 'f', kind: 'state', range: [0, 1], default: 0.5 },
    { id: 'spawn', address: '/effect/spawner/spawn', label: 'Spawn', type: 's', kind: 'trigger', value: 'spark' },
    { id: 'destroy', address: '/effect/spawner/destroy', label: 'Destroy', type: 's', kind: 'trigger', value: 'spark1' },
  ],
  screens: [{ id: 'main', label: 'Main', children: [{ kind: 'control', param: 'level', widget: 'slider' }] }],
}

const MOCK_ARGS = ['--spawner', '/effect/spawner', '--announce-catalog']

type LinkFrame = Extract<DownstreamFrame, { type: 'link' }>
const reachable = (...names: string[]) => (frame: DownstreamFrame): frame is LinkFrame =>
  frame.type === 'link' && names.every(name => frame.targets.some(target => target.name === name && target.reachability === 'reachable'))

async function waitUntil(condition: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

const spawnedLines = (stdout: string) => stdout.split('\n').filter(line => line.startsWith('MOCK_UNITY_SPAWNED '))

describe('spawn record and restore (HID-385)', () => {
  let workDir: string
  let stack: Stack | undefined

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-e2e-spawn-'))
  })

  afterEach(async () => {
    await stack?.stop().catch(() => undefined)
    stack = undefined
    fs.rmSync(workDir, { recursive: true, force: true })
  })

  test('a restarted PC gets the spawn and the values back, and only what was spawned on it', async () => {
    stack = await startStack({
      withBackup: true,
      backupHost: '127.0.0.2',
      mockArgs: MOCK_ARGS,
      configOverrides: { surfaces: { dir: path.join(workDir, 'surfaces') } },
    })
    const { client } = stack
    await client.waitForFrame(frame => frame.type === 'hello')
    await client.waitForFrame(reachable('unity', 'backup'), 15_000)

    client.send({ v: 1, type: 'surfaceSave', name: 'spawn', definition: DEFINITION })
    const surface = await client.waitForFrame(frame => frame.type === 'surface')
    const revision = surface.type === 'surface' ? surface.revision : 1

    // 名前はブリッジが振り、両方の PC へ届く
    client.send({ v: 1, type: 'set', param: 'spawn', revision })
    await client.waitForFrame(frame => frame.type === 'notice' && frame.code === 'spawned' && frame.detail === 'spark1', 5_000)
    client.send({ v: 1, type: 'set', param: 'level', value: 0.75, revision })
    await waitUntil(() => spawnedLines(stack!.mock().stdoutSnapshot()).length === 1
      && spawnedLines(stack!.backup()!.stdoutSnapshot()).length === 1, 10_000, 'the spawn on both PCs')
    // 2 つめの生成は spark1 が両方の設計図にあるので spark2 になる
    client.send({ v: 1, type: 'set', param: 'spawn', revision })
    await client.waitForFrame(frame => frame.type === 'notice' && frame.code === 'spawned' && frame.detail === 'spark2', 5_000)
    await waitUntil(() => spawnedLines(stack!.backup()!.stdoutSnapshot()).length === 2, 10_000, 'the second spawn')

    // 副系だけ再起動する。新しい個体は起動時に設計図を送り(起動の合図)、生成し直されて値も届く
    const primaryBefore = spawnedLines(stack.mock().stdoutSnapshot()).length
    const resendLines = () => stack!.bridge.stdoutSnapshot().split('\n').filter(line => line.includes('Resending'))
    const resendBefore = resendLines().length
    await stack.restartBackup()
    await waitUntil(() => spawnedLines(stack!.backup()!.stdoutSnapshot()).length === 2, 15_000, 'the restore on the restarted PC')
    expect(spawnedLines(stack.backup()!.stdoutSnapshot()).sort()).toEqual(['MOCK_UNITY_SPAWNED spark1', 'MOCK_UNITY_SPAWNED spark2'])
    await waitUntil(() => resendLines().slice(resendBefore).some(line => line.includes('"backup"')), 15_000, 'the value resend to the restarted PC')
    expect(stack.bridge.stdoutSnapshot()).toContain('Restoring 2 spawned object(s) on 127.0.0.2')
    // 動いていた主系へは生成し直さない
    expect(spawnedLines(stack.mock().stdoutSnapshot())).toHaveLength(primaryBefore)
    expect(resendLines().slice(resendBefore).filter(line => line.includes('"unity"'))).toEqual([])

    // 送り先を主系だけに絞って生成する(副系の記録は消える)。送り先を戻して副系を再起動しても、主系にだけ出したものは届かない
    client.send({ v: 1, type: 'destinationsSelect', allDevices: false, networks: [], hosts: ['127.0.0.1'] })
    await client.waitForFrame(frame => frame.type === 'destinations' && frame.targets.length === 1, 5_000)
    client.send({ v: 1, type: 'set', param: 'spawn', revision })
    await client.waitForFrame(frame => frame.type === 'notice' && frame.code === 'spawned' && frame.detail === 'spark3', 5_000)
    await waitUntil(() => spawnedLines(stack!.mock().stdoutSnapshot()).some(line => line.endsWith('spark3')), 10_000, 'the spawn on the primary only')
    client.send({ v: 1, type: 'destinationsReset' })
    await client.waitForFrame(frame => frame.type === 'destinations' && frame.targets.length === 2, 5_000)
    const resendAgain = resendLines().length
    await stack.restartBackup()
    await waitUntil(() => resendLines().slice(resendAgain).some(line => line.includes('"backup"')), 15_000, 'the restarted PC to come back')
    // 起動の合図の処理を待つ(届くなら届いている時間)
    await new Promise(resolve => setTimeout(resolve, 1_000))
    expect(spawnedLines(stack.backup()!.stdoutSnapshot())).toEqual([])
  }, 120_000)
})
