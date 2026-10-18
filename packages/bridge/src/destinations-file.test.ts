import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDestinationSelectionFile, type DestinationsFs } from './destinations-file'

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
