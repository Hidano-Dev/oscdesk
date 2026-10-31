import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CATALOG_ADDRESSES, catalogAddArgs, catalogDigest, type CatalogItem, type DownstreamFrame, type OscArg } from '@oscdesk/shared'

import { createCatalogManager } from './catalog-manager'

const smile: CatalogItem = { address: '/a/smile', kind: 'state', type: 'f', props: [{ key: 'max', arg: { type: 'f', value: 1 } }] }
const pose: CatalogItem = { address: '/a/pose', kind: 'state', type: 's', props: [] }

const from = (host: string) => ({ host, port: 7090 })
const s = (value: string): OscArg => ({ type: 's', value })
const i = (value: number): OscArg => ({ type: 'i', value })

function setup() {
  const clock = { t: Date.parse('2026-11-01T10:00:00Z') }
  const published: DownstreamFrame[] = []
  const requests = vi.fn()
  const warn = vi.fn()
  const manager = createCatalogManager({ publish: frame => published.push(frame), requestFromTargets: requests, logWarn: warn, publishDelayMs: 10, now: () => clock.t })
  const send = (host: string, address: string, ...args: OscArg[]) => manager.handleOscIn({ address, args, from: from(host) })
  const sendFull = (host: string, name: string, items: CatalogItem[], crcOverride?: number) => {
    const digest = catalogDigest(items)
    send(host, CATALOG_ADDRESSES.BEGIN, s(name), i(items.length))
    for (const item of items) send(host, CATALOG_ADDRESSES.ADD, ...catalogAddArgs(item))
    send(host, CATALOG_ADDRESSES.END, i(digest.count), i(crcOverride ?? digest.crc))
  }
  const last = () => published.filter(frame => frame.type === 'catalog').at(-1) as Extract<DownstreamFrame, { type: 'catalog' }> | undefined
  return { manager, published, requests, warn, send, sendFull, last, clock }
}

describe('catalog manager (D-104)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('only consumes /sys/catalog/* and leaves everything else to the caller', () => {
    const { manager } = setup()
    expect(manager.handleOscIn({ address: '/sys/pong', args: [i(1)], from: from('10.0.0.1') })).toBe(false)
    expect(manager.handleOscIn({ address: '/x', args: [], from: from('10.0.0.1') })).toBe(false)
    expect(manager.handleOscIn({ address: '/sys/catalog/unknown', args: [], from: from('10.0.0.1') })).toBe(true)
  })

  it('keeps each PC separately with its name, host and verified flag', () => {
    const { sendFull, last } = setup()
    sendFull('10.0.0.1', 'PC1', [smile])
    sendFull('10.0.0.2', 'PC2', [pose])
    vi.advanceTimersByTime(20)
    expect(last()!.pcs.map(pc => [pc.host, pc.name, pc.verified, pc.items.map(item => item.address)])).toEqual([
      ['10.0.0.1', 'PC1', true, ['/a/smile']],
      ['10.0.0.2', 'PC2', true, ['/a/pose']],
    ])
  })

  it('replaces the whole catalog of a PC on begin/end and flags a CRC mismatch with a notice', () => {
    const { sendFull, last, published } = setup()
    sendFull('10.0.0.1', 'PC1', [smile, pose])
    sendFull('10.0.0.1', 'PC1', [smile], catalogDigest([smile]).crc ^ 1)
    vi.advanceTimersByTime(20)
    expect(last()!.pcs[0]).toMatchObject({ verified: false, items: [{ address: '/a/smile' }] })
    expect(published.some(frame => frame.type === 'notice' && frame.code === 'catalog-mismatch')).toBe(true)
  })

  it('detects a count mismatch even when the received items are intact', () => {
    const { send, last } = setup()
    send('10.0.0.1', CATALOG_ADDRESSES.BEGIN, s('PC1'), i(2))
    send('10.0.0.1', CATALOG_ADDRESSES.ADD, ...catalogAddArgs(smile))
    send('10.0.0.1', CATALOG_ADDRESSES.END, i(2), i(catalogDigest([smile, pose]).crc))
    vi.advanceTimersByTime(20)
    expect(last()!.pcs[0]!.verified).toBe(false)
  })

  it('applies add/remove after the full send and checks the digest the target sends next', () => {
    const { sendFull, send, last } = setup()
    sendFull('10.0.0.1', 'PC1', [smile])
    send('10.0.0.1', CATALOG_ADDRESSES.ADD, ...catalogAddArgs(pose))
    const both = catalogDigest([smile, pose])
    send('10.0.0.1', CATALOG_ADDRESSES.DIGEST, i(both.count), i(both.crc))
    vi.advanceTimersByTime(20)
    expect(last()!.pcs[0]).toMatchObject({ verified: true, items: [{ address: '/a/smile' }, { address: '/a/pose' }] })

    send('10.0.0.1', CATALOG_ADDRESSES.REMOVE, s('/a/smile'))
    send('10.0.0.1', CATALOG_ADDRESSES.DIGEST, i(1), i(catalogDigest([pose]).crc))
    vi.advanceTimersByTime(20)
    expect(last()!.pcs[0]).toMatchObject({ verified: true, items: [{ address: '/a/pose' }] })

    // 取りこぼした add があると、その後の digest で気づく
    send('10.0.0.1', CATALOG_ADDRESSES.DIGEST, i(2), i(catalogDigest([pose, smile]).crc))
    vi.advanceTimersByTime(20)
    expect(last()!.pcs[0]!.verified).toBe(false)
  })

  it('ignores malformed messages and an end without begin, and coalesces publishes', () => {
    const { send, warn, published } = setup()
    send('10.0.0.1', CATALOG_ADDRESSES.ADD, s('/a'), s('state'))
    send('10.0.0.1', CATALOG_ADDRESSES.END, i(0), i(0))
    send('10.0.0.1', '/sys/catalog/unknown')
    expect(warn).toHaveBeenCalledTimes(2)
    // 読めなかったメッセージでは PC の行を作らず、配信もしない
    vi.advanceTimersByTime(20)
    expect(published.filter(frame => frame.type === 'catalog')).toHaveLength(0)
  })

  it('publishes once after a burst (trailing debounce)', () => {
    const { send, published } = setup()
    send('10.0.0.1', CATALOG_ADDRESSES.BEGIN, s('PC1'), i(2))
    vi.advanceTimersByTime(5)
    send('10.0.0.1', CATALOG_ADDRESSES.ADD, ...catalogAddArgs(smile))
    vi.advanceTimersByTime(5)
    send('10.0.0.1', CATALOG_ADDRESSES.ADD, ...catalogAddArgs(pose))
    vi.advanceTimersByTime(30)
    expect(published.filter(frame => frame.type === 'catalog')).toHaveLength(1)
  })

  it('commits what it has when end is lost, and later differences are not swallowed by the stale transfer', () => {
    const { send, last, published } = setup()
    send('10.0.0.1', CATALOG_ADDRESSES.BEGIN, s('PC1'), i(2))
    send('10.0.0.1', CATALOG_ADDRESSES.ADD, ...catalogAddArgs(smile))
    // end が来ないまま受信が途絶えても、タイマーで確定して配る
    vi.advanceTimersByTime(3_000)
    expect(last()!.pcs[0]).toMatchObject({ verified: false, items: [{ address: '/a/smile' }] })
    expect(published.some(frame => frame.type === 'notice' && frame.code === 'catalog-mismatch')).toBe(true)
    // その後の差分は新しい全量として扱われ、確定した内容に重なる
    send('10.0.0.1', CATALOG_ADDRESSES.ADD, ...catalogAddArgs(pose))
    vi.advanceTimersByTime(600)
    expect(last()!.pcs[0]).toMatchObject({ verified: null, items: [{ address: '/a/smile' }, { address: '/a/pose' }] })
    send('10.0.0.1', CATALOG_ADDRESSES.DIGEST, i(2), i(catalogDigest([smile, pose]).crc))
    vi.advanceTimersByTime(600)
    expect(last()!.pcs[0]!.verified).toBe(true)
  })

  it('does not lose items when the same large catalog is fetched again', () => {
    const { send, last } = setup()
    const big = (n: number): CatalogItem => ({
      address: `/big/${String(n)}`, kind: 'state', type: 's',
      props: Array.from({ length: 7 }, (_, k) => ({ key: `k${String(k)}`, arg: { type: 's' as const, value: 'x'.repeat(1000) } })),
    })
    const items = Array.from({ length: 700 }, (_, n) => big(n)) // 合計で上限の約 6 割
    const digest = catalogDigest(items)
    for (let round = 0; round < 2; round += 1) {
      send('10.0.0.1', CATALOG_ADDRESSES.BEGIN, s('PC1'), i(items.length))
      for (const item of items) send('10.0.0.1', CATALOG_ADDRESSES.ADD, ...catalogAddArgs(item))
      send('10.0.0.1', CATALOG_ADDRESSES.END, i(digest.count), i(digest.crc))
      vi.advanceTimersByTime(600)
      expect(last()!.pcs[0]).toMatchObject({ verified: true })
      expect(last()!.pcs[0]!.items).toHaveLength(700)
    }
  })

  it('extends the end-timeout on remove during a full send too', () => {
    const { send, last } = setup()
    send('10.0.0.1', CATALOG_ADDRESSES.BEGIN, s('PC1'), i(1))
    send('10.0.0.1', CATALOG_ADDRESSES.ADD, ...catalogAddArgs(smile))
    vi.advanceTimersByTime(1_500)
    send('10.0.0.1', CATALOG_ADDRESSES.REMOVE, s('/nothing'))
    vi.advanceTimersByTime(1_000)
    send('10.0.0.1', CATALOG_ADDRESSES.END, i(1), i(catalogDigest([smile]).crc))
    vi.advanceTimersByTime(600)
    expect(last()!.pcs[0]).toMatchObject({ verified: true })
  })

  it('never publishes more than the total limit even when full sends from several PCs overlap', () => {
    const { send, last } = setup()
    const big = (n: number): CatalogItem => ({
      address: `/big/${String(n)}`, kind: 'state', type: 's',
      props: Array.from({ length: 7 }, (_, k) => ({ key: `k${String(k)}`, arg: { type: 's' as const, value: 'x'.repeat(1000) } })),
    })
    const items = Array.from({ length: 700 }, (_, n) => big(n)) // 1 PC で上限の約 6 割
    const digest = catalogDigest(items)
    // 3 台が重なって受信する(それぞれ他の PC の確定前なので受信中の検査は通る)
    for (const host of ['10.0.0.1', '10.0.0.2', '10.0.0.3']) send(host, CATALOG_ADDRESSES.BEGIN, s(host), i(items.length))
    for (const item of items) for (const host of ['10.0.0.1', '10.0.0.2', '10.0.0.3']) send(host, CATALOG_ADDRESSES.ADD, ...catalogAddArgs(item))
    for (const host of ['10.0.0.1', '10.0.0.2', '10.0.0.3']) send(host, CATALOG_ADDRESSES.END, i(digest.count), i(digest.crc))
    vi.advanceTimersByTime(600)
    expect(Buffer.byteLength(JSON.stringify(last()), 'utf8')).toBeLessThan(9 * 1024 * 1024)
  })

  it('rejects a single item that would not fit in one datagram', () => {
    const { send, warn } = setup()
    const props = Array.from({ length: 32 }, (_, k) => [s(`k${String(k)}`), s('あ'.repeat(1024))]).flat()
    send('10.0.0.1', CATALOG_ADDRESSES.ADD, s('/a'), s('state'), s('s'), ...props)
    expect(warn).toHaveBeenCalled()
  })

  it('stops accepting items once the catalogs would be too large to send in one frame', () => {
    const { send, sendFull, last } = setup()
    const big = (n: number): CatalogItem => ({
      address: `/big/${String(n)}`, kind: 'state', type: 's',
      props: Array.from({ length: 32 }, (_, k) => ({ key: `k${String(k)}`, arg: { type: 's' as const, value: 'x'.repeat(1024) } })),
    })
    send('10.0.0.1', CATALOG_ADDRESSES.BEGIN, s('PC1'), i(0))
    for (let n = 0; n < 400; n += 1) send('10.0.0.1', CATALOG_ADDRESSES.ADD, ...catalogAddArgs(big(n)))
    send('10.0.0.1', CATALOG_ADDRESSES.END, i(0), i(0))
    vi.advanceTimersByTime(600)
    const bytes = Buffer.byteLength(JSON.stringify(last()), 'utf8')
    expect(bytes).toBeLessThan(9 * 1024 * 1024)
    expect(last()!.pcs[0]!.items.length).toBeLessThan(400)
    sendFull('10.0.0.2', 'PC2', [smile]) // 小さい設計図は他の PC が満杯でも続けて受けられない可能性があるが、壊れない
  })

  it('does not compare a digest against the old content while a full send is in progress', () => {
    const { sendFull, send, last, published } = setup()
    sendFull('10.0.0.1', 'PC1', [smile])
    send('10.0.0.1', CATALOG_ADDRESSES.BEGIN, s('PC1'), i(2))
    send('10.0.0.1', CATALOG_ADDRESSES.DIGEST, i(2), i(catalogDigest([smile, pose]).crc))
    vi.advanceTimersByTime(600)
    expect(published.some(frame => frame.type === 'notice')).toBe(false)
    expect(last()!.pcs[0]!.verified).toBe(true)
  })

  it('no longer shows a PC as verified after a difference until the next digest', () => {
    const { sendFull, send, last } = setup()
    sendFull('10.0.0.1', 'PC1', [smile])
    send('10.0.0.1', CATALOG_ADDRESSES.ADD, ...catalogAddArgs(pose))
    vi.advanceTimersByTime(600)
    expect(last()!.pcs[0]!.verified).toBeNull()
  })

  it('rejects non-finite floats so one bad value cannot make the whole frame unreadable', () => {
    const { send, warn } = setup()
    send('10.0.0.1', CATALOG_ADDRESSES.ADD, s('/a'), s('state'), s('f'), s('max'), { type: 'f', value: Number.POSITIVE_INFINITY })
    expect(warn).toHaveBeenCalled()
  })

  it('throttles Sync requests that arrive back to back', () => {
    const { manager, requests, clock } = setup()
    manager.handleUiFrame({ v: 1, type: 'catalogRequest' }, 'ui-1')
    manager.handleUiFrame({ v: 1, type: 'catalogRequest' }, 'ui-1')
    expect(requests).toHaveBeenCalledTimes(1)
    clock.t += 1_500
    manager.handleUiFrame({ v: 1, type: 'catalogRequest' }, 'ui-1')
    expect(requests).toHaveBeenCalledTimes(2)
  })

  it('caps the number of PCs by pushing out the one heard from longest ago', () => {
    const { send, last, clock } = setup()
    for (let n = 0; n < 70; n += 1) {
      clock.t += 1
      send(`10.0.1.${String(n)}`, CATALOG_ADDRESSES.BEGIN, s(`PC${String(n)}`), i(0))
    }
    vi.advanceTimersByTime(600)
    const hosts = last()!.pcs.map(pc => pc.host)
    expect(hosts).toHaveLength(64)
    expect(hosts).toContain('10.0.1.69')
    expect(hosts).not.toContain('10.0.1.0')
  })

  it('asks every target to send again on catalogRequest and ignores other frames', () => {
    const { manager, requests } = setup()
    expect(manager.handleUiFrame({ v: 1, type: 'catalogRequest' }, 'ui-1')).toBe(true)
    expect(requests).toHaveBeenCalledTimes(1)
    expect(manager.handleUiFrame({ v: 1, type: 'resend' }, 'ui-1')).toBe(false)
  })
})
