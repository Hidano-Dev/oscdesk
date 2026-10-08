import { z } from 'zod'

import { isValidAddressShape } from './address-pattern'

const nonNegativeInt = z.number().int().nonnegative()
const positiveInt = z.number().int().positive()
const iso8601Timestamp = z.string().datetime({ offset: true })
const oscAddress = z.string().startsWith('/')

const bootIdSchema = z.string().min(1).max(64)
const structureGenerationSchema = z.number().int().min(0).max(2147483647)

/** Unity 起動の識別子と構造の世代の組。比較は完全一致のみ。 */
export const ManifestOriginSchema = z.object({
  bootId: bootIdSchema,
  structureGeneration: structureGenerationSchema,
})

const originFields = {
  bootId: bootIdSchema.optional(),
  structureGeneration: structureGenerationSchema.optional(),
}

function requireOriginPair(
  value: { bootId?: string | undefined; structureGeneration?: number | undefined },
  context: z.RefinementCtx,
): void {
  if ((value.bootId === undefined) !== (value.structureGeneration === undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [value.bootId === undefined ? 'bootId' : 'structureGeneration'],
      message: 'bootId and structureGeneration must be provided together',
    })
  }
}

export const StatsPayloadSchema = z
  .object({
    received: nonNegativeInt,
    parseErrors: nonNegativeInt,
    lastReceivedAt: iso8601Timestamp,
    ...originFields,
  })
  .superRefine(requireOriginPair)

const ManifestEntryBaseSchema = z.object({
  address: oscAddress,
  label: z.string(),
  type: z.enum(['i', 'f', 's', 'b', 'bool']),
  widget: z.enum(['fader', 'button', 'toggle', 'xy', 'text', 'input', 'select']),
  range: z.tuple([z.number(), z.number()]).optional(),
  default: z.union([z.number(), z.string(), z.boolean()]).optional(),
  group: z.string().optional(),
  options: z.array(z.string()).optional(),
  optionsRef: z.string().optional(),
  pattern: z.string().optional(),
  staged: z.literal(true).optional(),
  appliesTo: z.array(z.string()).min(1).optional(),
})

export const ManifestEntrySchema = ManifestEntryBaseSchema.superRefine((entry, context) => {
  if (entry.widget === 'input' && !['s', 'i', 'f'].includes(entry.type)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['type'],
      message: 'input widget requires type s, i, or f',
    })
  }

  if (entry.widget === 'select' && entry.type !== 's') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['type'],
      message: 'select widget requires type s',
    })
  }

  if (entry.widget === 'select' && entry.options !== undefined && entry.optionsRef !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['optionsRef'],
      message: 'select widget cannot define both options and optionsRef',
    })
  }

  if (entry.widget === 'select' && entry.options === undefined && entry.optionsRef === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['options'],
      message: 'select widget requires options or optionsRef',
    })
  }

  if (entry.pattern !== undefined) {
    if (entry.type !== 's') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pattern'],
        message: 'pattern requires type s',
      })
    }

    try {
      new RegExp(entry.pattern)
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pattern'],
        message: 'pattern must be a valid regular expression',
      })
    }
  }

  if (entry.appliesTo !== undefined && entry.widget !== 'button') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['appliesTo'],
      message: 'appliesTo requires a button widget',
    })
  }

  entry.appliesTo?.forEach((pattern, index) => {
    if (!isValidAddressShape(pattern)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['appliesTo', index],
        message: 'appliesTo must be a valid OSC address pattern',
      })
    }
  })
})

const ManifestBaseSchema = z.object({
  version: z.literal(1),
  projectId: z.string().min(1),
  entries: z.array(ManifestEntrySchema),
  optionLists: z.record(z.string(), z.array(z.string())).optional(),
  ...originFields,
})

export const ManifestSchema = ManifestBaseSchema.superRefine((manifest, context) => {
  requireOriginPair(manifest, context)
  for (const [index, entry] of manifest.entries.entries()) {
    if (entry.optionsRef !== undefined && manifest.optionLists?.[entry.optionsRef] === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['entries', index, 'optionsRef'],
        message: `optionsRef "${entry.optionsRef}" was not found in optionLists`,
      })
    }
  }
})

export const SurfaceStatusSchema = z.object({
  lastRttMs: nonNegativeInt.nullable(),
  consecutiveLosses: nonNegativeInt,
  lastPongSeq: nonNegativeInt.nullable(),
})

export const RecordedArgSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('value'),
    type: z.string().min(1),
    value: z.union([z.number(), z.string(), z.boolean()]),
    truncated: z.literal(true).optional(),
  }),
  z.object({
    kind: z.literal('blob'),
    byteLength: nonNegativeInt,
  }),
])

export const MessageRecordSchema = z.object({
  ts: iso8601Timestamp,
  dir: z.enum(['in', 'out']),
  address: oscAddress,
  args: z.array(RecordedArgSchema).readonly(),
  peer: z
    .object({
      host: z.string().min(1),
      port: z.number().int().min(1).max(65535),
    })
    .optional(),
})

export const SubnetVerdictSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('sameHost'),
  }),
  z.object({
    kind: z.literal('sameSubnet'),
    matchedInterface: z.string().min(1),
  }),
  z.object({
    kind: z.literal('differentSubnet'),
    checkedInterfaces: positiveInt,
  }),
  z.object({
    kind: z.literal('indeterminate'),
    reason: z.enum(['hostname', 'ipv6Destination', 'noIpv4Interface']),
  }),
])

export const ReachabilitySchema = z.enum(['unknown', 'reachable', 'lost'])

export const DiagnosticsSnapshotSchema = z.object({
  reachability: ReachabilitySchema,
  lastRttMs: nonNegativeInt.nullable(),
  consecutiveLosses: nonNegativeInt,
  lossRate: z.object({
    windowSize: positiveInt,
    observed: nonNegativeInt,
    lost: nonNegativeInt,
    rate: z.number().min(0).max(1).nullable(),
  }),
  subnet: SubnetVerdictSchema,
  logUsage: z.object({
    totalBytes: nonNegativeInt,
    limitBytes: positiveInt,
    overLimit: z.boolean(),
  }),
  recentMessages: z.array(MessageRecordSchema).readonly(),
})

export const SurfaceDiagnosticsConfigSchema = z
  .object({
    ringBufferSize: z.number().int().min(1).max(10_000).default(200),
    lossRateWindow: z.number().int().min(1).max(1_000).default(30),
    ndjsonDir: z.string().min(1).default('logs/diagnostics'),
    ndjsonMaxTotalBytes: positiveInt.default(52_428_800),
  })
  .default({})

export const OscUiPeerSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
})

// OSC ネイティブ UI (TouchOSC / OSC/PILOT 等) を UI として使うためのルーティング設定。
// 既定は無効で、無効時のふるまいは従来(ブラウザ + WebSocket)と完全に同一。
export const OscUiConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    // 名乗り(/oscdesk/hello)を待たずに固定で配信する宛先。
    staticPeers: z.array(OscUiPeerSchema).default([]),
    // 名乗りで登録したピアの有効期限。0 は無期限。
    peerTtlMs: z.number().int().nonnegative().default(0),
  })
  .default({})

const PortSchema = z.number().int().min(1).max(65535)

// サーフェス定義(D-043)の保管先。defaultName があれば起動時に読み込んで採用する。
export const SurfacesConfigSchema = z
  .object({
    dir: z.string().min(1).default('surfaces'),
    defaultName: z.string().min(1).optional(),
  })
  .strict()
  .default({})

// Unity の宛先名。WebSocket フレームの target 指定と NDJSON/警告ログのキーに使う。
export const UnityTargetNameSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/)

// 主系(host / sendPort)に副系を足せる冗長構成(D-046)。1 台構成の config はそのまま読める。
// 主系はマニフェスト・エコー表示の唯一の出所で、副系へは操作と保持値の再送だけが向かう。
export const UnityConfigSchema = z.object({
  name: UnityTargetNameSchema.default('unity'),
  host: z.string().min(1),
  sendPort: PortSchema,
  secondary: z.array(z.object({
    name: UnityTargetNameSchema,
    host: z.string().min(1),
    sendPort: PortSchema,
  }).strict()).default([]),
}).strict().superRefine((unity, ctx) => {
  const seen = new Set<string>([unity.name])
  unity.secondary.forEach((target, index) => {
    if (seen.has(target.name)) {
      ctx.addIssue({ code: 'custom', path: ['secondary', index, 'name'], message: `duplicate unity target name "${target.name}"` })
    }
    seen.add(target.name)
  })
})

export const BridgeConfigSchema = z.object({
  unity: UnityConfigSchema,
  bridge: z.object({
    oscListenHost: z.string().min(1).default('0.0.0.0'),
    oscListenPort: PortSchema.default(7091),
    wsHost: z.string().min(1).default('0.0.0.0'),
    wsPort: PortSchema.default(7080),
  }).strict().default({}),
  ui: z.object({
    host: z.string().min(1).default('0.0.0.0'),
    port: PortSchema.default(8080),
  }).strict().default({}),
  debug: z.boolean(),
  boolFallbackToInt: z.boolean(),
  expectedProjectId: z.string().min(1).optional(),
  diagnostics: SurfaceDiagnosticsConfigSchema,
  oscUi: OscUiConfigSchema,
  surfaces: SurfacesConfigSchema,
}).strict()

export const GuardEventRecordSchema = z.object({
  ts: iso8601Timestamp,
  kind: z.literal('guard-reject'),
  expectedProjectId: z.string().min(1),
  receivedProjectId: z.string().min(1),
  peer: z
    .object({
      host: z.string().min(1),
      port: z.number().int().min(1).max(65535),
    })
    .optional(),
})

export const SelfHealEventRecordSchema = z.object({
  ts: iso8601Timestamp,
  kind: z.literal('self-heal'),
  healKind: z.enum(['container-injected', 'id-collision']),
  detail: z.string().min(1),
})

export type ManifestOrigin = z.infer<typeof ManifestOriginSchema>
export type StatsPayload = z.infer<typeof StatsPayloadSchema>
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>
export type Manifest = z.infer<typeof ManifestSchema>
export type GuardEventRecord = z.infer<typeof GuardEventRecordSchema>
export type SelfHealEventRecord = z.infer<typeof SelfHealEventRecordSchema>
export type DiagnosticsNdjsonRecord = MessageRecord | GuardEventRecord | SelfHealEventRecord
export type SurfaceStatus = z.infer<typeof SurfaceStatusSchema>
export type RecordedArg = z.infer<typeof RecordedArgSchema>
export type MessageRecord = z.infer<typeof MessageRecordSchema>
export type SubnetVerdict = z.infer<typeof SubnetVerdictSchema>
export type Reachability = z.infer<typeof ReachabilitySchema>
export type DiagnosticsSnapshot = z.infer<typeof DiagnosticsSnapshotSchema>
export type SurfaceDiagnosticsConfig = z.infer<typeof SurfaceDiagnosticsConfigSchema>
export type OscUiPeer = z.infer<typeof OscUiPeerSchema>
export type OscUiConfig = z.infer<typeof OscUiConfigSchema>
export type BridgeConfig = z.infer<typeof BridgeConfigSchema>
export type UnityConfig = z.infer<typeof UnityConfigSchema>

export interface UnityTarget {
  readonly name: string
  readonly host: string
  readonly sendPort: number
  readonly primary: boolean
}

/** 主系を先頭に、副系を config の順に並べた宛先一覧。 */
export function resolveUnityTargets(unity: Pick<UnityConfig, 'name' | 'host' | 'sendPort' | 'secondary'>): readonly UnityTarget[] {
  return [
    { name: unity.name, host: unity.host, sendPort: unity.sendPort, primary: true },
    ...unity.secondary.map(target => ({ ...target, primary: false })),
  ]
}
