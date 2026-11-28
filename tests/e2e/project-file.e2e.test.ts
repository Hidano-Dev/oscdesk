import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import type { DownstreamFrame } from '../../packages/shared/src'

import { frameWithin, startStack, type Stack } from './helpers/stack'

// プロジェクトファイル(D-090・版 3 は D-172)。書き出した採用中のパッドと保持値を取り込むとパッドと保持値は戻るが、
// ターゲットへは送らない(送るのは利用者の同期)。版 1・版 2 のファイルはパッドを版 2 へ移し、サーフェス定義は落として知らせる

const PAD = {
  format: 'oscdesk-pad', version: 2, rows: 1, columns: 2,
  widgets: [
    { id: 'level', kind: 'slider', row: 0, column: 0, label: 'Level', address: '/project/level', type: 'f', min: 0, max: 1 },
    { id: 'fire', kind: 'button', row: 0, column: 1, label: 'Fire', address: '/project/fire', args: [{ type: 'i', value: 1 }] },
  ],
}

const echoOf = (address: string, value: unknown) => (frame: DownstreamFrame) =>
  frame.type === 'osc.message' && frame.address === address && frame.args[0]?.type === 'f' && frame.args[0].value === value

describe('project file export and import (D-090・D-172)', () => {
  let workDir: string
  let surfacesDir: string
  let stack: Stack | undefined

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-e2e-project-'))
    surfacesDir = path.join(workDir, 'surfaces')
  })

  afterEach(async () => {
    await stack?.stop().catch(() => undefined)
    stack = undefined
    fs.rmSync(workDir, { recursive: true, force: true })
  })

  test('exports the adopted pad with its values and imports them back without sending anything', async () => {
    stack = await startStack({ configOverrides: { surfaces: { dir: surfacesDir } } })
    const { client } = stack

    client.send({ v: 1, type: 'osc.padSave', name: 'take-01', pad: PAD })
    const adopted = await client.waitForFrame(frame => frame.type === 'osc.padDocument' && frame.name === 'take-01')
    const version = adopted.type === 'osc.padDocument' ? adopted.version : ''
    client.send({ v: 1, type: 'osc.padSet', name: 'take-01', version, widget: 'level', value: 0.875 })
    await client.waitForFrame(echoOf('/project/level', 0.875), 10_000)

    client.send({ v: 1, type: 'projectExport', requestId: 'e2e-1' })
    const exported = await client.waitForFrame(frame => frame.type === 'project' && frame.requestId === 'e2e-1')
    if (exported.type !== 'project') throw new Error('unexpected frame')
    // 版 3: 採用中のパッドとその保持値は osc の欄、送り先は書き出したときの宛先
    expect(exported.project).toMatchObject({
      format: 'oscdesk-project',
      version: 3,
      osc: { pad: { name: 'take-01', pad: PAD }, values: { widgets: [{ widget: 'level', value: 0.875 }], rows: [] } },
      destinations: [{ host: '127.0.0.1', port: stack.unityPort }],
    })

    // 取り込みの前に値を変えておく(取り込みで戻ることを見る)
    client.send({ v: 1, type: 'osc.padSet', name: 'take-01', version, widget: 'level', value: 0.25 })
    await client.waitForFrame(echoOf('/project/level', 0.25), 10_000)

    // 読み込む前の検査(D-122)は何も書き換えずに要約を返す
    client.send({ v: 1, type: 'projectInspect', requestId: 'e2e-i1', project: exported.project as unknown as Record<string, unknown> })
    const inspection = await client.waitForFrame(frame => frame.type === 'projectInspection' && frame.requestId === 'e2e-i1')
    expect(inspection).toMatchObject({
      result: {
        ok: true,
        summary: { sourceVersion: 3, pad: { name: 'take-01', widgets: 2 }, values: { widgets: 1, rows: 0 }, destinations: 1, droppedSurface: null },
      },
    })
    expect(await frameWithin(client, frame => frame.type === 'osc.padValues' && frame.full
      && frame.widgets.some(entry => entry.widget === 'level' && entry.value === 0.875), 1_000)).toBeNull()

    client.send({ v: 1, type: 'projectImport', project: exported.project as unknown as Record<string, unknown> })
    expect(await client.waitForFrame(frame => frame.type === 'notice' && frame.code === 'project-imported'))
      .toMatchObject({ detail: 'pad "take-01", 1 value(s)' })
    const full = await client.waitForFrame(frame => frame.type === 'osc.padValues' && frame.full
      && frame.widgets.some(entry => entry.widget === 'level' && entry.value === 0.875))
    expect(full).toMatchObject({ name: 'take-01' })

    // 取り込んだだけでは送らない
    expect(await frameWithin(client, echoOf('/project/level', 0.875), 2_000)).toBeNull()

    // 手動の同期で送る
    client.send({ v: 1, type: 'osc.padSync', requestId: 'sync-1' })
    await client.waitForFrame(frame => frame.type === 'notice' && frame.code === 'pad-synced')
    await client.waitForFrame(echoOf('/project/level', 0.875), 10_000)
  }, 90_000)

  test('migrates a version 2 file: the pad is upgraded and the surface definition is dropped and reported', async () => {
    stack = await startStack({ configOverrides: { surfaces: { dir: surfacesDir } } })
    const { client } = stack
    const legacy = {
      format: 'oscdesk-project',
      version: 2,
      exportedAt: '2026-10-01T00:00:00.000Z',
      surface: { name: 'stage', definition: { format: 'oscdesk-surface', version: 2 }, values: { values: [{ param: 'level', value: 0.5 }], rows: [] } },
      osc: {
        pad: {
          name: 'old',
          pad: { format: 'oscdesk-pad', version: 1, rows: 1, columns: 1, buttons: [{ id: 'go', row: 0, column: 0, label: 'Go', address: '/project/go', args: [] }] },
        },
      },
    }

    client.send({ v: 1, type: 'projectInspect', requestId: 'e2e-i2', project: legacy })
    expect(await client.waitForFrame(frame => frame.type === 'projectInspection' && frame.requestId === 'e2e-i2')).toMatchObject({
      result: {
        ok: true,
        summary: { sourceVersion: 2, pad: { name: 'old', widgets: 1 }, values: { widgets: 0, rows: 0 }, destinations: 0, droppedSurface: { name: 'stage', values: 1, rows: 0 } },
      },
    })

    client.send({ v: 1, type: 'projectImport', project: legacy })
    expect(await client.waitForFrame(frame => frame.type === 'notice' && frame.code === 'project-imported'))
      .toMatchObject({ detail: 'pad "old", 0 value(s), surface definition "stage" was not imported' })
    expect(await client.waitForFrame(frame => frame.type === 'osc.padDocument' && frame.name === 'old')).toMatchObject({
      pad: { version: 2, widgets: [{ id: 'go', kind: 'button', address: '/project/go' }] },
    })
  }, 60_000)

  test('rejects a file without a pad, without touching the adopted pad', async () => {
    stack = await startStack({ configOverrides: { surfaces: { dir: surfacesDir } } })
    const { client } = stack
    const surfaceOnly = { format: 'oscdesk-project', version: 1, exportedAt: '2026-10-01T00:00:00.000Z', surface: null, pad: null }
    client.send({ v: 1, type: 'projectImport', project: surfaceOnly })
    const notice = await client.waitForFrame(frame => frame.type === 'notice' && frame.code === 'project-import-rejected')
    expect(notice).toMatchObject({ level: 'error', detail: expect.stringContaining('surface-only') })
    // 検査だけの問い合わせにも同じ理由で答える(D-122)
    client.send({ v: 1, type: 'projectInspect', requestId: 'e2e-i3', project: surfaceOnly })
    const inspection = await client.waitForFrame(frame => frame.type === 'projectInspection' && frame.requestId === 'e2e-i3')
    expect(inspection).toMatchObject({ result: { ok: false, detail: notice.type === 'notice' ? notice.detail : '' } })
    expect(await frameWithin(client, frame => frame.type === 'osc.padDocument', 1_000)).toBeNull()
  }, 60_000)
})
