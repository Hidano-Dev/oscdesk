// 宛先パネルの状態(HID-461 の試作)。偽の WebSocket にフレームを流し、送ったフレームと signal を確かめる。
// NiceGUI 版の test_destinations.py の画面のテスト(user_simulation でページを組み立てる)に当たるものを、DOM なしで書ける
import { describe, expect, it } from 'vitest'

import type { DestinationsFrame } from '@oscdesk/shared'

import { createDestinationsStore, FADE_MS, PENDING_TIMEOUT_MS, type SocketLike } from './destinations-store'
import { destinationsSample } from './test-samples'

class FakeSocket implements SocketLike {
  sent: Record<string, unknown>[] = []
  onopen: ((event: unknown) => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  send(data: string) { this.sent.push(JSON.parse(data) as Record<string, unknown>) }
  close() { this.onclose?.({}) }
  open() { this.onopen?.({}) }
  receive(frame: unknown) { this.onmessage?.({ data: JSON.stringify(frame) }) }
}

function setup() {
  const sockets: FakeSocket[] = []
  const timers: { at: number; callback: () => void; done: boolean }[] = []
  let clock = 1_000
  const warnings: unknown[][] = []
  const store = createDestinationsStore({
    url: 'ws://127.0.0.1:7080/',
    createSocket: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
    now: () => clock,
    setTimer: (callback, ms) => {
      const timer = { at: clock + ms, callback, done: false }
      timers.push(timer)
      return timer
    },
    clearTimer: (handle) => { (handle as { done: boolean }).done = true },
    logWarn: (...args) => warnings.push(args),
  })
  store.start()
  const socket = () => sockets[sockets.length - 1]
  socket().open()
  const advance = (ms: number) => {
    clock += ms
    for (const timer of timers) {
      if (!timer.done && timer.at <= clock) {
        timer.done = true
        timer.callback()
      }
    }
  }
  const selects = () => socket().sent.filter((frame) => frame.type === 'destinationsSelect')
    .map((frame) => [frame.allDevices, frame.networks, frame.hosts])
  return { store, socket, sockets, advance, selects, warnings }
}

const withSelection = (frame: DestinationsFrame, hosts: string[], allDevices = false): DestinationsFrame =>
  ({ ...frame, selection: { ...frame.selection, allDevices, hosts } })

describe('destinations store', () => {
  it('drops frames that do not pass the shared schema and keeps the connection', () => {
    const { store, socket, warnings } = setup()
    socket().receive(destinationsSample('downstream-destinations'))
    socket().receive({ v: 1, type: 'destinations', devices: [] })
    socket().onmessage?.({ data: '{not json' })
    expect(store.frame.value?.devices).toHaveLength(4)
    expect(warnings).toHaveLength(2)
    expect(store.connected.value).toBe(true)
  })

  it('answers heartbeats so the bridge does not time the browser out', () => {
    const { socket } = setup()
    socket().receive({ v: 1, type: 'heartbeat', t: 42 })
    expect(socket().sent).toEqual([{ v: 1, type: 'heartbeatAck', t: 42 }])
  })

  it('requests a scan once while the bridge has not scanned, and again after reconnecting', () => {
    const { socket, advance } = setup()
    const unscanned = { ...destinationsSample('downstream-destinations'), scannedAt: null }
    socket().receive(unscanned)
    socket().receive(unscanned)
    expect(socket().sent.filter((frame) => frame.type === 'destinationsScan')).toHaveLength(1)
    socket().close()
    advance(1_000)
    socket().open()
    socket().receive(unscanned)
    expect(socket().sent.filter((frame) => frame.type === 'destinationsScan')).toHaveLength(1)
  })

  it('builds quick successive toggles on the selection still awaiting the bridge', () => {
    const { store, socket, selects, advance } = setup()
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
    expect(store.notices.value.at(-1)?.text).toBe('宛先を変更できません: invalid-host: x')

    // 上限の時間が過ぎたら捨てる
    store.toggleDevice('192.168.1.30', true)
    advance(PENDING_TIMEOUT_MS + 1)
    expect(store.selection.value?.hosts).not.toContain('192.168.1.30')

    // 切断したら捨てる
    store.toggleDevice('192.168.1.30', true)
    socket().close()
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
    const { store, socket, selects } = setup()
    socket().receive(withSelection(destinationsSample('downstream-destinations'), ['192.168.1.20']))
    store.toggleDevice('192.168.1.20', false)
    expect(selects()).toEqual([])
    expect(store.notices.value.at(-1)?.text).toBe('送信先を 1 台以上選んでください')
    socket().close()
    store.scan()
    expect(store.notices.value.at(-1)?.text).toBe('ブリッジに接続していないため走査できませんでした')
  })

  it('keeps the alias dialog open until the bridge shows the name, and keeps it open on rejection', () => {
    const { store, socket } = setup()
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
    expect(store.notices.value.at(-1)?.text).toBe('名前に制御文字は使えません')
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
