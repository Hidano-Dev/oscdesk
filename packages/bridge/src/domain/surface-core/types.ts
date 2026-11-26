import type {
  DownstreamFrame,
  LinkTargetStatus,
  LinkUnityStatus,
  LockRef,
  OscArg,
  SurfaceDefinition,
  TargetAdapterKind,
  BridgeConfig as RuntimeBridgeConfig,
  UpstreamFrame,
} from '@oscdesk/shared'

import type { PersistedDesired } from '../desired-values'
import type { PingMonitor } from '../ping-monitor'
import type { SentEvent } from '../sent-log'

// surface-core の公開の型と、分けたファイルの間で共有する型(D-134)。

export interface UnityRuntimeTarget {
  readonly name: string
  readonly host: string
  readonly sendPort: number
  readonly primary: boolean
  readonly monitor: PingMonitor
  readonly addresses: ReadonlySet<string>
  hasBeenReachable: boolean
  /** ブロードキャストの宛先(D-079)なら、そのネットワーク。pong はこの範囲の任意のホストから受ける */
  readonly broadcast: BroadcastNetwork | null
  /** ブロードキャストの宛先へ pong を返したホスト → 最後に答えた ping の周回(D-079) */
  readonly responders: Map<string, number>
  /** ユニキャストの宛先が答え始めた時刻(初めて答えた・取りこぼしから戻った時点。HID-396)。答えていない間の値は使わない */
  upSince: number | null
  /** ブロードキャストの宛先へ pong を返したホスト → 答え始めた時刻(初めて答えた・周回を取りこぼしてから戻った時点。HID-396) */
  readonly responderUpSince: Map<string, number>
  pingRound: number
  lastPingSeq: number | null
}

export interface BroadcastNetwork {
  readonly networkInt: number
  readonly maskInt: number
}

/**
 * 実行時に差し替える宛先 1 件(宛先タブ。D-078)。addresses は host がホスト名のときの名前解決済みアドレス。
 * broadcast があればブロードキャストアドレスの宛先で、pong とエコーの出所の扱いが変わる(D-079)
 */
export interface RuntimeTargetSpec {
  readonly name: string
  readonly host: string
  readonly sendPort: number
  readonly primary: boolean
  readonly addresses?: readonly string[]
  readonly broadcast?: BroadcastNetwork | null
}

export type TimerHandle = ReturnType<typeof setInterval> | number
export type LogFn = (message?: unknown, ...optionalParams: unknown[]) => void
export type SendFn = (host: string, port: number, address: string, ...args: OscArg[]) => void
export type BundleSendFn = (host: string, port: number, messages: readonly { address: string; args: readonly OscArg[] }[]) => BundleSendResult

export type BundleSendResult =
  | { ok: true; bytes: number; messageCount: number }
  | { ok: false; reason: 'too-large'; bytes: number; limitBytes: number }
  | { ok: false; reason: 'transport-unavailable' }

export type ClientId = string

export interface InboundOscMessage {
  address: string
  args: readonly OscArg[]
  from: { host: string; port: number }
}

export type BridgeConfig = RuntimeBridgeConfig & {
  server?: { name?: string; version?: string }
}

export interface SurfaceCoreDeps {
  config: BridgeConfig
  /** unity.host がホスト名のときの名前解決済み数値アドレス(OSC ネイティブ UI 判定用)。 */
  unityAddresses?: readonly string[]
  /** 副系の宛先名ごとの、名前解決済み数値アドレス。 */
  secondaryAddresses?: Readonly<Record<string, readonly string[]>>
  sendFn: SendFn
  sendBundleFn?: BundleSendFn
  publish: (frame: DownstreamFrame, target?: ClientId) => void
  now?: () => number
  setIntervalFn?: (cb: () => void, ms: number) => TimerHandle
  clearIntervalFn?: (handle: TimerHandle) => void
  /** 生成し直しを間をおいて送る(HID-385)。省くと setTimeout */
  setTimeoutFn?: (cb: () => void, ms: number) => unknown
  logInfo?: LogFn
  logWarn?: LogFn
  logError?: LogFn
  createDiagnosticsEngine?: (deps: Record<string, unknown>) => DiagnosticsHooks
  /** Unity へ実際に送ったものの記録先(送信ログ、D-067)。ping は渡さない。 */
  onSent?: (event: SentEvent) => void
  /** 保持値の保存先(D-058)。省くと保存も復元もしない。 */
  desiredValuesStore?: {
    load(name: string): PersistedDesired | null
    save(name: string, values: PersistedDesired): void
    /**
     * その定義のファイルに未送信の印(D-090)があれば取り込んだ時刻。稼働中の採用でも、印のある定義だけは
     * メモリ上の値でなくファイルの値と印を戻すために見る。読めない・印が無ければ undefined(警告しない)
     */
    unsentSince?(name: string): string | undefined
  }
  /** ブロードキャストの宛先へ初めて pong を返したホストが増えたとき(宛先タブの再配信用。D-079) */
  onRespondersChanged?: () => void
  /** UI で管理する一覧の行の ID を振る(D-087)。省くと UUID */
  newRowId?: () => string
  /** hello で知らせる通信アダプタ(HID-373)。省くと osc だけ */
  adapterKinds?: readonly TargetAdapterKind[]
  /**
   * 操作中のロック(HID-378)。refs のどれかをほかの持ち主が持っていれば、その持ち主の表示名を返す(通してよければ null)。
   * 省くとロックを見ない
   */
  lockedBy?: (refs: readonly LockRef[], clientId: ClientId, holder: string | undefined) => string | null
  /**
   * 確定済みの設計図(PC ごと。D-104)。生成の名前の割り当て(どの PC でも使われていない名前を選ぶ)と、
   * 「記録に合わせる」の差分(HID-385)に使う。省くと設計図が無いものとして扱う
   */
  catalogPcs?: () => readonly { host: string; items: readonly { address: string }[] }[]
}

export interface DiagnosticsHooks {
  recordIncoming?: (address: string, args: readonly OscArg[], host: string, port: number) => void
  recordOutgoing?: (address: string, args: readonly OscArg[], host: string, port: number) => void
  onPingCycle?: (event: { previousLost: boolean }) => void
  onPongAccepted?: () => void
  snapshot?: () => unknown
  dispose: () => void
}

export interface SurfaceCore {
  start(): void
  stop(): void
  handleOscIn(message: InboundOscMessage): void
  /** 通信アダプタの「対象なし」「処理失敗」(HID-375)。送り先の到達のイベント(D-116)にだけ使い、UI へ生では流さない */
  handleUndelivered(from: { host: string; port: number }, result: 'ignored' | 'failed', refs: readonly string[]): void
  handleUiFrame(frame: UpstreamFrame, clientId: ClientId): void
  /** peer はこの接続の送信元のアドレス(正規形)。hello の peer に載せる(D-153)。分からなければ省く */
  onUiConnected(clientId: ClientId, peer?: string): void
  onUiDisconnected(clientId: ClientId): void
  linkSnapshot(): { unity: LinkUnityStatus; targets: LinkTargetStatus[] }
  helloFrame(clientId: ClientId, peer?: string): DownstreamFrame
  /**
   * 定義の採用を保持値へ反映し、全 UI へ配って(Unity 到達可能なら)再送する。null は採用解除。
   * name は保管名で、保持値の保存と(保持値を持っていない最初の採用での)復元に使う(D-058)。
   * imported を渡すとプロジェクトの取り込み(D-090)で、保持値をそれで置き換え(無いものは default)、Unity へは送らず、
   * 上り resend(全宛先)で送るまで自動の再送を止める。
   * 定義は版 2(D-117)で、OSC の結び付けで OSC のアドレスに解決して動く(結び付けの無い定義は渡さない)
   */
  setDefinition(definition: SurfaceDefinition | null, name?: string, imported?: PersistedDesired): void
  /** プロジェクトの書き出し(D-090)に載せる保持値の全量(UI で管理する一覧を含む)。 */
  exportDesired(): PersistedDesired
  /** 保持値をまだ Unity へ送っていないか(desiredStatus。D-090)を指定の UI へ送る(定義が無ければ何もしない)。 */
  publishDesiredStatus(clientId: ClientId): void
  /** 保持値の全量を指定の UI へ送る(定義が無ければ何もしない)。 */
  publishDesired(clientId: ClientId): void
  /** Unity の一覧(D-053)の全量を指定の UI へ送る(定義が無ければ何もしない)。 */
  publishRuntimeOptions(clientId: ClientId): void
  /**
   * 宛先を差し替える(宛先タブ。D-078)。主系がちょうど 1 件ある空でない一覧を渡す。
   * 名前・host・sendPort・ブロードキャストの範囲が同じ宛先は死活監視の状態を引き継ぎ、新しい宛先は
   * 初回の pong で「初回到達」として保持値を再送する
   */
  setTargets(targets: readonly RuntimeTargetSpec[]): void
  /** 今の宛先(主系が先頭)。 */
  currentTargets(): readonly (RuntimeTargetSpec & { readonly broadcast: BroadcastNetwork | null })[]
  /**
   * 主系の Unity とみなす送信元ホスト(host・名前解決したアドレス・ループバック・ブロードキャストへ pong を返したホスト)。
   * UI がエコーの出所を判定するのに使う(主系がブロードキャストやこの PC のときは host と送信元が一致しないため。D-079)
   */
  primaryHosts(): string[]
  /**
   * OSC パッドの押下(D-080)を全宛先へ 1 メッセージで送る。保持値(D-045)は更新せず、再送もしない。
   * 予約アドレスと一覧のアドレス(D-055)は送らずに理由を返す。
   */
  firePad(address: string, args: readonly OscArg[]): { ok: true } | { ok: false; reason: string }
  /** 全宛先へ設計図の送り直し(/sys/catalog/request。D-104)を求める。保持値は書き換えない。 */
  requestCatalog(): void
  /**
   * その送信元の PC が起動した(Sync の要求に答えたのでない /sys/catalog/begin。HID-385)。その PC への生成の記録を
   * 生成し直し、続けて保持値を再送する。取り込んだプロジェクトをまだ送っていない間(D-090)は何もしない
   */
  onTargetStarted(fromHost: string): void
  /**
   * その送信元の PC が今 ping に答えているなら、PC の識別(記録の PC と同じ host)と答え始めた時刻。答えていなければ null。
   * Sync の答えと起動の合図を、要求の時点から答え続けていたかで見分けるのに使う(HID-396・D-115)
   */
  upSinceOfSource(fromHost: string): { pc: string; since: number } | null
  /** その送信元の PC から設計図の削除通知(/sys/catalog/remove)が来た。その PC の生成の記録から外す(HID-385) */
  onCatalogItemRemoved(fromHost: string, itemAddress: string): void
  /** その送信元の PC の設計図に項目が載った。生きていて持っているので「ほかの PC で消された」印を外す(HID-385) */
  onCatalogItemAdded(fromHost: string, itemAddress: string): void
  /**
   * ロックの単位(HID-378)が採用中の定義にあるか(HID-392)。パラメータは定義の id、Record の行は定義の Record で、
   * キーが反映済みのキーの一覧か保持値の行にあるもの(画面に行として出るもの)
   */
  isLockableRef(ref: LockRef): boolean
}
