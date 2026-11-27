// 「新しい一覧があります」(D-088)の状態。
// Unity から届いた一覧のうち、まだ反映していないもの(runtimeOptions の pending)と、使用箇所の文言のための採用中の
// 定義だけを持つ表示キャッシュ。反映(runtimeOptionsApply)はブリッジが行って全 UI へ配る
import { batch, signal } from '@preact/signals'

import { WIRE_PROTOCOL_VERSION, type SurfaceDefinition } from '@oscdesk/shared'

import type { BridgeLink } from './bridge-link'
import type { Notices } from './notices'
import type { PendingOptionList } from './pending-options-logic'

export const OFFLINE_MESSAGE = 'ブリッジに接続していないため反映できませんでした'

export interface PendingOptionsStoreDeps {
  link: BridgeLink
  notices: Notices
}

export type PendingOptionsStore = ReturnType<typeof createPendingOptionsStore>
export function createPendingOptionsStore(deps: PendingOptionsStoreDeps) {
  const { link } = deps
  const notify = deps.notices.notify
  const pending = signal<readonly PendingOptionList[]>([])
  // 使用箇所の文言は定義から引く。反映待ちが同じままでも定義が変われば描き直す(ブリッジは参照が残る一覧の
  // 反映待ちを引き継ぎ、runtimeOptions を配り直さないことがある)
  const definition = signal<SurfaceDefinition | null>(null)

  const unsubscribe = [
    link.on('runtimeOptions', (frame) => {
      // 旧いブリッジとの互換で pending は省略できる(無ければ空)
      pending.value = frame.pending ?? []
    }),
    link.on('surface', (frame) => {
      definition.value = frame.definition
    }),
    link.on('surfaceList', (frame) => {
      if (frame.active === null) definition.value = null
    }),
    link.on('notice', (notice) => {
      // 反映を押した直後に定義が差し替わり、その一覧が定義から消えたときに届く(D-088)
      if (notice.code === 'runtime-options-apply-rejected') notify('error', `一覧を反映できません(採用中の定義に無い一覧です): ${notice.detail}`)
    }),
    link.onConnectionChange((connected) => {
      if (connected) return
      // つなぎ直すと surfaceRequest の応答で runtimeOptions が届き直す。切れている間は反映を押せないので出さない
      batch(() => {
        pending.value = []
        definition.value = null
      })
    }),
  ]

  return {
    connected: link.connected,
    pending,
    definition,
    dispose() {
      for (const stop of unsubscribe) stop()
    },
    /** 届いた一覧を反映させる。list を省くと全一覧。 */
    apply(list?: string): boolean {
      const sent = link.send(list === undefined
        ? { v: WIRE_PROTOCOL_VERSION, type: 'runtimeOptionsApply' }
        : { v: WIRE_PROTOCOL_VERSION, type: 'runtimeOptionsApply', list })
      if (!sent) notify('warn', OFFLINE_MESSAGE)
      return sent
    },
  }
}
