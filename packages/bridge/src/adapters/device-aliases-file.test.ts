import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isValidSurfaceName } from '@oscdesk/shared'

import type { AliasEntry } from '../domain/device-aliases'
import { createDeviceAliasFile, DEFAULT_DEVICE_ALIASES_FILE_NAME } from './device-aliases-file'
import type { JsonFileFs } from './json-file'

const MAC = 'aa:bb:cc:dd:ee:15'
const table = (entries: [string, AliasEntry][]) => new Map(entries)

describe('createDeviceAliasFile', () => {
  let dir: string

  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-aliases-')) })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('saves atomically and loads it back, including host keys with spaces', () => {
    const file = path.join(dir, 'nested', DEFAULT_DEVICE_ALIASES_FILE_NAME)
    const store = createDeviceAliasFile({ file, fs, now: () => 0, pid: 42 })
    expect(store.load()).toEqual(new Map())
    const aliases = table([['host:192.168.1.30', { alias: '照明卓' }], [`mac:${MAC}`, { alias: 'ステージ左 iPad', host: '192.168.1.21' }], ['host:stage pc', { alias: '舞台袖' }]])
    expect(store.save(aliases)).toBe(true)
    expect(fs.readdirSync(path.dirname(file))).toEqual([DEFAULT_DEVICE_ALIASES_FILE_NAME])
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({
      format: 'oscdesk-device-aliases', version: 1, savedAt: '1970-01-01T00:00:00.000Z',
      aliases: [
        { key: 'host:192.168.1.30', alias: '照明卓' },
        { key: 'host:stage pc', alias: '舞台袖' },
        { key: `mac:${MAC}`, alias: 'ステージ左 iPad', host: '192.168.1.21' },
      ],
    })
    expect(store.load()).toEqual(aliases)
  })

  it('keeps the valid entries of a hand-edited file and normalizes MAC spellings', () => {
    const file = path.join(dir, 'aliases.json')
    const logWarn = vi.fn()
    fs.writeFileSync(file, JSON.stringify({
      format: 'oscdesk-device-aliases', version: 1, savedAt: 'x',
      aliases: [
        { key: 'mac:AA-BB-CC-DD-EE-FF', alias: ' 大文字とハイフン ' },
        { key: 'host:192.168.1.30', alias: 'a\nb' },
        { key: 'mac:not-a-mac', alias: 'x' },
        { key: 'host:192.168.1.31', alias: '残る' },
      ],
    }))
    const store = createDeviceAliasFile({ file, fs, logWarn })
    expect(store.load()).toEqual(table([['mac:aa:bb:cc:dd:ee:ff', { alias: '大文字とハイフン' }], ['host:192.168.1.31', { alias: '残る' }]]))
    expect(logWarn).toHaveBeenCalledWith('(WARN, BRIDGE)', expect.stringContaining('ignored 2 invalid'))
    // 読めた件は保存できる(書き損じの件は落ちる)
    expect(store.save(store.load())).toBe(true)
  })

  it('does not overwrite a file it could not read', () => {
    const file = path.join(dir, 'aliases.json')
    const logWarn = vi.fn()
    const store = createDeviceAliasFile({ file, fs, logWarn })
    for (const text of ['{ not json', JSON.stringify({ format: 'something-else', version: 1, savedAt: 'x', aliases: [] })]) {
      fs.writeFileSync(file, text)
      expect(store.load()).toEqual(new Map())
      // 手で直すまで内容を残す(上書きすると、1 か所の書き損じで全部の別名が消える)
      expect(store.save(table([['host:192.168.1.30', { alias: 'x' }]]))).toBe(false)
      expect(fs.readFileSync(file, 'utf8')).toBe(text)
    }
    expect(logWarn).toHaveBeenCalledWith('(WARN, BRIDGE)', expect.stringContaining('Not overwriting'))
  })

  it('removes the temporary file and reports false when the write fails', () => {
    const logWarn = vi.fn()
    const failing: JsonFileFs = { ...fs, renameSync: () => { throw new Error('locked') } }
    const rmSync = vi.spyOn(failing, 'rmSync')
    const store = createDeviceAliasFile({ file: path.join(dir, 'aliases.json'), fs: failing, pid: 7, logWarn })
    expect(store.save(table([['host:192.168.1.30', { alias: 'x' }]]))).toBe(false)
    expect(rmSync).toHaveBeenCalledWith(expect.stringContaining('aliases.json.7.tmp'), { force: true })
    expect(logWarn).toHaveBeenCalledWith('(WARN, BRIDGE)', expect.stringContaining('locked'))
  })

  it('uses a default file name that can never be a surface file', () => {
    expect(isValidSurfaceName(DEFAULT_DEVICE_ALIASES_FILE_NAME.replace(/\.json$/, ''))).toBe(false)
  })
})
