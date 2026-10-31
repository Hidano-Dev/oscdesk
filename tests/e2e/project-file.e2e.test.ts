import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import type { DownstreamFrame } from '../../packages/shared/src'

import { frameWithin, startStack, type Stack } from './helpers/stack'

// プロジェクトファイル(D-090)。書き出した定義・保持値・パッドを取り込むと画面と保持値は戻るが、Unity へは
// 全宛先への resend まで送らない(Unity の再起動・再接続でも自動では送らない)

const DEFINITION = {
  format: 'oscdesk-surface',
  version: 1,
  name: 'Project',
  parameters: [
    { id: 'level', address: '/project/level', label: 'Level', type: 'f', kind: 'state', range: [0, 1], default: 0.5 },
  ],
  screens: [{ id: 'main', label: 'Main', children: [{ kind: 'control', param: 'level', widget: 'slider' }] }],
}
const PAD = {
  format: 'oscdesk-pad', version: 1, rows: 1, columns: 2,
  buttons: [{ id: 'b1', row: 0, column: 0, label: 'Fire', address: '/project/fire', args: [{ type: 'i', value: 1 }] }],
}

const echoOf = (address: string, value: unknown) => (frame: DownstreamFrame) =>
  frame.type === 'osc.message' && frame.address === address && frame.args[0]?.value === value

describe('project file export and import (D-090)', () => {
  let workDir: string
  let surfacesDir: string
  let stack: Stack | undefined

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-e2e-project-'))
    surfacesDir = path.join(workDir, 'surfaces')
    fs.mkdirSync(surfacesDir, { recursive: true })
    fs.writeFileSync(path.join(surfacesDir, 'stage.json'), JSON.stringify(DEFINITION))
  })

  afterEach(async () => {
    await stack?.stop().catch(() => undefined)
    stack = undefined
    fs.rmSync(workDir, { recursive: true, force: true })
  })

  test('imports values without sending them until a resend to every target', async () => {
    stack = await startStack({ configOverrides: { surfaces: { dir: surfacesDir, defaultName: 'stage' } } })
    const { client } = stack
    await client.waitForFrame(echoOf('/project/level', 0.5), 15_000)

    client.send({ v: 1, type: 'osc.padSave', name: 'take-01', pad: PAD })
    await client.waitForFrame(frame => frame.type === 'osc.pad' && frame.name === 'take-01')
    client.send({ v: 1, type: 'osc.message', address: '/project/level', args: [{ type: 'f', value: 0.875 }] })
    await client.waitForFrame(echoOf('/project/level', 0.875))

    client.send({ v: 1, type: 'projectExport', requestId: 'e2e-1' })
    const exported = await client.waitForFrame(frame => frame.type === 'project' && frame.requestId === 'e2e-1')
    if (exported.type !== 'project') throw new Error('unexpected frame')
    expect(exported.project.surface).toMatchObject({
      name: 'stage',
      values: { values: [{ id: 'level', address: '/project/level', type: 'f', args: [{ type: 'f', value: 0.875 }] }] },
    })
    expect(exported.project.pad).toEqual({ name: 'take-01', pad: PAD })

    // 取り込みの前に値を変えておく(取り込みで戻ることを見る)
    client.send({ v: 1, type: 'osc.message', address: '/project/level', args: [{ type: 'f', value: 0.25 }] })
    await client.waitForFrame(echoOf('/project/level', 0.25))

    client.send({ v: 1, type: 'projectImport', project: exported.project as unknown as Record<string, unknown> })
    await client.waitForFrame(frame => frame.type === 'notice' && frame.code === 'project-imported')
    const full = await client.waitForFrame(frame => frame.type === 'desired' && frame.full)
    expect(full).toMatchObject({ values: [{ address: '/project/level', args: [{ type: 'f', value: 0.875 }] }] })
    await client.waitForFrame(frame => frame.type === 'desiredStatus' && frame.unsent)

    // 取り込んだだけでは送らない。Unity の再起動(喪失→回復)でも送らない
    expect(await frameWithin(client, echoOf('/project/level', 0.875), 2_000)).toBeNull()
    await stack.restartMock()
    expect(await frameWithin(client, echoOf('/project/level', 0.875), 6_000)).toBeNull()

    // 全宛先への resend で送り、自動の再送も戻る
    client.send({ v: 1, type: 'resend' })
    await client.waitForFrame(echoOf('/project/level', 0.875), 10_000)
    await client.waitForFrame(frame => frame.type === 'desiredStatus' && !frame.unsent)
  }, 90_000)

  test('rejects an invalid project without touching the adopted surface', async () => {
    stack = await startStack({ configOverrides: { surfaces: { dir: surfacesDir, defaultName: 'stage' } } })
    const { client } = stack
    client.send({ v: 1, type: 'projectImport', project: { format: 'oscdesk-project', version: 1, exportedAt: 'now', surface: null, pad: null } })
    const notice = await client.waitForFrame(frame => frame.type === 'notice' && frame.code === 'project-import-rejected')
    expect(notice).toMatchObject({ level: 'error' })
    expect(await frameWithin(client, frame => frame.type === 'surface', 1_000)).toBeNull()
  }, 60_000)
})
