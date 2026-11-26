import { describe, expect, it } from 'vitest'

import { hostNameOf, isExpectedHost, isSameOriginPage, localHostNames } from './browser-access'

const names = localHostNames('Stage-PC')

describe('localHostNames (D-138)', () => {
  it('includes localhost, the OS host name, its short form and .local', () => {
    expect([...localHostNames('Stage-PC.corp.example.')].sort()).toEqual(['localhost', 'stage-pc', 'stage-pc.corp.example', 'stage-pc.local'])
    expect([...localHostNames('')]).toEqual(['localhost'])
  })
})

describe('isExpectedHost (D-138)', () => {
  it('accepts IP literals and the names of this PC', () => {
    for (const host of ['192.168.1.10:7080', '127.0.0.1', '[::1]:7080', '[fe80::1]', 'localhost:7080', 'LOCALHOST', 'stage-pc:7080', 'stage-pc.local.', 'Stage-PC.local:7080']) {
      expect(isExpectedHost(host, names), host).toBe(true)
    }
  })

  it('rejects other names (DNS rebinding) and a missing Host', () => {
    for (const host of ['evil.example:7080', '192.168.1.10.nip.io', 'stage-pc.evil.example', '', '   ']) {
      expect(isExpectedHost(host, names), host).toBe(false)
    }
    expect(isExpectedHost(undefined, names)).toBe(false)
  })

  it('reads the host name without the port', () => {
    expect(hostNameOf('[::1]:7080')).toBe('::1')
    expect(hostNameOf('Example:80')).toBe('example')
    expect(hostNameOf('::1')).toBe('::1')
  })
})

describe('isSameOriginPage (D-138)', () => {
  it('accepts the page the bridge served itself', () => {
    expect(isSameOriginPage('http://192.168.1.10:7080', '192.168.1.10:7080', names)).toBe(true)
    expect(isSameOriginPage('http://127.0.0.1:7080', '127.0.0.1:7080', names)).toBe(true)
    expect(isSameOriginPage('http://localhost:7080', 'localhost:7080', names)).toBe(true)
    expect(isSameOriginPage('http://[::1]:7080', '[::1]:7080', names)).toBe(true)
    expect(isSameOriginPage('http://stage-pc.local:7080', 'stage-pc.local:7080', names)).toBe(true)
    // URL は既定のポートを落とす。Host は付けたまま届くことがある
    expect(isSameOriginPage('http://10.0.0.5', '10.0.0.5:80', names)).toBe(true)
  })

  it('rejects third-party pages and DNS rebinding', () => {
    // 第三者のページ: Origin が Host と違う
    expect(isSameOriginPage('http://evil.example', '192.168.1.10:7080', names)).toBe(false)
    expect(isSameOriginPage('http://192.168.1.10:8080', '192.168.1.10:7080', names)).toBe(false)
    // 再束縛: Origin と Host は一致するが名前がこの PC のものでない
    expect(isSameOriginPage('http://evil.example:7080', 'evil.example:7080', names)).toBe(false)
    expect(isSameOriginPage('http://192.168.1.10.nip.io:7080', '192.168.1.10.nip.io:7080', names)).toBe(false)
    expect(isSameOriginPage('null', '192.168.1.10:7080', names)).toBe(false)
    expect(isSameOriginPage('file://', '', names)).toBe(false)
    expect(isSameOriginPage('http://192.168.1.10:7080', undefined, names)).toBe(false)
  })
})
