import { z } from 'zod'

import { ManifestSchema } from './schemas'
import { OSC_BATCH } from './limits'
import { SurfaceDefinitionSchema } from './surface-definition'

export const WIRE_PROTOCOL_VERSION = 1 as const

const strictObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict()

// i は OSC int32 の値域に制限する(逸脱を通すとエンコーダ側で黙って切り捨て・ラップされる)。
const Int32Schema = z.number().int().min(-2_147_483_648).max(2_147_483_647)
// b は正規形の base64 のみ受理する。Buffer.from(value, 'base64') は不正文字を黙って
// 読み飛ばすため、境界で拒否しないと Unity へ別のバイト列が届く。Python 側デコーダの
// validate=True と対称。
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const Base64Schema = z.string().regex(BASE64_PATTERN)

export const WireArgSchema = z.discriminatedUnion('type', [
  strictObject({ type: z.literal('i'), value: Int32Schema }),
  strictObject({ type: z.literal('f'), value: z.number() }),
  strictObject({ type: z.literal('s'), value: z.string() }),
  strictObject({ type: z.literal('b'), value: Base64Schema }),
])

const VersionSchema = z.literal(WIRE_PROTOCOL_VERSION)
const PeerSchema = strictObject({
  host: z.string(),
  port: z.number().int().min(1).max(65535),
})
const OscFrameFields = {
  v: VersionSchema,
  type: z.literal('osc'),
  address: z.string().startsWith('/'),
  args: z.array(WireArgSchema),
}

export const LinkUnityStatusSchema = strictObject({
  reachability: z.enum(['unknown', 'reachable', 'lost']),
  lastRttMs: z.number().nonnegative().nullable(),
  consecutiveLosses: z.number().int().nonnegative(),
  lastPongSeq: z.number().int().nonnegative().nullable(),
})

export const LinkManifestStatusSchema = z.discriminatedUnion('state', [
  strictObject({ state: z.literal('none') }),
  strictObject({
    state: z.literal('accepted'),
    projectId: z.string(),
    entryCount: z.number().int().nonnegative(),
  }),
])

export const LinkRejectionSchema = strictObject({
  ts: z.string().datetime({ offset: true }),
  reason: z.enum(['project-mismatch', 'schema-error', 'json-parse-error']),
  detail: z.string(),
  receivedProjectId: z.string().nullable(),
})

const HelloFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('hello'),
  clientId: z.string(),
  protocolVersion: z.number().int(),
  server: strictObject({ name: z.string(), version: z.string() }),
  unity: strictObject({ host: z.string(), sendPort: z.number().int().min(1).max(65535) }),
  bridge: strictObject({
    oscListenPort: z.number().int().min(1).max(65535),
    wsPort: z.number().int().min(1).max(65535),
  }),
  expectedProjectId: z.string().nullable(),
  heartbeat: strictObject({ intervalMs: z.number().positive(), timeoutMs: z.number().positive() }),
  pingIntervalMs: z.number().positive(),
  debug: z.boolean(),
})

export const ManifestAdoptionSchema = strictObject({
  seq: z.number().int().positive(),
  at: z.string().datetime({ offset: true }),
})

const ManifestFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('manifest'),
  manifest: ManifestSchema,
  adoption: ManifestAdoptionSchema,
})

// 定義ファイル名(拡張子なし)。ブリッジはこれをそのままファイル名に使うため、パス区切り・
// 先頭ドット(隠しフォルダの .backups を含む)・Windows の予約デバイス名を境界で拒否する。
// これを緩めると UI からの保存要求で保管フォルダの外へ書ける。
export const SURFACE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
export function isValidSurfaceName(name: string): boolean {
  return SURFACE_NAME_PATTERN.test(name) && !WINDOWS_RESERVED_NAME.test(name)
}
export const SurfaceNameSchema = z.string().refine(isValidSurfaceName, { message: 'invalid surface name' })

const SurfaceFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('surface'),
  name: SurfaceNameSchema,
  // 採用のたびに 1 ずつ増える(ブリッジの再起動で 1 に戻る)。同じ定義の再採用も増える。
  revision: z.number().int().positive(),
  at: z.string().datetime({ offset: true }),
  definition: SurfaceDefinitionSchema,
})

const SurfaceListFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('surfaceList'),
  names: z.array(SurfaceNameSchema),
  active: SurfaceNameSchema.nullable(),
})

const DownstreamOscFrameSchema = strictObject({
  ...OscFrameFields,
  from: PeerSchema,
})

const LinkFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('link'),
  unity: LinkUnityStatusSchema,
  manifest: LinkManifestStatusSchema,
  lastRejection: LinkRejectionSchema.nullable(),
})

const HeartbeatFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('heartbeat'),
  t: z.number(),
})

const NoticeFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('notice'),
  level: z.enum(['info', 'warn', 'error']),
  code: z.string(),
  detail: z.string(),
})

export const DownstreamFrameSchema = z.discriminatedUnion('type', [
  HelloFrameSchema,
  ManifestFrameSchema,
  DownstreamOscFrameSchema,
  LinkFrameSchema,
  HeartbeatFrameSchema,
  NoticeFrameSchema,
  SurfaceFrameSchema,
  SurfaceListFrameSchema,
])

const UpstreamOscFrameSchema = strictObject(OscFrameFields)
const OscBatchMessageSchema = strictObject({
  address: z.string().startsWith('/'),
  args: z.array(WireArgSchema),
})
const UpstreamOscBatchFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('oscBatch'),
  messages: z.array(OscBatchMessageSchema).min(1).max(OSC_BATCH.MAX_MESSAGES),
})
const ManifestRequestFrameSchema = strictObject({ v: VersionSchema, type: z.literal('manifestRequest') })
const HeartbeatAckFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('heartbeatAck'),
  t: z.number(),
})

const SurfaceRequestFrameSchema = strictObject({ v: VersionSchema, type: z.literal('surfaceRequest') })
const SurfaceLoadFrameSchema = strictObject({ v: VersionSchema, type: z.literal('surfaceLoad'), name: SurfaceNameSchema })
// definition の中身はここでは検証しない。フレームごと捨てると UI に理由が届かないため、
// ブリッジが SurfaceDefinitionSchema で検証し、不採用の理由を notice で返す。
const SurfaceSaveFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('surfaceSave'),
  name: SurfaceNameSchema,
  definition: z.record(z.string(), z.unknown()),
  activate: z.boolean().optional(),
})

export const UpstreamFrameSchema = z.discriminatedUnion('type', [
  UpstreamOscFrameSchema,
  UpstreamOscBatchFrameSchema,
  ManifestRequestFrameSchema,
  HeartbeatAckFrameSchema,
  SurfaceRequestFrameSchema,
  SurfaceLoadFrameSchema,
  SurfaceSaveFrameSchema,
])

export type WireArg = z.infer<typeof WireArgSchema>
export type DownstreamFrame = z.infer<typeof DownstreamFrameSchema>
export type UpstreamFrame = z.infer<typeof UpstreamFrameSchema>
export type LinkUnityStatus = z.infer<typeof LinkUnityStatusSchema>
export type LinkManifestStatus = z.infer<typeof LinkManifestStatusSchema>
export type LinkRejection = z.infer<typeof LinkRejectionSchema>
export type ManifestAdoption = z.infer<typeof ManifestAdoptionSchema>

export type FrameRejectReason = 'invalid-json' | 'schema-error' | 'binary-frame'
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }

export function parseUpstreamFrame(raw: string): Result<UpstreamFrame, FrameRejectReason> {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'invalid-json' }
  }

  const result = UpstreamFrameSchema.safeParse(value)
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, error: 'schema-error' }
}
