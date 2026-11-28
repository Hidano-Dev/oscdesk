import { z } from 'zod'

import { DESTINATIONS, NETWORK_SETTINGS, OSC_BATCH, SENT_LOG } from './limits'
import { hasLoneSurrogate } from './osc-pad'
import { OSCQUERY, PaletteItemSchema, PaletteUnsupportedSchema } from './oscquery'
import { PAD_DOCUMENT, PadDocumentSchema, PadValueSchema } from './pad-document'
import { PadDocumentEditSchema } from './pad-document-edit'
import { PROJECT_FILE, ProjectFileSchema } from './project-file'
import { SurfaceNameSchema } from './surface-name'

export const WIRE_PROTOCOL_VERSION = 1 as const

// 通信アダプタの種類(HID-373)。共通のフレームはパラメータ ID と JSON の値だけで書き、OSC のアドレス・型タグは
// OSC のアダプタと osc.* のフレームにだけ置く(MIDI などを足しても UI を作り直さないため)
export const TARGET_ADAPTER_KINDS = ['osc'] as const
export type TargetAdapterKind = typeof TARGET_ADAPTER_KINDS[number]
// OSC 専用の機能のフレームの接頭辞。これ以外のフレームに OSC の語を混ぜない(tests/guards/osc-vocabulary.test.ts)
export const OSC_FRAME_PREFIX = 'osc.'

// 操作中のロック(HID-378・D-111)。ロックの単位はパッドの値を持つ部品と表の行(D-169)。
// 期限は LOCK.LEASE_MS で、持ち主が操作を続ける間は同じ lock を送り直して延長する(期限の無いロックは作らない)
export const LOCK = {
  LEASE_MS: 2_000,
  MAX_HOLDER_CHARS: 64,
  MAX_LABEL_CHARS: 64,
} as const
// ref の各要素は 256 文字まで(部品の id は 64 文字、行のキーは 64 文字。全量の配信が膨らまないように)
const LockRefPartSchema = z.string().min(1).max(256)
// widget はパッドの値を持つ部品(D-169)、widget と key は表の部品の 1 行。採用中のパッドの部品の id と行のキー。
// サーフェス定義のパラメータ(param)と Record の行(record・key)の単位は撤去した(D-175)
export const LockRefSchema = z.union([
  z.object({ widget: LockRefPartSchema }).strict(),
  z.object({ widget: LockRefPartSchema, key: LockRefPartSchema }).strict(),
])
export type LockRef = z.infer<typeof LockRefSchema>
// 持ち主の印。同じ接続(テストの道具・旧い UI のプロセス)が複数のページを抱えても区別できるよう、UI がページごとに振った holder を、
// ロックの要求と値の変更の両方に付ける
const LockHolderSchema = z.string().min(1).max(LOCK.MAX_HOLDER_CHARS)

const strictObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict()

// i は OSC int32 の値域に制限する(逸脱を通すとエンコーダ側で黙って切り捨て・ラップされる)。
const Int32Schema = z.number().int().min(-2_147_483_648).max(2_147_483_647)
// b は正規形の base64 のみ受理する。Buffer.from(value, 'base64') は不正文字を黙って
// 読み飛ばすため、境界で拒否しないと Unity へ別のバイト列が届く。
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const Base64Schema = z.string().regex(BASE64_PATTERN)

export const WireArgSchema = z.discriminatedUnion('type', [
  strictObject({ type: z.literal('i'), value: Int32Schema }),
  strictObject({ type: z.literal('f'), value: z.number() }),
  strictObject({ type: z.literal('s'), value: z.string() }),
  strictObject({ type: z.literal('b'), value: Base64Schema }),
  // T / F は値を持たない(型タグそのものが真偽。HID-492)。value を付けたフレームは strict で断る(どちらの真偽か食い違うため)
  strictObject({ type: z.literal('T') }),
  strictObject({ type: z.literal('F') }),
])

// UI から届く OSC のアドレスと文字列引数(HID-392・D-111)。OSC の文字列は NUL で終わるので、`/set/level\u0000` は
// `/set/level` と同じバイト列で Unity へ届く。一方でロックの照合(完全一致)は別の文字列として外れ、ロックを素通りする。
// 孤立サロゲートも UTF-8 へ直すと U+FFFD に置き換わり、照合した文字列と送るバイト列が食い違う。どちらも境界で断る
// (下りのフレームには当てない。Unity から届いた文字列はそのまま見せる)
// 孤立サロゲートの判定は後読みの正規表現で書かない(SPA にバンドルされ、古い Safari で読み込めなくなる。osc-pad の hasLoneSurrogate)
const isOscSafeString = (value: string) => !value.includes('\u0000') && !hasLoneSurrogate(value)
const UpstreamOscStringSchema = z.string().refine(isOscSafeString, { message: 'nul-or-lone-surrogate' })
const UpstreamOscAddressSchema = z.string().startsWith('/').refine(isOscSafeString, { message: 'nul-or-lone-surrogate' })
const UpstreamWireArgSchema = z.discriminatedUnion('type', [
  strictObject({ type: z.literal('i'), value: Int32Schema }),
  strictObject({ type: z.literal('f'), value: z.number() }),
  strictObject({ type: z.literal('s'), value: UpstreamOscStringSchema }),
  strictObject({ type: z.literal('b'), value: Base64Schema }),
  // T / F は値を持たない(型タグそのものが真偽。HID-492)。value を付けたフレームは strict で断る(どちらの真偽か食い違うため)
  strictObject({ type: z.literal('T') }),
  strictObject({ type: z.literal('F') }),
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
  // この接続の送信元のアドレス(ブリッジから見た接続元。IPv4 射影の IPv6 は IPv4 にした形。D-153)。ブラウザから直接つなぐ
  // SPA は、ネットワークのタブの「このブラウザ」と「このブラウザを足す」に使う(許可の判定はブリッジだけが行う)。
  // 送信元が分からない接続では省く
  peer: z.string().min(1).max(NETWORK_SETTINGS.MAX_REQUESTER_CHARS).optional(),
})

export { SURFACE_NAME_PATTERN, isValidSurfaceName, SurfaceNameSchema } from './surface-name'

// 送信ログ(D-067)。ブリッジが Unity へ送った OSC の記録で、UI は表示するだけ(値の正にはしない)。
// origin は送った契機。ui = UI の osc.message とパッドの値の部品、action = UI の osc.batch(まとめ送り)、resend = パッドの同期(D-169)、
// relay = OSC ネイティブ UI の中継、pad = OSC パッドの押下とアクション(D-080)。撤去した row・request(一覧の行と要求)は送らない(D-175)
export const SENT_LOG_ORIGINS = ['ui', 'action', 'resend', 'relay', 'pad'] as const
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
// devices はこの PC・OSCQuery で見つけたターゲットの端末・設定の宛先・選択中の宛先(found はこの PC か OSCQuery で見つかったか。
// LAN の走査は撤去した。D-175)。
// broadcasts は「全てのデバイス」で送るブロードキャストアドレス(インタフェースごと)。空なら「全てのデバイス」は選べない。
// hostname は端末の名前(この PC は OS のホスト名、OSCQuery のターゲットは HOST_INFO の名前)。分からなければ null(D-085)。
// alias は UI から付けた別名(D-092)。MAC が分かる端末は MAC で、分からない端末は host で覚えた名前。無ければ null。
// UI は alias を hostname より優先して見せる。mac はこの PC なら NIC の MAC(OS が教えたとき)、ほかは最後に分かった MAC。
// selection.networks はネットワークごとの「全てのデバイス」で選んだネットワーク(broadcasts の network。D-085)。
// selection.source は config(選択を保存していない。設定ファイルの宛先)/ saved(保存した選択)/
// unsaved(選択は効いているがファイルへ書けなかった。ブリッジを再起動すると失われる)。
// targets は実際に送っている宛先(hello.targets と同じ形 + broadcast)。primaryHosts はブリッジが主系の Unity とみなす送信元ホスト
// (主系の host・名前解決したアドレス・この PC ならループバック・ブロードキャストへ pong を返したホスト)で、
// UI がエコーの出所を Unity と判定するのに使う(主系がブロードキャストやこの PC のとき、host とエコーの送信元が一致しないため)
// OSCQuery のターゲットの送り先(D-168)。ホスト(HTTP を取ったアドレス)と HOST_INFO の OSC_PORT の組
export const DestinationEndpointSchema = strictObject({
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535),
})
export type DestinationEndpoint = z.infer<typeof DestinationEndpointSchema>
const DestinationsFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('destinations'),
  sendPort: z.number().int().min(1).max(65535),
  devices: z.array(strictObject({
    host: z.string().min(1),
    hostname: z.string().min(1).max(253).nullable(),
    alias: z.string().min(1).max(DESTINATIONS.MAX_ALIAS_CHARS).nullable(),
    mac: z.string().nullable(),
    interface: z.string().nullable(),
    self: z.boolean(),
    configured: z.boolean(),
    found: z.boolean(),
    // この端末で見つかった OSCQuery のターゲット(D-168)。name は HOST_INFO の NAME かインスタンス名、oscPort は OSC_PORT。
    // ここに出るターゲットは selection.endpoints で選ぶ(端末の host を選ぶと unity.sendPort へ送る)
    services: z.array(strictObject({
      name: z.string().max(OSCQUERY.MAX_STRING_CHARS).nullable(),
      oscPort: z.number().int().min(1).max(65535),
    })).max(OSCQUERY.MAX_TARGETS).optional(),
  })),
  broadcasts: z.array(strictObject({ address: z.string().min(1), interface: z.string(), network: z.string() })),
  selection: strictObject({
    source: z.enum(['config', 'saved', 'unsaved']),
    allDevices: z.boolean(),
    networks: z.array(z.string().min(1)),
    hosts: z.array(z.string().min(1)),
    endpoints: z.array(DestinationEndpointSchema).optional(),
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
const PadListFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('osc.padList'),
  names: z.array(SurfaceNameSchema),
  active: SurfaceNameSchema.nullable(),
})

// ---- パッドの版 2(D-167)と保持値(D-169) ----
// ブリッジはパッドを版 2 で保管し、採用のたびに osc.padDocument(版 2 の全体)を配る。版 1 の osc.pad・osc.padEdit は撤去した(D-175)
const PadDocumentFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('osc.padDocument'),
  name: SurfaceNameSchema,
  revision: z.number().int().positive(),
  version: PadVersionSchema,
  at: z.string().datetime({ offset: true }),
  pad: PadDocumentSchema,
})

// 版 2 の編集命令の答え(D-167・D-126)。osc.padDocumentEdit の応答として要求元だけへ送る。通れば編集後の作業コピー(保存と同じ検査に
// 通したパッド)、通らなければ理由(編集の規則の理由は画面にそのまま出す日本語)
const PadDocumentEditedFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('osc.padDocumentEdited'),
  requestId: z.string().min(1).max(PROJECT_FILE.MAX_REQUEST_ID_CHARS),
  result: z.discriminatedUnion('ok', [
    strictObject({ ok: z.literal(true), pad: PadDocumentSchema }),
    strictObject({ ok: z.literal(false), detail: z.string() }),
  ]),
})

// パッドの保持値(D-169)。値を持つ部品は widget(部品の id)ごと、表は widget・行の key・欄の column ごとに 1 つ。
// 値は型タグの無い JSON の値(組み合わせの型は引数の並び)。同じアドレスの値の部品が 2 つあれば、値は先に置いた部品が持ち、
// 後の部品にも同じ値を載せる(UI は部品ごとに描くだけで、持ち主の規則を写さない)。
// full が true なら全量(UI は丸ごと置き換える)、false なら変わった分だけ。version は値が属するパッドの版(osc.padDocument の
// version)で、UI は自分が描いている版と違う値を当てない
const PadValuesFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('osc.padValues'),
  name: SurfaceNameSchema,
  version: PadVersionSchema,
  full: z.boolean(),
  widgets: z.array(strictObject({ widget: z.string().min(1).max(64), value: PadValueSchema })),
  rows: z.array(strictObject({ widget: z.string().min(1).max(64), key: z.string().min(1).max(PAD_DOCUMENT.MAX_ROW_KEY_CHARS), column: z.string().min(1).max(64), value: PadValueSchema })),
  // プロジェクトの取り込み(D-176)で保持値を外から置き換えた全量。UI は送信待ちの操作(間引いた値・ホールド)を送らずに捨てる。
  // 同じ内容のパッドでは画面を作り直さないので、捨てないと取り込み前の操作の値が新しい版で送られて取り込んだ値を上書きする
  replaced: z.literal(true).optional(),
})

// 主系のターゲットが返したエコーを、パッドの部品の語彙で配る(D-169。届いた確認で、保持値は書き換えない。D-045)。
// value は部品の型として読めたときだけ付く。副系や OSC ネイティブ UI の端末から届いたものは載せない
const PadEchoFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('osc.padEcho'),
  version: PadVersionSchema,
  widgets: z.array(strictObject({ widget: z.string().min(1).max(64), value: PadValueSchema.optional() })),
  rows: z.array(strictObject({ widget: z.string().min(1).max(64), key: z.string().min(1).max(PAD_DOCUMENT.MAX_ROW_KEY_CHARS), column: z.string().min(1).max(64), value: PadValueSchema.optional() })),
})

// 自動の再送の設定(D-165・D-169)。auto が true のときだけ、ターゲットの起動(起動 ID の変化)でパッドの保持値を送り直す。
// 既定は false。接続時の osc.padDocumentRequest の答えと、変わるたびに全 UI へ送る
const PadResendFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('osc.padResend'),
  auto: z.boolean(),
})

// プロジェクトファイル(D-090・D-175。版 3)。projectExport の応答として要求元だけへ送る。requestId は要求の印をそのまま返す
// (どのページの書き出しかを UI が引き当てる)
const ProjectRequestIdSchema = z.string().min(1).max(PROJECT_FILE.MAX_REQUEST_ID_CHARS)
const ProjectFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('project'),
  requestId: ProjectRequestIdSchema,
  project: ProjectFileSchema,
})

// 読み込む前の検査の答え(D-122)。projectInspect の応答として要求元だけへ送る。取り込みと同じ判定をブリッジが行い、
// 通れば確認のダイアログに出す要約を、通らなければ取り込みの拒否と同じ理由を返す(UI は判定の写しを持たない)。
// summary の件数は取り込む形(版 3 へ移した後)で数える。sourceVersion はファイルの版、droppedSurface は版 1・版 2 のファイルから
// 落とすサーフェス定義(D-175。名前と書いてあった保持値の数。名前が読めなければ null)、destinations はファイルにある送り先の数
// (取り込みでは宛先を変えない)。pad.widgets は部品の数、values は保持値の数(部品と表のマス)
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
        sourceVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        pad: strictObject({ name: SurfaceNameSchema, widgets: ProjectInspectionCountSchema }),
        values: strictObject({ widgets: ProjectInspectionCountSchema, rows: ProjectInspectionCountSchema }),
        destinations: ProjectInspectionCountSchema,
        droppedSurface: strictObject({
          name: z.string().max(64).nullable(),
          values: ProjectInspectionCountSchema,
          rows: ProjectInspectionCountSchema,
        }).nullable(),
      }),
    }),
    strictObject({ ok: z.literal(false), detail: z.string() }),
  ]),
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

// requestId は、要求の印を添えた上りへの答えのときだけ、その印をそのまま返す(いまは networkSettingsSet の
// network-settings-applied / -rejected(HID-474)と osc.padSync の pad-synced / pad-sync-rejected)。要求元は自分が待っている要求の答えかをこれで見分ける
const NoticeFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('notice'),
  level: z.enum(['info', 'warn', 'error']),
  code: z.string(),
  detail: z.string(),
  requestId: ProjectRequestIdSchema.optional(),
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

// 到達のイベント(D-116)。送り先の PC ごとに「送ったものが届いたか」を配る。ok = 届いた、ignored = 届いたが対象が
// いない、failed = 届いたが処理できなかった(後ろ 2 つは受け口が任意に返す。HID-375)。host は返したホスト、target は宛先名。
// 共通のフレームなので OSC のアドレスや型タグは載せない(HID-373・D-110。送ったもののパラメータ id の param はサーフェス定義と一緒に撤去した。D-175)。
//elapsedMs は送ってから届くまでの経過(遅れて届いた PC に気づくため)
export const DELIVERY_RESULTS = ['ok', 'ignored', 'failed'] as const
const DeliveryEventSchema = strictObject({
  host: z.string().min(1),
  target: z.string().min(1),
  result: z.enum(DELIVERY_RESULTS),
  elapsedMs: z.number().int().min(0),
})
const DeliveryFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('delivery'),
  events: z.array(DeliveryEventSchema).min(1).max(64),
})

// OSCQuery のターゲット(D-168)。mDNS で見つけたか設定で直接指定したターゲットごとに、HOST_INFO から読んだ送り先と
// 起動 ID、名前空間から作った部品の候補(パレット)を載せる。接続時と、変わるたびに全 UI へ全量を送る(UI は丸ごと置き換える)。
// id はターゲットの印(mDNS はインスタンス名、設定は host:port)。host は HTTP を取ったアドレスで、送り先も host:oscPort
// (OSC_IP は使わない)。oscPort は HOST_INFO の OSC_PORT(読めなければ null)。pathEvents は WebSocket で PATH_* を受けているか。
// status は loading(読み込み中)/ ready(読めた)/ error(読めなかった。error に理由)。palette は書けるノード(ACCESS 2・3)だけ。
// unsupported は書けるが部品にできないノード、dropped は上限で載せなかった件数。mdns は発見の状態(off は無効・failed は起動できなかった)
const OscQueryTargetSchema = strictObject({
  id: z.string().min(1).max(320),
  source: z.enum(['mdns', 'config']),
  name: z.string().max(OSCQUERY.MAX_STRING_CHARS).nullable(),
  host: z.string().min(1).max(253),
  httpPort: z.number().int().min(1).max(65535),
  oscPort: z.number().int().min(1).max(65535).nullable(),
  bootId: z.string().min(1).max(64).nullable(),
  pathEvents: z.boolean(),
  status: z.enum(['loading', 'ready', 'error']),
  error: z.string().max(256).nullable(),
  fetchedAt: z.string().datetime({ offset: true }).nullable(),
  palette: z.array(PaletteItemSchema).max(OSCQUERY.MAX_PALETTE_ITEMS),
  unsupported: z.array(PaletteUnsupportedSchema).max(OSCQUERY.MAX_UNSUPPORTED_ITEMS),
  dropped: z.number().int().min(0),
})
export type OscQueryTargetView = z.infer<typeof OscQueryTargetSchema>
const OscQueryTargetsFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('osc.queryTargets'),
  mdns: z.enum(['off', 'running', 'failed']),
  targets: z.array(OscQueryTargetSchema).max(OSCQUERY.MAX_TARGETS),
})

export const DownstreamFrameSchema = z.discriminatedUnion('type', [
  OscQueryTargetsFrameSchema,
  LocksFrameSchema,
  HelloFrameSchema,
  DownstreamOscFrameSchema,
  LinkFrameSchema,
  HeartbeatFrameSchema,
  NoticeFrameSchema,
  SentLogFrameSchema,
  DestinationsFrameSchema,
  PadListFrameSchema,
  PadDocumentFrameSchema,
  PadDocumentEditedFrameSchema,
  PadValuesFrameSchema,
  PadEchoFrameSchema,
  PadResendFrameSchema,
  ProjectFrameSchema,
  ProjectInspectionFrameSchema,
  NetworkSettingsFrameSchema,
  DeliveryFrameSchema,
])

// holder は操作したブラウザのページ(HID-378)。ロック中のパッドの部品・表の行に当たる送信は持ち主の holder だけを通す
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

// 宛先タブ(D-078)。destinationsSelect は宛先の選択(allDevices が true の間は networks と hosts を使わないが、外したときに戻すため持っておく。
// networks はネットワークごとの「全てのデバイス」で、その中のホストは hosts にあっても個別には送らない。D-085)、
// destinationsReset は保存した選択を消して設定ファイルの宛先へ戻す。応答はどれも destinations の全量
const DestinationsSelectFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('destinationsSelect'),
  allDevices: z.boolean(),
  networks: z.array(z.string().min(1).max(18)).max(DESTINATIONS.MAX_SCAN_INTERFACES),
  hosts: z.array(z.string().min(1).max(253)).max(DESTINATIONS.MAX_SELECTED_HOSTS),
  // OSCQuery のターゲット(D-168)を、ホストと OSC の受信ポートの組で選ぶ。同じ PC の複数のアプリはポートで区別する。
  // 省略は空(以前の UI)
  endpoints: z.array(DestinationEndpointSchema).max(DESTINATIONS.MAX_SELECTED_HOSTS).optional(),
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

// OSC パッド(D-080)。osc.padSave の pad はフレームの検査では中身を見ず(フレームごと捨てると UI に理由が届かないため)、ブリッジが検証して
// 理由を返す(版 1 と版 2 のどちらも受け、版 2 で保管する。版 1 で表せない部品を持つ保管済みのパッドへの版 1 の上書きは断る。D-169)。
// osc.padPress は押したパッドの名前・版(osc.padDocument の version)とボタン id だけを送り、アドレスと引数はブリッジが
// 保存済みのパッドから引く(送る中身の正をブリッジに置き、どの端末から押しても保存されたとおりに送るため)。
// 版を必須にするのは、同じ名前のまま上書き保存された直後に、古い表示から同じ id の別のボタンを撃たせないため
const PadLoadFrameSchema = strictObject({ v: VersionSchema, type: z.literal('osc.padLoad'), name: SurfaceNameSchema })
// baseVersion(省略可。HID-489・D-170)は、保存する文書のもとにした採用の版(osc.padDocument の version)。付けたときは、
// 採用中のパッドの版が違えば保存せずに pad-rejected(stale-pad: …)で断る。同じ版から同時に編集した 2 つの画面の後着の保存が、
// 先着の変更(行の追加・削除と、削除に伴う保持値)を古い写しで消さないため。null は「採用中のパッドが無い状態からの保存」で、採用中の
// パッドがあれば断る(初めての保存を 2 つの画面が同時にしたとき、後着が先着を上書きしないため)。省くと照合しない(上書きを確かめた保存・旧い画面)
const PadSaveFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('osc.padSave'),
  name: SurfaceNameSchema,
  pad: z.record(z.string(), z.unknown()),
  baseVersion: PadVersionSchema.nullable().optional(),
})
const PadPressFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('osc.padPress'),
  name: SurfaceNameSchema,
  version: PadVersionSchema,
  button: z.string().min(1),
})
// ---- パッドの版 2(D-167)と保持値(D-169)の上り ----
// 保管と採用は osc.padLoad・osc.padSave で行う。押下(決まった値を 1 回送るボタン)は osc.padPress。どれも名前と版(osc.padDocument の version)で照合し、
// 別の端末がパッドを切り替えた・上書きした直後の古い画面の操作を断る
// osc.padDocumentRequest は osc.padList・osc.padDocument(採用中なら)・osc.padValues(全量)・osc.padResend を要求元へ返させる
const PadDocumentRequestFrameSchema = strictObject({ v: VersionSchema, type: z.literal('osc.padDocumentRequest') })
// 版 2 の編集命令(D-167・D-126)。draft は UI が持つ作業コピー(版 1 も受けて版 2 に直す)で、edit を当てて検証した結果を
// osc.padDocumentEdited(requestId 付き)で返す。ブリッジは編集中の状態を持たず、何も保存・採用しない(保存は osc.padSave)
const PadDocumentEditFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('osc.padDocumentEdit'),
  requestId: z.string().min(1).max(PROJECT_FILE.MAX_REQUEST_ID_CHARS),
  draft: z.record(z.string(), z.unknown()),
  edit: PadDocumentEditSchema,
})
// 上りの値。文字列は OSC の文字列として送るので NUL と孤立サロゲートを断る。型と値域の検査はブリッジが部品から行う
const UpstreamPadScalarSchema = z.union([z.boolean(), z.number().finite(), UpstreamOscStringSchema])
const UpstreamPadValueSchema = z.union([UpstreamPadScalarSchema, z.array(UpstreamPadScalarSchema).max(PAD_DOCUMENT.MAX_FIELDS)])
const PadWidgetIdSchema = z.string().min(1).max(64)
const PadRowKeyRefSchema = z.string().min(1).max(PAD_DOCUMENT.MAX_ROW_KEY_CHARS)
// 値を持つ部品(トグル・スライダー・選択・数値と文字の入力・色・組み合わせの型)の値の変更。全宛先へ送り、保持値に入れる。
// 断ったら要求元へ notice pad-set-rejected(ほかのブラウザのロック中なら locked)
const PadSetFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('osc.padSet'),
  name: SurfaceNameSchema,
  version: PadVersionSchema,
  widget: PadWidgetIdSchema,
  value: UpstreamPadValueSchema,
  holder: LockHolderSchema.optional(),
})
// 表の 1 マス(行の key・欄の column)の値の変更。/<表のアドレス>/<key>/<欄のアドレス> へ送り、保持値に入れる
const PadSetCellFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('osc.padSetCell'),
  name: SurfaceNameSchema,
  version: PadVersionSchema,
  widget: PadWidgetIdSchema,
  key: PadRowKeyRefSchema,
  column: PadWidgetIdSchema,
  value: UpstreamPadValueSchema,
  holder: LockHolderSchema.optional(),
})
// 表のアクション(決まった値)。scope が row のアクションは key の行へ、all のアクションは全行へ送る。保持値には入れない
const PadActionFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('osc.padAction'),
  name: SurfaceNameSchema,
  version: PadVersionSchema,
  widget: PadWidgetIdSchema,
  action: PadWidgetIdSchema,
  key: PadRowKeyRefSchema.optional(),
})
// 手動の同期(D-165・D-169)。保持値のうち「送り直す」の部品の値を、/sys/sync/begin ,s manual と /sys/sync/end で挟んで送る。
// target は宛先名(hello / link の targets の name)で、省くと全宛先。host(と port)は 1 台に絞る: 今の宛先の host・
// ブロードキャストの宛先(全てのデバイス)へ pong を返したホスト、または OSCQuery で見つけたターゲット(host と OSC の受信ポートの組。
// D-168。宛先に選んでいなくてよい)。任意のアドレスへは送らない(認証の無い LAN から UDP を撒く口にしないため)。
// 結果は要求元へ notice pad-synced(断るときは pad-sync-rejected)。requestId は notice にそのまま載せて返す
const PadSyncFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('osc.padSync'),
  target: z.string().min(1).max(64).optional(),
  host: z.string().min(1).max(253).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  requestId: ProjectRequestIdSchema.optional(),
})
// 自動の再送の入り切り(D-165)。答えは osc.padResend(全 UI)
const PadResendSetFrameSchema = strictObject({ v: VersionSchema, type: z.literal('osc.padResendSet'), auto: z.boolean() })

// プロジェクトファイル(D-090・D-175)。projectExport は採用中のパッド・保持値・送り先をまとめて要求元へ返させる。
// projectImport の project はフレームの検査では中身を見ず(osc.padSave と同じく、理由を UI へ返すため)、ブリッジが
// readProjectFile で検証する(版 1・版 2 は版 3 へ移す)。取り込みはパッドを保存・採用して保持値を置き換えるが、送り先へは送らない
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

// ネットワークの設定を変える(D-113)。3 つの設定をまとめて置き換える(省略した設定を残す部分更新はしない)。
// 中身の検査(CIDR の形・この PC に無いアドレス・操作元を締め出す変更)はブリッジが行い、断るときは要求元へ
// notice network-settings-rejected を返す。操作元はその接続の送信元(ブラウザそのもの。D-153)で判定する。
// 以前あった browser(NiceGUI 版の UI のプロセスが中継するときの操作元のアドレス)は、UI が SPA だけになったので消した(D-162)。
// 送信元は今の許可リストにも入っていなければ断る(許可を取り消された後に届いた要求で戻されないように)。
// revision は操作した画面が持っていた設定の版(networkSettings.revision)で、今の版と違えば断る(古い画面からの上書きを防ぐ)
// requestId(省略可)は要求の印で、ブリッジは applied / rejected の notice にそのまま載せて返す(HID-474)。応答が時間切れの
// 後に遅れて届いても、要求元が次の保存の答えと取り違えないように。版だけでは見分けられない(時間切れの後に今の版のまま
// 送り直すと、遅れて届いた前の要求の applied の版が、次の要求が通ったときの版と同じになる)
const NetworkSettingsSetFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('networkSettingsSet'),
  revision: NetworkSettingsRevisionSchema,
  targetInterface: z.string().min(1).max(NETWORK_SETTINGS.MAX_CIDR_CHARS).nullable(),
  targetRanges: z.array(NetworkCidrSchema).max(NETWORK_SETTINGS.MAX_TARGET_RANGES),
  allowedBrowsers: z.array(NetworkCidrSchema).max(NETWORK_SETTINGS.MAX_ALLOWED_BROWSERS),
  requestId: ProjectRequestIdSchema.optional(),
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

// OSCQuery のターゲットを探し直して読み直す(D-168)。mDNS の問い合わせを出し直し、知っているターゲットの HOST_INFO と
// 名前空間を取り直す。答えは osc.queryTargets(変わらなくても要求元へ送る)
const OscQueryRefreshFrameSchema = strictObject({
  v: VersionSchema,
  type: z.literal('osc.queryRefresh'),
})

export const UpstreamFrameSchema = z.discriminatedUnion('type', [
  UpstreamOscFrameSchema,
  OscQueryRefreshFrameSchema,
  UpstreamOscBatchFrameSchema,
  HeartbeatAckFrameSchema,
  DestinationsSelectFrameSchema,
  DestinationsResetFrameSchema,
  DestinationsAliasFrameSchema,
  PadLoadFrameSchema,
  PadSaveFrameSchema,
  PadPressFrameSchema,
  PadDocumentRequestFrameSchema,
  PadDocumentEditFrameSchema,
  PadSetFrameSchema,
  PadSetCellFrameSchema,
  PadActionFrameSchema,
  PadSyncFrameSchema,
  PadResendSetFrameSchema,
  ProjectExportFrameSchema,
  ProjectInspectFrameSchema,
  ProjectImportFrameSchema,
  NetworkSettingsSetFrameSchema,
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
export type OscQueryTargetsFrame = z.infer<typeof OscQueryTargetsFrameSchema>

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
