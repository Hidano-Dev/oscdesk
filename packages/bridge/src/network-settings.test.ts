import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DownstreamFrame } from '@oscdesk/shared'

import {
  checkNetworkSettings,
  createNetworkSettings,
  isBrowserAllowed,
  isLocalhost,
  matchesAnyCidr,
  normalizeAddress,
  parseCidr,
  selectableInterfaces,
  type NetworkSettings,
} from './network-settings'
import { createNetworkSettingsFile, type NetworkSettingsStore } from './network-settings-file'
import type { ScanInterface } from './lan-scan'

const LAN: ScanInterface = { name: 'Ethernet', address: '192.168.1.10', netmask: '255.255.255.0', family: 'IPv4', internal: false }
const WIFI: ScanInterface = { name: 'Wi-Fi', address: '10.0.0.20', netmask: '255.255.255.0', family: 'IPv4', internal: false }
const LOOPBACK: ScanInterface = { name: 'lo', address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', internal: true }

describe('CIDR', () => {
  it('reads IPv4 CIDR, rounds it to the network address, and rejects non-canonical forms', () => {
    expect(parseCidr('192.168.1.10/24')?.text).toBe('192.168.1.0/24')
    expect(parseCidr(' 10.0.0.0/8 ')?.text).toBe('10.0.0.0/8')
    expect(parseCidr('0.0.0.0/0')?.text).toBe('0.0.0.0/0')
    for (const bad of ['192.168.1.0', '192.168.001.0/24', '192.168.1.0/33', '192.168.1.0/024', '192.168.1/24', 'abc/24', '']) {
      expect(parseCidr(bad), bad).toBeNull()
    }
  })

  it('reads a bare address as one device when allowed, and IPv6 unless IPv4 only', () => {
    expect(parseCidr('192.168.1.5', { bareAddress: true })?.text).toBe('192.168.1.5/32')
    expect(parseCidr('FE80::1', { bareAddress: true })?.text).toBe('fe80::1/128')
    expect(parseCidr('::/0')?.text).toBe('::/0')
    expect(parseCidr('fe80::/10', { ipv4Only: true })).toBeNull()
    expect(parseCidr('fe80::1%eth0', { bareAddress: true })).toBeNull()
    expect(parseCidr('::/129')).toBeNull()
  })

  it('matches addresses, treating IPv4-mapped IPv6 as IPv4', () => {
    expect(matchesAnyCidr('192.168.1.77', ['192.168.1.0/24'])).toBe(true)
    expect(matchesAnyCidr('::ffff:192.168.1.77', ['192.168.1.0/24'])).toBe(true)
    expect(matchesAnyCidr('192.168.2.1', ['192.168.1.0/24'])).toBe(false)
    expect(matchesAnyCidr('fe80::5', ['fe80::/10'])).toBe(true)
    expect(matchesAnyCidr('192.168.1.5', ['192.168.1.5'])).toBe(true)
    expect(matchesAnyCidr('not-an-address', ['0.0.0.0/0', '::/0'])).toBe(false)
    // ファミリーの違う範囲には当てない(UI の判定と揃える)
    expect(matchesAnyCidr('192.168.1.77', ['::/0'])).toBe(false)
    expect(matchesAnyCidr('::ffff:192.168.1.77', ['::/0'])).toBe(false)
    expect(matchesAnyCidr('fe80::5', ['0.0.0.0/0'])).toBe(false)
    expect(normalizeAddress('::FFFF:10.0.0.1')).toBe('10.0.0.1')
  })
})

describe('allowed browsers', () => {
  it('always allows the localhost of this PC, even with an empty list', () => {
    for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      expect(isLocalhost(address), address).toBe(true)
      expect(isBrowserAllowed(address, []), address).toBe(true)
    }
    // ループバックの別アドレスは localhost として扱わない
    expect(isLocalhost('127.0.0.2')).toBe(false)
    expect(isBrowserAllowed('127.0.0.2', [])).toBe(false)
    expect(isBrowserAllowed('192.168.1.30', [])).toBe(false)
    expect(isBrowserAllowed('192.168.1.30', ['192.168.1.0/24'])).toBe(true)
  })
})

describe('checkNetworkSettings', () => {
  const selectableAddresses = new Set(['127.0.0.1', '192.168.1.10'])

  it('normalizes and de-duplicates the lists', () => {
    const checked = checkNetworkSettings(
      { targetInterface: '0.0.0.0', targetRanges: ['192.168.1.10/24', '192.168.1.0/24'], allowedBrowsers: ['192.168.1.30', '192.168.1.30/32', '::/0'] },
      { selectableAddresses, requesters: ['127.0.0.1'] },
    )
    expect(checked).toEqual({
      ok: true,
      settings: { targetInterface: null, targetRanges: ['192.168.1.0/24'], allowedBrowsers: ['192.168.1.30/32', '::/0'] },
    })
  })

  it('rejects a change that would lock out the browser making it', () => {
    const input = { targetInterface: null, targetRanges: [], allowedBrowsers: ['10.0.0.0/24'] }
    expect(checkNetworkSettings(input, { selectableAddresses, requesters: ['192.168.1.30'] }))
      .toEqual({ ok: false, reason: 'would-lock-out: 192.168.1.30' })
    // UI のプロセス(localhost)が中継しても、名乗ったブラウザのアドレスで判定する
    expect(checkNetworkSettings(input, { selectableAddresses, requesters: ['127.0.0.1', '::ffff:192.168.1.30'] }))
      .toEqual({ ok: false, reason: 'would-lock-out: 192.168.1.30' })
    // localhost からなら、空(localhost だけ)にもできる
    expect(checkNetworkSettings({ ...input, allowedBrowsers: [] }, { selectableAddresses, requesters: ['127.0.0.1', '::1'] }).ok).toBe(true)
    // IPv4 の操作元は IPv6 だけの許可リストでは締め出される
    expect(checkNetworkSettings({ ...input, allowedBrowsers: ['::/0'] }, { selectableAddresses, requesters: ['192.168.1.30'] }))
      .toEqual({ ok: false, reason: 'would-lock-out: 192.168.1.30' })
    // 読めない操作元は許可に当たらないので断る側に倒す
    expect(checkNetworkSettings({ ...input, allowedBrowsers: ['0.0.0.0/0'] }, { selectableAddresses, requesters: ['garbage'] }).ok).toBe(false)
  })

  it('rejects an interface that is not on this PC and malformed ranges', () => {
    expect(checkNetworkSettings({ targetInterface: '192.168.9.9', targetRanges: [], allowedBrowsers: [] }, { selectableAddresses, requesters: [] }))
      .toEqual({ ok: false, reason: 'invalid-target-interface: 192.168.9.9' })
    expect(checkNetworkSettings({ targetInterface: null, targetRanges: ['fe80::/10'], allowedBrowsers: [] }, { selectableAddresses, requesters: [] }))
      .toEqual({ ok: false, reason: 'invalid-target-range: fe80::/10' })
    expect(checkNetworkSettings({ targetInterface: null, targetRanges: ['192.168.1.5'], allowedBrowsers: [] }, { selectableAddresses, requesters: [] }))
      .toEqual({ ok: false, reason: 'invalid-target-range: 192.168.1.5' })
    expect(checkNetworkSettings({ targetInterface: null, targetRanges: [], allowedBrowsers: ['nope'] }, { selectableAddresses, requesters: [] }))
      .toEqual({ ok: false, reason: 'invalid-allowed-browser: nope' })
  })

  it('offers localhost and the IPv4 addresses of this PC as target interfaces', () => {
    expect(selectableInterfaces([LOOPBACK, LAN, WIFI, { ...LAN, name: 'dup' }, { name: 'v6', address: 'fe80::1', netmask: 'ffff::', family: 'IPv6', internal: false }]))
      .toEqual([{ address: '127.0.0.1', name: 'localhost' }, { address: '192.168.1.10', name: 'Ethernet' }, { address: '10.0.0.20', name: 'Wi-Fi' }])
  })
})

describe('network settings file', () => {
  let dir: string

  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-network-settings-')) })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('saves the settings and reads them back', () => {
    const file = path.join(dir, 'nested', '.network-settings.json')
    const store = createNetworkSettingsFile({ file, fs, now: () => 0, pid: 3 })
    expect(store.load()).toBeNull()
    const settings: NetworkSettings = { targetInterface: '192.168.1.10', targetRanges: ['192.168.1.0/24'], allowedBrowsers: ['192.168.1.0/24', '::1/128'] }
    expect(store.save(settings)).toBe(true)
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({
      format: 'oscdesk-network-settings', version: 1, savedAt: '1970-01-01T00:00:00.000Z', ...settings,
    })
    expect(store.load()).toEqual(settings)
  })

  it('warns and falls back to the defaults when the file is broken or holds a malformed range', () => {
    const file = path.join(dir, '.network-settings.json')
    const logWarn = vi.fn()
    const store = createNetworkSettingsFile({ file, fs, logWarn })
    fs.writeFileSync(file, '{ nope')
    expect(store.load()).toBeNull()
    fs.writeFileSync(file, JSON.stringify({ format: 'oscdesk-network-settings', version: 1, savedAt: 'x', targetInterface: null, targetRanges: ['bad'], allowedBrowsers: [] }))
    expect(store.load()).toBeNull()
    expect(logWarn).toHaveBeenCalledTimes(2)
  })
})

function memoryStore(initial: NetworkSettings | null = null, writable = true): NetworkSettingsStore & { saved: NetworkSettings[] } {
  const saved: NetworkSettings[] = []
  return {
    file: 'memory',
    saved,
    load: () => initial,
    save: settings => {
      if (!writable) return false
      saved.push(settings)
      return true
    },
  }
}

function setup(options: { store?: ReturnType<typeof memoryStore>; rebind?: (host: string) => Promise<void>; peer?: string } = {}) {
  const frames: { frame: DownstreamFrame; clientId: string | undefined }[] = []
  const store = options.store ?? memoryStore()
  const rebind = vi.fn(options.rebind ?? (async () => undefined))
  const onScopeChanged = vi.fn()
  const onAllowedChanged = vi.fn()
  const manager = createNetworkSettings({
    configListenHost: '0.0.0.0',
    store,
    interfaces: () => [LOOPBACK, LAN, WIFI],
    rebind,
    onScopeChanged,
    onAllowedChanged,
    peerOf: clientId => clientId === 'gone' ? undefined : options.peer ?? '127.0.0.1',
    publish: (frame, clientId) => frames.push({ frame, clientId }),
    logInfo: () => undefined,
    logWarn: () => undefined,
  })
  return { manager, frames, store, rebind, onScopeChanged, onAllowedChanged }
}

describe('createNetworkSettings', () => {
  it('starts from the defaults (all networks, automatic range, every browser allowed)', () => {
    const { manager, frames } = setup()
    expect(manager.start()).toEqual({ bindHost: '0.0.0.0' })
    manager.publish('c1')
    expect(frames).toEqual([{
      clientId: 'c1',
      frame: {
        v: 1, type: 'networkSettings', revision: 0, targetInterface: null, targetRanges: [], allowedBrowsers: ['0.0.0.0/0', '::/0'],
        interfaces: [{ address: '127.0.0.1', name: 'localhost' }, { address: '192.168.1.10', name: 'Ethernet' }, { address: '10.0.0.20', name: 'Wi-Fi' }],
        source: 'default',
      },
    }])
    expect(manager.isBrowserAllowed('203.0.113.5')).toBe(true)
  })

  it('restores saved settings, but listens as the config says when the saved address left this PC', () => {
    const restored = setup({ store: memoryStore({ targetInterface: '192.168.1.10', targetRanges: [], allowedBrowsers: [] }) })
    expect(restored.manager.start()).toEqual({ bindHost: '192.168.1.10' })
    expect(restored.manager.isBrowserAllowed('192.168.1.30')).toBe(false)
    const moved = setup({ store: memoryStore({ targetInterface: '172.16.0.9', targetRanges: [], allowedBrowsers: [] }) })
    expect(moved.manager.start()).toEqual({ bindHost: '0.0.0.0' })
  })

  it('applies a change: rebinds the target socket, saves it, rescopes, closes disallowed peers, and tells every UI', async () => {
    const { manager, frames, store, rebind, onScopeChanged, onAllowedChanged } = setup()
    manager.start()
    expect(manager.handleUiFrame({ v: 1, type: 'networkSettingsSet', revision: 0, targetInterface: '192.168.1.10', targetRanges: ['192.168.1.0/25'], allowedBrowsers: ['192.168.1.0/24'], browser: '192.168.1.30' }, 'c1')).toBe(true)
    await manager.idle()
    expect(rebind).toHaveBeenCalledWith('192.168.1.10')
    expect(store.saved).toEqual([{ targetInterface: '192.168.1.10', targetRanges: ['192.168.1.0/25'], allowedBrowsers: ['192.168.1.0/24'] }])
    expect(onScopeChanged).toHaveBeenCalledTimes(1)
    expect(onAllowedChanged).toHaveBeenCalledTimes(1)
    expect(frames.at(-1)).toMatchObject({ clientId: undefined, frame: { type: 'networkSettings', targetInterface: '192.168.1.10', source: 'saved' } })
    expect(manager.scope()).toEqual({ targetInterface: '192.168.1.10', targetRanges: ['192.168.1.0/25'] })
    expect(manager.isBrowserAllowed('10.0.0.5')).toBe(false)
    expect(manager.isBrowserAllowed('127.0.0.1')).toBe(true)
  })

  it('does not rebind when only the lists change', async () => {
    const { manager, rebind, onScopeChanged, onAllowedChanged } = setup()
    manager.start()
    manager.handleUiFrame({ v: 1, type: 'networkSettingsSet', revision: 0, targetInterface: null, targetRanges: [], allowedBrowsers: ['192.168.1.0/24'] }, 'c1')
    await manager.idle()
    expect(rebind).not.toHaveBeenCalled()
    expect(onScopeChanged).not.toHaveBeenCalled()
    expect(onAllowedChanged).toHaveBeenCalledTimes(1)
  })

  it('rejects a lock-out to the requester only and keeps the settings', async () => {
    const { manager, frames, store, rebind } = setup({ peer: '192.168.1.30' })
    manager.start()
    manager.handleUiFrame({ v: 1, type: 'networkSettingsSet', revision: 0, targetInterface: '192.168.1.10', targetRanges: [], allowedBrowsers: ['10.0.0.0/24'] }, 'c1')
    await manager.idle()
    expect(rebind).not.toHaveBeenCalled()
    expect(store.saved).toEqual([])
    expect(frames[0]).toEqual({ clientId: 'c1', frame: { v: 1, type: 'notice', level: 'error', code: 'network-settings-rejected', detail: 'would-lock-out: 192.168.1.30' } })
    expect(frames[1]).toMatchObject({ clientId: 'c1', frame: { type: 'networkSettings', allowedBrowsers: ['0.0.0.0/0', '::/0'] } })
  })

  it('reports a failed rebind and keeps the previous settings', async () => {
    const { manager, frames, store } = setup({ rebind: async () => { throw new Error('EADDRNOTAVAIL') } })
    manager.start()
    manager.handleUiFrame({ v: 1, type: 'networkSettingsSet', revision: 0, targetInterface: '10.0.0.20', targetRanges: [], allowedBrowsers: ['0.0.0.0/0'] }, 'c1')
    await manager.idle()
    expect(store.saved).toEqual([])
    expect(frames[0]).toMatchObject({ clientId: 'c1', frame: { code: 'network-settings-rejected', detail: 'rebind-failed: EADDRNOTAVAIL' } })
    expect(manager.current.targetInterface).toBeNull()
  })

  it('keeps an unsaved change in effect and says so', async () => {
    const { manager, frames } = setup({ store: memoryStore(null, false) })
    manager.start()
    manager.handleUiFrame({ v: 1, type: 'networkSettingsSet', revision: 0, targetInterface: null, targetRanges: ['10.0.0.0/24'], allowedBrowsers: ['0.0.0.0/0'] }, 'c1')
    await manager.idle()
    expect(frames.map(entry => entry.frame.type === 'notice' ? entry.frame.code : entry.frame.type)).toEqual(['network-settings-save-failed', 'networkSettings'])
    expect(frames[1]).toMatchObject({ frame: { source: 'unsaved', targetRanges: ['10.0.0.0/24'] } })
  })

  it('processes changes one at a time in arrival order', async () => {
    let release: () => void = () => undefined
    const order: string[] = []
    const { manager } = setup({
      rebind: host => new Promise(resolve => {
        order.push(`rebind ${host}`)
        release = resolve
      }),
    })
    manager.start()
    manager.handleUiFrame({ v: 1, type: 'networkSettingsSet', revision: 0, targetInterface: '192.168.1.10', targetRanges: [], allowedBrowsers: ['0.0.0.0/0'] }, 'c1')
    // 2 つ目は 1 つ目を適用した後の版(1)を持つ画面からの変更
    manager.handleUiFrame({ v: 1, type: 'networkSettingsSet', revision: 1, targetInterface: '10.0.0.20', targetRanges: [], allowedBrowsers: ['0.0.0.0/0'] }, 'c1')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(order).toEqual(['rebind 192.168.1.10'])
    release()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(order).toEqual(['rebind 192.168.1.10', 'rebind 10.0.0.20'])
    release()
    await manager.idle()
    expect(manager.current.targetInterface).toBe('10.0.0.20')
  })

  it('advances the revision on each change and rejects a change made from an older revision', async () => {
    const { manager, frames, store } = setup()
    manager.start()
    manager.handleUiFrame({ v: 1, type: 'networkSettingsSet', revision: 0, targetInterface: null, targetRanges: ['10.0.0.0/24'], allowedBrowsers: ['0.0.0.0/0'] }, 'c1')
    await manager.idle()
    expect(frames.at(-1)).toMatchObject({ clientId: undefined, frame: { type: 'networkSettings', revision: 1 } })
    // 版 0 の画面のまま送られた変更は、先の変更を上書きしない
    manager.handleUiFrame({ v: 1, type: 'networkSettingsSet', revision: 0, targetInterface: null, targetRanges: [], allowedBrowsers: ['0.0.0.0/0'] }, 'c1')
    await manager.idle()
    expect(store.saved).toHaveLength(1)
    expect(frames.at(-2)).toEqual({ clientId: 'c1', frame: { v: 1, type: 'notice', level: 'error', code: 'network-settings-rejected', detail: 'stale-revision: 0 (current 1)' } })
    expect(frames.at(-1)).toMatchObject({ clientId: 'c1', frame: { type: 'networkSettings', revision: 1, targetRanges: ['10.0.0.0/24'] } })
  })

  it('rejects a change relayed for a browser that the current allowlist no longer covers (shared UI connection)', async () => {
    // UI のプロセスは localhost から 1 本の接続で複数のページを中継する。ブラウザ A(192.168.1.30)が B(192.168.1.40)を
    // 範囲の外にした後、接続に残っていた B の「保存して適用」が B を含む許可リストへ戻してはならない
    const { manager, frames, store } = setup({ peer: '127.0.0.1' })
    manager.start()
    manager.handleUiFrame({ v: 1, type: 'networkSettingsSet', revision: 0, targetInterface: null, targetRanges: [], allowedBrowsers: ['192.168.1.30/32'], browser: '192.168.1.30' }, 'c1')
    // B の要求(A の変更より前の版の画面から)
    manager.handleUiFrame({ v: 1, type: 'networkSettingsSet', revision: 0, targetInterface: null, targetRanges: [], allowedBrowsers: ['192.168.1.0/24'], browser: '192.168.1.40' }, 'c1')
    // B が新しい版を知っていても、今の許可リストの外からの変更は断る
    manager.handleUiFrame({ v: 1, type: 'networkSettingsSet', revision: 1, targetInterface: null, targetRanges: [], allowedBrowsers: ['192.168.1.0/24'], browser: '192.168.1.40' }, 'c1')
    await manager.idle()
    expect(store.saved).toEqual([{ targetInterface: null, targetRanges: [], allowedBrowsers: ['192.168.1.30/32'] }])
    const notices = frames.flatMap(entry => entry.frame.type === 'notice' ? [entry.frame.detail] : [])
    expect(notices).toEqual(['stale-revision: 0 (current 1)', 'not-allowed: 192.168.1.40'])
    expect(manager.current.allowedBrowsers).toEqual(['192.168.1.30/32'])
    expect(manager.isBrowserAllowed('192.168.1.40')).toBe(false)
  })

  it('rejects a change from a peer outside the current allowlist', async () => {
    const { manager, frames, store } = setup({ peer: '10.0.0.5', store: memoryStore({ targetInterface: null, targetRanges: [], allowedBrowsers: ['192.168.1.0/24'] }) })
    manager.start()
    manager.handleUiFrame({ v: 1, type: 'networkSettingsSet', revision: 0, targetInterface: null, targetRanges: [], allowedBrowsers: ['0.0.0.0/0'] }, 'c1')
    await manager.idle()
    expect(store.saved).toEqual([])
    expect(frames[0]).toMatchObject({ clientId: 'c1', frame: { code: 'network-settings-rejected', detail: 'not-allowed: 10.0.0.5' } })
  })

  it('ignores a change from a connection that has already closed', async () => {
    const { manager, frames, store } = setup()
    manager.start()
    manager.handleUiFrame({ v: 1, type: 'networkSettingsSet', revision: 0, targetInterface: null, targetRanges: [], allowedBrowsers: [] }, 'gone')
    await manager.idle()
    expect(frames).toEqual([])
    expect(store.saved).toEqual([])
  })
})
