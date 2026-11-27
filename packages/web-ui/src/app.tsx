// SPA の画面の枠(D-138・D-156)。上に接続の状態と編集モードのスイッチ、その下にタブ(主画面・OSC パッド・設計図・送信先・
// ネットワーク)を置く。NiceGUI 版の page.py の並び(主画面の画面ごとのタブの後に OSC パッド・設計図・ネットワーク、右側に
// 送信先)に合わせる。送信先は広い画面では右側に出し続け、狭い画面(スマホ)ではタブの 1 つにする。
//
// - タブの中身は切り替えても消さずに隠す(打ちかけの入力欄・操作中の部品・開いたダイアログを、タブの切り替えで壊さない)
// - store は stores.ts で 1 回だけ作り、接続(bridge-link)と通知(notices)をすべてのパネルで共有する。パネルを足すときは、
//   ここに store を受けて置く(渡さなければそのパネルを出さない。パネルごとのテストは要るものだけを渡す)
import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'

import { BlueprintPanel } from './blueprint-panel'
import type { BlueprintStore } from './blueprint-store'
import type { BridgeLink, LinkStatus } from './bridge-link'
import { DestinationsPanel } from './destinations-panel'
import type { DestinationsStore } from './destinations-store'
import type { EditMode } from './edit-mode'
import { EditorPanel } from './editor-panel'
import type { EditorStore } from './editor-store'
import { LogDrawer } from './log-drawer'
import { NetworkPanel } from './network-panel'
import type { NetworkStore } from './network-store'
import type { Notice, Notices } from './notices'
import { OscPadPanel } from './osc-pad-panel'
import type { OscPadStore } from './osc-pad-store'
import { PendingOptionsPanel } from './pending-options-panel'
import type { PendingOptionsStore } from './pending-options-store'
import { ProjectPanel } from './project-panel'
import type { ProjectStore } from './project-store'
import type { SentLogStore } from './sent-log-store'
import { SurfacePanel } from './surface-panel'
import type { SurfaceStore } from './surface-store'
import { Check } from './widgets'

/** 通知が消えるまで。 */
export const NOTICE_MS = 5_000

/** これより広い画面では送信先を右側に出し続ける(app.css の @media と同じ値)。 */
export const WIDE_MEDIA = '(min-width: 960px)'

export const STATUS_TEXT: Record<LinkStatus, string> = {
  connecting: 'ブリッジに接続しています…',
  open: 'ブリッジに接続中',
  reconnecting: 'ブリッジに接続していません(再接続を試みています)',
  'not-allowed': 'このブラウザは接続してよいブラウザの範囲の外です。サーバー PC の http://localhost から「ネットワーク」タブで範囲を確かめてください',
}

const STATUS_CLASS: Record<LinkStatus, string> = { connecting: 'link lost', open: 'link ok', reconnecting: 'link lost', 'not-allowed': 'link blocked' }

export type AppTab = 'surface' | 'pad' | 'blueprint' | 'destinations' | 'network'

export interface AppProps {
  link: BridgeLink
  notices: Notices
  destinations: DestinationsStore
  /** 主画面(HID-464)。省くと出さない(宛先パネルだけのテスト) */
  surface?: SurfaceStore
  pad?: OscPadStore
  sentLog?: SentLogStore
  editor?: EditorStore
  network?: NetworkStore
  // HID-467(D-150〜D-152)。渡さなければそのパネルを出さない
  editMode?: EditMode
  pendingOptions?: PendingOptionsStore
  project?: ProjectStore
  blueprint?: BlueprintStore
}

/** 広い画面か。matchMedia の無い環境(テストの DOM の一部)では広い画面とみなす。 */
function useWide(): boolean {
  const query = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(WIDE_MEDIA) : null
  const [wide, setWide] = useState(query?.matches ?? true)
  useEffect(() => {
    if (query === null) return
    const onChange = () => setWide(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return wide
}

export function App(props: AppProps) {
  const { link, notices, destinations, surface, pad, sentLog, editor, network, editMode, pendingOptions, project, blueprint } = props
  const status = link.status.value
  const wide = useWide()
  const [tab, setTab] = useState<AppTab>('surface')
  const padShown = pad !== undefined && pad.oscAvailable.value
  // 広い画面では送信先は右側に出ているので、そのタブを選んでいたら主画面を見せる(狭い画面から広げたとき)。
  // OSC のアダプタが無くなったら OSC パッドのタブも主画面へ戻す
  const shown: AppTab = (tab === 'destinations' && wide) || (tab === 'pad' && !padShown) ? 'surface' : tab
  const pendingCount = pendingOptions?.pending.value.length ?? 0

  const tabs: { id: AppTab; label: string; badge?: boolean }[] = [
    // 「新しい一覧があります」は主画面に出る。ほかのタブを見ている間も気づけるよう印を付ける
    { id: 'surface', label: '主画面', badge: pendingCount > 0 },
    ...(padShown ? [{ id: 'pad' as const, label: 'OSC パッド' }] : []),
    ...(blueprint !== undefined ? [{ id: 'blueprint' as const, label: '設計図' }] : []),
    ...(wide ? [] : [{ id: 'destinations' as const, label: '送信先' }]),
    ...(network !== undefined ? [{ id: 'network' as const, label: 'ネットワーク' }] : []),
  ]

  const setEditing = (checked: boolean) => {
    editMode?.set(checked)
    // 定義の編集も、切るときの破棄の確認(未保存の変更があるとき)も主画面のタブに出るので、入り切りのどちらでも
    // 主画面を見せる。切るときに戻さないと、別のタブから切った確認が隠れたままスイッチがオンに戻るだけになる(PR #161)
    setTab('surface')
  }

  return (
    <div class="shell">
      <header class="app-head">
        <h1>OscDesk</h1>
        <p class={STATUS_CLASS[status]} role="status">{STATUS_TEXT[status]}</p>
        {editMode !== undefined && <Check label="編集モード" checked={editMode.editing.value} disabled={false} onChange={setEditing} />}
      </header>
      <nav class="app-tabs" role="tablist" aria-label="画面">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`tab-${item.id}`}
            aria-selected={shown === item.id}
            aria-controls={`panel-${item.id}`}
            class={shown === item.id ? 'app-tab active' : 'app-tab'}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {item.badge === true && <span class="tab-badge" aria-label="新しい一覧があります">●</span>}
          </button>
        ))}
      </nav>
      <div class="app-body">
        <main class="app-main">
          <TabPanel id="surface" shown={shown}>
            {project !== undefined && <ProjectPanel store={project} />}
            {editor !== undefined && <EditorPanel store={editor} />}
            {/* 「一覧を更新」・Sync で届いた初報と違う一覧は、ここで反映を選ぶ(D-088・D-157) */}
            {pendingOptions !== undefined && <PendingOptionsPanel store={pendingOptions} />}
            {surface !== undefined && <SurfacePanel store={surface} />}
          </TabPanel>
          {pad !== undefined && <TabPanel id="pad" shown={shown}><OscPadPanel store={pad} /></TabPanel>}
          {blueprint !== undefined && <TabPanel id="blueprint" shown={shown}><BlueprintPanel store={blueprint} /></TabPanel>}
          {network !== undefined && <TabPanel id="network" shown={shown}><NetworkPanel store={network} /></TabPanel>}
        </main>
        <aside
          class="app-aside"
          id="panel-destinations"
          role={wide ? undefined : 'tabpanel'}
          aria-labelledby={wide ? undefined : 'tab-destinations'}
          hidden={!wide && shown !== 'destinations'}
        >
          <DestinationsPanel store={destinations} />
        </aside>
      </div>
      <p class="caption security">OscDesk には認証がありません。信頼できる LAN の中だけで使ってください。</p>
      {sentLog !== undefined && <LogDrawer store={sentLog} />}
      <NoticesView notices={notices} />
    </div>
  )
}

function TabPanel({ id, shown, children }: { id: AppTab; shown: AppTab; children: ComponentChildren }) {
  return (
    <div class="tab-panel" role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} hidden={shown !== id}>
      {children}
    </div>
  )
}

/**
 * 画面の下に重ねる通知。重なった分だけページの下に余白を足す(--notice-space)。足さないと、狭い画面でページの一番下の
 * ボタン(保存など)が通知の下に隠れて、スクロールしても押せない
 */
function NoticesView({ notices }: { notices: Notices }) {
  const ref = useRef<HTMLDivElement>(null)
  const items = notices.items.value
  useEffect(() => {
    const element = ref.current
    if (element === null || typeof document === 'undefined') return
    const height = items.length === 0 ? 0 : element.getBoundingClientRect().height
    document.documentElement.style.setProperty('--notice-space', `${String(Math.ceil(height))}px`)
  }, [items])
  return (
    <div class="notices" aria-live="polite" ref={ref}>
      {items.map((notice) => <NoticeItem key={notice.id} notice={notice} onDone={() => notices.dismiss(notice.id)} />)}
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
