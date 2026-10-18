import path from 'node:path'

import { isValidSurfaceName, type DownstreamFrame, type OscArg, type OscPad, type UpstreamFrame } from '@oscdesk/shared'

import { formatSurfaceStoreError, type NamedJsonStore } from './surface-store'

type ClientId = string
type LogFn = (message?: unknown, ...optionalParams: unknown[]) => void

// 保管フォルダ内の隠しファイル(先頭の . はパッドの名前の規則に合わないので一覧に混ざらない)
const ACTIVE_FILE_NAME = '.active.json'
const ACTIVE_FORMAT = 'oscdesk-pad-active'

export interface PadActiveFs {
  readFileSync(file: string, encoding: 'utf8'): string
  writeFileSync(file: string, data: string, encoding: 'utf8'): void
  renameSync(from: string, to: string): void
  mkdirSync(dir: string, options: { recursive: true }): unknown
  rmSync(file: string, options: { force: true }): void
}

/** 採用中のパッドの名前を `<dir>/.active.json` に持つ。壊れていれば警告して「採用なし」から始める(起動は止めない)。 */
export function createPadActiveFile(options: { dir: string; fs: PadActiveFs; logWarn?: LogFn }): PadActiveStore {
  const file = path.join(path.resolve(options.dir), ACTIVE_FILE_NAME)
  const logWarn = options.logWarn ?? console.warn
  return {
    load() {
      let raw: string
      try {
        raw = options.fs.readFileSync(file, 'utf8')
      } catch {
        return undefined
      }
      try {
        const parsed = JSON.parse(raw.replace(/^﻿/, '')) as { format?: unknown; active?: unknown }
        if (parsed.format === ACTIVE_FORMAT && typeof parsed.active === 'string' && isValidSurfaceName(parsed.active)) return parsed.active
      } catch {
        // 下で警告する
      }
      logWarn('(WARN, BRIDGE)', `Ignoring broken pad selection file "${file}".`)
      return undefined
    },
    save(name) {
      const temp = `${file}.${String(process.pid)}.tmp`
      try {
        options.fs.mkdirSync(path.dirname(file), { recursive: true })
        options.fs.writeFileSync(temp, `${JSON.stringify({ format: ACTIVE_FORMAT, active: name })}\n`, 'utf8')
        options.fs.renameSync(temp, file)
      } catch (error) {
        options.fs.rmSync(temp, { force: true })
        // 選択を覚えられなくても押下・保存は続けられるので、警告に留める
        logWarn('(WARN, BRIDGE)', `Failed to remember pad selection "${name}".`, error)
      }
    },
  }
}

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
  logInfo?: LogFn
  logWarn?: LogFn
}): PadManager {
  const now = deps.now ?? Date.now
  const logInfo = deps.logInfo ?? console.info
  const logWarn = deps.logWarn ?? console.warn
  let active: { name: string; revision: number; at: string; pad: OscPad } | null = null
  let revision = 0

  const listFrame = (): DownstreamFrame => ({ v: 1, type: 'padList', names: deps.store.list(), active: active?.name ?? null })

  const padFrame = (): DownstreamFrame | null => active === null ? null : {
    v: 1, type: 'pad', name: active.name, revision: active.revision, at: active.at, pad: active.pad,
  }

  const reject = (clientId: ClientId, code: string, detail: string) => {
    logWarn('(WARN, BRIDGE)', `Pad request rejected (${code}): ${detail}`)
    deps.publish({ v: 1, type: 'notice', level: 'error', code, detail }, clientId)
  }

  const adopt = (name: string, pad: OscPad, persist: boolean) => {
    revision += 1
    active = { name, revision, at: new Date(now()).toISOString(), pad }
    const frame = padFrame()
    if (frame !== null) deps.publish(frame)
    deps.publish(listFrame())
    if (persist) deps.activeStore.save(name)
    logInfo('(INFO, BRIDGE)', `Pad "${name}" adopted (revision ${String(revision)}).`)
  }

  return {
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
        case 'padRequest': {
          deps.publish(listFrame(), clientId)
          const current = padFrame()
          if (current !== null) deps.publish(current, clientId)
          return true
        }
        case 'padLoad': {
          const loaded = deps.store.read(frame.name)
          if (!loaded.ok) {
            reject(clientId, 'pad-rejected', formatSurfaceStoreError(loaded.error, 'pad'))
            return true
          }
          adopt(frame.name, loaded.value, true)
          return true
        }
        case 'padSave': {
          const saved = deps.store.save(frame.name, frame.pad)
          if (!saved.ok) {
            reject(clientId, 'pad-rejected', formatSurfaceStoreError(saved.error, 'pad'))
            return true
          }
          adopt(frame.name, saved.value, true)
          return true
        }
        case 'padPress': {
          // 別の端末がパッドを切り替えた直後の古い画面からの押下は、同じ id の別のボタンを撃たないよう断る
          if (active === null || active.name !== frame.name) {
            reject(clientId, 'pad-press-rejected', `stale-pad: ${frame.name}`)
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
