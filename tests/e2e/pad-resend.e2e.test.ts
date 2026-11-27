import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import type { DownstreamFrame } from '../../packages/shared/src'

import type { ManagedProcess } from './helpers/process'
import { frameWithin, startStack, type Stack } from './helpers/stack'

// パッドの保持値・自動の再送・手動の同期(D-169)。
// 自動の再送はターゲットの起動(pong の起動 ID の変化。D-164)でだけ送り直し、ping の抜けからの回復(同じ起動 ID)では送らない

const PAD = {
  format: 'oscdesk-pad', version: 2, rows: 2, columns: 2,
  widgets: [
    { id: 'level', kind: 'slider', row: 0, column: 0, label: 'Level', address: '/mixer/level', type: 'f', min: 0, max: 1 },
    { id: 'title', kind: 'text', row: 0, column: 1, label: 'Title', address: '/scene/title', type: 's', resend: false },
  ],
}

type Frame = DownstreamFrame
const echoOf = (address: string) => (frame: Frame) => frame.type === 'osc.message' && frame.address === address

async function waitForOutput(process: () => ManagedProcess, text: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!process().stdoutSnapshot().includes(text)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for "${text}" in: ${process().stdoutSnapshot()}`)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

describe('pad held values, automatic resend and manual sync (D-169)', () => {
  let workDir: string
  let stack: Stack | undefined

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-e2e-pad-resend-'))
  })

  afterEach(async () => {
    await stack?.stop().catch(() => undefined)
    stack = undefined
    fs.rmSync(workDir, { recursive: true, force: true })
  })

  const adopt = async (current: Stack) => {
    current.client.send({ v: 1, type: 'osc.padSave', name: 'live', pad: PAD })
    const adopted = await current.client.waitForFrame(frame => frame.type === 'osc.padDocument')
    return adopted.type === 'osc.padDocument' ? adopted.version : ''
  }

  test('a manual sync sends the resent widgets between begin and end, and held values survive a bridge restart', async () => {
    stack = await startStack({ configOverrides: { surfaces: { dir: path.join(workDir, 'surfaces') } } })
    const version = await adopt(stack)
    stack.client.send({ v: 1, type: 'osc.padSet', name: 'live', version, widget: 'level', value: 0.5 })
    expect(await stack.client.waitForFrame(echoOf('/mixer/level'), 10_000)).toMatchObject({ args: [{ type: 'f', value: 0.5 }] })
    expect(await stack.client.waitForFrame(frame => frame.type === 'osc.padEcho', 10_000)).toMatchObject({ widgets: [{ widget: 'level', value: 0.5 }] })
    stack.client.send({ v: 1, type: 'osc.padSet', name: 'live', version, widget: 'title', value: 'A' })
    await stack.client.waitForFrame(echoOf('/scene/title'), 10_000)

    stack.client.send({ v: 1, type: 'osc.padSync', target: 'unity', requestId: 'sync-1' })
    expect(await stack.client.waitForFrame(frame => frame.type === 'notice' && frame.code === 'pad-synced')).toMatchObject({ requestId: 'sync-1', detail: expect.stringContaining('1 value(s)') })
    await waitForOutput(() => stack!.mock(), 'MOCK_UNITY_SYNC begin manual')
    await waitForOutput(() => stack!.mock(), 'MOCK_UNITY_SYNC end')
    // 送信ログは何フレームかに分かれて届きうるので、end が見えるまで集める
    const addresses: string[] = []
    while (!addresses.includes('/sys/sync/end')) {
      const logged = await stack.client.waitForFrame(frame => frame.type === 'osc.sentLog', 10_000)
      if (logged.type === 'osc.sentLog') addresses.push(...logged.records.filter(record => record.origin === 'resend').map(record => record.address))
    }
    // 「送り直す」を外した部品(title)は同期でも送らない
    expect(addresses).toEqual(['/sys/sync/begin', '/mixer/level', '/sys/sync/end'])

    // 宛先に無いホストへは送らない
    stack.client.send({ v: 1, type: 'osc.padSync', host: '10.255.255.1', port: 9000 })
    expect(await stack.client.waitForFrame(frame => frame.type === 'notice' && frame.code === 'pad-sync-rejected')).toMatchObject({ detail: 'unknown-host: 10.255.255.1:9000' })

    // 保存は 500 ms 間引くので、書かれてから止める(止め方によっては間引き中の分を書き切らない)
    const valuesFile = path.join(workDir, 'surfaces', '.values', 'live.pad-values.json')
    const deadline = Date.now() + 10_000
    while (!(fs.existsSync(valuesFile) && fs.readFileSync(valuesFile, 'utf8').includes('/scene/title'))) {
      if (Date.now() > deadline) throw new Error('pad values were not saved')
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    await stack.restartBridge()
    stack.client.send({ v: 1, type: 'osc.padDocumentRequest' })
    const restored = await stack.client.waitForFrame(frame => frame.type === 'osc.padValues')
    expect(restored).toMatchObject({ full: true, widgets: expect.arrayContaining([{ widget: 'level', value: 0.5 }, { widget: 'title', value: 'A' }]) })
    expect(await stack.client.waitForFrame(frame => frame.type === 'osc.padResend')).toMatchObject({ auto: false })
  }, 90_000)

  test('automatic resend is off by default, and once on it resends on a new boot id but not on a recovery', async () => {
    stack = await startStack({ configOverrides: { surfaces: { dir: path.join(workDir, 'surfaces') } }, mockArgs: ['--boot-id', 'boot-a'] })
    const version = await adopt(stack)
    stack.client.send({ v: 1, type: 'osc.padSet', name: 'live', version, widget: 'level', value: 0.25 })
    await stack.client.waitForFrame(echoOf('/mixer/level'), 10_000)

    // 既定は切: 別の起動 ID で立ち上がっても送り直さない
    await stack.restartMock(['--boot-id', 'boot-b'])
    expect(await frameWithin(stack.client, echoOf('/mixer/level'), 6_000)).toBeNull()

    stack.client.send({ v: 1, type: 'osc.padResendSet', auto: true })
    expect(await stack.client.waitForFrame(frame => frame.type === 'osc.padResend')).toEqual({ v: 1, type: 'osc.padResend', auto: true })

    // 入れると、起動 ID の変化(起動)で同期の合図に挟んで送り直す
    await stack.restartMock(['--boot-id', 'boot-c'])
    expect(await stack.client.waitForFrame(echoOf('/mixer/level'), 15_000)).toMatchObject({ args: [{ type: 'f', value: 0.25 }] })
    await waitForOutput(() => stack!.mock(), 'MOCK_UNITY_SYNC begin boot')

    // 同じ起動 ID のまま答えが戻った(ping の抜けからの回復)ときは送らない
    await stack.restartMock(['--boot-id', 'boot-c'])
    expect(await frameWithin(stack.client, echoOf('/mixer/level'), 6_000)).toBeNull()
    expect(stack.mock().stdoutSnapshot()).not.toContain('MOCK_UNITY_SYNC')
  }, 120_000)
})
