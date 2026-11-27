// 画面の下に出す通知(D-138)。どのパネルも同じ 1 つの列に出す。
// 古いものから消え、出せるのは NOTICE_LIMIT 件まで。消す時間は画面(notices-view)が持つ
//
// 通知はすべて notify を通るので、ここで履歴(D-147)にも残す。パネルは何もしなくても履歴に載る。履歴はこのタブの
// メモリにだけ持つ(ページごと。閉じる・読み込み直すと消える。他の端末の通知は混ざらない)
import { signal, type ReadonlySignal } from '@preact/signals'

export type NoticeLevel = 'info' | 'warn' | 'error'
export interface Notice { id: number; level: NoticeLevel; text: string }
/** 履歴の 1 件。at は通知した時刻(ミリ秒の epoch)。 */
export interface NoticeRecord { seq: number; at: number; level: NoticeLevel; text: string }

export const NOTICE_LIMIT = 5
/** 履歴に残す件数。 */
export const NOTICE_HISTORY_LIMIT = 200

export interface Notices {
  readonly items: ReadonlySignal<readonly Notice[]>
  /** これまでの通知(古い順。末尾が新しい)。消した通知も残る。 */
  readonly history: ReadonlySignal<readonly NoticeRecord[]>
  notify(level: NoticeLevel, text: string): void
  dismiss(id: number): void
  /** 履歴を空にする(画面の通知はそのまま)。 */
  clearHistory(): void
}

export function createNotices(options: { now?: () => number } = {}): Notices {
  const now = options.now ?? Date.now
  const items = signal<readonly Notice[]>([])
  const history = signal<readonly NoticeRecord[]>([])
  let seq = 0
  return {
    items,
    history,
    notify(level, text) {
      seq += 1
      items.value = [...items.value, { id: seq, level, text }].slice(-NOTICE_LIMIT)
      history.value = [...history.value, { seq, at: now(), level, text }].slice(-NOTICE_HISTORY_LIMIT)
    },
    dismiss(id) {
      items.value = items.value.filter((notice) => notice.id !== id)
    },
    clearHistory() {
      history.value = []
    },
  }
}
