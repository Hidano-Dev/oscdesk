import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import type { DownstreamFrame } from '../../packages/shared/src'

import { frameWithin, startStack, type Stack } from './helpers/stack'

// OSC パッド(D-080・版 2 は D-167)。保存・採用・押下・編集命令を版 2 のフレーム(osc.padDocument*)で確かめる
const PAD = {
  format: 'oscdesk-pad',
  version: 2,
  rows: 2,
  columns: 2,
  widgets: [
    { id: 'fire', kind: 'button', row: 0, column: 0, label: 'Fire', color: '#E53935', address: '/pad/fire', args: [{ type: 'i', value: 7 }, { type: 'f', value: 0.25 }, { type: 's', value: 'メンバーA' }] },
    { id: 'next', kind: 'button', row: 1, column: 1, label: 'Next', address: '/pad/next', args: [] },
  ],
}

// 版 1 の文書(osc.padSave は版 1 も受けて版 2 で保管する)
const PAD_V1 = {
  format: 'oscdesk-pad',
  version: 1,
  rows: 1,
  columns: 1,
  buttons: [{ id: 'go', row: 0, column: 0, label: 'Go', address: '/pad/go', args: [{ type: 'i', value: 1 }] }],
}

const echoOf = (address: string) => (frame: DownstreamFrame) => frame.type === 'osc.message' && frame.address === address
const versionOf = (frame: DownstreamFrame) => (frame.type === 'osc.padDocument' ? frame.version : '')

describe('OSC pad (D-080・D-167)', () => {
  let workDir: string
  let stack: Stack | undefined

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-e2e-pad-'))
  })

  afterEach(async () => {
    await stack?.stop().catch(() => undefined)
    stack = undefined
    fs.rmSync(workDir, { recursive: true, force: true })
  })

  test('a saved pad survives a bridge restart, a press reaches Unity, and presses drawn before the restart are refused', async () => {
    const surfacesDir = path.join(workDir, 'surfaces')
    stack = await startStack({ configOverrides: { surfaces: { dir: surfacesDir } } })

    stack.client.send({ v: 1, type: 'osc.padDocumentRequest' })
    expect(await stack.client.waitForFrame(frame => frame.type === 'osc.padList')).toEqual({ v: 1, type: 'osc.padList', names: [], active: null })

    stack.client.send({ v: 1, type: 'osc.padSave', name: 'take-01', pad: PAD })
    const adopted = await stack.client.waitForFrame(frame => frame.type === 'osc.padDocument')
    expect(adopted).toMatchObject({ type: 'osc.padDocument', name: 'take-01', revision: 1, pad: PAD })
    const before = versionOf(adopted)
    // 既定の保管先は <surfaces.dir>/pads
    expect(fs.existsSync(path.join(surfacesDir, 'pads', 'take-01.json'))).toBe(true)

    stack.client.send({ v: 1, type: 'osc.padPress', name: 'take-01', version: before, button: 'fire' })
    const echo = await stack.client.waitForFrame(echoOf('/pad/fire'), 10_000)
    expect(echo).toMatchObject({ args: [{ type: 'i', value: 7 }, { type: 'f', value: 0.25 }, { type: 's', value: 'メンバーA' }] })
    const logged = await stack.client.waitForFrame(frame => frame.type === 'osc.sentLog' && frame.records.some(record => record.origin === 'pad'))
    expect(logged.type === 'osc.sentLog' && logged.records.find(record => record.origin === 'pad')).toMatchObject({ address: '/pad/fire', count: 1, batch: null })

    // 押下は保持値に載らないので、ブリッジの再起動後に再送されない
    await stack.restartBridge()
    const { client } = stack
    client.send({ v: 1, type: 'osc.padDocumentRequest' })
    expect(await client.waitForFrame(frame => frame.type === 'osc.padList')).toEqual({ v: 1, type: 'osc.padList', names: ['take-01'], active: 'take-01' })
    const restored = await client.waitForFrame(frame => frame.type === 'osc.padDocument')
    // revision は再起動で 1 から数え直すが、版の印は再起動の前と重ならない
    expect(restored).toMatchObject({ name: 'take-01', revision: 1, pad: PAD })
    expect(versionOf(restored)).not.toBe(before)
    expect(await frameWithin(client, echoOf('/pad/fire'), 3_000)).toBeNull()

    // 再起動前に描いた画面からの押下は断る(同じ名前・同じ revision でも)
    client.send({ v: 1, type: 'osc.padPress', name: 'take-01', version: before, button: 'next' })
    expect(await client.waitForFrame(frame => frame.type === 'notice')).toMatchObject({ code: 'pad-press-rejected', detail: `stale-pad: take-01@${before}` })
    expect(await frameWithin(client, echoOf('/pad/next'), 1_500)).toBeNull()

    client.send({ v: 1, type: 'osc.padPress', name: 'take-01', version: versionOf(restored), button: 'next' })
    expect(await client.waitForFrame(echoOf('/pad/next'), 10_000)).toMatchObject({ args: [] })
  }, 90_000)

  test('a stored pad that newer rules reject is loaded after removing the parts that no longer fit (D-174)', async () => {
    const padsDir = path.join(workDir, 'surfaces', 'pads')
    fs.mkdirSync(padsDir, { recursive: true })
    // 前の版の規則で保存した、表の行の一覧(keysAddress)が値の部品と重なるパッド(HID-501 より前は保存できた)
    const stored = {
      format: 'oscdesk-pad', version: 2, rows: 2, columns: 2,
      widgets: [
        { id: 'members', kind: 'table', row: 0, column: 0, label: '', address: '/member', rows: { source: 'ui', keys: [{ key: 'a', label: '' }], keysAddress: '/keys' }, columns: [{ id: 'value', kind: 'number', label: '', address: 'value', type: 'i' }] },
        { id: 'n', kind: 'number', row: 1, column: 1, label: '', address: '/keys', type: 'i' },
      ],
    }
    fs.writeFileSync(path.join(padsDir, 'old.json'), JSON.stringify(stored))
    stack = await startStack({ configOverrides: { surfaces: { dir: path.join(workDir, 'surfaces') } } })

    stack.client.send({ v: 1, type: 'osc.padLoad', name: 'old' })
    const adopted = await stack.client.waitForFrame(frame => frame.type === 'osc.padDocument') as { name: string; pad: { widgets: { id: string; rows?: unknown }[] } }
    expect(adopted.name).toBe('old')
    expect(adopted.pad.widgets.map(widget => widget.id)).toEqual(['members', 'n'])
    expect(adopted.pad.widgets[0]!.rows).toEqual({ source: 'ui', keys: [{ key: 'a', label: '' }] })
    expect(await stack.client.waitForFrame(frame => frame.type === 'notice')).toMatchObject({ level: 'warn', code: 'pad-repaired' })
    // 直したパッドで書き直し、元のファイルは .backups に残る
    expect(JSON.parse(fs.readFileSync(path.join(padsDir, 'old.json'), 'utf8')).widgets[0].rows).not.toHaveProperty('keysAddress')
    expect(fs.readdirSync(path.join(padsDir, '.backups'))).toHaveLength(1)
  }, 60_000)

  test('an invalid pad and a press from a stale pad are refused only to the sender', async () => {
    stack = await startStack({ configOverrides: { surfaces: { dir: path.join(workDir, 'surfaces') } } })
    const bad = { ...PAD, widgets: [{ ...PAD.widgets[0], address: '/oscdesk/status' }] }
    stack.client.send({ v: 1, type: 'osc.padSave', name: 'take-01', pad: bad })
    expect(await stack.client.waitForFrame(frame => frame.type === 'notice')).toMatchObject({ level: 'error', code: 'pad-rejected' })

    stack.client.send({ v: 1, type: 'osc.padPress', name: 'take-01', version: 'none-1', button: 'fire' })
    expect(await stack.client.waitForFrame(frame => frame.type === 'notice')).toMatchObject({ code: 'pad-press-rejected', detail: 'stale-pad: take-01@none-1' })

    // 同じ名前で上書き保存された後は、古い版の押下を断り、新しい版の押下だけを送る
    stack.client.send({ v: 1, type: 'osc.padSave', name: 'take-01', pad: PAD })
    const first = versionOf(await stack.client.waitForFrame(frame => frame.type === 'osc.padDocument' && frame.revision === 1))
    const moved = { ...PAD, widgets: [{ ...PAD.widgets[0], address: '/pad/moved' }, PAD.widgets[1]] }
    stack.client.send({ v: 1, type: 'osc.padSave', name: 'take-01', pad: moved })
    const second = versionOf(await stack.client.waitForFrame(frame => frame.type === 'osc.padDocument' && frame.revision === 2))
    stack.client.send({ v: 1, type: 'osc.padPress', name: 'take-01', version: first, button: 'fire' })
    expect(await stack.client.waitForFrame(frame => frame.type === 'notice')).toMatchObject({ code: 'pad-press-rejected', detail: `stale-pad: take-01@${first}` })
    expect(await frameWithin(stack.client, echoOf('/pad/fire'), 1_500)).toBeNull()
    stack.client.send({ v: 1, type: 'osc.padPress', name: 'take-01', version: second, button: 'fire' })
    expect(await stack.client.waitForFrame(echoOf('/pad/moved'), 10_000)).toBeDefined()
  }, 60_000)

  test('a version 1 pad is saved as version 2 and its buttons still press', async () => {
    const surfacesDir = path.join(workDir, 'surfaces')
    stack = await startStack({ configOverrides: { surfaces: { dir: surfacesDir } } })
    stack.client.send({ v: 1, type: 'osc.padSave', name: 'old', pad: PAD_V1 })
    const adopted = await stack.client.waitForFrame(frame => frame.type === 'osc.padDocument')
    expect(adopted).toMatchObject({ name: 'old', pad: { format: 'oscdesk-pad', version: 2, widgets: [{ id: 'go', kind: 'button', address: '/pad/go' }] } })
    const saved = JSON.parse(fs.readFileSync(path.join(surfacesDir, 'pads', 'old.json'), 'utf8')) as { version: number }
    expect(saved.version).toBe(2)
    stack.client.send({ v: 1, type: 'osc.padPress', name: 'old', version: versionOf(adopted), button: 'go' })
    expect(await stack.client.waitForFrame(echoOf('/pad/go'), 10_000)).toMatchObject({ args: [{ type: 'i', value: 1 }] })
  }, 60_000)

  test('an edit command is answered to the sender with the edited draft, without saving (D-126)', async () => {
    stack = await startStack({ configOverrides: { surfaces: { dir: path.join(workDir, 'surfaces') } } })
    stack.client.send({ v: 1, type: 'osc.padDocumentEdit', requestId: 'padedit-1', draft: PAD, edit: { op: 'setAddress', widget: 'fire', address: '/sys/ping' } })
    expect(await stack.client.waitForFrame(frame => frame.type === 'osc.padDocumentEdited')).toEqual({
      v: 1, type: 'osc.padDocumentEdited', requestId: 'padedit-1', result: { ok: false, detail: '/sys と /oscdesk は予約されています' },
    })
    stack.client.send({ v: 1, type: 'osc.padDocumentEdit', requestId: 'padedit-2', draft: PAD, edit: { op: 'setLabel', widget: 'fire', label: 'Go' } })
    const answered = await stack.client.waitForFrame(frame => frame.type === 'osc.padDocumentEdited' && frame.requestId === 'padedit-2')
    expect(answered.type === 'osc.padDocumentEdited' && answered.result.ok).toBe(true)
    if (answered.type === 'osc.padDocumentEdited' && answered.result.ok) {
      expect(answered.result.pad.widgets.find(widget => widget.id === 'fire')).toMatchObject({ label: 'Go' })
    }
    // 編集は保存も採用もしない
    stack.client.send({ v: 1, type: 'osc.padDocumentRequest' })
    expect(await stack.client.waitForFrame(frame => frame.type === 'osc.padList')).toEqual({ v: 1, type: 'osc.padList', names: [], active: null })
  }, 60_000)
})
