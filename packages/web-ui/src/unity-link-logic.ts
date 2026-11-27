// Unity の接続状態と「再送」タブの文言(D-158)。
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

const STATE_TEXT: Record<TargetReachability['reachability'], string> = { reachable: '接続中', lost: '未接続', unknown: '未確認' }
const STATE_TONE: Record<TargetReachability['reachability'], LinkTone> = { reachable: 'ok', lost: 'lost', unknown: 'unknown' }

/** 「再送」タブの 1 台の行の印(主系/副系と到達)と、RTT・連続喪失の補足。 */
export function targetLabel(target: TargetReachability): { badge: string; tone: LinkTone; detail: string } {
  const role = target.primary ? '主系' : '副系'
  const detail = target.reachability === 'unknown'
    ? 'まだ pong が届いていません'
    : `RTT ${rttText(target.lastRttMs)}・連続喪失 ${String(target.consecutiveLosses)} 回`
  return { badge: `${role} / ${STATE_TEXT[target.reachability]}`, tone: STATE_TONE[target.reachability], detail }
}

const UNKNOWN_TARGET = /^unknown-target: (.*)$/s

/** resend-rejected の文言。ブリッジが断るのは、名前の宛先が無いとき(押した直後に宛先が変わったなど)だけ。 */
export function resendRejectedText(detail: string): string {
  const unknown = UNKNOWN_TARGET.exec(detail)
  if (unknown !== null) return `宛先「${unknown[1] ?? ''}」が見つからないため再送できませんでした(宛先が変わった直後なら、一覧が新しくなってから押し直してください)`
  return `再送できませんでした: ${detail}`
}
