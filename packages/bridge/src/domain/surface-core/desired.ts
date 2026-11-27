import { recordHasRowIds, type DownstreamFrame, type OscArg } from '@oscdesk/shared'

import type { PersistedDesired } from '../desired-values'
import type { Core } from './context'
import type { ClientId, UnityRuntimeTarget } from './types'

// 保持値と再送(D-045・D-058・D-090)。保持値の配信・保存・再送と、取り込んだプロジェクトの未送信の印。

export interface DesiredPart {
  desiredFrame(full: boolean, values?: readonly { address: string; args: readonly OscArg[] }[]): DownstreamFrame
  publishDesiredFull(target?: ClientId): void
  resendDesired(reason: string, only?: ReadonlySet<string>, to?: readonly UnityRuntimeTarget[]): void
  autoResendDesired(reason: string, only?: ReadonlySet<string>, to?: readonly UnityRuntimeTarget[]): void
  publishDesiredStatus(target?: ClientId): void
  heldValues(): PersistedDesired
  persistDesired(): void
  recordDesired(messages: readonly { address: string; args: readonly OscArg[] }[]): void
  withCurrentRowName(address: string, args: readonly OscArg[]): OscArg[]
  definitionArgs(address: string, args: readonly OscArg[]): OscArg[]
}

export function desiredPart(core: Core): DesiredPart {
  const { deps, now, logInfo, desired } = core

  // 保持値はパラメータ id と JSON の値・Record の行で配る(HID-389)。保持値は型に合うものだけなので、値は必ず読める
  const desiredFrame = (full: boolean, values: readonly { address: string; args: readonly OscArg[] }[] = desired.snapshot()): DownstreamFrame => {
    const entries = core.toIdEntries(values)
    return {
      v: 1, type: 'desired', full,
      values: entries.values.flatMap(entry => entry.value === undefined ? [] : [{ param: entry.param, value: entry.value }]),
      rows: entries.rows,
    }
  }

  const publishDesiredFull = (target?: ClientId) => {
    if (!core.hasDefinition) return
    deps.publish(desiredFrame(true), target)
  }

  // 保持値を Unity へ送り直す(D-045)。state のみが対象で、trigger は保持していないため再送されない。
  // Unity の再起動は pong の喪失→回復で検知する。ping の間隔より速い再起動は検知できないが、
  // 起動識別子(bootId)での検知はマニフェストごと廃止した(D-051)。UI の「再送」操作で補える。
  // 宛先を絞ると、その台だけが他の台に追いつける(D-046)。
  // レコードはキーごとに 1 エントリなので、行ごとに 1 メッセージになる(D-062)
  const resendDesired = (reason: string, only?: ReadonlySet<string>, to: readonly UnityRuntimeTarget[] = core.targets) => {
    // UI で管理するキーの一覧(D-075)は行の並びと削除を Unity に伝える値なので、行より先に毎回送り直す
    core.sendUiKeyLists('resend', to)
    const values = desired.snapshot().filter(value => only === undefined || only.has(desired.entryId(value.address, value.args)))
    if (values.length === 0) return
    for (const target of to) {
      logInfo('(INFO, BRIDGE)', `Resending ${String(values.length)} desired value(s) to Unity "${target.name}" (${reason}).`)
      for (const value of values) core.sendLogged('resend', [target], value.address, ...value.args)
    }
  }
  /**
   * ブリッジが自分の契機で行う保持値の再送(初回の到達・回復・定義の採用)。取り込んだプロジェクトの値をまだ送っていない間
   * (D-090)は送らない。送ると、利用者が確かめる前に取り込んだ値が Unity へ入る(Unity の再起動・再接続のたびに起きうる)。
   * 上り resend は利用者の明示の操作なので、この関門を通らない
   */
  const autoResendDesired = (reason: string, only?: ReadonlySet<string>, to: readonly UnityRuntimeTarget[] = core.targets) => {
    if (to.length === 0) return
    if (core.unsentSince !== null) {
      logInfo('(INFO, BRIDGE)', `Not resending desired values to Unity ${to.map(target => `"${target.name}"`).join(', ')} (${reason}): the imported project has not been sent yet.`)
      return
    }
    resendDesired(reason, only, to)
  }

  const desiredStatusFrame = (): DownstreamFrame => ({ v: 1, type: 'desiredStatus', unsent: core.unsentSince !== null, since: core.unsentSince })

  // 定義が無くても送る(UI は再接続の surfaceRequest で必ず今の状態を受け取り、古い「未送信」の表示を残さない)
  const publishDesiredStatus = (target?: ClientId) => {
    deps.publish(desiredStatusFrame(), target)
  }

  // 保持値の全量(UI で管理する一覧を含む)。保存(D-058)とプロジェクトの書き出し(D-090)で同じものを使う
  const heldValues = (): PersistedDesired => {
    const keyLists = core.runtimeOptions.uiKeyLists()
    return {
      ...desired.persistable(),
      ...(keyLists.length === 0 ? {} : { keyLists }),
    }
  }

  // 保存は間引きを store 側に任せ、ここでは変わるたびに全量を渡すだけにする(D-058)
  // 未送信の印(D-090)は採用中の定義のファイルにだけ書く(印はその定義の値に対するもので、別の定義へは移さない)
  const persistDesired = () => {
    if (core.activeName === undefined) return
    deps.desiredValuesStore?.save(core.activeName, { ...heldValues(), ...(core.unsentSince === null ? {} : { unsentSince: core.unsentSince }) })
  }

  const uiRecordAt = (address: string) =>
    core.definedRecords.find(candidate => candidate.address === address && recordHasRowIds(candidate))
  // UI で管理するキー(D-075)の一覧に無いキーの行か。別の画面で消した行へ、古い画面から書き込んだときに起きる
  const isUnlistedUiRow = (address: string, args: readonly OscArg[]) => {
    const record = uiRecordAt(address)
    const head = args[0]
    if (record === undefined || head?.type !== 's') return false
    return core.runtimeOptions.uiRowName(record.keysFrom.address, head.value) === undefined
  }
  /**
   * ID を持つ行(D-087)の Name を、一覧にある今の Name に揃える。改名の直後に古い画面が古い Name のまま値を送っても、
   * Unity には今の Name で届く(Name の正は一覧で、行の値の操作は Name を変える操作ではない)。一覧に無い行はそのまま
   */
  const withCurrentRowName = (address: string, args: readonly OscArg[]): OscArg[] => {
    const record = uiRecordAt(address)
    const head = args[0]
    if (record === undefined || head?.type !== 's' || args[1]?.type !== 's') return [...args]
    const name = core.runtimeOptions.uiRowName(record.keysFrom.address, head.value)
    return name === undefined || name === args[1].value ? [...args] : [head, { type: 's', value: name }, ...args.slice(2)]
  }

  /**
   * 採用中の定義のパラメータ・Record の行のアドレスでは、T / F を i の 1 / 0 に直す(HID-492)。定義の bool は i の 0/1 で
   * 送り・保持する契約(D-017)で、T のまま送ると Unity には新しい値が届くのに保持値は型が合わず更新されず、次の再送で
   * 古い値へ巻き戻る。エコーも同じ形に揃えて照合する。定義に無いアドレス(版 2 のパッドの T / F 部品)はそのまま
   */
  const definitionArgs = (address: string, args: readonly OscArg[]): OscArg[] => {
    if (!core.parametersByAddress.has(address) && !core.recordsByAddress.has(address)) return [...args]
    return args.map(arg => arg.type === 'T' || arg.type === 'F' ? { type: 'i', value: arg.type === 'T' ? 1 : 0 } : arg)
  }

  const recordDesired = (messages: readonly { address: string; args: readonly OscArg[] }[]) => {
    const changed = messages.filter(message =>
      !isUnlistedUiRow(message.address, message.args) && desired.record(message.address, message.args))
    for (const message of changed) core.lastOperatedAt.set(desired.entryId(message.address, message.args), now())
    if (changed.length > 0) {
      deps.publish(desiredFrame(false, changed))
      persistDesired()
    }
  }

  return {
    desiredFrame,
    publishDesiredFull,
    resendDesired,
    autoResendDesired,
    publishDesiredStatus,
    heldValues,
    persistDesired,
    recordDesired,
    withCurrentRowName,
    definitionArgs,
  }
}
