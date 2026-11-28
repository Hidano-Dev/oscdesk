import { describe, expect, it } from 'vitest'

import { SYS } from '@oscdesk/shared'
import type { OscPacket } from '@oscdesk/shared'

import { MockUnityResponder, parseFaultMode } from './responder'

describe('MockUnityResponder', () => {
  it('replies to /sys/ping with /sys/pong carrying the same seq', () => {
    const responder = new MockUnityResponder()

    const replies = responder.handlePacket({
      address: SYS.PING,
      args: [{ type: 'i', value: 7 }],
    })

    expect(replies).toEqual([
      {
        kind: 'message',
        packet: {
          address: SYS.PONG,
          args: [{ type: 'i', value: 7 }],
        },
      },
    ])
  })

  it('does not echo unknown /sys/* messages (including the retired manifest and stats requests)', () => {
    const responder = new MockUnityResponder()

    const replies = responder.handlePacket({
      address: '/sys/stats/request',
      args: [],
    })

    expect(replies).toEqual([])
  })

  it('echoes non-/sys/* messages and expands bundles per message', () => {
    const responder = new MockUnityResponder()
    const packet: OscPacket = {
      timeTag: {
        seconds: 1,
        fractions: 2,
      },
      packets: [
        {
          address: '/avatar/int',
          args: [{ type: 'i', value: 1 }],
        },
        {
          timeTag: {
            seconds: 3,
            fractions: 4,
          },
          packets: [
            {
              address: '/avatar/name',
              args: [{ type: 's', value: 'surface' }],
            },
          ],
        },
      ],
    }

    const replies = responder.handlePacket(packet)

    expect(replies).toEqual([
      {
        kind: 'message',
        packet: {
          address: '/avatar/int',
          args: [{ type: 'i', value: 1 }],
        },
      },
      {
        kind: 'message',
        packet: {
          address: '/avatar/name',
          args: [{ type: 's', value: 'surface' }],
        },
      },
    ])
  })

  it('drops only /sys/pong replies in drop-pong mode', () => {
    const responder = new MockUnityResponder({ kind: 'drop-pong' })

    expect(
      responder.handlePacket({
        address: SYS.PING,
        args: [{ type: 'i', value: 1 }],
      }),
    ).toEqual([])
    expect(
      responder.handlePacket({
        address: '/avatar/toggle',
        args: [{ type: 'i', value: 1 }],
      }),
    ).toEqual([
      {
        kind: 'message',
        packet: {
          address: '/avatar/toggle',
          args: [{ type: 'i', value: 1 }],
        },
      },
    ])
  })

  it('suppresses all replies in silent mode', () => {
    const responder = new MockUnityResponder({ kind: 'silent' })

    expect(
      responder.handlePacket({
        address: SYS.PING,
        args: [{ type: 'i', value: 2 }],
      }),
    ).toEqual([])
    expect(
      responder.handlePacket({
        address: '/sys/stats/request',
        args: [],
      }),
    ).toEqual([])
  })

  it('drops /sys/pong replies in a deterministic random-loss pattern', () => {
    const responder = new MockUnityResponder({
      kind: 'random-loss',
      rate: 0.5,
    })

    const replies = Array.from({ length: 6 }, (_, index) =>
      responder.handlePacket({
        address: SYS.PING,
        args: [{ type: 'i', value: index + 1 }],
      }),
    )

    expect(replies).toEqual([
      [{ kind: 'message', packet: { address: SYS.PONG, args: [{ type: 'i', value: 1 }] } }],
      [],
      [{ kind: 'message', packet: { address: SYS.PONG, args: [{ type: 'i', value: 3 }] } }],
      [],
      [{ kind: 'message', packet: { address: SYS.PONG, args: [{ type: 'i', value: 5 }] } }],
      [],
    ])
  })

  it('attaches delay instructions only to /sys/pong replies in delay mode', () => {
    const responder = new MockUnityResponder({ kind: 'delay', ms: 150 })

    const pongReplies = responder.handlePacket({
      address: SYS.PING,
      args: [{ type: 'i', value: 8 }],
    })
    const echoReplies = responder.handlePacket({
      address: '/avatar/float',
      args: [{ type: 'f', value: 0.25 }],
    })

    expect(pongReplies).toEqual([
      {
        kind: 'message',
        packet: {
          address: SYS.PONG,
          args: [{ type: 'i', value: 8 }],
        },
        delayMs: 150,
      },
    ])
    expect(echoReplies).toEqual([
      {
        kind: 'message',
        packet: {
          address: '/avatar/float',
          args: [{ type: 'f', value: 0.25 }],
        },
      },
    ])
  })

  it('delays every reply but /sys/pong in delay-echo mode, outcome reports included', () => {
    const responder = new MockUnityResponder({ kind: 'delay-echo', ms: 400 }, { known: [] })
    const pong = responder.handlePacket({ address: SYS.PING, args: [{ type: 'i', value: 8 }] })
    const echo = responder.handlePacket({ address: '/avatar/float', args: [{ type: 'f', value: 0.25 }] })
    expect(pong).toEqual([{ kind: 'message', packet: { address: SYS.PONG, args: [{ type: 'i', value: 8 }] } }])
    expect(echo.map(reply => [reply.kind === 'message' ? reply.packet.address : 'raw', reply.delayMs])).toEqual([
      ['/avatar/float', 400],
      [SYS.IGNORED, 400],
    ])
  })

  it('replaces replies with invalid raw payloads in corrupt mode', () => {
    const responder = new MockUnityResponder({ kind: 'corrupt' })

    const replies = responder.handlePacket({
      address: '/avatar/name',
      args: [{ type: 's', value: 'surface' }],
    })

    expect(replies).toEqual([
      {
        kind: 'raw',
        payload: Uint8Array.from([0xde, 0xad, 0xbe, 0xef]),
      },
    ])
  })

  describe('outcome reports (/sys/ignored, /sys/failed)', () => {
    const msg = (address: string, v = 1): OscPacket => ({ address, args: [{ type: 'i', value: v }] })
    const addresses = (replies: ReturnType<MockUnityResponder['handlePacket']>) =>
      replies.map(reply => (reply.kind === 'message' ? reply.packet.address : '(raw)'))

    it('reports nothing by default, like an older receiver', () => {
      expect(addresses(new MockUnityResponder().handlePacket(msg('/x')))).toEqual(['/x'])
    })

    it('reports an unknown address as ignored after the echo', () => {
      const responder = new MockUnityResponder(undefined, { known: ['/a'] })

      expect(addresses(responder.handlePacket(msg('/a')))).toEqual(['/a'])
      const replies = responder.handlePacket(msg('/b'))
      expect(addresses(replies)).toEqual(['/b', SYS.IGNORED])
      expect(replies[1]).toEqual({ kind: 'message', packet: { address: SYS.IGNORED, args: [{ type: 's', value: '/b' }] } })
    })

    it('reports a failing address with its reason', () => {
      const responder = new MockUnityResponder(undefined, { known: ['/c'], failing: { '/c': 'type mismatch' } })

      const replies = responder.handlePacket(msg('/c'))

      expect(replies[1]).toEqual({
        kind: 'message',
        packet: {
          address: SYS.FAILED,
          args: [
            { type: 's', value: '/c' },
            { type: 's', value: 'type mismatch' },
          ],
        },
      })
    })

    it('caps the report like the real receiver so a large bundle cannot make an unsendable datagram', () => {
      const address = '/' + 'a'.repeat(200)
      const responder = new MockUnityResponder(undefined, { failing: { [address]: 'record mismatch' }, known: [] })
      const packets = Array.from({ length: 511 }, () => msg(address))

      const replies = responder.handlePacket({ timeTag: { raw: [0, 1] }, packets } as unknown as OscPacket)

      const failed = replies.find(r => r.kind === 'message' && r.packet.address === SYS.FAILED)
      expect(failed).toMatchObject({ packet: { args: expect.any(Array) } })
      const args = (failed as { packet: { args: { value: string }[] } }).packet.args
      expect(args).toHaveLength(32)
      expect(args.every(a => a.value.length <= 128)).toBe(true)
    })

    it('folds a bundle into one message of each kind and does not report /sys/*', () => {
      const responder = new MockUnityResponder(undefined, { known: [], failing: { '/f': 'exception' } })

      const replies = responder.handlePacket({
        timeTag: { raw: [0, 1] },
        packets: [msg('/p'), msg('/q'), msg('/p'), msg('/f'), { address: SYS.PING, args: [{ type: 'i', value: 1 }] }],
      } as unknown as OscPacket)

      expect(addresses(replies)).toEqual(['/p', '/q', '/p', '/f', SYS.PONG, SYS.IGNORED, SYS.FAILED])
      const ignored = replies.find(r => r.kind === 'message' && r.packet.address === SYS.IGNORED)
      expect(ignored).toMatchObject({ packet: { args: [{ value: '/p' }, { value: '/q' }] } })
    })
  })
})

describe('parseFaultMode', () => {
  it('parses every supported mode', () => {
    expect(parseFaultMode('drop-pong')).toEqual({ kind: 'drop-pong' })
    expect(parseFaultMode('silent')).toEqual({ kind: 'silent' })
    expect(parseFaultMode('corrupt')).toEqual({ kind: 'corrupt' })
    expect(parseFaultMode('random-loss:0.5')).toEqual({ kind: 'random-loss', rate: 0.5 })
    expect(parseFaultMode('delay:150')).toEqual({ kind: 'delay', ms: 150 })
    expect(parseFaultMode('delay-echo:400')).toEqual({ kind: 'delay-echo', ms: 400 })
  })

  it('rejects the retired reinject fault and malformed parameters', () => {
    expect(() => parseFaultMode('drop-reinject-manifest')).toThrow('Invalid fault mode')
    expect(() => parseFaultMode('random-loss:1')).toThrow('Invalid fault mode')
    expect(() => parseFaultMode('delay:-1')).toThrow('Invalid fault mode')
    expect(() => parseFaultMode('delay-echo:1.5')).toThrow('Invalid fault mode')
  })
})

describe('sync signals (D-169)', () => {
  it('logs /sys/sync/begin with its reason and /sys/sync/end without echoing them', () => {
    const log: string[] = []
    const responder = new MockUnityResponder(undefined, {}, line => log.push(line))
    expect(responder.handlePacket({ address: SYS.SYNC_BEGIN, args: [{ type: 's', value: 'manual' }] })).toEqual([])
    expect(responder.handlePacket({ address: SYS.SYNC_END, args: [] })).toEqual([])
    expect(log).toEqual(['MOCK_UNITY_SYNC begin manual', 'MOCK_UNITY_SYNC end'])
  })
})
