// OSC パッドのタブの状態(D-080・D-126・D-147。NiceGUI 版の osc_pad.py の PadEditSession / PadCache と osc_pad_panel.py から)。
//
// - 採用中のパッドと保存済みの一覧は osc.pad / osc.padList の表示キャッシュ(正はブリッジ)。接続のたびに osc.padRequest で取り直す
// - 編集は UI が作業コピーを持ち、「何をしたいか」を編集命令(osc.padEdit)として作業コピーと一緒に送り、ブリッジが規則を当てて
//   検証に通した答え(osc.padEdited)を新しい作業コピーにする。答えを待つ命令は 1 つだけで、その間の構造を変える命令は断る
//   (描いた時点の位置で指す命令を古い作業コピーへ当てないため。D-123)。入力欄の命令は欄ごとに最後の 1 つだけ預かって、答えの後に送る
// - 保存・切り替えの結果は osc.pad で戻る(UI は保存成功を自分で確定しない)。頼んだ保存・切り替えに当たる採用が届いたときだけ
//   保存済み・破棄済みにする
//
// NiceGUI 版は 50ms の同期タイマーで採用をまとめて読むので、採用の履歴(PadCache.adoptions)と取りこぼしの検出が要った。
// ここではフレームが届いた時点で照合するので、答えを待つ間に届いた採用だけを列に残し、答えの後に順に照合する
import { batch, computed, signal } from '@preact/signals'

import { OSC_PAD, WIRE_PROTOCOL_VERSION, isValidSurfaceName, type OscPad, type OscPadButtonSettings, type OscPadEdit } from '@oscdesk/shared'

import type { BridgeLink, FrameOf } from './bridge-link'
import { BUSY_MESSAGE, DEFAULT_SAVE_NAME, EDIT_TIMEOUT_MS, base64Of, buttonAt, buttonSettings, fieldKey, findButton, newPad, samePad } from './osc-pad-logic'
import type { Notices } from './notices'

export interface Adopted { name: string; version: string; pad: OscPad }
export interface Session { draft: OscPad; baseVersion: string; baseName: string | null; dirty: boolean }
export interface Confirm { message: string; okLabel: string; onOk: () => void; onCancel?: () => void }
export interface Clipboard { settings: OscPadButtonSettings; label: string }
export interface ViewSize { name: string | null; rows: number; columns: number }
export type Section = 'button' | 'appearance' | 'osc'

interface EditItem { edit: OscPadEdit; onOk?: () => void; onError?: (detail: string) => void }
interface PendingRequest { name: string; version: string; pad: OscPad }

export interface PadStoreDeps {
  link: BridgeLink
  notices: Notices
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  /** 編集命令の印(requestId)の乱数部分。テストで固定する。 */
  randomId?: () => string
}

export type OscPadStore = ReturnType<typeof createOscPadStore>
export function createOscPadStore(deps: PadStoreDeps) {
  const { link } = deps
  const setTimer = deps.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms))
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const randomId = deps.randomId ?? (() => Math.random().toString(16).slice(2, 14))
  const notify = deps.notices.notify

  const adopted = signal<Adopted | null>(null)
  const names = signal<readonly string[]>([])
  const oscAvailable = signal(true)
  const session = signal<Session | null>(null)
  const selected = signal<string | null>(null)
  const clipboard = signal<Clipboard | null>(null)
  const saveName = signal('')
  const viewSize = signal<ViewSize | null>(null)
  const confirm = signal<Confirm | null>(null)
  // 応答待ち・預かった入力あり・画像の読み込み中のどれか(下の「応答待ちの間の規則」)
  const busy = signal(false)
  // 入力欄も受けない間(構造の命令の答えを待つ間・画像の読み込み中)。構造の命令は引数の添字などをずらすので、その間の入力を
  // 預かって後から当てると別の欄に当たる。画面は入力欄を読み取り専用にする
  const formLocked = signal(false)
  // Inspector の入力欄は打った文字を手元に持つ(断られた入力も欄に残して理由を下に出す)。作業コピーから欄を作り直すときだけ
  // これを進める(画面は欄の key に使う)。入力欄の命令では進めない(打っている欄の文字とカーソルを消さない)
  const formRevision = signal(0)
  const fieldErrors = signal<ReadonlyMap<string, string>>(new Map())
  const expanded = signal<Readonly<Record<Section, boolean>>>({ button: true, appearance: false, osc: true })

  let pending: { requestId: string; timer: unknown; item: EditItem } | null = null
  const queued = new Map<string, EditItem>()
  let editSeq = 0
  // 読み込み中の画像の数
  let reading = 0
  // 作業コピーの世代。答え以外で作業コピーを置き換えたとき(編集の開始・終了・新規・追従)に進める。非同期の処理(画像の読み込み)は
  // 始めたときの世代を持ち、終わったときに世代が変わっていれば捨てる(切り替え先の同じ id のボタンに当てない)
  let generation = 0
  // 答えを待つ間に届いた採用(照合は答えの後。答えが追従した作業コピーを上書きしないため)
  let waitingAdoptions: Adopted[] = []
  // 要求の名前・要求時の版と、要求時の下書き(届いたときに下書きが同じなら、破棄を確認済みとして捨てる)
  let pendingLoad: { name: string; version: string; draft: OscPad } | null = null
  // 要求の名前・要求時の版と、送った内容(同じ内容の採用だけを自分の保存の応答とみなす)
  let pendingSave: PendingRequest | null = null

  const current = computed<OscPad | null>(() => session.value?.draft ?? adopted.value?.pad ?? null)
  /** 描く格子の行数・列数。編集中は作業コピーのもの、実行モードでは選んだ表示(同じ名前のパッドの間だけ)。 */
  const gridSize = computed<{ rows: number; columns: number } | null>(() => {
    const pad = current.value
    if (pad === null) return null
    const view = viewSize.value
    if (session.value === null && view !== null && view.name === (adopted.value?.name ?? null)) return { rows: view.rows, columns: view.columns }
    return { rows: pad.rows, columns: pad.columns }
  })
  const conflicted = computed(() => {
    const editing = session.value
    return editing !== null && editing.dirty && editing.baseVersion !== (adopted.value?.version ?? '')
  })

  const refreshForm = () => {
    batch(() => {
      formRevision.value += 1
      fieldErrors.value = new Map()
    })
  }

  const setFieldError = (key: string, error: string | null) => {
    const next = new Map(fieldErrors.value)
    if (error === null) next.delete(key)
    else next.set(key, error)
    fieldErrors.value = next
  }

  const updateSession = (patch: Partial<Session>) => {
    const editing = session.value
    if (editing !== null) session.value = { ...editing, ...patch }
  }

  // --- 編集命令の送受信 -------------------------------------------------------

  const dispatch = (item: EditItem) => {
    const editing = session.value
    if (editing === null) return
    editSeq += 1
    const requestId = `padedit-${String(editSeq)}-${randomId()}`
    if (!link.send({ v: WIRE_PROTOCOL_VERSION, type: 'osc.padEdit', requestId, draft: editing.draft as unknown as Record<string, unknown>, edit: item.edit })) {
      item.onError?.('ブリッジに接続していないため変更できません')
      return
    }
    const timer = setTimer(() => settle(requestId, { ok: false, detail: 'ブリッジの応答がありませんでした' }), EDIT_TIMEOUT_MS)
    pending = { requestId, timer, item }
  }

  const settle = (requestId: string, result: FrameOf<'osc.padEdited'>['result']) => {
    if (pending === null || pending.requestId !== requestId) return
    const { item, timer } = pending
    clearTimer(timer)
    pending = null
    batch(() => {
      if (result.ok) {
        const editing = session.value
        if (editing !== null && !samePad(result.pad, editing.draft)) updateSession({ draft: result.pad, dirty: true })
        item.onOk?.()
      } else {
        item.onError?.(result.detail)
      }
      // 預かった命令を順に送る。送れなかった命令(切断中など)は理由を知らせて捨て、次へ進む(1 つで止めると busy のまま残る)
      while (queued.size > 0 && pending === null) {
        const [key, next] = queued.entries().next().value as [string, EditItem]
        queued.delete(key)
        dispatch(next)
      }
      updateBusy()
    })
  }

  // --- 応答待ちの間の規則 ---------------------------------------------------------
  //
  // 答えを待つ命令・預かった入力・読み込み中の画像のどれかがある間(busy)は、作業コピーを読む操作(ボタンの選択・コピー)も、
  // 変える操作(構造の命令・貼り付け・画像・新規・保存・切り替え・実行モードへの切り替え)も、理由を出して断り、何も変えない
  // (Inspector の欄も作り直さない)。受けるのは入力欄の命令だけで、欄ごとに最後の 1 つを預かる。構造の命令の答えを待つ間と
  // 画像の読み込み中は入力欄も読み取り専用にする(formLocked)。答えを待つ前の作業コピーを読んだり、未反映の入力を落としたり
  // しないための 1 つの規則で、操作ごとに場合分けを足さない

  const updateBusy = () => {
    const next = pending !== null || queued.size > 0 || reading > 0
    batch(() => {
      formLocked.value = reading > 0 || (pending !== null && fieldKey(pending.item.edit) === null)
      busy.value = next
    })
    if (!next) reconcile()
  }

  /** 操作してよいか。busy なら理由を出して false。 */
  const idle = (): boolean => {
    if (!busy.value) return true
    notify('warn', BUSY_MESSAGE)
    return false
  }

  const dropEdits = () => {
    if (pending !== null) clearTimer(pending.timer)
    pending = null
    queued.clear()
    // 読み込み中の画像は世代で捨てる(読み終わりで数を戻す)
    generation += 1
    batch(() => {
      formLocked.value = reading > 0
      busy.value = reading > 0
    })
  }

  /** 編集命令を送る。答えを待っている間は、入力欄の命令なら預かって true、それ以外は送らずに false。 */
  const submit = (item: EditItem): boolean => {
    if (session.value === null) return false
    if (pending !== null || reading > 0) {
      const key = fieldKey(item.edit)
      if (key === null || formLocked.value) return false
      // 同じ欄の古い入力は送らない(最後の入力だけが作業コピーに残ればよい)。Map の並びの末尾へ回す
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
   * 構造を変える命令。busy なら理由を出して断る(欄は作り直さない)。答えが来たら欄を作業コピーから作り直し、断られたら理由を
   * 知らせる(作業コピーは変わっていないので欄はそのまま。選択欄は画面が押した直後に元の値へ戻している)
   */
  const edit = (command: OscPadEdit, onOk?: () => void) => {
    if (session.value === null || !idle()) return
    submit({
      edit: command,
      onOk: () => {
        refreshForm()
        onOk?.()
      },
      onError: (detail) => notify('error', detail),
    })
  }

  /** 入力欄の命令。打つたびに届くので通知は出さず、断られた理由は欄の下に出す(showError: false の欄は黙って作業コピーを保つ)。 */
  const editField = (command: OscPadEdit, showError = true) => {
    if (session.value === null) return
    const key = fieldKey(command) ?? command.op
    const show = (error: string | null) => {
      if (showError) setFieldError(key, error)
    }
    if (!submit({ edit: command, onOk: () => show(null), onError: show })) show(BUSY_MESSAGE)
  }

  // --- 採用の照合 -----------------------------------------------------------------

  /** 届いた採用を、頼んだ保存・切り替えと照合し、未編集なら作業コピーを追従させる。答えを待つ間は後回しにする。 */
  const reconcile = (arrived?: Adopted) => {
    if (arrived !== undefined && session.value !== null) waitingAdoptions.push(arrived)
    if (busy.value) return
    const adoptions = waitingAdoptions
    waitingAdoptions = []
    const editing = session.value
    if (editing === null) return
    batch(() => {
      for (const [index, adoption] of adoptions.entries()) {
        const load = pendingLoad
        // 要求した切り替えが実際に採用されたら、破棄を確認済みの下書きを捨てて追従させる。要求の後に下書きを編集していたら、
        // その編集は確認を取っていないので捨てず、未保存のまま残して知らせる(以後は通常の競合と同じ扱い)
        if (load !== null && adoption.name === load.name && adoption.version !== load.version) {
          pendingLoad = null
          if (samePad(session.value?.draft, load.draft)) {
            updateSession({ dirty: false })
            pendingSave = null
          } else {
            notify('warn', `${adoption.name} に切り替わりましたが、切り替えを頼んだ後の編集があるので下書きを残しました(保存するか、実行モードへ戻って破棄してください)`)
          }
        }
        const saving = pendingSave
        if (saving !== null && adoption.name === saving.name && adoption.version !== saving.version && samePad(adoption.pad, saving.pad)) {
          pendingSave = null
          const stillEdited = !samePad(session.value?.draft, adoption.pad)
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
    if (editing === null || editing.dirty || busy.value) return
    const latest = adopted.value
    const draft = latest?.pad ?? newPad()
    if (samePad(draft, editing.draft) && editing.baseVersion === (latest?.version ?? '') && editing.baseName === (latest?.name ?? null)) return
    generation += 1
    session.value = { draft, baseVersion: latest?.version ?? '', baseName: latest?.name ?? null, dirty: false }
    if (latest !== null) saveName.value = latest.name
    if (selected.value !== null && findButton(draft, selected.value) === undefined) selected.value = null
    refreshForm()
  }

  const onPad = (frame: FrameOf<'osc.pad'>) => {
    const next: Adopted = { name: frame.name, version: frame.version, pad: frame.pad }
    batch(() => {
      adopted.value = next
      reconcile(next)
    })
  }

  const onPadList = (frame: FrameOf<'osc.padList'>) => {
    batch(() => {
      names.value = frame.names
      if (frame.active === null && adopted.value !== null) {
        adopted.value = null
        reconcile()
      }
    })
  }

  const onNotice = (notice: FrameOf<'notice'>) => {
    if (notice.code === 'pad-rejected') notify('error', `パッドを採用できません: ${notice.detail}`)
    else if (notice.code === 'pad-press-rejected') notify('error', `パッドのボタンを送れませんでした: ${notice.detail}`)
  }

  const unsubscribe = [
    link.on('hello', (hello) => {
      // パッドの要求(osc.padRequest)は接続のたびに bridge-link が hello の後に送る(D-155)
      oscAvailable.value = hello.adapters.includes('osc')
    }),
    link.on('osc.pad', onPad),
    link.on('osc.padList', onPadList),
    link.on('osc.padEdited', (frame) => settle(frame.requestId, frame.result)),
    link.on('notice', onNotice),
    link.onConnectionChange((connected) => {
      if (connected || pending === null) return
      // 切れたら答えは届かない。待っている命令を「切れた」で終える(預かった入力欄の命令は送れないので理由つきで捨てる)
      settle(pending.requestId, { ok: false, detail: 'ブリッジとの接続が切れました' })
    }),
  ]

  // --- 編集モードの出入り -----------------------------------------------------

  const openEdit = () => {
    const latest = adopted.value
    generation += 1
    batch(() => {
      session.value = { draft: latest?.pad ?? newPad(), baseVersion: latest?.version ?? '', baseName: latest?.name ?? null, dirty: false }
      saveName.value = latest?.name ?? DEFAULT_SAVE_NAME
      selected.value = null
      // 編集は保存される格子の大きさで行う(実行モードで選んだ表示は持ち込まない)
      viewSize.value = null
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
      selected.value = null
      clipboard.value = null
      refreshForm()
    })
  }

  const ask = (message: string, okLabel: string, onOk: () => void, onCancel?: () => void) => {
    confirm.value = { message, okLabel, onOk, onCancel }
  }

  const disconnected = (what: string) => notify('error', `ブリッジに接続していないため${what}`)

  return {
    // 読むだけの状態
    connected: link.connected,
    adopted,
    names,
    oscAvailable,
    session,
    current,
    gridSize,
    conflicted,
    selected,
    clipboard,
    saveName,
    viewSize,
    confirm,
    busy,
    formLocked,
    formRevision,
    fieldErrors,
    expanded,

    dispose() {
      dropEdits()
      for (const stop of unsubscribe) stop()
    },

    // --- 実行モード
    /** 押下。version は押した画面が描いたパッドの版(描いた後に上書き保存されていればブリッジが断る)。 */
    press(button: string, version: string) {
      const name = adopted.value?.name
      if (name === undefined || version === '' || !link.send({ v: WIRE_PROTOCOL_VERSION, type: 'osc.padPress', name, version, button })) {
        notify('warn', 'ブリッジに接続していないため送れませんでした')
      }
    },
    /**
     * 格子の大きさ。編集中はパッドの命令にし、実行モードでは表示だけを変える(パッドを書き換えて保存すると全端末のパッドの版が替わり、
     * 本番中の押下が古い版として断られうるため。D-084)。パッドと同じ大きさに戻したら選択を消し、以後の保存に追従させる
     */
    resize(rows: number | null, columns: number | null) {
      const pad = current.value
      const size = gridSize.value
      if (pad === null || size === null) return
      const target = { rows: rows ?? size.rows, columns: columns ?? size.columns }
      if (session.value !== null) {
        edit({ op: 'resize', ...target })
        return
      }
      const same = target.rows === pad.rows && target.columns === pad.columns
      viewSize.value = same ? null : { name: adopted.value?.name ?? null, ...target }
    },

    // --- 編集モード
    setEditing(on: boolean) {
      if (on === (session.value !== null)) return
      if (on) {
        openEdit()
        return
      }
      // 答えを待つ変更はまだ dirty に出ていないので、busy の間は閉じない(待っている変更を黙って捨てない)
      if (!idle()) return
      if (session.value?.dirty === true) {
        ask('保存していない変更があります。破棄して実行モードへ戻りますか?', '破棄する', closeEdit)
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
    select(id: string | null) {
      if (selected.value === id) return
      // 選び直すと Inspector を作業コピーから描くので、未反映の入力がある間は選ばない(閉じるのは受ける)
      if (id !== null && !idle()) return
      batch(() => {
        selected.value = id
        refreshForm()
      })
    },
    setExpanded(section: Section, open: boolean) {
      expanded.value = { ...expanded.value, [section]: open }
    },
    /** 空きマスにボタンを足す。id はブリッジが振るので、答えの作業コピーのそのマスのボタンを選ぶ。 */
    add(row: number, column: number) {
      edit({ op: 'addButton', row, column }, () => {
        const draft = session.value?.draft
        const added = draft === undefined ? undefined : buttonAt(draft, row, column)
        if (added !== undefined) selected.value = added.id
      })
    },
    remove(button: string) {
      edit({ op: 'removeButton', button }, () => {
        selected.value = null
      })
    },
    copy(button: string) {
      // 答えを待つ前の作業コピーを写すと、貼り付けで変更前のアドレスなどが保存・送信される
      if (!idle()) return
      const found = session.value === null ? undefined : findButton(session.value.draft, button)
      if (found !== undefined) clipboard.value = { settings: buttonSettings(found), label: found.label || button }
    },
    paste(button: string) {
      const clip = clipboard.value
      if (clip !== null) edit({ op: 'pasteSettings', button, settings: clip.settings })
    },
    setLabel(button: string, label: string) {
      editField({ op: 'setLabel', button, label })
    },
    setAddress(button: string, address: string) {
      editField({ op: 'setAddress', button, address })
    },
    /** 背景色。色を選んでいる間の入力は欄ごとに最後の 1 つだけが送られる。null で既定の色に戻す。 */
    setColor(button: string, color: string | null) {
      if (color === null) edit({ op: 'setColor', button, color: null })
      else editField({ op: 'setColor', button, color }, false)
    },
    setArgValue(button: string, index: number, raw: string) {
      editField({ op: 'setArgValue', button, index, raw })
    },
    setArgType(button: string, index: number, type: 'i' | 'f' | 's') {
      edit({ op: 'setArgType', button, index, type })
    },
    addArg(button: string) {
      edit({ op: 'addArg', button, type: 'i' })
    },
    removeArg(button: string, index: number) {
      edit({ op: 'removeArg', button, index })
    },
    moveArg(button: string, index: number, delta: -1 | 1) {
      edit({ op: 'moveArg', button, index, delta })
    },
    /** 画像。バイト列をそのまま送る(種類と大きさの判定と data URL への変換はブリッジ。D-126)。ここは大きすぎるファイルを読む前に止めるだけ。 */
    async setImage(button: string, file: Blob | null) {
      if (file === null) {
        edit({ op: 'setImage', button, data: null })
        return
      }
      if (file.size > OSC_PAD.MAX_IMAGE_BYTES) {
        notify('error', `画像は ${String(OSC_PAD.MAX_IMAGE_BYTES / 1024)} KiB までです`)
        return
      }
      if (!idle()) return
      // 読み込みの間も busy にし(ほかの操作を断る)、始めたときの世代を持つ。読み終わったときに切り替え・新規・追従で作業コピーが
      // 替わっていれば捨てる(替わった先の同じ id のボタンに画像を付けない)
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
      if (started !== generation || editing === null || findButton(editing.draft, button) === undefined) {
        notify('warn', '画像を読み込む間に編集中のパッドが替わったため、画像を付けませんでした')
        return
      }
      edit({ op: 'setImage', button, data })
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
          updateSession({ draft: newPad(), dirty: true })
          saveName.value = ''
          selected.value = null
          refreshForm()
        })
      }
      if (session.value?.dirty === true) {
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
          // 答えを待つ間に切り替えると、届いた答えが切り替えたパッドの作業コピーを上書きしうる
          notify('warn', BUSY_MESSAGE)
          return
        }
        if (!link.send({ v: WIRE_PROTOCOL_VERSION, type: 'osc.padLoad', name })) {
          disconnected('切り替えられません')
          return
        }
        // 下書きはここでは捨てない。要求したパッドが採用されて届いたときに照合して追従させる
        if (editing !== null) pendingLoad = { name, version: adopted.value?.version ?? '', draft: editing.draft }
        notify('info', `${name} への切り替えを要求しました`)
      }
      if (session.value?.dirty === true) {
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
      const run = () => {
        if (busy.value) {
          // 答えを待つ変更を含まない作業コピーを保存しないように(保存したつもりの変更が落ちる)
          notify('warn', '前の変更を反映しています。反映してから保存してください')
          return
        }
        const draft = session.value?.draft
        if (draft === undefined) return
        if (!link.send({ v: WIRE_PROTOCOL_VERSION, type: 'osc.padSave', name, pad: draft as unknown as Record<string, unknown> })) {
          disconnected('保存できません')
          return
        }
        pendingSave = { name, version: adopted.value?.version ?? '', pad: draft }
        notify('info', `パッド ${name} の保存を要求しました`)
      }
      if (conflicted.value) {
        ask('別の端末などが先にパッドを保存・切り替えています。上書きして保存しますか?', '上書き保存', run)
        return
      }
      run()
    },
  }
}
