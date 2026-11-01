import { z } from 'zod'

import { CATALOG } from './catalog'
import { DESTINATIONS, NETWORK_SETTINGS, OSC_BATCH, SENT_LOG } from './limits'
import { OscPadSchema } from './osc-pad'
import { PROJECT_FILE, ProjectFileSchema } from './project-file'
import { IDENTIFIER_PATTERN, SurfaceBindingsSchema, SurfaceDefinitionSchema } from './surface-definition'
import { SurfaceNameSchema } from './surface-name'

export const WIRE_PROTOCOL_VERSION = 1 as const

// 通信アダプタの種類(HID-373)。共通のフレームはパラメータ ID と JSON の値だけで書き、OSC のアドレス・型タグは
// OSC のアダプタと osc.* のフレームにだけ置く(MIDI などを足しても UI を作り直さないため)
export const TARGET_ADAPTER_KINDS = ['osc'] as const
export type TargetAdapterKind = typeof TARGET_ADAPTER_KINDS[number]
// OSC 専用の機能のフレームの接頭辞。これ以外のフレームに OSC の語を混ぜない(tests/guards/osc-vocabulary.test.ts)
export const OSC_FRAME_PREFIX = 'osc.'

// パラメータの値(HID-373)。型タグを付けず JSON の値のまま渡す。どの型として送るかはサーバーが定義から決める
// 組み合わせの型のパラメータ(HID-380・D-121)の値は、フィールド id → 基本型の値のオブジェクト
export const ScalarValueSchema = z.union([z.number().finite(), z.string(), z.boolean()])
export const ParamValueSchema = z.union([ScalarValueSchema, z.record(z.string().regex(new RegExp(IDENTIFIER_PATTERN)), ScalarValueSchema)])
export type ParamValue = z.infer<typeof ParamValueSchema>
export type ScalarValue = z.infer<typeof ScalarValueSchema>

// 操作中のロック(HID-378・D-111)。ロックの単位は部品(パラメータ)と Record の行。
// 期限は LOCK.LEASE_MS で、持ち主が操作を続ける間は同じ lock を送り直して延長する(期限の無いロックは作らない)
export const LOCK = {
  LEASE_MS: 2_000,
  MAX_HOLDER_CHARS: 64,
  MAX_LABEL_CHARS: 64,
} as const
// ref の各要素は 256 文字まで(パラメータ・レコードの id は 64 文字、行のキーは ID か名前。全量の配信が膨らまないように)
const LockRefPartSchema = z.string().min(1).max(256)
export const LockRefSchema = z.union([
  z.object({ param: LockRefPartSchema }).strict(),
  z.object({ record: LockRefPartSchema, key: LockRefPartSchema }).strict(),
])
export type LockRef = z.infer<typeof LockRefSchema>
// 持ち主の印。UI のプロセスは複数のブラウザのページを 1 本の接続にまとめるので、接続だけではブラウザを区別できない。
// UI がページごとに振った holder を、ロックの要求と値の変更の両方に付ける
const LockHolderSchema = z.string().min(1).max(LOCK.MAX_HOLDER_CHARS)

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

// UI から届く OSC のアドレスと文字列引数(HID-392・D-111)。OSC の文字列は NUL で終わるので、`/set/level\u0000` は
// `/set/level` と同じバイト列で Unity へ届く。一方でロックの照合(完全一致)は別の文字列として外れ、ロックを素通りする。
// 孤立サロゲートも UTF-8 へ直すと U+FFFD に置き換わり、照合した文字列と送るバイト列が食い違う。どちらも境界で断る
// (下りのフレームには当てない。Unity から届いた文字列はそのまま見せる)
const LONE_SURROGATE_PATTERN = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
const isOscSafeString = (value: string) => !value.includes('\u0000') && !LONE_SURROGATE_PATTERN.test(value)
const UpstreamOscStringSchema = z.string().refine(isOscSafeString, { message: 'nul-or-lone-surrogate' })
const UpstreamOscAddressSchema = z.string().startsWith('/').refine(isOscSafeString, { message: 'nul-or-lone-surrogate' })
const UpstreamWireArgSchema = z.discriminatedUnion('type', [
  strictObject({ type: z.literal('i'), value: Int32Schema }),
  strictObject({ type: z.literal('f'), value: z.number() }),
  strictObject({ type: z.literal('s'), value: UpstreamOscStringSchema }),
  strictObject({ type: z.literal('b'), value: Base64Schema }),
])

const VersionSchema = z.literal(WIRE_PROTOCOL_VERSION)
const PeerSchema = strictObject({
  host: z.string(),
  port: z.number().int().min(1).max(65535),
})
const OscFrameFields = {
  v: VersionSchema,
  type: z.literal('osc.message'),
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
  // ブリッジが持つ通信アダプタ(HID-373)。UI は osc があるときだけ OSC 専用の機能(osc.* のフレーム:
  // OSC パッド・送信ログ)を出す。今は OSC のアダプタしか無く、複数のアダプタの同時稼働は作らない
  adapters: z.array(z.enum(TARGET_ADAPTER_KINDS)).min(1),
})

export { SURFACE_NAME_PATTERN, isValidSurfaceName, SurfaceNameSchema } from './surface-name'

// フィールド id(定義の identifier)。行の値の record のキーに使う(z.string() の record は `__proto__` を黙って落とす)
const FieldIdSchema = z.string().regex(new RegExp(IDENTIFIER_PATTERN))
// Record の 1 行の値(HID-389)。フィールド id → JSON の値。型タグは付けない
const RowValuesSchema = z.record(FieldIdSchema, ScalarValueSchema)

const SurfaceFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('surface'),
  name: SurfaceNameSchema,
  // 採用のたびに 1 ずつ増える(ブリッジの再起動で 1 に戻る)。同じ定義の再採用も増える。
  revision: z.number().int().positive(),
  at: z.string().datetime({ offset: true }),
  // 定義の本体(D-117)。通信の結び付けは載せない(UI を OSC に依存させないため)
  definition: SurfaceDefinitionSchema.refine(definition => definition.bindings === undefined, {
    message: 'definition must not carry bindings (send them in the bindings field)',
  }),
  // 結び付け(D-117)。ブリッジが持つ通信アダプタの分だけ載せる。UI は osc があるときだけ、編集モードのアドレスの欄に使う
  bindings: SurfaceBindingsSchema,
  // アクションの selector が当たるパラメータの id(定義順)。UI は結び付けを見ずに selector の step を展開する
  selectors: z.array(strictObject({ selector: FieldIdSchema, params: z.array(FieldIdSchema).max(OSC_BATCH.MAX_MESSAGES) })),
})

const SurfaceListFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('surfaceList'),
  names: z.array(SurfaceNameSchema),
  active: SurfaceNameSchema.nullable(),
})

// 保持値(D-045)。full が true なら全量(UI は丸ごと置き換える)、false なら変更分のみ。
// パラメータ ID と JSON の値で書く(HID-389)。values はパラメータ、rows は Record の行(record はレコード id、
// key は行のキーで、keysFrom.source 'ui' のレコードでは行の ID。values はフィールド id → 値)
const DesiredFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('desired'),
  full: z.boolean(),
  values: z.array(strictObject({ param: z.string().min(1), value: ParamValueSchema })),
  rows: z.array(strictObject({ record: z.string().min(1), key: z.string(), values: RowValuesSchema })),
})

// ターゲット(主系)が返したエコー(HID-389)。届いた確認で、UI は表示へ反映し、まとめ送りの到着を確かめる
// (保持値は書き換えない。D-045)。副系や OSC ネイティブ UI の端末から届いたものは載せない。
// value はパラメータの型として読めたときだけ付く(trigger の到着の確認は値を問わない)。
// rows は定義どおりの形の行だけ(形の合わない行は捨てる)
const EchoFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('echo'),
  values: z.array(strictObject({ param: z.string().min(1), value: ParamValueSchema.optional() })),
  rows: z.array(strictObject({ record: z.string().min(1), key: z.string(), values: RowValuesSchema })),
})

// Unity が実行時に持つ文字列の一覧(D-053)。毎回全量を送る(UI は丸ごと置き換える)。
// lists は定義が参照する一覧の id(optionsFrom.list・keysFrom.list)ごとに、一覧を返した宛先だけを config の順に並べる。
// choices は optionsFrom を持つパラメータごとの選択肢で、静的な options → 主系 → 副系にしか無い名前の順。
// 宛先ごとの一覧も配るのは、「一部の台にしか無い名前」の印を UI に足すときにプロトコルを変えないため
const RuntimeOptionsFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('runtimeOptions'),
  lists: z.array(strictObject({
    list: z.string().min(1),
    targets: z.array(strictObject({ name: z.string(), options: z.array(z.string()) })),
  })),
  choices: z.array(strictObject({ param: z.string(), options: z.array(z.string()) })),
  // レコード(D-061)。keys は keysFrom を持つレコードごとのキーの一覧(主系の順 → 副系にしか無い名前を config の宛先順、
  // 重複と空文字を除く)。fieldChoices は optionsFrom を持つレコードのフィールドごとの選択肢(choices と同じ順序規則)。
  // ブリッジは常に送るが、旧いブリッジとの互換のため省略可にし、UI は無ければ空として扱う。
  // keysFrom.source 'ui' のレコード(D-087)では keys が行の ID で、names に同じ並びで Name を載せる
  // (行を指す状態はすべて ID で持ち、Name は表示と Unity へ送るためのラベルに留める)
  keys: z.array(strictObject({ record: z.string(), keys: z.array(z.string()), names: z.array(z.string()).optional() })
    .refine(entry => entry.names === undefined || entry.names.length === entry.keys.length, {
      message: 'names must have the same length as keys',
    })).optional(),
  fieldChoices: z.array(strictObject({ record: z.string(), field: z.string(), options: z.array(z.string()) })).optional(),
  // 届いたが反映していない一覧(D-088)。lists 以下はすべて反映済みの一覧から作り、届いた一覧と食い違う出所
  // (宛先。ブロードキャストの宛先では host に答えたホスト)だけをここに載せる。added / removed は反映済みの一覧から見た
  // 名前の増減で、両方が空なら並びだけが違う。旧いブリッジとの互換のため省略可にし、UI は無ければ空として扱う
  pending: z.array(strictObject({
    list: z.string().min(1),
    target: z.string(),
    host: z.string().optional(),
    added: z.array(z.string()),
    removed: z.array(z.string()),
  })).optional(),
})

// 送信ログ(D-067)。ブリッジが Unity へ送った OSC の記録で、UI は表示するだけ(値の正にはしない)。
// origin は送った契機。ui = UI の osc、action = UI の oscBatch(まとめ送り)、resend = 保持値の再送、
// row = キーの一覧に現れた新しい行、request = 一覧の要求、relay = OSC ネイティブ UI の中継、pad = OSC パッドの押下(D-080)
export const SENT_LOG_ORIGINS = ['ui', 'action', 'resend', 'row', 'request', 'relay', 'pad'] as const
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
  type: z.literal('osc.sentLog'),
  // true なら UI は手元の記録を捨ててこれで置き換える(接続直後の既存分の先頭)。false は seq で追加・更新
  full: z.boolean(),
  records: z.array(SentLogRecordSchema).max(SENT_LOG.MAX_RECORDS_PER_FRAME),
})

// 宛先タブ(D-078 / D-079)。毎回全量を送る(UI は丸ごと置き換える)。
// devices は走査で見つかった端末に、この PC・設定の宛先・選択中の宛先を足したもの(found は直近の走査で見つかったか)。
// broadcasts は「全てのデバイス」で送るブロードキャストアドレス(インタフェースごと)。空なら「全てのデバイス」は選べない。
// hostname は端末の名前(逆引き・NetBIOS 等で引けたもの。この PC は OS のホスト名)。引けなければ null(D-085)。
// alias は UI から付けた別名(D-092)。MAC が分かる端末は MAC で、分からない端末は host で覚えた名前。無ければ null。
// UI は alias を hostname より優先して見せる。mac はこの PC なら NIC の MAC(OS が教えたとき)。
// selection.networks はネットワークごとの「全てのデバイス」で選んだネットワーク(broadcasts の network。D-085)。
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
    hostname: z.string().min(1).max(253).nullable(),
    alias: z.string().min(1).max(DESTINATIONS.MAX_ALIAS_CHARS).nullable(),
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
    networks: z.array(z.string().min(1)),
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

// OSC パッド(D-080)。名前の規則はサーフェス定義と同じ(そのままファイル名に使うため)。
// revision は採用のたびに 1 ずつ増え(ブリッジの再起動で 1 に戻る)、UI は内容が変わったときだけ作り直す。
// version は採用ごとに一意な版の印(起動ごとのランダムなエポック + revision)。押下の照合に使う。
// revision だけだと再起動後の採用も 1 から数え直し、再起動前の画面の押下が新しい版を撃ててしまう
const PadVersionSchema = z.string().min(1).max(64)
const PadFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('osc.pad'),
  name: SurfaceNameSchema,
  revision: z.number().int().positive(),
  version: PadVersionSchema,
  at: z.string().datetime({ offset: true }),
  pad: OscPadSchema,
})

const PadListFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('osc.padList'),
  names: z.array(SurfaceNameSchema),
  active: SurfaceNameSchema.nullable(),
})

// プロジェクトファイル(D-090)。projectExport の応答として要求元だけへ送る。requestId は要求の印をそのまま返す
// (UI のプロセスは複数のページを抱えるので、どのページの書き出しかを UI が引き当てる)
const ProjectRequestIdSchema = z.string().min(1).max(PROJECT_FILE.MAX_REQUEST_ID_CHARS)
const ProjectFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('project'),
  requestId: ProjectRequestIdSchema,
  project: ProjectFileSchema,
})

// 読み込む前の検査の答え(D-122)。projectInspect の応答として要求元だけへ送る。取り込みと同じ判定をブリッジが行い、
// 通れば確認のダイアログに出す要約を、通らなければ取り込みの拒否と同じ理由を返す(UI は判定の写しを持たない)。
// summary の件数は取り込む形(版 2 へ移した後)で数える
const ProjectInspectionCountSchema = z.number().int().min(0)
const ProjectInspectionFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('projectInspection'),
  requestId: ProjectRequestIdSchema,
  result: z.discriminatedUnion('ok', [
    strictObject({
      ok: z.literal(true),
      summary: strictObject({
        exportedAt: z.string(),
        surface: strictObject({
          name: SurfaceNameSchema,
          values: ProjectInspectionCountSchema,
          rows: ProjectInspectionCountSchema,
          spawns: ProjectInspectionCountSchema,
        }).nullable(),
        pad: strictObject({ name: SurfaceNameSchema, buttons: ProjectInspectionCountSchema }).nullable(),
      }),
    }),
    strictObject({ ok: z.literal(false), detail: z.string() }),
  ]),
})

// 保持値を Unity へまだ送っていないか(D-090)。プロジェクトを取り込むと unsent が true になり、上り resend(全宛先)で
// 送るまで、ブリッジは保持値の自動の再送(初回の到達・回復・定義の採用)を止める。since は取り込んだ時刻で、
// unsent の間だけ文字列、それ以外は null(判別可能ユニオンの要素に refine を付けられないので、組み合わせは文書と実装で守る)
const DesiredStatusFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('desiredStatus'),
  unsent: z.boolean(),
  since: z.string().datetime({ offset: true }).nullable(),
})

// ネットワークの設定(D-113)。接続時と、変わるたびに全 UI へ全量を送る(UI は丸ごと置き換える)。
// targetInterface はターゲット向けの送受信に使うこの PC の IPv4 アドレス(null はすべてのネットワーク)。ブラウザ向けの
// 待ち受けは常にすべてのネットワークで、この設定に左右されない(変えても操作中のブラウザの接続は切れない)。
// targetRanges はターゲットがいる範囲(IPv4 の CIDR。空は自動 = この PC のネットワークそのまま)。
// allowedBrowsers は接続してよいブラウザの範囲(CIDR。空ならこの PC の localhost だけ)。localhost は常に許可する。
// interfaces は targetInterface に選べるアドレス(この PC の IPv4。localhost を含む)。
// source は default(保存していない)/ saved(保存した)/ unsaved(効いているがファイルへ書けなかった)。
// revision は設定の版(ブリッジの起動ごとに 0 から、変えるたびに 1 つ進む)。変更の要求はこれを添え、違えば断られる
const NetworkCidrSchema = z.string().min(1).max(NETWORK_SETTINGS.MAX_CIDR_CHARS)
const NetworkSettingsRevisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const NetworkSettingsFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('networkSettings'),
  revision: NetworkSettingsRevisionSchema,
  targetInterface: z.string().min(1).nullable(),
  targetRanges: z.array(NetworkCidrSchema).max(NETWORK_SETTINGS.MAX_TARGET_RANGES),
  allowedBrowsers: z.array(NetworkCidrSchema).max(NETWORK_SETTINGS.MAX_ALLOWED_BROWSERS),
  interfaces: z.array(strictObject({ address: z.string().min(1), name: z.string() })),
  source: z.enum(['default', 'saved', 'unsaved']),
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

// 設計図(D-104)。PC ごとの全量を毎回送る(UI は丸ごと置き換える)。PC は取得元のホストで区別し、並びは最初に受けた順。
// 項目はサーバーが受け取った時点でパラメータの語彙に直す(HID-389・D-117)。param は設計図から作る画面(D-112)の
// パラメータ id と同じ作り方の id、props の value は型タグを付けない JSON の値。どのアドレスで届いたかは載せない
const CatalogFrameItemSchema = strictObject({
  param: FieldIdSchema,
  kind: z.string().min(1).max(32),
  type: z.string().min(1).max(32),
  props: z.array(strictObject({
    key: z.string().min(1).max(32),
    value: z.union([z.number().finite(), z.string().max(CATALOG.MAX_STRING_CHARS)]),
  })).max(CATALOG.MAX_PROPS_PER_ITEM),
})
const CatalogFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('catalog'),
  pcs: z.array(strictObject({
    host: z.string().min(1),
    name: z.string().min(1).max(CATALOG.MAX_NAME_CHARS),
    receivedAt: z.string().datetime({ offset: true }),
    // 要約値の照合結果。true = 一致、false = 食い違い(Sync で取り直す)、null = まだ照合していない
    verified: z.boolean().nullable(),
    items: z.array(CatalogFrameItemSchema),
  })),
})

// 操作中のロックの全量(HID-378)。変わるたびに全 UI へ送る(UI は丸ごと置き換える)。clientId と holder が
// 自分(hello の clientId とページの holder)でないロックの部品を、UI は無効にして「操作中: <label>」を出す
const LocksFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('locks'),
  locks: z.array(strictObject({
    ref: LockRefSchema,
    clientId: z.string(),
    holder: LockHolderSchema,
    label: z.string().max(LOCK.MAX_LABEL_CHARS),
  })),
})

// 採用中の画面と設計図の突き合わせ(HID-386・D-112)。設計図から作った画面(blueprint-<PC 名>)を採用している間、
// その PC の設計図に無いパラメータの id を absent に載せる(UI は「この PC には無い」として薄く出す)。
// それ以外の画面では pc が null で absent は空
const BlueprintStatusFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('blueprintStatus'),
  pc: strictObject({ host: z.string(), name: z.string() }).nullable(),
  absent: z.array(z.string()),
})

// 到達のイベント(D-116)。送り先の PC ごとに「送ったものが届いたか」を配る。ok = 届いた、ignored = 届いたが対象が
// いない、failed = 届いたが処理できなかった(後ろ 2 つは受け口が任意に返す。HID-375)。host は返したホスト、target は宛先名。
// param は送ったもののパラメータ id(採用中の定義のパラメータに当たらない送信は null)。共通のフレームなので OSC のアドレスや
// 型タグは載せない(HID-373・D-110)。elapsedMs は送ってから届くまでの経過(遅れて届いた PC に気づくため)
export const DELIVERY_RESULTS = ['ok', 'ignored', 'failed'] as const
const DeliveryEventSchema = strictObject({
  host: z.string().min(1),
  target: z.string().min(1),
  result: z.enum(DELIVERY_RESULTS),
  param: z.string().min(1).nullable(),
  elapsedMs: z.number().int().min(0),
})
const DeliveryFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('delivery'),
  events: z.array(DeliveryEventSchema).min(1).max(64),
})

export const DownstreamFrameSchema = z.discriminatedUnion('type', [
  LocksFrameSchema,
  BlueprintStatusFrameSchema,
  HelloFrameSchema,
  DownstreamOscFrameSchema,
  LinkFrameSchema,
  HeartbeatFrameSchema,
  NoticeFrameSchema,
  SurfaceFrameSchema,
  SurfaceListFrameSchema,
  DesiredFrameSchema,
  EchoFrameSchema,
  RuntimeOptionsFrameSchema,
  SentLogFrameSchema,
  DestinationsFrameSchema,
  PadFrameSchema,
  PadListFrameSchema,
  ProjectFrameSchema,
  ProjectInspectionFrameSchema,
  DesiredStatusFrameSchema,
  CatalogFrameSchema,
  NetworkSettingsFrameSchema,
  DeliveryFrameSchema,
])

// holder は操作したブラウザのページ(HID-378)。ロック中の部品・Record の行に当たる送信は持ち主の holder だけを通す
const UpstreamOscFrameSchema = strictObject({
  ...OscFrameFields,
  address: UpstreamOscAddressSchema,
  args: z.array(UpstreamWireArgSchema),
  holder: LockHolderSchema.optional(),
})
const OscBatchMessageSchema = strictObject({
  address: UpstreamOscAddressSchema,
  args: z.array(UpstreamWireArgSchema),
})
const UpstreamOscBatchFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('osc.batch'),
  messages: z.array(OscBatchMessageSchema).min(1).max(OSC_BATCH.MAX_MESSAGES),
  holder: LockHolderSchema.optional(),
})
const HeartbeatAckFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('heartbeatAck'),
  t: z.number(),
})

// 保持値(D-045)を宛先へ全部送り直す。target を省くと全宛先。
const ResendFrameSchema = strictObject({ v: VersionSchema, type: z.literal('resend'), target: z.string().optional() })

// 「この PC を記録に合わせる」(HID-385・D-115)。target は宛先名(hello / link の targets の name)。その宛先の PC にだけ、
// 生成の記録にあって欠けているものを生成し、記録に無い余分なものを消してから、保持値を送り直す。
// 結果は要求元へ notice reconciled(断るときは reconcile-rejected)
const ReconcileFrameSchema = strictObject({ v: VersionSchema, type: z.literal('reconcile'), target: z.string().min(1) })

// 全宛先へ一覧の要求を送らせる(UI の「一覧を更新」。D-053)。list(一覧の id)を付けると、その一覧の要求だけを
// 送らせる(一覧の近くの Sync。D-077)。採用中の定義に無い一覧・要求を持たない一覧はブリッジが送らずに notice で断る
// (任意の OSC をターゲットへ撒く口にしないため)。どこへ要求を送るかは結び付けが決める(HID-389)
const RuntimeOptionsRefreshFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('runtimeOptionsRefresh'),
  list: z.string().min(1).optional(),
})

// 届いた一覧を反映させる(D-088)。list(一覧の id)を付けるとその一覧だけ、省くと全一覧。
// ターゲットから受ける一覧でなければ、ブリッジは何もせず notice で断る
const RuntimeOptionsApplyFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('runtimeOptionsApply'),
  list: z.string().min(1).optional(),
})

// 通常の画面からのレコードの行の追加・削除(D-075)。record はレコード id。同じ keysFrom.address を共有する
// 全レコードの行がまとめて増減する。キーは空にできない(空のキーは行として扱わない。D-062)。
// keysFrom.source 'ui' のレコード(D-087)では、追加の key は新しい行の Name(ID はブリッジが振る)、
// 削除の key は行の ID。改名(recordKeyRename)は 'ui' のレコードだけで、key(ID)の行の Name を name にする
const RecordKeyAddFrameSchema = strictObject({
  v: VersionSchema, type: z.literal('recordKeyAdd'), record: z.string().min(1), key: z.string().min(1),
})
const RecordKeyRemoveFrameSchema = strictObject({
  v: VersionSchema, type: z.literal('recordKeyRemove'), record: z.string().min(1), key: z.string().min(1),
})
const RecordKeyRenameFrameSchema = strictObject({
  v: VersionSchema, type: z.literal('recordKeyRename'), record: z.string().min(1), key: z.string().min(1), name: z.string().min(1),
})

// 宛先タブ(D-078)。destinationsScan は LAN の走査(走査中なら走査中のものに合流する)、
// destinationsSelect は宛先の選択(allDevices が true の間は networks と hosts を使わないが、外したときに戻すため持っておく。
// networks はネットワークごとの「全てのデバイス」で、その中のホストは hosts にあっても個別には送らない。D-085)、
// destinationsReset は保存した選択を消して設定ファイルの宛先へ戻す。応答はどれも destinations の全量
const DestinationsScanFrameSchema = strictObject({ v: VersionSchema, type: z.literal('destinationsScan') })
const DestinationsSelectFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('destinationsSelect'),
  allDevices: z.boolean(),
  networks: z.array(z.string().min(1).max(18)).max(DESTINATIONS.MAX_SCAN_INTERFACES),
  hosts: z.array(z.string().min(1).max(253)).max(DESTINATIONS.MAX_SELECTED_HOSTS),
})
const DestinationsResetFrameSchema = strictObject({ v: VersionSchema, type: z.literal('destinationsReset') })
// 端末の別名を付ける・消す(D-092)。host は destinations の devices にある端末。alias が null か空白だけなら消す。
// どのキー(MAC か host)で覚えるかはブリッジが自分の知っている MAC で決める(UI に MAC を名乗らせない)。
// 応答は destinations の全量(全 UI)。断るときは要求元へ notice destination-alias-rejected
const DestinationsAliasFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('destinationsAlias'),
  host: z.string().min(1).max(253),
  // 別名の上限(MAX_ALIAS_CHARS)の検査はブリッジが行い、超えたら destination-alias-rejected で理由を返す
  alias: z.string().max(DESTINATIONS.MAX_ALIAS_INPUT_CHARS).nullable(),
})

const SurfaceRequestFrameSchema = strictObject({ v: VersionSchema, type: z.literal('surfaceRequest') })
const SurfaceLoadFrameSchema = strictObject({ v: VersionSchema, type: z.literal('surfaceLoad'), name: SurfaceNameSchema })
// definition の中身はここでは検証しない。フレームごと捨てると UI に理由が届かないため、
// ブリッジが SurfaceDefinitionSchema で検証し、不採用の理由を notice で返す。
// bindings は定義の本体に添える結び付け(D-117)。ブリッジは本体と合わせて 1 つの定義として検証・保存する
// (本体と結び付けを 1 回で保存し、食い違った組を残さないため)。版 1 の定義(パラメータに address を書く形)も受け、
// 保存の前に版 2 へ移す
const SurfaceSaveFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('surfaceSave'),
  name: SurfaceNameSchema,
  definition: z.record(z.string(), z.unknown()),
  bindings: z.record(z.string(), z.unknown()).optional(),
  activate: z.boolean().optional(),
})

// OSC パッド(D-080)。padSave の pad は surfaceSave と同じくフレームの検査では中身を見ず、ブリッジが検証して理由を返す。
// padPress は押したパッドの名前・版(pad フレームの version)とボタン id だけを送り、アドレスと引数はブリッジが
// 保存済みのパッドから引く(送る中身の正をブリッジに置き、どの端末から押しても保存されたとおりに送るため)。
// 版を必須にするのは、同じ名前のまま上書き保存された直後に、古い表示から同じ id の別のボタンを撃たせないため
const PadRequestFrameSchema = strictObject({ v: VersionSchema, type: z.literal('osc.padRequest') })
const PadLoadFrameSchema = strictObject({ v: VersionSchema, type: z.literal('osc.padLoad'), name: SurfaceNameSchema })
const PadSaveFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('osc.padSave'),
  name: SurfaceNameSchema,
  pad: z.record(z.string(), z.unknown()),
})
const PadPressFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('osc.padPress'),
  name: SurfaceNameSchema,
  version: PadVersionSchema,
  button: z.string().min(1),
})

// プロジェクトファイル(D-090)。projectExport は採用中の定義・保持値・パッドをまとめて要求元へ返させる。
// projectImport の project はフレームの検査では中身を見ず(surfaceSave と同じく、理由を UI へ返すため)、ブリッジが
// ProjectFileSchema で検証する。取り込みは定義とパッドを保存・採用して保持値を置き換えるが、Unity へは送らない
const ProjectExportFrameSchema = strictObject({ v: VersionSchema, type: z.literal('projectExport'), requestId: ProjectRequestIdSchema })
// 読み込む前の検査(D-122)。取り込みと同じ判定だけを行い、何も書き換えない。答えは projectInspection(requestId 付き)
const ProjectInspectFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('projectInspect'),
  requestId: ProjectRequestIdSchema,
  project: z.record(z.string(), z.unknown()),
})
const ProjectImportFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('projectImport'),
  project: z.record(z.string(), z.unknown()),
})

// 設計図の Sync(D-104)。全宛先へ /sys/catalog/request を送り、ターゲットに設計図を送り直させる
const CatalogRequestFrameSchema = strictObject({ v: VersionSchema, type: z.literal('catalogRequest') })
// ネットワークの設定を変える(D-113)。3 つの設定をまとめて置き換える(省略した設定を残す部分更新はしない)。
// 中身の検査(CIDR の形・この PC に無いアドレス・操作元を締め出す変更)はブリッジが行い、断るときは要求元へ
// notice network-settings-rejected を返す。browser は UI のプロセスが中継するときの操作元のブラウザのアドレスで、
// ブリッジはこの接続の送信元に加えてこのアドレスも締め出さないことを確かめる(締め出しの判定を厳しくするだけで、許可には使わない)。
// 送信元と browser は今の許可リストにも入っていなければ断る(取り消されたブラウザの、共有の接続に残っていた要求で戻されないように)。
// revision は操作した画面が持っていた設定の版(networkSettings.revision)で、今の版と違えば断る(古い画面からの上書きを防ぐ)
const NetworkSettingsSetFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('networkSettingsSet'),
  revision: NetworkSettingsRevisionSchema,
  targetInterface: z.string().min(1).max(NETWORK_SETTINGS.MAX_CIDR_CHARS).nullable(),
  targetRanges: z.array(NetworkCidrSchema).max(NETWORK_SETTINGS.MAX_TARGET_RANGES),
  allowedBrowsers: z.array(NetworkCidrSchema).max(NETWORK_SETTINGS.MAX_ALLOWED_BROWSERS),
  browser: z.string().min(1).max(NETWORK_SETTINGS.MAX_REQUESTER_CHARS).optional(),
})
// その PC の設計図から既定の画面を作って採用する(HID-386・D-112)。同じ名前で保存した画面があればそれを採用する。
// host は catalog フレームの pcs の host。設計図が無ければ notice catalog-adopt-rejected
const CatalogAdoptFrameSchema = strictObject({ v: VersionSchema, type: z.literal('catalogAdopt'), host: z.string().min(1).max(253) })

// 上りの行のキーと文字列の値(HID-389)。OSC の文字列として送り、行のキーはロックの照合にも使うので、
// 上りの OSC の文字列と同じく NUL と孤立サロゲートを断る(D-111 の追記)
const UpstreamTextSchema = z.string().refine(isOscSafeString, { message: 'nul-or-lone-surrogate' })
const UpstreamKeySchema = z.string().min(1).refine(isOscSafeString, { message: 'nul-or-lone-surrogate' })
const UpstreamValueSchema = z.union([z.number().finite(), UpstreamTextSchema, z.boolean()])
const UpstreamRowValuesSchema = z.record(FieldIdSchema, UpstreamValueSchema)
// 組み合わせの型(D-121)の値。フィールドの文字列も OSC の文字列として送るので同じく断る
const UpstreamCompositeValueSchema = UpstreamRowValuesSchema

// パラメータの値の変更(HID-373)。param は採用中の定義のパラメータ id(UI は中身を解釈しない)、value は JSON の値。
// アドレスと型への直し方・値の検査はブリッジが定義から行う(UI に OSC の語を持たせないため)。
// trigger は value を省くと定義の value を送る
const SetFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('set'),
  param: z.string().min(1),
  value: z.union([ScalarValueSchema, UpstreamCompositeValueSchema]).optional(),
  // 操作した画面が描いた定義の版(surface フレームの revision)。採用中の版と違えばブリッジは断る(stale-surface)。
  // 別のブラウザが定義を切り替えた直後に、旧画面の操作が同じ id の別のアドレスへ読み替わって送られないようにするため。
  // 省くと照合しない(UI 以外の道具のため。NiceGUI の UI は常に付ける)
  revision: z.number().int().positive().optional(),
  // 操作したブラウザのページ(HID-378)。ロック中のパラメータは持ち主の holder からの変更だけを通す
  holder: LockHolderSchema.optional(),
})


// Record の 1 行の値の変更(HID-389)。record はレコード id、key は行のキー(keysFrom.source 'ui' のレコードでは
// 行の ID。Name はブリッジが一覧から付ける)、values は全フィールドの値(フィールド id → JSON の値)。
// どのアドレスへどの型で送るか、型・値域の検査はブリッジが定義から行う。断ったら要求元へ notice row-rejected
// (ほかのブラウザのロック中なら locked)。revision と holder は set と同じ
const SetRowFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('setRow'),
  record: z.string().min(1),
  key: UpstreamKeySchema,
  values: UpstreamRowValuesSchema,
  revision: z.number().int().positive().optional(),
  holder: LockHolderSchema.optional(),
})

// まとめ送り(D-050・HID-389)。画面のアクションを UI が展開した中身を、パラメータ id・行で並べる。ブリッジは
// 1 つのまとめ(OSC なら 1 つの bundle)にして送る。param の value は省くと trigger の定義の value。
// standalone: false のパラメータもここでは送れる(まとめ送りの一部としてだけ送る。HID-166)。
// 1 件でも送れない(定義に無い・型や値域が合わない・ロック中)ならまとめごと断る(notice batch-rejected)
const BatchItemSchema = z.union([
  strictObject({ param: z.string().min(1), value: z.union([UpstreamValueSchema, UpstreamCompositeValueSchema]).optional() }),
  strictObject({ record: z.string().min(1), key: UpstreamKeySchema, values: UpstreamRowValuesSchema }),
])
const BatchFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('batch'),
  items: z.array(BatchItemSchema).min(1).max(OSC_BATCH.MAX_MESSAGES),
  revision: z.number().int().positive().optional(),
  holder: LockHolderSchema.optional(),
})

// 操作中のロックの取得・延長(HID-378)。空いていれば与え、同じ持ち主なら期限を延ばす。ほかの持ち主が持っていれば
// 要求元へ notice lock-rejected を返す。label は他のブラウザに出す持ち主の名前(ページの IP など)
const LockFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('lock'),
  ref: LockRefSchema,
  holder: LockHolderSchema,
  label: z.string().max(LOCK.MAX_LABEL_CHARS),
})
// 操作の終わり。持ち主以外の解放は何もしない
const UnlockFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('unlock'),
  ref: LockRefSchema,
  holder: LockHolderSchema,
})

export const UpstreamFrameSchema = z.discriminatedUnion('type', [
  UpstreamOscFrameSchema,
  UpstreamOscBatchFrameSchema,
  HeartbeatAckFrameSchema,
  SurfaceRequestFrameSchema,
  SurfaceLoadFrameSchema,
  SurfaceSaveFrameSchema,
  ResendFrameSchema,
  ReconcileFrameSchema,
  RuntimeOptionsRefreshFrameSchema,
  RuntimeOptionsApplyFrameSchema,
  RecordKeyAddFrameSchema,
  RecordKeyRemoveFrameSchema,
  RecordKeyRenameFrameSchema,
  DestinationsScanFrameSchema,
  DestinationsSelectFrameSchema,
  DestinationsResetFrameSchema,
  DestinationsAliasFrameSchema,
  PadRequestFrameSchema,
  PadLoadFrameSchema,
  PadSaveFrameSchema,
  PadPressFrameSchema,
  ProjectExportFrameSchema,
  ProjectInspectFrameSchema,
  ProjectImportFrameSchema,
  CatalogRequestFrameSchema,
  NetworkSettingsSetFrameSchema,
  CatalogAdoptFrameSchema,
  SetFrameSchema,
  SetRowFrameSchema,
  BatchFrameSchema,
  LockFrameSchema,
  UnlockFrameSchema,
])

export type WireArg = z.infer<typeof WireArgSchema>
export type DownstreamFrame = z.infer<typeof DownstreamFrameSchema>
export type UpstreamFrame = z.infer<typeof UpstreamFrameSchema>
export type LinkTargetStatus = z.infer<typeof LinkTargetStatusSchema>
export type LinkUnityStatus = z.infer<typeof LinkUnityStatusSchema>
export type SentLogRecord = z.infer<typeof SentLogRecordSchema>
export type SentLogOrigin = SentLogRecord['origin']
export type DestinationsFrame = z.infer<typeof DestinationsFrameSchema>
export type NetworkSettingsFrame = z.infer<typeof NetworkSettingsFrameSchema>

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
