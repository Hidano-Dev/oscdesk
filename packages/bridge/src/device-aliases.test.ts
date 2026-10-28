import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DESTINATIONS, isValidSurfaceName } from '@oscdesk/shared'

import type { DestinationsFs } from './destinations-file'
import {
  aliasFor,
  createDeviceAliasFile,
  DEFAULT_DEVICE_ALIASES_FILE_NAME,
  normalizeAlias,
  updateAliases,
} from './device-aliases'

const MAC = 'aa:bb:cc:dd:ee:15'

describe('aliasFor', () => {
  it('prefers the MAC alias and falls back to the host alias', () => {
    const aliases = new Map([[`mac:${MAC}`, 'ステージ左 iPad'], ['host:192.168.1.30', '照明卓'], ['host:192.168.1.21', '古い名前']])
    // DHCP で IP が変わっても MAC で同じ名前が付く
    expect(aliasFor(aliases, '192.168.1.99', MAC)).toBe('ステージ左 iPad')
    // MAC の別名が host の別名に勝つ
    expect(aliasFor(aliases, '192.168.1.21', MAC)).toBe('ステージ左 iPad')
    // MAC の分からない端末は host で引く。MAC が分かった後も、MAC の別名が無ければ host の別名を出し続ける
    expect(aliasFor(aliases, '192.168.1.30', null)).toBe('照明卓')
    expect(aliasFor(aliases, '192.168.1.30', 'aa:bb:cc:dd:ee:30')).toBe('照明卓')
    expect(aliasFor(aliases, '192.168.1.40', null)).toBeNull()
    // 00:00:00:00:00:00 は MAC として扱わない
    expect(aliasFor(new Map([['mac:00:00:00:00:00:00', 'x']]), '192.168.1.40', '00:00:00:00:00:00')).toBeNull()
  })
})

describe('normalizeAlias', () => {
  it('trims, clears on empty and rejects long names and control characters', () => {
    expect(normalizeAlias('  照明卓 ')).toEqual({ ok: true, alias: '照明卓' })
    expect(normalizeAlias('   ')).toEqual({ ok: true, alias: null })
    expect(normalizeAlias(null)).toEqual({ ok: true, alias: null })
    expect(normalizeAlias('a'.repeat(DESTINATIONS.MAX_ALIAS_CHARS)).ok).toBe(true)
    expect(normalizeAlias('a'.repeat(DESTINATIONS.MAX_ALIAS_CHARS + 1))).toMatchObject({ ok: false, reason: expect.stringContaining('alias-too-long') })
    expect(normalizeAlias('a\nb')).toEqual({ ok: false, reason: 'alias-has-control-characters' })
  })
})

describe('updateAliases', () => {
  it('stores by MAC when known (moving a host alias over) and by host otherwise', () => {
    const byHost = updateAliases(new Map(), '192.168.1.21', null, '仮の名前')
    expect(byHost).toEqual({ ok: true, aliases: new Map([['host:192.168.1.21', '仮の名前']]) })
    // 走査で MAC が分かった後に付け直すと MAC で覚え、同じ host の別名は消す
    const byMac = updateAliases(byHost.ok ? byHost.aliases : new Map(), '192.168.1.21', MAC, 'ステージ左 iPad')
    expect(byMac).toEqual({ ok: true, aliases: new Map([[`mac:${MAC}`, 'ステージ左 iPad']]) })
  })

  it('clears both the MAC and the host alias', () => {
    const aliases = new Map([[`mac:${MAC}`, 'a'], ['host:192.168.1.21', 'b'], ['host:192.168.1.30', 'c']])
    expect(updateAliases(aliases, '192.168.1.21', MAC, null)).toEqual({ ok: true, aliases: new Map([['host:192.168.1.30', 'c']]) })
  })

  it('rejects a new key beyond the limit but still renames an existing one', () => {
    const full = new Map(Array.from({ length: DESTINATIONS.MAX_DEVICE_ALIASES }, (_, index) => [`host:10.0.${String(index >> 8)}.${String(index & 255)}`, 'x'] as const))
    expect(updateAliases(full, '192.168.1.21', null, 'new')).toMatchObject({ ok: false, reason: expect.stringContaining('too-many-aliases') })
    expect(updateAliases(full, '10.0.0.1', null, 'renamed').ok).toBe(true)
  })
})

describe('createDeviceAliasFile', () => {
  let dir: string

  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-aliases-')) })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('saves atomically and loads it back', () => {
    const file = path.join(dir, 'nested', DEFAULT_DEVICE_ALIASES_FILE_NAME)
    const store = createDeviceAliasFile({ file, fs, now: () => 0, pid: 42 })
    expect(store.load()).toEqual(new Map())
    const aliases = new Map([['host:192.168.1.30', '照明卓'], [`mac:${MAC}`, 'ステージ左 iPad']])
    expect(store.save(aliases)).toBe(true)
    expect(fs.readdirSync(path.dirname(file))).toEqual([DEFAULT_DEVICE_ALIASES_FILE_NAME])
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({
      format: 'oscdesk-device-aliases', version: 1, savedAt: '1970-01-01T00:00:00.000Z',
      aliases: [{ key: 'host:192.168.1.30', alias: '照明卓' }, { key: `mac:${MAC}`, alias: 'ステージ左 iPad' }],
    })
    expect(store.load()).toEqual(aliases)
  })

  it('warns and starts without aliases when the file is broken', () => {
    const file = path.join(dir, 'aliases.json')
    const logWarn = vi.fn()
    const store = createDeviceAliasFile({ file, fs, logWarn })
    fs.writeFileSync(file, '{ not json')
    expect(store.load()).toEqual(new Map())
    // キーの形が違う(MAC が大文字)・別名に改行がある
    for (const aliases of [[{ key: 'mac:AA:BB:CC:DD:EE:FF', alias: 'x' }], [{ key: 'host:192.168.1.30', alias: 'a\nb' }]]) {
      fs.writeFileSync(file, JSON.stringify({ format: 'oscdesk-device-aliases', version: 1, savedAt: 'x', aliases }))
      expect(store.load()).toEqual(new Map())
    }
    expect(logWarn).toHaveBeenCalledTimes(3)
  })

  it('removes the temporary file and reports false when the write fails', () => {
    const logWarn = vi.fn()
    const failing: DestinationsFs = { ...fs, renameSync: () => { throw new Error('locked') } }
    const rmSync = vi.spyOn(failing, 'rmSync')
    const store = createDeviceAliasFile({ file: path.join(dir, 'aliases.json'), fs: failing, pid: 7, logWarn })
    expect(store.save(new Map([['host:192.168.1.30', 'x']]))).toBe(false)
    expect(rmSync).toHaveBeenCalledWith(expect.stringContaining('aliases.json.7.tmp'), { force: true })
    expect(logWarn).toHaveBeenCalledWith('(WARN, BRIDGE)', expect.stringContaining('locked'))
  })

  it('uses a default file name that can never be a surface file', () => {
    expect(isValidSurfaceName(DEFAULT_DEVICE_ALIASES_FILE_NAME.replace(/\.json$/, ''))).toBe(false)
  })
})
