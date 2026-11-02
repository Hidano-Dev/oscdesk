import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CATALOG, CATALOG_ADDRESSES, catalogAddArgs, catalogDigest, type CatalogItem, type DownstreamFrame, type OscArg } from '@oscdesk/shared'

import { createCatalogManager } from './catalog-manager'

const smile: CatalogItem = { address: '/a/smile', kind: 'state', type: 'f', props: [{ key: 'max', arg: { type: 'f', value: 1 } }] }
const pose: CatalogItem = { address: '/a/pose', kind: 'state', type: 's', props: [] }

// 1 項目が MAX_ITEM_BYTES(8 KiB)に収まる大きい項目(約 7.3 KB)
const fitting = (n: number): CatalogItem => ({
  address: `/big/${String(n)}`, kind: 'state', type: 's',
  props: Array.from({ length: 7 }, (_, k) => ({ key: `k${String(k)}`, arg: { type: 's' as const, value: 'x'.repeat(1000) } })),
})

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
  const catalogFrames = () => published.filter((frame): frame is Extract<DownstreamFrame, { type: 'catalog' }> => frame.type === 'catalog')
  // UI と同じ規則(D-131)で、届いたフレームを host ごとの最新に畳み、hosts の順に並べて返す
  const last = () => {
    const frames = catalogFrames()
    if (frames.length === 0) return undefined
    const held = new Map<string, Extract<DownstreamFrame, { type: 'catalog' }>['pcs'][number]>()
    for (const frame of frames) for (const pc of frame.pcs) held.set(pc.host, pc)
    const hosts = frames.at(-1)!.hosts
    return { hosts, pcs: hosts.flatMap(host => held.get(host) ?? []) }
  }
  return { manager, published, requests, warn, send, sendFull, last, clock, catalogFrames }
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
    expect(last()!.pcs.map(pc => [pc.host, pc.name, pc.verified, pc.items.map(item => item.param)])).toEqual([
      ['10.0.0.1', 'PC1', true, ['p_a_smile']],
      ['10.0.0.2', 'PC2', true, ['p_a_pose']],
    ])
  })

  it('replaces the whole catalog of a PC on begin/end and flags a CRC mismatch with a notice', () => {
    const { sendFull, last, published } = setup()
    sendFull('10.0.0.1', 'PC1', [smile, pose])
    sendFull('10.0.0.1', 'PC1', [smile], catalogDigest([smile]).crc ^ 1)
    vi.advanceTimersByTime(20)
    expect(last()!.pcs[0]).toMatchObject({ verified: false, items: [{ param: 'p_a_smile' }] })
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
    expect(last()!.pcs[0]).toMatchObject({ verified: true, items: [{ param: 'p_a_smile' }, { param: 'p_a_pose' }] })

    send('10.0.0.1', CATALOG_ADDRESSES.REMOVE, s('/a/smile'))
    send('10.0.0.1', CATALOG_ADDRESSES.DIGEST, i(1), i(catalogDigest([pose]).crc))
    vi.advanceTimersByTime(20)
    expect(last()!.pcs[0]).toMatchObject({ verified: true, items: [{ param: 'p_a_pose' }] })

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
    expect(last()!.pcs[0]).toMatchObject({ verified: false, items: [{ param: 'p_a_smile' }] })
    expect(published.some(frame => frame.type === 'notice' && frame.code === 'catalog-mismatch')).toBe(true)
    // その後の差分は新しい全量として扱われ、確定した内容に重なる
    send('10.0.0.1', CATALOG_ADDRESSES.ADD, ...catalogAddArgs(pose))
    vi.advanceTimersByTime(600)
    expect(last()!.pcs[0]).toMatchObject({ verified: null, items: [{ param: 'p_a_smile' }, { param: 'p_a_pose' }] })
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

  it('publishes one PC per frame so the frame size depends on that PC only (D-131)', () => {
    const { send, catalogFrames } = setup()
    const big = (n: number): CatalogItem => ({
      address: `/big/${String(n)}`, kind: 'state', type: 's',
      props: Array.from({ length: 7 }, (_, k) => ({ key: `k${String(k)}`, arg: { type: 's' as const, value: 'x'.repeat(1000) } })),
    })
    const items = Array.from({ length: 700 }, (_, n) => big(n)) // 1 PC で約 5 MB
    const digest = catalogDigest(items)
    // 3 台が重なって受信しても、全部が確定してから 1 PC ずつ配る
    for (const host of ['10.0.0.1', '10.0.0.2', '10.0.0.3']) send(host, CATALOG_ADDRESSES.BEGIN, s(host), i(items.length))
    for (const item of items) for (const host of ['10.0.0.1', '10.0.0.2', '10.0.0.3']) send(host, CATALOG_ADDRESSES.ADD, ...catalogAddArgs(item))
    for (const host of ['10.0.0.1', '10.0.0.2', '10.0.0.3']) send(host, CATALOG_ADDRESSES.END, i(digest.count), i(digest.crc))
    vi.advanceTimersByTime(600)
    const frames = catalogFrames()
    expect(frames).toHaveLength(3)
    for (const frame of frames) {
      expect(frame.pcs).toHaveLength(1)
      expect(frame.pcs[0]!.items).toHaveLength(700)
      expect(frame.pcs[0]!.verified).toBe(true)
      expect(frame.hosts).toEqual(['10.0.0.1', '10.0.0.2', '10.0.0.3'])
      expect(Buffer.byteLength(JSON.stringify(frame), 'utf8')).toBeLessThan(16 * 1024 * 1024)
    }
  })

  it('sends only the PCs that changed', () => {
    const { sendFull, send, catalogFrames } = setup()
    sendFull('10.0.0.1', 'PC1', [smile])
    sendFull('10.0.0.2', 'PC2', [pose])
    vi.advanceTimersByTime(600)
    const before = catalogFrames().length
    send('10.0.0.2', CATALOG_ADDRESSES.ADD, ...catalogAddArgs(smile))
    vi.advanceTimersByTime(600)
    const added = catalogFrames().slice(before)
    expect(added).toHaveLength(1)
    expect(added[0]!.pcs.map(pc => pc.host)).toEqual(['10.0.0.2'])
    expect(added[0]!.hosts).toEqual(['10.0.0.1', '10.0.0.2'])
  })

  it('sends every PC one frame at a time to a newly connected UI, and an empty frame when there is none', () => {
    const { manager, sendFull, published } = setup()
    manager.publish('ui-1')
    expect(published).toEqual([{ v: 1, type: 'catalog', hosts: [], pcs: [] }])
    sendFull('10.0.0.1', 'PC1', [smile])
    sendFull('10.0.0.2', 'PC2', [pose])
    vi.advanceTimersByTime(600)
    published.length = 0
    manager.publish('ui-2')
    expect(published.map(frame => frame.type === 'catalog' ? frame.pcs.map(pc => pc.host) : [])).toEqual([['10.0.0.1'], ['10.0.0.2']])
  })

  it('rejects a single item that would not fit in one datagram', () => {
    const { send, warn } = setup()
    const props = Array.from({ length: 32 }, (_, k) => [s(`k${String(k)}`), s('あ'.repeat(1024))]).flat()
    send('10.0.0.1', CATALOG_ADDRESSES.ADD, s('/a'), s('state'), s('s'), ...props)
    expect(warn).toHaveBeenCalled()
  })

  it('stops accepting items once one PC would be too large to send in one frame, and flags it as mismatched', () => {
    const { send, last } = setup()
    const big = fitting // 1 項目 8 KiB 未満(超える項目は項目単位で拒否され、PC・合計の上限の検査に届かない)
    const items = Array.from({ length: 1400 }, (_, n) => big(n)) // 約 10 MB(1 PC の上限 8 MiB を超える)
    const digest = catalogDigest(items)
    send('10.0.0.1', CATALOG_ADDRESSES.BEGIN, s('PC1'), i(items.length))
    for (const item of items) send('10.0.0.1', CATALOG_ADDRESSES.ADD, ...catalogAddArgs(item))
    send('10.0.0.1', CATALOG_ADDRESSES.END, i(digest.count), i(digest.crc))
    vi.advanceTimersByTime(600)
    expect(Buffer.byteLength(JSON.stringify(last()!.pcs[0]), 'utf8')).toBeLessThan(9 * 1024 * 1024)
    expect(last()!.pcs[0]!.items.length).toBeGreaterThan(1000)
    expect(last()!.pcs[0]!.items.length).toBeLessThan(1400)
    expect(last()!.pcs[0]!.verified).toBe(false)
  })

  it('caps the bytes held across all PCs so the bridge memory and the replay stay bounded', () => {
    const { send, last } = setup()
    const big = fitting // 1 項目 8 KiB 未満(超える項目は項目単位で拒否され、PC・合計の上限の検査に届かない)
    // 1 PC 約 3.6 MB(500 項目)を 24 台送る(合計の上限 64 MiB を超える)
    for (let p = 0; p < 24; p += 1) {
      const host = `10.0.2.${String(p)}`
      send(host, CATALOG_ADDRESSES.BEGIN, s(host), i(0))
      for (let n = 0; n < 500; n += 1) send(host, CATALOG_ADDRESSES.ADD, ...catalogAddArgs(big(n)))
      send(host, CATALOG_ADDRESSES.END, i(0), i(0))
    }
    vi.advanceTimersByTime(600)
    const total = last()!.pcs.reduce((sum, pc) => sum + Buffer.byteLength(JSON.stringify(pc.items), 'utf8'), 0)
    expect(last()!.pcs[0]!.items).toHaveLength(500) // 上限に届くまでは保持される
    expect(total).toBeLessThan(CATALOG.MAX_HELD_BYTES * 1.2)
    expect(total).toBeGreaterThan(CATALOG.MAX_HELD_BYTES * 0.5)
    expect(last()!.pcs.some(pc => pc.items.length < 500)).toBe(true)
  })

  it('does not count the bytes of other PCs against a PC', () => {
    const { send, sendFull, last } = setup()
    const big = fitting // 1 項目 8 KiB 未満(超える項目は項目単位で拒否され、PC・合計の上限の検査に届かない)
    send('10.0.0.1', CATALOG_ADDRESSES.BEGIN, s('PC1'), i(0))
    for (let n = 0; n < 1400; n += 1) send('10.0.0.1', CATALOG_ADDRESSES.ADD, ...catalogAddArgs(big(n)))
    send('10.0.0.1', CATALOG_ADDRESSES.END, i(0), i(0))
    sendFull('10.0.0.2', 'PC2', [smile]) // 他の PC が満杯でも、小さい設計図は受けられる
    vi.advanceTimersByTime(600)
    expect(last()!.pcs.find(pc => pc.host === '10.0.0.1')!.items.length).toBeGreaterThan(1000)
    expect(last()!.pcs.find(pc => pc.host === '10.0.0.2')).toMatchObject({ verified: true, items: [{ param: 'p_a_smile' }] })
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
    const hosts = last()!.hosts
    expect(last()!.pcs.map(pc => pc.host)).toEqual(hosts)
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

describe('start signal and item events (HID-385)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('treats a begin that does not answer a Sync request as the PC having started', () => {
    const started = vi.fn()
    const clock = { t: 100_000 }
    const manager = createCatalogManager({
      publish: () => {}, requestFromTargets: vi.fn(), onTargetStarted: started, now: () => clock.t, logWarn: vi.fn(),
      upSinceOfSource: () => ({ pc: '10.0.0.1', since: 0 }),
    })
    const begin = () => manager.handleOscIn({ address: CATALOG_ADDRESSES.BEGIN, args: [s('PC1'), i(0)], from: from('10.0.0.1') })
    begin()
    expect(started).toHaveBeenCalledWith('10.0.0.1')
    // Sync の要求の直後の begin は要求への答え(動いている PC へ生成し直さない)
    clock.t += 10_000
    manager.handleUiFrame({ v: 1, type: 'catalogRequest' }, 'ui-1')
    clock.t += 1_000
    begin()
    expect(started).toHaveBeenCalledTimes(1)
    clock.t += 10_000
    begin()
    expect(started).toHaveBeenCalledTimes(2)
  })

  it('reports added and removed items with the sending host', () => {
    const added = vi.fn()
    const removed = vi.fn()
    const manager = createCatalogManager({ publish: () => {}, requestFromTargets: vi.fn(), onItemAdded: added, onItemRemoved: removed, logWarn: vi.fn() })
    manager.handleOscIn({ address: CATALOG_ADDRESSES.ADD, args: catalogAddArgs(smile), from: from('10.0.0.1') })
    // 設計図を持っていない PC からの削除通知も伝える(生成の記録はブリッジの再起動をまたぐため)
    manager.handleOscIn({ address: CATALOG_ADDRESSES.REMOVE, args: [s('/a/smile')], from: from('10.0.0.9') })
    expect(added).toHaveBeenCalledWith('10.0.0.1', '/a/smile')
    expect(removed).toHaveBeenCalledWith('10.0.0.9', '/a/smile')
  })
})

describe('Sync answers are bound to PCs that were answering pings (HID-396)', () => {
  // up: 送信元 → 答え始めた時刻(無ければ ping に答えていない)。ブリッジの死活監視の代わり
  function setupStart(clock: { t: number }, up: Map<string, number>) {
    const started = vi.fn()
    const manager = createCatalogManager({
      publish: () => {}, requestFromTargets: vi.fn(), onTargetStarted: started, now: () => clock.t, logWarn: vi.fn(),
      upSinceOfSource: host => {
        const since = up.get(host)
        return since === undefined ? null : { pc: host, since }
      },
    })
    const begin = (host: string) => manager.handleOscIn({ address: CATALOG_ADDRESSES.BEGIN, args: [s('PC'), i(0)], from: from(host) })
    const request = () => manager.handleUiFrame({ v: 1, type: 'catalogRequest' }, 'ui-1')
    return { started, begin, request }
  }

  it('restores a PC that restarted while a client keeps sending Sync requests', () => {
    const clock = { t: 100_000 }
    const up = new Map([['10.0.0.1', 0], ['10.0.0.2', 0]])
    const { started, begin, request } = setupStart(clock, up)
    // 1 秒ごとに要求を送り続ける間、動いている 10.0.0.1 の答えは起動の合図にしない
    for (let n = 0; n < 5; n += 1) {
      request()
      clock.t += 100
      begin('10.0.0.1')
      clock.t += 900
    }
    expect(started).not.toHaveBeenCalled()
    // 10.0.0.2 は止まって(ping に答えなくなり)、要求が続く中で起動した。起動の begin は答えにしない
    up.delete('10.0.0.2')
    request()
    clock.t += 1_000
    request()
    clock.t += 100
    begin('10.0.0.2')
    expect(started.mock.calls).toEqual([['10.0.0.2']])
    // ping に答え始めた後の要求への begin は答え(動いている PC へ生成し直さない)
    up.set('10.0.0.2', clock.t)
    clock.t += 6_000
    request()
    clock.t += 100
    begin('10.0.0.2')
    expect(started).toHaveBeenCalledTimes(1)
  })

  it('restores a PC that started after answering pings again, even if a request followed', () => {
    const clock = { t: 100_000 }
    const up = new Map([['10.0.0.2', 0]])
    const { started, begin, request } = setupStart(clock, up)
    // 止まって戻った(答え始めた時刻が新しくなった)後、起動の begin より先に要求が出た。
    // PC は要求も受けたので begin を 2 通送る。どちらか 1 通は起動の合図になる
    up.set('10.0.0.2', clock.t)
    request()
    clock.t += 100
    begin('10.0.0.2')
    clock.t += 100
    begin('10.0.0.2')
    expect(started.mock.calls).toEqual([['10.0.0.2']])
  })

  it('restores a PC that was not answering pings when Sync was pressed', () => {
    const clock = { t: 100_000 }
    const up = new Map([['10.0.0.1', 0]])
    const { started, begin, request } = setupStart(clock, up)
    request()
    clock.t += 200
    begin('10.0.0.1')
    // 新しく現れた PC(要求の時点で ping に答えていなかった)の begin は、要求の窓の中でも起動の合図
    begin('10.0.0.3')
    // 要求の後に答え始めた PC も、要求を受けていないかもしれないので起動の合図
    up.set('10.0.0.4', clock.t)
    clock.t += 100
    begin('10.0.0.4')
    expect(started.mock.calls).toEqual([['10.0.0.3'], ['10.0.0.4']])
  })

  it('treats a second begin of the same PC within one request window as a restart', () => {
    const clock = { t: 100_000 }
    const up = new Map([['10.0.0.1', 0]])
    const { started, begin, request } = setupStart(clock, up)
    request()
    clock.t += 100
    begin('10.0.0.1')
    expect(started).not.toHaveBeenCalled()
    // 答えた直後に再起動した(死活監視が気づく前)。要求 1 回に答えは 1 通なので、2 通目は起動の合図
    clock.t += 1_500
    begin('10.0.0.1')
    expect(started.mock.calls).toEqual([['10.0.0.1']])
  })
})

describe('start signal throttling (PR #106 review)', () => {
  it('handles the start signal of one host at most once per interval', () => {
    const started = vi.fn()
    const clock = { t: 100_000 }
    const manager = createCatalogManager({ publish: () => {}, requestFromTargets: vi.fn(), onTargetStarted: started, now: () => clock.t, logWarn: vi.fn() })
    const begin = (host: string) => manager.handleOscIn({ address: CATALOG_ADDRESSES.BEGIN, args: [s('PC'), i(0)], from: from(host) })
    begin('10.0.0.1'); begin('10.0.0.1'); begin('10.0.0.2')
    expect(started.mock.calls).toEqual([['10.0.0.1'], ['10.0.0.2']])
    clock.t += 6_000
    begin('10.0.0.1')
    expect(started).toHaveBeenCalledTimes(3)
  })
})