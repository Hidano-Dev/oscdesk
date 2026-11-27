// SPA のすべての store を 1 回だけ作って結ぶ(D-155・D-156)。main.tsx と、パネルをまとめて確かめるテストが同じ組み立てを使う
// (テストだけ別の組み立てにすると、本体で起きる重なり(同じ要求・同じ通知を 2 つのパネルが出すなど)を見逃す)。
//
// - 接続(bridge-link)と通知(notices)はすべての store で共有する。接続ごとの初期の要求は bridge-link が送る
// - 編集モードはページ全体で 1 つ(edit-mode)。入り切りは定義の編集(editor-store)に任せ、プロジェクトの読み込みも同じ状態を見る
import type { BridgeLink } from './bridge-link'
import { createBlueprintStore } from './blueprint-store'
import { createDestinationsStore } from './destinations-store'
import { createEditMode } from './edit-mode'
import { createEditorStore } from './editor-store'
import { createNetworkStore } from './network-store'
import type { Notices } from './notices'
import { createOscPadStore } from './osc-pad-store'
import { createPendingOptionsStore } from './pending-options-store'
import { createProjectStore } from './project-store'
import { createSentLogStore } from './sent-log-store'
import { createSurfaceStore } from './surface-store'

export interface AppStoreDeps {
  link: BridgeLink
  notices: Notices
  /** テストで時計を差し替える。省けば本物の時計 */
  now?: () => number
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  /** 主画面の操作者の印(テストで固定する) */
  holder?: string
  randomId?: () => string
}

export type AppStores = ReturnType<typeof createAppStores>

export function createAppStores(deps: AppStoreDeps) {
  const { link, notices } = deps
  const timers = {
    ...(deps.setTimer === undefined ? {} : { setTimer: deps.setTimer }),
    ...(deps.clearTimer === undefined ? {} : { clearTimer: deps.clearTimer }),
  }
  const now = deps.now === undefined ? {} : { now: deps.now }
  const randomId = deps.randomId === undefined ? {} : { randomId: deps.randomId }
  const editor = createEditorStore({ link, notices, ...timers, ...randomId })
  const editMode = createEditMode(editor)
  return {
    destinations: createDestinationsStore({ link, notices, ...now, ...timers }),
    surface: createSurfaceStore({
      link, notices, ...now,
      ...(deps.setTimer === undefined ? {} : { setTimer: deps.setTimer }),
      ...(deps.holder === undefined ? {} : { holder: deps.holder, holderLabel: 'test' }),
    }),
    pad: createOscPadStore({ link, notices, ...timers, ...randomId }),
    sentLog: createSentLogStore({ link, notices }),
    editor,
    network: createNetworkStore({ link, notices, ...timers }),
    editMode,
    pendingOptions: createPendingOptionsStore({ link, notices }),
    project: createProjectStore({ link, notices, editing: editMode.editing, ...timers }),
    blueprint: createBlueprintStore({ link, notices }),
  }
}
