import { describe, expect, it } from 'vitest'

import { compositeNote, compositeSupport, mergeCatalog, verifiedLabel, type CatalogFrameItem, type CatalogPc } from './blueprint-logic'
import type { FrameOf } from './bridge-link'
import { wireSample } from './test-support'

function catalog(name: string): FrameOf<'catalog'> {
  const frame = wireSample(name)
  if (frame.type !== 'catalog') throw new Error('not a catalog frame')
  return frame
}

const composite = (schema: unknown, chunks = 1): CatalogFrameItem => {
  const text = typeof schema === 'string' ? schema : JSON.stringify(schema)
  const size = Math.ceil(text.length / chunks)
  const props = Array.from({ length: chunks }, (_, index) => ({ key: 'schema', value: text.slice(index * size, (index + 1) * size) }))
  return { param: 'p_x', kind: 'state', type: 'composite', props }
}

const color = { name: 'color', type: 'record', fields: [{ id: 'r', type: 'f' }, { id: 'g', type: 'f' }] }

describe('blueprint logic', () => {
  it('labels the verification result', () => {
    expect(verifiedLabel(true)).toEqual({ text: '一致', tone: 'positive' })
    expect(verifiedLabel(false).tone).toBe('negative')
    expect(verifiedLabel(null)).toEqual({ text: '未照合', tone: 'muted' })
  })

  it('tells whether a composite item can be shown, using the shared type checks', () => {
    const sample = catalog('downstream-catalog-composite').pcs[0].items[0]
    expect(compositeSupport(sample)).toBe('flat')
    expect(compositeSupport(composite(color, 3))).toBe('flat')
    expect(compositeSupport(composite({ ...color, fields: [{ id: 'in', type: 'record', fields: [{ id: 'a', type: 'f' }] }] }))).toBe('nested')
    expect(compositeSupport(composite({ name: 'list', type: 'array', items: { type: 'f' } }))).toBe('variable-length')
    expect(compositeSupport(composite('{'))).toBe('invalid')
    expect(compositeSupport(composite({ type: 'record' }))).toBe('invalid')
    expect(compositeSupport(catalog('downstream-catalog').pcs[0].items[0])).toBeNull()
  })

  it('counts composite items and the ones that cannot be shown', () => {
    expect(compositeNote([])).toBeNull()
    expect(compositeNote([composite(color)])).toBe('組み合わせの型 1 項目')
    expect(compositeNote([composite(color), composite('{')])).toBe('組み合わせの型 2 項目(うち 1 項目は入れ子・可変長などで画面に出せません)')
  })

  it('merges a catalog frame per PC and follows the order of hosts (D-131)', () => {
    const first = catalog('downstream-catalog')
    let held: CatalogPc[] = mergeCatalog([], first)
    expect(held.map((pc) => pc.host)).toEqual(['192.168.0.11', '192.168.0.12'])

    const updated = { ...first.pcs[1], verified: true }
    held = mergeCatalog(held, { ...first, hosts: ['192.168.0.12', '192.168.0.11'], pcs: [updated] })
    expect(held.map((pc) => [pc.host, pc.verified])).toEqual([['192.168.0.12', true], ['192.168.0.11', true]])

    held = mergeCatalog(held, catalog('downstream-catalog-hosts-only'))
    expect(held.map((pc) => pc.host)).toEqual(['192.168.0.11'])
  })
})
