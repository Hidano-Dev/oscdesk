import { randomBytes } from 'node:crypto'

import {
  migrateOscPadV1,
  OSC_PAD_FORMAT,
  OSC_PAD_VERSION,
  OscPadStoredSchema,
  type DownstreamFrame,
  type LockRef,
  type OscArg,
  type OscPad,
  type PadDocument,
  type SyncReason,
  type UpstreamFrame,
} from '@oscdesk/shared'

import { formatSurfaceStoreError, type NamedJsonStore } from './named-store'
import { applyPadDocumentEdit, type PadDocumentEditResult } from './pad-document-editor'
import { applyPadEdit, type PadEditResult } from './pad-editor'
import type { PadResendSettings } from './pad-resend'
import { createPadValues, padArgsToOsc, type PadValueEntries, type PersistedPadValues } from './pad-values'

type ClientId = string
type LogFn = (message?: unknown, ...optionalParams: unknown[]) => void

/** 全宛先へ 1 メッセージ送る。origin は送信ログ(D-067)の契機。送れなければ理由を返す */
export type FirePad = (address: string, args: readonly OscArg[], origin?: 'pad' | 'ui') => { ok: true } | { ok: false; reason: string }

/** 同期(自動の再送と手動の同期)の送り先 1 台。name は宛先名、host と port は実際に送る先 */
export interface SyncTarget {
  readonly name: string
  readonly host: string
  readonly port: number
}

/** 採用中のパッドの名前の保存先(ブリッジ再起動をまたいで切り替えを保つ。D-080)。 */
export interface PadActiveStore {
  load(): string | undefined
  save(name: string): void
}

/** パッドごとの保持値の保存先(D-169)。ファイルでの実装は adapters/pad-values-file */
export interface PadValuesStore {
  /** 無ければ null(警告なし)。壊れていれば警告して null */
  load(name: string): PersistedPadValues | null
  save(name: string, values: PersistedPadValues): void
}

export interface PadManager {
  /** 前回採用していたパッドを読み込む。失敗しても起動は続け、採用なしのまま警告する。 */
  start(): void
  /** パッド関連の上りフレームなら処理して true を返す。 */
  handleUiFrame(frame: UpstreamFrame, clientId: ClientId): boolean
  /**
   * 採用中のパッドをプロジェクトファイルの版 2(D-090)の形(版 1 のパッド)で。版 1 で表せない部品を持つなら pad は null
   * (プロジェクトファイルの版 3 への切り替えは HID-491)
   */
  active(): { name: string; pad: OscPad | null } | null
  /**
   * プロジェクトの取り込み(D-090)。padSave と同じく保存して採用する。pad は呼び出し側が OscPadStoredSchema と同じ規則
   * (形・意味・大きさ)で確かめたもので、ここでは検証し直さない(版 2 に直して保存する)。書き込みに失敗したら採用せずに理由を返す
   */
  importPad(name: string, pad: OscPad): { ok: true } | { ok: false; detail: string }
  /** ターゲットが起動した(起動 ID が変わった。D-164)。自動の再送が入っていれば、その 1 台へ保持値を送り直す */
  onTargetStarted(to: SyncTarget): void
  /** ターゲットからのエコー(D-045)。保持値と食い違えば警告し、主系のものは osc.padEcho で配る */
  handleEcho(address: string, args: readonly OscArg[], source: { name: string; primary: boolean }): void
  /** ロックの単位(widget・widget と key)が採用中のパッドにあるか */
  isLockableRef(ref: LockRef): boolean
}

// UI が最後に操作してからこの間は、遅れて届く旧いエコーを食い違いとして警告しない(surface-core の ECHO_SETTLE_MS と同じ)
const ECHO_SETTLE_MS = 1_000

/** 版 1 の画面(osc.pad)に写すときに失うものが無いか。ボタンだけで、広がりも T / F の引数も持たない */
function isV1Lossless(pad: PadDocument): boolean {
  return pad.widgets.every(widget => widget.kind === 'button'
    && (widget.rowSpan ?? 1) === 1 && (widget.columnSpan ?? 1) === 1
    && widget.args.every(arg => arg.type !== 'T' && arg.type !== 'F'))
}

/**
 * 版 2 のパッドを、旧い画面(版 1 の osc.pad。HID-491 で撤去)に見せる版 1 にする。版 1 で表せるボタンだけを写し
 * (値の部品・表・T / F の引数のボタンは落とし、広がりは 1 マスにする)、版 1 の保管の検査に通らなければ null
 */
export function padDocumentToV1(pad: PadDocument): OscPad | null {
  const projected: OscPad = {
    format: OSC_PAD_FORMAT,
    version: OSC_PAD_VERSION,
    rows: pad.rows,
    columns: pad.columns,
    buttons: pad.widgets.flatMap(widget => {
      if (widget.kind !== 'button' || widget.args.some(arg => arg.type === 'T' || arg.type === 'F')) return []
      return [{
        id: widget.id, row: widget.row, column: widget.column, label: widget.label,
        ...(widget.color === undefined ? {} : { color: widget.color }),
        ...(widget.image === undefined ? {} : { image: widget.image }),
        address: widget.address,
        args: widget.args.map(arg => ({ ...arg })) as OscPad['buttons'][number]['args'],
      }]
    }),
  }
  const checked = OscPadStoredSchema.safeParse(projected)
  return checked.success ? checked.data : null
}

const isV1Document = (value: unknown) => typeof value === 'object' && value !== null
  && (value as { format?: unknown }).format === OSC_PAD_FORMAT && (value as { version?: unknown }).version === OSC_PAD_VERSION

/**
 * OSC パッドの保管・採用・配信と、押下・値の部品の送信、保持値と同期(D-080・D-167・D-169)。
 * パッドは版 2 で保管し(版 1 のファイルは読み込むときに版 2 で書き直す)、旧い画面には版 1 で表せる部分を osc.pad で配る。
 * 不正なパッドは採用せず直前のものを維持し、要求元だけに理由を返す。
 * 保持値はパッドの名前ごとに保存し、採用のたびに今のパッドで成り立つものだけを戻す(pad-values の adopt)
 */
export function createPadManager(deps: {
  store: NamedJsonStore<PadDocument>
  activeStore: PadActiveStore
  publish: (frame: DownstreamFrame, target?: ClientId) => void
  fire: FirePad
  /** 保持値の保存先。省くと保存も復元もしない */
  valuesStore?: PadValuesStore
  /** 自動の再送の設定(D-165)。省くと自動の再送をしない */
  resend?: PadResendSettings
  /** 同期の送り先を選ぶ(osc.padSync)。target は宛先名、host はブロードキャストの宛先の中の 1 台。選べなければ理由 */
  syncTargets?: (selection: { target?: string | undefined; host?: string | undefined }) => { ok: true; targets: SyncTarget[] } | { ok: false; reason: string }
  /** 1 台へ同期を送る(/sys/sync/begin ,s reason → messages → /sys/sync/end) */
  sync?: (to: SyncTarget, reason: SyncReason, messages: readonly { address: string; args: OscArg[] }[]) => void
  /** 操作中のロック(HID-378)。ほかの持ち主が持っていればその表示名 */
  lockedBy?: (refs: readonly LockRef[], clientId: ClientId, holder: string | undefined) => string | null
  now?: () => number
  /** 版の印の前半(起動ごとに変わる値)。テストで固定するため注入できる */
  epoch?: string
  logInfo?: LogFn
  logWarn?: LogFn
}): PadManager {
  const now = deps.now ?? Date.now
  // revision は起動ごとに 1 から数え直すので、それだけでは再起動の前後の版を見分けられない。
  // 起動ごとのランダムなエポックと組にして、ブリッジのインスタンスをまたいで一意な版の印にする
  const epoch = deps.epoch ?? randomBytes(6).toString('hex')
  const logInfo = deps.logInfo ?? console.info
  const logWarn = deps.logWarn ?? console.warn
  let active: { name: string; revision: number; version: string; at: string; pad: PadDocument; v1: OscPad | null } | null = null
  let revision = 0
  const values = createPadValues()
  const lastOperatedAt = new Map<string, number>()
  const warnedMismatch = new Set<string>()

  const listFrame = (): DownstreamFrame => ({ v: 1, type: 'osc.padList', names: deps.store.list(), active: active?.name ?? null })

  const v1Frame = (): DownstreamFrame | null => active === null || active.v1 === null ? null : {
    v: 1, type: 'osc.pad', name: active.name, revision: active.revision, version: active.version, at: active.at, pad: active.v1,
  }
  const documentFrame = (): DownstreamFrame | null => active === null ? null : {
    v: 1, type: 'osc.padDocument', name: active.name, revision: active.revision, version: active.version, at: active.at, pad: active.pad,
  }
  const valuesFrame = (full: boolean, entries: PadValueEntries): DownstreamFrame | null => active === null ? null : {
    v: 1, type: 'osc.padValues', name: active.name, version: active.version, full, widgets: entries.widgets, rows: entries.rows,
  }

  const publishIf = (frame: DownstreamFrame | null, target?: ClientId) => {
    if (frame !== null) deps.publish(frame, target)
  }

  const reject = (clientId: ClientId, code: string, detail: string) => {
    logWarn('(WARN, BRIDGE)', `Pad request rejected (${code}): ${detail}`)
    deps.publish({ v: 1, type: 'notice', level: 'error', code, detail }, clientId)
  }

  const persistValues = () => {
    if (active !== null) deps.valuesStore?.save(active.name, values.snapshot())
  }

  const adopt = (name: string, pad: PadDocument, persist: boolean) => {
    // 同じパッドの採用し直し(上書き保存・編集の保存)は今の値を、別のパッドへの切り替えはそのパッドの保存した値を当てる
    const from = active?.name === name ? values.snapshot() : deps.valuesStore?.load(name) ?? { widgets: [], rows: [] }
    revision += 1
    active = { name, revision, version: `${epoch}-${String(revision)}`, at: new Date(now()).toISOString(), pad, v1: padDocumentToV1(pad) }
    const dropped = values.adopt(pad, from)
    lastOperatedAt.clear()
    warnedMismatch.clear()
    if (dropped > 0) {
      // 部品を消した・アドレスや型を変えた・行を消したパッドでは、もう当たらない値を捨てて保存し直す
      logInfo('(INFO, BRIDGE)', `Dropped ${String(dropped)} held pad value(s) that no longer fit pad "${name}".`)
      persistValues()
    }
    publishIf(documentFrame())
    publishIf(v1Frame())
    deps.publish(listFrame())
    publishIf(valuesFrame(true, values.entries()))
    if (persist) deps.activeStore.save(name)
    logInfo('(INFO, BRIDGE)', `Pad "${name}" adopted (revision ${String(revision)}).`)
  }

  // 名前と版の両方で照合する(別の端末が切り替えた・同じ名前で上書きした直後の古い画面の操作が、同じ id の別の部品に当たらないように)
  const isCurrent = (name: string, version: string) => active !== null && active.name === name && active.version === version

  const lockRejection = (refs: readonly LockRef[], clientId: ClientId, holder: string | undefined): string | null => {
    if (deps.lockedBy === undefined) return null
    for (const ref of refs) {
      const owner = deps.lockedBy([ref], clientId, holder)
      if (owner !== null) return `locked: ${'key' in ref ? `${ref.widget}[${ref.key}]` : 'widget' in ref ? ref.widget : JSON.stringify(ref)} by ${owner}`
    }
    return null
  }

  const syncTo = (to: SyncTarget, reason: SyncReason) => {
    const messages = values.resendMessages()
    logInfo('(INFO, BRIDGE)', `Syncing ${String(messages.length)} pad value(s) to "${to.name}" (${to.host}:${String(to.port)}, ${reason}).`)
    deps.sync?.(to, reason, messages)
    return messages.length
  }

  const handleSet = (frame: Extract<UpstreamFrame, { type: 'osc.padSet' | 'osc.padSetCell' }>, clientId: ClientId) => {
    if (!isCurrent(frame.name, frame.version)) return reject(clientId, 'pad-set-rejected', `stale-pad: ${frame.name}@${frame.version}`)
    const result = frame.type === 'osc.padSet' ? values.set(frame.widget, frame.value) : values.setCell(frame.widget, frame.key, frame.column, frame.value)
    if (!result.ok) return reject(clientId, 'pad-set-rejected', result.reason)
    // ほかのブラウザが操作中の部品・行は、持ち主以外からの変更を通さない(HID-378。UI の表示だけに頼らない)
    const refs: LockRef[] = frame.type === 'osc.padSet'
      ? values.lockWidgetsOf(frame.widget).map(widget => ({ widget }))
      : [{ widget: frame.widget, key: frame.key }]
    const locked = lockRejection(refs, clientId, frame.holder)
    if (locked !== null) {
      deps.publish({ v: 1, type: 'notice', level: 'error', code: 'locked', detail: locked }, clientId)
      return
    }
    const sent = deps.fire(result.address, result.args, 'ui')
    if (!sent.ok) return reject(clientId, 'pad-set-rejected', sent.reason)
    // 送れた値だけを保持値に入れる
    const { changed, entries } = result.commit()
    lastOperatedAt.set(result.address, now())
    if (changed) {
      publishIf(valuesFrame(false, entries))
      persistValues()
    }
  }

  return {
    active: () => active === null ? null : { name: active.name, pad: isV1Lossless(active.pad) ? active.v1 : null },
    importPad(name, pad) {
      const saved = deps.store.saveValidated(name, migrateOscPadV1(pad))
      if (!saved.ok) return { ok: false, detail: formatSurfaceStoreError(saved.error, 'pad') }
      adopt(name, saved.value, true)
      return { ok: true }
    },
    start() {
      const name = deps.activeStore.load()
      if (name === undefined) return
      const loaded = deps.store.read(name)
      if (!loaded.ok) {
        logWarn('(WARN, BRIDGE)', `Last pad not adopted: ${formatSurfaceStoreError(loaded.error, 'pad')}`)
        return
      }
      adopt(name, loaded.value, false)
    },
    onTargetStarted(to) {
      if (deps.resend?.isAuto() !== true) return
      syncTo(to, 'boot')
    },
    handleEcho(address, args, source) {
      if (active === null) return
      const echo = values.echo(address, args)
      // 操作の直後の遅れた旧いエコーは食い違いとして扱わない(ドラッグ中の誤警告を避ける)
      const settling = now() - (lastOperatedAt.get(address) ?? -Infinity) < ECHO_SETTLE_MS
      for (const { unit, mismatch } of echo.checked) {
        // 同じ単位の警告は、一致に戻るまでターゲットごとに 1 回(エコーのたびに警告を積まない)
        const key = `${source.name}\u0000${unit}`
        if (!mismatch) {
          warnedMismatch.delete(key)
          continue
        }
        if (settling || warnedMismatch.has(key)) continue
        warnedMismatch.add(key)
        logWarn('(WARN, BRIDGE)', `Target "${source.name}" echo differs from the held pad value of "${unit}" (${address}).`)
      }
      if (source.primary && (echo.widgets.length > 0 || echo.rows.length > 0)) {
        deps.publish({ v: 1, type: 'osc.padEcho', version: active.version, widgets: echo.widgets, rows: echo.rows })
      }
    },
    isLockableRef(ref) {
      if (!('widget' in ref)) return false
      return values.isLockable(ref.widget, 'key' in ref ? ref.key : undefined)
    },
    handleUiFrame(frame, clientId) {
      if (deps.resend?.handleUiFrame(frame, clientId) === true) return true
      switch (frame.type) {
        case 'osc.padRequest': {
          deps.publish(listFrame(), clientId)
          publishIf(v1Frame(), clientId)
          return true
        }
        case 'osc.padDocumentRequest': {
          deps.publish(listFrame(), clientId)
          publishIf(documentFrame(), clientId)
          publishIf(valuesFrame(true, values.entries()), clientId)
          deps.resend?.publish(clientId)
          return true
        }
        case 'osc.padLoad': {
          const loaded = deps.store.read(frame.name)
          if (!loaded.ok) {
            reject(clientId, 'pad-rejected', formatSurfaceStoreError(loaded.error, 'pad'))
            return true
          }
          adopt(frame.name, loaded.value, true)
          return true
        }
        case 'osc.padSave': {
          // 旧い画面(版 1)は版 1 で表せる部分しか見ていないので、その画面からの上書きで値の部品・表を消させない
          if (isV1Document(frame.pad)) {
            const existing = deps.store.read(frame.name)
            if (existing.ok && !isV1Lossless(existing.value)) {
              reject(clientId, 'pad-rejected', `pad "${frame.name}" has widgets that a version 1 pad cannot keep; save it as a version 2 pad`)
              return true
            }
          }
          const saved = deps.store.save(frame.name, frame.pad)
          if (!saved.ok) {
            reject(clientId, 'pad-rejected', formatSurfaceStoreError(saved.error, 'pad'))
            return true
          }
          adopt(frame.name, saved.value, true)
          return true
        }
        case 'osc.padEdit': {
          // 編集の規則を作業コピーに当てて検証し、結果を要求元だけへ返す(D-126)。何も保存・採用しない(保存は osc.padSave)
          let result: PadEditResult
          try {
            result = applyPadEdit(frame.draft, frame.edit)
          } catch (error) {
            // 認証の無い LAN から届く命令で、想定外の例外にブリッジごと落ちないように答えて断る(surfaceEdit と同じ)
            logWarn('(WARN, BRIDGE)', `Pad edit failed: ${String(error)}`)
            result = { ok: false, detail: `編集できませんでした: ${error instanceof Error ? error.message : String(error)}` }
          }
          deps.publish({ v: 1, type: 'osc.padEdited', requestId: frame.requestId, result }, clientId)
          return true
        }
        case 'osc.padDocumentEdit': {
          let result: PadDocumentEditResult
          try {
            result = applyPadDocumentEdit(frame.draft, frame.edit)
          } catch (error) {
            logWarn('(WARN, BRIDGE)', `Pad edit failed: ${String(error)}`)
            result = { ok: false, detail: `編集できませんでした: ${error instanceof Error ? error.message : String(error)}` }
          }
          deps.publish({ v: 1, type: 'osc.padDocumentEdited', requestId: frame.requestId, result }, clientId)
          return true
        }
        case 'osc.padPress': {
          if (active === null || !isCurrent(frame.name, frame.version)) {
            reject(clientId, 'pad-press-rejected', `stale-pad: ${frame.name}@${frame.version}`)
            return true
          }
          const button = active.pad.widgets.find(candidate => candidate.kind === 'button' && candidate.id === frame.button)
          if (button?.kind !== 'button') {
            reject(clientId, 'pad-press-rejected', `unknown-button: ${frame.button}`)
            return true
          }
          const args = padArgsToOsc(button.args)
          // 押下は保持値を書き換えない(決まった値を 1 回送るだけ。D-080)
          const result = args.ok ? deps.fire(button.address, args.args, 'pad') : args
          if (!result.ok) reject(clientId, 'pad-press-rejected', result.reason)
          return true
        }
        case 'osc.padSet':
        case 'osc.padSetCell':
          handleSet(frame, clientId)
          return true
        case 'osc.padAction': {
          if (!isCurrent(frame.name, frame.version)) {
            reject(clientId, 'pad-action-rejected', `stale-pad: ${frame.name}@${frame.version}`)
            return true
          }
          const planned = values.actionMessages(frame.widget, frame.action, frame.key)
          if (!planned.ok) {
            reject(clientId, 'pad-action-rejected', planned.reason)
            return true
          }
          for (const message of planned.messages) {
            const result = deps.fire(message.address, message.args, 'pad')
            if (!result.ok) {
              reject(clientId, 'pad-action-rejected', result.reason)
              return true
            }
          }
          return true
        }
        case 'osc.padSync': {
          const answer = frame.requestId === undefined ? {} : { requestId: frame.requestId }
          const chosen = deps.syncTargets?.({ target: frame.target, host: frame.host }) ?? { ok: false as const, reason: 'sync-unavailable' }
          if (!chosen.ok) {
            logWarn('(WARN, BRIDGE)', `Pad sync rejected: ${chosen.reason}`)
            deps.publish({ v: 1, type: 'notice', level: 'error', code: 'pad-sync-rejected', detail: chosen.reason, ...answer }, clientId)
            return true
          }
          let sent = 0
          for (const to of chosen.targets) sent = syncTo(to, 'manual')
          const names = chosen.targets.map(to => to.name === to.host ? to.name : `${to.name} (${to.host})`).join(', ')
          deps.publish({ v: 1, type: 'notice', level: 'info', code: 'pad-synced', detail: `${names}: ${String(sent)} value(s)`, ...answer }, clientId)
          return true
        }
        default:
          return false
      }
    },
  }
}
