// パッドの主画面(D-170)の編集の状態。版 1 の OSC パッドのタブ(osc-pad-store。D-126・D-147)と同じ考えで、版 2 の文書を編集する。
//
// - 採用中のパッドは pad-store の表示キャッシュ(osc.padDocument)。編集は UI が作業コピーを持ち、「何をしたいか」を編集命令
//   (osc.padDocumentEdit)として作業コピーと一緒に送り、ブリッジが規則を当てて検証に通した答え(osc.padDocumentEdited)を
//   新しい作業コピーにする。答えを待つ命令は 1 つだけで、その間の構造を変える命令は断る(描いた時点の位置で指す命令を
//   古い作業コピーへ当てないため。D-123)。入力欄の命令は欄ごとに最後の 1 つだけ預かって、答えの後に送る
// - 保存・切り替えの結果は osc.padDocument で戻る(UI は保存成功を自分で確定しない)。頼んだ保存・切り替えに当たる採用が届いたときだけ
//   保存済み・破棄済みにする。答えを待つ間に届いた採用だけを列に残し、答えの後に順に照合する
// - OSCQuery のパレットの候補は addWidgetFromNode で置く(部品の決め方はブリッジと shared の padWidgetFromNode。D-171)
import { batch, computed, signal } from '@preact/signals'

import {
  PAD_DOCUMENT,
  WIRE_PROTOCOL_VERSION,
  isValidSurfaceName,
  paletteNodeInfo,
  type PadDocument,
  type PadDocumentEdit,
  type PadWidgetKind,
  type PaletteItem,
} from '@oscdesk/shared'

import type { BridgeLink, FrameOf } from './bridge-link'
import type { Notices } from './notices'
import { base64Of } from './osc-pad-logic'
import { BUSY_MESSAGE, DEFAULT_SAVE_NAME, EDIT_TIMEOUT_MS, cellName, fieldKey, findWidget, firstEmptyCell, newPadDocument, occupancy, sameDocument, widgetSettings } from './pad-logic'
import type { AdoptedPad, PadStore } from './pad-store'

export interface EditSession { draft: PadDocument; baseVersion: string; baseName: string | null; dirty: boolean }
export interface Confirm { message: string; okLabel: string; onOk: () => void; onCancel?: () => void }
export interface Clipboard { settings: Record<string, unknown>; label: string }
/** 編集中に選んだもの。部品か、部品を置く空きマス */
export type Selection = { widget: string } | { cell: { row: number; column: number } } | null

/** 断られて作業コピーに入っていない打った文字を、選び直し・構造の変更で破棄する前に確かめる文言(HID-503) */
export const DISCARD_INPUT_MESSAGE = '反映されていない入力があります(欄の下に理由が出ています)。破棄して続けますか?'

interface EditItem { edit: PadDocumentEdit; onOk?: () => void; onError?: (detail: string) => void }
interface PendingRequest { name: string; version: string; pad: PadDocument }

export interface PadEditStoreDeps {
  link: BridgeLink
  notices: Notices
  pad: PadStore
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  /** 編集命令の印(requestId)の乱数部分。テストで固定する。 */
  randomId?: () => string
}

export type PadEditStore = ReturnType<typeof createPadEditStore>
export function createPadEditStore(deps: PadEditStoreDeps) {
  const { link } = deps
  const setTimer = deps.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms))
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const randomId = deps.randomId ?? (() => Math.random().toString(16).slice(2, 14))
  const notify = deps.notices.notify
  const adopted = deps.pad.adopted

  const session = signal<EditSession | null>(null)
  const selection = signal<Selection>(null)
  const clipboard = signal<Clipboard | null>(null)
  const saveName = signal('')
  const confirm = signal<Confirm | null>(null)
  // 応答待ち・預かった入力あり・画像の読み込み中のどれか
  const busy = signal(false)
  // 入力欄も受けない間(構造の命令の答えを待つ間・画像の読み込み中)。画面は入力欄を読み取り専用にする
  const formLocked = signal(false)
  // Inspector の欄を作業コピーから作り直すときだけ進める(画面は欄の key に使う。入力欄の命令では進めない)
  const formRevision = signal(0)
  const fieldErrors = signal<ReadonlyMap<string, string>>(new Map())
  // 欄に打った文字(断られて作業コピーに入っていない文字を含む)。Inspector が作り直されても打った文字で欄を出す(D-161)
  const fieldTexts = signal<ReadonlyMap<string, string>>(new Map())

  let pending: { requestId: string; timer: unknown; item: EditItem } | null = null
  const queued = new Map<string, EditItem>()
  let editSeq = 0
  let reading = 0
  // 作業コピーの世代。答え以外で作業コピーを置き換えたときに進める。画像の読み込みは始めたときの世代を持ち、替わっていれば捨てる
  let generation = 0
  let waitingAdoptions: AdoptedPad[] = []
  // errors と texts は要求した時点の未反映の入力(断られた打った文字)。破棄を確かめた入力なので、採用が届いたときに同じままなら解除する
  let pendingLoad: { name: string; version: string; draft: PadDocument; errors: ReadonlyMap<string, string>; texts: ReadonlyMap<string, string> } | null = null
  let pendingSave: PendingRequest | null = null

  const draft = computed<PadDocument | null>(() => session.value?.draft ?? null)
  // 未保存の変更があるか。作業コピーの変更(dirty)に加えて、断られて作業コピーに入っていない打った文字(欄の下に理由が出ている)も数える。
  // 数えないと、未変更のパッドで断られた入力が、別の端末の保存への追従(follow の refreshForm)で確かめずに消える(PR #177 のレビュー)
  const unsaved = computed(() => session.value !== null && (session.value.dirty || fieldErrors.value.size > 0))
  const conflicted = computed(() => {
    const editing = session.value
    return editing !== null && unsaved.value && editing.baseVersion !== (adopted.value?.version ?? '')
  })
  const selectedWidget = computed(() => {
    const pad = session.value?.draft
    const picked = selection.value
    return pad === undefined || picked === null || !('widget' in picked) ? undefined : findWidget(pad, picked.widget)
  })

  const refreshForm = () => {
    batch(() => {
      formRevision.value += 1
      fieldErrors.value = new Map()
      fieldTexts.value = new Map()
    })
  }
  const setFieldText = (key: string, text: string) => {
    const next = new Map(fieldTexts.value)
    next.set(key, text)
    fieldTexts.value = next
  }
  const setFieldError = (key: string, error: string | null) => {
    const next = new Map(fieldErrors.value)
    if (error === null) next.delete(key)
    else next.set(key, error)
    fieldErrors.value = next
  }
  const updateSession = (patch: Partial<EditSession>) => {
    const editing = session.value
    if (editing !== null) session.value = { ...editing, ...patch }
  }

  // --- 編集命令の送受信 -------------------------------------------------------

  const dispatch = (item: EditItem) => {
    const editing = session.value
    if (editing === null) return
    editSeq += 1
    const requestId = `padedit-${String(editSeq)}-${randomId()}`
    if (!link.send({ v: WIRE_PROTOCOL_VERSION, type: 'osc.padDocumentEdit', requestId, draft: editing.draft as unknown as Record<string, unknown>, edit: item.edit })) {
      item.onError?.('ブリッジに接続していないため変更できません')
      return
    }
    const timer = setTimer(() => settle(requestId, { ok: false, detail: 'ブリッジの応答がありませんでした' }), EDIT_TIMEOUT_MS)
    pending = { requestId, timer, item }
  }

  const settle = (requestId: string, result: FrameOf<'osc.padDocumentEdited'>['result']) => {
    if (pending === null || pending.requestId !== requestId) return
    const { item, timer } = pending
    clearTimer(timer)
    pending = null
    batch(() => {
      if (result.ok) {
        const editing = session.value
        if (editing !== null && !sameDocument(result.pad, editing.draft)) updateSession({ draft: result.pad, dirty: true })
        item.onOk?.()
      } else {
        item.onError?.(result.detail)
      }
      // 預かった命令を順に送る。送れなかった命令は理由を知らせて捨て、次へ進む(1 つで止めると busy のまま残る)
      while (queued.size > 0 && pending === null) {
        const [key, next] = queued.entries().next().value as [string, EditItem]
        queued.delete(key)
        dispatch(next)
      }
      updateBusy()
    })
  }

  // 答えを待つ命令・預かった入力・読み込み中の画像のどれかがある間(busy)は、作業コピーを読む操作も変える操作も理由を出して断る。
  // 受けるのは入力欄の命令だけで、欄ごとに最後の 1 つを預かる(D-147 と同じ 1 つの規則)
  const updateBusy = () => {
    const next = pending !== null || queued.size > 0 || reading > 0
    batch(() => {
      formLocked.value = reading > 0 || (pending !== null && fieldKey(pending.item.edit) === null)
      busy.value = next
    })
    if (!next) reconcile()
  }

  const idle = (): boolean => {
    if (!busy.value) return true
    notify('warn', BUSY_MESSAGE)
    return false
  }

  const dropEdits = () => {
    if (pending !== null) clearTimer(pending.timer)
    pending = null
    queued.clear()
    generation += 1
    batch(() => {
      formLocked.value = reading > 0
      busy.value = reading > 0
    })
  }

  const submit = (item: EditItem): boolean => {
    if (session.value === null) return false
    if (pending !== null || reading > 0) {
      const key = fieldKey(item.edit)
      if (key === null || formLocked.value) return false
      queued.delete(key)
      queued.set(key, item)
      updateBusy()
      return true
    }
    dispatch(item)
    updateBusy()
    return true
  }

  /**
   * 構造を変える命令。busy なら理由を出して断る。答えが来たら欄を作業コピーから作り直し、断られたら理由を知らせる。
   * 欄を作り直すと断られた打った文字(欄の下に理由が出ている)が消えるので、その文字があれば破棄してよいかを先に確かめる(HID-503)
   */
  const edit = (command: PadDocumentEdit, onOk?: () => void) => {
    if (session.value === null || !idle()) return
    const run = () => {
      submit({
        edit: command,
        onOk: () => {
          refreshForm()
          onOk?.()
        },
        onError: (detail) => notify('error', detail),
      })
    }
    if (fieldErrors.value.size > 0) {
      const started = generation
      ask(DISCARD_INPUT_MESSAGE, '破棄する', () => {
        // 確かめている間に作業コピーが置き換わった・答えを待ち始めたなら、古い作業コピーの位置で指す命令を送らない
        if (session.value === null || started !== generation || !idle()) return
        run()
      })
      return
    }
    run()
  }

  /** 入力欄の命令。打つたびに届くので通知は出さず、断られた理由は欄の下に出す。 */
  const editField = (command: PadDocumentEdit, showError = true) => {
    if (session.value === null) return
    const key = fieldKey(command) ?? command.op
    // 答えを待つ間に欄を作り直した(選び直した・閉じた)なら、その欄はもう無いので理由を出さない。出すと見えない理由で unsaved のまま残り、
    // 他の端末の保存へ追従せず、編集を終えるときに見えない変更の破棄を確かめることになる
    const revision = formRevision.peek()
    const show = (error: string | null) => {
      if (showError && formRevision.peek() === revision) setFieldError(key, error)
    }
    if (!submit({ edit: command, onOk: () => show(null), onError: show })) show(BUSY_MESSAGE)
  }

  // --- 採用の照合 -----------------------------------------------------------------

  const reconcile = (arrived?: AdoptedPad) => {
    if (arrived !== undefined && session.value !== null) waitingAdoptions.push(arrived)
    if (busy.value) return
    const adoptions = waitingAdoptions
    waitingAdoptions = []
    const editing = session.value
    if (editing === null) return
    batch(() => {
      for (const [index, adoption] of adoptions.entries()) {
        const load = pendingLoad
        // 要求した切り替えが採用されたら、破棄を確認済みの下書きを捨てて追従させる。要求の後に編集していたら、その編集は
        // 確認を取っていないので捨てず、未保存のまま残して知らせる
        if (load !== null && adoption.name === load.name && adoption.version !== load.version) {
          pendingLoad = null
          // 要求の後に入力が増えて断られていれば(errors・texts が替わっていれば)、その入力は確認を取っていないので残す
          if (sameDocument(session.value?.draft, load.draft) && fieldErrors.value === load.errors && fieldTexts.value === load.texts) {
            updateSession({ dirty: false })
            // 破棄を確かめた未反映の入力も捨てる(残すと unsaved のままで、新しいパッドへ追従しない。PR #177 のレビュー)
            fieldErrors.value = new Map()
            fieldTexts.value = new Map()
            pendingSave = null
          } else {
            notify('warn', `${adoption.name} に切り替わりましたが、切り替えを頼んだ後の編集があるので下書きを残しました(保存するか、編集を終えて破棄してください)`)
          }
        }
        const saving = pendingSave
        if (saving !== null && adoption.name === saving.name && adoption.version !== saving.version && sameDocument(adoption.pad, saving.pad)) {
          pendingSave = null
          const stillEdited = !sameDocument(session.value?.draft, adoption.pad)
          updateSession({ baseVersion: adoption.version, baseName: adoption.name, dirty: stillEdited })
          saveName.value = adoption.name
          // 自分の保存の採用が最後なら追従しない(保存した作業コピーのまま続けて編集できる)
          if (index === adoptions.length - 1) return
        }
      }
      follow()
    })
  }

  /** 未編集で答えを待っていなければ、他の端末の保存・切り替えへ作業コピーを追従させる。 */
  const follow = () => {
    const editing = session.value
    if (editing === null || unsaved.value || busy.value) return
    const latest = adopted.value
    const next = latest?.pad ?? newPadDocument()
    if (sameDocument(next, editing.draft) && editing.baseVersion === (latest?.version ?? '') && editing.baseName === (latest?.name ?? null)) return
    generation += 1
    session.value = { draft: next, baseVersion: latest?.version ?? '', baseName: latest?.name ?? null, dirty: false }
    if (latest !== null) saveName.value = latest.name
    const picked = selection.value
    if (picked !== null && 'widget' in picked && findWidget(next, picked.widget) === undefined) selection.value = null
    refreshForm()
  }

  // 採用(版が変わったとき)ごとに照合する。同じ版の再描画では照合しない
  let lastVersion: string | null = null
  const stopWatching = adopted.subscribe((value) => {
    const version = value?.version ?? null
    if (version === lastVersion) return
    lastVersion = version
    if (value === null) reconcile()
    else reconcile(value)
  })

  const unsubscribe = [
    link.on('osc.padDocumentEdited', (frame) => settle(frame.requestId, frame.result)),
    link.onConnectionChange((connected) => {
      if (connected || pending === null) return
      // 切れたら答えは届かない。待っている命令を「切れた」で終える
      settle(pending.requestId, { ok: false, detail: 'ブリッジとの接続が切れました' })
    }),
  ]

  // --- 編集の出入り -----------------------------------------------------

  const openEdit = () => {
    const latest = adopted.value
    generation += 1
    batch(() => {
      session.value = { draft: latest?.pad ?? newPadDocument(), baseVersion: latest?.version ?? '', baseName: latest?.name ?? null, dirty: false }
      saveName.value = latest?.name ?? DEFAULT_SAVE_NAME
      selection.value = null
      waitingAdoptions = []
      refreshForm()
    })
  }

  const closeEdit = () => {
    dropEdits()
    batch(() => {
      pendingLoad = null
      pendingSave = null
      waitingAdoptions = []
      session.value = null
      selection.value = null
      clipboard.value = null
      refreshForm()
    })
  }

  const ask = (message: string, okLabel: string, onOk: () => void, onCancel?: () => void) => {
    confirm.value = { message, okLabel, onOk, onCancel }
  }
  const disconnected = (what: string) => notify('error', `ブリッジに接続していないため${what}`)

  /** 部品を足したマスの部品を選ぶ(id はブリッジが振るので、答えの作業コピーのそのマスの部品を引く) */
  const selectAt = (row: number, column: number) => {
    const pad = session.value?.draft
    const added = pad === undefined ? undefined : occupancy(pad).get(cellName(row, column))
    selection.value = added === undefined ? null : { widget: added.id }
  }

  return {
    connected: link.connected,
    session,
    draft,
    unsaved,
    conflicted,
    selection,
    selectedWidget,
    clipboard,
    saveName,
    confirm,
    busy,
    formLocked,
    formRevision,
    fieldErrors,
    fieldTexts,
    setFieldText,

    dispose() {
      dropEdits()
      stopWatching()
      for (const stop of unsubscribe) stop()
    },

    setEditing(on: boolean) {
      if (on === (session.value !== null)) return
      if (on) {
        openEdit()
        return
      }
      // 答えを待つ変更はまだ dirty に出ていないので、busy の間は閉じない(待っている変更を黙って捨てない)
      if (!idle()) return
      if (unsaved.value) {
        ask('保存していない変更があります。破棄して編集を終えますか?', '破棄する', closeEdit)
        return
      }
      closeEdit()
    },
    answerConfirm(ok: boolean) {
      const asked = confirm.value
      confirm.value = null
      if (asked === null) return
      if (ok) asked.onOk()
      else asked.onCancel?.()
    },
    /**
     * 部品か空きマスを選ぶ(null で閉じる)。選び直すと Inspector を作業コピーから描くので、未反映の入力がある間は選ばない。
     * 断られて作業コピーに入っていない打った文字(欄の下に理由が出ている)があれば、破棄してよいかを確かめてから選び直す。
     * 確かめずに選び直すと、refreshForm がその文字と理由を黙って消す(HID-503。PR #177 のレビュー)
     */
    select(next: Selection) {
      const now = selection.value
      if (JSON.stringify(now) === JSON.stringify(next)) return
      if (next !== null && !idle()) return
      const apply = () => {
        batch(() => {
          selection.value = next
          refreshForm()
        })
      }
      if (fieldErrors.value.size > 0) {
        ask(DISCARD_INPUT_MESSAGE, '破棄する', () => {
          // 確かめている間に編集を終えた・選び直した・答えを待ち始めたなら、古い選び直しを当てない
          if (session.value === null || JSON.stringify(selection.value) !== JSON.stringify(now)) return
          if (next !== null && !idle()) return
          apply()
        })
        return
      }
      apply()
    },
    edit,
    editField,

    /** 空きマスに部品を足して選ぶ */
    add(kind: PadWidgetKind, row: number, column: number) {
      edit({ op: 'addWidget', kind, row, column }, () => selectAt(row, column))
    },
    /**
     * パレットの候補を置く。cell を省くと選んでいる空きマス、無ければ左上から最初の空きマス。
     * 部品の種類と送り直すかの既定はブリッジが padWidgetFromNode で決める(D-171。置いた後に Inspector で変えられる)
     */
    place(item: PaletteItem, cell?: { row: number; column: number }) {
      const pad = session.value?.draft
      if (pad === undefined) {
        notify('warn', 'パッドの編集を始めてから置いてください')
        return
      }
      const picked = selection.value
      const at = cell ?? (picked !== null && 'cell' in picked ? picked.cell : firstEmptyCell(pad))
      if (at === null) {
        notify('warn', '空きマスがありません。格子を広げてから置いてください')
        return
      }
      edit({ op: 'addWidgetFromNode', row: at.row, column: at.column, node: paletteNodeInfo(item) }, () => selectAt(at.row, at.column))
    },
    remove(widget: string) {
      edit({ op: 'removeWidget', widget }, () => {
        selection.value = null
      })
    },
    copy(widget: string) {
      // 答えを待つ前の作業コピーを写すと、貼り付けで変更前のアドレスなどが保存・送信される
      if (!idle()) return
      const found = session.value === null ? undefined : findWidget(session.value.draft, widget)
      if (found !== undefined) clipboard.value = { settings: widgetSettings(found), label: found.label || widget }
    },
    paste(widget: string) {
      const clip = clipboard.value
      if (clip !== null) edit({ op: 'pasteSettings', widget, settings: clip.settings })
    },
    /** 背景色。色を選んでいる間の入力は欄ごとに最後の 1 つだけが送られる。null で既定の色に戻す。 */
    setColor(widget: string, color: string | null) {
      if (color === null) edit({ op: 'setColor', widget, color: null })
      else editField({ op: 'setColor', widget, color }, false)
    },
    /** 画像。バイト列をそのまま送る(種類と大きさの判定と data URL への変換はブリッジ。D-126)。ここは大きすぎるファイルを読む前に止めるだけ。 */
    async setImage(widget: string, file: Blob | null) {
      if (file === null) {
        edit({ op: 'setImage', widget, data: null })
        return
      }
      if (file.size > PAD_DOCUMENT.MAX_IMAGE_BYTES) {
        notify('error', `画像は ${String(PAD_DOCUMENT.MAX_IMAGE_BYTES / 1024)} KiB までです`)
        return
      }
      if (!idle()) return
      const started = generation
      reading += 1
      updateBusy()
      let data: string
      try {
        data = base64Of(new Uint8Array(await file.arrayBuffer()))
      } finally {
        reading -= 1
        updateBusy()
      }
      const editing = session.value
      if (started !== generation || editing === null || findWidget(editing.draft, widget) === undefined) {
        notify('warn', '画像を読み込む間に編集中のパッドが替わったため、画像を付けませんでした')
        return
      }
      edit({ op: 'setImage', widget, data })
    },
    resize(rows: number, columns: number) {
      edit({ op: 'resize', rows, columns })
    },
    setSaveName(name: string) {
      saveName.value = name
    },
    startNew() {
      if (!idle()) return
      const start = () => {
        dropEdits()
        batch(() => {
          pendingLoad = null
          pendingSave = null
          updateSession({ draft: newPadDocument(), dirty: true })
          saveName.value = ''
          selection.value = null
          refreshForm()
        })
      }
      if (unsaved.value) {
        ask('保存していない変更があります。破棄して新しいパッドを作りますか?', '破棄する', start)
        return
      }
      start()
    },
    load(name: string) {
      if (name === '') {
        notify('warn', '切り替えるパッドを選んでください')
        return
      }
      if (!idle()) return
      const run = () => {
        const editing = session.value
        if (busy.value) {
          notify('warn', BUSY_MESSAGE)
          return
        }
        if (!link.send({ v: WIRE_PROTOCOL_VERSION, type: 'osc.padLoad', name })) {
          disconnected('切り替えられません')
          return
        }
        // 下書きはここでは捨てない。要求したパッドが採用されて届いたときに照合して追従させる
        if (editing !== null) pendingLoad = { name, version: adopted.value?.version ?? '', draft: editing.draft, errors: fieldErrors.value, texts: fieldTexts.value }
        notify('info', `${name} への切り替えを要求しました`)
      }
      if (unsaved.value) {
        ask('保存していない変更があります。破棄して切り替えますか?', '破棄する', run)
        return
      }
      run()
    },
    save() {
      const editing = session.value
      if (editing === null) return
      const name = saveName.value.trim()
      if (!isValidSurfaceName(name)) {
        notify('error', '保存名は英数字で始まる英数字・_・- の 1〜64 文字にしてください')
        return
      }
      if (!idle()) return
      saveName.value = name
      const run = (confirmed: boolean) => {
        if (busy.value) {
          notify('warn', '前の変更を反映しています。反映してから保存してください')
          return
        }
        const current = session.value?.draft
        if (current === undefined) return
        const base = session.value?.baseVersion ?? ''
        // 上書きを確かめていない保存には、もとにした採用の版を付ける。確かめる前に別の端末が保存していればブリッジが断る(D-170)
        // 採用中のパッドが無い状態から作った下書きは null(その間に別の端末が初めて保存していれば断られる)
        const baseVersion = confirmed ? {} : { baseVersion: base === '' ? null : base }
        if (!link.send({ v: WIRE_PROTOCOL_VERSION, type: 'osc.padSave', name, pad: current as unknown as Record<string, unknown>, ...baseVersion })) {
          disconnected('保存できません')
          return
        }
        pendingSave = { name, version: adopted.value?.version ?? '', pad: current }
        notify('info', `パッド ${name} の保存を要求しました`)
      }
      if (conflicted.value) {
        ask('別の端末などが先にパッドを保存・切り替えています。上書きして保存しますか?', '上書き保存', () => run(true))
        return
      }
      run(false)
    },
  }
}
