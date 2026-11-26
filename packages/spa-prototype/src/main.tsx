// 試作の SPA の入口(HID-461)。ブリッジが --spa-prototype で /spa/ に配り、同じオリジンの WebSocket(ブリッジの 7080)につなぐ
import { render } from 'preact'
import { useEffect } from 'preact/hooks'

import { DestinationsPanel } from './destinations-panel'
import { createDestinationsStore, type DestinationsStore, type Notice } from './destinations-store'

const NOTICE_MS = 5_000

function Notices({ store }: { store: DestinationsStore }) {
  return (
    <div class="notices" role="status" aria-live="polite">
      {store.notices.value.map((notice) => <NoticeItem key={notice.id} notice={notice} onDone={() => store.dismissNotice(notice.id)} />)}
    </div>
  )
}

function NoticeItem({ notice, onDone }: { notice: Notice; onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice.id])
  return <div class={`notice ${notice.level}`} onClick={onDone}>{notice.text}</div>
}

function App({ store }: { store: DestinationsStore }) {
  const connected = store.connected.value
  return (
    <main>
      <p class={connected ? 'link ok' : 'link lost'}>{connected ? 'ブリッジに接続中' : 'ブリッジに接続していません(再接続を試みています)'}</p>
      <DestinationsPanel store={store} />
      <Notices store={store} />
    </main>
  )
}

const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
const store = createDestinationsStore({ url: `${scheme}//${location.host}/`, createSocket: (url) => new WebSocket(url) })
store.start()
render(<App store={store} />, document.getElementById('app') as HTMLElement)
