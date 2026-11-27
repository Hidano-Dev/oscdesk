// 「新しい一覧があります」(D-088)の画面(NiceGUI 版の pending_options.py から)。反映待ちがある間だけ描く
import { changeSummary, groupByList, HINT, listUsages, TITLE } from './pending-options-logic'
import type { PendingOptionsStore } from './pending-options-store'

export function PendingOptionsPanel({ store }: { store: PendingOptionsStore }) {
  const pending = store.pending.value
  if (pending.length === 0) return null
  const connected = store.connected.value
  const definition = store.definition.value
  return (
    <section class="panel card pending" aria-label={TITLE}>
      <header class="panel-head">
        <h2>{TITLE}</h2>
        <button type="button" class="warn" disabled={!connected} data-mark="pending-apply-all" onClick={() => store.apply()}>すべて反映</button>
      </header>
      <p class="caption">{HINT}</p>
      {groupByList(pending).map(({ list, items }) => {
        const usages = listUsages(definition, list)
        return (
          <div class="pending-row" key={list} data-pending-list={list}>
            <div class="pending-body">
              {/* 使っている欄で示す(一覧の id は定義の中の名前で、操作者には分かりにくい) */}
              <p class="caption strong break">{usages.length === 0 ? list : usages.join('、')}</p>
              {items.map((item) => <p class="caption break" key={`${item.target}|${item.host ?? ''}`}>{changeSummary(item)}</p>)}
            </div>
            <button type="button" class="flat warn-text" disabled={!connected} data-mark="pending-apply" onClick={() => store.apply(list)}>反映</button>
          </div>
        )
      })}
    </section>
  )
}
