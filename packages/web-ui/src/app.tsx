// SPA の画面の枠(D-138・D-156・D-170)。上に接続の状態(ブリッジと Unity。D-158)、その下にタブ(パッド・同期・送信先・ネットワーク)を置く。
// 主画面はパッド(D-170)。サーフェス定義の主画面・編集モード・設計図・版 1 の OSC パッドのタブは外した(コードの撤去は HID-491)。
// 送信先は広い画面では右側に出し続け、狭い画面(スマホ)ではタブの 1 つにする。
// 広い画面の右の列は幅をつまみで変えられ(D-159)、パッドの部品を編集する間は Inspector がその場所を借りる(D-160)。
//
// - タブの中身は切り替えても消さずに隠す(打ちかけの入力欄・操作中の部品・開いたダイアログを、タブの切り替えで壊さない)
// - store は stores.ts で 1 回だけ作り、接続(bridge-link)と通知(notices)をすべてのパネルで共有する。パネルを足すときは、
//   ここに store を受けて置く(渡さなければそのパネルを出さない。パネルごとのテストは要るものだけを渡す)
import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'

import { AsideHandle } from './aside-handle'
import type { BridgeLink, LinkStatus } from './bridge-link'
import { DestinationsPanel } from './destinations-panel'
import type { DestinationsStore } from './destinations-store'
import { LogDrawer } from './log-drawer'
import { NetworkPanel } from './network-panel'
import type { NetworkStore } from './network-store'
import type { Notice, Notices } from './notices'
import type { PadEditStore } from './pad-edit-store'
import { PadInspector } from './pad-inspector'
import { PadPanel, inspecting } from './pad-panel'
import type { PadStore } from './pad-store'
import { PadSyncPanel } from './pad-sync-panel'
import type { SentLogStore } from './sent-log-store'
import { UnityLinkStatus } from './resend-panel'
import type { UnityLinkStore } from './unity-link-store'
import { ModalRoot } from './widgets'

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

export type AppTab = 'pad' | 'sync' | 'destinations' | 'network'

export interface AppProps {
  link: BridgeLink
  notices: Notices
  destinations: DestinationsStore
  /** 主画面のパッド(D-170)。実行と編集の store を一緒に渡す。省くと出さない(宛先パネルだけのテスト) */
  pad?: PadStore
  padEdit?: PadEditStore
  sentLog?: SentLogStore
  network?: NetworkStore
  /** Unity の接続状態(HID-471。D-158) */
  unityLink?: UnityLinkStore
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
  const { link, notices, destinations, pad, padEdit, sentLog, network, unityLink } = props
  const status = link.status.value
  const wide = useWide()
  const hasPad = pad !== undefined && padEdit !== undefined
  const [tab, setTab] = useState<AppTab>(hasPad ? 'pad' : 'network')
  // 広い画面では送信先は右側に出ているので、そのタブを選んでいたらパッドを見せる(狭い画面から広げたとき)
  const shown: AppTab = tab === 'destinations' && wide ? (hasPad ? 'pad' : 'network') : tab
  // パッドの Inspector は、広い画面でパッドのタブを見ている間だけ右の列(送信先の場所)に出す(D-091・D-160)。
  // ほかのタブを見ている間は送信先を出す(見えないパッドの設定が送信先の場所を塞がないように。選択と作業コピーは保つ)
  const padInspectorInAside = wide && shown === 'pad'
  const padInspecting = padInspectorInAside && padEdit !== undefined && inspecting(padEdit)
  const body = useRef<HTMLDivElement>(null)
  const [modalRoot, setModalRoot] = useState<HTMLElement | null>(null)

  const tabs: { id: AppTab; label: string }[] = [
    ...(hasPad ? [{ id: 'pad' as const, label: 'パッド' }, { id: 'sync' as const, label: '同期' }] : []),
    ...(wide ? [] : [{ id: 'destinations' as const, label: '送信先' }]),
    ...(network !== undefined ? [{ id: 'network' as const, label: 'ネットワーク' }] : []),
  ]

  return (
    <ModalRoot.Provider value={modalRoot}>
    <div class="shell">
      <header class="app-head">
        <h1>OscDesk</h1>
        <p class={STATUS_CLASS[status]} role="status">{STATUS_TEXT[status]}</p>
        {unityLink !== undefined && <UnityLinkStatus store={unityLink} />}
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
          </button>
        ))}
      </nav>
      <div class="app-body" ref={body}>
        <main class="app-main">
          {pad !== undefined && padEdit !== undefined && <TabPanel id="pad" shown={shown}><PadPanel pad={pad} edit={padEdit} inspectorInAside={padInspectorInAside} /></TabPanel>}
          {pad !== undefined && padEdit !== undefined && <TabPanel id="sync" shown={shown}><PadSyncPanel pad={pad} /></TabPanel>}
          {network !== undefined && <TabPanel id="network" shown={shown}><NetworkPanel store={network} /></TabPanel>}
        </main>
        {/* 右の列の幅のつまみ(D-159)。右の列が横に並ぶ広い画面でだけ置く */}
        {wide && <AsideHandle frame={body} />}
        <aside
          class="app-aside"
          id="panel-destinations"
          role={wide ? undefined : 'tabpanel'}
          aria-labelledby={wide ? undefined : 'tab-destinations'}
          hidden={!wide && shown !== 'destinations'}
        >
          {/* Inspector が借りている間も送信先パネルは作り直さず隠すだけにする(応答待ちの未確定の選択を消さない。D-086) */}
          <div class="aside-view" hidden={padInspecting}>
            <DestinationsPanel store={destinations} />
          </div>
          {padInspecting && padEdit !== undefined && <PadInspector edit={padEdit} />}
        </aside>
      </div>
      <p class="caption security">OscDesk には認証がありません。信頼できる LAN の中だけで使ってください。</p>
      {sentLog !== undefined && <LogDrawer store={sentLog} />}
      <NoticesView notices={notices} />
      {/* ダイアログはここに描く(右の列の sticky などの重なりの文脈の外。D-161) */}
      <div class="modal-root" ref={setModalRoot} />
    </div>
    </ModalRoot.Provider>
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
