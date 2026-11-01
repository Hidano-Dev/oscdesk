import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import type { DownstreamFrame } from '../../packages/shared/src'

import { startStack, type Stack } from './helpers/stack'

// 一覧の近くの Sync(D-077): runtimeOptionsRefresh の request で、その一覧の要求だけを全宛先へ送らせる
const SEGMENTS = '/mb/segments'
const SEGMENTS_REQUEST = '/mb/segments/get'
const SCENES = '/mb/scenes'
const SCENES_REQUEST = '/mb/scenes/get'

const DEFINITION = {
  format: 'oscdesk-surface',
  version: 1,
  name: 'Sync',
  parameters: [
    {
      id: 'segment', address: '/member/1/segment', label: 'Segment', type: 's', kind: 'state',
      options: ['(none)'], default: '(none)', optionsFrom: { address: SEGMENTS, request: SEGMENTS_REQUEST },
    },
    {
      id: 'scene', address: '/scene', label: 'Scene', type: 's', kind: 'state',
      options: ['(none)'], default: '(none)', optionsFrom: { address: SCENES, request: SCENES_REQUEST },
    },
  ],
  screens: [{ id: 'main', label: 'Main', children: [{ kind: 'control', param: 'segment' }, { kind: 'control', param: 'scene' }] }],
}

// 場面の一覧は、最初の要求には空で、次からは埋まって返る(起動時に MB と未接続だった Unity を模す)
const MOCK_ARGS = [
  '--options-reply', [SEGMENTS_REQUEST, SEGMENTS, 'Intro'].join('|'),
  '--options-reply', [SCENES_REQUEST, SCENES].join('|'),
  '--options-reply', [SCENES_REQUEST, SCENES, 'Scene 1', 'Scene 2'].join('|'),
]

type LinkFrame = Extract<DownstreamFrame, { type: 'link' }>
type RuntimeOptionsFrame = Extract<DownstreamFrame, { type: 'runtimeOptions' }>
const bothReachable = (frame: DownstreamFrame): frame is LinkFrame =>
  frame.type === 'link' && frame.targets.every(target => target.reachability === 'reachable')
const choicesOf = (frame: DownstreamFrame, param: string) =>
  frame.type === 'runtimeOptions' ? frame.choices.find(choice => choice.param === param)?.options : undefined
const listFromBoth = (frame: DownstreamFrame, address: string) =>
  frame.type === 'runtimeOptions' && frame.lists.find(list => list.list === listId(address))?.targets.length === 2

async function waitUntil(condition: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the condition.')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}


// 版 1 の定義を読み込んだブリッジが振る一覧の id(l_ + アドレスの英数字以外を _ に。D-117)。一覧はフレームでは id で指す(HID-389)
const listId = (address: string) => `l_${address.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`

describe('Sync of one Unity option list (D-077)', () => {
  let workDir: string
  let stack: Stack | undefined

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-e2e-sync-'))
  })

  afterEach(async () => {
    await stack?.stop().catch(() => undefined)
    stack = undefined
    fs.rmSync(workDir, { recursive: true, force: true })
  })

  test('a sync sends only the named request to every target and the refreshed list reaches the UI once applied', async () => {
    stack = await startStack({
      withBackup: true,
      mockArgs: MOCK_ARGS,
      configOverrides: { surfaces: { dir: path.join(workDir, 'surfaces') } },
    })
    const { client } = stack
    await client.waitForFrame(bothReachable, 15_000)

    // 採用で両方の一覧を要求する。場面の一覧は最初は空で返る
    client.send({ v: 1, type: 'surfaceSave', name: 'sync', definition: DEFINITION })
    await client.waitForFrame(frame => listFromBoth(frame, SEGMENTS) && listFromBoth(frame, SCENES), 10_000)

    const requestLines = () => stack!.bridge.stdoutSnapshot().split('\n').filter(line => line.includes('Requesting'))
    const before = requestLines().length
    client.send({ v: 1, type: 'runtimeOptionsRefresh', list: listId(SCENES) })

    // 取り直した場面の一覧は、宛先ごとに反映待ちになる(初報の空の一覧は反映済み。D-088)
    const held = await client.waitForFrame(
      frame => frame.type === 'runtimeOptions' && (frame.pending ?? []).filter(item => item.list === listId(SCENES)).length === 2,
      10_000,
    ) as RuntimeOptionsFrame
    expect(held.pending).toEqual([
      { list: listId(SCENES), target: 'unity', added: ['Scene 1', 'Scene 2'], removed: [] },
      { list: listId(SCENES), target: 'backup', added: ['Scene 1', 'Scene 2'], removed: [] },
    ])
    expect(choicesOf(held, 'scene')).toEqual(['(none)'])

    // 反映すると全 UI へ届く(主系・副系とも同じ一覧なので和集合も同じ)
    client.send({ v: 1, type: 'runtimeOptionsApply', list: listId(SCENES) })
    const refreshed = await client.waitForFrame(frame => choicesOf(frame, 'scene')?.includes('Scene 1') === true, 10_000) as RuntimeOptionsFrame
    expect(choicesOf(refreshed, 'scene')).toEqual(['(none)', 'Scene 1', 'Scene 2'])
    expect(choicesOf(refreshed, 'segment')).toEqual(['(none)', 'Intro'])

    // 要求は場面の 1 件だけを、宛先ごとに送る(セグメントの要求は送らない)
    await waitUntil(() => requestLines().slice(before).filter(line => line.includes(`sync requested by UI: ${SCENES_REQUEST}`)).length === 2, 10_000)
    const syncLines = requestLines().slice(before).filter(line => line.includes('sync requested by UI'))
    expect(syncLines.every(line => line.includes('Requesting 1 option list(s)'))).toBe(true)
    expect(syncLines.some(line => line.includes('"unity"')) && syncLines.some(line => line.includes('"backup"'))).toBe(true)

    // 送信ログ(D-067)にも、Sync の要求は場面の要求だけが request として残る
    const sentLog = await client.waitForFrame(
      frame => frame.type === 'osc.sentLog' && frame.records.some(record => record.origin === 'request' && record.address === SCENES_REQUEST),
      10_000,
    )
    expect(sentLog.type).toBe('osc.sentLog')

    // 定義に無い要求は Unity へ送らず、要求元へ断る
    client.send({ v: 1, type: 'runtimeOptionsRefresh', list: 'scene' })
    const notice = await client.waitForFrame(frame => frame.type === 'notice' && frame.code === 'runtime-options-refresh-rejected', 5_000)
    expect(notice).toMatchObject({ level: 'error', detail: 'unknown-request: scene' })
  }, 90_000)
})
