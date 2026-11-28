import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import type { DownstreamFrame } from '../../packages/shared/src'

import type { ManagedProcess } from './helpers/process'
import { frameWithin, startStack, type Stack } from './helpers/stack'

// 冗長構成(D-046)。UI の送信は全宛先へ届き、UI へ中継するエコーは主系のものだけ。
// 副系は 127.0.0.2 で待ち受けさせ、送信元のホストで主系と見分ける
const PAD = {
  format: 'oscdesk-pad', version: 2, rows: 1, columns: 1,
  widgets: [{ id: 'level', kind: 'slider', row: 0, column: 0, label: 'Level', address: '/redundant/level', type: 'f', min: 0, max: 1 }],
}

type LinkFrame = Extract<DownstreamFrame, { type: 'link' }>
const reachable = (name: string) => (frame: DownstreamFrame): frame is LinkFrame =>
  frame.type === 'link' && frame.targets.some(target => target.name === name && target.reachability === 'reachable')
const echoFrom = (host: string, address: string) => (frame: DownstreamFrame) =>
  frame.type === 'osc.message' && frame.address === address && frame.from.host === host

async function waitForOutput(process: () => ManagedProcess | undefined, text: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(process()?.stdoutSnapshot().includes(text) ?? false)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for "${text}"`)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

describe('redundant Unity targets (D-046)', () => {
  let workDir: string
  let stack: Stack | undefined

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-e2e-redundant-'))
  })

  afterEach(async () => {
    await stack?.stop().catch(() => undefined)
    stack = undefined
    fs.rmSync(workDir, { recursive: true, force: true })
  })

  test('a message reaches every target, only the primary echo is relayed, and a manual sync can pick one target', async () => {
    stack = await startStack({
      withBackup: true,
      backupHost: '127.0.0.2',
      configOverrides: { surfaces: { dir: path.join(workDir, 'surfaces') } },
    })
    const { client } = stack

    // 接続直後の hello / link は宛先ごとの状態を持つ
    const hello = await client.waitForFrame(frame => frame.type === 'hello')
    expect(hello).toMatchObject({ targets: [{ name: 'unity', primary: true }, { name: 'backup', primary: false }] })
    await client.waitForFrame(frame => reachable('unity')(frame) && reachable('backup')(frame), 15_000)

    client.sendOsc('/redundant/raw', [{ type: 'i', value: 3 }])
    await client.waitForFrame(echoFrom('127.0.0.1', '/redundant/raw'), 10_000)
    const logged = await client.waitForFrame(frame => frame.type === 'osc.sentLog' && frame.records.some(record => record.address === '/redundant/raw'))
    expect(logged.type === 'osc.sentLog' && logged.records.find(record => record.address === '/redundant/raw')?.targets).toEqual(['unity', 'backup'])
    // 副系のエコーは UI へ中継しない(届いたことは delivery で分かる)
    expect(await frameWithin(client, echoFrom('127.0.0.2', '/redundant/raw'), 1_500)).toBeNull()

    // 手動の同期は宛先名で 1 台に絞れる
    client.send({ v: 1, type: 'osc.padSave', name: 'redundant', pad: PAD })
    const adopted = await client.waitForFrame(frame => frame.type === 'osc.padDocument')
    const version = adopted.type === 'osc.padDocument' ? adopted.version : ''
    client.send({ v: 1, type: 'osc.padSet', name: 'redundant', version, widget: 'level', value: 0.875 })
    await client.waitForFrame(echoFrom('127.0.0.1', '/redundant/level'), 10_000)

    client.send({ v: 1, type: 'osc.padSync', target: 'backup', requestId: 'sync-backup' })
    expect(await client.waitForFrame(frame => frame.type === 'notice' && frame.code === 'pad-synced')).toMatchObject({ requestId: 'sync-backup' })
    await waitForOutput(() => stack!.backup(), 'MOCK_UNITY_SYNC end')
    expect(stack.mock().stdoutSnapshot()).not.toContain('MOCK_UNITY_SYNC')

    // 未知の宛先は要求元へ理由を返す
    client.send({ v: 1, type: 'osc.padSync', target: 'nope', requestId: 'sync-nope' })
    expect(await client.waitForFrame(frame => frame.type === 'notice' && frame.code === 'pad-sync-rejected')).toMatchObject({ requestId: 'sync-nope', detail: 'unknown-target: nope' })
  }, 90_000)
})
