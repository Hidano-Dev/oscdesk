// 宛先パネルの規則(D-138。HID-461 の試作から)の純粋関数のテスト
import { describe, expect, it } from 'vitest'

import {
  aliasFromInput,
  aliasKeyHint,
  allDevicesLabel,
  allDevicesTooltip,
  coveringNetwork,
  deviceCaption,
  deviceName,
  groupDevices,
  isChecked,
  matchDevices,
  selectionWith,
  selectionWithout,
  toggledHosts,
  toggledNetworks,
  type Device,
  type Selection,
} from './destinations-logic'
import { destinationsSample } from './test-support'

const sel = (allDevices: boolean, networks: string[], hosts: string[]): Selection => ({ allDevices, networks, hosts })
const device = (host: string, extra: Partial<Device> = {}): Device => ({
  host, hostname: null, alias: null, mac: null, interface: 'LAN', self: false, configured: false, found: true, ...extra,
})
const matches = (target: Device, query: string) => matchDevices([target], query).matched[0]

describe('names and captions', () => {
  it('prefers the alias, then the looked-up name, then the IP', () => {
    const frame = destinationsSample('downstream-destinations')
    expect(frame.devices.map(deviceName)).toEqual(['control-pc', 'unity-main', '192.168.1.21', '192.168.1.30'])
    expect(frame.devices.map(deviceCaption)).toEqual([
      '192.168.1.10 / サーバー PC', '192.168.1.20 / 設定の宛先', '', 'OSCQuery で見つかっていません',
    ])
    expect(allDevicesLabel(frame)).toBe('全てのデバイス')
    expect(allDevicesTooltip(frame)).toBe('送り先: 192.168.1.255')
    expect(allDevicesLabel(frame, true)).toBe('表示中の全てのデバイス')
    expect(allDevicesLabel({ ...frame, broadcasts: [] })).toBe('全てのデバイス(IPv4 のネットワークが見つかりません)')

    const aliased = destinationsSample('downstream-destinations-aliases')
    expect(aliased.devices.map(deviceName)).toEqual(['操作卓', 'ステージ左 iPad', '照明卓'])
    expect(aliased.devices.map(deviceCaption)).toEqual([
      'control-pc / 192.168.1.10 / サーバー PC', '192.168.1.21', 'light-desk / 192.168.1.30 / OSCQuery で見つかっていません',
    ])
    expect(aliasKeyHint(aliased.devices[1])).toMatch(/^MAC aa:bb:cc:dd:ee:15 で覚えます/)
    expect(aliasKeyHint(aliased.devices[2])).toMatch(/^MAC が分からないため 192.168.1.30 で覚えます/)
  })
})

describe('alias input', () => {
  it('trims, clears when empty and counts UTF-16 units like the bridge', () => {
    expect(aliasFromInput('  照明卓 ')).toEqual({ ok: true, alias: '照明卓' })
    expect(aliasFromInput('   ')).toEqual({ ok: true, alias: null })
    expect(aliasFromInput(null)).toEqual({ ok: true, alias: null })
    expect(aliasFromInput('a'.repeat(64)).ok).toBe(true)
    expect(aliasFromInput('a'.repeat(65)).ok).toBe(false)
    expect(aliasFromInput('a\tb').ok).toBe(false)
    expect(aliasFromInput('😀'.repeat(32)).ok).toBe(true)
    expect(aliasFromInput('😀'.repeat(32) + 'a').ok).toBe(false)
    expect(aliasFromInput('卓\ud800').ok).toBe(false)
  })
})

describe('search', () => {
  it('matches name, IP, MAC and interface as a case-insensitive regular expression', () => {
    const target = destinationsSample('downstream-destinations').devices[1]
    for (const query of ['', '  ', 'UNITY', '1.20', 'ee:14', 'ether', '^192\\.168\\.1\\.2\\d$', '\\.(10|20)$', 'Unity-M.*']) {
      expect(matches(target, query), query).toBe(true)
    }
    for (const query of ['control', '^192\\.168\\.1\\.1\\d$', '\\.21$', '^main']) expect(matches(target, query), query).toBe(false)
  })

  it('falls back to a literal match while the expression cannot be read', () => {
    const target = destinationsSample('downstream-destinations').devices[1]
    expect(matchDevices([target], '192.168.(')).toEqual({ matched: [false], fallback: 'invalid' })
    expect(matches({ ...target, hostname: 'stage(a)' }, 'stage(')).toBe(true)
  })
})

describe('networks', () => {
  it('groups devices by the narrowest network and keeps the rest last', () => {
    const frame = destinationsSample('downstream-destinations-networks')
    expect(groupDevices(frame).map((group) => [group.broadcast?.network ?? null, group.devices.map((item) => item.host)])).toEqual([
      ['192.168.1.0/24', ['192.168.1.10', '192.168.1.20']],
      ['10.0.0.0/24', ['10.0.0.5', '10.0.0.40']],
    ])
    const stage = { ...frame.devices[0], host: 'stage-pc', hostname: null }
    expect(groupDevices({ ...frame, devices: [...frame.devices, stage] }).at(-1)?.devices).toEqual([stage])
    expect(coveringNetwork('192.168.1.20', frame.selection.networks)).toBe('192.168.1.0/24')
    expect(coveringNetwork('10.0.0.40', frame.selection.networks)).toBeNull()
    // 重なるネットワークでは最も狭いものだけが届く(HID-325)
    expect(coveringNetwork('10.1.2.50', ['10.0.0.0/8'], ['10.0.0.0/8', '10.1.2.0/24'])).toBeNull()
    expect(coveringNetwork('10.1.2.50', ['10.0.0.0/8', '10.1.2.0/24'], ['10.0.0.0/8', '10.1.2.0/24'])).toBe('10.1.2.0/24')
    expect(coveringNetwork('10.9.9.9', ['10.0.0.0/8'], ['10.0.0.0/8', '10.1.2.0/24'])).toBe('10.0.0.0/8')
    const order = ['192.168.1.0/24', '10.0.0.0/24']
    expect(toggledNetworks(['10.0.0.0/24'], '192.168.1.0/24', true, order)).toEqual(order)
    expect(toggledNetworks(order, '192.168.1.0/24', false, order)).toEqual(['10.0.0.0/24'])
  })

  it('does not check a device in a narrower overlapping network for the wider one (D-093)', () => {
    const target = device('10.1.2.50')
    const scanned = ['10.0.0.0/8', '10.1.2.0/24']
    expect(isChecked(target, sel(false, ['10.0.0.0/8'], []), scanned)).toBe(false)
    expect(isChecked(target, sel(false, ['10.1.2.0/24'], []), scanned)).toBe(true)
    expect(isChecked(target, sel(true, [], []), scanned)).toBe(true)
  })

  it('reaches a narrower network that shares the broadcast address with the wider one', () => {
    const base = destinationsSample('downstream-destinations-networks')
    const frame = {
      ...base,
      broadcasts: [
        { ...base.broadcasts[0], network: '192.168.0.0/16', address: '192.168.255.255' },
        { ...base.broadcasts[1], network: '192.168.255.0/24', address: '192.168.255.255' },
      ],
      devices: [device('192.168.255.50')],
    }
    const scanned = ['192.168.0.0/16', '192.168.255.0/24']
    expect(coveringNetwork('192.168.255.50', ['192.168.0.0/16'], scanned)).toBe('192.168.0.0/16')
    expect(isChecked(frame.devices[0], sel(false, ['192.168.0.0/16'], []), scanned)).toBe(true)
    expect(coveringNetwork('192.168.1.50', ['192.168.255.0/24'], scanned)).toBeNull()
    expect(selectionWithout(frame, sel(false, ['192.168.0.0/16'], []), [], '192.168.0.0/16')).toEqual(sel(false, [], []))
    expect(selectionWithout(frame, sel(false, ['192.168.0.0/16'], []), ['192.168.255.50'])).toEqual(sel(false, [], []))
  })
})

describe('selection (D-089)', () => {
  it('keeps the list order and unlisted hosts when toggling a host', () => {
    const order = ['192.168.1.10', '192.168.1.20', '192.168.1.30']
    expect(toggledHosts(['192.168.1.30', 'stage-pc'], '192.168.1.10', true, order)).toEqual(['192.168.1.10', '192.168.1.30', 'stage-pc'])
    expect(toggledHosts(['192.168.1.10', '192.168.1.30'], '192.168.1.10', false, order)).toEqual(['192.168.1.30'])
  })

  it('expands the rest into individual hosts when a child of a chosen parent is unchecked', () => {
    const base = destinationsSample('downstream-destinations-networks')
    const frame = { ...base, devices: [...base.devices, { ...base.devices[1], host: 'stage-pc', hostname: null }] }
    const everyone = sel(true, [], ['192.168.1.20'])
    expect(selectionWithout(frame, everyone, ['10.0.0.40'])).toEqual(sel(false, ['192.168.1.0/24'], ['192.168.1.20', 'stage-pc']))
    expect(selectionWithout(frame, everyone, [], '192.168.1.0/24')).toEqual(sel(false, ['10.0.0.0/24'], ['192.168.1.20', 'stage-pc']))
    const chosen = sel(false, ['192.168.1.0/24'], ['192.168.1.20', '10.0.0.40'])
    expect(selectionWithout(frame, chosen, ['192.168.1.10'])).toEqual(sel(false, [], ['10.0.0.40', '192.168.1.20']))
    expect(selectionWithout(frame, chosen, ['10.0.0.40'])).toEqual(sel(false, ['192.168.1.0/24'], ['192.168.1.20']))
    expect(selectionWithout(frame, everyone, ['192.168.1.20'])).toEqual(sel(false, ['10.0.0.0/24'], ['stage-pc']))
    expect(selectionWithout(frame, chosen, ['192.168.1.20'])).toEqual(sel(false, [], ['10.0.0.40', '192.168.1.10']))
    expect(selectionWith(frame, sel(false, [], ['10.0.0.40']), ['192.168.1.20', '10.0.0.5'])).toEqual(
      sel(false, [], ['10.0.0.5', '10.0.0.40', '192.168.1.20']),
    )
  })
})
