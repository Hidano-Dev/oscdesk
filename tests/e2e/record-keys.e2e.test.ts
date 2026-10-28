import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import type { DownstreamFrame } from '../../packages/shared/src'

import { startStack, type Stack } from './helpers/stack'

// UI で管理するキー(D-075)。一覧は Unity から受けず、UI の追加・削除でブリッジが持ち、Unity へ送る。
// 行は変わらない ID と変えられる Name を持ち、行を指す状態はすべて ID で持つ(D-087)
const UI_KEYS = { address: '/mb/keys', source: 'ui', max: 4 }

const DEFINITION = {
  format: 'oscdesk-surface',
  version: 1,
  name: 'MB',
  parameters: [],
  records: [
    {
      id: 'mb', address: '/mb/values', label: 'MB', kind: 'state', keysFrom: UI_KEYS,
      fields: [{ id: 'port', label: 'Port', type: 'i', range: [1, 65535], default: 22000 }],
    },
    { id: 'mbUpdate', address: '/mb/update', label: 'Update', kind: 'trigger', keysFrom: UI_KEYS, fields: [] },
  ],
  screens: [{ id: 'main', label: 'Main', children: [{ kind: 'record', record: 'mb' }] }],
}

const s = (value: string) => ({ type: 's', value })
const i = (value: number) => ({ type: 'i', value })

const isRowEcho = (id: string, name: string) => (frame: DownstreamFrame) =>
  frame.type === 'osc' && frame.address === '/mb/values' && frame.args[0]?.value === id && frame.args[1]?.value === name

const keysOf = (frame: DownstreamFrame, record: string) =>
  frame.type === 'runtimeOptions' ? frame.keys?.find(entry => entry.record === record) : undefined

const hasNames = (record: string, names: string[]) => (frame: DownstreamFrame) =>
  JSON.stringify(keysOf(frame, record)?.names) === JSON.stringify(names)

describe('record keys added, renamed and removed from the UI (D-075 / D-087)', () => {
  let workDir: string
  let surfacesDir: string
  let stack: Stack | undefined

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-e2e-record-keys-'))
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

  async function waitForSavedRows(names: string[]): Promise<{ id: string; name: string }[]> {
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      try {
        const saved = JSON.parse(fs.readFileSync(valuesFile(), 'utf8')) as { keyLists?: { rows: { id: string; name: string }[] }[] }
        const rows = saved.keyLists?.[0]?.rows
        if (rows !== undefined && JSON.stringify(rows.map(row => row.name)) === JSON.stringify(names)) return rows
      } catch {
        // まだ無い・置き換え中
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error(`desired values file never recorded rows ${names.join(', ')}`)
  }

  test('adds rows in order, renames one keeping its ID and value, removes one, and restores after a restart', async () => {
    stack = await startStack({ configOverrides: { surfaces: { dir: surfacesDir, defaultName: 'stage' } } })
    const { client } = stack
    await client.waitForFrame(frame => frame.type === 'link' && frame.unity.reachability === 'reachable', 15_000)

    client.send({ v: 1, type: 'recordKeyAdd', record: 'mb', key: 'MB 1' })
    const first = keysOf(await client.waitForFrame(hasNames('mb', ['MB 1'])), 'mb')!
    const id1 = first.keys[0]!
    expect(id1).not.toBe('MB 1')
    const added = await client.waitForFrame(frame => frame.type === 'desired' && !frame.full)
    expect(added).toMatchObject({ values: [{ address: '/mb/values', args: [s(id1), s('MB 1'), i(22000)] }] })
    // 行は [ID, Name, フィールド] で Unity へ送られ、エコーが届く。一覧(ID の並び)のエコーは osc として流さない
    await client.waitForFrame(isRowEcho(id1, 'MB 1'), 5_000)

    client.send({ v: 1, type: 'recordKeyAdd', record: 'mbUpdate', key: 'MB 2' })
    const second = keysOf(await client.waitForFrame(hasNames('mb', ['MB 1', 'MB 2'])), 'mb')!
    const id2 = second.keys[1]!

    // 値を変えてから改名する。ID と値はそのまま、Unity には新しい Name で届く
    client.send({ v: 1, type: 'osc', address: '/mb/values', args: [s(id1), s('MB 1'), i(1234)] })
    await client.waitForFrame(isRowEcho(id1, 'MB 1'), 5_000)
    client.send({ v: 1, type: 'recordKeyRename', record: 'mb', key: id1, name: 'MB A' })
    const renamed = keysOf(await client.waitForFrame(hasNames('mbUpdate', ['MB A', 'MB 2'])), 'mbUpdate')!
    expect(renamed.keys).toEqual([id1, id2])
    await client.waitForFrame(frame => frame.type === 'osc' && isRowEcho(id1, 'MB A')(frame) && frame.args[2]?.value === 1234, 5_000)

    client.send({ v: 1, type: 'recordKeyRemove', record: 'mb', key: id2 })
    const full = await client.waitForFrame(frame => frame.type === 'desired' && frame.full)
    expect(full).toMatchObject({ values: [{ address: '/mb/values', args: [s(id1), s('MB A'), i(1234)] }] })
    expect(await waitForSavedRows(['MB A'])).toEqual([{ id: id1, name: 'MB A' }])

    await stack.restartBridge()
    const restarted = stack.client
    restarted.send({ v: 1, type: 'surfaceRequest' })
    const options = await restarted.waitForFrame(frame => frame.type === 'runtimeOptions')
    expect(keysOf(options, 'mb')).toEqual({ record: 'mb', keys: [id1], names: ['MB A'] })
    expect(keysOf(options, 'mbUpdate')).toEqual({ record: 'mbUpdate', keys: [id1], names: ['MB A'] })
  }, 90_000)

  test('migrates a version 2 values file (names as keys) by giving each row an ID and keeping its values', async () => {
    fs.mkdirSync(path.dirname(valuesFile()), { recursive: true })
    fs.writeFileSync(valuesFile(), JSON.stringify({
      format: 'oscdesk-desired-values', version: 2, surface: 'stage', savedAt: '', values: [],
      records: [{ id: 'mb', address: '/mb/values', key: 'MB 1', fields: [{ id: 'port', type: 'i', arg: i(1234) }] }],
      keyLists: [{ address: '/mb/keys', keys: ['MB 1', 'MB 2'] }],
    }))
    stack = await startStack({ configOverrides: { surfaces: { dir: surfacesDir, defaultName: 'stage' } } })
    const { client } = stack
    client.send({ v: 1, type: 'surfaceRequest' })
    const options = await client.waitForFrame(hasNames('mb', ['MB 1', 'MB 2']))
    const [id1, id2] = keysOf(options, 'mb')!.keys
    expect(id1).not.toBe('MB 1')
    const desired = await client.waitForFrame(frame => frame.type === 'desired' && frame.full)
    expect(desired).toMatchObject({ values: [
      { address: '/mb/values', args: [s(id1!), s('MB 1'), i(1234)] },
      { address: '/mb/values', args: [s(id2!), s('MB 2'), i(22000)] },
    ] })
    // 移行した形(行に ID を持つ現行の version 4。D-090 で version 3 に未送信の印を足した)で書き直す
    expect(await waitForSavedRows(['MB 1', 'MB 2'])).toEqual([{ id: id1, name: 'MB 1' }, { id: id2, name: 'MB 2' }])
    expect(JSON.parse(fs.readFileSync(valuesFile(), 'utf8'))).toMatchObject({ version: 4 })
  }, 90_000)
})
