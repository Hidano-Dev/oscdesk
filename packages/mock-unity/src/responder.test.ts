import { describe, expect, it } from 'vitest'
import path from 'node:path'

import { ManifestSchema, SYS, StatsPayloadSchema } from '@oscdesk/shared'
import type { OscPacket } from '@oscdesk/shared'

import { MockUnityResponder, parseFaultMode, type FaultMode, type MockUnityReply } from './responder'
import { loadScenarioDefinition, ScenarioRuntime, ScenarioSchema } from './scenario'

describe('MockUnityResponder', () => {
  it('replies to /sys/ping with /sys/pong carrying the same seq', () => {
    const responder = new MockUnityResponder(createClock())

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

  it('replies to /sys/stats/request with a schema-valid JSON payload', () => {
    const responder = new MockUnityResponder(createClock())

    responder.handlePacket({
      address: '/avatar/float',
      args: [{ type: 'f', value: 0.5 }],
    })
    const replies = responder.handlePacket({
      address: SYS.STATS_REQUEST,
      args: [],
    })

    expect(replies).toHaveLength(1)
    expect(replies[0]).toMatchObject({
      kind: 'message',
      packet: {
        address: SYS.STATS,
        args: [{ type: 's' }],
      },
    })

    const [payloadArg] = getMessagePacket(replies[0]).args
    expect(payloadArg.type).toBe('s')
    const payload = StatsPayloadSchema.parse(JSON.parse(payloadArg.value as string))

    expect(payload).toEqual({
      received: 2,
      parseErrors: 0,
      lastReceivedAt: '2026-07-23T00:00:01.000Z',
    })
  })

  it('does not echo unknown /sys/* messages', () => {
    const responder = new MockUnityResponder(createClock())

    const replies = responder.handlePacket({
      address: SYS.MANIFEST_REQUEST,
      args: [],
    })

    expect(replies).toEqual([])
    expect(responder.statsSnapshot()).toEqual({
      received: 1,
      parseErrors: 0,
      lastReceivedAt: '2026-07-23T00:00:00.000Z',
    })
  })

  it('replies to /sys/manifest/request with a schema-valid manifest JSON when a scenario is configured', () => {
    const responder = new MockUnityResponder(
      createClock(),
      createScenarioRuntime({
        entries: [
          {
            address: '/avatar/text/name',
            label: '{characterName}',
            type: 's',
            widget: 'text',
            default: '{characterName}',
          },
        ],
      }),
    )

    const replies = responder.handlePacket({
      address: SYS.MANIFEST_REQUEST,
      args: [],
    })

    expect(replies).toEqual([
      {
        kind: 'message',
        packet: {
          address: SYS.MANIFEST,
          args: [{ type: 's', value: expect.any(String) }],
        },
      },
    ])
    expect(
      ManifestSchema.parse(JSON.parse(String(getMessagePacket(replies[0]).args[0]?.value))).entries[0],
    ).toMatchObject({
      address: '/avatar/text/name',
      default: '初音ミク',
    })
  })

  it('reflects echoed non-/sys/* values into the next manifest response', () => {
    const responder = new MockUnityResponder(
      createClock(),
      createScenarioRuntime({
        entries: [
          {
            address: '/avatar/blend/smile',
            label: 'Smile',
            type: 'f',
            widget: 'fader',
            range: [0, 1],
            default: 0.25,
          },
        ],
      }),
    )

    const echoReplies = responder.handlePacket({
      address: '/avatar/blend/smile',
      args: [{ type: 'f', value: 0.75 }],
    })
    const manifestReplies = responder.handlePacket({
      address: SYS.MANIFEST_REQUEST,
      args: [],
    })

    expect(echoReplies).toEqual([
      {
        kind: 'message',
        packet: {
          address: '/avatar/blend/smile',
          args: [{ type: 'f', value: 0.75 }],
        },
      },
    ])
    expect(
      ManifestSchema.parse(JSON.parse(String(getMessagePacket(manifestReplies[0]).args[0]?.value))).entries[0],
    ).toMatchObject({
      address: '/avatar/blend/smile',
      default: 0.75,
    })
  })

  it('echoes input and select values at the same addresses in the normal scenario', () => {
    const responder = new MockUnityResponder(
      createClock(),
      new ScenarioRuntime(
        loadScenarioDefinition(path.resolve(__dirname, '../scenarios/input-select.json')),
      ),
    )
    const values = [
      { address: '/controls/client-ip', type: 's' as const, value: '10.0.0.25' },
      { address: '/controls/mb-port', type: 'i' as const, value: 10001 },
      { address: '/controls/face-smoothing', type: 'f' as const, value: 0.8 },
      { address: '/controls/lipsync-mode', type: 's' as const, value: 'External' },
      { address: '/controls/lipsync-device', type: 's' as const, value: 'Face Device B' },
      { address: '/controls/legacy-device', type: 's' as const, value: 'Disconnected Device' },
    ]

    for (const value of values) {
      expect(responder.handlePacket({ address: value.address, args: [value] })).toEqual([
        { kind: 'message', packet: { address: value.address, args: [value] } },
      ])
    }

    const manifestReply = responder.handlePacket({ address: SYS.MANIFEST_REQUEST, args: [] })[0]
    const manifest = ManifestSchema.parse(
      JSON.parse(String(getMessagePacket(manifestReply).args[0]?.value)),
    )
    for (const value of values) {
      expect(manifest.entries.find((entry) => entry.address === value.address)?.default).toBe(
        value.value,
      )
    }
  })

  it('runs the upstream staging scenario for slot and whole-group operations', () => {
    const responder = new MockUnityResponder(
      createClock(),
      new ScenarioRuntime(
        loadScenarioDefinition(path.resolve(__dirname, '../scenarios/staging.json')),
      ),
    )

    expect(responder.handlePacket({
      address: '/member/01/name',
      args: [{ type: 's', value: 'Alicia' }],
    })).toEqual([
      { kind: 'message', packet: { address: '/member/01/name', args: [{ type: 's', value: 'Alicia' }] } },
    ])
    expect(responder.handlePacket({
      address: '/member/01/enabled',
      args: [{ type: 'T', value: true }],
    } as unknown as OscPacket)).toEqual([
      { kind: 'message', packet: { address: '/member/01/enabled', args: [{ type: 'T', value: true }] } },
    ])

    expect(responder.handlePacket({
      address: '/member/01/update',
      args: [{ type: 'i', value: 1 }],
    })).toEqual([
      { kind: 'message', packet: { address: '/member/01/update', args: [{ type: 'i', value: 1 }] } },
    ])
    expect(responder.handlePacket({
      address: '/member/01/update',
      args: [{ type: 'i', value: 0 }],
    })).toEqual([
      { kind: 'message', packet: { address: '/member/01/update', args: [{ type: 'i', value: 0 }] } },
    ])

    expect(responder.handlePacket({
      address: '/member/all/enabled',
      args: [{ type: 'T', value: true }],
    } as unknown as OscPacket)).toEqual([
      { kind: 'message', packet: { address: '/member/all/enabled', args: [{ type: 'T', value: true }] } },
      { kind: 'message', packet: { address: '/member/01/enabled', args: [{ type: 'i', value: 1 }] } },
      { kind: 'message', packet: { address: '/member/02/enabled', args: [{ type: 'i', value: 1 }] } },
    ])
    expect(responder.handlePacket({
      address: '/member/all/update',
      args: [{ type: 'i', value: 1 }],
    })).toHaveLength(1)

    const snapshot = responder.stagingSnapshot()
    expect(snapshot?.applyLog).toEqual([
      expect.objectContaining({
        triggerAddress: '/member/01/update',
        values: [
          { address: '/member/01/name', value: { kind: 's', value: 'Alicia' } },
          { address: '/member/01/enabled', value: { kind: 'i', value: 1 } },
        ],
      }),
      expect.objectContaining({
        triggerAddress: '/member/all/update',
        values: [
          { address: '/member/01/name', value: { kind: 's', value: 'Alicia' } },
          { address: '/member/01/enabled', value: { kind: 'i', value: 1 } },
          { address: '/member/02/name', value: { kind: 's', value: 'Bob' } },
          { address: '/member/02/enabled', value: { kind: 'i', value: 1 } },
        ],
      }),
    ])

    expect(responder.handlePacket({
      address: '/legacy/status',
      args: [{ type: 's', value: 'updated' }],
    })).toEqual([
      { kind: 'message', packet: { address: '/legacy/status', args: [{ type: 's', value: 'updated' }] } },
    ])
  })

  it('echoes non-/sys/* messages and expands bundles per message', () => {
    const responder = new MockUnityResponder(createClock())
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
    expect(responder.statsSnapshot()).toEqual({
      received: 2,
      parseErrors: 0,
      lastReceivedAt: '2026-07-23T00:00:01.000Z',
    })
  })

  it('records staged values in bundle order before applying the trigger', () => {
    const runtime = new ScenarioRuntime(
      loadScenarioDefinition(path.resolve(__dirname, '../scenarios/staging.json')),
    )
    const responder = new MockUnityResponder(createClock(), runtime)

    const replies = responder.handlePacket({
      timeTag: { seconds: 0, fractions: 1 },
      packets: [
        {
          address: '/member/01/name',
          args: [{ type: 's', value: 'Alicia' }],
        },
        {
          address: '/member/01/enabled',
          args: [{ type: 'i', value: 1 }],
        },
        {
          address: '/member/01/update',
          args: [{ type: 'i', value: 1 }],
        },
      ],
    })

    expect(replies).toHaveLength(3)
    expect(runtime.stagingSnapshot()?.applyLog).toEqual([
      {
        sequence: 1,
        triggerAddress: '/member/01/update',
        values: [
          { address: '/member/01/name', value: { kind: 's', value: 'Alicia' } },
          { address: '/member/01/enabled', value: { kind: 'i', value: 1 } },
        ],
      },
    ])
  })

  it('echoes expansion targets after the verbatim source echo', () => {
    const responder = new MockUnityResponder(
      createClock(),
      createScenarioRuntime({
        entries: [
          { address: '/source', label: 'Source', type: 'i', widget: 'fader', default: 0 },
          { address: '/target/a', label: 'A', type: 'i', widget: 'fader', default: 0 },
          { address: '/target/b', label: 'B', type: 'i', widget: 'fader', default: 0 },
        ],
        staging: {
          expansions: [{ source: '/source', targets: ['/target/*'] }],
        },
      }),
    )

    expect(responder.handlePacket({
      address: '/source',
      args: [{ type: 'i', value: 7 }],
    })).toEqual([
      { kind: 'message', packet: { address: '/source', args: [{ type: 'i', value: 7 }] } },
      { kind: 'message', packet: { address: '/target/a', args: [{ type: 'i', value: 7 }] } },
      { kind: 'message', packet: { address: '/target/b', args: [{ type: 'i', value: 7 }] } },
    ])
  })

  it('tracks parse errors independently from successful receipts', () => {
    const responder = new MockUnityResponder(createClock())

    responder.recordParseError()
    responder.recordParseError()
    responder.handlePacket({
      address: '/avatar/blob',
      args: [{ type: 'b', value: Uint8Array.from([1, 2, 3]) }],
    })

    expect(responder.statsSnapshot()).toEqual({
      received: 1,
      parseErrors: 2,
      lastReceivedAt: '2026-07-23T00:00:00.000Z',
    })
  })

  it('drops only /sys/pong replies in drop-pong mode', () => {
    const responder = new MockUnityResponder(createClock(), undefined, { kind: 'drop-pong' })

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
    expect(responder.statsSnapshot()).toEqual({
      received: 2,
      parseErrors: 0,
      lastReceivedAt: '2026-07-23T00:00:01.000Z',
    })
  })

  it('suppresses all replies in silent mode while keeping receipt counters', () => {
    const responder = new MockUnityResponder(createClock(), undefined, { kind: 'silent' })

    expect(
      responder.handlePacket({
        address: SYS.PING,
        args: [{ type: 'i', value: 2 }],
      }),
    ).toEqual([])
    expect(
      responder.handlePacket({
        address: SYS.STATS_REQUEST,
        args: [],
      }),
    ).toEqual([])
    expect(responder.statsSnapshot()).toEqual({
      received: 2,
      parseErrors: 0,
      lastReceivedAt: '2026-07-23T00:00:01.000Z',
    })
  })

  it('drops /sys/pong replies in a deterministic random-loss pattern', () => {
    const responder = new MockUnityResponder(createClock(), undefined, {
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
    const responder = new MockUnityResponder(createClock(), undefined, { kind: 'delay', ms: 150 })

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
    const responder = new MockUnityResponder(createClock(), undefined, { kind: 'corrupt' })

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
    expect(responder.statsSnapshot()).toEqual({
      received: 1,
      parseErrors: 0,
      lastReceivedAt: '2026-07-23T00:00:00.000Z',
    })
  })
})

function createClock() {
  let tick = 0

  return {
    now() {
      const date = new Date(`2026-07-23T00:00:0${tick}.000Z`)
      tick += 1
      return date
    },
  }
}

function createScenarioRuntime(overrides: {
  entries: Array<Record<string, unknown>>
  staging?: Record<string, unknown>
}) {
  return new ScenarioRuntime(
    ScenarioSchema.parse({
      projectId: 'oscdesk-demo',
      characterName: {
        candidates: ['初音ミク'],
      },
      ...overrides,
    }),
    { characterName: '初音ミク' },
  )
}

function getMessagePacket(reply: MockUnityReply | undefined) {
  expect(reply?.kind).toBe('message')
  return (reply as Extract<MockUnityReply, { kind: 'message' }>).packet
}

describe('MockUnityResponder runtime switching', () => {
  const BOOT_ID = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  const rowEntry = (name: string) => ({
    address: `/dev/row/${name}/value`,
    label: name,
    type: 'f',
    widget: 'fader',
    range: [0, 1],
    default: 0.1,
  })
  const trigger = { address: '/dev/switch', label: 'Switch', type: 'i', widget: 'button', default: 0 }

  function build(options: { legacyOrigin?: boolean; fault?: FaultMode; reject?: boolean } = {}) {
    const definition = ScenarioSchema.parse({
      projectId: 'proj',
      entries: [rowEntry('a'), rowEntry('b'), trigger],
      runtime: {
        variants: {
          removeB: { entries: [rowEntry('a'), trigger] },
          wrongProject: { entries: [rowEntry('a'), trigger], projectId: 'other' },
        },
        switches: [{ trigger: '/dev/switch', variant: options.reject ? 'wrongProject' : 'removeB' }],
      },
    })
    const logs: string[] = []
    const runtime = new ScenarioRuntime(definition, { bootId: BOOT_ID, legacyOrigin: options.legacyOrigin })
    const responder = new MockUnityResponder(createClock(), runtime, options.fault, (line) => logs.push(line))
    return { responder, logs }
  }

  const press = (value: number) => ({ address: '/dev/switch', args: [{ type: 'i' as const, value }] })
  const addressesOf = (replies: MockUnityReply[]) =>
    replies.map((reply) => (reply.kind === 'message' ? reply.packet.address : '(raw)'))
  const manifestOf = (replies: MockUnityReply[]) => {
    const reply = replies.find((item) => item.kind === 'message' && item.packet.address === SYS.MANIFEST)
    if (reply?.kind !== 'message') throw new Error('no manifest reply')
    return ManifestSchema.parse(JSON.parse(String(reply.packet.args[0]?.value)))
  }

  it('carries the pair in the manifest and stats responses', () => {
    const { responder } = build()

    const manifest = manifestOf(responder.handlePacket({ address: SYS.MANIFEST_REQUEST, args: [] }))
    const stats = responder.statsSnapshot()

    expect(manifest).toMatchObject({ bootId: BOOT_ID, structureGeneration: 1 })
    expect(stats).toMatchObject({ bootId: BOOT_ID, structureGeneration: 1 })
  })

  it('omits the pair in legacy origin mode', () => {
    const { responder } = build({ legacyOrigin: true })

    const manifest = manifestOf(responder.handlePacket({ address: SYS.MANIFEST_REQUEST, args: [] }))

    expect(manifest.bootId).toBeUndefined()
    expect(responder.statsSnapshot().bootId).toBeUndefined()
    expect(responder.statsSnapshot().structureGeneration).toBeUndefined()
  })

  it('echoes the trigger first and then appends the manifest with the advanced generation', () => {
    const { responder } = build()

    const replies = responder.handlePacket(press(1))

    expect(addressesOf(replies)).toEqual(['/dev/switch', SYS.MANIFEST])
    const manifest = manifestOf(replies)
    expect(manifest.structureGeneration).toBe(2)
    expect(manifest.entries.map((entry) => entry.address)).toEqual(['/dev/row/a/value', '/dev/switch'])
    expect(responder.statsSnapshot().structureGeneration).toBe(2)
  })

  it('does not switch for a zero value', () => {
    const { responder } = build()

    expect(addressesOf(responder.handlePacket(press(0)))).toEqual(['/dev/switch'])
  })

  it('sends nothing but the echo and logs one stderr line for a rejected switch', () => {
    const { responder, logs } = build({ reject: true })

    const replies = responder.handlePacket(press(1))

    expect(addressesOf(replies)).toEqual(['/dev/switch'])
    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain('project-mismatch')
    expect(logs[0]).not.toMatch(/\n./)
    expect(responder.statsSnapshot().structureGeneration).toBe(1)
  })

  it('drop-reinject-manifest drops only the switch manifest', () => {
    const { responder } = build({ fault: { kind: 'drop-reinject-manifest' } })

    const request = responder.handlePacket({ address: SYS.MANIFEST_REQUEST, args: [] })
    expect(addressesOf(request)).toEqual([SYS.MANIFEST])

    const switched = responder.handlePacket(press(1))
    expect(addressesOf(switched)).toEqual(['/dev/switch'])
    expect(responder.statsSnapshot().structureGeneration).toBe(2)

    const afterRequest = responder.handlePacket({ address: SYS.MANIFEST_REQUEST, args: [] })
    expect(manifestOf(afterRequest).structureGeneration).toBe(2)
    expect(addressesOf(responder.handlePacket({ address: SYS.PING, args: [{ type: 'i', value: 1 }] }))).toEqual([SYS.PONG])
  })
})

describe('parseFaultMode drop-reinject-manifest', () => {
  it('parses the new fault name', () => {
    expect(parseFaultMode('drop-reinject-manifest')).toEqual({ kind: 'drop-reinject-manifest' })
  })
})
