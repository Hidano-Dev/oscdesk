import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import type { DownstreamFrame } from '../../packages/shared/src'

import { frameWithin, startStack, type Stack } from './helpers/stack'
import { connectWsE2eClient, type WsE2eClient } from './helpers/ws-client'

// 届いた一覧は反映するまで画面に使わない(D-088)。初報は自動で反映し、その後の変化は反映の操作を待つ
const MEMBERS = '/vp/members'
const MEMBERS_REQUEST = '/vp/members/get'
const SEGMENTS = '/mb/segments'
const SEGMENTS_REQUEST = '/mb/segments/get'

const DEFINITION = {
  format: 'oscdesk-surface',
  version: 1,
  name: 'Hold',
  parameters: [{
    id: 'segment', address: '/member/1/segment', label: 'Segment', type: 's', kind: 'state',
    options: ['(none)'], default: '(none)', optionsFrom: { address: SEGMENTS, request: SEGMENTS_REQUEST },
  }],
  records: [{
    id: 'member', address: '/vp/member', label: 'Member', kind: 'state',
    keysFrom: { address: MEMBERS, request: MEMBERS_REQUEST },
    fields: [{ id: 'active', label: 'Active', type: 'bool', default: false }],
  }],
  screens: [{ id: 'main', label: 'Main', children: [{ kind: 'control', param: 'segment' }, { kind: 'record', record: 'member' }] }],
}

const replies = (members: string[], segments: string[]) => [
  '--options-reply', [MEMBERS_REQUEST, MEMBERS, ...members].join('|'),
  '--options-reply', [SEGMENTS_REQUEST, SEGMENTS, ...segments].join('|'),
]

type RuntimeOptionsFrame = Extract<DownstreamFrame, { type: 'runtimeOptions' }>
const memberKeys = (frame: DownstreamFrame) =>
  frame.type === 'runtimeOptions' ? frame.keys?.find(entry => entry.record === 'member')?.keys : undefined
const segmentChoices = (frame: DownstreamFrame) =>
  frame.type === 'runtimeOptions' ? frame.choices.find(choice => choice.param === 'segment')?.options : undefined
const isRowEcho = (key: string) => (frame: DownstreamFrame) =>
  frame.type === 'osc' && frame.address === '/vp/member' && frame.args[0]?.value === key
const sameList = (actual: readonly string[] | undefined, expected: readonly string[]) =>
  JSON.stringify(actual) === JSON.stringify(expected)

describe('Unity option lists held until applied (D-088)', () => {
  let workDir: string
  let surfacesDir: string
  let stack: Stack | undefined
  let other: WsE2eClient | undefined

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-e2e-hold-'))
    surfacesDir = path.join(workDir, 'surfaces')
    fs.mkdirSync(surfacesDir, { recursive: true })
    fs.writeFileSync(path.join(surfacesDir, 'stage.json'), JSON.stringify(DEFINITION))
  })

  afterEach(async () => {
    await other?.close().catch(() => undefined)
    other = undefined
    await stack?.stop().catch(() => undefined)
    stack = undefined
    fs.rmSync(workDir, { recursive: true, force: true })
  })

  test('a restarted Unity with other lists changes no rows or choices until applied, then every UI gets them', async () => {
    stack = await startStack({
      mockArgs: replies(['A', 'B'], ['Intro']),
      configOverrides: { surfaces: { dir: surfacesDir, defaultName: 'stage' } },
    })
    const { client } = stack
    // 初報は自動で反映し、新しいキーの行を作って Unity へ送る
    await client.waitForFrame(frame => sameList(memberKeys(frame), ['A', 'B']) && sameList(segmentChoices(frame), ['(none)', 'Intro']), 15_000)
    await client.waitForFrame(isRowEcho('B'), 10_000)

    other = await connectWsE2eClient(`ws://127.0.0.1:${stack.bridge.ready.wsPort}`)
    other.send({ v: 1, type: 'surfaceRequest' })
    await other.waitForFrame(frame => sameList(memberKeys(frame), ['A', 'B']), 10_000)

    // Unity が別の一覧(誤って起動した別のプロジェクトを模す)で起動し直す。回復の要求に別の一覧で答える
    await stack.restartMock(replies(['A', 'C'], ['Intro', 'Wrong']))
    const held = await client.waitForFrame(
      frame => frame.type === 'runtimeOptions' && (frame.pending ?? []).length === 2,
      15_000,
    ) as RuntimeOptionsFrame
    expect(held.pending).toEqual([
      { address: SEGMENTS, target: 'unity', added: ['Wrong'], removed: [] },
      { address: MEMBERS, target: 'unity', added: ['C'], removed: ['B'] },
    ])
    // 画面の行と選択肢は反映済みのまま。新しいキーの行は作らず、Unity へも送らない
    expect(memberKeys(held)).toEqual(['A', 'B'])
    expect(segmentChoices(held)).toEqual(['(none)', 'Intro'])
    expect(await frameWithin(client, isRowEcho('C'), 1_500)).toBeNull()

    // 一覧ごとに反映できる。反映はブリッジが全 UI へ配る
    client.send({ v: 1, type: 'runtimeOptionsApply', address: SEGMENTS })
    const segmentsApplied = await other.waitForFrame(frame => sameList(segmentChoices(frame), ['(none)', 'Intro', 'Wrong']), 10_000)
    expect(memberKeys(segmentsApplied)).toEqual(['A', 'B'])
    expect((segmentsApplied as RuntimeOptionsFrame).pending).toEqual([{ address: MEMBERS, target: 'unity', added: ['C'], removed: ['B'] }])

    // まとめて反映すると、行が全 UI で替わり、新しいキーの default の行が Unity へ届く
    client.send({ v: 1, type: 'runtimeOptionsApply' })
    const applied = await other.waitForFrame(frame => sameList(memberKeys(frame), ['A', 'C']), 10_000) as RuntimeOptionsFrame
    expect(applied.pending).toEqual([])
    const echo = await client.waitForFrame(isRowEcho('C'), 10_000)
    expect(echo).toMatchObject({ args: [{ type: 's', value: 'C' }, { type: 'i', value: 0 }] })
  }, 90_000)
})
