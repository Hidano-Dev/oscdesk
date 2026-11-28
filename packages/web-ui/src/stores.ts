// SPA のすべての store を 1 回だけ作って結ぶ(D-155・D-156)。main.tsx と、パネルをまとめて確かめるテストが同じ組み立てを使う
// (テストだけ別の組み立てにすると、本体で起きる重なり(同じ要求・同じ通知を 2 つのパネルが出すなど)を見逃す)。
//
// - 接続(bridge-link)と通知(notices)はすべての store で共有する。接続ごとの初期の要求は bridge-link が送る
// - 主画面はパッド(D-170)。プロジェクトファイル(版 3。D-175)の書き出し・読み込みは「同期」タブ
import type { BridgeLink } from './bridge-link'
import { createDestinationsStore } from './destinations-store'
import { createNetworkStore } from './network-store'
import type { Notices } from './notices'
import { createPadEditStore } from './pad-edit-store'
import { createPadStore } from './pad-store'
import { createProjectStore } from './project-store'
import { createSentLogStore } from './sent-log-store'
import { createUnityLinkStore } from './unity-link-store'

export interface AppStoreDeps {
  link: BridgeLink
  notices: Notices
  /** テストで時計を差し替える。省けば本物の時計 */
  now?: () => number
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  /** 操作者の印(テストで固定する) */
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
  const pad = createPadStore({
    link, notices, ...now, ...timers, ...randomId,
    ...(deps.holder === undefined ? {} : { holder: deps.holder, holderLabel: 'test' }),
  })
  return {
    destinations: createDestinationsStore({ link, notices, ...now, ...timers }),
    pad,
    padEdit: createPadEditStore({ link, notices, pad, ...timers, ...randomId }),
    sentLog: createSentLogStore({ link, notices }),
    network: createNetworkStore({ link, notices, ...timers }),
    project: createProjectStore({ link, notices, ...timers, ...randomId }),
    unityLink: createUnityLinkStore({ link, notices }),
  }
}
