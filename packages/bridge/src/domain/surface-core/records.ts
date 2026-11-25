import { recordHasRowIds, type LockRef, type OscArg } from '@oscdesk/shared'

import type { DesiredValue } from '../desired-values'
import type { SentEvent } from '../sent-log'
import type { Core } from './context'
import type { ClientId, UnityRuntimeTarget } from './types'

// Unity の一覧(D-053・D-088)と、Record の行の追加・削除・改名(D-062・D-075・D-087)。

export interface RecordsPart {
  warnRuntimeOptionsOnce(key: string, message: string): void
  publishRuntimeOptions(target?: ClientId): void
  requestRuntimeOptions(reason: string, addresses: readonly string[], to: readonly UnityRuntimeTarget[]): void
  sendUiKeyLists(origin: SentEvent['origin'], to: readonly UnityRuntimeTarget[], only?: string): void
  addRecordKey(recordId: string, key: string, clientId: ClientId): void
  removeRecordKey(recordId: string, key: string, clientId: ClientId): void
  renameRecordKey(recordId: string, key: string, name: string, clientId: ClientId): void
  retainUiRows(): void
  addRecordRows(created: DesiredValue[], automatic?: boolean): void
  isLockableRef(ref: LockRef): boolean
}

export function recordsPart(core: Core): RecordsPart {
  const { deps, logInfo, logWarn, desired, runtimeOptions } = core

  const warnRuntimeOptionsOnce = (key: string, message: string) => {
    if (core.warnedRuntimeOptions.has(key)) return
    core.warnedRuntimeOptions.add(key)
    logWarn('(WARN, BRIDGE)', message)
  }

  // 一覧は全量を配る。同じ一覧の繰り返しは receive が unchanged を返すので、呼び出し側で配り直さない
  const publishRuntimeOptions = (target?: ClientId) => {
    if (core.hasDefinition) deps.publish(runtimeOptions.frame(core.listIdOf), target)
  }

  // 一覧の要求(optionsFrom.request)は引数なしで送る。応答は定義が宣言した一覧のアドレスへ届く(D-053)
  // 取り込んだプロジェクトの値をまだ送っていない間(D-090)は、要求も送らない。要求のアドレスは取り込んだ定義が決めるので、
  // 細工したプロジェクトなら任意のアドレス(例: /cue/go)を引数なしで撃て、受け口がそのままイベントを発火する。
  // 「読み込みは画面と保持値の更新だけで、Unity へ送るのは明示の操作だけ」を要求にも当てる。全宛先への resend の後に送る
  const requestRuntimeOptions = (reason: string, addresses: readonly string[], to: readonly UnityRuntimeTarget[]) => {
    if (addresses.length === 0 || to.length === 0) return
    if (core.unsentSince !== null) {
      logInfo('(INFO, BRIDGE)', `Not requesting ${String(addresses.length)} option list(s) from Unity (${reason}): the imported project has not been sent yet.`)
      return
    }
    for (const target of to) {
      logInfo('(INFO, BRIDGE)', `Requesting ${String(addresses.length)} option list(s) from Unity "${target.name}" (${reason}).`)
      for (const address of addresses) core.sendLogged('request', [target], address)
    }
  }

  // UI で管理するキーの一覧(D-075)を、keysFrom.address へ行の ID の s の並びで送る(Unity はこれで行の順と削除を知る)。
  // Name は行のメッセージで届くので一覧には載せない(改名で一覧が変わらず、Unity は ID で同じ行と分かる。D-087)
  const sendUiKeyLists = (origin: SentEvent['origin'], to: readonly UnityRuntimeTarget[], only?: string) => {
    for (const list of runtimeOptions.uiKeyLists()) {
      if (only !== undefined && list.address !== only) continue
      core.sendLogged(origin, to, list.address, ...list.rows.map((row): OscArg => ({ type: 's', value: row.id })))
    }
  }

  const rejectRecordKey = (clientId: ClientId, detail: string) => {
    deps.publish({ v: 1, type: 'notice', level: 'error', code: 'record-key-rejected', detail }, clientId)
  }

  /**
   * 通常の画面からの行の追加(D-075)。UI で管理するキーなら一覧の末尾に足して Unity へ送り直し、
   * どちらの出どころでも、同じキーの集合を共有する state レコードに default の行を作って送る。
   * UI で管理する一覧では key は新しい行の Name で、行のキーになる ID はここで振る(D-087)
   */
  const addRecordKey = (recordId: string, key: string, clientId: ClientId) => {
    const record = core.definedRecords.find(candidate => candidate.id === recordId)
    if (record === undefined) return rejectRecordKey(clientId, `unknown-record: ${recordId}`)
    if (key === '') return rejectRecordKey(clientId, 'empty-key')
    const keysAddress = record.keysFrom.address
    let rowKey = key
    if (recordHasRowIds(record)) {
      const added = runtimeOptions.addUiKey(keysAddress, key)
      if (added.result !== 'added') return rejectRecordKey(clientId, `${added.result === 'full' ? 'full' : 'exists'}: ${key}`)
      rowKey = added.id
      sendUiKeyLists('ui', core.targets, keysAddress)
      publishRuntimeOptions()
    }
    const lists = core.definedRecords
      .filter(candidate => candidate.keysFrom.address === keysAddress)
      .map(candidate => ({ record: candidate.id, keys: [rowKey] }))
    const created = desired.addKeys(lists)
    if (created.length === 0 && record.keysFrom.source !== 'ui') return rejectRecordKey(clientId, `exists: ${key}`)
    addRecordRows(created, false)
    core.persistDesired()
  }

  /**
   * 通常の画面からの行の削除(D-075)。同じキーの集合を共有する全レコードから行を消し、全量を配り直す。
   * UI で管理する一覧では key は行の ID(D-087)
   */
  const removeRecordKey = (recordId: string, key: string, clientId: ClientId) => {
    const record = core.definedRecords.find(candidate => candidate.id === recordId)
    if (record === undefined) return rejectRecordKey(clientId, `unknown-record: ${recordId}`)
    const keysAddress = record.keysFrom.address
    const name = recordHasRowIds(record) ? runtimeOptions.uiRowName(keysAddress, key) : undefined
    const listed = recordHasRowIds(record) && runtimeOptions.removeUiKey(keysAddress, key)
    const removed = desired.removeKey(keysAddress, key)
    if (!listed && !removed) return rejectRecordKey(clientId, `not-found: ${key}`)
    if (listed) {
      sendUiKeyLists('ui', core.targets, keysAddress)
      publishRuntimeOptions()
    }
    logInfo('(INFO, BRIDGE)', `Removed record row "${name ?? key}" (${keysAddress}).`)
    // Unity の一覧にまだあるキーは行が残るので、default で作り直して Unity にも送る(値が「既定値に戻る」)
    const recreated = desired.addKeys(runtimeOptions.recordKeys())
    for (const target of core.targets.filter(core.isTargetReachable)) {
      for (const value of recreated) core.sendLogged('row', [target], value.address, ...value.args)
    }
    // desired の差分は値の追加・更新しか表せないので、消した行は全量で配って UI に落とさせる
    core.publishDesiredFull()
    core.persistDesired()
  }

  /**
   * UI で管理する一覧の行の改名(D-087)。行のキーは ID のままなので、保持値・保存・表示・アクションは付け替えない。
   * 一覧(ID の並び)も変わらないので送り直さず、同じキーの集合を共有する state レコードの行だけを新しい Name で
   * Unity へ送り直し、UI へ一覧(Name)と行の差分を配る。trigger のレコードは保持値が無いので、次に押したときに新しい Name で届く
   */
  const renameRecordKey = (recordId: string, key: string, name: string, clientId: ClientId) => {
    const record = core.definedRecords.find(candidate => candidate.id === recordId)
    if (record === undefined) return rejectRecordKey(clientId, `unknown-record: ${recordId}`)
    if (!recordHasRowIds(record)) return rejectRecordKey(clientId, `not-renamable: ${recordId}`)
    if (name === '') return rejectRecordKey(clientId, 'empty-key')
    const keysAddress = record.keysFrom.address
    const before = runtimeOptions.uiRowName(keysAddress, key)
    const result = runtimeOptions.renameUiKey(keysAddress, key, name)
    if (result === 'unchanged') return
    if (result === 'not-found' || result === 'unknown') return rejectRecordKey(clientId, `not-found: ${key}`)
    if (result === 'exists') return rejectRecordKey(clientId, `exists: ${name}`)
    logInfo('(INFO, BRIDGE)', `Renamed record row "${before ?? key}" to "${name}" (${keysAddress}).`)
    publishRuntimeOptions()
    const rows = desired.rowsOf(keysAddress, key)
    for (const value of rows) core.sendToAllTargets('ui', value.address, ...value.args)
    if (rows.length > 0) deps.publish(core.desiredFrame(false, rows))
    core.persistDesired()
  }

  // UI で管理するキーの一覧に無いキーの行は持たない(古い画面からの書き込みや、一覧の無い保存から戻った行)
  const retainUiRows = () => {
    for (const list of runtimeOptions.uiKeyLists()) desired.retainKeys(list.address, list.rows.map(row => row.id))
  }

  // 反映済みのキーの一覧に新しいキーが現れたら(初報・反映の操作・宛先の切り替え。D-088)、default で行を作って
  // 到達可能な台へ送り、差分を配る(D-062)。
  // 未到達の台には初回到達・回復の再送で届く。
  // automatic は一覧の届き・反映・宛先の切り替えで作った行。取り込んだプロジェクトの値をまだ送っていない間(D-090)は
  // 行を作って保持・配信するだけで送らない(送ると、利用者が確かめる前に Unity のその行を既定値で上書きする)。
  // 利用者が足した行(recordKeyAdd)は明示の操作なので送る
  const addRecordRows = (created: DesiredValue[], automatic = true) => {
    if (created.length === 0) return
    const sendTo = automatic && core.unsentSince !== null ? [] : core.targets.filter(core.isTargetReachable)
    if (sendTo.length === 0 && automatic && core.unsentSince !== null) {
      logInfo('(INFO, BRIDGE)', `Not sending ${String(created.length)} new record row(s) to Unity: the imported project has not been sent yet.`)
    }
    for (const target of sendTo) {
      logInfo('(INFO, BRIDGE)', `Sending ${String(created.length)} new record row(s) to Unity "${target.name}".`)
      for (const value of created) core.sendLogged('row', [target], value.address, ...value.args)
    }
    deps.publish(core.desiredFrame(false, created))
    core.persistDesired()
  }

  const isLockableRef = (ref: LockRef): boolean => {
    if ('param' in ref) return core.definedParameters.has(ref.param)
    const record = core.definedRecords.find(candidate => candidate.id === ref.record)
    if (record === undefined) return false
    const listed = runtimeOptions.recordKeys().find(keys => keys.record === record.id)?.keys.includes(ref.key) ?? false
    return listed || desired.rowsOf(record.keysFrom.address, ref.key).length > 0
  }

  return {
    warnRuntimeOptionsOnce,
    publishRuntimeOptions,
    requestRuntimeOptions,
    sendUiKeyLists,
    addRecordKey,
    removeRecordKey,
    renameRecordKey,
    retainUiRows,
    addRecordRows,
    isLockableRef,
  }
}
