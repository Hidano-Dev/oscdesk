// ネットワークのタブ(D-113・D-153)の状態。NiceGUI 版の network_panel.py と state/network.py の表示キャッシュと
// 入力中の値を、signal に移した。設定の正はブリッジで、ここは最後に届いた networkSettings と、入力中の値(下書き)と、
// 保存の応答待ちだけを持つ。
//
// 接続してよいブラウザの判定はブリッジだけが行う(D-153)。SPA のブラウザはブリッジへ直接つなぐので、ブリッジは
// その接続の送信元で許可と締め出しを判定する。NiceGUI 版のように操作元のブラウザを名乗る(networkSettingsSet.browser)
// ことも、画面側で範囲の外を予告することもしない。範囲の外になったら、ブリッジが接続を 1008 で閉じ、ページの HTTP も 403 で断る

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

/** 保存の応答(networkSettings か拒否の notice)を待つ長さ。ソケットの付け替えを含めても LAN 内なら十分に短い(NiceGUI 版と同じ)。 */
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
  // 入力中の値。null なら未編集(ブリッジの設定に追従する)
  const draft = signal<NetworkInputs | null>(null)
  // 保存の応答待ちと、送った値。通ったかは要求元にだけ届く notice network-settings-applied で知る(D-153)。
  // 全 UI へ配る networkSettings の版が進んだだけでは、ほかのブラウザの変更が先に通った(自分の要求はこの後 stale-revision で
  // 断られる)のと見分けられず、そこで下書きを消すと断られた後に直して送り直せないため
  const pending = signal<{ sent: NetworkInputs } | null>(null)
  // 入力を始めたときの設定の版。保存に添え、編集中にほかのブラウザが保存していればブリッジが stale-revision で断る
  // (古い入力で黙って上書きしない。D-113 の追記 (e))。断られたら捨て、次の保存は今の版での上書きにする
  let draftBase: number | null = null
  let pendingTimer: unknown = null

  const inputs = computed<NetworkInputs | null>(() => {
    const current = frame.value
    if (current === null) return null
    return draft.value ?? inputsOf(current)
  })
  const canApply = computed(() => frame.value !== null && pending.value === null && link.connected.value)
  // ブリッジから見たこのブラウザ(hello.peer。D-153)。表示と「このブラウザを足す」にだけ使い、判定には使わない
  const peer = computed(() => link.hello.value?.peer ?? null)

  const clearPending = () => {
    if (pendingTimer !== null) clearTimer(pendingTimer)
    pendingTimer = null
    pending.value = null
  }

  const resetDraft = () => {
    draft.value = null
    draftBase = null
  }

  const onNetworkSettings = (next: NetworkSettingsFrame) => {
    batch(() => {
      frame.value = next
      // 応答待ちの間は下書きに触れない(この配信が自分の変更なのかは、後に届く notice で決まる)。
      // それ以外で、ほかのブラウザが同じ値を保存したなら下書きは要らない
      if (pending.value === null && draft.value !== null && sameInputs(draft.value, inputsOf(next))) resetDraft()
    })
  }

  const onApplied = (detail: string) => {
    const waiting = pending.value
    if (waiting === null) return
    const match = /^revision: (\d+)$/.exec(detail)
    const applied = match === null ? frame.value?.revision ?? null : Number(match[1])
    batch(() => {
      clearPending()
      // 送った値のままなら下書きを消してブリッジの設定(先に届いた networkSettings)を見せる。応答待ちの間に打ち足していれば、
      // その入力は残し、通った版の上の編集として扱う
      if (draft.value === null || sameInputs(draft.value, waiting.sent)) resetDraft()
      else draftBase = applied
    })
  }

  const onNotice = (notice: FrameOf<'notice'>) => {
    switch (notice.code) {
      case 'network-settings-applied':
        onApplied(notice.detail)
        break
      case 'network-settings-rejected':
        // 入力は残して直せるようにする
        clearPending()
        draftBase = null
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
    const next = { ...base, ...change }
    if (sameInputs(next, inputsOf(current))) {
      resetDraft()
      return
    }
    draft.value = next
    draftBase ??= current.revision
  }

  const unsubscribe = [
    link.on('networkSettings', onNetworkSettings),
    link.on('notice', onNotice),
    link.onConnectionChange((connected) => {
      // 切れたら応答待ちを捨てる(届かない応答を待ち続けて保存のボタンが押せないままにならないように)。
      // 設定と下書きは残し、つなぎ直しで届く networkSettings で置き換える
      if (!connected) clearPending()
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
      clearPending()
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
      resetDraft()
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
      // 応答が届くまで、送った値を入力欄に見せ続ける
      batch(() => {
        draft.value = values
        draftBase ??= current.revision
        pending.value = { sent: values }
      })
      pendingTimer = setTimer(() => {
        pendingTimer = null
        pending.value = null
        notify('warn', 'ネットワークの設定の応答がブリッジから届きませんでした')
      }, APPLY_TIMEOUT_MS)
    },
  }
}
