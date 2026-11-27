import { isInternalAddress, OSCDESK, OSCDESK_DIAG, SYS } from '@oscdesk/shared'

import { ECHO_SETTLE_MS, type Core } from './context'
import { describeEntry, toWireArgs } from './osc-args'
import type { InboundOscMessage } from './types'

// OSC の受信(D-045・D-046・D-053・D-079・D-116)。pong・診断・状態の問い合わせ・一覧・エコー・OSC ネイティブ UI の中継。

export interface InboundPart {
  handleOscIn(message: InboundOscMessage): void
  handleUndelivered(from: { host: string; port: number }, result: 'ignored' | 'failed', refs: readonly string[]): void
}

export function inboundPart(core: Core): InboundPart {
  const { deps, now, logInfo, logWarn, desired, runtimeOptions } = core

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
      // seq が一致しても、その宛先のホストから届いたものだけを受理する(別の台の pong で到達性を偽らないため)
      const answered = arg?.type === 'i'
        ? core.targets.find(target => target.broadcast === null && target.monitor.pendingSeq() === arg.value && target.addresses.has(message.from.host))
        : undefined
      if (arg?.type === 'i' && Number.isInteger(arg.value) && answered === undefined) {
        // ブロードキャストの宛先は 1 回の ping に複数台が答えるので、返事待ち(pendingSeq)でなく直近に送った seq で照合する
        const broadcastTarget = core.targets.find(target => target.lastPingSeq === arg.value && core.inBroadcastNetwork(target, message.from.host))
        if (broadcastTarget !== undefined) core.onBroadcastPong(broadcastTarget, message.from.host, arg.value)
        return
      }
      if (arg?.type === 'i' && Number.isInteger(arg.value) && answered !== undefined) {
        const result = answered.monitor.onPong(arg.value, now())
        if (result.accepted && (!answered.hasBeenReachable || result.recoveredFromLoss)) {
          answered.upSince = now()
          const reason = answered.hasBeenReachable ? 'Unity recovered' : 'Unity first reachable'
          core.autoResendDesired(reason, undefined, [answered])
          core.requestRuntimeOptions(reason, runtimeOptions.requestAddresses(), [answered])
        }
        if (result.accepted) answered.hasBeenReachable = true
        if (result.accepted) core.publishLink()
        if (result.accepted && answered.primary) core.diagnostics?.onPongAccepted?.()
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
    // 定義のアドレスの T / F は i の 1 / 0 として扱う(エコーの照合・UI への配信・中継と保持値。HID-492)
    message = { ...message, args: core.definitionArgs(message.address, message.args) }
    const source = core.sourceTarget(message.from)
    // 到達のイベント(D-116)。アダプタが「届いた」に振り分けた受信を、送った記録と突き合わせる(主系・副系とも)
    if (source !== null) core.delivery.onDelivered(source.name, message.from.host, message.address)
    // Unity の一覧(D-053)は副系からも受けるので、副系のエコーを捨てる処理より前で受け止める。
    // osc フレームとしては流さない(一覧のフレームと二重になるため)。Unity 以外の送信元は受けない
    if (runtimeOptions.isListAddress(message.address)) {
      if (source === null) {
        core.warnRuntimeOptionsOnce(`source:${message.from.host}:${message.address}`, `Ignored option list "${message.address}" from non-Unity source ${message.from.host}:${String(message.from.port)}.`)
        return
      }
      // ブロードキャストの宛先(D-079)は複数のホストが同じ宛先名で答えるので、ホストごとに分けて持つ(D-088)
      const host = source.broadcast === null ? undefined : message.from.host
      const result = runtimeOptions.receive(source.name, message.address, message.args, host)
      if (result === 'invalid') {
        core.warnRuntimeOptionsOnce(`args:${source.name}:${message.address}`, `Ignored option list "${message.address}" from Unity "${source.name}": every argument must be a string.`)
      } else if (result === 'changed') {
        core.publishRuntimeOptions()
        core.addRecordRows(desired.addKeys(runtimeOptions.recordKeys()))
      } else if (result === 'held') {
        // 反映するまで画面の行と選択肢は変えず、反映待ちの表示だけを配り直す。誤った PC からの一覧に気づけるよう出所を残す
        const from = host === undefined ? `"${source.name}"` : `"${source.name}" (${host})`
        logInfo('(INFO, BRIDGE)', `Holding option list "${message.address}" from Unity ${from} until it is applied from the UI.`)
        core.publishRuntimeOptions()
      }
      return
    }
    // Unity からの要求のエコーは「届いた」以上の意味を持たないので、UI へも OSC ネイティブ UI へも流さない
    // (OSC ネイティブ UI の端末が要求を送るのは中継の対象なので、出所を Unity に限る)
    if (source !== null && runtimeOptions.isRequestAddress(message.address)) return
    // 副系のエコーは UI へ配らず(表示は主系だけ。D-046)、保持値との食い違いだけを警告する。
    // 中継判定より前に処理しないと、ルーターが副系を UI ピアとみなして Unity へ送り返してしまう
    const entryId = desired.entryId(message.address, message.args)
    if (source !== null && !source.primary) {
      const key = `${source.name}:${entryId}`
      const secondarySettling = now() - (core.lastOperatedAt.get(entryId) ?? -Infinity) < ECHO_SETTLE_MS
      if (secondarySettling) {
        // 操作直後の遅れた旧いエコーは主系と同じく食い違いとして扱わない
      } else if (desired.differsFromEcho(message.address, message.args)) {
        if (!core.warnedEchoMismatch.has(key)) {
          core.warnedEchoMismatch.add(key)
          logWarn('(WARN, BRIDGE)', `Unity "${source.name}" echo differs from desired value for "${describeEntry(message.address, message.args, entryId)}".`)
        }
      } else {
        core.warnedEchoMismatch.delete(key)
      }
      return
    }
    // OSC ネイティブ UI の中継(D-7)は WebSocket UI への配信と併存する。
    // 中継の可否で publish を止めないこと(止めると WebSocket UI から外部 OSC が見えなくなる)。
    if (core.uiRouter !== null) {
      const decision = core.uiRouter.route(message.from, now())
      if (decision.kind === 'to-unity') {
        core.sendToAllTargets('relay', message.address, ...message.args)
        // OSC ネイティブ UI の操作も保持値に入れる(入れないと Unity 再起動の再送で巻き戻る)
        core.recordDesired([{ address: message.address, args: message.args }])
      } else if (decision.kind === 'to-ui') {
        for (const target of decision.targets) {
          deps.sendFn(target.host, target.port, message.address, ...message.args)
        }
      }
    }
    // 保持値と食い違うエコーは書き換えず警告だけ残す(D-045)。同じアドレスの警告は一致に戻るまで 1 回。
    const settling = now() - (core.lastOperatedAt.get(entryId) ?? -Infinity) < ECHO_SETTLE_MS
    if (core.isUnityHost(message.from.host) && !settling && desired.differsFromEcho(message.address, message.args)) {
      if (!core.warnedEchoMismatch.has(entryId)) {
        core.warnedEchoMismatch.add(entryId)
        logWarn('(WARN, BRIDGE)', `Unity echo differs from desired value for "${describeEntry(message.address, message.args, entryId)}".`)
      }
    } else {
      core.warnedEchoMismatch.delete(entryId)
    }
    deps.publish({ v: 1, type: 'osc.message', address: message.address, args: toWireArgs(message.args), from: message.from })
    // 主系のターゲットのエコーは、パラメータ id の語彙でも配る(HID-389)。UI はこれで表示とまとめ送りの到着を確かめ、
    // OSC のアドレスを見ない。副系はこの手前で返している。OSC ネイティブ UI の端末(source が無い)の操作は載せない
    if (source !== null) {
      const echo = core.toIdEntries([{ address: message.address, args: message.args }])
      if (echo.values.length > 0 || echo.rows.length > 0) deps.publish({ v: 1, type: 'echo', ...echo })
    }
  }

  return { handleOscIn, handleUndelivered }
}
