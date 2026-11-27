import { describe, expect, it } from 'vitest'

import { acceptsGzip } from './web-ui-static'

describe('acceptsGzip', () => {
  it('gzip を挙げていれば受ける', () => {
    expect(acceptsGzip('gzip, deflate, br')).toBe(true)
    expect(acceptsGzip('GZIP')).toBe(true)
    expect(acceptsGzip('gzip;q=0.5')).toBe(true)
    expect(acceptsGzip(['deflate', 'gzip'])).toBe(true)
  })

  it('ヘッダが無い・空・gzip も * も無いときは受けない', () => {
    expect(acceptsGzip(undefined)).toBe(false)
    expect(acceptsGzip('')).toBe(false)
    expect(acceptsGzip('deflate, br')).toBe(false)
    expect(acceptsGzip('identity')).toBe(false)
  })

  it('gzip;q=0 は断り', () => {
    expect(acceptsGzip('gzip;q=0')).toBe(false)
    expect(acceptsGzip('gzip; q=0.000')).toBe(false)
  })

  it('gzip の明示の断りは * より先に効く(HID-473)', () => {
    expect(acceptsGzip('gzip;q=0, *;q=1')).toBe(false)
    expect(acceptsGzip('*;q=1, gzip;q=0')).toBe(false)
    expect(acceptsGzip('*, gzip;q=0')).toBe(false)
  })

  it('gzip の指定が無ければ * に従う', () => {
    expect(acceptsGzip('*')).toBe(true)
    expect(acceptsGzip('br, *;q=0.1')).toBe(true)
    expect(acceptsGzip('*;q=0')).toBe(false)
  })

  it('gzip の明示の受け入れは *;q=0 より先に効く', () => {
    expect(acceptsGzip('gzip, *;q=0')).toBe(true)
  })

  it('同じ符号化が 2 回あり片方で断っていれば断り', () => {
    expect(acceptsGzip('gzip;q=0, gzip')).toBe(false)
    expect(acceptsGzip('gzip, gzip;q=0.5')).toBe(true)
    expect(acceptsGzip('*;q=0, *')).toBe(false)
  })

  it('読めない q 値は受けると言っていないものとして扱う', () => {
    expect(acceptsGzip('gzip;q=abc')).toBe(false)
  })
})
