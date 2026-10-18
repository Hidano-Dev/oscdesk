import { z } from 'zod'

const nonNegativeInt = z.number().int().nonnegative()
const positiveInt = z.number().int().positive()
const iso8601Timestamp = z.string().datetime({ offset: true })
const oscAddress = z.string().startsWith('/')

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
// valuesDir は保持値の保存先(D-058)。省略時は `<dir>/.values`(定義と一緒に運べ、定義の一覧には混ざらない)。
// padsDir は OSC パッド(D-080)の保管先。省略時は `<dir>/pads`(定義と一緒に運べ、ディレクトリなので定義の一覧には混ざらない)。
export const SurfacesConfigSchema = z
  .object({
    dir: z.string().min(1).default('surfaces'),
    defaultName: z.string().min(1).optional(),
    valuesDir: z.string().min(1).optional(),
    padsDir: z.string().min(1).optional(),
  })
  .strict()
  .default({})

// 宛先タブ(D-078)。file は選択の保存先で、省略時は保持値の保存先(surfaces.valuesDir)の .destinations.json(先頭のドットでサーフェス名の <name>.json と重ならない)。
// 選択を保存していない間は unity(主系 + 副系)が宛先で、保存した選択はそれより優先する
export const DestinationsConfigSchema = z
  .object({
    file: z.string().min(1).optional(),
    scanTimeoutMs: z.number().int().min(1_000).max(60_000).default(8_000),
  })
  .strict()
  .default({})

// Unity の宛先名。WebSocket フレームの target 指定と NDJSON/警告ログのキーに使う。
export const UnityTargetNameSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/)

// 主系(host / sendPort)に副系を足せる冗長構成(D-046)。1 台構成の config はそのまま読める。
// 主系はエコー表示の唯一の出所で、副系へは操作と保持値の再送だけが向かう。
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
  diagnostics: SurfaceDiagnosticsConfigSchema,
  oscUi: OscUiConfigSchema,
  surfaces: SurfacesConfigSchema,
  destinations: DestinationsConfigSchema,
}).strict()

export type DiagnosticsNdjsonRecord = MessageRecord
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
export type DestinationsConfig = z.infer<typeof DestinationsConfigSchema>

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
