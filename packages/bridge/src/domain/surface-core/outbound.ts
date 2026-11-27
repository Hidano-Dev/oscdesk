import { CATALOG_ADDRESSES, isInternalAddress, type OscArg } from '@oscdesk/shared'

import type { SentEvent } from '../sent-log'
import type { Core } from './context'
import { isBridgeInternalAddress } from './osc-args'
import type { ClientId, SendFn, UnityRuntimeTarget } from './types'

// Unity への送信(D-045・D-050・D-067・D-080)。内部アドレスの送出抑止、送信ログ、まとめ送り、パッドの押下。

export interface OutboundPart {
  sendMessage: SendFn
  sendLogged(origin: SentEvent['origin'], to: readonly UnityRuntimeTarget[], address: string, ...args: OscArg[]): void
  sendToAllTargets(origin: SentEvent['origin'], address: string, ...args: OscArg[]): void
  rejectBatch(clientId: ClientId, detail: string, requestId?: string): void
  sendBatch(messages: { address: string; args: OscArg[] }[], clientId: ClientId, holder: string | undefined, requestId?: string): void
  firePad(address: string, args: readonly OscArg[]): { ok: true } | { ok: false; reason: string }
  requestCatalog(): void
}

export function outboundPart(core: Core): OutboundPart {
  const { deps, logWarn } = core

  const sendMessage: SendFn = (host, port, address, ...args) => {
    if (isBridgeInternalAddress(address)) {
      if (!core.warnedInternalAddresses.has(address)) {
        core.warnedInternalAddresses.add(address)
        logWarn('(WARN, BRIDGE)', `Blocked outbound internal message "${address}".`)
      }
      return
    }
    core.diagnostics?.recordOutgoing?.(address, args, host, port)
    deps.sendFn(host, port, address, ...args)
    // 宛先の送り先(host:port)に当たる台の到達を見張る。ping など内部のアドレスは上で弾いている
    // ブロードキャストの宛先が答えたホストへ個別に送る再送(onBroadcastPong)は、宛先の host でなく答えたホストへ送るので、
    // 答えたホストも同じ宛先の送り先とみなす
    for (const target of core.targets) {
      if (target.sendPort !== port) continue
      if (target.host === host || (target.broadcast !== null && target.responders.has(host))) core.delivery.noteSent(target.name, address)
    }
  }

  // 上りの batch に印(requestId)があれば拒否の notice にそのまま載せる(HID-482)。要求元が、待ち時間を過ぎて届いた前のまとめの
  // 拒否を、次に送ったまとめの拒否と取り違えないように。osc.batch は印を持たない
  const rejectBatch = (clientId: ClientId, detail: string, requestId?: string) => {
    deps.publish({ v: 1, type: 'notice', level: 'error', code: 'batch-rejected', detail, ...(requestId === undefined ? {} : { requestId }) }, clientId)
  }

  /**
   * まとめ送り(D-050)を全宛先へ 1 つの bundle で送り、保持値に入れる。上りの osc.batch と batch(HID-389)で共通。
   * ロック中の部品・行を含むなら、まとめごと断る(HID-378・D-111)。一部だけ送ると、1 データグラムでまとめて届く前提が崩れ、
   * Unity が半端な組み合わせを受ける
   */
  const sendBatch = (messages: { address: string; args: OscArg[] }[], clientId: ClientId, holder: string | undefined, requestId?: string) => {
    const lockedStep = core.lockRejection(messages.flatMap(message => core.lockRefsOf(message.address, message.args)), clientId, holder)
    if (lockedStep !== null) return rejectBatch(clientId, lockedStep, requestId)
    if (deps.sendBundleFn === undefined) return rejectBatch(clientId, 'transport-unavailable', requestId)
    const primary = core.primaryTarget()
    const result = deps.sendBundleFn(primary.host, primary.sendPort, messages)
    const delivered = [primary.name]
    if (result.ok) {
      for (const target of core.targets.slice(1)) {
        const secondaryResult = deps.sendBundleFn(target.host, target.sendPort, messages)
        if (!secondaryResult.ok) logWarn('(WARN, BRIDGE)', `Batch to Unity "${target.name}" failed: ${secondaryResult.reason}.`)
        else delivered.push(target.name)
      }
    }
    if (!result.ok) {
      return rejectBatch(clientId, result.reason === 'too-large'
        ? `too-large: ${String(result.bytes)} bytes (limit ${String(result.limitBytes)})`
        : 'transport-unavailable', requestId)
    }
    deps.onSent?.({ origin: 'action', targets: delivered, messages, batch: true })
    for (const name of delivered) {
      for (const message of messages) core.delivery.noteSent(name, message.address)
    }
    core.recordDesired(messages)
    for (const message of messages) {
      for (const target of core.targets) core.diagnostics?.recordOutgoing?.(message.address, message.args, target.host, target.sendPort)
    }
  }

  // Unity へ送り、送信ログ(D-067)へ 1 件として残す。宛先をまとめて 1 件にするのは、全台へ同じものを
  // 送る通常の操作で、ログが宛先の数だけ膨らまないようにするため
  const sendLogged = (origin: SentEvent['origin'], to: readonly UnityRuntimeTarget[], address: string, ...args: OscArg[]) => {
    for (const target of to) sendMessage(target.host, target.sendPort, address, ...args)
    if (to.length > 0) deps.onSent?.({ origin, targets: to.map(target => target.name), messages: [{ address, args }] })
  }

  const sendToAllTargets = (origin: SentEvent['origin'], address: string, ...args: OscArg[]) => {
    sendLogged(origin, core.targets, address, ...args)
  }

  const firePad = (address: string, args: readonly OscArg[]): { ok: true } | { ok: false; reason: string } => {
    // パッドの保存時にも検証しているが、送る直前にも弾く(手で書き換えたファイルを読み込んだ場合の保険)
    if (isInternalAddress(address)) return { ok: false, reason: `internal-address: ${address}` }
    // 一覧のアドレスへ送ると、そのエコーが全台の一覧を上書きする(D-055。上り osc と同じ扱い)
    if (core.runtimeOptions.isListAddress(address)) return { ok: false, reason: `option-list-address: ${address}` }
    // 保持値は書き換えない(recordDesired を通さない)。パッドはきっかけを撃つ場所で、狙いの値はサーフェス定義が持つ
    sendToAllTargets('pad', address, ...args)
    return { ok: true }
  }

  const requestCatalog = () => sendToAllTargets('request', CATALOG_ADDRESSES.REQUEST)

  return { sendMessage, sendLogged, sendToAllTargets, rejectBatch, sendBatch, firePad, requestCatalog }
}
