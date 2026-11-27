import { CATALOG_ADDRESSES, isInternalAddress, SYS, type OscArg, type SyncReason } from '@oscdesk/shared'

import type { SentEvent } from '../sent-log'
import { SYNC_MESSAGES_PER_STEP, SYNC_STEP_MS, type Core } from './context'
import { ipv4ToInt } from '../ipv4'
import { isBridgeInternalAddress, isInNetwork, LOOPBACK_NETWORK } from './osc-args'
import type { ClientId, SendFn, SyncTarget, UnityRuntimeTarget } from './types'

// Unity への送信(D-045・D-050・D-067・D-080)。内部アドレスの送出抑止、送信ログ、まとめ送り、パッドの押下。

export interface OutboundPart {
  sendMessage: SendFn
  sendLogged(origin: SentEvent['origin'], to: readonly UnityRuntimeTarget[], address: string, ...args: OscArg[]): void
  sendToAllTargets(origin: SentEvent['origin'], address: string, ...args: OscArg[]): void
  rejectBatch(clientId: ClientId, detail: string, requestId?: string): void
  sendBatch(messages: { address: string; args: OscArg[] }[], clientId: ClientId, holder: string | undefined, requestId?: string): void
  firePad(address: string, args: readonly OscArg[], origin?: 'pad' | 'ui'): { ok: true } | { ok: false; reason: string }
  sendSync(to: SyncTarget, reason: SyncReason, current: () => readonly { address: string; args: readonly OscArg[] }[] | null): void
  requestCatalog(): void
}

export function outboundPart(core: Core): OutboundPart {
  const { deps, logWarn, setTimeoutFn } = core

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

  const firePad = (address: string, args: readonly OscArg[], origin: 'pad' | 'ui' = 'pad'): { ok: true } | { ok: false; reason: string } => {
    // パッドの保存時にも検証しているが、送る直前にも弾く(手で書き換えたファイルを読み込んだ場合の保険)
    if (isInternalAddress(address)) return { ok: false, reason: `internal-address: ${address}` }
    // 一覧のアドレスへ送ると、そのエコーが全台の一覧を上書きする(D-055。上り osc と同じ扱い)
    if (core.runtimeOptions.isListAddress(address)) return { ok: false, reason: `option-list-address: ${address}` }
    // サーフェス定義の保持値は書き換えない(recordDesired を通さない)。パッドの値の部品の保持値は pad-manager が持つ(D-169)
    sendToAllTargets(origin, address, ...args)
    return { ok: true }
  }

  // 進行中の同期(送り先の host:port ごと)。新しい同期を始めたら、同じ送り先の古い同期の残りの段は送らない(続けて起動を
  // 検知したときに 2 つの同期が交互に値を送らないように)。世代は全体で増やし続ける(送り終えて表から外した後の同期と重ならないように)。
  // wide はブロードキャストの宛先全体への同期(手動の同期で PC を選ばなかったとき)で、その宛先が届く PC の個別の同期と重なる(HID-498)
  const activeSyncs = new Map<string, { generation: number; to: SyncTarget; wide: UnityRuntimeTarget | null }>()
  // 重なる同期が終わるのを待っている同期(送り先ごとに最新の 1 件。同じ送り先へ続けて頼まれたら新しい方だけを残す)
  const pendingSyncs = new Map<string, { start: () => void; wide: boolean }>()
  let syncGeneration = 0

  // ブロードキャストの宛先全体への同期か。宛先の名前でなく送り先(ブロードキャストアドレスと送信ポート)で見る(宛先タブで
  // 「全てのデバイス」とネットワークの選択を切り替えると、送り先が同じでも宛先の名前が変わる。待っている間に名前で引き直すと
  // ブロードキャストの同期を個別の同期と取り違える)
  const broadcastTargetAt = (host: string, port: number): UnityRuntimeTarget | null =>
    core.targets.find(target => target.broadcast !== null && target.host === host && target.sendPort === port) ?? null
  const wideTargetOf = (to: SyncTarget) => broadcastTargetAt(to.host, to.port)
  /**
   * ブロードキャストがその PC へ届くか。certain は確かに届く(そのブロードキャストの ping に答えたホスト・この PC 自身
   * (ループバックと宛先の addresses))、maybe は届くかもしれない(ネットワークに含まれるだけ。/8 の VPN と /24 の LAN のように
   * ネットワークが重なると OS は狭い方の経路で送るので、広い方のブロードキャストは狭い方の PC に届かない。HID-325)、no は届かない。
   * 届く範囲は今の宛先で見る(同期の途中で宛先タブがブロードキャストの範囲を変えても、今届く PC と重ねる)
   */
  const wideReach = (started: UnityRuntimeTarget, to: SyncTarget): 'certain' | 'maybe' | 'no' => {
    const wide = broadcastTargetAt(started.host, started.sendPort) ?? started
    if (wide.sendPort !== to.port || wide.broadcast === null) return 'no'
    const unicast = core.targets.find(target => target.broadcast === null && target.host === to.host)
    const hosts = unicast === undefined ? [to.host] : [...unicast.addresses]
    // 名前解決がまだで IPv4 のアドレスが 1 つも無い宛先は、どこにいるか分からないので届くかもしれない側に倒す(並べて送らない)
    if (!hosts.some(host => ipv4ToInt(host) !== null)) return 'maybe'
    if (hosts.some(host => wide.responders.has(host) || wide.addresses.has(host) || isInNetwork(host, LOOPBACK_NETWORK))) return 'certain'
    return hosts.some(host => isInNetwork(host, wide.broadcast!)) ? 'maybe' : 'no'
  }
  // 重なる 2 つのブロードキャストの同期(同じポート)。どちらもこの PC 自身(ループバック)へ届くので、ポートが同じなら重なるとみなす
  const widesOverlap = (a: UnityRuntimeTarget, b: UnityRuntimeTarget) => a.sendPort === b.sendPort

  const drainPendingSyncs = () => {
    if (core.stopped) {
      pendingSyncs.clear()
      return
    }
    // ブロードキャストの同期を先に始める(個別の同期を先に始めると、続けて始まるブロードキャストの同期が届く PC では、
    // 個別の同期が 1 段目だけで打ち切られる)。届かない個別の同期はブロードキャストと並べてすぐに始まる
    const waiting = [...pendingSyncs].sort((a, b) => Number(b[1].wide) - Number(a[1].wide))
    for (const [key, entry] of waiting) {
      if (pendingSyncs.get(key) !== entry) continue
      pendingSyncs.delete(key)
      entry.start()
    }
  }

  /**
   * 1 台へ同期を送る(D-169)。begin(先頭の s は契機)→ 値 → end の順で、1 つずつのメッセージにする(bundle にすると
   * 1 データグラムの上限で大きなパッドの同期が送れない)。値は SYNC_MESSAGES_PER_STEP 件ずつ SYNC_STEP_MS おきに送る
   * (2 万件を一度に投げると受信側のソケットのバッファがあふれて値が落ちる。PR #175 のレビュー)。段ごとに current() から
   * 今の値を取り直し、この同期で送ったアドレスは除く(途中で操作された値を始めの古い値で上書きしない)。
   * 予約アドレスと一覧のアドレスは送らない(firePad と同じ)。
   * ブロードキャストの宛先と重なる同期は直列にする(HID-498): ブロードキャスト全体への同期を始めたら、それが届く PC への
   * 個別の同期の残りは送らない(その PC には新しい begin が届いて区切り直される)。逆にブロードキャストの同期の途中で、
   * それが届く PC への個別の同期(手動・起動)や別のブロードキャストの同期を頼まれたら、進行中の同期が終わってから始める
   * (打ち切るとブロードキャストの先のほかの PC に値の欠けた同期が残り、並べて送ると 2 つの同期の値が交互に届いて窓の外にはみ出す)
   */
  const sendSync = (to: SyncTarget, reason: SyncReason, current: () => readonly { address: string; args: readonly OscArg[] }[] | null) => {
    const key = `${to.host}:${String(to.port)}`
    const requestedWide = wideTargetOf(to) !== null
    const start = () => {
      if (core.stopped) return
      const wide = wideTargetOf(to)
      // 待っている間に宛先タブでそのブロードキャストの宛先が外れたら、始めずに捨てる(外したネットワークへ撒かない。
      // 個別の同期として始めると、ブロードキャストなのに直列にされず、ほかの同期と値が混ざって届く)
      if (requestedWide && wide === null) {
        pendingSyncs.delete(key)
        logWarn('(WARN, BRIDGE)', `Dropped a waiting sync to "${to.name}" (${key}): the broadcast destination was removed.`)
        return
      }
      // 待つのは: 個別の同期なら、届くかもしれないブロードキャストの同期の途中。ブロードキャストの同期なら、同じポートの
      // 別のブロードキャストの同期の途中か、届くかどうか確かでない PC への個別の同期の途中(打ち切るとその PC に届かなかったとき
      // 値が欠けたまま残り、並べると届いたとき値が混ざるので、終わるのを待つ)
      const blocked = [...activeSyncs].some(([activeKey, active]) => {
        if (activeKey === key) return false
        if (wide === null) return active.wide !== null && wideReach(active.wide, to) !== 'no'
        return active.wide !== null ? widesOverlap(active.wide, wide) : wideReach(wide, active.to) === 'maybe'
      })
      if (blocked) {
        // 同じ送り先の古い同期がまだ動いていれば(ブロードキャストの同期が始まった後にその PC が答えた等)ここで止める。
        // 新しい同期を頼まれた送り先へ古い値を送り続けない
        if (activeSyncs.get(key)?.wide === null) activeSyncs.delete(key)
        pendingSyncs.set(key, { start, wide: wide !== null })
        return
      }
      pendingSyncs.delete(key)
      // 確かに届く PC の個別の同期を止めるのは、この同期が begin を送ると決まってから(待っている間にパッドの採用が変わって
      // current() が null を返すと、この同期は何も送らない。先に止めると、その PC には値の欠けた同期だけが残る)
      const preempt = wide === null ? undefined : () => {
        for (const [activeKey, active] of [...activeSyncs]) {
          if (activeKey !== key && active.wide === null && wideReach(wide, active.to) === 'certain') activeSyncs.delete(activeKey)
        }
      }
      run(to, key, wide, reason, current, preempt)
    }
    start()
  }

  const run = (
    to: SyncTarget, key: string, wide: UnityRuntimeTarget | null, reason: SyncReason,
    current: () => readonly { address: string; args: readonly OscArg[] }[] | null,
    preempt?: () => void,
  ) => {
    const generation = ++syncGeneration
    activeSyncs.set(key, { generation, to, wide })
    const sent = new Set<string>()
    const warned = new Set<string>()
    const send = (messages: readonly { address: string; args: readonly OscArg[] }[]) => {
      for (const message of messages) sendMessage(to.host, to.port, message.address, ...message.args)
      if (messages.length > 0) deps.onSent?.({ origin: 'resend', targets: [to.name], messages: messages.map(message => ({ address: message.address, args: [...message.args] })) })
    }
    const finish = () => {
      activeSyncs.delete(key)
      drainPendingSyncs()
    }
    const step = (first: boolean) => {
      if (core.stopped || activeSyncs.get(key)?.generation !== generation) return
      try {
        sendStep(first)
      } catch (error) {
        // 送信や current() が投げても、進行中の印を残さない(残すと重なる同期が待ち続け、そのポートへ二度と同期できない)
        if (activeSyncs.get(key)?.generation === generation) finish()
        throw error
      }
    }
    const sendStep = (first: boolean) => {
      const batch: { address: string; args: readonly OscArg[] }[] = first ? [{ address: SYS.SYNC_BEGIN, args: [{ type: 's', value: reason }] }] : []
      const list = current()
      // null は打ち切り(パッドの採用が変わった)。end は送らない(受け口は次の begin で区切り直す)
      if (list === null) {
        finish()
        return
      }
      if (first) preempt?.()
      let values = 0
      for (const message of list) {
        if (values >= SYNC_MESSAGES_PER_STEP) break
        if (sent.has(message.address)) continue
        sent.add(message.address)
        if (isInternalAddress(message.address) || core.runtimeOptions.isListAddress(message.address)) {
          if (!warned.has(message.address)) logWarn('(WARN, BRIDGE)', `Not syncing "${message.address}" to "${to.name}": reserved or option list address.`)
          warned.add(message.address)
          continue
        }
        batch.push(message)
        values += 1
      }
      const done = values < SYNC_MESSAGES_PER_STEP
      if (done) batch.push({ address: SYS.SYNC_END, args: [] })
      send(batch)
      // 待っている同期は end を送ってから始める(その PC に begin が end より先に届かないように)
      if (done) finish()
      else setTimeoutFn(() => step(false), SYNC_STEP_MS)
    }
    step(true)
  }

  const requestCatalog = () => sendToAllTargets('request', CATALOG_ADDRESSES.REQUEST)

  return { sendMessage, sendLogged, sendToAllTargets, rejectBatch, sendBatch, firePad, sendSync, requestCatalog }
}
