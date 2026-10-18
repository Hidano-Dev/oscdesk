import { z } from 'zod'

import { DESTINATIONS, OSC_BATCH, SENT_LOG } from './limits'
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

export const LinkTargetStatusSchema = strictObject({
  name: z.string(),
  primary: z.boolean(),
  ...LinkUnityStatusSchema.shape,
})

const HelloFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('hello'),
  clientId: z.string(),
  protocolVersion: z.number().int(),
  server: strictObject({ name: z.string(), version: z.string() }),
  unity: strictObject({ host: z.string(), sendPort: z.number().int().min(1).max(65535) }),
  // 冗長構成の宛先一覧(主系が先頭。D-046)。unity は主系と同じ値で、旧い UI のために残す
  targets: z.array(strictObject({
    name: z.string(),
    host: z.string(),
    sendPort: z.number().int().min(1).max(65535),
    primary: z.boolean(),
  })).min(1),
  bridge: strictObject({
    oscListenPort: z.number().int().min(1).max(65535),
    wsPort: z.number().int().min(1).max(65535),
  }),
  heartbeat: strictObject({ intervalMs: z.number().positive(), timeoutMs: z.number().positive() }),
  pingIntervalMs: z.number().positive(),
  debug: z.boolean(),
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

// 保持値(D-045)。full が true なら全量(UI は丸ごと置き換える)、false なら変更分のみ。
const DesiredFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('desired'),
  full: z.boolean(),
  values: z.array(strictObject({ address: z.string().startsWith('/'), args: z.array(WireArgSchema) })),
})

// Unity が実行時に持つ文字列の一覧(D-053)。毎回全量を送る(UI は丸ごと置き換える)。
// lists は定義が参照する一覧のアドレスごとに、一覧を返した宛先だけを config の順に並べる。
// choices は optionsFrom を持つパラメータごとの選択肢で、静的な options → 主系 → 副系にしか無い名前の順。
// 宛先ごとの一覧も配るのは、「一部の台にしか無い名前」の印を UI に足すときにプロトコルを変えないため
const RuntimeOptionsFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('runtimeOptions'),
  lists: z.array(strictObject({
    address: z.string().startsWith('/'),
    targets: z.array(strictObject({ name: z.string(), options: z.array(z.string()) })),
  })),
  choices: z.array(strictObject({ param: z.string(), options: z.array(z.string()) })),
  // レコード(D-061)。keys は keysFrom を持つレコードごとのキーの一覧(主系の順 → 副系にしか無い名前を config の宛先順、
  // 重複と空文字を除く)。fieldChoices は optionsFrom を持つレコードのフィールドごとの選択肢(choices と同じ順序規則)。
  // ブリッジは常に送るが、旧いブリッジとの互換のため省略可にし、UI は無ければ空として扱う
  keys: z.array(strictObject({ record: z.string(), keys: z.array(z.string()) })).optional(),
  fieldChoices: z.array(strictObject({ record: z.string(), field: z.string(), options: z.array(z.string()) })).optional(),
})

// 送信ログ(D-067)。ブリッジが Unity へ送った OSC の記録で、UI は表示するだけ(値の正にはしない)。
// origin は送った契機。ui = UI の osc、action = UI の oscBatch(まとめ送り)、resend = 保持値の再送、
// row = キーの一覧に現れた新しい行、request = 一覧の要求、relay = OSC ネイティブ UI の中継
export const SENT_LOG_ORIGINS = ['ui', 'action', 'resend', 'row', 'request', 'relay'] as const
export const SentLogRecordSchema = strictObject({
  // ブリッジの起動ごとに 1 から振る。間引き(count)で更新した記録は同じ seq のまま届き直す
  seq: z.number().int().positive(),
  at: z.string().datetime({ offset: true }),
  origin: z.enum(SENT_LOG_ORIGINS),
  targets: z.array(z.string()).min(1),
  address: z.string().startsWith('/'),
  args: z.array(WireArgSchema).max(SENT_LOG.MAX_ARGS),
  // 同じアドレスへの連続送信をまとめた件数(1 なら単発)。at と args は最後の送信のもの
  count: z.number().int().positive(),
  // まとめ送りの 1 件なら、そのバッチの番号と中での位置
  batch: strictObject({
    id: z.number().int().positive(),
    index: z.number().int().nonnegative(),
    size: z.number().int().positive(),
  }).nullable(),
  // 引数を表示用に切り詰めたか(長い文字列・blob・多すぎる引数)
  clipped: z.boolean(),
})

const SentLogFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('sentLog'),
  // true なら UI は手元の記録を捨ててこれで置き換える(接続直後の既存分の先頭)。false は seq で追加・更新
  full: z.boolean(),
  records: z.array(SentLogRecordSchema).max(SENT_LOG.MAX_RECORDS_PER_FRAME),
})

// 宛先タブ(D-078 / D-079)。毎回全量を送る(UI は丸ごと置き換える)。
// devices は走査で見つかった端末に、この PC・設定の宛先・選択中の宛先を足したもの(found は直近の走査で見つかったか)。
// broadcasts は「全てのデバイス」で送るブロードキャストアドレス(インタフェースごと)。空なら「全てのデバイス」は選べない。
// selection.source は config(選択を保存していない。設定ファイルの宛先)/ saved(保存した選択)/
// unsaved(選択は効いているがファイルへ書けなかった。ブリッジを再起動すると失われる)。
// targets は実際に送っている宛先(hello.targets と同じ形 + broadcast)。primaryHosts はブリッジが主系の Unity とみなす送信元ホスト
// (主系の host・名前解決したアドレス・この PC ならループバック・ブロードキャストへ pong を返したホスト)で、
// UI がエコーの出所を Unity と判定するのに使う(主系がブロードキャストやこの PC のとき、host とエコーの送信元が一致しないため)
const DestinationsFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('destinations'),
  sendPort: z.number().int().min(1).max(65535),
  scanning: z.boolean(),
  scannedAt: z.string().datetime({ offset: true }).nullable(),
  devices: z.array(strictObject({
    host: z.string().min(1),
    mac: z.string().nullable(),
    interface: z.string().nullable(),
    self: z.boolean(),
    configured: z.boolean(),
    found: z.boolean(),
  })),
  broadcasts: z.array(strictObject({ address: z.string().min(1), interface: z.string(), network: z.string() })),
  selection: strictObject({
    source: z.enum(['config', 'saved', 'unsaved']),
    allDevices: z.boolean(),
    hosts: z.array(z.string().min(1)),
  }),
  targets: z.array(strictObject({
    name: z.string(),
    host: z.string(),
    sendPort: z.number().int().min(1).max(65535),
    primary: z.boolean(),
    broadcast: z.boolean(),
  })).min(1),
  primaryHosts: z.array(z.string()),
})

const DownstreamOscFrameSchema = strictObject({
  ...OscFrameFields,
  from: PeerSchema,
})

const LinkFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('link'),
  unity: LinkUnityStatusSchema,
  targets: z.array(LinkTargetStatusSchema).min(1),
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
  DownstreamOscFrameSchema,
  LinkFrameSchema,
  HeartbeatFrameSchema,
  NoticeFrameSchema,
  SurfaceFrameSchema,
  SurfaceListFrameSchema,
  DesiredFrameSchema,
  RuntimeOptionsFrameSchema,
  SentLogFrameSchema,
  DestinationsFrameSchema,
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
const HeartbeatAckFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('heartbeatAck'),
  t: z.number(),
})

// 保持値(D-045)を宛先へ全部送り直す。target を省くと全宛先。
const ResendFrameSchema = strictObject({ v: VersionSchema, type: z.literal('resend'), target: z.string().optional() })

// 全宛先へ一覧の要求(optionsFrom.request)を送らせる(UI の「一覧を更新」。D-053)
const RuntimeOptionsRefreshFrameSchema = strictObject({ v: VersionSchema, type: z.literal('runtimeOptionsRefresh') })

// 通常の画面からのレコードの行の追加・削除(D-075)。record はレコード id。同じ keysFrom.address を共有する
// 全レコードの行がまとめて増減する。キーは空にできない(空のキーは行として扱わない。D-062)
const RecordKeyAddFrameSchema = strictObject({
  v: VersionSchema, type: z.literal('recordKeyAdd'), record: z.string().min(1), key: z.string().min(1),
})
const RecordKeyRemoveFrameSchema = strictObject({
  v: VersionSchema, type: z.literal('recordKeyRemove'), record: z.string().min(1), key: z.string().min(1),
})

// 宛先タブ(D-078)。destinationsScan は LAN の走査(走査中なら走査中のものに合流する)、
// destinationsSelect は宛先の選択(allDevices が true の間は hosts を使わないが、外したときに戻すため持っておく)、
// destinationsReset は保存した選択を消して設定ファイルの宛先へ戻す。応答はどれも destinations の全量
const DestinationsScanFrameSchema = strictObject({ v: VersionSchema, type: z.literal('destinationsScan') })
const DestinationsSelectFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('destinationsSelect'),
  allDevices: z.boolean(),
  hosts: z.array(z.string().min(1).max(253)).max(DESTINATIONS.MAX_SELECTED_HOSTS),
})
const DestinationsResetFrameSchema = strictObject({ v: VersionSchema, type: z.literal('destinationsReset') })

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
  HeartbeatAckFrameSchema,
  SurfaceRequestFrameSchema,
  SurfaceLoadFrameSchema,
  SurfaceSaveFrameSchema,
  ResendFrameSchema,
  RuntimeOptionsRefreshFrameSchema,
  RecordKeyAddFrameSchema,
  RecordKeyRemoveFrameSchema,
  DestinationsScanFrameSchema,
  DestinationsSelectFrameSchema,
  DestinationsResetFrameSchema,
])

export type WireArg = z.infer<typeof WireArgSchema>
export type DownstreamFrame = z.infer<typeof DownstreamFrameSchema>
export type UpstreamFrame = z.infer<typeof UpstreamFrameSchema>
export type LinkTargetStatus = z.infer<typeof LinkTargetStatusSchema>
export type LinkUnityStatus = z.infer<typeof LinkUnityStatusSchema>
export type SentLogRecord = z.infer<typeof SentLogRecordSchema>
export type SentLogOrigin = SentLogRecord['origin']
export type DestinationsFrame = z.infer<typeof DestinationsFrameSchema>

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
