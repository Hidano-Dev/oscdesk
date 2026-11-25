import { isSpawnAddress, isValidSpawnName, type OscSurfaceParameter } from '@oscdesk/shared'

import { spawnBase, spawnCommandOf, spawnedPrefix, type SpawnCommand } from '../spawn-record'
import { SPAWN_STEP_MS, SPAWNS_PER_STEP, type Core } from './context'
import type { ClientId, UnityRuntimeTarget } from './types'

// ---- 生成の記録(HID-385・D-115) ----
// 記録は送り先の PC(host)ごと。ユニキャストの宛先はその host、ブロードキャストの宛先(D-079)は pong を返したホスト

export interface SpawnsPart {
  recordHostsOf(target: UnityRuntimeTarget): string[]
  sendTargetForHost(host: string): UnityRuntimeTarget | null
  recordHostsForSource(fromHost: string): string[]
  restoreSpawns(host: string, reason: string, then?: (to: UnityRuntimeTarget) => void): number
  sendSpawnCommand(parameter: OscSurfaceParameter, command: SpawnCommand, value: string, clientId: ClientId, reject: (detail: string) => void): void
  reconcileTarget(name: string, clientId: ClientId): void
  onTargetStarted(fromHost: string): void
  onCatalogItemRemoved(fromHost: string, itemAddress: string): void
  onCatalogItemAdded(fromHost: string, itemAddress: string): void
}

export function spawnsPart(core: Core): SpawnsPart {
  const { deps, logInfo, setTimeoutFn, spawns } = core

  const recordHostsOf = (target: UnityRuntimeTarget): string[] =>
    target.broadcast === null ? [target.host] : [...target.responders.keys()]
  const allRecordHosts = () => [...new Set(core.targets.flatMap(recordHostsOf))]
  // 記録の PC へ送るときの宛先。ブロードキャストの宛先では、そのホスト宛てのユニキャストにする(追いついている台に撒かない)
  const sendTargetForHost = (host: string): UnityRuntimeTarget | null => {
    const unicast = core.targets.find(target => target.broadcast === null && target.host === host)
    if (unicast !== undefined) return unicast
    const broadcast = core.targets.find(target => target.broadcast !== null
      && (target.responders.has(host) || core.inBroadcastNetwork(target, host)))
    return broadcast === undefined ? null : { ...broadcast, host }
  }
  // 設計図・起動の合図の送信元を記録の PC へ引く。同じ PC の受け口はループバックや別の NIC のアドレスから答えるので、
  // ユニキャストの宛先は名前解決したアドレス・ループバックの別名(addresses)でも照合する
  const recordHostsForSource = (fromHost: string): string[] => {
    const hosts = new Set<string>()
    for (const target of core.targets) {
      if (target.broadcast === null) {
        if (core.isTargetHost(target, fromHost)) hosts.add(target.host)
      } else if (target.responders.has(fromHost) || core.inBroadcastNetwork(target, fromHost)) {
        hosts.add(fromHost)
      }
    }
    return [...hosts]
  }
  // 止まっているか(ping に答えていない)。クラッシュの扱い(ほかの PC の削除通知を、意図して消された証拠にする)に使う
  const isHostDown = (host: string) => {
    const target = sendTargetForHost(host)
    if (target === null) return true
    if (target.broadcast === null) return !core.isTargetReachable(target)
    const round = target.responders.get(host)
    return round === undefined || round < target.pingRound - 1
  }
  const usedInBlueprints = (packageName: string, name: string) => {
    const prefix = spawnedPrefix(packageName, name)
    return (deps.catalogPcs?.() ?? []).some(pc => pc.items.some(item => item.address.startsWith(prefix)))
  }
  // 余分なものの判定に使う生成担当と、その生成担当が振る名前の番号を除いた部分。記録と、採用中の定義の生成担当の既定の値から集める
  const knownSpawners = () => {
    const bases = new Map<string, Set<string>>()
    const add = (address: string, base: string) => bases.set(address, (bases.get(address) ?? new Set()).add(base))
    for (const entry of spawns.entries()) add(entry.address, spawnBase(entry.name))
    for (const parameter of core.definedParameters.values()) {
      if (parameter.type === 's' && spawnCommandOf(parameter) === 'spawn' && typeof parameter.value === 'string') add(parameter.address, spawnBase(parameter.value))
    }
    return [...bases].map(([address, set]) => ({ address, bases: [...set] }))
  }
  const sendSpawn = (to: UnityRuntimeTarget, address: string, name: string) =>
    core.sendLogged('resend', [to], address, { type: 's', value: name })
  /**
   * 生成し直しを、生成担当ごとに SPAWNS_PER_STEP 個ずつ SPAWN_STEP_MS おきに送り、送り終えたら then を呼ぶ。
   * 受け口の生成担当は 1 フレームの生成数に上限(Max Spawns Per Frame、既定 8)があり、まとめて送ると 9 個目から
   * rate limited で落ちるため。上限以内なら呼び出しの中で全部送る。
   * 各段で今の記録と宛先を確かめ直す(間に消す命令・プロジェクトの取り込み・宛先の差し替えがあれば、記録に無くなったものは
   * 送らず、その PC が送り先でなくなっていれば止める。閉じ込めた古い一覧で送り続けない)
   */
  const sendSpawnsPaced = (host: string, entries: readonly { address: string; name: string }[], then?: (to: UnityRuntimeTarget) => void) => {
    // 世代は全体で増やし続ける(PC ごとに 1 から数え直すと、送り終えて表から外した後の新しい生成し直しが古いものと同じ世代になる)
    const generation = ++core.restoreGeneration
    core.restoreGenerations.set(host, generation)
    const steps: { address: string; name: string }[][] = []
    for (const entry of entries) {
      const index = steps.findIndex(step => step.filter(sent => sent.address === entry.address).length < SPAWNS_PER_STEP)
      if (index === -1) steps.push([entry])
      else steps[index]!.push(entry)
    }
    const run = (index: number) => {
      if (core.stopped || core.restoreGenerations.get(host) !== generation) return
      const to = sendTargetForHost(host)
      if (to === null) return
      const current = spawns.forHost(host)
      for (const entry of steps[index] ?? []) {
        if (current.some(held => held.address === entry.address && held.name === entry.name)) sendSpawn(to, entry.address, entry.name)
      }
      if (index + 1 < steps.length) setTimeoutFn(() => run(index + 1), SPAWN_STEP_MS)
      else {
        // 送り終えたら表から外す(送り先から外した PC の世代を残し続けない)
        core.restoreGenerations.delete(host)
        then?.(to)
      }
    }
    run(0)
  }

  /**
   * 記録にある生成物を、その PC へ生成し直す。止まっている間にほかの PC で消された印のあるものは復元せずに外す。
   * 起動の合図・取り込んだプロジェクトの送信で使う。送ったものの数を返す
   */
  const restoreSpawns = (host: string, reason: string, then?: (to: UnityRuntimeTarget) => void): number => {
    const to = sendTargetForHost(host)
    if (to === null) return 0
    const { restore, dropped } = spawns.takeRestore(host)
    for (const entry of dropped) {
      logInfo('(INFO, BRIDGE)', `Not restoring "${entry.name}" (${entry.address}) on ${host}: it was removed on another PC while ${host} was down.`)
    }
    if (restore.length > 0) logInfo('(INFO, BRIDGE)', `Restoring ${String(restore.length)} spawned object(s) on ${host} (${reason}).`)
    sendSpawnsPaced(host, restore, then)
    if (dropped.length > 0) core.persistDesired()
    return restore.length
  }

  /** set の値が生成担当の命令(HID-385)。名前を振って全宛先へ送り、送り先の PC ごとに記録する */
  const sendSpawnCommand = (parameter: OscSurfaceParameter, command: SpawnCommand, value: string, clientId: ClientId, reject: (detail: string) => void) => {
    if (!isValidSpawnName(value)) {
      reject(`invalid-name: ${parameter.id}`)
      return
    }
    const hosts = allRecordHosts()
    if (command === 'spawn') {
      // 記録に入れるアドレスも保存の形(HeldSpawnSchema)で確かめてから送る。定義は 129 文字以上の対象名・パッケージ名を
      // 通すので、送ってから記録すると保持値のファイル全体が読めなくなり、プロジェクトの書き出しも失敗する(PR #106 の指摘)
      if (!isSpawnAddress(parameter.address)) {
        reject(`invalid-address: ${parameter.id}`)
        return
      }
      const name = spawns.allocate(parameter.address, value, usedInBlueprints)
      // 番号を付けると長さの上限を超える名前は送らない(記録すると保持値のファイルが読めなくなる)
      if (name === null) {
        reject(`invalid-name: ${parameter.id}`)
        return
      }
      // 全送信先の記録を持てないなら送らずに断る(送ってから一部の PC だけ記録すると、その PC の復元が欠ける)
      if (!spawns.canRecord(parameter.address, name, hosts)) {
        reject(`spawn-record-full: ${parameter.id}`)
        return
      }
      core.sendToAllTargets('ui', parameter.address, { type: 's', value: name })
      spawns.recordSpawn(parameter.id, parameter.address, name, hosts)
      logInfo('(INFO, BRIDGE)', `Spawned "${name}" with ${parameter.address} on ${hosts.length === 0 ? 'no known PC' : hosts.join(', ')}.`)
      // 振った名前を要求元へ知らせる(生成したものを操作する画面の行や、消すときの名前に使う)
      deps.publish({ v: 1, type: 'notice', level: 'info', code: 'spawned', detail: name }, clientId)
    } else {
      core.sendToAllTargets('ui', parameter.address, { type: 's', value })
      spawns.recordDestroy(parameter.address, value, hosts)
      logInfo('(INFO, BRIDGE)', `Destroyed "${value}" with ${parameter.address} on ${hosts.length === 0 ? 'no known PC' : hosts.join(', ')}.`)
    }
    core.persistDesired()
  }

  /**
   * 「この PC を記録に合わせる」(HID-385)。その宛先の PC にだけ、記録に無い余分なものを消し、記録にあって欠けているものを
   * 生成し、保持値を送り直す。欠け・余分はその PC の設計図で判定する(設計図が無ければ記録のすべてを欠けているとみなす)
   */
  const reconcileTarget = (name: string, clientId: ClientId) => {
    const target = core.targets.find(candidate => candidate.name === name)
    if (target === undefined) {
      deps.publish({ v: 1, type: 'notice', level: 'error', code: 'reconcile-rejected', detail: `unknown-target: ${name}` }, clientId)
      return
    }
    // 取り込んだプロジェクト(D-090)をまだ Unity へ送っていない間は合わせない。合わせると、送ると決める前の取り込んだ記録の
    // 生成の命令が Unity へ届く(自動の復元と同じく、全宛先への送り直しの後だけにする)
    if (core.unsentSince !== null) {
      deps.publish({ v: 1, type: 'notice', level: 'error', code: 'reconcile-rejected', detail: 'unsent-project' }, clientId)
      return
    }
    let spawned = 0
    let destroyed = 0
    let changed = false
    for (const host of recordHostsOf(target)) {
      const to = sendTargetForHost(host)
      if (to === null) continue
      const pc = (deps.catalogPcs?.() ?? []).find(candidate => recordHostsForSource(candidate.host).includes(host))
      const plan = spawns.reconcile(host, pc === undefined ? null : pc.items.map(item => item.address), knownSpawners())
      for (const entry of plan.dropped) {
        logInfo('(INFO, BRIDGE)', `Not restoring "${entry.name}" (${entry.address}) on ${host}: it was removed on another PC while ${host} was down.`)
      }
      for (const extra of plan.extras) {
        core.sendLogged('resend', [to], extra.destroyAddress, { type: 's', value: extra.name })
        spawns.recordDestroy(extra.destroyAddress, extra.name, [host])
      }
      for (const entry of plan.missing) spawns.recordSpawn(entry.param, entry.address, entry.name, [host])
      sendSpawnsPaced(host, plan.missing)
      spawned += plan.missing.length
      destroyed += plan.extras.length
      // 印だけを外した(ほかの PC で消された印のあるものがこの PC にあった)のも変わったうちに入れて保存する。保存しないと、
      // ブリッジの再起動後にこの PC が起動したとき、古い印で記録が捨てられて復元されない
      changed ||= plan.dropped.length > 0 || plan.missing.length > 0 || plan.extras.length > 0 || plan.cleared > 0
    }
    logInfo('(INFO, BRIDGE)', `Reconciled Unity "${target.name}" with the spawn record: spawned ${String(spawned)}, destroyed ${String(destroyed)}.`)
    core.resendDesired('reconcile requested by UI', undefined, [target])
    if (changed) core.persistDesired()
    deps.publish({ v: 1, type: 'notice', level: 'info', code: 'reconciled', detail: `${target.name}: spawned ${String(spawned)}, destroyed ${String(destroyed)}` }, clientId)
  }

  const onTargetStarted = (fromHost: string) => {
    if (core.stopped) return
    for (const host of recordHostsForSource(fromHost)) {
      const to = sendTargetForHost(host)
      if (to === null) continue
      const reason = `Unity started at ${host}`
      // 取り込んだプロジェクトをまだ送っていない間(D-090)は、生成の復元も保持値の再送も止める
      if (core.unsentSince !== null) {
        logInfo('(INFO, BRIDGE)', `Not restoring spawned objects on ${host} (${reason}): the imported project has not been sent yet.`)
        continue
      }
      // 生成し直してから値を送る(値の再送は D-045 の回復と同じ。生成したものを値の前に揃える)
      restoreSpawns(host, reason, restored => {
        core.autoResendDesired(reason, undefined, [restored])
        core.requestRuntimeOptions(reason, core.runtimeOptions.requestAddresses(), [restored])
      })
    }
  }

  const onCatalogItemRemoved = (fromHost: string, itemAddress: string) => {
    let changed = false
    for (const host of recordHostsForSource(fromHost)) changed = spawns.catalogRemoved(host, itemAddress, isHostDown) || changed
    if (changed) core.persistDesired()
  }

  const onCatalogItemAdded = (fromHost: string, itemAddress: string) => {
    let changed = false
    for (const host of recordHostsForSource(fromHost)) changed = spawns.catalogSeen(host, itemAddress) || changed
    if (changed) core.persistDesired()
  }

  return {
    recordHostsOf,
    sendTargetForHost,
    recordHostsForSource,
    restoreSpawns,
    sendSpawnCommand,
    reconcileTarget,
    onTargetStarted,
    onCatalogItemRemoved,
    onCatalogItemAdded,
  }
}
