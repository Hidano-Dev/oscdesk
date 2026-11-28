import { describe, expect, it, vi } from 'vitest'

import type { DownstreamFrame, OscQueryTargetsFrame } from '@oscdesk/shared'

import { createOscQueryTargets, fitPalette, type OscQueryClient, type OscQueryFetchResult } from './oscquery-targets'

const NAMESPACE = {
  CONTENTS: {
    level: { TYPE: 'f', ACCESS: 3, RANGE: [{ MIN: 0, MAX: 1 }] },
    go: { TYPE: 'N', ACCESS: 2 },
    fps: { TYPE: 'f', ACCESS: 1 },
  },
}
const HOST_INFO = { NAME: 'Unity', OSC_PORT: 9000, EXTENSIONS: { PATH_CHANGED: true }, X_OSCDESK_BOOT_ID: 'boot-1' }

function setup(options: { hostInfo?: () => OscQueryFetchResult; namespace?: () => OscQueryFetchResult; configTargets?: { host: string; port: number }[] } = {}) {
  const timers: { cb: () => void; ms: number; id: number }[] = []
  let nextId = 1
  const watchers: { host: string; port: number; onOpen?: () => void; onPathEvent: (command: string) => void; onClose: (reason: string) => void; closed: boolean }[] = []
  const fetches: string[] = []
  const client: OscQueryClient = {
    read: vi.fn(async (host: string, port: number, query: 'HOST_INFO' | null): Promise<OscQueryFetchResult> => {
      fetches.push(`${host}:${String(port)}${query === null ? '' : '?HOST_INFO'}`)
      if (query === 'HOST_INFO') return options.hostInfo?.() ?? { kind: 'json', value: HOST_INFO }
      return options.namespace?.() ?? { kind: 'json', value: NAMESPACE }
    }),
    watch: vi.fn((host: string, port: number, handlers: { onOpen?: () => void; onPathEvent: (command: string) => void; onClose: (reason: string) => void }) => {
      const watcher = { host, port, ...handlers, closed: false }
      watchers.push(watcher)
      return { close: () => { watcher.closed = true } }
    }),
  }
  const frames: OscQueryTargetsFrame[] = []
  const onDestinationsChanged = vi.fn()
  const targets = createOscQueryTargets({
    configTargets: options.configTargets ?? [],
    client,
    isAllowedHost: host => host.startsWith('192.168.1.'),
    mdnsState: () => 'running',
    publish: (frame: DownstreamFrame) => {
      if (frame.type === 'osc.queryTargets') frames.push(frame)
    },
    onDestinationsChanged,
    fetchTimeoutMs: 1_000,
    refreshDebounceMs: 100,
    retryMs: 1_000,
    now: () => Date.parse('2026-11-27T00:00:00.000Z'),
    setTimeoutFn: (cb, ms) => {
      const id = nextId++
      timers.push({ cb, ms, id })
      return id
    },
    clearTimeoutFn: handle => {
      const index = timers.findIndex(timer => timer.id === handle)
      if (index >= 0) timers.splice(index, 1)
    },
    logInfo: () => undefined,
    logWarn: () => undefined,
  })
  // 時間切れのタイマー(fetchTimeoutMs)以外を発火する
  const fire = (ms: number) => {
    for (const timer of timers.filter(entry => entry.ms === ms)) {
      timers.splice(timers.indexOf(timer), 1)
      timer.cb()
    }
  }
  const settle = () => new Promise(resolve => setTimeout(resolve, 0))
  const last = () => frames[frames.length - 1]!
  return { targets, client, frames, last, watchers, fetches, fire, settle, onDestinationsChanged, timers }
}

describe('createOscQueryTargets', () => {
  it('reads HOST_INFO and the namespace of a found service and publishes the writable nodes as a palette', async () => {
    const { targets, last, settle, onDestinationsChanged, watchers } = setup()
    targets.serviceFound({ instance: 'Unity-9100', host: '192.168.1.20', port: 9100 })
    expect(last().targets[0]).toMatchObject({ id: 'Unity-9100', status: 'loading', source: 'mdns' })
    await settle()
    const target = last().targets[0]!
    expect(target).toMatchObject({ name: 'Unity', host: '192.168.1.20', httpPort: 9100, oscPort: 9000, bootId: 'boot-1', status: 'ready', pathEvents: true })
    expect(target.palette.map(item => [item.address, item.kind, item.hold])).toEqual([['/level', 'slider', true], ['/go', 'button', false]])
    expect(targets.destinations()).toEqual([{ host: '192.168.1.20', oscPort: 9000, name: 'Unity' }])
    expect([...targets.paletteAddresses()]).toEqual(['/level', '/go'])
    expect(onDestinationsChanged).toHaveBeenCalled()
    expect(watchers).toHaveLength(1)
    expect(watchers[0]).toMatchObject({ host: '192.168.1.20', port: 9100 })
  })

  it('ignores services outside the target networks', async () => {
    const { targets, last, settle } = setup()
    targets.serviceFound({ instance: 'x', host: '10.0.0.5', port: 9100 })
    await settle()
    targets.publish()
    expect(last().targets).toEqual([])
  })

  it('reloads the tree once for a burst of PATH_* events', async () => {
    const { targets, settle, watchers, fetches, fire } = setup()
    targets.serviceFound({ instance: 'u', host: '192.168.1.20', port: 9100 })
    await settle()
    fetches.length = 0
    watchers[0]!.onPathEvent('PATH_ADDED')
    watchers[0]!.onPathEvent('PATH_REMOVED')
    watchers[0]!.onPathEvent('PATH_CHANGED')
    fire(100)
    await settle()
    expect(fetches).toEqual(['192.168.1.20:9100?HOST_INFO', '192.168.1.20:9100'])
    expect(watchers).toHaveLength(1)
  })

  it('treats a 204 or 400 HOST_INFO as unsupported and still builds the palette', async () => {
    for (const status of [204, 400]) {
      const { targets, last, settle, watchers } = setup({ hostInfo: () => ({ kind: 'unsupported', status }) })
      targets.serviceFound({ instance: 'u', host: '192.168.1.20', port: 9100 })
      await settle()
      expect(last().targets[0]).toMatchObject({ status: 'ready', oscPort: null, bootId: null, pathEvents: false })
      expect(last().targets[0]!.palette).toHaveLength(2)
      expect(watchers).toHaveLength(0)
      expect(targets.destinations()).toEqual([])
    }
  })

  it('reports an unusable namespace and retries later', async () => {
    let tree: OscQueryFetchResult = { kind: 'json', value: [] }
    const { targets, last, settle, fire, timers } = setup({ namespace: () => tree })
    targets.serviceFound({ instance: 'u', host: '192.168.1.20', port: 9100 })
    await settle()
    expect(last().targets[0]).toMatchObject({ status: 'error', error: 'the namespace is not usable (not-an-object)' })
    expect(timers.some(timer => timer.ms === 1_000)).toBe(true)
    tree = { kind: 'json', value: NAMESPACE }
    fire(1_000)
    await settle()
    expect(last().targets[0]).toMatchObject({ status: 'ready', error: null })
  })

  it('reloads on an mDNS announcement of a known service and follows an address change', async () => {
    const { targets, settle, fetches, watchers, last, fire } = setup()
    targets.serviceFound({ instance: 'u', host: '192.168.1.20', port: 9100 })
    await settle()
    fetches.length = 0
    targets.serviceFound({ instance: 'u', host: '192.168.1.21', port: 9100 })
    // 告知の読み直しは PATH_* と同じく間引く
    targets.serviceFound({ instance: 'u', host: '192.168.1.21', port: 9100 })
    fire(100)
    await settle()
    expect(fetches).toEqual(['192.168.1.21:9100?HOST_INFO', '192.168.1.21:9100'])
    expect(fetches[0]).toBe('192.168.1.21:9100?HOST_INFO')
    expect(watchers[0]!.closed).toBe(true)
    expect(watchers[1]).toMatchObject({ host: '192.168.1.21' })
    expect(last().targets[0]!.host).toBe('192.168.1.21')
  })

  it('drops a lost service and closes its WebSocket', async () => {
    const { targets, settle, watchers, last } = setup()
    targets.serviceFound({ instance: 'u', host: '192.168.1.20', port: 9100 })
    await settle()
    targets.serviceLost('u')
    expect(last().targets).toEqual([])
    expect(watchers[0]!.closed).toBe(true)
    expect(targets.destinations()).toEqual([])
  })

  it('reads config targets at start and does not duplicate them when mDNS finds the same one', async () => {
    const { targets, settle, last } = setup({ configTargets: [{ host: '127.0.0.1', port: 9100 }] })
    targets.start()
    await settle()
    targets.serviceFound({ instance: 'Unity-9100', host: '127.0.0.1', port: 9100 })
    await settle()
    expect(last().targets.map(target => [target.id, target.source])).toEqual([['127.0.0.1:9100', 'config']])
  })

  it('reads at most two namespaces at a time across all targets', async () => {
    let inFlight = 0
    let peak = 0
    const releases: (() => void)[] = []
    // HOST_INFO の答えを手で離すまで止めておき、同時にいくつ読んでいるかを数える
    const slow = setup()
    slow.client.read = vi.fn(async (_host: string, _port: number, query: 'HOST_INFO' | null): Promise<OscQueryFetchResult> => {
      if (query === 'HOST_INFO') {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise<void>(resolve => releases.push(resolve))
        inFlight -= 1
        return { kind: 'json', value: HOST_INFO }
      }
      return { kind: 'json', value: NAMESPACE }
    })
    for (let index = 0; index < 5; index += 1) slow.targets.serviceFound({ instance: `u${String(index)}`, host: `192.168.1.${String(20 + index)}`, port: 9100 })
    await slow.settle()
    expect(inFlight).toBe(2)
    while (releases.length > 0) {
      releases.shift()!()
      await slow.settle()
    }
    expect(peak).toBe(2)
    expect(slow.last().targets.every(target => target.status === 'ready')).toBe(true)
  })

  it('reloads after the WebSocket closes and answers osc.queryRefresh', async () => {
    const { targets, settle, watchers, fire, fetches, last } = setup()
    targets.serviceFound({ instance: 'u', host: '192.168.1.20', port: 9100 })
    await settle()
    watchers[0]!.onClose('closed with 1006')
    expect(last().targets[0]!.pathEvents).toBe(false)
    fire(1_000)
    await settle()
    expect(watchers).toHaveLength(2)
    fetches.length = 0
    // 連打されても読み直しは間引いて 1 回
    expect(targets.handleUiFrame({ v: 1, type: 'osc.queryRefresh' }, 'ui-1')).toBe(true)
    expect(targets.handleUiFrame({ v: 1, type: 'osc.queryRefresh' }, 'ui-1')).toBe(true)
    fire(100)
    await settle()
    expect(fetches).toEqual(['192.168.1.20:9100?HOST_INFO', '192.168.1.20:9100'])
  })

  it('drops a load in flight when the endpoint changes, and never mixes the old HOST_INFO with the new address', async () => {
    const pending: { host: string; query: 'HOST_INFO' | null; resolve: (result: OscQueryFetchResult) => void }[] = []
    const made = setup()
    made.client.read = vi.fn((host: string, _port: number, query: 'HOST_INFO' | null) => new Promise<OscQueryFetchResult>(resolve => {
      pending.push({ host, query, resolve })
    }))
    made.targets.serviceFound({ instance: 'u', host: '192.168.1.20', port: 9100 })
    await made.settle()
    expect(pending.map(entry => `${entry.host}?${String(entry.query)}`)).toEqual(['192.168.1.20?HOST_INFO'])
    // 読んでいる最中にアドレスが変わる
    made.targets.serviceFound({ instance: 'u', host: '192.168.1.21', port: 9100 })
    expect(made.last().targets[0]).toMatchObject({ host: '192.168.1.21', oscPort: null, status: 'loading' })
    // 旧アドレスの HOST_INFO が後から返っても使わない(新アドレスの名前空間を取りに行かない)
    pending[0]!.resolve({ kind: 'json', value: { ...HOST_INFO, OSC_PORT: 1111 } })
    await made.settle()
    expect(pending).toHaveLength(1)
    expect(made.targets.destinations()).toEqual([])
    made.fire(100)
    await made.settle()
    expect(pending.map(entry => `${entry.host}?${String(entry.query)}`)).toEqual(['192.168.1.20?HOST_INFO', '192.168.1.21?HOST_INFO'])
    pending[1]!.resolve({ kind: 'json', value: { ...HOST_INFO, OSC_PORT: 2222 } })
    await made.settle()
    expect(pending[2]?.host).toBe('192.168.1.21')
    pending[2]!.resolve({ kind: 'json', value: NAMESPACE })
    await made.settle()
    expect(made.targets.destinations()).toEqual([{ host: '192.168.1.21', oscPort: 2222, name: 'Unity' }])
  })

  it('reconnects the WebSocket when WS_PORT or the PATH extensions change', async () => {
    let info: Record<string, unknown> = { ...HOST_INFO, WS_PORT: 9200 }
    const { targets, settle, watchers, fire, last } = setup({ hostInfo: () => ({ kind: 'json', value: info }) })
    targets.serviceFound({ instance: 'u', host: '192.168.1.20', port: 9100 })
    await settle()
    expect(watchers.map(watcher => watcher.port)).toEqual([9200])
    info = { ...HOST_INFO, WS_PORT: 9300 }
    targets.handleUiFrame({ v: 1, type: 'osc.queryRefresh' }, 'ui-1')
    fire(100)
    await settle()
    expect(watchers.map(watcher => [watcher.port, watcher.closed])).toEqual([[9200, true], [9300, false]])
    // 同じ接続先なら張り直さない
    targets.handleUiFrame({ v: 1, type: 'osc.queryRefresh' }, 'ui-1')
    fire(100)
    await settle()
    expect(watchers).toHaveLength(2)
    // PATH_* に対応しなくなったら閉じる
    info = { ...HOST_INFO, WS_PORT: 9300, EXTENSIONS: {} }
    targets.handleUiFrame({ v: 1, type: 'osc.queryRefresh' }, 'ui-1')
    fire(100)
    await settle()
    expect(watchers[1]!.closed).toBe(true)
    expect(last().targets[0]!.pathEvents).toBe(false)
    // 古い接続からの知らせは無視する
    watchers[0]!.onPathEvent('PATH_CHANGED')
    watchers[0]!.onClose('late')
    expect(last().targets[0]!.pathEvents).toBe(false)
  })

  it('backs off WebSocket reconnects on their own, even while HTTP keeps succeeding', async () => {
    const { targets, settle, watchers, fire, timers } = setup()
    targets.serviceFound({ instance: 'u', host: '192.168.1.20', port: 9100 })
    await settle()
    const delays: number[] = []
    for (let round = 0; round < 4; round += 1) {
      watchers.at(-1)!.onClose('refused')
      // 読み込みは終わっているので、残っているタイマーは WebSocket のつなぎ直しだけ
      const timer = timers.find(entry => entry.ms >= 1_000)
      delays.push(timer!.ms)
      fire(timer!.ms)
      await settle()
    }
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000])
    // つながったら間隔を戻す
    watchers.at(-1)!.onOpen?.()
    watchers.at(-1)!.onClose('refused')
    expect(timers.some(entry => entry.ms === 1_000)).toBe(true)
  })

  it('keeps one target per endpoint and caps the targets one host can announce', async () => {
    const { targets, settle, last } = setup()
    targets.serviceFound({ instance: 'a', host: '192.168.1.20', port: 9100 })
    targets.serviceFound({ instance: 'alias-of-a', host: '192.168.1.20', port: 9100 })
    for (let index = 0; index < 12; index += 1) targets.serviceFound({ instance: `n${String(index)}`, host: '192.168.1.20', port: 9200 + index })
    await settle()
    expect(last().targets.map(target => target.id)).toEqual(['a', 'n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6'])
  })

  it('keeps a shared target until the last instance announcing its endpoint goes away', async () => {
    const { targets, settle, last, fetches } = setup()
    targets.serviceFound({ instance: 'A', host: '192.168.1.20', port: 9100 })
    targets.serviceFound({ instance: 'B', host: '192.168.1.20', port: 9100 })
    await settle()
    expect(last().targets.map(target => target.id)).toEqual(['A'])
    const reads = fetches.length
    targets.serviceLost('A')
    expect(last().targets.map(target => [target.id, target.status])).toEqual([['A', 'ready']])
    expect(fetches.length).toBe(reads)
    expect(targets.destinations()).toHaveLength(1)
    targets.serviceLost('B')
    expect(last().targets).toEqual([])
    // 消えた後に同じ名前がまた現れたら、新しいターゲットとして読む
    targets.serviceFound({ instance: 'B', host: '192.168.1.20', port: 9100 })
    await settle()
    expect(last().targets.map(target => [target.id, target.status])).toEqual([['B', 'ready']])
  })

  it('moves one instance of a shared target to its new endpoint without dropping the others', async () => {
    const { targets, settle, last } = setup()
    targets.serviceFound({ instance: 'A', host: '192.168.1.20', port: 9100 })
    targets.serviceFound({ instance: 'B', host: '192.168.1.20', port: 9100 })
    await settle()
    targets.serviceFound({ instance: 'B', host: '192.168.1.20', port: 9200 })
    await settle()
    expect(last().targets.map(target => [target.id, target.httpPort])).toEqual([['A', 9100], ['B', 9200]])
    targets.serviceLost('A')
    expect(last().targets.map(target => target.id)).toEqual(['B'])
  })

  it('drops mDNS targets that fall outside the target range and takes them back when found again', async () => {
    let allowed = true
    const made = setup()
    const targets = createOscQueryTargets({
      configTargets: [],
      client: made.client,
      isAllowedHost: () => allowed,
      mdnsState: () => 'running',
      publish: () => undefined,
      fetchTimeoutMs: 1_000,
      refreshDebounceMs: 100,
      logInfo: () => undefined,
      logWarn: () => undefined,
    })
    targets.serviceFound({ instance: 'A', host: '192.168.1.20', port: 9100 })
    await made.settle()
    allowed = false
    targets.revalidate()
    expect(targets.destinations()).toEqual([])
    allowed = true
    targets.serviceFound({ instance: 'A', host: '192.168.1.20', port: 9100 })
    await made.settle()
    expect(targets.destinations()).toHaveLength(1)
    targets.close()
  })

  it('fits the palette into a size budget and counts what it dropped', () => {
    const item = { address: '/a', type: 'f', access: 3 as const, description: null, extendedType: null, range: [], kind: 'number' as const, hold: true }
    const size = JSON.stringify(item).length + 1
    const fitted = fitPalette([item, { ...item, address: '/b' }, { ...item, address: '/c' }], [{ address: '/x', type: 't', reason: 'unsupported-type' }], size * 2)
    expect(fitted.items.map(entry => entry.address)).toEqual(['/a', '/b'])
    expect(fitted.unsupported).toEqual([])
    expect(fitted.dropped).toBe(2)
    expect(fitted.bytes).toBe(size * 2)
  })

  it('shares a total palette budget across targets', async () => {
    // 1 項目およそ 1.5 KB の候補を 800 個(1 MiB を少し超える)返す名前空間
    const contents = Object.fromEntries(Array.from({ length: 800 }, (_, index) => [`n${String(index)}`, { TYPE: 's', ACCESS: 3, RANGE: [{ VALS: Array.from({ length: 6 }, () => 'v'.repeat(240)) }] }]))
    const { targets, settle, last } = setup({ namespace: () => ({ kind: 'json', value: { CONTENTS: contents } }) })
    for (let index = 0; index < 10; index += 1) targets.serviceFound({ instance: `u${String(index)}`, host: `192.168.1.${String(20 + index)}`, port: 9100 })
    for (let round = 0; round < 10; round += 1) await settle()
    const sizes = last().targets.map(target => JSON.stringify(target.palette).length)
    expect(sizes.every(size => size <= 1024 * 1024)).toBe(true)
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBeLessThanOrEqual(8 * 1024 * 1024)
    expect(last().targets.every(target => target.dropped > 0)).toBe(true)
  })

  it('handles a watch that fails synchronously', async () => {
    const made = setup()
    made.client.watch = vi.fn((_host: string, _port: number, handlers: { onClose: (reason: string) => void }) => {
      handlers.onClose('cannot connect')
      return { close: () => undefined }
    })
    made.targets.serviceFound({ instance: 'u', host: '192.168.1.20', port: 9100 })
    await made.settle()
    expect(made.last().targets[0]).toMatchObject({ status: 'ready', pathEvents: false })
    expect(made.timers.some(entry => entry.ms === 1_000)).toBe(true)
  })
})
