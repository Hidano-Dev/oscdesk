// 送信ログと通知の履歴を見るドロワー(D-067・D-147。NiceGUI 版の log_drawer.py から)。
// 右側のドロワーに 2 つをまとめ、切り替えて見る。どちらも「後から見返す」ためのもので、操作画面を狭めないよう普段は閉じておく。
// 閉じている間は表を描かない(送信ログの並べ替えも読んだときだけ)。開いている間は届いたものがそのまま表に出る
import { noticeRow, pageOf, sentLogRow } from './sent-log-logic'
import type { SentLogStore } from './sent-log-store'

export function LogDrawer({ store }: { store: SentLogStore }) {
  const open = store.open.value
  return (
    <>
      <button type="button" class="drawer-toggle" aria-expanded={open} aria-controls="log-drawer" onClick={() => store.toggle()}>
        {store.oscAvailable.value ? 'ログ' : '通知履歴'}
      </button>
      {open && <Drawer store={store} />}
    </>
  )
}

function Drawer({ store }: { store: SentLogStore }) {
  const view = store.view.value
  return (
    <aside id="log-drawer" class="drawer" aria-label={view === 'sent' ? '送信ログ' : '通知履歴'}>
      <div class="drawer-head">
        {store.oscAvailable.value && (
          <div class="toggle" role="tablist">
            <button type="button" role="tab" aria-selected={view === 'sent'} class={view === 'sent' ? 'on' : ''} onClick={() => store.setView('sent')}>送信ログ</button>
            <button type="button" role="tab" aria-selected={view === 'notify'} class={view === 'notify' ? 'on' : ''} onClick={() => store.setView('notify')}>通知履歴</button>
          </div>
        )}
        <button type="button" class="icon" aria-label="閉じる" onClick={() => store.close()}>×</button>
      </div>
      {view === 'sent' ? <SentLogView store={store} /> : <NoticeHistoryView store={store} />}
    </aside>
  )
}

function SentLogView({ store }: { store: SentLogStore }) {
  const { rows, page, pages } = pageOf(store.records.value, store.page.value)
  return (
    <div class="drawer-body">
      <p class="caption">
        ブリッジが Unity へ送った OSC の直近の記録(新しい順)。同じアドレスへの連続送信は 1 行にまとめて回数を出す。ping は含まない。完全な証跡はデバッグ起動時の診断ログ(logs/diagnostics)にある。
      </p>
      <table class="log-table sent-log">
        <thead>
          <tr><th>時刻</th><th>契機</th><th>宛先</th><th>アドレス</th><th>引数</th><th class="num">回数</th><th>まとめ送り</th></tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={7} class="muted">まだ送っていません</td></tr>}
          {rows.map((record) => {
            const row = sentLogRow(record)
            return (
              <tr key={row.seq} data-seq={row.seq}>
                <td>{row.time}</td><td>{row.origin}</td><td class="break">{row.targets}</td><td class="break">{row.address}</td>
                <td class="break">{row.args}</td><td class="num">{row.count}</td><td>{row.batch}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <Pager store={store} page={page} pages={pages} />
    </div>
  )
}

function NoticeHistoryView({ store }: { store: SentLogStore }) {
  const history = store.notices.value
  const { rows, page, pages } = pageOf([...history].reverse(), store.page.value)
  return (
    <div class="drawer-body">
      <div class="panel-foot">
        <span class="caption">この画面に出た通知(新しい順)。ページを閉じると消える。</span>
        <button type="button" disabled={history.length === 0} onClick={() => store.clearNotices()}>消去</button>
      </div>
      <table class="log-table notice-log">
        <thead><tr><th>時刻</th><th>種類</th><th>本文</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={3} class="muted">通知はありません</td></tr>}
          {rows.map((record) => {
            const row = noticeRow(record)
            return <tr key={row.seq} class={record.level}><td>{row.time}</td><td>{row.level}</td><td class="wrap">{row.text}</td></tr>
          })}
        </tbody>
      </table>
      <Pager store={store} page={page} pages={pages} />
    </div>
  )
}

function Pager({ store, page, pages }: { store: SentLogStore; page: number; pages: number }) {
  if (pages <= 1) return null
  return (
    <div class="pager">
      <button type="button" disabled={page === 0} onClick={() => store.setPage(page - 1)}>前へ</button>
      <span class="caption">{page + 1} / {pages}</span>
      <button type="button" disabled={page >= pages - 1} onClick={() => store.setPage(page + 1)}>次へ</button>
    </div>
  )
}
