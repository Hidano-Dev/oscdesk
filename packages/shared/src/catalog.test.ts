import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  canonicalCatalogText,
  catalogAddArgs,
  catalogDigest,
  crc32,
  parseCatalogAdd,
  type CatalogItem,
} from './catalog'

const samples = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../protocol/catalog-samples.json'), 'utf8'),
) as {
  crc32: Array<{ text: string; crc: number }>
  catalogs: Array<{ name: string; items: CatalogItem[]; canonical: string; count: number; crc: number }>
}

describe('crc32', () => {
  it('matches the IEEE check value and the shared samples', () => {
    // 標準の確認値(CRC-32/ISO-HDLC)。符号付き int32 では 0xCBF43926 は負になる
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926 | 0)
    for (const sample of samples.crc32) expect(crc32(Buffer.from(sample.text, 'utf8')), sample.text).toBe(sample.crc)
  })
})

describe('catalog digest', () => {
  it('produces the canonical text and CRC32 recorded in protocol/catalog-samples.json', () => {
    for (const sample of samples.catalogs) {
      expect(canonicalCatalogText(sample.items), sample.name).toBe(sample.canonical)
      expect(catalogDigest(sample.items), sample.name).toEqual({ count: sample.count, crc: sample.crc })
    }
  })

  it('does not depend on the order items arrive in', () => {
    const [first] = samples.catalogs
    expect(catalogDigest([...first!.items].reverse())).toEqual(catalogDigest(first!.items))
  })

  it('changes when the content changes even if the count stays the same', () => {
    const [first] = samples.catalogs
    const changed = first!.items.map((item, index) => index === 0 ? { ...item, type: 'zzz' } : item)
    expect(catalogDigest(changed).count).toBe(catalogDigest(first!.items).count)
    expect(catalogDigest(changed).crc).not.toBe(catalogDigest(first!.items).crc)
  })
})

describe('item size', () => {
  it('is judged the same before and after a float32 round trip', () => {
    const item: CatalogItem = {
      address: '/test', kind: 'state', type: 'f',
      props: [
        ...Array.from({ length: 7 }, (_, k) => ({ key: `s${String(k)}`, arg: { type: 's' as const, value: 'x'.repeat(960) } })),
        ...Array.from({ length: 24 }, (_, k) => ({ key: `f${String(k)}`, arg: { type: 'f' as const, value: 0.1 } })),
      ],
    }
    const viaOsc = parseCatalogAdd(catalogAddArgs({ ...item, props: item.props.map(p => p.arg.type === 'f' ? { ...p, arg: { type: 'f' as const, value: Math.fround(0.1) } } : p) }))
    const direct = parseCatalogAdd(catalogAddArgs(item))
    expect(direct.ok).toBe(viaOsc.ok)
  })
})

describe('parseCatalogAdd', () => {
  it('round-trips through catalogAddArgs and keeps repeated keys in order', () => {
    const item: CatalogItem = {
      address: '/a/b', kind: 'state', type: 's',
      props: [{ key: 'options', arg: { type: 's', value: 'x' } }, { key: 'options', arg: { type: 's', value: 'y' } }, { key: 'step', arg: { type: 'i', value: 2 } }],
    }
    expect(parseCatalogAdd(catalogAddArgs(item))).toEqual({ ok: true, item })
  })

  it('rejects odd property lists, blobs, bad keys and non-string heads', () => {
    expect(parseCatalogAdd([{ type: 's', value: '/a' }, { type: 's', value: 'state' }, { type: 's', value: 'f' }, { type: 's', value: 'min' }]).ok).toBe(false)
    expect(parseCatalogAdd([{ type: 's', value: '/a' }, { type: 's', value: 'state' }, { type: 's', value: 'f' }, { type: 's', value: 'min' }, { type: 'b', value: new Uint8Array() }]).ok).toBe(false)
    expect(parseCatalogAdd([{ type: 's', value: '/a' }, { type: 's', value: 'state' }, { type: 's', value: 'f' }, { type: 's', value: 'bad key' }, { type: 'i', value: 1 }]).ok).toBe(false)
    expect(parseCatalogAdd([{ type: 'i', value: 1 }]).ok).toBe(false)
    expect(parseCatalogAdd([{ type: 's', value: 'no-slash' }, { type: 's', value: 'state' }, { type: 's', value: 'f' }]).ok).toBe(false)
  })
})
