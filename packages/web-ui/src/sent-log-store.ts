// 送信ログとドロワーの状態(D-067・D-147)。送信ログは osc.sentLog の表示キャッシュで、ブリッジが接続のたびに
// 既存分を full: true で送り直すので、切断しても捨てない(つなぎ直しで置き換わる)。通知の履歴は notices が持つ
import { computed, signal } from '@preact/signals'

import type { SentLogRecord } from '@oscdesk/shared'

import type { BridgeLink } from './bridge-link'
import type { Notices } from './notices'
import { applySentLog, newestFirst } from './sent-log-logic'

export type DrawerView = 'sent' | 'notify'

export interface SentLogStoreDeps {
  link: BridgeLink
  notices: Notices
}

export type SentLogStore = ReturnType<typeof createSentLogStore>
export function createSentLogStore(deps: SentLogStoreDeps) {
  const { link, notices } = deps
  const records = signal<ReadonlyMap<number, SentLogRecord>>(new Map())
  // 送信ログは OSC 専用の機能(HID-373)。hello の adapters に osc が無いブリッジでは通知の履歴だけを出す。
  // 切れている間(hello が null)は最後に分かった値を使う(つなぎ直しのたびに表示が揺れないように)
  const oscAvailable = signal(true)
  const open = signal(false)
  const view = signal<DrawerView>('sent')
  const page = signal(0)

  const unsubscribe = [
    link.on('osc.sentLog', (frame) => {
      records.value = applySentLog(records.value, frame.full, frame.records)
    }),
    link.on('hello', (hello) => {
      oscAvailable.value = hello.adapters.includes('osc')
    }),
  ]

  // 並べ替えは読んだときだけ(ドロワーを閉じている間は計算しない)
  const sorted = computed(() => newestFirst(records.value))

  return {
    records: sorted,
    notices: notices.history,
    oscAvailable,
    open,
    view: computed<DrawerView>(() => (oscAvailable.value ? view.value : 'notify')),
    page,
    dispose() {
      for (const stop of unsubscribe) stop()
    },
    toggle() {
      open.value = !open.value
    },
    close() {
      open.value = false
    },
    setView(next: DrawerView) {
      view.value = next
      page.value = 0
    },
    setPage(next: number) {
      page.value = next
    },
    clearNotices() {
      notices.clearHistory()
      page.value = 0
    },
  }
}
