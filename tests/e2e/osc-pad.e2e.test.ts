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
const echoOf = (address: string) => (frame: Frame) => frame.type === 'osc' && frame.address === address

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

  test('a saved pad survives a bridge restart and a press reaches Unity with the stored address and arguments', async () => {
    const surfacesDir = path.join(workDir, 'surfaces')
    stack = await startStack({ configOverrides: { surfaces: { dir: surfacesDir } } })

    stack.client.send({ v: 1, type: 'padRequest' })
    expect(await stack.client.waitForFrame(frame => frame.type === 'padList')).toEqual({ v: 1, type: 'padList', names: [], active: null })

    stack.client.send({ v: 1, type: 'padSave', name: 'take-01', pad: PAD })
    const adopted = await stack.client.waitForFrame(frame => frame.type === 'pad')
    expect(adopted).toMatchObject({ type: 'pad', name: 'take-01', revision: 1, pad: PAD })
    // 既定の保管先は <surfaces.dir>/pads
    expect(fs.existsSync(path.join(surfacesDir, 'pads', 'take-01.json'))).toBe(true)

    stack.client.send({ v: 1, type: 'padPress', name: 'take-01', revision: 1, button: 'fire' })
    const echo = await stack.client.waitForFrame(echoOf('/pad/fire'), 10_000)
    expect(echo).toMatchObject({ args: [{ type: 'i', value: 7 }, { type: 'f', value: 0.25 }, { type: 's', value: 'メンバーA' }] })
    const logged = await stack.client.waitForFrame(frame => frame.type === 'sentLog' && frame.records.some(record => record.origin === 'pad'))
    expect(logged.type === 'sentLog' && logged.records.find(record => record.origin === 'pad')).toMatchObject({ address: '/pad/fire', count: 1, batch: null })

    // 押下は保持値に載らないので、ブリッジの再起動後に再送されない
    await stack.restartBridge()
    const { client } = stack
    client.send({ v: 1, type: 'padRequest' })
    expect(await client.waitForFrame(frame => frame.type === 'padList')).toEqual({ v: 1, type: 'padList', names: ['take-01'], active: 'take-01' })
    expect(await client.waitForFrame(frame => frame.type === 'pad')).toMatchObject({ name: 'take-01', revision: 1, pad: PAD })
    expect(await frameWithin(client, echoOf('/pad/fire'), 3_000)).toBeNull()

    client.send({ v: 1, type: 'padPress', name: 'take-01', revision: 1, button: 'next' })
    expect(await client.waitForFrame(echoOf('/pad/next'), 10_000)).toMatchObject({ args: [] })
  }, 90_000)

  test('an invalid pad and a press from a stale pad are refused only to the sender', async () => {
    stack = await startStack({ configOverrides: { surfaces: { dir: path.join(workDir, 'surfaces') } } })
    const bad = { ...PAD, buttons: [{ ...PAD.buttons[0], address: '/oscdesk/status' }] }
    stack.client.send({ v: 1, type: 'padSave', name: 'take-01', pad: bad })
    expect(await stack.client.waitForFrame(frame => frame.type === 'notice')).toMatchObject({ level: 'error', code: 'pad-rejected' })

    stack.client.send({ v: 1, type: 'padPress', name: 'take-01', revision: 1, button: 'fire' })
    expect(await stack.client.waitForFrame(frame => frame.type === 'notice')).toMatchObject({ code: 'pad-press-rejected', detail: 'stale-pad: take-01@1' })

    // 同じ名前で上書き保存された後は、古い版(revision 1)の押下を断り、新しい版の押下だけを送る
    stack.client.send({ v: 1, type: 'padSave', name: 'take-01', pad: PAD })
    await stack.client.waitForFrame(frame => frame.type === 'pad' && frame.revision === 1)
    const moved = { ...PAD, buttons: [{ ...PAD.buttons[0], address: '/pad/moved' }] }
    stack.client.send({ v: 1, type: 'padSave', name: 'take-01', pad: moved })
    await stack.client.waitForFrame(frame => frame.type === 'pad' && frame.revision === 2)
    stack.client.send({ v: 1, type: 'padPress', name: 'take-01', revision: 1, button: 'fire' })
    expect(await stack.client.waitForFrame(frame => frame.type === 'notice')).toMatchObject({ code: 'pad-press-rejected', detail: 'stale-pad: take-01@1' })
    expect(await frameWithin(stack.client, echoOf('/pad/fire'), 1_500)).toBeNull()
    stack.client.send({ v: 1, type: 'padPress', name: 'take-01', revision: 2, button: 'fire' })
    expect(await stack.client.waitForFrame(echoOf('/pad/moved'), 10_000)).toBeDefined()
  }, 60_000)
})
