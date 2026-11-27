// SPA の画面の枠(D-138)。接続の状態・パネル・通知を並べる。パネルを足すときは、ここに store を受けて置く
// (store は main.tsx で 1 回だけ作り、接続(bridge-link)と通知(notices)をすべてのパネルで共有する)
import { useEffect } from 'preact/hooks'

import { BlueprintPanel } from './blueprint-panel'
import type { BlueprintStore } from './blueprint-store'
import type { BridgeLink, LinkStatus } from './bridge-link'
import { DestinationsPanel } from './destinations-panel'
import type { DestinationsStore } from './destinations-store'
import type { EditMode } from './edit-mode'
import { EditorPanel } from './editor-panel'
import type { EditorStore } from './editor-store'
import { NetworkPanel } from './network-panel'
import type { NetworkStore } from './network-store'
import type { Notice, Notices } from './notices'
import { PendingOptionsPanel } from './pending-options-panel'
import type { PendingOptionsStore } from './pending-options-store'
import { ProjectPanel } from './project-panel'
import type { ProjectStore } from './project-store'
import { Check } from './widgets'

/** 通知が消えるまで。 */
export const NOTICE_MS = 5_000

export const STATUS_TEXT: Record<LinkStatus, string> = {
  connecting: 'ブリッジに接続しています…',
  open: 'ブリッジに接続中',
  reconnecting: 'ブリッジに接続していません(再接続を試みています)',
  'not-allowed': 'このブラウザは接続してよいブラウザの範囲の外です。サーバー PC の http://localhost から「ネットワーク」タブで範囲を確かめてください',
}

const STATUS_CLASS: Record<LinkStatus, string> = { connecting: 'link lost', open: 'link ok', reconnecting: 'link lost', 'not-allowed': 'link blocked' }

export interface AppProps {
  link: BridgeLink
  notices: Notices
  destinations: DestinationsStore
  editor?: EditorStore
  network?: NetworkStore
  // HID-467(D-150〜D-152)。渡さなければそのパネルを出さない
  editMode?: EditMode
  pendingOptions?: PendingOptionsStore
  project?: ProjectStore
  blueprint?: BlueprintStore
}

export function App({ link, notices, destinations, editor, network, editMode, pendingOptions, project, blueprint }: AppProps) {
  const status = link.status.value
  return (
    <main>
      <header class="app-head">
        <h1>OscDesk</h1>
        <p class={STATUS_CLASS[status]} role="status">{STATUS_TEXT[status]}</p>
        {editMode !== undefined && <Check label="編集モード" checked={editMode.editing.value} disabled={false} onChange={editMode.set} />}
      </header>
      {pendingOptions !== undefined && <PendingOptionsPanel store={pendingOptions} />}
      <DestinationsPanel store={destinations} />
      {editor !== undefined && <EditorPanel store={editor} />}
      {project !== undefined && <ProjectPanel store={project} />}
      {blueprint !== undefined && <BlueprintPanel store={blueprint} />}
      {network !== undefined && <NetworkPanel store={network} />}
      <p class="caption security">OscDesk には認証がありません。信頼できる LAN の中だけで使ってください。</p>
      <NoticesView notices={notices} />
    </main>
  )
}

function NoticesView({ notices }: { notices: Notices }) {
  return (
    <div class="notices" aria-live="polite">
      {notices.items.value.map((notice) => <NoticeItem key={notice.id} notice={notice} onDone={() => notices.dismiss(notice.id)} />)}
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
