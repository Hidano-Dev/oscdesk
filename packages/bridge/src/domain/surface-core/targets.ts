import { NETWORK_SETTINGS, SYS, type DownstreamFrame, type LinkTargetStatus, type LinkUnityStatus } from '@oscdesk/shared'

import { PingMonitor } from '../ping-monitor'
import { PING_INTERVAL_MS, type Core } from './context'
import { isInNetwork, LOOPBACK_NETWORK } from './osc-args'
import type { BroadcastNetwork, ClientId, RuntimeTargetSpec, SyncTarget, UnityRuntimeTarget } from './types'

// 宛先と死活監視(D-045・D-078・D-079)。宛先の一覧、ping と pong、到達性と link の配信、宛先の差し替え。

export function newRuntimeTarget(spec: RuntimeTargetSpec): UnityRuntimeTarget {
  return {
    name: spec.name,
    host: spec.host,
    sendPort: spec.sendPort,
    primary: spec.primary,
    monitor: new PingMonitor(),
    addresses: new Set([spec.host, ...spec.addresses ?? []]),
    hasBeenReachable: false,
    broadcast: spec.broadcast ?? null,
    responders: new Map(),
    upSince: null,
    responderUpSince: new Map(),
    pingRound: 0,
    lastPingSeq: null,
  }
}

export interface TargetsPart {
  primaryTarget(): UnityRuntimeTarget
  isTargetHost(target: UnityRuntimeTarget, host: string): boolean
  isUnityHost(host: string): boolean
  inBroadcastNetwork(target: UnityRuntimeTarget, host: string): boolean
  sourceTarget(from: { host: string; port: number }): UnityRuntimeTarget | null
  isTargetReachable(target: UnityRuntimeTarget): boolean
  publishLink(target?: ClientId, force?: boolean): void
  tick(): void
  linkSnapshot(): { unity: LinkUnityStatus; targets: LinkTargetStatus[] }
  unityStatus(): LinkUnityStatus
  onBroadcastPong(target: UnityRuntimeTarget, host: string, seq: number, bootId: string | null): void
  reportBootId(to: SyncTarget, bootId: string | null): void
  sendTargetForHost(host: string): UnityRuntimeTarget | null
  recordHostsForSource(fromHost: string): string[]
  onTargetStarted(fromHost: string): void
  syncTargets(selection: { target?: string | undefined; host?: string | undefined; port?: number | undefined }): { ok: true; targets: SyncTarget[] } | { ok: false; reason: string }
  answeringSyncTarget(host: string, port: number): SyncTarget | null
  syncRouterUnity(): void
  setTargets(specs: readonly RuntimeTargetSpec[]): void
  statusOf(target: UnityRuntimeTarget): LinkUnityStatus
  currentTargets(): readonly (RuntimeTargetSpec & { readonly broadcast: BroadcastNetwork | null })[]
  primaryHosts(): string[]
  upSinceOfSource(fromHost: string): { pc: string; since: number } | null
  buildHelloFrame(clientId: ClientId, peer?: string): DownstreamFrame
}

export function targetsPart(core: Core): TargetsPart {
  const { deps, now, logInfo } = core

  const primaryTarget = () => core.targets[0]!

  // ブロードキャストの宛先(D-079)では、pong を返したホストだけを Unity とみなす。サブネットの全ホストを
  // Unity とみなすと、同じ LAN の OSC ネイティブ UI の端末の操作がエコー扱いになって中継されなくなるため
  const isTargetHost = (target: UnityRuntimeTarget, host: string) => target.addresses.has(host) || target.responders.has(host)
  const isUnityHost = (host: string) => core.targets.some(target => isTargetHost(target, host))
  // ブリッジと同じ PC の Unity は、返信先を 127.0.0.1 にしているとループバックのアドレスから答える。
  // ブロードキャストはこの PC 自身にも届くので、ループバックからの pong もそのネットワークの 1 台として受ける。
  // 返信先をこの PC の別の NIC のアドレスにしていると、その NIC のアドレスから答える(ネットワークの外)ので、
  // 宛先の addresses(宛先タブが入れるこの PC のアドレス。D-085)からの pong も受ける。受けないと同じ PC の Unity が
  // 到達不能のまま、保持値も再送されない
  const inBroadcastNetwork = (target: UnityRuntimeTarget, host: string) =>
    target.broadcast !== null
      && (isInNetwork(host, target.broadcast) || isInNetwork(host, LOOPBACK_NETWORK) || target.addresses.has(host))
  // 同じホストに複数の宛先がある構成(同一 PC の検証等)では、送信元ポートが宛先の
  // sendPort と一致するものを優先し、決まらなければ主系とみなす
  const sourceTarget = (from: { host: string; port: number }): UnityRuntimeTarget | null => {
    const candidates = core.targets.filter(target => isTargetHost(target, from.host))
    if (candidates.length === 0) return null
    return candidates.find(target => target.sendPort === from.port)
      ?? candidates.find(target => target.primary)
      ?? candidates[0]!
  }

  const publishLink = (target?: ClientId, force = false) => {
    const timestamp = now()
    if (!force && timestamp - core.lastLinkPublishedAt < PING_INTERVAL_MS) return
    core.lastLinkPublishedAt = timestamp
    deps.publish({ v: 1, type: 'link', ...linkSnapshot() }, target)
  }

  const isTargetReachable = (target: UnityRuntimeTarget) => {
    const status = target.monitor.snapshot()
    return status.lastPongSeq !== null && status.consecutiveLosses === 0
  }

  const tick = () => {
    if (core.stopped) return
    for (const target of core.targets) {
      const before = target.monitor.snapshot().consecutiveLosses
      // seq は全宛先で一意にする。pong は seq しか持たないため、同じホストの宛先でも出所を特定できる
      const seq = target.monitor.nextPing(now(), core.pingSeq++)
      target.pingRound += 1
      target.lastPingSeq = seq
      const lost = target.monitor.snapshot().consecutiveLosses > before
      if (target.primary) core.diagnostics?.onPingCycle?.({ previousLost: lost })
      core.sendMessage(target.host, target.sendPort, SYS.PING, { type: 'i', value: seq })
    }
    publishLink()
  }

  const linkSnapshot = () => ({
    unity: unityStatus(),
    targets: core.targets.map(target => ({ name: target.name, primary: target.primary, ...statusOf(target) })),
  })

  function unityStatus(): LinkUnityStatus {
    return statusOf(primaryTarget())
  }

  // ブロードキャストの宛先(D-079)への pong。到達性は「その周回で誰か 1 台でも答えたか」で、最初の 1 台で確定する。
  // 再送は答えたホストごとに見て、初めて答えた・周回を 1 回以上取りこぼしてから戻ったホストへだけ、そのホスト宛て(ユニキャスト)に送る。
  // 宛先全体の到達性で判断すると、他の台が答え続けている間に再起動した台の回復が見えず、
  // ブロードキャストで再送すると追いついている台にまで同じ値を撒くため
  const onBroadcastPong = (target: UnityRuntimeTarget, host: string, seq: number, bootId: string | null) => {
    const result = target.monitor.onPong(seq, now())
    const previous = target.responders.get(host)
    target.responders.set(host, target.pingRound)
    const isNew = previous === undefined
    if (isNew || previous < target.pingRound - 1) {
      target.responderUpSince.set(host, now())
      const reason = isNew ? `Unity first reachable at ${host}` : `Unity recovered at ${host}`
      const unicast: UnityRuntimeTarget = { ...target, host }
      core.autoResendDesired(reason, undefined, [unicast])
      core.requestRuntimeOptions(reason, core.runtimeOptions.requestAddresses(), [unicast])
    }
    if (isNew) {
      if (target.primary) syncRouterUnity()
      deps.onRespondersChanged?.()
    }
    // 起動 ID は答えた PC ごと(D-164・D-169)。同じ周回の 2 台目以降も PC としては受けた答えなので知らせる。
    // サーフェス定義の保持値の再送(上の初回の到達・回復)を済ませてから知らせる(ユニキャストと同じ順。パッドの同期の後に
    // 古い定義の値が届いて、同じアドレスのパッドの値を巻き戻さないように。PR #175 のレビュー)
    reportBootId({ name: target.name, host, port: target.sendPort }, bootId)
    if (result.accepted) {
      target.hasBeenReachable = true
      publishLink()
      if (target.primary) core.diagnostics?.onPongAccepted?.()
    }
  }

  // OSC ネイティブ UI の中継(D-7)が見る Unity を、今の主系に合わせる。ブロードキャストの主系では pong を返したホストを使う
  function syncRouterUnity(): void {
    const primary = primaryTarget()
    core.uiRouter?.setUnity({ host: primary.host, port: primary.sendPort }, [...primary.addresses, ...primary.responders.keys()])
  }

  function setTargets(specs: readonly RuntimeTargetSpec[]): void {
    const primaries = specs.filter(spec => spec.primary)
    if (specs.length === 0 || primaries.length !== 1) throw new Error('setTargets needs exactly one primary target')
    const ordered = [...primaries, ...specs.filter(spec => !spec.primary)]
    const sameNetwork = (a: BroadcastNetwork | null, b: BroadcastNetwork | null) =>
      a === b || (a !== null && b !== null && a.networkInt === b.networkInt && a.maskInt === b.maskInt)
    const optionsBefore = JSON.stringify(core.runtimeOptions.frame())
    core.targets = ordered.map(spec => {
      const kept = core.targets.find(target => target.name === spec.name && target.host === spec.host
        && target.sendPort === spec.sendPort && sameNetwork(target.broadcast, spec.broadcast ?? null))
      if (kept === undefined) {
        // 同じ名前でも別の宛先(別のネットワークの all-devices など)なら、以前の宛先が返した一覧を引き継がない
        core.runtimeOptions.forgetTarget(spec.name)
        return newRuntimeTarget(spec)
      }
      // 主系・副系の役割だけが変わった宛先も監視の状態は引き継ぐ(役割はエコーの扱いにしか効かない)
      return { ...kept, primary: spec.primary, addresses: new Set([spec.host, ...spec.addresses ?? []]) }
    })
    core.targetNames.splice(0, core.targetNames.length, ...core.targets.map(target => target.name))
    // 一覧(D-053)は宛先名ごとに持つので、宛先が変わると和集合(選択肢・レコードのキー)も変わる。変わったら全 UI へ配り直し、
    // 新しく現れたキーの行を作る(配り直さないと、新しい宛先が一覧を返さない間 UI に旧宛先の候補が残り続ける)
    if (JSON.stringify(core.runtimeOptions.frame()) !== optionsBefore) {
      core.publishRuntimeOptions()
      core.addRecordRows(core.desired.addKeys(core.runtimeOptions.recordKeys()))
    }
    syncRouterUnity()
    core.warnedEchoMismatch.clear()
    logInfo('(INFO, BRIDGE)', `Unity targets: ${core.targets.map(target => `${target.name} ${target.host}:${String(target.sendPort)}${target.primary ? ' (primary)' : ''}`).join(', ')}.`)
    publishLink(undefined, true)
  }

  function statusOf(target: UnityRuntimeTarget): LinkUnityStatus {
    const status = target.monitor.snapshot()
    return {
      reachability: status.consecutiveLosses > 0 ? 'lost' : status.lastPongSeq === null ? 'unknown' : 'reachable',
      lastRttMs: status.lastRttMs,
      consecutiveLosses: status.consecutiveLosses,
      lastPongSeq: status.lastPongSeq,
    }
  }

  const currentTargets = () => core.targets.map(target => ({
    name: target.name,
    host: target.host,
    sendPort: target.sendPort,
    primary: target.primary,
    addresses: [...target.addresses],
    broadcast: target.broadcast,
  }))

  const primaryHosts = () => [...new Set([...primaryTarget().addresses, ...primaryTarget().responders.keys()])]

  const upSinceOfSource = (fromHost: string): { pc: string; since: number } | null => {
    for (const target of core.targets) {
      if (target.broadcast === null) {
        if (isTargetHost(target, fromHost) && isTargetReachable(target) && target.upSince !== null) return { pc: target.host, since: target.upSince }
        continue
      }
      // ブロードキャストの宛先は答えたホストごと。直前の周回まで答えていれば答えている(isHostDown と同じ基準)
      const round = target.responders.get(fromHost)
      const since = target.responderUpSince.get(fromHost)
      if (round !== undefined && round >= target.pingRound - 1 && since !== undefined) return { pc: fromHost, since }
    }
    return null
  }

  // 受理した pong の起動 ID を知らせる(D-169)。第 2 引数の無い pong(以前の受け口)は宛先ごとに 1 回だけ記録に残す
  // (起動 ID が無いと起動を知れず、自動の再送が効かないことに気づけるように)
  function reportBootId(to: SyncTarget, bootId: string | null): void {
    if (bootId === null) {
      const key = `${to.host}:${String(to.port)}`
      if (!core.warnedNoBootId.has(key) && core.warnedNoBootId.size < 1024) {
        core.warnedNoBootId.add(key)
        logInfo('(INFO, BRIDGE)', `Target "${to.name}" (${key}) answers ping without a boot id; automatic resend cannot detect its restarts.`)
      }
    }
    deps.onBootId?.(to, bootId)
  }

  // 送り先の PC(ユニキャストの宛先はその host、ブロードキャストの宛先は pong を返したホスト)へ送るときの宛先。
  // ブロードキャストの宛先では、そのホスト宛てのユニキャストにする(追いついている台に撒かない)
  function sendTargetForHost(host: string): UnityRuntimeTarget | null {
    const unicast = core.targets.find(target => target.broadcast === null && target.host === host)
    if (unicast !== undefined) return unicast
    const broadcast = core.targets.find(target => target.broadcast !== null
      && (target.responders.has(host) || inBroadcastNetwork(target, host)))
    return broadcast === undefined ? null : { ...broadcast, host }
  }
  // 設計図・起動の合図の送信元を送り先の PC へ引く。同じ PC の受け口はループバックや別の NIC のアドレスから答えるので、
  // ユニキャストの宛先は名前解決したアドレス・ループバックの別名(addresses)でも照合する
  function recordHostsForSource(fromHost: string): string[] {
    const hosts = new Set<string>()
    for (const target of core.targets) {
      if (target.broadcast === null) {
        if (isTargetHost(target, fromHost)) hosts.add(target.host)
      } else if (target.responders.has(fromHost) || inBroadcastNetwork(target, fromHost)) {
        hosts.add(fromHost)
      }
    }
    return [...hosts]
  }

  // 設計図の起動の合図(HID-385)。サーフェス定義の保持値をその PC へ再送する(生成の記録は D-166 で撤去した)
  function onTargetStarted(fromHost: string): void {
    if (core.stopped) return
    for (const host of recordHostsForSource(fromHost)) {
      const to = sendTargetForHost(host)
      if (to === null) continue
      const reason = `Unity started at ${host}`
      core.autoResendDesired(reason, undefined, [to])
      if (core.unsentSince === null) core.requestRuntimeOptions(reason, core.runtimeOptions.requestAddresses(), [to])
    }
  }

  /**
   * OSCQuery の HOST_INFO で見たエンドポイント(host と OSC の受信ポート)を、今 ping に答えている送り先 1 台へ引く(D-169)。
   * pong の起動 ID と同じ記録の印(宛先の host と送信ポート。ブロードキャストの宛先は答えた PC)に揃えるために使う。
   * 送り先でない・まだ答えていない・喪失中なら null(pong が届いたときにそちらで判定する。サーフェス定義の初回の到達・回復の
   * 再送より先にパッドを同期しない)
   */
  function answeringSyncTarget(host: string, port: number): SyncTarget | null {
    for (const target of core.targets) {
      if (target.sendPort !== port) continue
      if (target.broadcast === null) {
        if ((target.host === host || target.addresses.has(host)) && isTargetReachable(target)) return { name: target.name, host: target.host, port: target.sendPort }
        continue
      }
      const round = target.responders.get(host)
      if (round !== undefined && round >= target.pingRound - 1) return { name: target.name, host, port: target.sendPort }
    }
    return null
  }
  function syncTargets(selection: { target?: string | undefined; host?: string | undefined; port?: number | undefined }): { ok: true; targets: SyncTarget[] } | { ok: false; reason: string } {
    const named = selection.target === undefined ? core.targets : core.targets.filter(target => target.name === selection.target)
    if (named.length === 0) return { ok: false, reason: `unknown-target: ${String(selection.target)}` }
    if (selection.host === undefined) {
      return { ok: true, targets: named.map(target => ({ name: target.name, host: target.host, port: target.sendPort })) }
    }
    // 1 台に絞るのは今の宛先の PC だけ(ユニキャストの宛先の host か、ブロードキャストの宛先へ pong を返したホスト)。
    // 任意のアドレスへ送らない(認証の無い LAN から UDP を撒く口にしない)
    // port を添えると、ホストと OSC の受信ポートの組(D-168 の宛先の単位)で選ぶ(同じ PC の複数のアプリを分ける)
    const host = selection.host
    const matched = named.flatMap(target => {
      if (selection.port !== undefined && target.sendPort !== selection.port) return []
      const here = target.broadcast === null ? target.host === host || target.addresses.has(host) : target.responders.has(host)
      return here ? [{ name: target.name, host: target.broadcast === null ? target.host : host, port: target.sendPort }] : []
    })
    if (matched.length === 0) return { ok: false, reason: `unknown-host: ${host}${selection.port === undefined ? '' : `:${String(selection.port)}`}` }
    // 同じ PC を指す宛先が 2 つあっても(同じ host の別ポートでなければ)1 回だけ送る
    const unique = new Map(matched.map(to => [`${to.host}:${String(to.port)}`, to]))
    return { ok: true, targets: [...unique.values()] }
  }

  function buildHelloFrame(clientId: ClientId, peer?: string): DownstreamFrame {
      const primary = primaryTarget()
      return {
        v: 1, type: 'hello', clientId, protocolVersion: 1,
        server: { name: deps.config.server?.name ?? 'oscdesk-bridge', version: deps.config.server?.version ?? '0.1.0' },
        unity: { host: primary.host, sendPort: primary.sendPort },
        targets: core.targets.map(target => ({ name: target.name, host: target.host, sendPort: target.sendPort, primary: target.primary })),
        bridge: {
          oscListenPort: deps.config.bridge.oscListenPort,
          wsPort: deps.config.bridge.wsPort,
        },
        heartbeat: { intervalMs: 15_000, timeoutMs: 30_000 },
        pingIntervalMs: PING_INTERVAL_MS,
        debug: deps.config.debug,
        adapters: [...(deps.adapterKinds ?? ['osc'])],
        // 分からない(空)・長すぎる(ゾーン ID 付きの IPv6 など)送信元は載せない(スキーマが断り、hello ごと捨てられる。D-153)
        ...(peer === undefined || peer === '' || peer.length > NETWORK_SETTINGS.MAX_REQUESTER_CHARS ? {} : { peer }),
      }
  }

  return {
    primaryTarget,
    isTargetHost,
    isUnityHost,
    inBroadcastNetwork,
    sourceTarget,
    isTargetReachable,
    publishLink,
    tick,
    linkSnapshot,
    unityStatus,
    onBroadcastPong,
    syncRouterUnity,
    setTargets,
    statusOf,
    currentTargets,
    primaryHosts,
    upSinceOfSource,
    buildHelloFrame,
    reportBootId,
    sendTargetForHost,
    recordHostsForSource,
    onTargetStarted,
    syncTargets,
    answeringSyncTarget,
  }
}
