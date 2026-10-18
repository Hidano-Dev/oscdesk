import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createDesiredValuesFileStore,
  desiredValuesFilePath,
  type DesiredValuesFs,
} from './desired-values-file'
import type { PersistedDesired, PersistedDesiredValue, PersistedRecordRow } from './desired-values'

const LEVEL: PersistedDesiredValue = { id: 'level', address: '/light/level', type: 'f', args: [{ type: 'f', value: 0.875 }] }
const ON: PersistedDesiredValue = { id: 'on', address: '/light/on', type: 'bool', args: [{ type: 'i', value: 1 }] }
const ROW: PersistedRecordRow = {
  id: 'member', address: '/vp/member', key: 'Alpha',
  fields: [{ id: 'active', type: 'bool', arg: { type: 'i', value: 1 } }, { id: 'ip', type: 's', arg: { type: 's', value: '10.0.0.5' } }],
}

const only = (...values: PersistedDesiredValue[]): PersistedDesired => ({ values, records: [] })

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-values-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

function setup(overrides: { fs?: DesiredValuesFs } = {}) {
  const timers: (() => void)[] = []
  const setTimeoutFn = vi.fn((callback: () => void) => { timers.push(callback); return timers.length as never })
  const clearTimeoutFn = vi.fn()
  const logWarn = vi.fn()
  const store = createDesiredValuesFileStore({
    dir,
    fs: overrides.fs ?? fs,
    now: () => Date.UTC(2026, 9, 14),
    setTimeoutFn,
    clearTimeoutFn,
    logWarn,
    pid: 42,
  })
  const fire = () => timers.splice(0).forEach(callback => callback())
  return { store, setTimeoutFn, logWarn, fire }
}

const fileOf = (name: string) => desiredValuesFilePath(dir, name)
const readFile = (name: string) => JSON.parse(fs.readFileSync(fileOf(name), 'utf8')) as unknown

describe('createDesiredValuesFileStore (D-058)', () => {
  it('writes a versioned file per surface name after the delay, and reads it back', () => {
    const { store, fire } = setup()
    store.save('stage', { values: [LEVEL, ON], records: [ROW] })
    expect(fs.existsSync(fileOf('stage'))).toBe(false)
    fire()
    expect(readFile('stage')).toEqual({
      format: 'oscdesk-desired-values',
      version: 2,
      surface: 'stage',
      savedAt: '2026-10-14T00:00:00.000Z',
      values: [LEVEL, ON],
      records: [ROW],
    })
    expect(fs.readdirSync(dir)).toEqual(['stage.values.json']) // 一時ファイルを残さない
    expect(store.load('stage')).toEqual({ values: [LEVEL, ON], records: [ROW] })
  })

  it('keeps the UI-managed key lists in order, and leaves them out when there are none (D-075)', () => {
    const { store, fire } = setup()
    const keyLists = [{ address: '/mb/keys', keys: ['MB 2', 'MB 1'] }]
    store.save('stage', { values: [], records: [ROW], keyLists })
    fire()
    expect(readFile('stage')).toMatchObject({ version: 2, keyLists })
    expect(store.load('stage')).toEqual({ values: [], records: [ROW], keyLists })
    store.save('stage', { values: [], records: [ROW], keyLists: [] })
    fire()
    expect(readFile('stage')).not.toHaveProperty('keyLists')
  })

  it('reads a version 1 file (before records) as values without rows (D-062)', () => {
    const { store, logWarn } = setup()
    fs.writeFileSync(fileOf('stage'), JSON.stringify({ format: 'oscdesk-desired-values', version: 1, surface: 'stage', savedAt: '', values: [LEVEL] }))
    expect(store.load('stage')).toEqual({ values: [LEVEL], records: [] })
    expect(logWarn).not.toHaveBeenCalled()
  })

  it('coalesces bursts into one write of the latest values', () => {
    const writeFileSync = vi.fn(fs.writeFileSync)
    const { store, setTimeoutFn, fire } = setup({ fs: { ...fs, writeFileSync } as DesiredValuesFs })
    for (const value of [0.1, 0.2, 0.3]) store.save('stage', only({ ...LEVEL, args: [{ type: 'f', value }] }))
    expect(setTimeoutFn).toHaveBeenCalledTimes(1)
    fire()
    expect(writeFileSync).toHaveBeenCalledTimes(1)
    expect(store.load('stage')).toEqual(only({ ...LEVEL, args: [{ type: 'f', value: 0.3 }] }))
  })

  it('writes a pending save for another surface before switching names', () => {
    const { store, fire } = setup()
    store.save('a', only(LEVEL))
    store.save('b', only(ON))
    expect(store.load('a')).toEqual(only(LEVEL))
    fire()
    expect(store.load('b')).toEqual(only(ON))
  })

  it('flushes the pending save on close and ignores saves afterwards', () => {
    const { store } = setup()
    store.save('stage', only(LEVEL))
    store.close()
    expect(store.load('stage')).toEqual(only(LEVEL))
    store.save('stage', only(ON))
    store.flush()
    expect(store.load('stage')).toEqual(only(LEVEL))
  })

  it('returns null without warning when no file exists', () => {
    const { store, logWarn } = setup()
    expect(store.load('stage')).toBeNull()
    expect(logWarn).not.toHaveBeenCalled()
  })

  it.each([
    ['broken JSON', '{'],
    ['an unknown format', JSON.stringify({ format: 'x', version: 2, surface: 'stage', savedAt: '', values: [], records: [] })],
    ['a future version', JSON.stringify({ format: 'oscdesk-desired-values', version: 3, surface: 'stage', savedAt: '', values: [], records: [] })],
    ['a version 2 file without records', JSON.stringify({ format: 'oscdesk-desired-values', version: 2, surface: 'stage', savedAt: '', values: [] })],
    ['a version 1 file with records', JSON.stringify({ format: 'oscdesk-desired-values', version: 1, surface: 'stage', savedAt: '', values: [], records: [] })],
    ['a non-int32 i value', JSON.stringify({ format: 'oscdesk-desired-values', version: 1, surface: 'stage', savedAt: '', values: [{ id: 'x', address: '/x', type: 'i', args: [{ type: 'i', value: 1.5 }] }] })],
    ['a record field holding a blob', JSON.stringify({ format: 'oscdesk-desired-values', version: 2, surface: 'stage', savedAt: '', values: [], records: [{ ...ROW, fields: [{ id: 'active', type: 'i', arg: { type: 'b', value: 'AA==' } }] }] })],
    ['a file of another surface', JSON.stringify({ format: 'oscdesk-desired-values', version: 2, surface: 'other', savedAt: '', values: [], records: [] })],
  ])('warns and starts from defaults for %s', (_label, content) => {
    const { store, logWarn } = setup()
    fs.writeFileSync(fileOf('stage'), content)
    expect(store.load('stage')).toBeNull()
    expect(logWarn).toHaveBeenCalledTimes(1)
    expect(logWarn.mock.calls[0]?.[0]).toBe('(WARN, BRIDGE)')
  })

  it('accepts a BOM written by Windows editors', () => {
    const { store } = setup()
    fs.writeFileSync(fileOf('stage'), `﻿${JSON.stringify({ format: 'oscdesk-desired-values', version: 2, surface: 'stage', savedAt: '', values: [LEVEL], records: [] })}`)
    expect(store.load('stage')).toEqual(only(LEVEL))
  })

  it('warns, removes the temp file and keeps running when the write fails', () => {
    const renameSync = vi.fn(() => { throw new Error('EPERM') })
    const { store, logWarn, fire } = setup({ fs: { ...fs, renameSync } as DesiredValuesFs })
    store.save('stage', only(LEVEL))
    fire()
    expect(logWarn).toHaveBeenCalledWith('(WARN, BRIDGE)', expect.stringContaining('EPERM'))
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('never touches a path for an invalid surface name', () => {
    const { store, setTimeoutFn } = setup()
    store.save('../escape', only(LEVEL))
    expect(setTimeoutFn).not.toHaveBeenCalled()
    expect(store.load('../escape')).toBeNull()
  })
})
