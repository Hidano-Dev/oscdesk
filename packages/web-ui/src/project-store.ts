// プロジェクトファイル(D-090・D-175。版 3)の書き出し・読み込み(D-150)。
//
// - 書き出し: projectExport を送り、届いた project(同じ requestId)をブラウザでダウンロードさせる(Blob)
// - 読み込み: 選んだファイルをブラウザで読み(File API)、projectInspect でブリッジに検査させる。通れば確認のダイアログを
//   出し、「読み込む」で projectImport を送る。パッドと保持値はブリッジの osc.padDocument・osc.padValues で揃う(先に変えない)
// - 読み込んでも送り先へは送らない。送るのは「同期」タブの同期(自動の再送を入れていれば、ターゲットの起動でも送る。D-175)
// - 版 1・版 2 のファイルはブリッジが版 3 へ移す。落としたサーフェス定義は確認のダイアログと読み込みの通知で知らせる
//
// ページごとに自分の接続を持つので、答えが届いたらその場で処理する(待つのは印と期限だけ)

import { batch, signal } from '@preact/signals'

import { WIRE_PROTOCOL_VERSION, type ProjectFile } from '@oscdesk/shared'

import type { BridgeLink, FrameOf } from './bridge-link'
import type { Notices } from './notices'
import { describeRejection, projectDownloadName, projectDownloadText, readProjectBytes, PROJECT_UPLOAD_MAX_BYTES } from './project-logic'

/** 書き出し・検査の応答を待つ長さ。LAN 内で 12 MiB を運ぶのに十分で、届かなかったことに気づける長さ。 */
export const PROJECT_TIMEOUT_MS = 15_000

export type InspectionSummary = Extract<FrameOf<'projectInspection'>['result'], { ok: true }>['summary']

/** 確認のダイアログに出すもの。project は読み込んだファイル(「読み込む」でそのまま送る)。 */
export interface ImportConfirm { project: Record<string, unknown>; summary: InspectionSummary; activePad: string | null }

export interface ProjectStoreDeps {
  link: BridgeLink
  notices: Notices
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
  const { link } = deps
  const notify = deps.notices.notify
  const download = deps.download ?? browserDownload
  const now = deps.now ?? (() => new Date())
  const setTimer = deps.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms))
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const randomId = deps.randomId ?? defaultRandomId

  const activePad = signal<string | null>(null)
  const confirm = signal<ImportConfirm | null>(null)
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
    notify('info', `プロジェクトを書き出しました(パッド「${project.osc.pad.name}」)`)
  }

  const onInspection = (frame: FrameOf<'projectInspection'>) => {
    const entry = settleInspection(frame.requestId)
    if (entry === null) return
    if (!frame.result.ok) {
      notify('error', describeRejection(frame.result.detail))
      return
    }
    confirm.value = { project: entry.project, summary: frame.result.summary, activePad: activePad.value }
  }

  const onNotice = (notice: FrameOf<'notice'>) => {
    switch (notice.code) {
      case 'project-export-rejected': {
        notify('error', notice.detail.startsWith('empty:') ? '採用中のパッドが無いため書き出せません' : `プロジェクトを書き出せません: ${notice.detail}`)
        const oldest = exports.keys().next()
        if (oldest.done !== true) settleExport(oldest.value)
        break
      }
      case 'project-import-rejected':
        notify('error', describeRejection(notice.detail))
        break
      case 'project-imported':
        notify('info', `プロジェクトを読み込みました(${notice.detail})。値はまだ送り先へ送っていません(「同期」で送ります)`)
        break
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
    link.on('osc.padList', (frame) => {
      activePad.value = frame.active
    }),
    // パッドの一覧の要求は bridge-link が hello の後に送る(D-155)
    link.onConnectionChange((connected) => {
      if (connected) return
      batch(() => {
        dropPending()
        // 切れている間に確認のダイアログで「読み込む」を押しても送れないので閉じる
        confirm.value = null
      })
    }),
  ]

  return {
    connected: link.connected,
    activePad,
    confirm,
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
  }
}
