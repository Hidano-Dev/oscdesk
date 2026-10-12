import { describe, expect, it } from 'vitest'

import {
  DiagnosticsSnapshotSchema,
  MessageRecordSchema,
  ReachabilitySchema,
  resolveUnityTargets,
  RecordedArgSchema,
  SubnetVerdictSchema,
  SurfaceDiagnosticsConfigSchema,
  BridgeConfigSchema,
  SurfaceStatusSchema,
} from './schemas'

describe('SurfaceStatusSchema', () => {
  it('accepts valid status payloads', () => {
    const result = SurfaceStatusSchema.parse({
      lastRttMs: 42,
      consecutiveLosses: 0,
      lastPongSeq: 7,
    })

    expect(result.lastPongSeq).toBe(7)
  })

  it('accepts null optional fields', () => {
    const result = SurfaceStatusSchema.parse({
      lastRttMs: null,
      consecutiveLosses: 3,
      lastPongSeq: null,
    })

    expect(result).toEqual({
      lastRttMs: null,
      consecutiveLosses: 3,
      lastPongSeq: null,
    })
  })

  it.each([
    [
      'negative counters',
      {
        lastRttMs: -1,
        consecutiveLosses: -1,
        lastPongSeq: null,
      },
      ['lastRttMs', 'consecutiveLosses'],
    ],
    [
      'non-integer numeric values',
      {
        lastRttMs: 10.5,
        consecutiveLosses: 1.2,
        lastPongSeq: 7.1,
      },
      ['lastRttMs', 'consecutiveLosses', 'lastPongSeq'],
    ],
    [
      'missing required fields',
      {
        lastRttMs: null,
      },
      ['consecutiveLosses', 'lastPongSeq'],
    ],
  ])('rejects %s', (_, payload, expectedPaths) => {
    const result = SurfaceStatusSchema.safeParse(payload)

    expect(result.success).toBe(false)
    if (result.success) {
      throw new Error('expected schema validation to fail')
    }

    expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual(expectedPaths)
  })
})

describe('BridgeConfigSchema', () => {
  it('accepts valid runtime config', () => {
    const result = BridgeConfigSchema.parse({
      unity: {
        host: '127.0.0.1',
        sendPort: 9000,
      },
      debug: false,
      boolFallbackToInt: true,
      diagnostics: {
        ringBufferSize: 300,
        lossRateWindow: 50,
        ndjsonDir: 'tmp/diag',
        ndjsonMaxTotalBytes: 1024,
      },
    })

    expect(result.unity.sendPort).toBe(9000)
  })

  it('accepts secondary Unity targets and rejects duplicate names', () => {
    const base = { debug: false, boolFallbackToInt: false }
    const ok = BridgeConfigSchema.parse({
      ...base,
      unity: { host: 'a', sendPort: 7090, secondary: [{ name: 'backup', host: 'b', sendPort: 7092 }] },
    })
    expect(resolveUnityTargets(ok.unity).map(target => [target.name, target.primary])).toEqual([['unity', true], ['backup', false]])
    for (const secondary of [
      [{ name: 'unity', host: 'b', sendPort: 7092 }],
      [{ name: 'x', host: 'b', sendPort: 7092 }, { name: 'x', host: 'c', sendPort: 7093 }],
      [{ name: 'bad name', host: 'b', sendPort: 7092 }],
    ]) {
      expect(BridgeConfigSchema.safeParse({ ...base, unity: { host: 'a', sendPort: 7090, secondary } }).success).toBe(false)
    }
  })

  it('accepts boundary port values', () => {
    const result = BridgeConfigSchema.parse({
      unity: {
        host: 'localhost',
        sendPort: 1,
      },
      debug: true,
      boolFallbackToInt: false,
    })

    expect(result.unity).toEqual({ name: 'unity', host: 'localhost', sendPort: 1, secondary: [] })
    expect(result.bridge).toEqual({ oscListenHost: '0.0.0.0', oscListenPort: 7091, wsHost: '0.0.0.0', wsPort: 7080 })
    expect(result.ui).toEqual({ host: '0.0.0.0', port: 8080 })
    expect(result.diagnostics).toEqual({
      ringBufferSize: 200,
      lossRateWindow: 30,
      ndjsonDir: 'logs/diagnostics',
      ndjsonMaxTotalBytes: 52_428_800,
    })
  })

  it.each([
    [
      'nested field path errors',
      {
        unity: {
          host: '',
          sendPort: 0,
        },
        debug: 'false',
        boolFallbackToInt: false,
      },
      ['unity.host', 'unity.sendPort', 'debug'],
    ],
    [
      'ports outside the valid range',
      {
        unity: {
          host: '127.0.0.1',
          sendPort: 65536,
        },
        debug: false,
        boolFallbackToInt: true,
      },
      ['unity.sendPort'],
    ],
    [
      'non-integer ports and wrong boolean types',
      {
        unity: {
          host: '127.0.0.1',
          sendPort: 9000.5,
        },
        debug: 1,
        boolFallbackToInt: 'true',
      },
      ['unity.sendPort', 'debug', 'boolFallbackToInt'],
    ],
    [
      'invalid diagnostics settings',
      {
        unity: {
          host: '127.0.0.1',
          sendPort: 9000,
        },
        debug: false,
        boolFallbackToInt: true,
        diagnostics: {
          ringBufferSize: 0,
          lossRateWindow: 1001,
          ndjsonDir: '',
          ndjsonMaxTotalBytes: 0,
        },
      },
      [
        'diagnostics.ringBufferSize',
        'diagnostics.lossRateWindow',
        'diagnostics.ndjsonDir',
        'diagnostics.ndjsonMaxTotalBytes',
      ],
    ],
  ])('rejects %s', (_, payload, expectedPaths) => {
    const result = BridgeConfigSchema.safeParse(payload)

    expect(result.success).toBe(false)
    if (result.success) {
      throw new Error('expected schema validation to fail')
    }

    expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual(expectedPaths)
  })
})

describe('retired mis-connection guard setting', () => {
  it('rejects expectedProjectId, so a stale config fails loudly instead of being ignored', () => {
    const result = BridgeConfigSchema.safeParse({
      unity: { host: 'localhost', sendPort: 9000 },
      debug: false,
      boolFallbackToInt: true,
      expectedProjectId: 'oscdesk-demo',
    })

    expect(result.success).toBe(false)
  })
})

describe('RecordedArgSchema', () => {
  it('accepts scalar and blob argument records', () => {
    expect(
      RecordedArgSchema.parse({
        kind: 'value',
        type: 's',
        value: 'hello',
        truncated: true,
      }),
    ).toEqual({
      kind: 'value',
      type: 's',
      value: 'hello',
      truncated: true,
    })

    expect(
      RecordedArgSchema.parse({
        kind: 'blob',
        byteLength: 128,
      }),
    ).toEqual({
      kind: 'blob',
      byteLength: 128,
    })
  })

  it('rejects invalid discriminated union members', () => {
    const result = RecordedArgSchema.safeParse({
      kind: 'blob',
      value: 'unexpected',
    })

    expect(result.success).toBe(false)
    if (result.success) {
      throw new Error('expected schema validation to fail')
    }

    expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual(['byteLength'])
  })
})

describe('MessageRecordSchema', () => {
  it('accepts message records with optional peer metadata', () => {
    const result = MessageRecordSchema.parse({
      ts: '2026-07-24T12:34:56.000Z',
      dir: 'out',
      address: '/avatar/parameter',
      args: [
        {
          kind: 'value',
          type: 'f',
          value: 0.5,
        },
      ],
      peer: {
        host: '127.0.0.1',
        port: 9000,
      },
    })

    expect(result.peer?.port).toBe(9000)
  })

  it('rejects invalid message records', () => {
    const result = MessageRecordSchema.safeParse({
      ts: 'not-a-date',
      dir: 'sideways',
      address: 'avatar/parameter',
      args: [],
      peer: {
        host: '',
        port: 0,
      },
    })

    expect(result.success).toBe(false)
    if (result.success) {
      throw new Error('expected schema validation to fail')
    }

    expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual([
      'ts',
      'dir',
      'address',
      'peer.host',
      'peer.port',
    ])
  })
})

describe('SubnetVerdictSchema', () => {
  it('accepts all supported subnet verdict variants', () => {
    expect(SubnetVerdictSchema.parse({ kind: 'sameHost' })).toEqual({ kind: 'sameHost' })
    expect(
      SubnetVerdictSchema.parse({
        kind: 'sameSubnet',
        matchedInterface: 'Ethernet 1',
      }),
    ).toEqual({
      kind: 'sameSubnet',
      matchedInterface: 'Ethernet 1',
    })
    expect(
      SubnetVerdictSchema.parse({
        kind: 'differentSubnet',
        checkedInterfaces: 2,
      }),
    ).toEqual({
      kind: 'differentSubnet',
      checkedInterfaces: 2,
    })
    expect(
      SubnetVerdictSchema.parse({
        kind: 'indeterminate',
        reason: 'hostname',
      }),
    ).toEqual({
      kind: 'indeterminate',
      reason: 'hostname',
    })
  })

  it('rejects unsupported subnet verdict payloads', () => {
    const result = SubnetVerdictSchema.safeParse({
      kind: 'differentSubnet',
      checkedInterfaces: 0,
    })

    expect(result.success).toBe(false)
    if (result.success) {
      throw new Error('expected schema validation to fail')
    }

    expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual([
      'checkedInterfaces',
    ])
  })
})

describe('ReachabilitySchema', () => {
  it('accepts supported reachability values', () => {
    expect(ReachabilitySchema.parse('unknown')).toBe('unknown')
    expect(ReachabilitySchema.parse('reachable')).toBe('reachable')
    expect(ReachabilitySchema.parse('lost')).toBe('lost')
  })

  it('rejects unsupported reachability values', () => {
    const result = ReachabilitySchema.safeParse('pending')

    expect(result.success).toBe(false)
  })
})

describe('DiagnosticsSnapshotSchema', () => {
  it('accepts a valid diagnostics snapshot', () => {
    const result = DiagnosticsSnapshotSchema.parse({
      reachability: 'reachable',
      lastRttMs: 42,
      consecutiveLosses: 0,
      lossRate: {
        windowSize: 30,
        observed: 10,
        lost: 1,
        rate: 0.1,
      },
      subnet: {
        kind: 'sameSubnet',
        matchedInterface: 'Ethernet 1',
      },
      logUsage: {
        totalBytes: 1024,
        limitBytes: 2048,
        overLimit: false,
      },
      recentMessages: [
        {
          ts: '2026-07-24T12:34:56.000Z',
          dir: 'in',
          address: '/sys/pong',
          args: [],
        },
      ],
    })

    expect(result.lossRate.rate).toBe(0.1)
  })

  it('rejects invalid diagnostics snapshots', () => {
    const result = DiagnosticsSnapshotSchema.safeParse({
      reachability: 'pending',
      lastRttMs: -1,
      consecutiveLosses: -1,
      lossRate: {
        windowSize: 0,
        observed: -1,
        lost: -1,
        rate: 1.5,
      },
      subnet: {
        kind: 'indeterminate',
        reason: 'dns',
      },
      logUsage: {
        totalBytes: -1,
        limitBytes: 0,
        overLimit: 'no',
      },
      recentMessages: [
        {
          ts: 'bad-date',
          dir: 'in',
          address: 'sys/pong',
          args: [],
        },
      ],
    })

    expect(result.success).toBe(false)
    if (result.success) {
      throw new Error('expected schema validation to fail')
    }

    expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual([
      'reachability',
      'lastRttMs',
      'consecutiveLosses',
      'lossRate.windowSize',
      'lossRate.observed',
      'lossRate.lost',
      'lossRate.rate',
      'subnet.reason',
      'logUsage.totalBytes',
      'logUsage.limitBytes',
      'logUsage.overLimit',
      'recentMessages.0.ts',
      'recentMessages.0.address',
    ])
  })
})

describe('SurfaceDiagnosticsConfigSchema', () => {
  it('applies defaults when the diagnostics block is omitted', () => {
    expect(SurfaceDiagnosticsConfigSchema.parse(undefined)).toEqual({
      ringBufferSize: 200,
      lossRateWindow: 30,
      ndjsonDir: 'logs/diagnostics',
      ndjsonMaxTotalBytes: 52_428_800,
    })
  })

  it('applies field defaults when the diagnostics block is partial', () => {
    expect(
      SurfaceDiagnosticsConfigSchema.parse({
        ringBufferSize: 500,
      }),
    ).toEqual({
      ringBufferSize: 500,
      lossRateWindow: 30,
      ndjsonDir: 'logs/diagnostics',
      ndjsonMaxTotalBytes: 52_428_800,
    })
  })
})
