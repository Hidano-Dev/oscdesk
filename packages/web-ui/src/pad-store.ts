// パッドの主画面(D-170)の実行の状態。採用中のパッドの版 2(osc.padDocument)・保持値(osc.padValues)とエコー(osc.padEcho)の
// 表示キャッシュ・操作中のロック・自動の再送の設定(osc.padResend)・OSCQuery のターゲット(osc.queryTargets)を signal に持ち、
// 部品の操作(osc.padPress / padSet / padSetCell / padAction)・手動の同期(osc.padSync)・再送の入り切りを送る。
//
// 規則の正はブリッジ(値の型と値域・ロック・版の照合・同じアドレスの持ち主)。ここが持つのは操作の手触り(value-channel)だけで、
// 同じアドレスの部品の持ち主の規則も写さない(ブリッジが部品ごとに値を載せて配る。D-169)。
// 描いているパッドと version の違う値・エコーは当てない(別の端末が切り替えた・上書きした直後に、旧い版の値を新しい部品に当てない)。
// 接続ごとの初期の要求(osc.padDocumentRequest)は bridge-link が送る(D-155)。
import { batch, computed, signal } from '@preact/signals'

import {
  WIRE_PROTOCOL_VERSION,
  isHoldingWidget,
  type LockRef,
  type OscQueryTargetView,
  type PadDocument,
  type PadTableWidget,
  type PadValue,
  type PadWidget,
  type UpstreamFrame,
} from '@oscdesk/shared'

import type { BridgeLink, FrameOf } from './bridge-link'
import type { Notices } from './notices'
import { cellKey, findWidget, padValueOf, tableRows, targetRowKeys, valuesOfPadValue, type TableRow } from './pad-logic'
import {
  LOCK_RENEW_INTERVAL_MS,
  TICK_MS,
  ValueStore,
  holdTimeoutOf,
  holderLabel,
  newHolder,
  type Scalar,
  type Values,
} from './value-channel'

type LockEntry = FrameOf<'locks'>['locks'][number]
type DestinationTarget = FrameOf<'destinations'>['targets'][number]

export interface AdoptedPad {
  name: string
  version: string
  revision: number
  pad: PadDocument
  /** 作り直しの回数。画面の key にする(同じ内容の再採用では増えない) */
  generation: number
}

/** 手動の同期の行き先。target は宛先名、host と port は OSCQuery のターゲット(D-168)。どちらも省くと全宛先 */
export interface SyncChoice { label: string; target?: string; host?: string; port?: number }

export const OFFLINE_MESSAGE = 'ブリッジに接続していないため送れませんでした'
/** 応答を待つ同期の印を覚えておく数(遅れて届いた答えを、どの同期への答えかで知らせる) */
const SYNC_MEMORY = 32
/** 行の追加・削除(編集して保存する)の答えを待つ上限 */
const ROW_EDIT_TIMEOUT_MS = 15_000

export interface PadStoreDeps {
  link: BridgeLink
  notices: Notices
  now?: () => number
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  /** このタブの印。省けば作る(テストで固定する) */
  holder?: string
  /** ほかのブラウザに出す名前。省けば userAgent から作る */
  holderLabel?: string
  randomId?: () => string
  logInfo?: (...args: unknown[]) => void
}

export type PadStore = ReturnType<typeof createPadStore>

export function createPadStore(deps: PadStoreDeps) {
  const { link } = deps
  const now = deps.now ?? (() => performance.now())
  const setTimer = deps.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms))
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const randomId = deps.randomId ?? (() => Math.random().toString(16).slice(2, 14))
  const logInfo = deps.logInfo ?? console.info
  const notify = deps.notices.notify
  const holder = deps.holder ?? newHolder()
  const label = (deps.holderLabel ?? holderLabel(typeof navigator === 'undefined' ? '' : navigator.userAgent)).slice(0, 64)

  const oscAvailable = signal(true)
  const adopted = signal<AdoptedPad | null>(null)
  const names = signal<readonly string[]>([])
  // この接続で受けた一覧(osc.padList)の active。undefined はまだ受けていない
  const listedActive = signal<string | null | undefined>(undefined)
  const locks = signal<readonly LockEntry[]>([])
  const autoResend = signal<boolean | null>(null)
  const mdns = signal<FrameOf<'osc.queryTargets'>['mdns'] | null>(null)
  const queryTargets = signal<readonly OscQueryTargetView[]>([])
  const destinationTargets = signal<readonly DestinationTarget[]>([])
  /** 保持値にある表の行のキー(部品の id → 現れた順)。ターゲットが持つ行の表に出す */
  const heldRowKeys = signal<ReadonlyMap<string, readonly string[]>>(new Map())

  let values = new ValueStore()
  let contentKey = ''
  let generation = 0
  let seq = 0

  // このタブが操作中の部品と表のマス。ロックの延長と、入力欄のフォーカス中のホールドの延長に使う
  const heldWidgets = new Set<string>()
  const editingWidgets = new Set<string>()
  const heldCells = new Map<string, { widget: string; key: string; column: string }>()
  const editingCells = new Set<string>()
  const lockSentAt = new Map<string, number>()
  const syncRequests = new Map<string, string>()
  let rowEdit: { requestId: string; version: string; timer: unknown; what: string } | null = null

  const send = (frame: UpstreamFrame) => link.send(frame)
  const current = () => adopted.peek()

  // --- 操作中のロック -------------------------------------------------------------------

  const lockId = (ref: LockRef) => ('widget' in ref ? `${ref.widget}\u0000${'key' in ref ? ref.key : ''}` : JSON.stringify(ref))
  const lockLabelOf = (matches: (ref: LockRef) => boolean): string | null => {
    const own = link.hello.peek()?.clientId
    for (const lock of locks.value) {
      if (matches(lock.ref) && !(lock.clientId === own && lock.holder === holder)) return lock.label
    }
    return null
  }
  /** ほかのブラウザがこの部品を操作中ならその名前。同じアドレスのほかの部品のロックはブリッジが見る(写さない) */
  const widgetLockLabel = (widget: string) => lockLabelOf((ref) => 'widget' in ref && !('key' in ref) && ref.widget === widget)
  const rowLockLabel = (widget: string, key: string) => lockLabelOf((ref) => 'widget' in ref && 'key' in ref && ref.widget === widget && ref.key === key)

  const sendLock = (ref: LockRef, force = false) => {
    const id = lockId(ref)
    const at = now()
    if (!force && at - (lockSentAt.get(id) ?? Number.NEGATIVE_INFINITY) < LOCK_RENEW_INTERVAL_MS) return
    if (send({ v: WIRE_PROTOCOL_VERSION, type: 'lock', ref, holder, label })) lockSentAt.set(id, at)
  }
  const sendUnlock = (ref: LockRef) => {
    const id = lockId(ref)
    if (!lockSentAt.has(id)) return
    lockSentAt.delete(id)
    send({ v: WIRE_PROTOCOL_VERSION, type: 'unlock', ref, holder })
  }
  const rowHeld = (widget: string, key: string) => [...heldCells.values()].some((cell) => cell.widget === widget && cell.key === key)

  const releaseAllLocks = () => {
    for (const widget of heldWidgets) sendUnlock({ widget })
    for (const cell of heldCells.values()) sendUnlock({ widget: cell.widget, key: cell.key })
    heldWidgets.clear()
    editingWidgets.clear()
    heldCells.clear()
    editingCells.clear()
    lockSentAt.clear()
  }

  // --- 送信 -------------------------------------------------------------------------------

  /** 今のパッドの部品か(同一性で照合する。差し替わった後の古い画面の部品から来た操作は送らない) */
  const isCurrentWidget = (widget: PadWidget) => {
    const pad = current()?.pad
    return pad !== undefined && pad.widgets.includes(widget)
  }

  const sendValue = (widget: PadWidget, sending: Values) => {
    const pad = current()
    if (pad === null || !isCurrentWidget(widget)) {
      logInfo('(INFO, SPA)', `pad widget ${widget.id} belongs to a replaced pad; not sending`)
      return
    }
    const value = padValueOf(widget, sending)
    if (value === null) return
    // 部品の id と JSON の値で送る(D-169)。アドレスと型への直し方・値の検査はブリッジが文書から行う。version は描いたパッドの版
    send({ v: WIRE_PROTOCOL_VERSION, type: 'osc.padSet', name: pad.name, version: pad.version, widget: widget.id, value: value as PadValue, holder })
  }

  const sendCell = (table: PadTableWidget, key: string, column: string, sending: Values) => {
    const pad = current()
    if (pad === null || !isCurrentWidget(table)) return
    if (sending.length !== 1) return
    send({ v: WIRE_PROTOCOL_VERSION, type: 'osc.padSetCell', name: pad.name, version: pad.version, widget: table.id, key, column, value: sending[0]!, holder })
  }

  // --- 採用 -------------------------------------------------------------------------------

  const adopt = (frame: FrameOf<'osc.padDocument'>) => {
    const key = JSON.stringify([frame.name, frame.pad])
    batch(() => {
      const previous = adopted.peek()
      // 同じ内容の再採用(別の端末の同じ内容の保存など)では作り直さない(操作中の部品を壊さない)。版だけを進め、続く操作は新しい版で送る
      if (key === contentKey && previous !== null) {
        adopted.value = { ...previous, version: frame.version, revision: frame.revision, pad: previous.pad }
        return
      }
      contentKey = key
      // 差し替えたら、すべての部品の送信待ち(ホールド・間引いた値・下書き)を送らずに捨てる。残すと次の tick が古い操作の値に
      // 新しい版を付けて送り、同じ id の別の部品(アドレス・型を変えた部品)へ届く。ロックも外す(消えた部品のロックを延長し続けない)
      const discarded = values.discardAll()
      if (discarded > 0) logInfo('(INFO, SPA)', `pad changed: discarded ${String(discarded)} operation(s) without sending`)
      releaseAllLocks()
      values = new ValueStore()
      heldRowKeys.value = new Map()
      namespaceRowCache.clear()
      generation += 1
      adopted.value = { name: frame.name, version: frame.version, revision: frame.revision, pad: frame.pad, generation }
    })
  }

  const clearPad = () => {
    batch(() => {
      contentKey = ''
      values.discardAll()
      releaseAllLocks()
      values = new ValueStore()
      heldRowKeys.value = new Map()
      generation += 1
      adopted.value = null
    })
  }

  const onValues = (frame: FrameOf<'osc.padValues'>) => {
    const pad = current()
    // 描いているパッドの版の値だけを当てる(osc.padDocument の後に届く。別の版の値を同じ id の別の部品に当てない)
    if (pad === null || pad.name !== frame.name || pad.version !== frame.version) return
    batch(() => {
      const incoming = new Map<string, Values>()
      for (const item of frame.widgets) {
        const widget = findWidget(pad.pad, item.widget)
        if (widget === undefined || !isHoldingWidget(widget) || widget.kind === 'table') continue
        incoming.set(widget.id, valuesOfPadValue(item.value))
      }
      const rows = new Map(frame.full ? [] : heldRowKeys.peek())
      let rowsChanged = frame.full && heldRowKeys.peek().size > 0
      for (const item of frame.rows) {
        const widget = findWidget(pad.pad, item.widget)
        if (widget?.kind !== 'table' || !widget.columns.some((column) => column.id === item.column)) continue
        incoming.set(cellKey(widget.id, item.key, item.column), valuesOfPadValue(item.value))
        const known = rows.get(widget.id) ?? []
        if (!known.includes(item.key)) {
          rows.set(widget.id, [...known, item.key])
          rowsChanged = true
        }
      }
      if (rowsChanged) heldRowKeys.value = rows
      if (frame.full) {
        // 全量に無い部品・マスの表示は消す(採用で値が決まり直らなかった部品に古い表示を残さない)
        const keys = new Set<string>([...pad.pad.widgets.filter((widget) => isHoldingWidget(widget) && widget.kind !== 'table').map((widget) => widget.id), ...values.keys(), ...incoming.keys()])
        values.replaceAll(keys, incoming)
        return
      }
      for (const [id, next] of incoming) values.channel(id).onEcho(next)
    })
  }

  const onEcho = (frame: FrameOf<'osc.padEcho'>) => {
    const pad = current()
    if (pad === null || pad.version !== frame.version) return
    batch(() => {
      for (const item of frame.widgets) {
        const widget = findWidget(pad.pad, item.widget)
        if (item.value === undefined || widget === undefined || widget.kind === 'table' || widget.kind === 'button') continue
        values.channel(widget.id).onEcho(valuesOfPadValue(item.value))
      }
      for (const item of frame.rows) {
        const widget = findWidget(pad.pad, item.widget)
        if (item.value === undefined || widget?.kind !== 'table') continue
        values.channel(cellKey(widget.id, item.key, item.column)).onEcho(valuesOfPadValue(item.value))
      }
    })
  }

  // --- 通知 --------------------------------------------------------------------------------

  /** 断られた値は表示キャッシュに残っているので、保持値を取り直して表示をブリッジの値へ戻す */
  const restoreValues = () => {
    send({ v: WIRE_PROTOCOL_VERSION, type: 'osc.padDocumentRequest' })
  }

  const onNotice = (frame: FrameOf<'notice'>) => {
    switch (frame.code) {
      case 'pad-rejected':
        notify('error', `パッドを採用できません: ${frame.detail}`)
        break
      case 'pad-press-rejected':
        notify('error', `パッドのボタンを送れませんでした: ${frame.detail}`)
        break
      case 'pad-set-rejected':
      case 'locked':
        notify('warn', `値を送れませんでした: ${frame.detail}`)
        restoreValues()
        break
      case 'pad-action-rejected':
        notify('error', `表のアクションを送れませんでした: ${frame.detail}`)
        break
      case 'lock-rejected':
        notify('warn', `ほかのブラウザが操作中です: ${frame.detail}`)
        break
      case 'pad-synced':
      case 'pad-sync-rejected': {
        const asked = frame.requestId === undefined ? undefined : syncRequests.get(frame.requestId)
        if (frame.requestId !== undefined) syncRequests.delete(frame.requestId)
        const what = asked === undefined ? '' : `「${asked}」へ`
        if (frame.code === 'pad-synced') notify('info', `${what}同期しました: ${frame.detail}`)
        else notify('error', `${what}同期できませんでした: ${frame.detail}`)
        break
      }
      default:
        break
    }
  }

  // --- 定期の処理(間引いた値の送信・期限切れ・ロックの延長) -------------------------------

  const tick = () => {
    const at = now()
    const pad = current()?.pad
    // 入力欄のフォーカス中はホールドを延ばし続ける(キー入力が止まっても、フォーカスの間はエコーで打ちかけの文字を書き換えない)
    for (const id of editingWidgets) values.get(id)?.beginHold(at, holdTimeoutOf('input'))
    for (const id of editingCells) values.get(id)?.beginHold(at, holdTimeoutOf('input'))
    for (const [id, sending] of [...values.expireHolds(at), ...values.flushDue(at)]) {
      if (sending === null || pad === undefined) continue
      const cell = heldCells.get(id) ?? parseCellKey(id)
      if (cell !== null) {
        const table = findWidget(pad, cell.widget)
        if (table?.kind === 'table') sendCell(table, cell.key, cell.column, sending)
        continue
      }
      const widget = findWidget(pad, id)
      if (widget !== undefined) sendValue(widget, sending)
    }
    // 押したまま動かさないスライダーなど、新しい操作が来ない間もロックを延長する。期限で切れたホールドは延長をやめて外す
    for (const id of [...heldWidgets]) {
      if (values.get(id)?.holding !== true) {
        heldWidgets.delete(id)
        editingWidgets.delete(id)
        sendUnlock({ widget: id })
        continue
      }
      sendLock({ widget: id })
    }
    for (const [id, cell] of [...heldCells]) {
      if (values.get(id)?.holding !== true) {
        heldCells.delete(id)
        editingCells.delete(id)
        if (!rowHeld(cell.widget, cell.key)) sendUnlock({ widget: cell.widget, key: cell.key })
        continue
      }
      sendLock({ widget: cell.widget, key: cell.key })
    }
  }

  let ticking = true
  const loop = () => {
    if (!ticking) return
    tick()
    setTimer(loop, TICK_MS)
  }
  setTimer(loop, TICK_MS)

  // --- 行の追加・削除(UI で管理する行。文書を編集して保存する) -----------------------------

  const settleRowEdit = (frame: FrameOf<'osc.padDocumentEdited'>) => {
    if (rowEdit === null || rowEdit.requestId !== frame.requestId) return
    const asked = rowEdit
    clearTimer(asked.timer)
    rowEdit = null
    if (!frame.result.ok) {
      notify('error', `${asked.what}できませんでした: ${frame.result.detail}`)
      return
    }
    const pad = current()
    // 答えを待つ間に別の端末がパッドを切り替えた・上書きした: 編集した写しは古いパッドのものなので保存しない(上書きで消さない)
    if (pad === null || pad.version !== asked.version) {
      notify('warn', `${asked.what}の間にパッドが替わったため、保存しませんでした。もう一度操作してください`)
      return
    }
    if (!send({ v: WIRE_PROTOCOL_VERSION, type: 'osc.padSave', name: pad.name, pad: frame.result.pad as unknown as Record<string, unknown> })) notify('warn', OFFLINE_MESSAGE)
  }

  const editRows = (edit: Extract<UpstreamFrame, { type: 'osc.padDocumentEdit' }>['edit'], what: string): string | null => {
    const pad = current()
    if (pad === null) return 'パッドがありません'
    if (rowEdit !== null) return '前の行の変更を反映しています。反映してからもう一度操作してください'
    seq += 1
    const requestId = `padrow-${String(seq)}-${randomId()}`
    if (!send({ v: WIRE_PROTOCOL_VERSION, type: 'osc.padDocumentEdit', requestId, draft: pad.pad as unknown as Record<string, unknown>, edit })) return OFFLINE_MESSAGE
    const timer = setTimer(() => {
      if (rowEdit?.requestId !== requestId) return
      rowEdit = null
      notify('error', `${what}できませんでした: ブリッジの応答がありませんでした`)
    }, ROW_EDIT_TIMEOUT_MS)
    rowEdit = { requestId, version: pad.version, timer, what }
    return null
  }

  // --- 接続 --------------------------------------------------------------------------------

  const unsubscribe = [
    link.on('hello', (hello) => {
      oscAvailable.value = hello.adapters.includes('osc')
    }),
    link.on('osc.padDocument', adopt),
    link.on('osc.padList', (frame) => {
      batch(() => {
        names.value = frame.names
        listedActive.value = frame.active
        if (frame.active === null && adopted.peek() !== null) clearPad()
      })
    }),
    link.on('osc.padValues', onValues),
    link.on('osc.padEcho', onEcho),
    link.on('osc.padResend', (frame) => {
      autoResend.value = frame.auto
    }),
    link.on('osc.padDocumentEdited', settleRowEdit),
    link.on('osc.queryTargets', (frame) => {
      batch(() => {
        mdns.value = frame.mdns
        queryTargets.value = frame.targets
      })
    }),
    link.on('destinations', (frame) => {
      destinationTargets.value = frame.targets
    }),
    link.on('locks', (frame) => {
      locks.value = frame.locks
    }),
    link.on('notice', onNotice),
    link.onConnectionChange((connected) => {
      if (connected) return
      batch(() => {
        listedActive.value = undefined
        // 送信途中の状態を捨てる。つなぎ直した後の値はブリッジの osc.padValues で戻す
        values.resetSendState()
        locks.value = []
        lockSentAt.clear()
        autoResend.value = null
        // 古いターゲットを今のものとして見せない(つなぎ直すと全量が届く)
        queryTargets.value = []
        mdns.value = null
        if (rowEdit !== null) {
          clearTimer(rowEdit.timer)
          notify('error', `${rowEdit.what}できませんでした: ブリッジとの接続が切れました`)
          rowEdit = null
        }
      })
    }),
  ]

  /** 名前空間に載っているアドレス(準備のできたターゲットのパレットすべて)。ターゲットが持つ行の表の行を拾うのに使う */
  const namespaceAddresses = computed(() => queryTargets.value.flatMap((target) => target.palette.map((item) => item.address)))
  const noPad = computed(() => adopted.value === null && listedActive.value === null)

  // 名前空間から拾った行のキーは、ターゲットの一覧が変わるまで表のアドレスごとに覚える(全ターゲットの候補は 26 万件まで届きうるので、
  // マスの値が変わって表を描き直すたびに走査しない)
  const namespaceRowCache = new Map<string, { from: readonly string[]; keys: string[] }>()
  const namespaceRowKeys = (table: PadTableWidget): string[] => {
    const addresses = namespaceAddresses.value
    const cached = namespaceRowCache.get(table.address)
    if (cached !== undefined && cached.from === addresses) return cached.keys
    const keys = targetRowKeys(table, addresses)
    namespaceRowCache.set(table.address, { from: addresses, keys })
    return keys
  }
  const rowsOf = (table: PadTableWidget): TableRow[] => tableRows(
    table,
    heldRowKeys.value.get(table.id) ?? [],
    table.rows.source === 'target' ? namespaceRowKeys(table) : [],
  )

  /** 手動の同期の行き先(全宛先・今の宛先ごと・OSCQuery で見つけたターゲットごと) */
  const syncChoices = computed<SyncChoice[]>(() => {
    const choices: SyncChoice[] = [{ label: '全宛先' }]
    for (const target of destinationTargets.value) choices.push({ label: `宛先 ${target.name} (${target.host}:${String(target.sendPort)})`, target: target.name })
    for (const target of queryTargets.value) {
      if (target.oscPort === null) continue
      choices.push({ label: `${target.name ?? target.id} (${target.host}:${String(target.oscPort)})`, host: target.host, port: target.oscPort })
    }
    return choices
  })

  const offline = () => {
    notify('warn', OFFLINE_MESSAGE)
    return false
  }

  return {
    connected: link.connected,
    oscAvailable,
    adopted,
    names,
    noPad,
    locks,
    autoResend,
    mdns,
    queryTargets,
    destinationTargets,
    syncChoices,
    holder,

    dispose() {
      ticking = false
      for (const stop of unsubscribe) stop()
    },
    /** テストが時計を進めてから呼ぶ(本体は TICK_MS ごとに自分で呼ぶ)。 */
    tick,

    channelOf(widget: string) {
      return values.channel(widget)
    },
    cellChannelOf(widget: string, key: string, column: string) {
      return values.channel(cellKey(widget, key, column))
    },
    rowsOf,
    widgetLockLabel,
    rowLockLabel,

    // --- 部品の操作 -------------------------------------------------------------------
    // どれも「ほかのブラウザが操作中(locks で届いている)」なら操作させずに false を返す。画面はそのとき表示を戻す

    /** ボタンの押下。version は押した画面が描いたパッドの版(描いた後に上書き保存されていればブリッジが断る)。 */
    press(widget: PadWidget): boolean {
      const pad = current()
      if (pad === null || !isCurrentWidget(widget)) return false
      if (!send({ v: WIRE_PROTOCOL_VERSION, type: 'osc.padPress', name: pad.name, version: pad.version, button: widget.id })) return offline()
      return true
    },
    beginHold(widget: PadWidget, kind: string): boolean {
      if (widgetLockLabel(widget.id) !== null) return false
      values.channel(widget.id).beginHold(now(), holdTimeoutOf(kind))
      // 操作の開始でロックを取る。続く延長は tick が間隔ごとに送る
      if (!heldWidgets.has(widget.id)) sendLock({ widget: widget.id }, true)
      heldWidgets.add(widget.id)
      return true
    },
    endHold(widget: PadWidget): void {
      editingWidgets.delete(widget.id)
      // このタブが始めたホールドだけを終える
      if (!heldWidgets.has(widget.id)) return
      heldWidgets.delete(widget.id)
      const sending = values.channel(widget.id).endHold(now())
      if (sending !== null) sendValue(widget, sending)
      sendUnlock({ widget: widget.id })
    },
    /** 入力欄のフォーカス。フォーカスの間はホールドを延ばし続ける。 */
    setEditing(widget: PadWidget, editing: boolean): void {
      if (editing) editingWidgets.add(widget.id)
      else editingWidgets.delete(widget.id)
    },
    setDraft(widget: PadWidget, raw: string): void {
      if (heldWidgets.has(widget.id)) values.channel(widget.id).setDraft(raw)
    },
    /** 連続操作(スライダー)。間引いた分は tick が後から送る。 */
    setLocal(widget: PadWidget, next: Values): boolean {
      if (widgetLockLabel(widget.id) !== null) return false
      const sending = values.channel(widget.id).onLocal(next, now())
      if (sending !== null) sendValue(widget, sending)
      return true
    },
    /** トグル・選択・入力の確定。取りこぼすと状態が食い違うので間引かない。 */
    setDiscrete(widget: PadWidget, next: Values): boolean {
      if (widgetLockLabel(widget.id) !== null) return false
      sendValue(widget, values.channel(widget.id).onLocalImmediate(next, now()))
      return true
    },

    // --- 表のマスの操作(保護は 1 マス、ロックは行。D-169) -----------------------------------

    beginCellHold(table: PadTableWidget, key: string, column: string, kind: string): boolean {
      if (rowLockLabel(table.id, key) !== null) return false
      const id = cellKey(table.id, key, column)
      values.channel(id).beginHold(now(), holdTimeoutOf(kind))
      if (!rowHeld(table.id, key)) sendLock({ widget: table.id, key }, true)
      heldCells.set(id, { widget: table.id, key, column })
      return true
    },
    endCellHold(table: PadTableWidget, key: string, column: string): void {
      const id = cellKey(table.id, key, column)
      editingCells.delete(id)
      if (!heldCells.has(id)) return
      heldCells.delete(id)
      const sending = values.channel(id).endHold(now())
      if (sending !== null) sendCell(table, key, column, sending)
      if (!rowHeld(table.id, key)) sendUnlock({ widget: table.id, key })
    },
    setCellEditing(table: PadTableWidget, key: string, column: string, editing: boolean): void {
      const id = cellKey(table.id, key, column)
      if (editing) editingCells.add(id)
      else editingCells.delete(id)
    },
    setCellLocal(table: PadTableWidget, key: string, column: string, value: Scalar): boolean {
      if (rowLockLabel(table.id, key) !== null) return false
      const sending = values.channel(cellKey(table.id, key, column)).onLocal([value], now())
      if (sending !== null) sendCell(table, key, column, sending)
      return true
    },
    setCellDiscrete(table: PadTableWidget, key: string, column: string, value: Scalar): boolean {
      if (rowLockLabel(table.id, key) !== null) return false
      sendCell(table, key, column, values.channel(cellKey(table.id, key, column)).onLocalImmediate([value], now()))
      return true
    },
    /**
     * 欄の一括トグル(全行を同じ値にする)。行ごとの osc.padSetCell で送る(行の数は表の上限 1,000 まで)。
     * ほかのブラウザが操作中の行は送らずに数を知らせる(その行の値を黙って書き換えない)
     */
    setColumnAll(table: PadTableWidget, column: string, value: boolean): void {
      let skipped = 0
      for (const row of rowsOf(table)) {
        if (rowLockLabel(table.id, row.key) !== null) {
          skipped += 1
          continue
        }
        sendCell(table, row.key, column, values.channel(cellKey(table.id, row.key, column)).onLocalImmediate([value], now()))
      }
      if (skipped > 0) notify('warn', `ほかのブラウザが操作中の ${String(skipped)} 行は変えませんでした`)
    },
    /** 表のアクション。key は行のアクションのときの行 */
    pressAction(table: PadTableWidget, action: string, key?: string): boolean {
      const pad = current()
      if (pad === null || !isCurrentWidget(table)) return false
      if (!send({ v: WIRE_PROTOCOL_VERSION, type: 'osc.padAction', name: pad.name, version: pad.version, widget: table.id, action, ...(key === undefined ? {} : { key }) })) return offline()
      return true
    },
    /** UI で管理する行の追加(文書を編集して保存する。送れなかった理由を返す) */
    addRow(table: PadTableWidget, key: string, rowLabel: string): string | null {
      return editRows({ op: 'addRow', widget: table.id, key, label: rowLabel }, `行 ${key.trim()} を追加`)
    },
    removeRow(table: PadTableWidget, key: string): string | null {
      return editRows({ op: 'removeRow', widget: table.id, key }, `行 ${key} を削除`)
    },
    renameRow(table: PadTableWidget, key: string, rowLabel: string): string | null {
      return editRows({ op: 'setRowLabel', widget: table.id, key, label: rowLabel }, `行 ${key} の名前を変更`)
    },

    // --- 同期と再送 ---------------------------------------------------------------------

    setAutoResend(auto: boolean): boolean {
      if (!send({ v: WIRE_PROTOCOL_VERSION, type: 'osc.padResendSet', auto })) return offline()
      return true
    },
    sync(choice: SyncChoice): boolean {
      seq += 1
      const requestId = `padsync-${String(seq)}-${randomId()}`
      const sent = send({
        v: WIRE_PROTOCOL_VERSION, type: 'osc.padSync', requestId,
        ...(choice.target === undefined ? {} : { target: choice.target }),
        ...(choice.host === undefined ? {} : { host: choice.host }),
        ...(choice.port === undefined ? {} : { port: choice.port }),
      })
      if (!sent) return offline()
      syncRequests.set(requestId, choice.label)
      if (syncRequests.size > SYNC_MEMORY) syncRequests.delete(syncRequests.keys().next().value!)
      return true
    },
    refreshQuery(): boolean {
      if (!send({ v: WIRE_PROTOCOL_VERSION, type: 'osc.queryRefresh' })) return offline()
      notify('info', 'OSCQuery のターゲットを探し直しています')
      return true
    },
    /** 画面の操作の結果(送れなかった理由など)を通知の列へ出す。 */
    warn(text: string, level: 'warn' | 'error' = 'warn'): void {
      notify(level, text)
    },
  }
}

function parseCellKey(id: string): { widget: string; key: string; column: string } | null {
  const parts = id.split('\u0000')
  return parts.length === 3 ? { widget: parts[0]!, key: parts[1]!, column: parts[2]! } : null
}
