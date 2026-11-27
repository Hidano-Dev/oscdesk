import type {
  DownstreamFrame,
  LinkTargetStatus,
  LinkUnityStatus,
  LockRef,
  OscArg,
  SurfaceDefinition,
  SyncReason,
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
  /** 間をおいて処理する。省くと setTimeout */
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
   * 受理した pong ごとに、答えた送り先 1 台と pong の第 2 引数の起動 ID(D-164)を知らせる(無い・形の合わない pong は null)。
   * 起動 ID の変化で起動を知り、パッドの保持値を送り直すのに使う(D-169)
   */
  onBootId?: (to: SyncTarget, bootId: string | null) => void
  /**
   * ターゲットからのエコー(主系・副系とも。OSC ネイティブ UI の端末からの受信は渡さない)。パッドの保持値との照合と
   * osc.padEcho(D-169)に使う
   */
  onTargetEcho?: (address: string, args: readonly OscArg[], source: { name: string; primary: boolean }) => void
  /** そのアドレスへの送信が当たるパッドのロックの単位(D-169)。定義の操作・osc.message・osc.batch でも確かめる */
  padLockRefs?: (address: string) => readonly LockRef[]
}

/** 同期(パッドの保持値の送り直し。D-169)の送り先 1 台。name は宛先名、host と port は実際に送る先 */
export interface SyncTarget {
  readonly name: string
  readonly host: string
  readonly port: number
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
   * OSC パッドの押下・値の部品の操作(D-080・D-169)を全宛先へ 1 メッセージで送る。サーフェス定義の保持値(D-045)は更新しない
   * (パッドの保持値は pad-manager が持つ)。予約アドレスと一覧のアドレス(D-055)は送らずに理由を返す。origin は送信ログの契機
   */
  firePad(address: string, args: readonly OscArg[], origin?: 'pad' | 'ui'): { ok: true } | { ok: false; reason: string }
  /**
   * 同期の送り先を選ぶ(D-169)。target は宛先名(省くと全宛先)、host はブロードキャストの宛先の中の 1 台(pong を返したホスト)。
   * 今の宛先に無いものは選ばない(任意のアドレスへは送らない)
   */
  syncTargets(selection: { target?: string | undefined; host?: string | undefined; port?: number | undefined }): { ok: true; targets: SyncTarget[] } | { ok: false; reason: string }
  /**
   * OSCQuery で見たエンドポイントを、今 ping に答えている送り先 1 台へ引く(pong の起動 ID と同じ印に揃える。D-169)。
   * 送り先でない・まだ答えていない・喪失中なら null
   */
  answeringSyncTarget(host: string, port: number): SyncTarget | null
  /**
   * 1 台へ同期を送る。/sys/sync/begin ,s reason → 値 → /sys/sync/end の順に、SYNC_MESSAGES_PER_STEP 件ずつ SYNC_STEP_MS おきに送る
   * (一度に投げると受信側のソケットのバッファがあふれて値が落ちる)。値は段ごとに current() から取り直す(同期の途中で操作された値を、
   * 同期の始めの古い値で上書きしない)。同じ送り先への新しい同期を始めたら、進行中の古い同期の残りは送らない
   */
  /** そのアドレスへの送信が当たるロックの単位(定義のパラメータ・Record の行・パッドの部品と行) */
  lockRefsOf(address: string, args: readonly OscArg[]): LockRef[]
    sendSync(to: SyncTarget, reason: SyncReason, current: () => readonly { address: string; args: readonly OscArg[] }[]): void
  /** 全宛先へ設計図の送り直し(/sys/catalog/request。D-104)を求める。保持値は書き換えない。 */
  requestCatalog(): void
  /**
   * その送信元の PC が起動した(Sync の要求に答えたのでない /sys/catalog/begin。HID-385)。サーフェス定義の保持値をその PC へ
   * 再送する(生成の記録は D-166 で撤去した)。取り込んだプロジェクトをまだ送っていない間(D-090)は何もしない
   */
  onTargetStarted(fromHost: string): void
  /**
   * その送信元の PC が今 ping に答えているなら、PC の識別(記録の PC と同じ host)と答え始めた時刻。答えていなければ null。
   * Sync の答えと起動の合図を、要求の時点から答え続けていたかで見分けるのに使う(HID-396・D-115)
   */
  upSinceOfSource(fromHost: string): { pc: string; since: number } | null
  /**
   * ロックの単位(HID-378)が採用中の定義にあるか(HID-392)。パラメータは定義の id、Record の行は定義の Record で、
   * キーが反映済みのキーの一覧か保持値の行にあるもの(画面に行として出るもの)
   */
  isLockableRef(ref: LockRef): boolean
}
