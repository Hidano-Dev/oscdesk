import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import type { DownstreamFrame } from '../../packages/shared/src'

import { startStack, type Stack } from './helpers/stack'

const KEYS = '/vp/members'
const KEYS_REQUEST = '/vp/members/get'

const DEFINITION = {
  format: 'oscdesk-surface',
  version: 1,
  name: 'Members',
  parameters: [],
  records: [
    {
      id: 'member', address: '/vp/member', label: 'Member', kind: 'state',
      keysFrom: { address: KEYS, request: KEYS_REQUEST },
      fields: [
        { id: 'active', label: 'Active', type: 'bool', default: false },
        { id: 'slot', label: 'Slot', type: 'i', range: [1, 64], default: 1 },
      ],
    },
    {
      id: 'memberUpdate', address: '/vp/member/update', label: 'Update', kind: 'trigger',
      keysFrom: { address: KEYS, request: KEYS_REQUEST }, fields: [],
    },
  ],
  screens: [{ id: 'main', label: 'Main', children: [{ kind: 'record', record: 'member' }] }],
}

type WireArgs = { type: string; value: unknown }[]
const s = (value: string) => ({ type: 's', value })
const i = (value: number) => ({ type: 'i', value })
const rowArgs = (key: string, active: number, slot: number) => [s(key), i(active), i(slot)]

const isRowEcho = (key: string, active: number, slot: number) => (frame: DownstreamFrame) =>
  frame.type === 'osc.message' && frame.address === '/vp/member' && sameArgs(frame.args, rowArgs(key, active, slot))

function sameArgs(actual: WireArgs, expected: WireArgs): boolean {
  return actual.length === expected.length && actual.every((arg, index) => arg.value === expected[index]!.value)
}

describe('record rows held per key across bridge restarts (D-062)', () => {
  let workDir: string
  let surfacesDir: string
  let stack: Stack | undefined

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-e2e-records-'))
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

  async function waitForSavedSlot(key: string, slot: number): Promise<void> {
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      try {
        const saved = JSON.parse(fs.readFileSync(valuesFile(), 'utf8')) as {
          records: { key: string; fields: { id: string; arg: { value: unknown } }[] }[]
        }
        const row = saved.records.find(entry => entry.key === key)
        if (row?.fields.find(field => field.id === 'slot')?.arg.value === slot) return
      } catch {
        // まだ無い・置き換え中
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error(`desired values file never recorded ${key}.slot=${String(slot)}`)
  }

  test('builds rows from the Unity key list, resends one message per key and restores rows after a restart', async () => {
    stack = await startStack({
      mockArgs: ['--options-reply', [KEYS_REQUEST, KEYS, 'Alpha', 'Bravo'].join('|')],
      configOverrides: { surfaces: { dir: surfacesDir, defaultName: 'stage' } },
    })
    const { client } = stack

    // 初回の到達でキーの一覧を要求し、届いたキーごとに default の行を作って Unity へ送り、差分を配る
    const created = await client.waitForFrame(frame => frame.type === 'desired' && !frame.full && frame.values.length === 2, 15_000)
    expect(created).toMatchObject({ values: [{ address: '/vp/member', args: rowArgs('Alpha', 0, 1) }, { address: '/vp/member', args: rowArgs('Bravo', 0, 1) }] })
    await client.waitForFrame(isRowEcho('Alpha', 0, 1), 5_000)
    await client.waitForFrame(isRowEcho('Bravo', 0, 1), 5_000)

    client.send({ v: 1, type: 'surfaceRequest' })
    const options = await client.waitForFrame(frame => frame.type === 'runtimeOptions')
    expect(options).toMatchObject({ keys: [{ record: 'member', keys: ['Alpha', 'Bravo'] }, { record: 'memberUpdate', keys: ['Alpha', 'Bravo'] }], fieldChoices: [] })

    // 行の 1 つを操作すると、そのキーの差分だけが配られる
    client.send({ v: 1, type: 'osc.message', address: '/vp/member', args: rowArgs('Bravo', 1, 7) })
    const changed = await client.waitForFrame(frame => frame.type === 'desired' && !frame.full && frame.values.length === 1)
    expect(changed).toMatchObject({ values: [{ address: '/vp/member', args: rowArgs('Bravo', 1, 7) }] })
    await client.waitForFrame(isRowEcho('Bravo', 1, 7), 5_000)

    // 再送はキーごとに 1 メッセージ
    client.send({ v: 1, type: 'resend' })
    await client.waitForFrame(isRowEcho('Alpha', 0, 1), 5_000)
    await client.waitForFrame(isRowEcho('Bravo', 1, 7), 5_000)

    await waitForSavedSlot('Bravo', 7)
    const saved = JSON.parse(fs.readFileSync(valuesFile(), 'utf8')) as { version: number; records: { id: string; key: string }[] }
    expect(saved.version).toBe(4)
    expect(saved.records.map(row => [row.id, row.key])).toEqual([['member', 'Alpha'], ['member', 'Bravo']])

    // ブリッジだけを再起動すると、保存した行が戻り、初回の到達で送り直される
    await stack.restartBridge()
    const restarted = stack.client
    await restarted.waitForFrame(isRowEcho('Bravo', 1, 7), 15_000)
    restarted.send({ v: 1, type: 'surfaceRequest' })
    const full = await restarted.waitForFrame(frame => frame.type === 'desired' && frame.full)
    expect(full).toMatchObject({
      values: [{ address: '/vp/member', args: rowArgs('Alpha', 0, 1) }, { address: '/vp/member', args: rowArgs('Bravo', 1, 7) }],
    })
  }, 90_000)
})
