import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import type { DownstreamFrame } from '../../packages/shared/src'

import { frameWithin, startStack, type Stack } from './helpers/stack'
import { connectWsE2eClient } from './helpers/ws-client'

const LIST = '/mb/segments'
const REQUEST = '/mb/segments/get'

const DEFINITION = {
  format: 'oscdesk-surface',
  version: 1,
  name: 'Segments',
  parameters: [
    {
      id: 'segment', address: '/member/1/segment', label: 'Segment', type: 's', kind: 'state',
      options: ['(none)'], default: '(none)', optionsFrom: { address: LIST, request: REQUEST },
    },
  ],
  screens: [{ id: 'main', label: 'Main', children: [{ kind: 'control', param: 'segment', widget: 'select' }] }],
}

const optionsReply = (...options: string[]) => ['--options-reply', [REQUEST, LIST, ...options].join('|')]

type LinkFrame = Extract<DownstreamFrame, { type: 'link' }>
type RuntimeOptionsFrame = Extract<DownstreamFrame, { type: 'runtimeOptions' }>
const bothReachable = (frame: DownstreamFrame): frame is LinkFrame =>
  frame.type === 'link' && frame.targets.every(target => target.reachability === 'reachable')
const fromBothTargets = (frame: DownstreamFrame): frame is RuntimeOptionsFrame =>
  frame.type === 'runtimeOptions' && frame.lists[0]?.targets.length === 2

async function waitUntil(condition: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the condition.')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

describe('Unity option lists from two targets (D-053)', () => {
  let workDir: string
  let stack: Stack | undefined

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-e2e-options-'))
  })

  afterEach(async () => {
    await stack?.stop().catch(() => undefined)
    stack = undefined
    fs.rmSync(workDir, { recursive: true, force: true })
  })

  test('the primary and the backup return different lists and the UI receives their union', async () => {
    stack = await startStack({
      withBackup: true,
      mockArgs: optionsReply('Intro', 'Song A'),
      backupMockArgs: optionsReply('Song A', 'Song B'),
      configOverrides: { surfaces: { dir: path.join(workDir, 'surfaces') } },
    })
    const { client } = stack
    await client.waitForFrame(bothReachable, 15_000)

    // 到達可能な状態での採用が、新しい一覧のアドレスの要求を両方の台へ送る
    client.send({ v: 1, type: 'surfaceSave', name: 'segments', definition: DEFINITION })
    const options = await client.waitForFrame(fromBothTargets, 10_000) as RuntimeOptionsFrame
    expect(options.lists).toEqual([{
      address: LIST,
      targets: [{ name: 'unity', options: ['Intro', 'Song A'] }, { name: 'backup', options: ['Song A', 'Song B'] }],
    }])
    expect(options.choices).toEqual([{ param: 'segment', options: ['(none)', 'Intro', 'Song A', 'Song B'] }])

    // 一覧と要求のエコーは osc フレームとして流れない
    const leaked = await frameWithin(client, frame => frame.type === 'osc' && (frame.address === LIST || frame.address === REQUEST), 1_000)
    expect(leaked).toBeNull()

    // 後から接続した UI は surfaceRequest の応答で全量を受け取る
    const late = await connectWsE2eClient(`ws://127.0.0.1:${stack.bridge.ready.wsPort}`)
    try {
      late.send({ v: 1, type: 'surfaceRequest' })
      const snapshot = await late.waitForFrame(frame => frame.type === 'runtimeOptions') as RuntimeOptionsFrame
      expect(snapshot.choices).toEqual(options.choices)
    } finally {
      await late.close()
    }

    // 一覧に無い名前も選べて保持される(副系にしか無い名前を全台へ送る)
    client.send({ v: 1, type: 'osc', address: '/member/1/segment', args: [{ type: 's', value: 'Song B' }] })
    await client.waitForFrame(frame => frame.type === 'desired' && !frame.full && frame.values[0]?.args[0]?.value === 'Song B')

    // 副系が再起動して回復すると、その台へ要求し直す(主系へ送らないことは単体テストで見る。
    // 負荷の高い CI では主系の pong が一度落ちて主系にも回復の要求が出得るため、ここでは問わない)
    const requestLines = () => stack!.bridge.stdoutSnapshot().split('\n').filter(line => line.includes('Requesting'))
    const before = requestLines().length
    await stack.restartBackup()
    await waitUntil(() => requestLines().slice(before).some(line => line.includes('"backup" (Unity recovered)')), 30_000)

    // UI の「一覧を更新」は全宛先へ要求する
    const beforeRefresh = requestLines().length
    client.send({ v: 1, type: 'runtimeOptionsRefresh' })
    await waitUntil(() => {
      const lines = requestLines().slice(beforeRefresh)
      return lines.some(line => line.includes('"unity"')) && lines.some(line => line.includes('"backup"'))
    }, 10_000)
  }, 90_000)
})
