import { describe, expect, it, vi } from 'vitest'

import { cleanHostname, createSystemHostnameResolver } from './hostname-lookup'

describe('cleanHostname', () => {
  it('keeps real names and drops numeric, localhost and malformed answers', () => {
    expect(cleanHostname('unity-main.lan.')).toBe('unity-main.lan')
    expect(cleanHostname('192.168.1.40')).toBeNull()
    expect(cleanHostname('localhost')).toBeNull()
    expect(cleanHostname('bad name')).toBeNull()
    expect(cleanHostname('')).toBeNull()
    expect(cleanHostname('a'.repeat(254))).toBeNull()
  })
})

describe('createSystemHostnameResolver', () => {
  it('uses the reverse lookup first and falls back to the OS lookup one host at a time', async () => {
    let active = 0
    let peak = 0
    const lookupService = vi.fn(async (host: string) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 1))
      active -= 1
      if (host === '192.168.1.41') return 'DESKTOP-41'
      if (host === '192.168.1.42') return host // 名前が無いと数値で返す実装
      throw new Error('ENOTFOUND')
    })
    const resolver = createSystemHostnameResolver({
      reverse: async host => {
        if (host === '192.168.1.40') return ['unity-main.lan.']
        throw new Error('ENOTFOUND')
      },
      lookupService,
    })
    const results = await resolver.resolve(['192.168.1.40', '192.168.1.41', '192.168.1.42', '192.168.1.43', 'stage-pc'], new AbortController().signal)
    expect(Object.fromEntries(results)).toEqual({
      '192.168.1.40': 'unity-main.lan', '192.168.1.41': 'DESKTOP-41', '192.168.1.42': null, '192.168.1.43': null,
    })
    expect(lookupService.mock.calls.map(call => call[0])).toEqual(['192.168.1.41', '192.168.1.42', '192.168.1.43'])
    expect(peak).toBe(1)
  })

  it('stops at the budget, leaves unfinished hosts out, and does not stack OS lookups across calls', async () => {
    let release: (name: string) => void = () => undefined
    const lookupService = vi.fn(() => new Promise<string>(resolve => { release = resolve }))
    const resolver = createSystemHostnameResolver({ reverse: () => Promise.reject(new Error('ENOTFOUND')), lookupService, budgetMs: 20 })
    const first = await resolver.resolve(['192.168.1.41', '192.168.1.42'], new AbortController().signal)
    expect(first.size).toBe(0)
    // 取り消せない OS の名前解決が終わっていない間は、次の呼び出しで重ねて投げない
    const second = await resolver.resolve(['192.168.1.43'], new AbortController().signal)
    expect(second.size).toBe(0)
    expect(lookupService).toHaveBeenCalledTimes(1)
    release('late')
    await new Promise(resolve => setTimeout(resolve, 0))
    await resolver.resolve(['192.168.1.43'], new AbortController().signal)
    expect(lookupService).toHaveBeenCalledTimes(2)
  })

  it('returns what it has when the caller aborts', async () => {
    const controller = new AbortController()
    const resolver = createSystemHostnameResolver({
      reverse: (host, signal) => host === '192.168.1.40'
        ? Promise.resolve(['fast'])
        : new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')))),
      lookupService: () => new Promise(() => undefined),
    })
    const pending = resolver.resolve(['192.168.1.40', '192.168.1.41'], controller.signal)
    setTimeout(() => controller.abort(new Error('closing')), 5)
    expect(Object.fromEntries(await pending)).toEqual({ '192.168.1.40': 'fast' })
  })
})
