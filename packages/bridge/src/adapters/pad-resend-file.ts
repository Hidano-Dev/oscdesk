import { z } from 'zod'

import { BOOT_ID_PATTERN, MAX_BOOT_IDS, type PadResendState, type PadResendStore } from '../domain/pad-resend'
import { describeError, readJsonFile, writeJsonFileAtomically, type JsonFileFs } from './json-file'

// 自動の再送の設定と、見たターゲットの起動 ID(D-169)を残すファイル。既定は保持値の保管先の `.pad-resend.json`
// (先頭の . はパッド・定義の名前の規則に合わないので、どの一覧にも混ざらない)。
// 起動 ID はターゲットが起動したときにしか変わらないが、ブロードキャストの宛先では答えた PC の数だけ来るので、書き込みは間引く

export const DEFAULT_PAD_RESEND_FILE_NAME = '.pad-resend.json'
const FORMAT = 'oscdesk-pad-resend'
const VERSION = 1
const WRITE_DELAY_MS = 500

const PadResendFileSchema = z.object({
  format: z.literal(FORMAT),
  version: z.literal(VERSION),
  auto: z.boolean(),
  boots: z.array(z.object({ target: z.string().min(1).max(300), bootId: z.string().regex(BOOT_ID_PATTERN) }).strict()).max(MAX_BOOT_IDS),
}).strict()

type TimerHandle = ReturnType<typeof setTimeout> | number
type LogFn = (message?: unknown, ...optionalParams: unknown[]) => void

export interface PadResendFileStore extends PadResendStore {
  close(): void
}

export function createPadResendFile(options: {
  file: string
  fs: JsonFileFs
  pid?: number
  setTimeoutFn?: (cb: () => void, ms: number) => TimerHandle
  clearTimeoutFn?: (handle: TimerHandle) => void
  logWarn?: LogFn
}): PadResendFileStore {
  const logWarn = options.logWarn ?? console.warn
  const pid = options.pid ?? process.pid
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout
  let pending: PadResendState | null = null
  let timer: TimerHandle | null = null

  const flush = () => {
    if (timer !== null) {
      clearTimeoutFn(timer)
      timer = null
    }
    if (pending === null) return
    const state = pending
    pending = null
    try {
      writeJsonFileAtomically(options.fs, options.file, { format: FORMAT, version: VERSION, auto: state.auto, boots: state.boots }, pid)
    } catch (error) {
      // 覚えられなくても再送の判定は続ける(ブリッジを再起動すると、動いていたターゲットを一度だけ起動とみなしうる)
      logWarn('(WARN, BRIDGE)', `Failed to save the pad resend settings to "${options.file}": ${describeError(error)}`)
    }
  }

  return {
    load() {
      const read = readJsonFile(options.fs, options.file)
      if (read.kind === 'missing') return null
      if (read.kind === 'failed') {
        logWarn('(WARN, BRIDGE)', `Ignoring the pad resend settings: ${read.reason}`)
        return null
      }
      const parsed = PadResendFileSchema.safeParse(read.json)
      if (!parsed.success) {
        // 壊れていれば既定(自動の再送は切)から始める。勝手に送り直す側へは倒さない
        logWarn('(WARN, BRIDGE)', `Ignoring the broken pad resend settings file "${options.file}".`)
        return null
      }
      return { auto: parsed.data.auto, boots: parsed.data.boots }
    },
    save(state) {
      pending = { auto: state.auto, boots: state.boots.map(entry => ({ ...entry })) }
      // 間引いて最後の状態だけを書く(終了時は close で書き切る)
      if (timer === null) timer = setTimeoutFn(() => {
        timer = null
        flush()
      }, WRITE_DELAY_MS)
    },
    close: flush,
  }
}
