import path from 'node:path'

import { isValidSurfaceName } from '@oscdesk/shared'

import type { PadActiveStore } from '../domain/pad-manager'

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
      } catch (error) {
        // 無いだけなら「選択なし」。権限・I/O エラー等で読めないときまで黙ると、採用中のパッドが消えた理由が分からない
        if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return undefined
        logWarn('(WARN, BRIDGE)', `Failed to read pad selection file "${file}".`, error)
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
