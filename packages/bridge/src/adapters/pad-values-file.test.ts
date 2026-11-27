import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createPadResendFile } from './pad-resend-file'
import { createPadValuesFileStore, padValuesFilePath } from './pad-values-file'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-pad-values-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const VALUES = {
  widgets: [{ widget: 'level', address: '/mixer/level', value: 0.5 }],
  rows: [{ widget: 'members', key: 'm01', column: 'active', address: '/member/m01/active', value: true }],
}

function setup() {
  let pending: (() => void) | null = null
  const logWarn = vi.fn()
  const store = createPadValuesFileStore({
    dir, fs, logWarn, now: () => Date.UTC(2026, 10, 27), setTimeoutFn: callback => { pending = callback; return 1 }, clearTimeoutFn: () => { pending = null },
  })
  return { store, logWarn, fire: () => pending?.() }
}

describe('pad values file (D-169)', () => {
  it('writes the values per pad after the delay and reads them back', () => {
    const { store, fire } = setup()
    store.save('live', VALUES)
    expect(fs.existsSync(padValuesFilePath(dir, 'live'))).toBe(false)
    fire()
    expect(JSON.parse(fs.readFileSync(padValuesFilePath(dir, 'live'), 'utf8'))).toMatchObject({ format: 'oscdesk-pad-values', version: 1, pad: 'live', ...VALUES })
    expect(store.load('live')).toEqual(VALUES)
    expect(store.load('other')).toBeNull()
  })

  it('flushes a pending save before reading the same pad', () => {
    const { store } = setup()
    store.save('live', VALUES)
    expect(store.load('live')).toEqual(VALUES)
  })

  it('does not restore a broken file or a file of another pad', () => {
    const { store, logWarn } = setup()
    fs.writeFileSync(padValuesFilePath(dir, 'live'), '{ broken')
    expect(store.load('live')).toBeNull()
    // 読めないファイルは上書きされないよう脇へ退ける
    expect(fs.existsSync(padValuesFilePath(dir, 'live'))).toBe(false)
    expect(fs.readdirSync(dir).some(entry => entry.startsWith('live.pad-values.json.broken-'))).toBe(true)
    fs.writeFileSync(padValuesFilePath(dir, 'copy'), JSON.stringify({ format: 'oscdesk-pad-values', version: 1, pad: 'live', savedAt: '', ...VALUES }))
    expect(store.load('copy')).toBeNull()
    fs.writeFileSync(padValuesFilePath(dir, 'bad'), JSON.stringify({ format: 'oscdesk-pad-values', version: 1, pad: 'bad', savedAt: '', widgets: [{ widget: 'x', address: '/sys/ping', value: 1 }], rows: [] }))
    expect(store.load('bad')).toBeNull()
    expect(logWarn).toHaveBeenCalledTimes(3)
  })
})

describe('pad resend file (D-169)', () => {
  it('keeps the toggle and the boot ids, and starts from off when the file is broken', () => {
    const file = path.join(dir, '.pad-resend.json')
    const logWarn = vi.fn()
    const first = createPadResendFile({ file, fs, logWarn })
    expect(first.load()).toBeNull()
    first.save({ auto: true, boots: [{ target: '10.0.0.1:9000', bootId: 'b-1' }] })
    first.close()
    expect(createPadResendFile({ file, fs }).load()).toEqual({ auto: true, boots: [{ target: '10.0.0.1:9000', bootId: 'b-1' }] })
    fs.writeFileSync(file, JSON.stringify({ format: 'oscdesk-pad-resend', version: 1, auto: 'yes', boots: [] }))
    expect(createPadResendFile({ file, fs, logWarn }).load()).toBeNull()
    expect(logWarn).toHaveBeenCalledTimes(1)
  })
})
