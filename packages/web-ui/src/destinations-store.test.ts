// 宛先パネルの状態(D-138)。偽の WebSocket にフレームを流し、送ったフレームと signal を確かめる。
// 画面との結線は app.dom.test.tsx(happy-dom)で確かめる
import { describe, expect, it } from 'vitest'

import type { DestinationsFrame } from '@oscdesk/shared'

import { createDestinationsStore, FADE_MS, PENDING_TIMEOUT_MS } from './destinations-store'
import { createTestLink, destinationsSample } from './test-support'

function setup() {
  const test = createTestLink()
  const store = createDestinationsStore({
    link: test.link,
    notices: test.notices,
    now: test.timers.now,
    setTimer: test.timers.setTimer,
    clearTimer: test.timers.clearTimer,
  })
  const selects = () => test.socket().ofType('destinationsSelect').map((frame) => [frame.allDevices, frame.networks, frame.hosts])
  return { store, socket: test.socket, advance: test.timers.advance, selects, warnings: test.warnings, notices: test.notices }
}

const withSelection = (frame: DestinationsFrame, hosts: string[], allDevices = false): DestinationsFrame =>
  ({ ...frame, selection: { ...frame.selection, allDevices, hosts } })

describe('destinations store with OSCQuery targets (D-168)', () => {
  it('toggles a host and OSC port pair and keeps the pairs when a device is toggled', () => {
    const { store, socket } = setup()
    const base = destinationsSample('downstream-destinations')
    const frame: DestinationsFrame = {
      ...base,
      devices: base.devices.map((device) => device.host === '192.168.1.21' ? { ...device, services: [{ name: 'A', oscPort: 9000 }, { name: 'B', oscPort: 9001 }] } : device),
    }
    socket().receive(frame)
    store.toggleEndpoint('192.168.1.21', 9001, true)
    const sent = () => socket().ofType('destinationsSelect').at(-1)
    expect(sent()?.endpoints).toEqual([{ host: '192.168.1.21', port: 9001 }])
    expect(sent()?.hosts).toEqual(base.selection.hosts)
    store.toggleDevice('192.168.1.10', true)
    expect(sent()?.endpoints).toEqual([{ host: '192.168.1.21', port: 9001 }])
    // ブリッジが反映した選択を受けたら、応答待ちを捨てて同じ見た目のまま
    socket().receive({ ...frame, selection: { ...frame.selection, hosts: sent()!.hosts, endpoints: [{ host: '192.168.1.21', port: 9001 }] } })
    store.toggleEndpoint('192.168.1.21', 9001, false)
    expect(sent()?.endpoints).toBeUndefined()
  })
})
describe('destinations store', () => {
  it('keeps the last valid destinations when an invalid frame arrives', () => {
    const { store, socket, warnings } = setup()
    socket().receive(destinationsSample('downstream-destinations'))
    socket().receive({ v: 1, type: 'destinations', devices: [] })
    expect(store.frame.value?.devices).toHaveLength(4)
    expect(warnings).toHaveLength(1)
  })

  it('requests a scan once while the bridge has not scanned, and again after reconnecting', () => {
    const { socket, advance } = setup()
    const unscanned = { ...destinationsSample('downstream-destinations'), scannedAt: null }
    socket().receive(unscanned)
    socket().receive(unscanned)
    expect(socket().sent.filter((frame) => frame.type === 'destinationsScan')).toHaveLength(1)
    socket().drop()
    advance(1_000)
    socket().open()
    socket().receive(unscanned)
    expect(socket().sent.filter((frame) => frame.type === 'destinationsScan')).toHaveLength(1)
  })

  it('builds quick successive toggles on the selection still awaiting the bridge', () => {
    const { store, socket, selects, advance, notices } = setup()
    const base = destinationsSample('downstream-destinations')
    socket().receive(base)
    store.toggleDevice('192.168.1.21', true)
    store.toggleDevice('192.168.1.10', true)
    expect(selects()).toEqual([
      [false, [], ['192.168.1.20', '192.168.1.21', '192.168.1.30']],
      [false, [], ['192.168.1.10', '192.168.1.20', '192.168.1.21', '192.168.1.30']],
    ])
    // チェックの見た目は応答待ちの選択で描く
    expect(store.selection.value?.hosts).toContain('192.168.1.10')
    // 選択と関係の無い destinations(走査の完了)では捨てない
    socket().receive({ ...base, scannedAt: '2026-10-18T10:05:00.000Z' })
    store.toggleDevice('192.168.1.30', false)
    expect(selects().at(-1)).toEqual([false, [], ['192.168.1.10', '192.168.1.20', '192.168.1.21']])
    // 届いた選択が一致したら捨てる
    socket().receive(withSelection(base, ['192.168.1.10', '192.168.1.20', '192.168.1.21']))
    expect(store.selection.value?.hosts).toEqual(['192.168.1.10', '192.168.1.20', '192.168.1.21'])

    // 断られたら捨てて、ブリッジの選択に戻る(押した見た目が残らない)
    store.toggleDevice('192.168.1.30', true)
    expect(store.selection.value?.hosts).toContain('192.168.1.30')
    socket().receive({ v: 1, type: 'notice', level: 'error', code: 'destinations-rejected', detail: 'invalid-host: x' })
    expect(store.selection.value?.hosts).not.toContain('192.168.1.30')
    expect(notices.items.value.at(-1)?.text).toBe('宛先を変更できません: invalid-host: x')

    // 上限の時間が過ぎたら捨てる
    store.toggleDevice('192.168.1.30', true)
    advance(PENDING_TIMEOUT_MS + 1)
    expect(store.selection.value?.hosts).not.toContain('192.168.1.30')

    // 切断したら捨てる
    store.toggleDevice('192.168.1.30', true)
    socket().drop()
    expect(store.selection.value?.hosts).not.toContain('192.168.1.30')
    expect(store.connected.value).toBe(false)
  })

  it('expands all devices into individual hosts when a child is unchecked', () => {
    const { store, socket, selects } = setup()
    socket().receive(withSelection(destinationsSample('downstream-destinations'), ['192.168.1.20'], true))
    store.toggleDevice('192.168.1.21', false)
    expect(selects().at(-1)).toEqual([false, [], ['192.168.1.10', '192.168.1.20', '192.168.1.30']])
  })

  it('sends networks and falls back to the config targets when nothing would remain', () => {
    const { store, socket, selects } = setup()
    const frame = destinationsSample('downstream-destinations-networks')
    socket().receive(frame)
    store.toggleNetwork('10.0.0.0/24', true)
    expect(selects().at(-1)).toEqual([false, ['192.168.1.0/24', '10.0.0.0/24'], ['192.168.1.20', '10.0.0.40']])

    const second = setup()
    second.socket().receive(withSelection(frame, []))
    second.store.toggleNetwork('192.168.1.0/24', false)
    expect(second.selects()).toEqual([])
    expect(second.socket().sent.filter((item) => item.type === 'destinationsReset')).toHaveLength(1)
  })

  it('refuses an empty selection and warns when not connected', () => {
    const { store, socket, selects, notices } = setup()
    socket().receive(withSelection(destinationsSample('downstream-destinations'), ['192.168.1.20']))
    store.toggleDevice('192.168.1.20', false)
    expect(selects()).toEqual([])
    expect(notices.items.value.at(-1)?.text).toBe('送信先を 1 台以上選んでください')
    socket().drop()
    store.scan()
    expect(notices.items.value.at(-1)?.text).toBe('ブリッジに接続していないため走査できませんでした')
  })

  it('keeps the alias dialog open until the bridge shows the name, and keeps it open on rejection', () => {
    const { store, socket, notices } = setup()
    const base = destinationsSample('downstream-destinations')
    socket().receive(base)
    store.openAlias(base.devices[2])
    expect(store.aliasEditor.value?.hint).toMatch(/^MAC aa:bb:cc:dd:ee:15/)
    expect(store.saveAlias(' ステージ左 iPad ')).toBe(true)
    expect(socket().sent.at(-1)).toEqual({ v: 1, type: 'destinationsAlias', host: '192.168.1.21', alias: 'ステージ左 iPad' })
    expect(store.aliasEditor.value?.sending).toBe(true)
    socket().receive({ v: 1, type: 'notice', level: 'error', code: 'destination-alias-rejected', detail: 'alias-too-long' })
    expect(store.aliasEditor.value?.sending).toBe(false)
    store.saveAlias('ステージ左 iPad')
    socket().receive({ ...base, devices: base.devices.map((item) => (item.host === '192.168.1.21' ? { ...item, alias: 'ステージ左 iPad' } : item)) })
    expect(store.aliasEditor.value).toBeNull()
    // 入力欄で断る名前は送らない
    store.openAlias(base.devices[2])
    expect(store.saveAlias('a\tb')).toBe(false)
    expect(notices.items.value.at(-1)?.text).toBe('名前に制御文字は使えません')
  })

  it('lights hosts from delivery events without letting green hide a recent failure (HID-376)', () => {
    const { store, socket, advance } = setup()
    const event = (host: string, result: string) => ({ host, target: 'unity', result, param: null, elapsedMs: 3 })
    socket().receive({ v: 1, type: 'delivery', events: [event('192.168.1.20', 'failed')] })
    socket().receive({ v: 1, type: 'delivery', events: [event('192.168.1.20', 'ok')] })
    expect(store.lights.value.get('192.168.1.20')?.result).toBe('failed')
    advance(FADE_MS)
    socket().receive({ v: 1, type: 'delivery', events: [event('192.168.1.20', 'ok')] })
    expect(store.lights.value.get('192.168.1.20')?.result).toBe('ok')
  })

  it('merges per-PC catalog frames and marks hosts whose blueprint does not match (D-118 / D-131)', () => {
    const { store, socket } = setup()
    const pc = (host: string, verified: boolean | null) => ({ host, name: host, receivedAt: '2026-10-18T10:00:00.000Z', verified, items: [] })
    socket().receive({ v: 1, type: 'catalog', hosts: ['192.168.1.20'], pcs: [pc('192.168.1.20', false)] })
    socket().receive({ v: 1, type: 'catalog', hosts: ['192.168.1.20', '192.168.1.21'], pcs: [pc('192.168.1.21', true)] })
    expect([...store.mismatched.value]).toEqual(['192.168.1.20'])
    socket().receive({ v: 1, type: 'catalog', hosts: ['192.168.1.21'], pcs: [] })
    expect(store.mismatched.value.size).toBe(0)
  })
})
