// ヘッダーの Unity の接続状態(D-158)。
// 持つのはブリッジが配った link の表示キャッシュだけ。「再送」タブと上り resend は撤去した(パッドの「同期」タブに置き換えた。D-175)
//
// - link はブリッジが接続ごとに 1 回(つながった直後)と、到達が変わるたびに配る。要求は要らない
// - 切れたら捨てる(ブリッジにつながっていなければ Unity に届いているかは分からない。つなぎ直せば link が届き直す)
import { batch, signal } from '@preact/signals'

import type { BridgeLink } from './bridge-link'
import type { Notices } from './notices'
import type { TargetReachability, UnityReachability } from './unity-link-logic'

export interface UnityLinkStoreDeps {
  link: BridgeLink
  notices: Notices
}

export type UnityLinkStore = ReturnType<typeof createUnityLinkStore>
export function createUnityLinkStore(deps: UnityLinkStoreDeps) {
  const { link } = deps
  const unity = signal<UnityReachability | null>(null)
  const targets = signal<readonly TargetReachability[]>([])

  const unsubscribe = [
    link.on('link', (frame) => {
      batch(() => {
        unity.value = frame.unity
        targets.value = frame.targets
      })
    }),
    link.onConnectionChange((connected) => {
      if (connected) return
      batch(() => {
        unity.value = null
        targets.value = []
      })
    }),
  ]

  return {
    connected: link.connected,
    /** 主系の到達(ヘッダー)。未受信・切断中は null。 */
    unity,
    /** 宛先ごとの到達(主系が先頭。ブリッジの並び)。 */
    targets,
    dispose() {
      for (const stop of unsubscribe) stop()
    },
  }
}
