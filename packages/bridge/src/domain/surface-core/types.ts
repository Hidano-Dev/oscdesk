import type {
  DownstreamFrame,
  LinkTargetStatus,
  LinkUnityStatus,
  LockRef,
  OscArg,
  SyncReason,
  TargetAdapterKind,
  BridgeConfig as RuntimeBridgeConfig,
  UpstreamFrame,
} from '@oscdesk/shared'

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
  /** ブロードキャストの宛先(D-079)なら、そのネットワーク。pong はこの範囲の任意のホストから受ける */
  readonly broadcast: BroadcastNetwork | null
  /** ブロードキャストの宛先へ pong を返したホスト → 最後に答えた ping の周回(D-079) */
  readonly responders: Map<string, number>
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
  /** ブロードキャストの宛先へ初めて pong を返したホストが増えたとき(宛先タブの再配信用。D-079) */
  onRespondersChanged?: () => void
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
   * 宛先を差し替える(宛先タブ。D-078)。主系がちょうど 1 件ある空でない一覧を渡す。
   * 名前・host・sendPort・ブロードキャストの範囲が同じ宛先は死活監視の状態を引き継ぐ
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
   * OSC パッドの押下・値の部品の操作(D-080・D-169)を全宛先へ 1 メッセージで送る(パッドの保持値は pad-manager が持つ)。
   * 予約アドレスは送らずに理由を返す。origin は送信ログの契機
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
   * 同期の始めの古い値で上書きしない)。current() が null を返したら end を送らずに打ち切る。同じ送り先への新しい同期を始めたら、
   * 進行中の古い同期の残りは送らない。ブロードキャストの宛先全体への同期と、それが届く PC への個別の同期は直列にする(HID-498):
   * ブロードキャストの同期を始めたら届く PC の個別の同期の残りは送らず、ブロードキャストの同期の途中で頼まれた重なる同期はその end の後に始める。
   * onComplete は end まで送り終えたときだけ呼ぶ(打ち切り・別の同期に替わった・終了では呼ばない。HID-499)
   */
  sendSync(to: SyncTarget, reason: SyncReason, current: () => readonly { address: string; args: readonly OscArg[] }[] | null, onComplete?: () => void): void
  /** そのアドレスへの送信が当たるロックの単位(パッドの部品と行) */
  lockRefsOf(address: string, args: readonly OscArg[]): LockRef[]
}
