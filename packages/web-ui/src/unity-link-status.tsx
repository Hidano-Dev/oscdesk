// ヘッダーの Unity の接続状態(D-158)。状態は unity-link-store の signal を読むだけ
import { unityLinkLabel, type LinkTone } from './unity-link-logic'
import type { UnityLinkStore } from './unity-link-store'

const TONE_CLASS: Record<LinkTone, string> = { ok: 'ok', lost: 'blocked', unknown: 'unknown' }

/** ヘッダーの Unity の接続状態(主系の到達・RTT・連続喪失)。 */
export function UnityLinkStatus({ store }: { store: UnityLinkStore }) {
  const label = unityLinkLabel(store.unity.value)
  return <p class={`link ${TONE_CLASS[label.tone]}`} data-mark="unity-link" data-tone={label.tone}>{label.text}</p>
}
