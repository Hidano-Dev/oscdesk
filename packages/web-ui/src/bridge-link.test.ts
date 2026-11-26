// 共有の接続(D-138)。どのパネルもこれを通してフレームを受けるので、検証・心拍・つなぎ直しをここで確かめる
import { describe, expect, it } from 'vitest'

import { WIRE_PROTOCOL_VERSION } from '@oscdesk/shared'

import { bridgeUrlOf, CLOSE_NOT_ALLOWED, RECONNECT_MS } from './bridge-link'
import { createTestLink, wireSample } from './test-support'

describe('bridge link', () => {
  it('builds the WebSocket URL from the page the bridge served', () => {
    expect(bridgeUrlOf({ protocol: 'http:', host: '192.168.1.10:7080' })).toBe('ws://192.168.1.10:7080/')
    expect(bridgeUrlOf({ protocol: 'https:', host: 'stage-pc:443' })).toBe('wss://stage-pc:443/')
  })

  it('validates downstream frames with the shared schema and delivers them by type', () => {
    const { link, socket, warnings } = createTestLink()
    const destinations: unknown[] = []
    const notices: unknown[] = []
    link.on('destinations', (frame) => destinations.push(frame.selection))
    const stop = link.on('notice', (frame) => notices.push(frame.code))
    socket().receive(wireSample('downstream-destinations'))
    socket().receive({ v: 1, type: 'destinations', devices: [] })
    socket().onmessage?.({ data: '{not json' })
    socket().receive({ v: 1, type: 'notice', level: 'warn', code: 'invalid-frame', detail: 'x' })
    stop()
    socket().receive({ v: 1, type: 'notice', level: 'warn', code: 'invalid-frame', detail: 'y' })
    expect(destinations).toHaveLength(1)
    expect(notices).toEqual(['invalid-frame'])
    expect(warnings).toHaveLength(2)
    expect(link.connected.value).toBe(true)
  })

  it('keeps hello and answers heartbeats so the bridge does not time the browser out', () => {
    const { link, socket } = createTestLink()
    socket().receive(wireSample('downstream-hello'))
    socket().receive({ v: 1, type: 'heartbeat', t: 42 })
    expect(link.hello.value?.type).toBe('hello')
    expect(socket().sent).toEqual([{ v: 1, type: 'heartbeatAck', t: 42 }])
  })

  it('refuses to send frames the bridge would reject, and anything while disconnected', () => {
    const { link, socket, warnings } = createTestLink()
    // 型の上では通るが値域の外(スキーマが断る)
    expect(link.send({ v: WIRE_PROTOCOL_VERSION, type: 'destinationsAlias', host: '', alias: null })).toBe(false)
    expect(warnings).toHaveLength(1)
    socket().drop()
    expect(link.send({ v: WIRE_PROTOCOL_VERSION, type: 'destinationsScan' })).toBe(false)
    expect(socket().sent).toEqual([])
  })

  it('reconnects after a drop and reports the connection to listeners', () => {
    const { link, socket, sockets, timers } = createTestLink()
    const changes: boolean[] = []
    link.onConnectionChange((connected) => changes.push(connected))
    socket().receive(wireSample('downstream-hello'))
    socket().drop()
    expect(link.status.value).toBe('reconnecting')
    expect(link.hello.value).toBeNull()
    timers.advance(RECONNECT_MS)
    expect(sockets).toHaveLength(2)
    socket().open()
    expect(link.status.value).toBe('open')
    expect(changes).toEqual([false, true])
  })

  it('keeps telling the browser it is outside the allowed range until a connection opens again (D-113)', () => {
    const { link, socket, timers } = createTestLink()
    socket().drop(CLOSE_NOT_ALLOWED)
    expect(link.status.value).toBe('not-allowed')
    // つなぎ直しはハンドシェイクで断られる(ブラウザには 1006 で見える)
    timers.advance(RECONNECT_MS)
    socket().drop(1006)
    expect(link.status.value).toBe('not-allowed')
    timers.advance(RECONNECT_MS)
    socket().open()
    expect(link.status.value).toBe('open')
  })

  it('does not reconnect after close()', () => {
    const { link, socket, sockets, timers } = createTestLink()
    link.close()
    expect(socket().closed).toBe(true)
    timers.advance(RECONNECT_MS * 3)
    expect(sockets).toHaveLength(1)
  })
})
