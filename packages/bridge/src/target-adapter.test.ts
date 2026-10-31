import { describe, expect, it, vi } from 'vitest'

import { SYS } from '@oscdesk/shared'

import { createOscAdapter, SYS_FAILED, SYS_IGNORED, type OscTransportLike, type TargetAdapterHandlers } from './target-adapter'
import type { BundleSendResult, InboundOscMessage } from './surface-core'

const FROM = { host: '192.168.1.20', port: 7090 }
const message = (address: string, args: InboundOscMessage['args'] = []): InboundOscMessage => ({ address, args, from: FROM })

function makeAdapter(blueprintAccepts = true) {
  const handlers = {
    delivered: vi.fn(),
    unbound: vi.fn(),
    failed: vi.fn(),
    blueprint: vi.fn(() => blueprintAccepts),
    alive: vi.fn(),
  } satisfies TargetAdapterHandlers
  const transport = {
    send: vi.fn<OscTransportLike['send']>(),
    sendBundle: vi.fn<OscTransportLike['sendBundle']>((): BundleSendResult => ({ ok: true, bytes: 16, messageCount: 1 })),
  }
  const adapter = createOscAdapter({ transport: () => transport, handlers: () => handlers })
  return { adapter, handlers, transport }
}

describe('createOscAdapter', () => {
  it('sorts received messages into delivered, unbound, failed, blueprint and alive', () => {
    const { adapter, handlers } = makeAdapter()

    adapter.receive(message(SYS.PONG, [{ type: 'i', value: 3 }]))
    adapter.receive(message(SYS_IGNORED, [{ type: 's', value: '/b/name' }, { type: 'i', value: 1 }, { type: 's', value: '/c' }]))
    adapter.receive(message(SYS_FAILED, [{ type: 's', value: '/a' }, { type: 's', value: 'type mismatch' }, { type: 's', value: '/dangling' }]))
    adapter.receive(message('/sys/catalog/begin'))
    adapter.receive(message('/mix/master', [{ type: 'f', value: 0.5 }]))

    expect(handlers.alive).toHaveBeenCalledTimes(1)
    // s 以外の引数と、組にならない末尾は読み飛ばす(任意の契約なので壊れた通知で落とさない)
    expect(handlers.unbound).toHaveBeenCalledWith(FROM, ['/b/name', '/c'])
    expect(handlers.failed).toHaveBeenCalledWith(FROM, [{ ref: '/a', reason: 'type mismatch' }])
    expect(handlers.blueprint).toHaveBeenCalledTimes(1)
    expect(handlers.delivered.mock.calls.map(([received]) => received.address)).toEqual(['/mix/master'])
  })

  it('passes a catalog message the blueprint handler did not take on as delivered', () => {
    const { adapter, handlers } = makeAdapter(false)
    adapter.receive(message('/sys/catalog/unknown'))
    expect(handlers.delivered).toHaveBeenCalledTimes(1)
  })

  it('sends values through the OSC transport and reports a missing transport', () => {
    const { adapter, transport } = makeAdapter()
    adapter.sendValue({ host: '10.0.0.2', port: 9000 }, '/a', [{ type: 'i', value: 1 }])
    expect(transport.send).toHaveBeenCalledWith('10.0.0.2', 9000, '/a', [{ type: 'i', value: 1 }])
    expect(adapter.sendValues({ host: '10.0.0.2', port: 9000 }, [{ address: '/a', args: [] }])).toEqual({ ok: true, bytes: 16, messageCount: 1 })

    const detached = createOscAdapter({ transport: () => undefined, handlers: () => undefined })
    expect(detached.sendValues({ host: '10.0.0.2', port: 9000 }, [])).toEqual({ ok: false, reason: 'transport-unavailable' })
    expect(detached.kind).toBe('osc')
  })
})
