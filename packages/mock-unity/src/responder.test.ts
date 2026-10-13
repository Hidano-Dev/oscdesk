import { describe, expect, it } from 'vitest'

import { SYS } from '@oscdesk/shared'
import type { OscPacket } from '@oscdesk/shared'

import { MockUnityResponder, parseFaultMode, parseOptionListReply } from './responder'

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

  it('answers a list request with its echo followed by the configured list', () => {
    const responder = new MockUnityResponder(undefined, [
      { request: '/mb/segments/get', address: '/mb/segments', options: ['Intro', 'Song A'] },
    ])

    expect(responder.handlePacket({ address: '/mb/segments/get', args: [] })).toEqual([
      { kind: 'message', packet: { address: '/mb/segments/get', args: [] } },
      {
        kind: 'message',
        packet: { address: '/mb/segments', args: [{ type: 's', value: 'Intro' }, { type: 's', value: 'Song A' }] },
      },
    ])
    expect(responder.handlePacket({ address: '/other', args: [] })).toHaveLength(1)
  })

  it('parses --options-reply values and rejects malformed ones', () => {
    expect(parseOptionListReply('/a/get|/a|x|Song A')).toEqual({ request: '/a/get', address: '/a', options: ['x', 'Song A'] })
    expect(parseOptionListReply('/a/get|/a')).toEqual({ request: '/a/get', address: '/a', options: [] })
    expect(() => parseOptionListReply('/a/get')).toThrow('Invalid value for --options-reply')
    expect(() => parseOptionListReply('a|/a|x')).toThrow('Invalid value for --options-reply')
    expect(() => parseOptionListReply('/a/get|/a|x|')).toThrow('Invalid value for --options-reply')
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
})

describe('parseFaultMode', () => {
  it('parses every supported mode', () => {
    expect(parseFaultMode('drop-pong')).toEqual({ kind: 'drop-pong' })
    expect(parseFaultMode('silent')).toEqual({ kind: 'silent' })
    expect(parseFaultMode('corrupt')).toEqual({ kind: 'corrupt' })
    expect(parseFaultMode('random-loss:0.5')).toEqual({ kind: 'random-loss', rate: 0.5 })
    expect(parseFaultMode('delay:150')).toEqual({ kind: 'delay', ms: 150 })
  })

  it('rejects the retired reinject fault and malformed parameters', () => {
    expect(() => parseFaultMode('drop-reinject-manifest')).toThrow('Invalid fault mode')
    expect(() => parseFaultMode('random-loss:1')).toThrow('Invalid fault mode')
    expect(() => parseFaultMode('delay:-1')).toThrow('Invalid fault mode')
  })
})
