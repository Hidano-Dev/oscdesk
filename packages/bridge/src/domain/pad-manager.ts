import { randomBytes } from 'node:crypto'

import type { DownstreamFrame, OscArg, OscPad, UpstreamFrame } from '@oscdesk/shared'

import { formatSurfaceStoreError, type NamedJsonStore } from './named-store'
import { applyPadEdit, type PadEditResult } from './pad-editor'

type ClientId = string
type LogFn = (message?: unknown, ...optionalParams: unknown[]) => void

export type FirePad = (address: string, args: readonly OscArg[]) => { ok: true } | { ok: false; reason: string }

/** 採用中のパッドの名前の保存先(ブリッジ再起動をまたいで切り替えを保つ。D-080)。 */
export interface PadActiveStore {
  load(): string | undefined
  save(name: string): void
}

export interface PadManager {
  /** 前回採用していたパッドを読み込む。失敗しても起動は続け、採用なしのまま警告する。 */
  start(): void
  /** パッド関連の上りフレームなら処理して true を返す。 */
  handleUiFrame(frame: UpstreamFrame, clientId: ClientId): boolean
  /** 採用中のパッド(プロジェクトの書き出し。D-090)。 */
  active(): { name: string; pad: OscPad } | null
  /**
   * プロジェクトの取り込み(D-090)。padSave と同じく保存して採用する。pad は呼び出し側が OscPadStoredSchema と同じ規則
   * (形・意味・大きさ)で確かめたもので、ここでは検証し直さない。書き込みに失敗したら採用せずに理由を返す
   */
  importPad(name: string, pad: OscPad): { ok: true } | { ok: false; detail: string }
}

/**
 * OSC パッド(D-080)の保管・採用・配信と押下の送信。サーフェス定義の surface-manager と同じ形で、
 * 不正なパッドは採用せず直前のものを維持し、要求元だけに理由を返す。
 */
export function createPadManager(deps: {
  store: NamedJsonStore<OscPad>
  activeStore: PadActiveStore
  publish: (frame: DownstreamFrame, target?: ClientId) => void
  fire: FirePad
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
  let active: { name: string; revision: number; version: string; at: string; pad: OscPad } | null = null
  let revision = 0

  const listFrame = (): DownstreamFrame => ({ v: 1, type: 'osc.padList', names: deps.store.list(), active: active?.name ?? null })

  const padFrame = (): DownstreamFrame | null => active === null ? null : {
    v: 1, type: 'osc.pad', name: active.name, revision: active.revision, version: active.version, at: active.at, pad: active.pad,
  }

  const reject = (clientId: ClientId, code: string, detail: string) => {
    logWarn('(WARN, BRIDGE)', `Pad request rejected (${code}): ${detail}`)
    deps.publish({ v: 1, type: 'notice', level: 'error', code, detail }, clientId)
  }

  const adopt = (name: string, pad: OscPad, persist: boolean) => {
    revision += 1
    active = { name, revision, version: `${epoch}-${String(revision)}`, at: new Date(now()).toISOString(), pad }
    const frame = padFrame()
    if (frame !== null) deps.publish(frame)
    deps.publish(listFrame())
    if (persist) deps.activeStore.save(name)
    logInfo('(INFO, BRIDGE)', `Pad "${name}" adopted (revision ${String(revision)}).`)
  }

  return {
    active: () => active === null ? null : { name: active.name, pad: active.pad },
    importPad(name, pad) {
      const saved = deps.store.saveValidated(name, pad)
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
    handleUiFrame(frame, clientId) {
      switch (frame.type) {
        case 'osc.padRequest': {
          deps.publish(listFrame(), clientId)
          const current = padFrame()
          if (current !== null) deps.publish(current, clientId)
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
        case 'osc.padPress': {
          // 別の端末がパッドを切り替えた・同じ名前で上書き保存した直後の古い画面からの押下は、
          // 同じ id の別のボタンを撃たないよう、名前と版(採用ごとに一意な version。ブリッジの再起動をまたいでも重ならない)の両方で断る
          if (active === null || active.name !== frame.name || active.version !== frame.version) {
            reject(clientId, 'pad-press-rejected', `stale-pad: ${frame.name}@${frame.version}`)
            return true
          }
          const button = active.pad.buttons.find(candidate => candidate.id === frame.button)
          if (button === undefined) {
            reject(clientId, 'pad-press-rejected', `unknown-button: ${frame.button}`)
            return true
          }
          const result = deps.fire(button.address, button.args)
          if (!result.ok) reject(clientId, 'pad-press-rejected', result.reason)
          return true
        }
        default:
          return false
      }
    },
  }
}
