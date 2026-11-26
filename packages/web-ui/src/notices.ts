// 画面の下に出す通知(D-138)。どのパネルも同じ 1 つの列に出す(NiceGUI 版の notify_history に当たる)。
// 古いものから消え、出せるのは NOTICE_LIMIT 件まで。消す時間は画面(notices-view)が持つ
import { signal, type ReadonlySignal } from '@preact/signals'

export type NoticeLevel = 'info' | 'warn' | 'error'
export interface Notice { id: number; level: NoticeLevel; text: string }

export const NOTICE_LIMIT = 5

export interface Notices {
  readonly items: ReadonlySignal<readonly Notice[]>
  notify(level: NoticeLevel, text: string): void
  dismiss(id: number): void
}

export function createNotices(): Notices {
  const items = signal<readonly Notice[]>([])
  let seq = 0
  return {
    items,
    notify(level, text) {
      seq += 1
      items.value = [...items.value, { id: seq, level, text }].slice(-NOTICE_LIMIT)
    },
    dismiss(id) {
      items.value = items.value.filter((notice) => notice.id !== id)
    },
  }
}
