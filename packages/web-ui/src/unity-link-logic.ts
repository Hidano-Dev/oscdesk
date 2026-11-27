// ヘッダーの Unity の接続状態の文言(D-158)。
// 到達・RTT・連続喪失はブリッジが ping/pong で数えて link で配る(D-046)。ここは届いた値を文言にするだけで、判定はしない
import type { FrameOf } from './bridge-link'

export type LinkFrame = FrameOf<'link'>
export type UnityReachability = LinkFrame['unity']
export type TargetReachability = LinkFrame['targets'][number]
export type LinkTone = 'ok' | 'lost' | 'unknown'

/** RTT の表示。整数なら小数点を出さない。小数は 0.1 ms まで。 */
export function rttText(ms: number | null): string {
  if (ms === null) return '-'
  return `${String(Math.round(ms * 10) / 10)} ms`
}

/**
 * ヘッダーに出す Unity の接続状態(主系)。status が null なのは、まだ link を受けていないか、ブリッジとの接続が
 * 切れている間(ブリッジにつながっていなければ Unity に届いているかは分からない)
 */
export function unityLinkLabel(status: UnityReachability | null): { text: string; tone: LinkTone } {
  if (status === null || status.reachability === 'unknown') return { text: 'Unity 未確認', tone: 'unknown' }
  const rtt = rttText(status.lastRttMs)
  const losses = `連続喪失 ${String(status.consecutiveLosses)} 回`
  if (status.reachability === 'lost') return { text: `Unity 未接続 (RTT ${rtt}, ${losses})`, tone: 'lost' }
  return { text: `Unity 接続中 (${rtt}, ${losses})`, tone: 'ok' }
}
