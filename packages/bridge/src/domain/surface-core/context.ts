import type { createDeliveryTracker } from '../delivery-tracker'
import type { OscUiRouter } from '../osc-ui-router'
import type { InboundPart } from './inbound'
import type { LocksPart } from './locks'
import type { OutboundPart } from './outbound'
import type { TargetsPart } from './targets'
import type { UiFramesPart } from './ui-frames'
import type { DiagnosticsHooks, LogFn, SurfaceCoreDeps, TimerHandle, UnityRuntimeTarget } from './types'

// surface-core の文脈(D-134)。もとは 1 つのクロージャの中の変数で、ファイルに分けるために欄へ集めた。
// 各ファイルは文脈を受け取って自分の関数を返し、ほかのファイルの関数は実行時に core.x() で引く。

export const PING_INTERVAL_MS = 2_000
// パッドの同期(D-169)の送り方。32 件ずつ 10 ms おき(毎秒 3,200 件。2 万件で約 6 秒)。受信側のソケットのバッファ(Windows の既定で
// 数十 KB)を 1 段で埋めない大きさにする
export const SYNC_MESSAGES_PER_STEP = 32
// 同期の 1 巡目を送り終えてから、途中で変わった値の送り直しだけで続けてよい段の数(HID-502・D-173)。値が変わり続けても end を送る
export const MAX_SYNC_RESEND_STEPS = 8
export const SYNC_STEP_MS = 10

/** 組み立てたら変わらないもの(依存・時計・ログ・部品と、中身だけが変わる表) */
export interface CoreEnv {
  readonly deps: SurfaceCoreDeps
  readonly now: () => number
  readonly setIntervalFn: (cb: () => void, ms: number) => TimerHandle
  readonly clearIntervalFn: (handle: TimerHandle) => void
  readonly setTimeoutFn: (cb: () => void, ms: number) => unknown
  readonly logInfo: LogFn
  readonly logWarn: LogFn
  readonly logError: LogFn
  // 送った結果が送り先の PC に届いたか(D-116)。送信ごとに記録し、アダプタの届いた・対象なし・処理失敗と突き合わせて全 UI へ配る
  readonly delivery: ReturnType<typeof createDeliveryTracker>
  readonly uiRouter: OscUiRouter | null
  readonly warnedInternalAddresses: Set<string>
  readonly warnedNonUnitySources: Set<string>
  // 起動 ID の無い pong(以前の受け口)を知らせた宛先(1 宛先 1 回だけ記録に残す。D-169)
  readonly warnedNoBootId: Set<string>
}

/** 動いている間に置き換わるもの */
export interface CoreState {
  // 宛先は宛先タブ(D-078)で実行中に差し替わる。主系は常に先頭に置く(oscBatch の副系への送信が slice(1) で数えるため)
  targets: UnityRuntimeTarget[]
  pingSeq: number
  timer: TimerHandle | null
  stopped: boolean
  lastLinkPublishedAt: number
  diagnostics: DiagnosticsHooks | null
}

export type Core = CoreEnv & CoreState & TargetsPart & OutboundPart & LocksPart & InboundPart & UiFramesPart
