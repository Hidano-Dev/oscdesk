import { describe, expect, it } from 'vitest'

import {
  buildPalette,
  isPaletteAddress,
  OSCQUERY,
  OscQueryHostInfoSchema,
  paletteKindOf,
  paletteNodeInfo,
  parseOscQueryNamespace,
  supportsPathEvents,
  type OscQueryMethod,
  type PaletteRange,
} from './oscquery'
import { OscQueryNodeInfoSchema, padWidgetFromNode } from './pad-from-node'

const range = (patch: Partial<PaletteRange>): PaletteRange => ({ min: null, max: null, vals: null, ...patch })
const method = (type: string | null, ranges: readonly (PaletteRange | null)[], extendedType: string[] | null, address = '/x'): OscQueryMethod => ({
  address, type, access: 3, description: null, extendedType, range: [...ranges],
})
const inferPaletteKind = (type: string | null, ranges: readonly (PaletteRange | null)[], extendedType: string[] | null) => {
  const decided = paletteKindOf(method(type, ranges, extendedType))
  return decided.ok ? decided.kind : null
}

describe('palette kinds come from padWidgetFromNode (HID-484 §5・D-171)', () => {
  it.each([
    [null, [], 'button'],
    ['N', [], 'button'],
    ['I', [], 'button'],
    ['T', [], 'toggle'],
    ['F', [], 'toggle'],
    ['i', [range({ vals: [1, 0] })], 'toggle'],
    ['i', [range({ min: 0, max: 1 })], 'toggle'],
    ['i', [range({ vals: [0, 1, 2] })], 'select'],
    ['f', [range({ vals: [0.5, 1] })], 'select'],
    ['s', [range({ vals: ['a'] })], 'select'],
    ['f', [range({ min: 0, max: 1 })], 'slider'],
    ['i', [range({ min: 0, max: 10 })], 'slider'],
    ['i', [], 'number'],
    ['f', [range({ min: 0 })], 'number'],
    ['s', [], 'text'],
    ['r', [], 'color'],
    ['ifs', [], 'composite'],
    ['ff', [], 'composite'],
  ] as const)('%s %j -> %s', (type, ranges, kind) => {
    expect(inferPaletteKind(type, ranges, null)).toBe(kind)
  })

  it('reads ffff as a color only with a color EXTENDED_TYPE', () => {
    expect(inferPaletteKind('ffff', [], ['color.rgba'])).toBe('color')
    expect(inferPaletteKind('ffff', [], null)).toBe('composite')
  })

  it.each(['h', 'd', 't', 'b', 'i[ff]', 'fh', 'c', 'm', 'iN', 'fr'])('does not make a control of %s', type => {
    expect(inferPaletteKind(type, [], null)).toBeNull()
  })

  it('places the same kind with addWidgetFromNode as the palette shows (the node passes the upstream schema)', () => {
    const samples: OscQueryMethod[] = [
      method('f', [range({ min: 0, max: 1 })], null),
      method('i', [range({ vals: [0, 1] })], null),
      method('s', [range({ vals: ['a', true, 'b'] })], null),
      method('ffff', [range({ min: 0, max: 1 })], ['color']),
      method('ifs', [null, range({ min: -1, max: 1 }), null], null),
      method(null, [], null),
    ]
    for (const sample of samples) {
      const node = OscQueryNodeInfoSchema.parse(paletteNodeInfo(sample))
      const placed = padWidgetFromNode(node)
      const listed = paletteKindOf(sample)
      expect(placed.ok && listed.ok && placed.widget.kind === listed.kind).toBe(true)
    }
  })

  it('lists reserved and overlong addresses as invalid instead of offering a control that cannot be placed', () => {
    expect(paletteKindOf(method('f', [], null, '/sys/ping'))).toEqual({ ok: false, reason: 'invalid-address' })
    expect(paletteKindOf(method('f', [], null, `/${'a'.repeat(300)}`))).toEqual({ ok: false, reason: 'invalid-address' })
  })
})

describe('parseOscQueryNamespace', () => {
  it('walks the tree, prefers FULL_PATH and skips containers', () => {
    const result = parseOscQueryNamespace({
      FULL_PATH: '/',
      CONTENTS: {
        a: { CONTENTS: { b: { TYPE: 'f', ACCESS: 3, RANGE: { MIN: 0, MAX: 1 } } } },
        c: { FULL_PATH: '/renamed', TYPE: 'i', ACCESS: 2, VALUE: {}, EXTENDED_TYPE: 'x.y', CLIPMODE: ['both'] },
      },
    })
    expect(result).toEqual({
      ok: true,
      methods: [
        { address: '/a/b', type: 'f', access: 3, description: null, extendedType: null, range: [{ min: 0, max: 1, vals: null }] },
        { address: '/renamed', type: 'i', access: 2, description: null, extendedType: ['x.y'], range: [] },
      ],
    })
  })

  it('treats an absent, empty-array and empty-object VALUE alike (HID-484 §6.2)', () => {
    for (const value of [undefined, [], {}]) {
      const result = parseOscQueryNamespace({ CONTENTS: { x: { TYPE: 'f', ACCESS: 3, ...(value === undefined ? {} : { VALUE: value }) } } })
      expect(result.ok && result.methods[0]?.address).toBe('/x')
    }
  })

  it('drops attributes of the wrong type instead of rejecting the node', () => {
    const result = parseOscQueryNamespace({ CONTENTS: { x: { TYPE: 5, ACCESS: 9, DESCRIPTION: ['no'], RANGE: [null, { VALS: [1, {}] }] } } })
    expect(result).toEqual({ ok: true, methods: [{ address: '/x', type: null, access: null, description: null, extendedType: null, range: [null, { min: null, max: null, vals: [1] }] }] })
  })

  it('stops at the depth and node-count limits', () => {
    let deep: Record<string, unknown> = { TYPE: 'f', ACCESS: 3 }
    for (let index = 0; index <= OSCQUERY.MAX_DEPTH; index += 1) deep = { CONTENTS: { n: deep } }
    expect(parseOscQueryNamespace(deep)).toEqual({ ok: false, reason: 'too-deep' })
    const wide = Object.fromEntries(Array.from({ length: OSCQUERY.MAX_NODES + 1 }, (_, index) => [`n${String(index)}`, { TYPE: 'f' }]))
    expect(parseOscQueryNamespace({ CONTENTS: wide })).toEqual({ ok: false, reason: 'too-many-nodes' })
    expect(parseOscQueryNamespace([])).toEqual({ ok: false, reason: 'not-an-object' })
  })
})

describe('buildPalette', () => {
  it('keeps only writable nodes, holds ACCESS 3 and lists the unsupported ones', () => {
    const parsed = parseOscQueryNamespace({
      CONTENTS: {
        w: { TYPE: 'f', ACCESS: 2 },
        rw: { TYPE: 'T', ACCESS: 3 },
        r: { TYPE: 'f', ACCESS: 1 },
        none: { TYPE: 'f' },
        blob: { TYPE: 'b', ACCESS: 3 },
        'bad name': { TYPE: 'f', ACCESS: 3 },
      },
    })
    if (!parsed.ok) throw new Error('parse failed')
    const palette = buildPalette(parsed.methods)
    expect(palette.items.map(item => [item.address, item.kind, item.hold])).toEqual([['/w', 'number', false], ['/rw', 'toggle', true]])
    expect(palette.unsupported).toEqual([
      { address: '/blob', type: 'b', reason: 'unsupported-type' },
      { address: '/bad name', type: 'f', reason: 'invalid-address' },
    ])
    expect(palette.dropped).toBe(0)
  })

  it('reports an overlong TYPE as unsupported instead of truncating it into a control', () => {
    const hidden = `${'f'.repeat(OSCQUERY.MAX_TYPE_CHARS)}b`
    const long = 'f'.repeat(OSCQUERY.MAX_TYPE_CHARS + 1)
    const shown = 'f'.repeat(OSCQUERY.MAX_TYPE_CHARS)
    // 組み合わせの引数は PAD_DOCUMENT.MAX_FIELDS(16)個まで。TYPE の上限に収まっても、置けない数の引数は未対応にする(D-171)
    const fits = 'f'.repeat(16)
    const parsed = parseOscQueryNamespace({ CONTENTS: { hidden: { TYPE: hidden, ACCESS: 3 }, long: { TYPE: long, ACCESS: 3 }, wide: { TYPE: shown, ACCESS: 3 }, fits: { TYPE: fits, ACCESS: 3 } } })
    if (!parsed.ok) throw new Error('parse failed')
    const palette = buildPalette(parsed.methods)
    expect(palette.items.map(item => [item.address, item.type, item.kind])).toEqual([['/fits', fits, 'composite']])
    expect(palette.unsupported).toEqual([
      { address: '/hidden', type: shown, reason: 'unsupported-type' },
      { address: '/long', type: shown, reason: 'unsupported-type' },
      { address: '/wide', type: shown, reason: 'unsupported-type' },
    ])
  })

  it('rejects addresses with OSC pattern characters or non-ASCII', () => {
    expect(isPaletteAddress('/a/b_1')).toBe(true)
    for (const address of ['/a*', '/a b', '/日本', '/a//b', '/a/', 'a']) expect(isPaletteAddress(address)).toBe(false)
  })
})

describe('HOST_INFO', () => {
  it('reads the boot id and the path extensions, and ignores fields of the wrong type', () => {
    const info = OscQueryHostInfoSchema.parse({ NAME: 'u', OSC_PORT: 9000, OSC_IP: '1.2.3.4', WS_PORT: 'x', EXTENSIONS: { PATH_CHANGED: true }, X_OSCDESK_BOOT_ID: 'b-1' })
    expect(info).toEqual({ NAME: 'u', OSC_PORT: 9000, EXTENSIONS: { PATH_CHANGED: true }, X_OSCDESK_BOOT_ID: 'b-1' })
    expect(supportsPathEvents(info)).toBe(true)
    expect(supportsPathEvents({ EXTENSIONS: { PATH_CHANGED: false } })).toBe(false)
  })
})
