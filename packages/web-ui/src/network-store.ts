// ネットワークのタブ(D-113・D-153)の状態。設定の正はブリッジで、ここは最後に届いた networkSettings と、入力中の値(下書き)と、
// 保存の応答待ちだけを持つ。
//
// 接続してよいブラウザの判定はブリッジだけが行う(D-153)。SPA のブラウザはブリッジへ直接つなぐので、ブリッジは
// その接続の送信元で許可と締め出しを判定する。操作元のブラウザを名乗ることも(networkSettingsSet に browser は無い。D-161)、
// 画面側で範囲の外を予告することもしない。範囲の外になったら、ブリッジが接続を 1008 で閉じ、ページの HTTP も 403 で断る

import { batch, computed, signal } from '@preact/signals'

import { WIRE_PROTOCOL_VERSION } from '@oscdesk/shared'

import type { BridgeLink, FrameOf } from './bridge-link'
import {
  ALLOW_ALL,
  buildSettings,
  describeRejection,
  inputsOf,
  sameInputs,
  withBrowser,
  type NetworkInputs,
  type NetworkSettingsFrame,
} from './network-logic'
import type { Notices } from './notices'

/** 保存の応答(networkSettings か拒否の notice)を待つ長さ。ソケットの付け替えを含めても LAN 内なら十分に短い。 */
export const APPLY_TIMEOUT_MS = 10_000

export interface NetworkStoreDeps {
  link: BridgeLink
  notices: Notices
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export type NetworkStore = ReturnType<typeof createNetworkStore>
export function createNetworkStore(deps: NetworkStoreDeps) {
  const setTimer = deps.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms))
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const { link } = deps
  const notify = deps.notices.notify

  const frame = signal<NetworkSettingsFrame | null>(null)
  // 保存の応答待ちと、送った値。通ったかは要求元にだけ届く notice network-settings-applied で知る(D-153)。
  // 全 UI へ配る networkSettings の版が進んだだけでは、ほかのブラウザの変更が先に通った(自分の要求はこの後 stale-revision で
  // 断られる)のと見分けられず、そこで下書きを消すと断られた後に直して送り直せないため
  const pending = signal<{ sent: NetworkInputs } | null>(null)
  // 下書き = 基準と違う入力。基準は 1 つの規則で決める: 応答待ちの間は送った値、待っていないときは届いている設定。
  // 入力が基準と同じになったら下書きを捨てる(null は「基準を見せる」)。応答待ちの間に届いた設定(変更前の値や、ほかの
  // ブラウザの変更)と比べて消すと、変更前の値へ戻した入力や送った値が、応答の前に消えるため(PR #155 の Codex の指摘)
  const draft = signal<NetworkInputs | null>(null)
  // 下書きを始めたときの設定の版。保存に添え、編集中にほかのブラウザが保存していればブリッジが stale-revision で断る
  // (古い入力で黙って上書きしない。D-113 の追記 (e))。応答待ちの間に始めた下書きの版は、通った版(applied)で決まる。
  // null なら保存の時点の版で送る(断られた後の、確かめた上での上書き)
  let draftBase: number | null = null
  let pendingTimer: unknown = null

  const reference = (): NetworkInputs | null => {
    const current = frame.value
    if (current === null) return null
    return pending.value?.sent ?? inputsOf(current)
  }
  const inputs = computed<NetworkInputs | null>(() => {
    const current = frame.value
    if (current === null) return null
    return draft.value ?? pending.value?.sent ?? inputsOf(current)
  })
  const canApply = computed(() => frame.value !== null && pending.value === null && link.connected.value)
  // ブリッジから見たこのブラウザ(hello.peer。D-153)。表示と「このブラウザを足す」にだけ使い、判定には使わない
  const peer = computed(() => link.hello.value?.peer ?? null)

  /** 入力を基準と比べて下書きを決める(基準が変わったときと、入力したときに必ずここを通す)。 */
  const settle = (next: NetworkInputs | null) => {
    const base = reference()
    if (next === null || (base !== null && sameInputs(next, base))) {
      draft.value = null
      if (pending.value === null) draftBase = null
      return
    }
    draft.value = next
  }

  /** 応答待ちをやめる。通ったか分からない(断られた・時間切れ・切断)ときは、送った値を入力として残す。 */
  const endPending = (outcome: { applied: number | null } | null) => {
    const waiting = pending.value
    if (pendingTimer !== null) clearTimer(pendingTimer)
    pendingTimer = null
    if (waiting === null) return
    const typed = draft.value
    pending.value = null
    if (outcome !== null) {
      // 通った: 打ち足した入力は通った版の上の下書きにする
      draftBase = typed === null ? null : outcome.applied
      settle(typed)
      return
    }
    // 通らなかった: 打ち足した入力か、無ければ送った値を残す。次の保存は今の版での上書き
    draftBase = null
    settle(typed ?? waiting.sent)
  }

  const onNetworkSettings = (next: NetworkSettingsFrame) => {
    batch(() => {
      frame.value = next
      settle(draft.value)
    })
  }

  const onNotice = (notice: FrameOf<'notice'>) => {
    switch (notice.code) {
      case 'network-settings-applied': {
        const match = /^revision: (\d+)$/.exec(notice.detail)
        batch(() => endPending({ applied: match === null ? frame.value?.revision ?? null : Number(match[1]) }))
        break
      }
      case 'network-settings-rejected':
        batch(() => endPending(null))
        notify('error', `ネットワークの設定を変更できません: ${describeRejection(notice.detail)}`)
        break
      case 'network-settings-save-failed':
        notify('error', `ネットワークの設定を保存できませんでした(ブリッジを止めるまで効きます): ${notice.detail}`)
        break
      default:
        break
    }
  }

  const edit = (change: Partial<NetworkInputs>) => {
    const current = frame.value
    const base = inputs.value
    if (current === null || base === null) return
    // 待っていない間に始めた下書きは、今届いている版の上の編集
    if (pending.value === null) draftBase ??= current.revision
    settle({ ...base, ...change })
  }

  const unsubscribe = [
    link.on('networkSettings', onNetworkSettings),
    link.on('notice', onNotice),
    link.onConnectionChange((connected) => {
      // 切れたら応答待ちを捨てる(届かない応答を待ち続けて保存のボタンが押せないままにならないように)。
      // 入力は残し、つなぎ直しで届く networkSettings と比べ直す
      if (!connected) batch(() => endPending(null))
    }),
  ]
  return {
    frame,
    inputs,
    draft,
    pending,
    canApply,
    peer,
    connected: link.connected,

    dispose() {
      if (pendingTimer !== null) clearTimer(pendingTimer)
      pendingTimer = null
      for (const stop of unsubscribe) stop()
    },
    edit,
    allowAll() {
      edit({ allowedBrowsers: ALLOW_ALL.join('\n') })
    },
    addThisBrowser() {
      const address = peer.value
      const base = inputs.value
      if (address === null || base === null) return
      edit({ allowedBrowsers: withBrowser(base.allowedBrowsers, address) })
    },
    discard() {
      settle(null)
    },
    apply() {
      const current = frame.value
      const values = inputs.value
      if (current === null || values === null || pending.value !== null) return
      if (!link.connected.value) {
        notify('warn', 'ブリッジに接続していないため保存できませんでした')
        return
      }
      const built = buildSettings(values)
      if (!built.ok) {
        notify('error', built.message)
        return
      }
      const sent = link.send({
        v: WIRE_PROTOCOL_VERSION,
        type: 'networkSettingsSet',
        revision: draftBase ?? current.revision,
        targetInterface: built.targetInterface,
        targetRanges: built.targetRanges,
        allowedBrowsers: built.allowedBrowsers,
      })
      if (!sent) {
        notify('error', 'ネットワークの設定を送れませんでした')
        return
      }
      // 応答が届くまで、送った値を基準にして入力欄に見せ続ける
      batch(() => {
        pending.value = { sent: values }
        draftBase = null
        settle(null)
      })
      pendingTimer = setTimer(() => {
        pendingTimer = null
        batch(() => endPending(null))
        notify('warn', 'ネットワークの設定の応答がブリッジから届きませんでした')
      }, APPLY_TIMEOUT_MS)
    },
  }
}
