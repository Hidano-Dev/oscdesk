// プロジェクトファイル(D-090)の書き出し・読み込みと「まだ Unity へ送っていない」の状態(D-150)。
//
// - 書き出し: projectExport を送り、届いた project(同じ requestId)をブラウザでダウンロードさせる(Blob)
// - 読み込み: 選んだファイルをブラウザで読み(File API)、projectInspect でブリッジに検査させる。通れば確認のダイアログを
//   出し、「読み込む」で projectImport を送る。画面と保持値はブリッジの surface・pad・desired で揃う(先に変えない)
// - 読み込みは定義の切り替えと同じ重さなので、編集モードの間だけ受ける(D-049 / D-081。D-151)
// - 読み込んでも Unity へは送らない。送るのは「Unity へ送る」(全宛先への resend)だけ
//
// ページごとに自分の接続を持つので、答えが届いたらその場で処理する(待つのは印と期限だけ)

import { batch, signal, type ReadonlySignal } from '@preact/signals'

import { WIRE_PROTOCOL_VERSION, type ProjectFile } from '@oscdesk/shared'

import type { BridgeLink, FrameOf } from './bridge-link'
import type { Notices } from './notices'
import {
  describeInspectionFailure,
  describeNames,
  projectDownloadName,
  projectDownloadText,
  projectNames,
  readProjectBytes,
  PROJECT_UPLOAD_MAX_BYTES,
} from './project-logic'

/** 書き出し・検査の応答を待つ長さ。LAN 内で 12 MiB を運ぶのに十分で、届かなかったことに気づける長さ。 */
export const PROJECT_TIMEOUT_MS = 15_000

export type InspectionSummary = Extract<FrameOf<'projectInspection'>['result'], { ok: true }>['summary']

/** 確認のダイアログに出すもの。project は読み込んだファイル(「読み込む」でそのまま送る)。 */
export interface ImportConfirm { project: Record<string, unknown>; summary: InspectionSummary; activeSurface: string | null; activePad: string | null }

export interface ProjectStoreDeps {
  link: BridgeLink
  notices: Notices
  /** 編集モード(D-151)。読み込みはこれが true の間だけ受ける。 */
  editing: ReadonlySignal<boolean>
  /** ブラウザにファイルを保存させる。既定は Blob と <a download>。 */
  download?: (name: string, text: string) => void
  now?: () => Date
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  randomId?: () => string
}

export function browserDownload(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  // click の直後に取り消すと、ブラウザによっては保存が始まる前に URL が消える
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const defaultRandomId = () => Math.random().toString(16).slice(2, 14).padEnd(12, '0')

export type ProjectStore = ReturnType<typeof createProjectStore>
export function createProjectStore(deps: ProjectStoreDeps) {
  const { link, editing } = deps
  const notify = deps.notices.notify
  const download = deps.download ?? browserDownload
  const now = deps.now ?? (() => new Date())
  const setTimer = deps.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms))
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const randomId = deps.randomId ?? defaultRandomId

  const unsentSince = signal<string | null>(null)
  const activeSurface = signal<string | null>(null)
  const activePad = signal<string | null>(null)
  const confirm = signal<ImportConfirm | null>(null)
  const sendConfirm = signal(false)
  /** 書き出し・検査の応答を待っているか(ボタンの「…中」に使う)。 */
  const exporting = signal(false)
  const inspecting = signal(false)

  let seq = 0
  // 書き出しの印 → 期限のタイマー。断り(project-export-rejected)には印が無いので、古いものから当てる
  const exports = new Map<string, unknown>()
  const inspections = new Map<string, { timer: unknown; project: Record<string, unknown> }>()

  const nextId = (prefix: string) => {
    seq += 1
    return `${prefix}-${String(seq)}-${randomId()}`
  }
  const refreshBusy = () => {
    exporting.value = exports.size > 0
    inspecting.value = inspections.size > 0
  }

  const settleExport = (requestId: string) => {
    const timer = exports.get(requestId)
    if (timer === undefined) return false
    clearTimer(timer)
    exports.delete(requestId)
    refreshBusy()
    return true
  }
  const settleInspection = (requestId: string) => {
    const entry = inspections.get(requestId)
    if (entry === undefined) return null
    clearTimer(entry.timer)
    inspections.delete(requestId)
    refreshBusy()
    return entry
  }

  const onProject = (frame: FrameOf<'project'>) => {
    // ほかのページの書き出しはブリッジが要求元だけへ返すので届かないが、期限切れの後に届いたものは捨てる
    if (!settleExport(frame.requestId)) return
    const project: ProjectFile = frame.project
    download(projectDownloadName(project, now()), projectDownloadText(project))
    notify('info', `プロジェクトを書き出しました(${describeNames(projectNames(project))})`)
  }

  const onInspection = (frame: FrameOf<'projectInspection'>) => {
    const entry = settleInspection(frame.requestId)
    if (entry === null) return
    if (!frame.result.ok) {
      notify('error', describeInspectionFailure(frame.result.detail))
      return
    }
    // 答えを待つ間に編集モードを切ったら出さない(読み込みは編集モードだけの操作。D-049 / D-081)
    if (!editing.value) {
      notify('info', '編集モードを切ったため、プロジェクトの読み込みをやめました')
      return
    }
    confirm.value = { project: entry.project, summary: frame.result.summary, activeSurface: activeSurface.value, activePad: activePad.value }
  }

  const onNotice = (notice: FrameOf<'notice'>) => {
    switch (notice.code) {
      case 'project-export-rejected': {
        notify('error', `プロジェクトを書き出せません: ${notice.detail}`)
        const oldest = exports.keys().next()
        if (oldest.done !== true) settleExport(oldest.value)
        break
      }
      case 'project-import-rejected':
        notify('error', `プロジェクトを読み込めません: ${notice.detail}`)
        break
      case 'project-imported': {
        // desiredStatus は採用の中で notice より先に届く。パッドだけのプロジェクトでは保持値に触れないので、
        // 未送信の値が無ければ「まだ送っていません」とは言わない
        const suffix = unsentSince.value !== null ? '。保持値はまだ Unity へ送っていません' : ''
        notify('info', `プロジェクトを読み込みました(${notice.detail})${suffix}`)
        break
      }
      default:
        break
    }
  }

  const dropPending = () => {
    const hadExports = exports.size > 0
    const hadInspections = inspections.size > 0
    for (const timer of exports.values()) clearTimer(timer)
    for (const entry of inspections.values()) clearTimer(entry.timer)
    exports.clear()
    inspections.clear()
    refreshBusy()
    if (hadExports) notify('warn', 'ブリッジとの接続が切れたため、プロジェクトを書き出せませんでした')
    if (hadInspections) notify('warn', 'ブリッジとの接続が切れたため、プロジェクトを確かめられませんでした')
  }

  /** 選んだファイルのバイト列を読んでブリッジに検査させる。 */
  const inspectBytes = (bytes: Uint8Array) => {
    if (!editing.value) return
    const read = readProjectBytes(bytes)
    if (!read.ok) {
      notify('error', `プロジェクトを読み込めません: ${read.message}`)
      return
    }
    const requestId = nextId('inspect')
    if (!link.send({ v: WIRE_PROTOCOL_VERSION, type: 'projectInspect', requestId, project: read.project })) {
      notify('error', 'ブリッジに接続していないため読み込めません')
      return
    }
    inspections.set(requestId, {
      project: read.project,
      timer: setTimer(() => {
        // 後から届く答えは印が無いので捨てる
        if (settleInspection(requestId) !== null) notify('warn', 'プロジェクトの確認の応答がありませんでした')
      }, PROJECT_TIMEOUT_MS),
    })
    refreshBusy()
  }

  const unsubscribe = [
    link.on('project', onProject),
    link.on('projectInspection', onInspection),
    link.on('notice', onNotice),
    link.on('desiredStatus', (frame) => {
      unsentSince.value = frame.unsent ? frame.since : null
    }),
    link.on('surfaceList', (frame) => {
      activeSurface.value = frame.active
    }),
    link.on('osc.padList', (frame) => {
      activePad.value = frame.active
    }),
    // 採用中の定義・保持値・未送信の状態とパッドの一覧の要求は、bridge-link が hello の後に送る(D-155)
    link.onConnectionChange((connected) => {
      if (connected) return
      batch(() => {
        dropPending()
        // 切れている間に確認のダイアログで「読み込む」を押しても送れないので閉じる
        confirm.value = null
        sendConfirm.value = false
      })
    }),
  ]

  return {
    connected: link.connected,
    editing,
    unsentSince,
    confirm,
    sendConfirm,
    exporting,
    inspecting,

    dispose() {
      for (const timer of exports.values()) clearTimer(timer)
      for (const entry of inspections.values()) clearTimer(entry.timer)
      for (const stop of unsubscribe) stop()
    },

    exportProject() {
      const requestId = nextId('export')
      if (!link.send({ v: WIRE_PROTOCOL_VERSION, type: 'projectExport', requestId })) {
        notify('error', 'ブリッジに接続していないため書き出せません')
        return
      }
      exports.set(requestId, setTimer(() => {
        // 断られたときは notice が別に届く。ここは応答そのものが来なかった場合
        if (settleExport(requestId)) notify('warn', 'プロジェクトの書き出しの応答がありませんでした')
      }, PROJECT_TIMEOUT_MS))
      refreshBusy()
    },

    inspectBytes,

    /** ファイルを選んだ。読む前に大きさで断る(巨大なファイルをメモリへ読み込まない)。 */
    async inspectFile(file: Blob) {
      if (file.size > PROJECT_UPLOAD_MAX_BYTES) {
        notify('error', 'ファイルが大きすぎるため読み込めません')
        return
      }
      let bytes: Uint8Array
      try {
        bytes = new Uint8Array(await file.arrayBuffer())
      } catch (error) {
        notify('error', `ファイルを読めません: ${error instanceof Error ? error.message : String(error)}`)
        return
      }
      inspectBytes(bytes)
    },

    cancelImport() {
      confirm.value = null
    },
    confirmImport() {
      const current = confirm.value
      confirm.value = null
      if (current === null) return
      if (!link.send({ v: WIRE_PROTOCOL_VERSION, type: 'projectImport', project: current.project })) {
        notify('error', 'ブリッジに接続していないため読み込めません')
        return
      }
      notify('info', 'プロジェクトの読み込みを要求しました')
    },

    openSend() {
      sendConfirm.value = true
    },
    cancelSend() {
      sendConfirm.value = false
    },
    /** 保持値を全宛先へ送らせる(上り resend。target を省くと全宛先で、未送信の状態が解ける。D-090)。 */
    confirmSend() {
      sendConfirm.value = false
      if (!link.send({ v: WIRE_PROTOCOL_VERSION, type: 'resend' })) {
        notify('error', 'ブリッジに接続していないため送れません')
        return
      }
      notify('info', '保持値の送信を要求しました')
    },
  }
}
