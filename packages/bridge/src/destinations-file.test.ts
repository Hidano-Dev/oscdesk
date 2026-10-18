import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isValidSurfaceName } from '@oscdesk/shared'

import { createDestinationSelectionFile, DEFAULT_DESTINATIONS_FILE_NAME, type DestinationsFs } from './destinations-file'
import { createSurfaceStore } from './surface-store'

describe('createDestinationSelectionFile', () => {
  let dir: string

  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-destinations-')) })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('saves atomically, loads it back, and clears it', () => {
    const file = path.join(dir, 'nested', 'destinations.json')
    const store = createDestinationSelectionFile({ file, fs, now: () => 0, pid: 42 })
    expect(store.load()).toBeNull()
    expect(store.save({ allDevices: true, hosts: ['192.168.1.40'] })).toBe(true)
    expect(fs.readdirSync(path.dirname(file))).toEqual(['destinations.json'])
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({
      format: 'oscdesk-destinations', version: 1, savedAt: '1970-01-01T00:00:00.000Z', allDevices: true, hosts: ['192.168.1.40'],
    })
    expect(store.load()).toEqual({ allDevices: true, hosts: ['192.168.1.40'] })
    store.clear()
    expect(store.load()).toBeNull()
  })

  it('warns and starts from the config targets when the file is broken', () => {
    const file = path.join(dir, 'destinations.json')
    const logWarn = vi.fn()
    const store = createDestinationSelectionFile({ file, fs, logWarn })
    fs.writeFileSync(file, '{ not json')
    expect(store.load()).toBeNull()
    fs.writeFileSync(file, JSON.stringify({ format: 'oscdesk-destinations', version: 1, savedAt: 'x', allDevices: 'yes', hosts: [] }))
    expect(store.load()).toBeNull()
    expect(logWarn).toHaveBeenCalledTimes(2)
  })

  it('removes the temporary file and reports false when the write fails', () => {
    const logWarn = vi.fn()
    const failing: DestinationsFs = { ...fs, renameSync: () => { throw new Error('locked') } }
    const rmSync = vi.spyOn(failing, 'rmSync')
    const store = createDestinationSelectionFile({ file: path.join(dir, 'destinations.json'), fs: failing, pid: 7, logWarn })
    expect(store.save({ allDevices: false, hosts: ['192.168.1.40'] })).toBe(false)
    expect(rmSync).toHaveBeenCalledWith(expect.stringContaining('destinations.json.7.tmp'), { force: true })
    expect(logWarn).toHaveBeenCalledWith('(WARN, BRIDGE)', expect.stringContaining('locked'))
  })
})

describe('default destinations file name', () => {
  let dir: string

  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-destinations-name-')) })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('can never be a surface file, even when valuesDir is the surfaces dir', () => {
    expect(DEFAULT_DESTINATIONS_FILE_NAME).toBe('.destinations.json')
    expect(isValidSurfaceName(DEFAULT_DESTINATIONS_FILE_NAME.replace(/\.json$/, ''))).toBe(false)

    const surfaces = createSurfaceStore({ dir })
    const definition = { format: 'oscdesk-surface', version: 1, name: 'D', parameters: [], screens: [] }
    expect(surfaces.save('destinations', definition).ok).toBe(true)
    const selection = createDestinationSelectionFile({ file: path.join(dir, DEFAULT_DESTINATIONS_FILE_NAME), fs })
    expect(selection.save({ allDevices: false, hosts: ['192.168.1.40'] })).toBe(true)

    // 定義 destinations も選択も、互いを上書きしない。選択のファイルは定義の一覧に出ない
    expect(surfaces.read('destinations')).toMatchObject({ ok: true, value: { name: 'D' } })
    expect(selection.load()).toEqual({ allDevices: false, hosts: ['192.168.1.40'] })
    expect(surfaces.list()).toEqual(['destinations'])
  })
})