import { describe, expect, it } from 'vitest'

import { isSameOriginIpLiteral } from './browser-origin'

describe('isSameOriginIpLiteral (HID-461)', () => {
  it('accepts the page the bridge served itself, by IP address or localhost', () => {
    expect(isSameOriginIpLiteral('http://192.168.1.10:7080', '192.168.1.10:7080')).toBe(true)
    expect(isSameOriginIpLiteral('http://127.0.0.1:7080', '127.0.0.1:7080')).toBe(true)
    expect(isSameOriginIpLiteral('http://localhost:7080', 'localhost:7080')).toBe(true)
    expect(isSameOriginIpLiteral('http://[::1]:7080', '[::1]:7080')).toBe(true)
    expect(isSameOriginIpLiteral('http://10.0.0.5', '10.0.0.5:80')).toBe(true)
  })

  it('rejects third-party pages and DNS rebinding', () => {
    // 第三者のページ: Origin が Host と違う
    expect(isSameOriginIpLiteral('http://evil.example', '192.168.1.10:7080')).toBe(false)
    expect(isSameOriginIpLiteral('http://192.168.1.10:8080', '192.168.1.10:7080')).toBe(false)
    // 再束縛: Origin と Host は一致するが名前が IP の直書きでない
    expect(isSameOriginIpLiteral('http://evil.example:7080', 'evil.example:7080')).toBe(false)
    expect(isSameOriginIpLiteral('http://192.168.1.10.nip.io:7080', '192.168.1.10.nip.io:7080')).toBe(false)
    expect(isSameOriginIpLiteral('null', '192.168.1.10:7080')).toBe(false)
    expect(isSameOriginIpLiteral('file://', '')).toBe(false)
    expect(isSameOriginIpLiteral('http://192.168.1.10:7080', undefined)).toBe(false)
  })
})
