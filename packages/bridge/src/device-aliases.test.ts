import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DESTINATIONS, isValidSurfaceName } from '@oscdesk/shared'

import {
  aliasFor,
  createDeviceAliasFile,
  DEFAULT_DEVICE_ALIASES_FILE_NAME,
  followMacs,
  lastSeenMacs,
  normalizeAlias,
  updateAliases,
  type AliasEntry,
} from './device-aliases'
import type { JsonFileFs } from './json-file'

const MAC = 'aa:bb:cc:dd:ee:15'
const table = (entries: [string, AliasEntry][]) => new Map(entries)

describe('aliasFor', () => {
  it('prefers the MAC alias and falls back to the host alias', () => {
    const aliases = table([[`mac:${MAC}`, { alias: 'ステージ左 iPad' }], ['host:192.168.1.30', { alias: '照明卓' }], ['host:192.168.1.21', { alias: '古い名前' }]])
    // DHCP で IP が変わっても MAC で同じ名前が付く
    expect(aliasFor(aliases, '192.168.1.99', MAC)).toBe('ステージ左 iPad')
    // MAC の別名が host の別名に勝つ
    expect(aliasFor(aliases, '192.168.1.21', MAC)).toBe('ステージ左 iPad')
    // MAC の分からない端末は host で引く。MAC が分かった後も、MAC の別名が無ければ host の別名を出し続ける
    expect(aliasFor(aliases, '192.168.1.30', null)).toBe('照明卓')
    expect(aliasFor(aliases, '192.168.1.30', 'aa:bb:cc:dd:ee:30')).toBe('照明卓')
    expect(aliasFor(aliases, '192.168.1.40', null)).toBeNull()
  })
})

describe('normalizeAlias', () => {
  it('trims, clears on empty and rejects long names and control characters', () => {
    expect(normalizeAlias('  照明卓 ')).toEqual({ ok: true, alias: '照明卓' })
    expect(normalizeAlias('   ')).toEqual({ ok: true, alias: null })
    expect(normalizeAlias(null)).toEqual({ ok: true, alias: null })
    expect(normalizeAlias('a'.repeat(DESTINATIONS.MAX_ALIAS_CHARS)).ok).toBe(true)
    expect(normalizeAlias('a'.repeat(DESTINATIONS.MAX_ALIAS_CHARS + 1))).toMatchObject({ ok: false, reason: expect.stringContaining('alias-too-long') })
    // 数え方は UTF-16 の単位(サロゲートペアの絵文字は 2)。UI と同じ
    expect(normalizeAlias('😀'.repeat(32)).ok).toBe(true)
    expect(normalizeAlias(`${'😀'.repeat(32)}a`).ok).toBe(false)
    expect(normalizeAlias('a\nb')).toEqual({ ok: false, reason: 'alias-has-control-characters' })
  })

  it('rejects lone surrogates but keeps surrogate pairs', () => {
    // 保存すると Python の UI が destinations を符号化できずフレームごと捨てる
    expect(normalizeAlias('\ud800')).toEqual({ ok: false, reason: 'alias-has-lone-surrogates' })
    expect(normalizeAlias('a\udc00b')).toEqual({ ok: false, reason: 'alias-has-lone-surrogates' })
    expect(normalizeAlias('\udc00\ud800')).toEqual({ ok: false, reason: 'alias-has-lone-surrogates' })
    expect(normalizeAlias('卓😀')).toEqual({ ok: true, alias: '卓😀' })
  })
})

describe('updateAliases', () => {
  it('stores by MAC with the last seen host when known (moving a host alias over) and by host otherwise', () => {
    const byHost = updateAliases(new Map(), '192.168.1.21', null, '仮の名前')
    expect(byHost).toEqual({ ok: true, aliases: table([['host:192.168.1.21', { alias: '仮の名前' }]]) })
    // 走査で MAC が分かった後に付け直すと MAC で覚え、同じ host の別名は消す
    const byMac = updateAliases(byHost.ok ? byHost.aliases : new Map(), '192.168.1.21', MAC, 'ステージ左 iPad')
    expect(byMac).toEqual({ ok: true, aliases: table([[`mac:${MAC}`, { alias: 'ステージ左 iPad', host: '192.168.1.21' }]]) })
  })

  it('clears both the MAC and the host alias', () => {
    const aliases = table([[`mac:${MAC}`, { alias: 'a', host: '192.168.1.21' }], ['host:192.168.1.21', { alias: 'b' }], ['host:192.168.1.30', { alias: 'c' }]])
    expect(updateAliases(aliases, '192.168.1.21', MAC, null)).toEqual({ ok: true, aliases: table([['host:192.168.1.30', { alias: 'c' }]]) })
  })

  it('rejects a new key beyond the limit but still renames an existing one', () => {
    const full = new Map(Array.from({ length: DESTINATIONS.MAX_DEVICE_ALIASES }, (_, index) => [`host:10.0.${String(index >> 8)}.${String(index & 255)}`, { alias: 'x' }] as const))
    expect(updateAliases(full, '192.168.1.21', null, 'new')).toMatchObject({ ok: false, reason: expect.stringContaining('too-many-aliases') })
    expect(updateAliases(full, '10.0.0.1', null, 'renamed').ok).toBe(true)
    // host の別名を MAC へ移すだけなら件数は増えない
    expect(updateAliases(full, '10.0.0.1', MAC, 'moved').ok).toBe(true)
  })
})

describe('lastSeenMacs / followMacs', () => {
  it('remembers where each MAC alias was last seen and follows it to a new host', () => {
    const aliases = table([[`mac:${MAC}`, { alias: 'a', host: '192.168.1.21' }], ['mac:aa:bb:cc:dd:ee:16', { alias: 'b' }], ['host:192.168.1.30', { alias: 'c' }]])
    expect(lastSeenMacs(aliases)).toEqual(new Map([['192.168.1.21', MAC]]))
    // 別の端末が .21 に来て、MAC の端末は .40 へ移った
    const followed = followMacs(aliases, [{ host: '192.168.1.21', mac: 'aa:bb:cc:dd:ee:16' }, { host: '192.168.1.40', mac: MAC }, { host: '192.168.1.50', mac: null }])
    expect(followed.changed).toBe(true)
    expect(lastSeenMacs(followed.aliases)).toEqual(new Map([['192.168.1.21', 'aa:bb:cc:dd:ee:16'], ['192.168.1.40', MAC]]))
    expect(followMacs(followed.aliases, [{ host: '192.168.1.40', mac: MAC }]).changed).toBe(false)
  })
})

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
