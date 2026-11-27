import type { OscSurfaceParameter, OscSurfaceRecord } from '@oscdesk/shared'

import type { createDeliveryTracker } from '../delivery-tracker'
import type { createDesiredValues } from '../desired-values'
import type { OscUiRouter } from '../osc-ui-router'
import type { createRuntimeOptions } from '../runtime-options'
import type { AdoptionPart } from './adoption'
import type { DesiredPart } from './desired'
import type { InboundPart } from './inbound'
import type { OutboundPart } from './outbound'
import type { RecordsPart } from './records'
import type { TargetsPart } from './targets'
import type { UiFramesPart } from './ui-frames'
import type { VocabularyPart } from './vocabulary'
import type { DiagnosticsHooks, LogFn, SurfaceCoreDeps, TimerHandle, UnityRuntimeTarget } from './types'

// surface-core の文脈(D-134)。もとは 1 つのクロージャの中の変数で、ファイルに分けるために欄へ集めた。
// 各ファイルは文脈を受け取って自分の関数を返し、ほかのファイルの関数は実行時に core.x() で引く。

export const PING_INTERVAL_MS = 2_000
// パッドの同期(D-169)の送り方。32 件ずつ 10 ms おき(毎秒 3,200 件。2 万件で約 6 秒)。受信側のソケットのバッファ(Windows の既定で
// 数十 KB)を 1 段で埋めない大きさにする
export const SYNC_MESSAGES_PER_STEP = 32
export const SYNC_STEP_MS = 10
// UI が最後に操作してからこの間は、遅れて届く旧いエコーを食い違いとして警告しない(ドラッグ中の誤警告を避ける)
export const ECHO_SETTLE_MS = 1_000

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
  readonly newRowId: () => string
  // 送った結果が送り先の PC に届いたか(D-116)。送信ごとに記録し、アダプタの届いた・対象なし・処理失敗と突き合わせて全 UI へ配る。
  // 共通のフレームなので、送ったアドレスは採用中の定義のパラメータ id に引いて載せる(HID-373)
  readonly delivery: ReturnType<typeof createDeliveryTracker>
  readonly uiRouter: OscUiRouter | null
  // ID を持つ行(D-087)の Name は UI で管理する一覧が正。保持値は外へ出すときにここから引く
  readonly desired: ReturnType<typeof createDesiredValues>
  // 一覧(D-053)は宛先名ごとに持つ。宛先の差し替えではこの配列をその場で書き換える
  // (runtime-options は呼ばれるたびにこの配列を読むので、一覧の中身を作り直さずに和集合の順と配る宛先が追従する)
  readonly targetNames: string[]
  readonly runtimeOptions: ReturnType<typeof createRuntimeOptions>
  readonly warnedInternalAddresses: Set<string>
  readonly warnedNonUnitySources: Set<string>
  readonly warnedEchoMismatch: Set<string>
  readonly warnedRuntimeOptions: Set<string>
  // 操作の時刻と食い違いの警告はエントリ単位(レコードは行ごと)。アドレス単位だと別の行のエコーが警告を解除してしまう
  readonly lastOperatedAt: Map<string, number>
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
  hasDefinition: boolean
  activeName: string | undefined
  // 採用中の定義のレコード(行の追加・削除のフレームを id で引くため。D-075)
  definedRecords: readonly OscSurfaceRecord[]
  // 採用中の定義のパラメータ(set フレームの param を id で引き、アドレスと型に直すため。HID-373)
  definedParameters: ReadonlyMap<string, OscSurfaceParameter>
  // アドレスで届く送信(osc.message・osc.batch)をロックの単位(HID-378)へ引くための表
  parameterIdsByAddress: ReadonlyMap<string, string>
  recordIdsByAddress: ReadonlyMap<string, string>
  // OSC のアドレスで持つ保持値・エコーを、UI へ配るパラメータ id の語彙(HID-389)へ直すための表
  parametersByAddress: ReadonlyMap<string, OscSurfaceParameter>
  recordsByAddress: ReadonlyMap<string, OscSurfaceRecord>
  recordsById: ReadonlyMap<string, OscSurfaceRecord>
  // 一覧(D-053)はアドレスで持ち、フレームでは定義の一覧の id で指す(HID-389)
  listIdsByAddress: ReadonlyMap<string, string>
  listsById: ReadonlyMap<string, { address: string; request?: string | undefined }>
  lastLinkPublishedAt: number
  // 取り込んだプロジェクト(D-090)の保持値をまだ Unity へ送っていなければ、取り込んだ時刻。この間は保持値の自動の再送
  // (初回の到達・回復・定義の採用)を止める。取り込みは画面と保持値の更新だけで、送るのは利用者の明示の操作という判断のため
  unsentSince: string | null
  diagnostics: DiagnosticsHooks | null
}

export type Core = CoreEnv & CoreState
  & TargetsPart & OutboundPart & VocabularyPart & DesiredPart & RecordsPart
  & AdoptionPart & InboundPart & UiFramesPart
