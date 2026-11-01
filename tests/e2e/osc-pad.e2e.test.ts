import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { frameWithin, startStack, type Stack } from './helpers/stack'

const PAD = {
  format: 'oscdesk-pad',
  version: 1,
  rows: 2,
  columns: 2,
  buttons: [
    { id: 'fire', row: 0, column: 0, label: 'Fire', color: '#E53935', address: '/pad/fire', args: [{ type: 'i', value: 7 }, { type: 'f', value: 0.25 }, { type: 's', value: 'メンバーA' }] },
    { id: 'next', row: 1, column: 1, label: 'Next', address: '/pad/next', args: [] },
  ],
}

type Frame = { type: string; address?: string; args?: { type: string; value: unknown }[] }
const echoOf = (address: string) => (frame: Frame) => frame.type === 'osc.message' && frame.address === address

describe('OSC pad (D-080)', () => {
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

  const versionOf = (frame: { type: string }) => (frame.type === 'osc.pad' ? (frame as { version: string }).version : '')

  test('a saved pad survives a bridge restart, a press reaches Unity, and presses drawn before the restart are refused', async () => {
    const surfacesDir = path.join(workDir, 'surfaces')
    stack = await startStack({ configOverrides: { surfaces: { dir: surfacesDir } } })

    stack.client.send({ v: 1, type: 'osc.padRequest' })
    expect(await stack.client.waitForFrame(frame => frame.type === 'osc.padList')).toEqual({ v: 1, type: 'osc.padList', names: [], active: null })

    stack.client.send({ v: 1, type: 'osc.padSave', name: 'take-01', pad: PAD })
    const adopted = await stack.client.waitForFrame(frame => frame.type === 'osc.pad')
    expect(adopted).toMatchObject({ type: 'osc.pad', name: 'take-01', revision: 1, pad: PAD })
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
    client.send({ v: 1, type: 'osc.padRequest' })
    expect(await client.waitForFrame(frame => frame.type === 'osc.padList')).toEqual({ v: 1, type: 'osc.padList', names: ['take-01'], active: 'take-01' })
    const restored = await client.waitForFrame(frame => frame.type === 'osc.pad')
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

  test('an invalid pad and a press from a stale pad are refused only to the sender', async () => {
    stack = await startStack({ configOverrides: { surfaces: { dir: path.join(workDir, 'surfaces') } } })
    const bad = { ...PAD, buttons: [{ ...PAD.buttons[0], address: '/oscdesk/status' }] }
    stack.client.send({ v: 1, type: 'osc.padSave', name: 'take-01', pad: bad })
    expect(await stack.client.waitForFrame(frame => frame.type === 'notice')).toMatchObject({ level: 'error', code: 'pad-rejected' })

    stack.client.send({ v: 1, type: 'osc.padPress', name: 'take-01', version: 'none-1', button: 'fire' })
    expect(await stack.client.waitForFrame(frame => frame.type === 'notice')).toMatchObject({ code: 'pad-press-rejected', detail: 'stale-pad: take-01@none-1' })

    // 同じ名前で上書き保存された後は、古い版の押下を断り、新しい版の押下だけを送る
    stack.client.send({ v: 1, type: 'osc.padSave', name: 'take-01', pad: PAD })
    const first = versionOf(await stack.client.waitForFrame(frame => frame.type === 'osc.pad' && frame.revision === 1))
    const moved = { ...PAD, buttons: [{ ...PAD.buttons[0], address: '/pad/moved' }] }
    stack.client.send({ v: 1, type: 'osc.padSave', name: 'take-01', pad: moved })
    const second = versionOf(await stack.client.waitForFrame(frame => frame.type === 'osc.pad' && frame.revision === 2))
    stack.client.send({ v: 1, type: 'osc.padPress', name: 'take-01', version: first, button: 'fire' })
    expect(await stack.client.waitForFrame(frame => frame.type === 'notice')).toMatchObject({ code: 'pad-press-rejected', detail: `stale-pad: take-01@${first}` })
    expect(await frameWithin(stack.client, echoOf('/pad/fire'), 1_500)).toBeNull()
    stack.client.send({ v: 1, type: 'osc.padPress', name: 'take-01', version: second, button: 'fire' })
    expect(await stack.client.waitForFrame(echoOf('/pad/moved'), 10_000)).toBeDefined()
  }, 60_000)

  test('an edit command is answered to the sender with the edited draft, without saving (D-126)', async () => {
    stack = await startStack({ configOverrides: { surfaces: { dir: path.join(workDir, 'surfaces') } } })
    stack.client.send({ v: 1, type: 'osc.padEdit', requestId: 'padedit-1', draft: PAD, edit: { op: 'setAddress', button: 'fire', address: '/sys/ping' } })
    expect(await stack.client.waitForFrame(frame => frame.type === 'osc.padEdited')).toEqual({
      v: 1, type: 'osc.padEdited', requestId: 'padedit-1', result: { ok: false, detail: '/sys と /oscdesk は予約されています' },
    })
    stack.client.send({ v: 1, type: 'osc.padEdit', requestId: 'padedit-2', draft: PAD, edit: { op: 'setLabel', button: 'fire', label: 'Go' } })
    const answered = await stack.client.waitForFrame(frame => frame.type === 'osc.padEdited' && (frame as { requestId: string }).requestId === 'padedit-2')
    const result = (answered as unknown as { result: { ok: boolean; pad: typeof PAD } }).result
    expect(result.ok).toBe(true)
    expect(result.pad.buttons.find(button => button.id === 'fire')).toMatchObject({ label: 'Go' })
    // 編集は保存も採用もしない
    stack.client.send({ v: 1, type: 'osc.padRequest' })
    expect(await stack.client.waitForFrame(frame => frame.type === 'osc.padList')).toEqual({ v: 1, type: 'osc.padList', names: [], active: null })
  }, 60_000)
})