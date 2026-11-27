// 編集モードの状態(D-144。NiceGUI 版の surface_editor.py の EditSession と page.py の編集モードの同期から)。
//
// 作業コピーはこの store が持ち、操作は編集命令(上り surfaceEdit)にして作業コピーと一緒に送る。ブリッジが規則を当てて検証した
// 答え(下り surfaceEdited)だけを新しい作業コピーにする(D-123)。採用中の定義(ブリッジが正)は直接いじらない。
//
// - 答えを待つ命令は 1 つだけで、その間の命令は送らずに知らせる。画面のボタンは描いた時点の位置(NodeRef)でノードを指すので、
//   答えで木が変わる前に押された命令を受けると別のノードに当たる(移動の直後の削除が隣を消すなど)
// - 答えを待つ間は保存(答えを含まない作業コピーを保存してしまう)と採用中の定義への追従(答えが追従した作業コピーを上書きする)をしない
// - 答えが 15 秒届かない・接続が切れた・編集モードを閉じた、のどれかで待つのをやめる(後から届いた答えは捨てる)
// - 出発点の版(採用中の定義が内容ごと変わるたびに増える手元の数)を覚えておき、他の端末が先に保存したか(競合)を判定する

import { batch, computed, signal } from '@preact/signals'

import {
  WIRE_PROTOCOL_VERSION,
  isValidSurfaceName,
  type NodeRef,
  type SurfaceDefinition,
  type SurfaceEdit,
  type SurfaceParameter,
} from '@oscdesk/shared'

import type { BridgeLink, FrameOf } from './bridge-link'
import {
  EDITOR_ROWS_STEP,
  joinBindings,
  newDefinition,
  nodeAt,
  parameterFields,
  parameterForm,
  safeFilename,
  sameDefinition,
  splitForSave,
  widthFromText,
  type EditorSection,
  type ParameterFields,
} from './editor-logic'
import type { Notices } from './notices'

/** ブリッジの答えを待つ長さ(NiceGUI 版の EDIT_TIMEOUT_S と同じ)。LAN 内なら数ミリ秒で返る。 */
export const EDIT_TIMEOUT_MS = 15_000

export const BUSY_MESSAGE = '前の変更を反映しています。反映してからもう一度操作してください'
export const CONFLICT_MESSAGE = '編集を始めたあとに、別の端末などが定義を保存しました。保存すると上書きされます(読み込み直すと作業中の内容は失われます)。'

export interface EditorStoreDeps {
  link: BridgeLink
  notices: Notices
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  /** 編集命令の requestId の乱数部分(テストで固定する)。 */
  randomId?: () => string
}

interface Pending {
  requestId: string
  timer: unknown
  onOk: (() => void) | undefined
  onError: (detail: string) => void
}

/** 採用中の定義(編集の出発点。本体に結び付けを添えたもの)と、内容が変わるたびに増える手元の版。 */
interface Adopted { definition: SurfaceDefinition; name: string }

export interface ParameterDialog { original: string | null; fields: ParameterFields }
export type Confirm = 'discard' | { overwrite: string } | null

function defaultRandomId(): string {
  const bytes = new Uint8Array(6)
  globalThis.crypto.getRandomValues(bytes)
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export type EditorStore = ReturnType<typeof createEditorStore>
export function createEditorStore(deps: EditorStoreDeps) {
  const { link } = deps
  const setTimer = deps.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms))
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const randomId = deps.randomId ?? defaultRandomId
  const notify = deps.notices.notify

  // ブリッジから届いたもの(表示キャッシュ)
  const adopted = signal<Adopted | null>(null)
  const adoptedRevision = signal(0)
  const names = signal<readonly string[]>([])
  const active = signal<string | null>(null)
  // hello を受けるまでは OSC のアダプタを持つとみなす(画面が一瞬欠けないように。NiceGUI 版の has_osc_adapter と同じ)
  const hasOsc = computed(() => link.hello.value === null || link.hello.value.adapters.includes('osc'))

  // 編集モード
  const editing = signal(false)
  const draft = signal<SurfaceDefinition | null>(null)
  const saved = signal<SurfaceDefinition | null>(null)
  const baseRevision = signal(0)
  const baseName = signal<string | null>(null)
  const pending = signal<Pending | null>(null)
  const saveName = signal('')
  const loadName = signal('')
  const rowLimits = signal<Record<EditorSection, number>>({ nodes: EDITOR_ROWS_STEP, unplaced: EDITOR_ROWS_STEP, parameters: EDITOR_ROWS_STEP, records: EDITOR_ROWS_STEP })
  const parameterDialog = signal<ParameterDialog | null>(null)
  const confirm = signal<Confirm>(null)
  // 断られた・送らなかった操作で動いた選択(幅)を作業コピーの値へ戻すため、木の描画をやり直させる印
  const epoch = signal(0)

  const busy = computed(() => pending.value !== null)
  const dirty = computed(() => draft.value !== null && saved.value !== null && !sameDefinition(draft.value, saved.value))
  const conflicted = computed(() => editing.value && dirty.value && baseRevision.value !== adoptedRevision.value)

  let seq = 0

  const redraw = () => {
    epoch.value += 1
  }

  const settle = (requestId: string, result: { ok: true; definition: SurfaceDefinition } | { ok: false; detail: string }) => {
    const waiting = pending.value
    if (waiting === null || waiting.requestId !== requestId) return // 待つのをやめた命令の答え(時間切れ・閉じた)は捨てる
    clearTimer(waiting.timer)
    batch(() => {
      pending.value = null
      if (result.ok) {
        if (draft.value === null || !sameDefinition(result.definition, draft.value)) draft.value = result.definition
      }
    })
    if (result.ok) {
      waiting.onOk?.()
      reconcile()
    } else {
      waiting.onError(result.detail)
      reconcile()
    }
  }

  const forget = () => {
    const waiting = pending.value
    if (waiting === null) return
    clearTimer(waiting.timer)
    pending.value = null
  }

  /**
   * 採用中の定義・保存済みの一覧の変化と、命令の答えの後に、作業コピーの出発点を合わせる(NiceGUI 版の _sync_editor)。
   * - 自分の保存が採用されて作業コピーと一致したら、それを新しい出発点にする(競合扱いにしない)
   * - 未編集で答えを待っていないなら、他の端末の保存や読み込みを作業コピーへそのまま追従させる。内容が同じでも出発点
   *   (版・保存名)は必ず合わせる(合わせないと保存名が古い定義を指したままになり、次の保存で別の定義を上書きする)
   */
  const reconcile = () => {
    if (!editing.value) return
    const current = adopted.value
    batch(() => {
      if (dirty.value && current !== null && draft.value !== null && sameDefinition(current.definition, draft.value)) {
        saved.value = draft.value
        baseRevision.value = adoptedRevision.value
        baseName.value = active.value
      }
      if (!dirty.value && !busy.value && current !== null) {
        if (draft.value === null || !sameDefinition(current.definition, draft.value)) {
          draft.value = current.definition
          redraw()
        }
        saved.value = draft.value
        const previous = baseName.value
        baseRevision.value = adoptedRevision.value
        baseName.value = active.value
        if (previous !== active.value) saveName.value = active.value ?? ''
      }
    })
  }

  const onSurface = (frame: FrameOf<'surface'>) => {
    const definition = joinBindings(frame.definition, frame.bindings)
    const current = adopted.value
    // 同じ内容の再配信(ブリッジは再採用のたびに revision を増やす)では出発点の版を進めない(偽の競合にしない)
    if (current === null || current.name !== frame.name || !sameDefinition(current.definition, definition)) {
      batch(() => {
        adopted.value = { definition, name: frame.name }
        adoptedRevision.value += 1
      })
    }
    reconcile()
  }

  const onSurfaceList = (frame: FrameOf<'surfaceList'>) => {
    batch(() => {
      names.value = frame.names
      active.value = frame.active
      if (frame.active === null && adopted.value !== null) {
        adopted.value = null
        adoptedRevision.value += 1
      }
    })
    reconcile()
  }

  const onNotice = (notice: FrameOf<'notice'>) => {
    // 保存・読み込みを断られた(要求元だけに届く)。作業コピーはそのまま残し、直して保存し直せるようにする
    if (notice.code === 'surface-rejected') notify('error', `定義を採用できません: ${notice.detail}`)
  }

  /**
   * 編集命令を送る。答えで通れば onOk、断られれば理由を出す(作業コピーは変えない)。前の命令の答えを待っている間は送らずに
   * 知らせ、false を返す
   */
  const submit = (edit: SurfaceEdit, options: { onOk?: () => void; failure?: string } = {}): boolean => {
    const failure = options.failure ?? '変更できません'
    if (pending.value !== null) {
      notify('warn', BUSY_MESSAGE)
      redraw()
      return false
    }
    seq += 1
    const requestId = `edit-${seq}-${randomId()}`
    // 差し替え(アップロード)は作業コピーを使わない(壊れた作業コピーでも直せるように)
    const current = draft.value
    const frame = edit.op === 'replace' || current === null
      ? { v: WIRE_PROTOCOL_VERSION, type: 'surfaceEdit' as const, requestId, edit }
      : { v: WIRE_PROTOCOL_VERSION, type: 'surfaceEdit' as const, requestId, draft: current as unknown as Record<string, unknown>, edit }
    if (!link.send(frame)) {
      notify('error', `${failure}: ブリッジに接続していないため変更できません`)
      redraw()
      return false
    }
    const onError = (detail: string) => {
      notify('error', `${failure}: ${detail}`)
      redraw()
    }
    const timer = setTimer(() => {
      if (pending.value?.requestId !== requestId) return
      pending.value = null
      onError('ブリッジの応答がありませんでした')
    }, EDIT_TIMEOUT_MS)
    pending.value = { requestId, timer, onOk: options.onOk, onError }
    return true
  }

  const editNode = (edit: SurfaceEdit) => submit(edit)

  const close = () => {
    forget()
    batch(() => {
      editing.value = false
      draft.value = null
      saved.value = null
      parameterDialog.value = null
      confirm.value = null
    })
  }

  const sendSave = (name: string) => {
    const current = draft.value
    if (current === null) return
    if (busy.value) {
      // 答えを待つ変更を含まない作業コピーを保存しないように(保存したつもりの変更が落ちる)
      notify('warn', '前の変更を反映しています。反映してから保存してください')
      return
    }
    const { body, bindings } = splitForSave(current)
    const sent = link.send({ v: WIRE_PROTOCOL_VERSION, type: 'surfaceSave', name, definition: body, ...(bindings !== undefined ? { bindings } : {}), activate: true })
    if (!sent) {
      notify('error', 'ブリッジに接続していないため保存できません')
      return
    }
    notify('info', `${name} の保存を要求しました`)
  }

  const unsubscribe = [
    link.on('surface', onSurface),
    link.on('surfaceList', onSurfaceList),
    link.on('notice', onNotice),
    link.on('surfaceEdited', (frame) => settle(frame.requestId, frame.result)),
    link.onConnectionChange((connected) => {
      // 採用中の定義と保存済みの一覧は、bridge-link が hello の後に送る surfaceRequest の答えで届く(D-044・D-155)
      if (connected) return
      // 切れたら答えは届かない。待っている命令を断られたものとして終える(作業コピーは残す)
      const waiting = pending.value
      if (waiting === null) return
      clearTimer(waiting.timer)
      pending.value = null
      waiting.onError('ブリッジとの接続が切れました')
    }),
  ]

  return {
    // 読むだけの状態
    connected: link.connected,
    hasOsc,
    names,
    active,
    adopted,
    editing,
    draft,
    busy,
    dirty,
    conflicted,
    saveName,
    loadName,
    rowLimits,
    parameterDialog,
    confirm,
    epoch,

    dispose() {
      forget()
      for (const stop of unsubscribe) stop()
    },

    /** 編集モードを開く。採用中の定義が無ければ空の定義から始める。 */
    open() {
      if (editing.value) return
      const current = adopted.value
      const start = current?.definition ?? newDefinition('New', hasOsc.value)
      batch(() => {
        editing.value = true
        draft.value = start
        saved.value = start
        baseRevision.value = adoptedRevision.value
        baseName.value = active.value
        saveName.value = active.value ?? ''
        loadName.value = ''
        rowLimits.value = { nodes: EDITOR_ROWS_STEP, unplaced: EDITOR_ROWS_STEP, parameters: EDITOR_ROWS_STEP, records: EDITOR_ROWS_STEP }
      })
    },
    /** 編集モードを閉じる。答えを待つ変更も未保存の作業として扱い、あれば確かめる。 */
    requestClose() {
      if (dirty.value || busy.value) {
        confirm.value = 'discard'
        return
      }
      close()
    },
    discard: close,
    cancelConfirm() {
      confirm.value = null
    },

    showMore(section: EditorSection) {
      rowLimits.value = { ...rowLimits.value, [section]: rowLimits.value[section] + EDITOR_ROWS_STEP }
    },

    moveNode(ref: NodeRef, delta: -1 | 1) { editNode({ op: 'moveNode', ref, delta }) },
    mergeWithNext(ref: NodeRef) { editNode({ op: 'mergeWithNext', ref }) },
    unwrapNode(ref: NodeRef) { editNode({ op: 'unwrapNode', ref }) },
    wrapNode(ref: NodeRef) { editNode({ op: 'wrapNode', ref, kind: 'group' }) },
    removeNode(ref: NodeRef) { editNode({ op: 'removeNode', ref }) },
    setWidth(ref: NodeRef, text: string) {
      const width = widthFromText(text)
      const current = draft.value
      // 答えを待つ間は作業コピーが古いので比べない(断って描き直す)
      if (!busy.value && current !== null) {
        const node = nodeAt(current, ref)
        if (node === null || (node.width ?? null) === width) return
      }
      editNode({ op: 'setWidth', ref, width })
    },
    setCollapsed(ref: NodeRef, collapsed: boolean) {
      const current = draft.value
      if (!busy.value && current !== null) {
        const node = nodeAt(current, ref)
        if (node === null || node.kind !== 'group' || (node.collapsed ?? false) === collapsed) return
      }
      editNode({ op: 'setCollapsed', ref, collapsed })
    },
    addControl(param: string) { editNode({ op: 'addControl', screen: 0, steps: [], param }) },
    removeParameter(param: string) { editNode({ op: 'removeParameter', param }) },

    openParameter(parameter: SurfaceParameter | null) {
      const current = draft.value
      if (current === null) return
      if (parameter !== null && parameter.type === 'composite') {
        // 組み合わせの型(D-121)のフィールドはこのフォームで表せない。フォームで作り直すとフィールドを失うので開かない
        notify('warn', '組み合わせの型のパラメータはこのフォームでは編集できません(定義ファイルで編集してください)')
        return
      }
      parameterDialog.value = { original: parameter?.id ?? null, fields: parameterFields(current, parameter) }
    },
    setParameterField<K extends keyof ParameterFields>(key: K, value: ParameterFields[K]) {
      const dialog = parameterDialog.value
      if (dialog === null) return
      parameterDialog.value = { ...dialog, fields: { ...dialog.fields, [key]: value } }
    },
    cancelParameter() {
      parameterDialog.value = null
    },
    /** フォームの読み取りと定義全体の検証はブリッジ(D-123)。通ったときだけダイアログを閉じる。 */
    commitParameter() {
      const dialog = parameterDialog.value
      if (dialog === null) return
      submit(
        { op: 'setParameter', original: dialog.original, form: parameterForm(dialog.fields, hasOsc.value) },
        { onOk: () => { parameterDialog.value = null }, failure: '保存できません' },
      )
    },

    setSaveName(value: string) { saveName.value = value },
    setLoadName(value: string) { loadName.value = value },
    load() {
      const name = loadName.value
      if (name === '') {
        notify('warn', '読み込む定義を選んでください')
        return
      }
      if (!link.send({ v: WIRE_PROTOCOL_VERSION, type: 'surfaceLoad', name })) {
        notify('error', 'ブリッジに接続していないため読み込めません')
        return
      }
      notify('info', `${name} の読み込みを要求しました`)
    },
    save() {
      const name = saveName.value.trim()
      if (!isValidSurfaceName(name)) {
        notify('error', '保存名は英数字で始まる英数字・_・- の 1〜64 文字にしてください')
        return
      }
      if (conflicted.value) {
        confirm.value = { overwrite: name }
        return
      }
      sendSave(name)
    },
    confirmOverwrite() {
      const current = confirm.value
      confirm.value = null
      if (current !== null && current !== 'discard') sendSave(current.overwrite)
    },
    /** ダウンロードする中身(答えを待つ間は null。答えを含まない作業コピーを渡さない)。 */
    download(): { filename: string; text: string } | null {
      const current = draft.value
      if (current === null) return null
      if (busy.value) {
        notify('warn', '前の変更を反映しています。反映してからダウンロードしてください')
        return null
      }
      return { filename: `${safeFilename(saveName.value || current.name)}.json`, text: JSON.stringify(current, null, 2) }
    },
    /** アップロードした JSON を作業コピーへ。版 1 から版 2 への移行も検証もブリッジ(D-123)。 */
    upload(text: string) {
      let loaded: unknown
      try {
        loaded = JSON.parse(text)
      } catch (error) {
        notify('error', `JSON として読めません: ${error instanceof Error ? error.message : String(error)}`)
        return
      }
      submit(
        { op: 'replace', definition: loaded },
        { onOk: () => notify('info', 'アップロードした定義を作業コピーに読み込みました。保存すると採用されます'), failure: '定義として不正です' },
      )
    },
  }
}
