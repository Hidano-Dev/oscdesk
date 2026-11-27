import { describe, expect, it, vi } from 'vitest'

import type { DownstreamFrame, OscQueryTargetsFrame } from '@oscdesk/shared'

import { createOscQueryTargets, type OscQueryClient, type OscQueryFetchResult } from './oscquery-targets'

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
  const watchers: { host: string; port: number; onPathEvent: (command: string) => void; onClose: (reason: string) => void; closed: boolean }[] = []
  const fetches: string[] = []
  const client: OscQueryClient = {
    read: vi.fn(async (host: string, port: number, query: 'HOST_INFO' | null): Promise<OscQueryFetchResult> => {
      fetches.push(`${host}:${String(port)}${query === null ? '' : '?HOST_INFO'}`)
      if (query === 'HOST_INFO') return options.hostInfo?.() ?? { kind: 'json', value: HOST_INFO }
      return options.namespace?.() ?? { kind: 'json', value: NAMESPACE }
    }),
    watch: vi.fn((host: string, port: number, handlers: { onPathEvent: (command: string) => void; onClose: (reason: string) => void }) => {
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
    expect(targets.handleUiFrame({ v: 1, type: 'osc.queryRefresh' }, 'ui-1')).toBe(true)
    await settle()
    expect(fetches).toEqual(['192.168.1.20:9100?HOST_INFO', '192.168.1.20:9100'])
  })
})
