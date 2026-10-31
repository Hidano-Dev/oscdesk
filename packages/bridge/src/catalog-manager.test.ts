import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CATALOG_ADDRESSES, catalogAddArgs, catalogDigest, type CatalogItem, type DownstreamFrame, type OscArg } from '@oscdesk/shared'

import { createCatalogManager } from './catalog-manager'

const smile: CatalogItem = { address: '/a/smile', kind: 'state', type: 'f', props: [{ key: 'max', arg: { type: 'f', value: 1 } }] }
const pose: CatalogItem = { address: '/a/pose', kind: 'state', type: 's', props: [] }

const from = (host: string) => ({ host, port: 7090 })
const s = (value: string): OscArg => ({ type: 's', value })
const i = (value: number): OscArg => ({ type: 'i', value })

function setup() {
  const published: DownstreamFrame[] = []
  const requests = vi.fn()
  const warn = vi.fn()
  const manager = createCatalogManager({ publish: frame => published.push(frame), requestFromTargets: requests, logWarn: warn, publishDelayMs: 10, now: () => Date.parse('2026-11-01T10:00:00Z') })
  const send = (host: string, address: string, ...args: OscArg[]) => manager.handleOscIn({ address, args, from: from(host) })
  const sendFull = (host: string, name: string, items: CatalogItem[], crcOverride?: number) => {
    const digest = catalogDigest(items)
    send(host, CATALOG_ADDRESSES.BEGIN, s(name), i(items.length))
    for (const item of items) send(host, CATALOG_ADDRESSES.ADD, ...catalogAddArgs(item))
    send(host, CATALOG_ADDRESSES.END, i(digest.count), i(crcOverride ?? digest.crc))
  }
  const last = () => published.filter(frame => frame.type === 'catalog').at(-1) as Extract<DownstreamFrame, { type: 'catalog' }> | undefined
  return { manager, published, requests, warn, send, sendFull, last }
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
    expect(warn).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(20)
    expect(published.filter(frame => frame.type === 'catalog')).toHaveLength(1)
  })

  it('caps the number of PCs', () => {
    const { send, last } = setup()
    for (let n = 0; n < 70; n += 1) send(`10.0.1.${String(n)}`, CATALOG_ADDRESSES.BEGIN, s(`PC${String(n)}`), i(0))
    vi.advanceTimersByTime(20)
    expect(last()!.pcs).toHaveLength(64)
  })

  it('asks every target to send again on catalogRequest and ignores other frames', () => {
    const { manager, requests } = setup()
    expect(manager.handleUiFrame({ v: 1, type: 'catalogRequest' }, 'ui-1')).toBe(true)
    expect(requests).toHaveBeenCalledTimes(1)
    expect(manager.handleUiFrame({ v: 1, type: 'resend' }, 'ui-1')).toBe(false)
  })
})
