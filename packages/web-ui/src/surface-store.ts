// 主画面(サーフェスの操作画面。HID-464・D-141)の状態。共有の接続(bridge-link)が検証済みのフレームを渡し、ここは
// 採用中の定義の部品の木(surface.view。D-124)・保持値とエコーの表示キャッシュ・Unity の一覧・レコードの行・操作中のロックを
// signal に持つ。画面(surface-panel)は signal を読むだけ。
//
// NiceGUI 版の state/(surface・values・records・actions・locks)と page.py の部品の操作・ロックの延長(_renew_locks)に当たる。
// NiceGUI 版はプロセスに 1 つの状態を複数のページで共有していたので、操作者(holder)を部品ごとに付け替えて判定していた。
// SPA はタブごとに 1 本の接続と 1 つの状態を持つので、このタブの印(holder)は 1 つで、ほかのタブ・ブラウザの操作は
// ブリッジが配る locks だけで知る(D-142)。
//
// 規則の正はブリッジのまま(値の型と値域・ロック・定義の版の照合はブリッジが断る)。ここが持つのは操作の手触りだけ。

import { batch, computed, signal } from '@preact/signals'

import {
  WIRE_PROTOCOL_VERSION,
  type LockRef,
  type ParamValue,
  type SurfaceView,
  type UpstreamFrame,
  type ViewAction,
  type ViewControl,
  type ViewRecord,
} from '@oscdesk/shared'

import type { BridgeLink, FrameOf } from './bridge-link'
import type { Notices } from './notices'
import {
  ACTION_ECHO_TIMEOUT_MS,
  LOCK_RENEW_INTERVAL_MS,
  OSC_BATCH_MAX_MESSAGES,
  TICK_MS,
  ValueStore,
  defaultValues,
  holdTimeoutOf,
  holderLabel,
  jsonValue,
  matchTypes,
  newHolder,
  recordRows,
  resolveRecordActionSteps,
  rowKey,
  rowPayload,
  rowValues,
  sameValues,
  triggerValues,
  valuesFromWire,
  wireValue,
  type RecordRow,
  type Scalar,
  type Values,
} from './surface-logic'

type SurfaceFrame = FrameOf<'surface'>
type LockEntry = FrameOf<'locks'>['locks'][number]
type BatchItem = Extract<UpstreamFrame, { type: 'batch' }>['items'][number]

/** まとめ送りの照合の単位。パラメータは id、レコードの行は rowKey。 */
interface ActionBatch {
  label: string
  total: number
  deadline: number
  /** 照合の単位 → (期待する値, 要素ごとの型, 値を問わず届けば確認とするか, レコードの行ならその行) */
  waiting: Map<string, { expected: Values; types: readonly string[]; anyValue: boolean; row?: { record: string; key: string } }>
  /** 押してから削除された(別のブラウザが消した)行の数。確認の対象から外す(HID-480) */
  removed: number
  /** 送った後に対象の行が削除された。ブリッジがまとめごと断ることがあるので、時間切れまで片付けない(finishBatches) */
  removedAfterSend: boolean
}

/** 前のまとめの答えを待っている押下。押したときの値で作っておく */
interface QueuedBatch { label: string; items: BatchItem[]; waiting: ActionBatch['waiting']; removed: number }

export interface SurfaceInfo {
  name: string
  label: string
  revision: number
  parameterCount: number
}

/** 採用中の画面。content は内容が変わったときだけ差し替わる(画面はこれで作り直す)。 */
export interface SurfaceContent {
  /** 作り直しの回数。画面の key にする(同じ内容の再配信では増えない) */
  version: number
  view: SurfaceView
}

export interface RuntimeOptions {
  choices: ReadonlyMap<string, readonly string[]>
  keys: ReadonlyMap<string, readonly string[]>
  keyNames: ReadonlyMap<string, ReadonlyMap<string, string>>
  fieldChoices: ReadonlyMap<string, readonly string[]>
  arrived: ReadonlySet<string>
}

const EMPTY_RUNTIME: RuntimeOptions = { choices: new Map(), keys: new Map(), keyNames: new Map(), fieldChoices: new Map(), arrived: new Set() }

export const REFRESH_SENT_MESSAGE = 'Unity に一覧を要求しました。一覧が変わっていれば「新しい一覧があります」に出ます'
export const OFFLINE_REQUEST_MESSAGE = 'ブリッジに接続していないため要求できませんでした'

export interface SurfaceStoreDeps {
  link: BridgeLink
  notices: Notices
  now?: () => number
  setTimer?: (callback: () => void, ms: number) => unknown
  /** このタブの印。省けば作る(テストで固定する) */
  holder?: string
  /** ほかのブラウザに出す名前。省けば userAgent から作る */
  holderLabel?: string
  logInfo?: (...args: unknown[]) => void
}

export type SurfaceStore = ReturnType<typeof createSurfaceStore>

export function createSurfaceStore(deps: SurfaceStoreDeps) {
  const now = deps.now ?? (() => performance.now())
  const setTimer = deps.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms))
  const logInfo = deps.logInfo ?? console.info
  const { link } = deps
  const notify = deps.notices.notify
  const holder = deps.holder ?? newHolder()
  const label = (deps.holderLabel ?? holderLabel(typeof navigator === 'undefined' ? '' : navigator.userAgent)).slice(0, 64)

  const info = signal<SurfaceInfo | null>(null)
  const content = signal<SurfaceContent | null>(null)
  const surfaceNames = signal<readonly string[]>([])
  // この接続で受けた保存済みの一覧(surfaceList)の active。undefined はまだ受けていない。null なら、ブリッジは採用中の
  // 定義を持っておらず、surface は待っても届かない(「定義待ち」のままにせず、作り方を案内する。D-155)
  const listedActive = signal<string | null | undefined>(undefined)
  const runtime = signal<RuntimeOptions>(EMPTY_RUNTIME)
  /** 保持値を持つ行のキー(レコード id → 現れた順)。変わるたびに差し替える */
  const desiredKeys = signal<ReadonlyMap<string, readonly string[]>>(new Map())
  const locks = signal<readonly LockEntry[]>([])
  const absent = signal<ReadonlySet<string>>(new Set())

  let values = new ValueStore()
  let rowValuesStore = new ValueStore()
  let definitionKey = ''
  let entryIndex = new Map<string, ViewControl>()
  let recordIndex = new Map<string, ViewRecord>()
  // 今の画面の部品(同一性で照合する)。作り直す前の画面の部品から来た操作は送らない。同じ id が新しい定義で別のアドレスを
  // 指すことがあるため(NiceGUI 版の _current_specs と同じ。等しさでなく同一性で見るのは PR #111 の指摘)
  let currentControls = new WeakSet<ViewControl>()
  let version = 0
  let actionBatches: ActionBatch[] = []
  let queuedBatches: QueuedBatch[] = []

  // このタブが操作中の部品と行。ロックの延長と、入力欄のフォーカス中のホールドの延長に使う
  const heldParams = new Map<string, ViewControl>()
  const editingParams = new Set<string>()
  const lockSentAt = new Map<string, number>()
  const heldRows = new Map<string, { record: ViewRecord; key: string }>()
  const editingRows = new Set<string>()
  const rowLockSentAt = new Map<string, number>()
  // 行のホールド中に編集した欄(届いた行の値を映すとき、ここに入っている欄だけ手元の値を残す)
  let rowEdits = new Map<string, Set<number>>()

  const revision = () => info.peek()?.revision
  const send = (frame: UpstreamFrame) => link.send(frame)

  // --- 操作中のロック -------------------------------------------------------------------

  const lockLabelOf = (matches: (ref: LockRef) => boolean): string | null => {
    const own = link.hello.peek()?.clientId
    for (const lock of locks.value) {
      if (matches(lock.ref) && !(lock.clientId === own && lock.holder === holder)) return lock.label
    }
    return null
  }
  const paramLockLabel = (param: string) => lockLabelOf((ref) => 'param' in ref && ref.param === param)
  const rowLockLabel = (record: string, key: string) => lockLabelOf((ref) => 'record' in ref && ref.record === record && ref.key === key)

  const sendLock = (ref: LockRef, sentAt: Map<string, number>, id: string, force = false) => {
    const at = now()
    if (!force && at - (sentAt.get(id) ?? Number.NEGATIVE_INFINITY) < LOCK_RENEW_INTERVAL_MS) return
    if (send({ v: WIRE_PROTOCOL_VERSION, type: 'lock', ref, holder, label })) sentAt.set(id, at)
  }
  const sendUnlock = (ref: LockRef, sentAt: Map<string, number>, id: string) => {
    sentAt.delete(id)
    send({ v: WIRE_PROTOCOL_VERSION, type: 'unlock', ref, holder })
  }

  // --- 送信 -------------------------------------------------------------------------------

  const sendSet = (spec: ViewControl, sending: Values) => {
    // 単独で送らない定義(standalone: false)はまとめ送りの材料としてだけ送る(ここで送るとブリッジの保持の外の値が Unity にだけ届く)
    if (!spec.standalone) return
    if (!currentControls.has(spec)) {
      logInfo('(INFO, SPA)', `parameter ${spec.param} belongs to a replaced surface; not sending`)
      return
    }
    const value = wireValue(spec, sending)
    if (value === null) return
    // パラメータ id と JSON の値で送る(HID-373)。アドレスと型への直し方はブリッジが定義から決める。holder は操作したページ
    // (ロック中の部品は持ち主のページからの変更だけをブリッジが通す)、revision は描いた定義の版(違えばブリッジが断る)
    send({ v: WIRE_PROTOCOL_VERSION, type: 'set', param: spec.param, value, holder, ...(revision() === undefined ? {} : { revision: revision() }) })
  }

  const rowName = (record: ViewRecord, key: string): string | null => {
    if (record.keysSource !== 'ui') return key
    return runtime.peek().keyNames.get(record.record)?.get(key) ?? null
  }

  const sendRow = (record: ViewRecord, key: string, sending: Values) => {
    // 一覧から消えた ID の行(別の画面で消した直後など)は、Name が無いと Unity が行を名前で扱えないので送らない
    if (rowName(record, key) === null) return
    if (recordIndex.get(record.record) !== record) {
      logInfo('(INFO, SPA)', `record ${record.record} belongs to a replaced surface; not sending`)
      return
    }
    send({
      v: WIRE_PROTOCOL_VERSION, type: 'setRow', record: record.record, key, values: rowPayload(record, sending), holder,
      ...(revision() === undefined ? {} : { revision: revision() }),
    })
  }

  // --- 定義の取り込み ---------------------------------------------------------------------

  const rowsOf = (record: ViewRecord): RecordRow[] => {
    const options = runtime.value
    return recordRows(
      options.keys.get(record.record) ?? [],
      desiredKeys.value.get(record.record) ?? [],
      options.keyNames.get(record.record) ?? new Map(),
      options.arrived.has(record.keysFrom),
    )
  }

  /** 値の無い行(一覧に現れたが保持値がまだ届いていないキー)へ新しい行の値を表示用に入れる。OSC は送らない(ブリッジも同じ値で行を作る)。 */
  const seedRows = () => {
    for (const record of recordIndex.values()) {
      if (record.kind !== 'state') continue
      for (const row of rowsOf(record)) {
        const channel = rowValuesStore.channel(rowKey(record.record, row.key))
        if (channel.values === null && !channel.holding) channel.onEcho(record.initialValues)
      }
    }
  }

  /**
   * 表示から消えた行(別のブラウザが削除した UI 管理の行など)の操作中の状態を、保留値を送らずに捨ててロックを外す。
   * 入力欄は blur の前に画面から消えるので endRowHold が来ず、残すと tick が無い行のホールドとロックを延長し続ける。
   * ブリッジのロックは延長で行の存在を確かめないので自然には切れず、削除を繰り返すと接続あたりのロックの枠を使い切る(HID-475)。
   * ホールドしていない行の間引いた値(キーボードで動かしたスライダー)も捨てる。送るとブリッジが消えた行の保持値を作り直す
   */
  const releaseVanishedRows = () => {
    const shown = new Set<string>()
    for (const record of recordIndex.values()) for (const row of rowsOf(record)) shown.add(rowKey(record.record, row.key))
    const vanished = (id: string) => !shown.has(id)
    rowValuesStore.discardAll(vanished)
    for (const id of [...rowEdits.keys()]) if (vanished(id)) rowEdits.delete(id)
    for (const id of editingRows) if (vanished(id)) editingRows.delete(id)
    for (const [id, row] of heldRows) {
      if (!vanished(id)) continue
      heldRows.delete(id)
      if (rowLockSentAt.has(id)) sendUnlock({ record: row.record.record, key: row.key }, rowLockSentAt, id)
    }
    dropDeletedBatchRows()
  }

  /**
   * まとめ送りの確認の対象から、削除された UI 管理の行(ID が一覧から消えて Name が引けない行)を外す(HID-480)。
   * 残すと消えた行のエコーは来ないので、時間切れで「N 件のエコーを確認できませんでした」と出る(実際には行が消えただけ)。
   * Unity の一覧の行は外さない(宛先の切り替えなどで一覧が一時的に空になるだけで、ブリッジは名前なしでも受ける)。
   * 送ったまとめは、対象が外れても答え(エコー・拒否・時間切れ)まで送信中のまま残す。先に片付けると次の押下を送ってしまい、
   * 後から届くこのまとめの拒否(ブリッジが先に削除を処理していれば unknown-row でまとめごと断る)を次の押下に付けてしまう(PR #158)。
   * まだ送っていない押下からは送る項目も外す(ブリッジがまとめごと断るので。pressRecordAction と同じ規則)
   */
  const dropDeletedBatchRows = () => {
    const deleted = (row: { record: string; key: string } | undefined) => {
      if (row === undefined) return false
      const record = recordIndex.get(row.record)
      return record !== undefined && rowName(record, row.key) === null
    }
    const prune = (pressed: ActionBatch | QueuedBatch): Set<string> => {
      const dropped = new Set<string>()
      for (const [id, expectation] of pressed.waiting) {
        if (!deleted(expectation.row)) continue
        pressed.waiting.delete(id)
        pressed.removed += 1
        dropped.add(id)
      }
      return dropped
    }
    for (const pressed of actionBatches) if (prune(pressed).size > 0) pressed.removedAfterSend = true
    for (const queued of queuedBatches) {
      const dropped = prune(queued)
      if (dropped.size === 0) continue
      queued.items = queued.items.filter((item) => !('record' in item) || !dropped.has(rowKey(item.record, item.key)))
    }
  }

  const releaseAllLocks = () => {
    for (const [param] of heldParams) if (lockSentAt.has(param)) sendUnlock({ param }, lockSentAt, param)
    for (const [id, row] of heldRows) if (rowLockSentAt.has(id)) sendUnlock({ record: row.record.record, key: row.key }, rowLockSentAt, id)
    heldParams.clear()
    editingParams.clear()
    heldRows.clear()
    editingRows.clear()
    lockSentAt.clear()
    rowLockSentAt.clear()
  }

  const adopt = (view: SurfaceView | null) => {
    // 定義を差し替えたら、部品と行のすべてのチャンネルの送信待ち(ホールド・間引いた値・下書き)を、ホールドの有無によらず
    // 送らずに捨てる(discardAll の 1 か所で)。残すと次の tick が古い操作の値に新しい版を付けて送り、結び付けだけを変えた
    // 定義では新しいアドレスへ届く(キーボードで動かしたスライダーはホールドせずに間引いた値を持つ。PR #158)。
    // ロックも外す。残すと消えた入力欄の blur が届かないまま延長し続け、ほかのブラウザがその部品を二度と操作できなくなる
    const discarded = values.discardAll() + rowValuesStore.discardAll()
    if (discarded > 0) logInfo('(INFO, SPA)', `surface changed: discarded ${String(discarded)} operation(s) without sending`)
    releaseAllLocks()
    actionBatches = []
    queuedBatches = []
    entryIndex = new Map((view?.parameters ?? []).map((spec) => [spec.param, spec]))
    recordIndex = new Map((view?.records ?? []).map((record) => [record.record, record]))
    currentControls = new WeakSet([...(view?.parameters ?? []), ...(view?.controls ?? [])])
    // 行の表示キャッシュは捨てる(キーの一覧はレコード id で引くので残す。続く desired の全量と runtimeOptions で揃い直す)
    rowValuesStore = new ValueStore()
    rowEdits = new Map()
    desiredKeys.value = new Map()
    // 続く desired の全量が届くまでの表示として default を入れる。OSC は送らない
    for (const spec of entryIndex.values()) {
      const seeded = defaultValues(spec)
      if (seeded !== null) values.channel(spec.param).seed(seeded)
    }
    seedRows()
    version += 1
    content.value = view === null ? null : { version, view }
  }

  const onSurface = (frame: SurfaceFrame) => {
    // 結び付け(bindings)も比べる。結び付けだけを変えた定義では本体と部品の木が変わらないが、作り直さないと操作中の保持と
    // 間引いた値が残り、新しい版(revision)を付けて新しく結び付けたアドレスへ送られてしまう(PR #158。NiceGUI 版と同じ判定)
    const key = JSON.stringify([frame.name, frame.definition, frame.bindings, frame.view])
    batch(() => {
      info.value = { name: frame.name, label: frame.definition.name, revision: frame.revision, parameterCount: frame.view.parameters.length }
      // 同じ内容の再配信(ブリッジは再採用のたびに revision を増やす)では作り直さない(操作中の部品を壊さない)
      if (key === definitionKey && content.peek() !== null) return
      definitionKey = key
      adopt(frame.view)
    })
  }

  const clearSurface = () => {
    batch(() => {
      // 採用中の定義が無くなった(ブリッジの再起動後に既定の定義が無いなど)。古い部品を残すと旧アドレスへ送り続けられる
      definitionKey = ''
      info.value = null
      adopt(null)
    })
  }

  // --- 保持値・エコー --------------------------------------------------------------------

  const applyRowValues = (record: ViewRecord, key: string, next: Values) => {
    const id = rowKey(record.record, key)
    const channel = rowValuesStore.channel(id)
    channel.onEcho(next)
    if (channel.holding && channel.values !== null) {
      // 操作中の行は、この行で編集した欄だけ手元の値を残し、ほかの欄には届いた値を映す
      const edited = rowEdits.get(id) ?? new Set<number>()
      const shown = channel.values
      channel.showDuringHold(next.map((value, index) => (edited.has(index) ? shown[index]! : value)))
    }
  }

  const onDesired = (frame: FrameOf<'desired'>) => {
    batch(() => {
      const incomingRows = new Map<string, Map<string, Values>>()
      for (const row of frame.rows) {
        const record = recordIndex.get(row.record)
        // 空のキーはブリッジが保持も生成もしないので行にしない
        if (record === undefined || record.kind !== 'state' || row.key === '') continue
        const parsed = rowValues(record, row.values)
        if (parsed === null) continue
        let rows = incomingRows.get(record.record)
        if (rows === undefined) incomingRows.set(record.record, (rows = new Map()))
        rows.set(row.key, parsed)
      }
      const nextKeys = new Map(desiredKeys.peek())
      let keysChanged = false
      for (const record of recordIndex.values()) {
        if (record.kind !== 'state') continue
        const incoming = incomingRows.get(record.record) ?? new Map<string, Values>()
        let known = [...(nextKeys.get(record.record) ?? [])]
        if (frame.full) {
          // 保持値から消えたキーは行の表示値も消す(一覧にあれば次の seedRows で default に戻る)
          const dropped = known.filter((key) => !incoming.has(key))
          for (const key of dropped) rowValuesStore.get(rowKey(record.record, key))?.clear()
          if (dropped.length > 0) {
            known = known.filter((key) => incoming.has(key))
            keysChanged = true
          }
        }
        for (const [key, row] of incoming) {
          if (!known.includes(key)) {
            known.push(key)
            keysChanged = true
          }
          applyRowValues(record, key, row)
        }
        nextKeys.set(record.record, known)
      }
      if (keysChanged) {
        desiredKeys.value = nextKeys
        seedRows()
        releaseVanishedRows()
      }

      const incoming = new Map<string, Values>()
      for (const item of frame.values) {
        const spec = entryIndex.get(item.param)
        const parsed = spec === undefined ? null : valuesFromWire(spec, item.value)
        if (parsed !== null) incoming.set(item.param, parsed)
      }
      if (frame.full) {
        // standalone: false はブリッジが保持しない UI だけの値(まとめ送りの材料)なので、全量で消さない
        const stateParams = [...entryIndex.values()].filter((spec) => spec.kind === 'state' && spec.standalone).map((spec) => spec.param)
        values.replaceAll(stateParams, incoming)
        return
      }
      for (const [param, next] of incoming) values.channel(param).onEcho(next)
    })
  }

  const targetText = (target: string): string => {
    const separator = target.indexOf('\u0000')
    if (separator < 0) return entryIndex.get(target)?.label ?? target
    const recordId = target.slice(0, separator)
    const key = target.slice(separator + 1)
    const record = recordIndex.get(recordId)
    const name = record === undefined ? null : rowName(record, key)
    return `${record?.label ?? recordId} [${name ?? key}]`
  }
  const listed = (targets: readonly string[]) => targets.slice(0, 3).map(targetText).join(', ') + (targets.length > 3 ? ' ほか' : '')

  const removedNote = (removed: number) => removed > 0 ? `。削除された ${String(removed)} 行は除きました` : ''

  const finishBatches = (expiredOnly: boolean) => {
    const at = now()
    const before = actionBatches.length
    actionBatches = actionBatches.filter((pressed) => {
      const checked = pressed.total - pressed.removed
      const settled = pressed.waiting.size === 0
      // 送った後に削除された行を外したまとめ(HID-480)は、エコーで揃っても時間切れまで送信中のまま残す。ブリッジが先に削除を処理して
      // いればまとめごと断る(unknown-row)ので、ほかの操作のエコーで成功とみなして次を送ると、その拒否を次の押下に付けてしまう。
      // 対象がすべて削除されたまとめはエコーが来ないので、なおさら答え(拒否か時間切れ)を待つ
      const early = settled && checked > 0 && !pressed.removedAfterSend && !expiredOnly
      if (!early && at < pressed.deadline) return true
      if (settled && checked > 0) {
        notify('info', `「${pressed.label}」を送信しました(${String(checked)} 件を確認${removedNote(pressed.removed)})`)
      } else if (settled) {
        // 送れたかどうかは分からない(ブリッジが削除を先に処理していれば断っている。その場合は拒否が先に届いて片付く)
        notify('warn', `「${pressed.label}」: 対象の ${String(pressed.removed)} 行はエコーを確かめる前に削除されました`)
      } else {
        const missing = [...pressed.waiting.keys()]
        notify('error', `「${pressed.label}」: ${String(missing.length)} / ${String(checked)} 件のエコーを確認できませんでした (${listed(missing)})${removedNote(pressed.removed)}`)
      }
      return false
    })
    if (actionBatches.length !== before) pumpBatches()
  }

  const confirmEcho = (target: string, echoed: Values) => {
    for (const pressed of actionBatches) {
      const expectation = pressed.waiting.get(target)
      if (expectation === undefined) continue
      if (expectation.anyValue || sameValues(expectation.expected, echoed, expectation.types)) {
        pressed.waiting.delete(target)
      }
    }
    // 対象がすべて確かめられたまとめは finishBatches が片付け、次の押下を送る
    finishBatches(false)
  }

  const onEcho = (frame: FrameOf<'echo'>) => {
    batch(() => {
      for (const row of frame.rows) {
        const record = recordIndex.get(row.record)
        // 空のキーは行として扱わない。行は作らない(行はキーの一覧と保持値から来る。D-064)
        if (record === undefined || row.key === '') continue
        const parsed = rowValues(record, row.values)
        if (parsed === null) continue
        confirmEcho(rowKey(record.record, row.key), parsed)
        if (record.kind === 'state') applyRowValues(record, row.key, parsed)
      }
      for (const item of frame.values) {
        // 今の定義に無いパラメータは表示にも入れない
        const spec = entryIndex.get(item.param)
        if (spec === undefined) continue
        const echoed = valuesFromWire(spec, item.value) ?? []
        // 値の読めない応答でも、トリガーの到着の確認には使える
        confirmEcho(item.param, echoed)
        if (echoed.length > 0) values.channel(item.param).onEcho(echoed)
      }
    })
  }

  const onRuntimeOptions = (frame: FrameOf<'runtimeOptions'>) => {
    const keys = new Map((frame.keys ?? []).map((entry) => [entry.record, [...new Set(entry.keys.filter((key) => key !== ''))]] as const))
    const keyNames = new Map((frame.keys ?? []).map((entry) => [
      entry.record,
      new Map((entry.names ?? []).map((name, index) => [entry.keys[index]!, name] as const)),
    ] as const))
    const next: RuntimeOptions = {
      choices: new Map(frame.choices.map((entry) => [entry.param, entry.options])),
      keys,
      keyNames,
      fieldChoices: new Map((frame.fieldChoices ?? []).map((entry) => [rowKey(entry.record, entry.field), entry.options])),
      arrived: new Set(frame.lists.filter((list) => list.targets.length > 0).map((list) => list.list)),
    }
    // 反映待ちだけが変わったフレーム(D-088)では描き直さない
    if (JSON.stringify(serializeRuntime(next)) === JSON.stringify(serializeRuntime(runtime.peek()))) return
    batch(() => {
      runtime.value = next
      seedRows()
      releaseVanishedRows()
    })
  }

  // --- 通知 --------------------------------------------------------------------------------

  const onNotice = (frame: FrameOf<'notice'>) => {
    switch (frame.code) {
      case 'batch-rejected': {
        // ブリッジは拒否したまとめを 1 件も送らない。拒否の notice にはどのまとめかの印が無く、受け取ったときは何も返さない。
        // そこで、前のまとめの対象がすべて片付く(確認・拒否・時間切れ)まで次のまとめを送らない(pumpBatches)。送ったまとめは
        // 常に高々 1 つなので、拒否もエコーもそれに結び付く(続けて送ると、拒否やエコーを別のまとめに付けて成功・失敗を取り違え、
        // 後のまとめまで送ってしまう。PR #158)。エコー待ちは残さず理由を伝える
        const rejected = actionBatches[0]
        actionBatches = []
        notify('error', rejected === undefined ? `一括送信がブリッジに拒否されました: ${frame.detail}` : `「${rejected.label}」を送れませんでした: ${frame.detail}`)
        pumpBatches()
        break
      }
      case 'set-rejected':
      case 'row-rejected':
      case 'locked':
        // ブリッジが値の変更を断った(ロック中・型の不一致・旧画面など)。表示キャッシュには断られた値が残っているので、
        // 保持値を取り直して表示をブリッジの値へ戻す
        notify('warn', `値を送れませんでした: ${frame.detail}`)
        send({ v: WIRE_PROTOCOL_VERSION, type: 'surfaceRequest' })
        break
      case 'lock-rejected':
        notify('warn', `ほかのブラウザが操作中です: ${frame.detail}`)
        break
      case 'record-key-rejected':
        notify('error', `行を変更できません: ${frame.detail}`)
        break
      case 'runtime-options-refresh-rejected':
        notify(
          frame.detail === 'unsent-project' ? 'warn' : 'error',
          frame.detail === 'unsent-project'
            // 取り込んだプロジェクトをまだ Unity へ送っていない間は、一覧の要求も送らない(D-090)
            ? '読み込んだプロジェクトをまだ Unity へ送っていないため、一覧を要求しませんでした。「Unity へ送る」の後に要求します'
            : `一覧を取り直せません(採用中の定義に無い要求です): ${frame.detail}`,
        )
        break
      case 'spawned':
        // 生成の名前はブリッジが振る(HID-385)。消すときに使う名前なので知らせる
        notify('info', `「${frame.detail}」を生成しました`)
        break
      default:
        // 主画面に関係しない notice は、それぞれのパネルが受ける
        break
    }
  }

  // --- 定期の処理(間引いた値の送信・期限切れ・ロックの延長) -------------------------------

  const tick = () => {
    const at = now()
    finishBatches(true)
    // 入力欄のフォーカス中はホールドを延ばし続ける(キー入力が止まっても、フォーカスの間はエコーで打ちかけの文字を書き換えない)
    for (const param of editingParams) values.get(param)?.beginHold(at, holdTimeoutOf('input'))
    for (const id of editingRows) rowValuesStore.get(id)?.beginHold(at, holdTimeoutOf('input'))
    for (const [param, sending] of values.expireHolds(at)) {
      const spec = entryIndex.get(param)
      if (sending !== null && spec !== undefined) sendSet(spec, sending)
    }
    for (const [param, sending] of values.flushDue(at)) {
      const spec = entryIndex.get(param)
      if (spec !== undefined) sendSet(spec, sending)
    }
    for (const [id, sending] of [...rowValuesStore.expireHolds(at), ...rowValuesStore.flushDue(at)]) {
      if (sending === null) continue
      const separator = id.indexOf('\u0000')
      const record = recordIndex.get(id.slice(0, separator))
      if (record !== undefined) sendRow(record, id.slice(separator + 1), sending)
    }
    // 押したまま動かさないスライダーなど、新しい操作が来ない間もロックを延長する。期限で切れたホールド(pointerup が届かな
    // かったなど)は延長をやめて外す(延長し続けると、操作の終わった部品をほかのブラウザが二度と操作できなくなる)
    for (const [param] of heldParams) {
      if (values.get(param)?.holding !== true) {
        heldParams.delete(param)
        editingParams.delete(param)
        sendUnlock({ param }, lockSentAt, param)
        continue
      }
      sendLock({ param }, lockSentAt, param)
    }
    for (const [id, row] of heldRows) {
      if (rowValuesStore.get(id)?.holding !== true) {
        heldRows.delete(id)
        editingRows.delete(id)
        sendUnlock({ record: row.record.record, key: row.key }, rowLockSentAt, id)
        continue
      }
      sendLock({ record: row.record.record, key: row.key }, rowLockSentAt, id)
    }
  }

  let ticking = true
  const loop = () => {
    if (!ticking) return
    tick()
    setTimer(loop, TICK_MS)
  }
  setTimer(loop, TICK_MS)

  // --- まとめ送り ----------------------------------------------------------------------------

  const sendBatch = (labelText: string, items: BatchItem[], waiting: ActionBatch['waiting'], missing: string[]) => {
    if (missing.length > 0) notify('warn', `「${labelText}」: 値が未設定の ${String(missing.length)} 件は送りませんでした (${listed(missing)})`)
    if (items.length === 0) {
      if (missing.length === 0) notify('warn', `「${labelText}」: 送る対象がありません`)
      return
    }
    if (items.length > OSC_BATCH_MAX_MESSAGES) {
      notify('error', `「${labelText}」: ${String(items.length)} 件は一度に送れる上限を超えています`)
      return
    }
    queuedBatches.push({ label: labelText, items, waiting, removed: 0 })
    pumpBatches()
  }

  /**
   * 送ったまとめが片付いていれば(対象がすべて確認・拒否・時間切れのどれかで片付いた)、待っている押下を順に送る。
   * 片付くまで次を送らないので、送ったまとめは常に高々 1 つで、エコーと拒否はそれに結び付く(onNotice)
   */
  function pumpBatches(): void {
    while (queuedBatches.length > 0 && actionBatches.length === 0) {
      const next = queuedBatches.shift()!
      if (next.items.length === 0) {
        // 待っている間に対象の行がすべて削除された(dropDeletedBatchRows)。空のまとめは送らない
        notify('warn', `「${next.label}」: 対象の ${String(next.removed)} 行が送る前に削除されたため送りませんでした`)
        continue
      }
      transmitBatch(next.label, next.items, next.waiting, next.removed)
    }
  }

  const transmitBatch = (labelText: string, items: BatchItem[], waiting: ActionBatch['waiting'], removed: number) => {
    // 1 データグラムの大きさの上限はブリッジが通信の形にしてから判定し、超えれば batch-rejected で理由が届く
    const sent = send({ v: WIRE_PROTOCOL_VERSION, type: 'batch', items, holder, ...(revision() === undefined ? {} : { revision: revision() }) })
    if (!sent) {
      notify('error', `「${labelText}」: ブリッジに接続していないため送れませんでした`)
      return
    }
    // total は押したときの対象の数。送る前に削除された行も removed に数えて、確認の件数から引く
    actionBatches.push({ label: labelText, total: waiting.size + removed, deadline: now() + ACTION_ECHO_TIMEOUT_MS, waiting, removed, removedAfterSend: false })
  }

  const actionRowKeys = (action: Extract<ViewAction, { scope: 'row' | 'all' }>): string[] => {
    // scope "all" の対象は表示中の全行を表示順に。レコードが複数なら出現順の和集合
    const keys = new Set<string>()
    for (const step of action.steps) {
      const record = recordIndex.get(step.record)
      if (record !== undefined) for (const row of rowsOf(record)) keys.add(row.key)
    }
    return [...keys]
  }

  const pressRecordAction = (action: Extract<ViewAction, { scope: 'row' | 'all' }>, key: string | undefined) => {
    if (action.scope === 'row' && key === undefined) {
      notify('warn', `「${action.label}」: 行の指定がありません`)
      return
    }
    const keys = action.scope === 'row' ? [key!] : actionRowKeys(action)
    const targets = resolveRecordActionSteps(action, keys)
    if (targets.length > OSC_BATCH_MAX_MESSAGES) {
      notify('error', `「${action.label}」: ${String(keys.length)} 行分は一度に送れる上限(${String(OSC_BATCH_MAX_MESSAGES)} 件)を超えています`)
      return
    }
    const items: BatchItem[] = []
    const missing: string[] = []
    const waiting: ActionBatch['waiting'] = new Map()
    for (const target of targets) {
      const record = recordIndex.get(target.record)
      if (record === undefined) continue
      const id = rowKey(record.record, target.key)
      let row: Values
      if (record.kind === 'trigger') {
        row = record.fields.map((field) => jsonValue(field, field.value ?? ''))
      } else {
        const current = rowValuesStore.valuesOf(id)
        if (current === null) {
          missing.push(id)
          continue
        }
        const next = [...current]
        for (const fixed of target.fixed) next[fixed.field] = fixed.value
        row = record.fields.map((field, index) => jsonValue(field, next[index]!))
      }
      // 一覧から消えた ID の行はブリッジが Name を付けられずに断るので送らない
      if (rowName(record, target.key) === null) {
        missing.push(id)
        continue
      }
      items.push({ record: record.record, key: target.key, values: rowPayload(record, row) })
      waiting.set(id, { expected: row, types: record.fields.map((field) => field.type), anyValue: record.kind === 'trigger', row: { record: record.record, key: target.key } })
    }
    sendBatch(action.label, items, waiting, missing)
  }

  // --- 接続 --------------------------------------------------------------------------------

  const unsubscribe = [
    link.on('surface', onSurface),
    link.on('surfaceList', (frame) => {
      batch(() => {
        surfaceNames.value = frame.names
        listedActive.value = frame.active
        if (frame.active === null && content.peek() !== null) clearSurface()
      })
    }),
    link.on('desired', onDesired),
    link.on('echo', onEcho),
    link.on('runtimeOptions', onRuntimeOptions),
    link.on('locks', (frame) => {
      locks.value = frame.locks
    }),
    link.on('blueprintStatus', (frame) => {
      absent.value = new Set(frame.absent)
    }),
    link.on('notice', onNotice),
    link.onConnectionChange((connected) => {
      // 定義・保持値・一覧の要求は bridge-link が hello の後に送る(D-155)。ここは答えを受けるだけ
      if (connected) return
      batch(() => {
        // 一覧が届き直すまでは「採用中の定義が無い」と言わない(つなぎ直しの間に誤って案内を出さない)
        listedActive.value = undefined
        // 送信途中の状態を捨てる。つなぎ直した後の値はブリッジの desired で戻す
        values.resetSendState()
        rowValuesStore.resetSendState()
        // 切断中はエコーが届かないので、待ちを残して「確認できません」と誤報しない
        actionBatches = []
        // 前のまとめの答えを待っていた押下は送れなかった(黙って消さない)
        for (const queued of queuedBatches) notify('error', `「${queued.label}」: ブリッジに接続していないため送れませんでした`)
        queuedBatches = []
        // 古い一覧・ロックを今のものとして見せない(つなぎ直しで全量が届く。ロックはブリッジが切断で外している)
        runtime.value = EMPTY_RUNTIME
        // 一覧だけにあった行は表示から消える。操作中の状態を残すと、つなぎ直して行が戻ったとき(入力欄はフォーカスを失っている)
        // blur が来ないまま延長し続ける(HID-475)
        releaseVanishedRows()
        locks.value = []
        // つなぎ直したらすぐにロックを取り直せるよう、延長の間隔の記録を捨てる
        lockSentAt.clear()
        rowLockSentAt.clear()
      })
    }),
  ]

  const hasRuntimeLists = computed(() => {
    const view = content.value?.view
    if (view === undefined) return false
    return view.records.length > 0 || view.parameters.some((spec) => spec.optionsFrom !== undefined)
  })

  /** ブリッジが採用中の定義を持っていない(一覧の active が null)。画面は「定義待ち」でなく作り方を案内する。 */
  const noSurface = computed(() => content.value === null && listedActive.value === null)

  return {
    connected: link.connected,
    info,
    content,
    noSurface,
    surfaceNames,
    runtime,
    locks,
    absent,
    hasRuntimeLists,
    holder,

    dispose() {
      ticking = false
      for (const stop of unsubscribe) stop()
    },
    /** テストが時計を進めてから呼ぶ(本体は TICK_MS ごとに自分で呼ぶ)。 */
    tick,

    channelOf(param: string) {
      return values.channel(param)
    },
    rowChannelOf(record: string, key: string) {
      return rowValuesStore.channel(rowKey(record, key))
    },
    rowsOf,
    paramLockLabel,
    rowLockLabel,
    rowName,

    /** select の候補と、Unity の一覧が届いているか。届くまでは定義の固定の候補だけ。 */
    optionsFor(spec: ViewControl): { options: readonly string[]; arrived: boolean } {
      const choices = runtime.value.choices.get(spec.param)
      return choices === undefined ? { options: spec.options ?? [], arrived: false } : { options: choices, arrived: true }
    },
    /** レコードのフィールドの候補(D-056)。届いたかは lists で見る(fieldChoices は一覧が未着でも固定の候補で届くため)。 */
    fieldOptionsFor(record: string, spec: ViewControl): { options: readonly string[]; arrived: boolean } {
      const options = runtime.value
      const choices = options.fieldChoices.get(rowKey(record, spec.param))
      if (choices === undefined) return { options: spec.options ?? [], arrived: false }
      return { options: choices, arrived: spec.optionsFrom !== undefined && options.arrived.has(spec.optionsFrom) }
    },

    // --- 部品の操作 -------------------------------------------------------------------
    // どれも「ほかのブラウザが操作中(locks で届いている)」なら操作させずに false を返す。画面はそのとき表示を戻す

    beginHold(spec: ViewControl): boolean {
      if (paramLockLabel(spec.param) !== null) return false
      values.channel(spec.param).beginHold(now(), holdTimeoutOf(spec.widget))
      heldParams.set(spec.param, spec)
      // 操作の開始でロックを取る。続く延長は tick が間隔ごとに送る
      sendLock({ param: spec.param }, lockSentAt, spec.param, !lockSentAt.has(spec.param))
      return true
    },
    endHold(spec: ViewControl): void {
      editingParams.delete(spec.param)
      // このタブが始めたホールドだけを終える
      if (!heldParams.has(spec.param)) return
      heldParams.delete(spec.param)
      const sending = values.channel(spec.param).endHold(now())
      if (sending !== null) sendSet(spec, sending)
      sendUnlock({ param: spec.param }, lockSentAt, spec.param)
    },
    /** 入力欄のフォーカス。フォーカスの間はホールドを延ばし続ける。 */
    setEditing(spec: ViewControl, editing: boolean): void {
      if (editing) editingParams.add(spec.param)
      else editingParams.delete(spec.param)
    },
    setDraft(spec: ViewControl, raw: string): void {
      if (heldParams.has(spec.param)) values.channel(spec.param).setDraft(raw)
    },
    /** 連続操作(スライダー)。間引いた分は tick が後から送る。 */
    setLocal(spec: ViewControl, next: Values): boolean {
      if (paramLockLabel(spec.param) !== null) return false
      const channel = values.channel(spec.param)
      if (!spec.standalone) {
        // 送らない値にはエコーが返らない。離したときに編集前の値へ戻らないよう、その場で確定する
        channel.onLocalImmediate(next, now())
        return true
      }
      const sending = channel.onLocal(next, now())
      if (sending !== null) sendSet(spec, sending)
      return true
    },
    /** トグル・選択・入力の確定。取りこぼすと状態が食い違うので間引かない。 */
    setDiscrete(spec: ViewControl, next: Values): boolean {
      if (paramLockLabel(spec.param) !== null) return false
      sendSet(spec, values.channel(spec.param).onLocalImmediate(next, now()))
      return true
    },
    /** トリガーの押下。定義の value を 1 回だけ送る(値は保持・表示しない。D-043)。 */
    pressTrigger(spec: ViewControl): boolean {
      if (paramLockLabel(spec.param) !== null) return false
      sendSet(spec, triggerValues(spec))
      return true
    },

    /**
     * アクション(HID-166)の押下。対象の値を定義の順に並べ、1 つのまとめ送り(batch)で送る。state は表示中の値、trigger は
     * 定義の value、step の固定値があればそれ。値がまだ無い state は外して知らせる(黙って欠けると Unity が半端な状態になる)。
     * 送った後はエコーが揃うまで待ち、揃わなければ知らせる(送り直しはしない)
     */
    pressAction(action: ViewAction, key?: string): void {
      if ('scope' in action) {
        pressRecordAction(action, key)
        return
      }
      if (action.truncated === true) {
        // 上限超はブリッジが truncated で明示する(件数で推し量ると上限の値を揃え続ける必要がある。D-128)
        notify('error', `「${action.label}」: 一度に送れる上限(${String(OSC_BATCH_MAX_MESSAGES)} 件)を超えています`)
        return
      }
      const items: BatchItem[] = []
      const missing: string[] = []
      const waiting: ActionBatch['waiting'] = new Map()
      for (const target of action.targets) {
        const spec = entryIndex.get(target.param)
        if (spec === undefined) continue
        if (spec.kind === 'trigger') {
          // trigger は値を省き、ブリッジが定義の value を送る(エコーは値を問わず到着で確かめる)
          items.push({ param: spec.param })
          waiting.set(spec.param, { expected: [], types: [], anyValue: true })
          continue
        }
        let value: ParamValue | null
        let expected: Values
        if (target.fixed !== undefined) {
          const fixed: Scalar = jsonValue(spec, target.fixed)
          value = fixed
          expected = [fixed]
        } else {
          const current = values.valuesOf(spec.param)
          value = current === null || current.length === 0 ? null : wireValue(spec, current)
          if (value === null || current === null) {
            missing.push(spec.param)
            continue
          }
          // エコーと突き合わせるのは表示キャッシュの組(組み合わせの型はフィールドの値の組)
          expected = spec.type === 'composite' ? current : [value as Scalar]
        }
        items.push({ param: spec.param, value })
        waiting.set(spec.param, { expected, types: matchTypes(spec), anyValue: false })
      }
      sendBatch(action.label, items, waiting, missing)
    },

    // --- レコードの行の操作 -------------------------------------------------------------

    /** 行のどれかの欄の操作の開始。保護とロックは行単位(1 行 = 1 メッセージ。D-111)。 */
    beginRowHold(record: ViewRecord, key: string, widget: string): boolean {
      if (rowLockLabel(record.record, key) !== null) return false
      const id = rowKey(record.record, key)
      const channel = rowValuesStore.channel(id)
      // 新しいホールドでは、前のホールドで編集した欄の記録を持ち越さない
      if (!channel.holding) rowEdits.delete(id)
      channel.beginHold(now(), holdTimeoutOf(widget))
      heldRows.set(id, { record, key })
      sendLock({ record: record.record, key }, rowLockSentAt, id, !rowLockSentAt.has(id))
      return true
    },
    endRowHold(record: ViewRecord, key: string): void {
      const id = rowKey(record.record, key)
      editingRows.delete(id)
      if (!heldRows.has(id)) return
      heldRows.delete(id)
      const sending = rowValuesStore.channel(id).endHold(now())
      if (sending !== null) sendRow(record, key, sending)
      sendUnlock({ record: record.record, key }, rowLockSentAt, id)
    },
    setRowEditing(record: ViewRecord, key: string, editing: boolean): void {
      const id = rowKey(record.record, key)
      if (editing) editingRows.add(id)
      else editingRows.delete(id)
    },
    /** 欄の編集。行の全フィールド(ほかは表示中の値)を 1 メッセージで送る(D-061)。discrete は間引かない操作。 */
    setRowField(record: ViewRecord, key: string, index: number, value: Scalar, discrete: boolean): boolean {
      if (rowLockLabel(record.record, key) !== null) return false
      const id = rowKey(record.record, key)
      const channel = rowValuesStore.channel(id)
      if (channel.holding) {
        let edited = rowEdits.get(id)
        if (edited === undefined) rowEdits.set(id, (edited = new Set()))
        edited.add(index)
      } else {
        rowEdits.delete(id)
      }
      const next = [...(channel.values ?? record.initialValues)]
      next[index] = value
      if (discrete) {
        sendRow(record, key, channel.onLocalImmediate(next, now()))
        return true
      }
      const sending = channel.onLocal(next, now())
      if (sending !== null) sendRow(record, key, sending)
      return true
    },
    /** trigger のレコードの行の送信。行のキーと各フィールドの value を 1 回だけ送る。 */
    pressRowTrigger(record: ViewRecord, key: string): boolean {
      if (rowLockLabel(record.record, key) !== null) return false
      sendRow(record, key, record.fields.map((field) => jsonValue(field, field.value ?? '')))
      return true
    },

    /** 上限(UI で管理するキーの max)に達しているか(D-075)。 */
    rowLimitReached(record: ViewRecord): boolean {
      return record.keysMax !== undefined && rowsOf(record).length >= record.keysMax
    },
    /** 通常の画面からの行の追加(D-075)。送れなかった理由を返す。行はブリッジが作って配るので、ここでは作らない。 */
    addRow(record: ViewRecord, text: string): string | null {
      // 前後の空白は打ち間違いとみなして落とす(見た目で区別できないキーを作らないため)
      const name = text.trim()
      if (name === '') return '名前を入力してください'
      if (rowsOf(record).some((row) => row.name === name)) return `「${name}」は既にあります`
      if (record.keysMax !== undefined && rowsOf(record).length >= record.keysMax) return `上限の ${String(record.keysMax)} 件に達しています`
      if (!send({ v: WIRE_PROTOCOL_VERSION, type: 'recordKeyAdd', record: record.record, key: name })) return 'ブリッジに未接続のため追加できません'
      return null
    },
    /** 行の削除(D-075)。同じキーの集合を共有する全レコードの行の保持値が消える。 */
    removeRow(record: ViewRecord, key: string): string | null {
      if (!send({ v: WIRE_PROTOCOL_VERSION, type: 'recordKeyRemove', record: record.record, key })) return 'ブリッジに未接続のため削除できません'
      return null
    },
    /** UI で管理する行の Name の変更(D-087)。行は ID で指すので値は付け替えない。Name の表示はブリッジの runtimeOptions で揃う。 */
    renameRow(record: ViewRecord, key: string, text: string): string | null {
      if (record.keysSource !== 'ui') return 'この表の行の名前は変更できません'
      const name = text.trim()
      if (name === '') return '名前を入力してください'
      if (rowName(record, key) === name) return null
      if (rowsOf(record).some((row) => row.name === name && row.key !== key)) return `「${name}」は既にあります`
      if (!send({ v: WIRE_PROTOCOL_VERSION, type: 'recordKeyRename', record: record.record, key, name })) return 'ブリッジに未接続のため名前を変更できません'
      return null
    },

    /** 画面の操作の結果(送れなかった理由など)を通知の列へ出す。 */
    warn(text: string, level: 'warn' | 'error' = 'warn'): void {
      notify(level, text)
    },

    // --- 要求 ----------------------------------------------------------------------------

    /** 定義・保持値・一覧を取り直す(「再取得」)。 */
    requestSurface(): void {
      if (!send({ v: WIRE_PROTOCOL_VERSION, type: 'surfaceRequest' })) notify('warn', OFFLINE_REQUEST_MESSAGE)
    },
    /** 「一覧を更新」(全一覧)と、一覧の近くの Sync(その一覧だけ。D-077)。 */
    requestLists(list?: string): void {
      const sent = send({ v: WIRE_PROTOCOL_VERSION, type: 'runtimeOptionsRefresh', ...(list === undefined ? {} : { list }) })
      if (sent) notify('info', REFRESH_SENT_MESSAGE)
      else notify('warn', OFFLINE_REQUEST_MESSAGE)
    },
  }
}

function serializeRuntime(options: RuntimeOptions): unknown {
  return [
    [...options.choices],
    [...options.keys],
    [...options.keyNames].map(([record, names]) => [record, [...names]]),
    [...options.fieldChoices],
    [...options.arrived].sort(),
  ]
}
