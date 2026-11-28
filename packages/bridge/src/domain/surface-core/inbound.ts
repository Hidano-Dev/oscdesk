import { isInternalAddress, OSCDESK, OSCDESK_DIAG, SYS } from '@oscdesk/shared'

import type { Core } from './context'
import { toWireArgs } from './osc-args'
import type { InboundOscMessage } from './types'

// OSC の受信(D-046・D-079・D-116・D-169)。pong・診断・状態の問い合わせ・エコー・OSC ネイティブ UI の中継。
// エコーとパッドの保持値の照合は pad-manager(onTargetEcho)が行う。

export interface InboundPart {
  handleOscIn(message: InboundOscMessage): void
  handleUndelivered(from: { host: string; port: number }, result: 'ignored' | 'failed', refs: readonly string[]): void
}

export function inboundPart(core: Core): InboundPart {
  const { deps, now, logWarn } = core

  const handleUndelivered = (from: { host: string; port: number }, result: 'ignored' | 'failed', refs: readonly string[]) => {
    if (core.stopped) return
    // ターゲットの送信元だけを受ける(送り先でないホストの報告は突き合わせる記録が無い)
    const reporter = core.sourceTarget(from)
    if (reporter !== null) core.delivery.onReport(reporter.name, from.host, result, refs)
  }

  const handleOscIn = (message: InboundOscMessage) => {
    if (core.stopped) return
    core.diagnostics?.recordIncoming?.(message.address, message.args, message.from.host, message.from.port)
    if (message.address === OSCDESK.HELLO) {
      if (core.uiRouter !== null) {
        // 名乗りにポート引数が無い(または不正な)場合は送信元ポートへフォールバックする。
        const arg = message.args[0]
        const announcedPort = arg?.type === 'i' && Number.isInteger(arg.value) && arg.value >= 1 && arg.value <= 65535
          ? arg.value
          : message.from.port
        core.uiRouter.registerPeer(message.from.host, announcedPort, now())
      }
      return
    }
    // Unity の制御応答(pong)は設定された Unity ホスト以外から受理しない。
    // 検証しないと、LAN 内の任意のピアが偽 pong で到達性表示を偽装できる
    // ブロードキャストの宛先(D-079)へは、そのネットワークのどのホストが答えてもよい
    if (message.address === SYS.PONG && !core.isUnityHost(message.from.host)
      && !core.targets.some(target => core.inBroadcastNetwork(target, message.from.host))) {
      if (!core.warnedNonUnitySources.has(message.from.host)) {
        core.warnedNonUnitySources.add(message.from.host)
        logWarn('(WARN, BRIDGE)', `Ignored ${message.address} from non-Unity source ${message.from.host}:${String(message.from.port)}.`)
      }
      return
    }
    if (message.address === SYS.PONG) {
      const arg = message.args[0]
      // 第 2 引数は起動 ID(D-164。`/sys/pong` は int seq, string bootId)。無い pong(以前の受け口)は起動 ID 不明として扱う
      const second = message.args[1]
      const bootId = second?.type === 's' ? second.value : null
      // seq が一致しても、その宛先のホストから届いたものだけを受理する(別の台の pong で到達性を偽らないため)
      const answered = arg?.type === 'i'
        ? core.targets.find(target => target.broadcast === null && target.monitor.pendingSeq() === arg.value && target.addresses.has(message.from.host))
        : undefined
      if (arg?.type === 'i' && Number.isInteger(arg.value) && answered === undefined) {
        // ブロードキャストの宛先は 1 回の ping に複数台が答えるので、返事待ち(pendingSeq)でなく直近に送った seq で照合する
        const broadcastTarget = core.targets.find(target => target.lastPingSeq === arg.value && core.inBroadcastNetwork(target, message.from.host))
        if (broadcastTarget !== undefined) core.onBroadcastPong(broadcastTarget, message.from.host, arg.value, bootId)
        return
      }
      if (arg?.type === 'i' && Number.isInteger(arg.value) && answered !== undefined) {
        const result = answered.monitor.onPong(arg.value, now())
        // 起動の検知(D-169)は受理した pong だけで行う(遅れて届いた古い seq の pong で起動を見誤らない)。
        // ping の抜けからの回復はここで起動 ID が変わらないので、パッドの保持値は送り直さない
        if (result.accepted) {
          core.reportBootId({ name: answered.name, host: answered.host, port: answered.sendPort }, bootId)
          core.publishLink()
          if (answered.primary) core.diagnostics?.onPongAccepted?.()
        }
      }
      return
    }
    if (message.address === OSCDESK_DIAG.REQUEST) {
      const snapshot = core.diagnostics?.snapshot?.()
      if (snapshot !== undefined) {
        deps.sendFn(message.from.host, message.from.port, OSCDESK_DIAG.SNAPSHOT, {
          type: 's', value: JSON.stringify(snapshot),
        })
      }
      return
    }
    // OSC ネイティブクライアント向けの UDP 応答。返信は /oscdesk/* なので、
    // 送出抑止(sendMessage)を通さず要求元へ直接返す(診断応答と同じ扱い)。
    if (message.address === OSCDESK.STATUS_REQUEST) {
      deps.sendFn(message.from.host, message.from.port, OSCDESK.STATUS, {
        type: 's', value: JSON.stringify(core.linkSnapshot()),
      })
      return
    }
    if (isInternalAddress(message.address)) return
    const source = core.sourceTarget(message.from)
    // 到達のイベント(D-116)。アダプタが「届いた」に振り分けた受信を、送った記録と突き合わせる(主系・副系とも)
    if (source !== null) core.delivery.onDelivered(source.name, message.from.host, message.address)
    // パッドの保持値との照合と osc.padEcho(D-169)。副系のエコーも照合に使うので、副系を返す手前で渡す
    if (source !== null) deps.onTargetEcho?.(message.address, message.args, { name: source.name, primary: source.primary })
    // 副系のエコーは UI へ配らない(表示は主系だけ。D-046)。中継判定より前に返さないと、ルーターが副系を UI ピアとみなして
    // Unity へ送り返してしまう
    if (source !== null && !source.primary) return
    // OSC ネイティブ UI の中継(D-7)は WebSocket UI への配信と併存する。
    // 中継の可否で publish を止めないこと(止めると WebSocket UI から外部 OSC が見えなくなる)。
    if (core.uiRouter !== null) {
      const decision = core.uiRouter.route(message.from, now())
      if (decision.kind === 'to-unity') {
        core.sendToAllTargets('relay', message.address, ...message.args)
      } else if (decision.kind === 'to-ui') {
        for (const target of decision.targets) {
          deps.sendFn(target.host, target.port, message.address, ...message.args)
        }
      }
    }
    deps.publish({ v: 1, type: 'osc.message', address: message.address, args: toWireArgs(message.args), from: message.from })
  }

  return { handleOscIn, handleUndelivered }
}
