// Unity の接続状態と「再送」タブの状態(D-158)。
// 持つのはブリッジが配った link の表示キャッシュだけ。保持値の正はブリッジにあり、再送もブリッジが行う(D-046)。
// 生成の記録と「記録に合わせる」は D-166 で撤去した
//
// - link はブリッジが接続ごとに 1 回(つながった直後)と、到達が変わるたびに配る。要求は要らない
// - 切れたら捨てる(ブリッジにつながっていなければ Unity に届いているかは分からない。つなぎ直せば link が届き直す)
// - 通知の受け持ち(D-157): resend-rejected はこの store だけが出す
import { batch, signal } from '@preact/signals'

import { WIRE_PROTOCOL_VERSION } from '@oscdesk/shared'

import type { BridgeLink } from './bridge-link'
import type { Notices } from './notices'
import { resendRejectedText, type TargetReachability, type UnityReachability } from './unity-link-logic'

export const OFFLINE_MESSAGE = 'ブリッジに接続していないため送れませんでした'

export interface UnityLinkStoreDeps {
  link: BridgeLink
  notices: Notices
}

export type UnityLinkStore = ReturnType<typeof createUnityLinkStore>
export function createUnityLinkStore(deps: UnityLinkStoreDeps) {
  const { link } = deps
  const notify = deps.notices.notify
  const unity = signal<UnityReachability | null>(null)
  const targets = signal<readonly TargetReachability[]>([])

  const unsubscribe = [
    link.on('link', (frame) => {
      batch(() => {
        unity.value = frame.unity
        targets.value = frame.targets
      })
    }),
    link.on('notice', (notice) => {
      if (notice.code === 'resend-rejected') notify('error', resendRejectedText(notice.detail))
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
    /** 保持値を送り直させる(上り resend)。target を省くと全宛先(D-046。取り込んだプロジェクトの未送信も解ける。D-090)。 */
    resend(target?: string): boolean {
      const sent = link.send(target === undefined
        ? { v: WIRE_PROTOCOL_VERSION, type: 'resend' }
        : { v: WIRE_PROTOCOL_VERSION, type: 'resend', target })
      if (!sent) notify('warn', OFFLINE_MESSAGE)
      return sent
    },
  }
}
