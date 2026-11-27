import { resolveOscSurface, type SurfaceDefinition } from '@oscdesk/shared'

import { migrateLegacyRowKeys, type PersistedDesired } from '../desired-values'
import type { Core } from './context'

// 定義の採用(D-044・D-058・D-090・D-117)。保持値の引き継ぎ・復元・取り込みと、定義から引く表の作り直し。

export interface AdoptionPart {
  setDefinition(source: SurfaceDefinition | null, name?: string, imported?: PersistedDesired): void
}

export function adoptionPart(core: Core): AdoptionPart {
  const { deps, now, logInfo, desired, runtimeOptions } = core

  const setDefinition = (source: SurfaceDefinition | null, name?: string, imported?: PersistedDesired) => {
    // 版 2 の定義を OSC の結び付けでアドレスへ解決し、中ではアドレスで扱う(D-117)。フレームで UI へ出すときに id へ戻す
    const definition = source === null ? null : resolveOscSurface(source)
    const holdsValues = core.hasDefinition
    const importing = definition !== null && imported !== undefined
    // 未送信の印(D-090)は「採用中の定義の保持値をまだ Unity へ送っていない」という、定義ごとの状態として扱う
    // (印は採用中の定義のファイルにだけ書く)。
    // - 同じ定義の再採用(レイアウトの保存など)は、メモリ上の値と印をそのまま引き継ぐ
    // - 未送信の定義から別の定義へ切り替えるときは、メモリ上の値(Unity に入っていない)を引き継がず、切り替え先の
    //   ファイルから戻す。引き継ぐと、送っていない値が別の定義の値として自動の再送で Unity へ出てしまう
    // - 切り替え先のファイルに印があれば(取り込んだまま送っていない定義。ブリッジの再起動後の最初の採用でなくても)、
    //   メモリ上の値でなくそのファイルの値と印を戻す
    const sameDefinition = name !== undefined && name === core.activeName && holdsValues
    const keepsUnsent = sameDefinition && core.unsentSince !== null
    // 最初の採用(保持値を持っていない)はどのみちファイルを読むので、印だけを先に覗かない
    const markedSince = holdsValues && !importing && !keepsUnsent && definition !== null && name !== undefined
      ? deps.desiredValuesStore?.unsentSince?.(name)
      : undefined
    const leavingUnsent = core.unsentSince !== null && !sameDefinition
    // replace = メモリ上の値を引き継がず、取り込み・ファイルの値で置き換える採用
    const replace = importing || leavingUnsent || markedSince !== undefined
    // 取り込み(D-090)は保持値をプロジェクトの値で置き換える。メモリ上の値を引き継ぐと、プロジェクトに無い値
    // (プロジェクトを書き出した後に足したパラメータ・行)が取り込み前の値のまま残り、取り込んだ状態にならない
    if (replace) desired.setDefinition(null)
    const reset = desired.setDefinition(definition)
    // 保持値を持っていない採用(ブリッジ起動後の最初の採用)に限り、保存しておいた値を戻す(D-058)。
    // 稼働中の再採用・切り替えは従来どおりメモリ上の値を引き継ぐ(Unity に入っているのはそちらのため)。
    // 戻した値も reset に残るので、到達済みの台があれば採用時の再送で送られる
    const resend = new Set(reset)
    let savedKeyLists: PersistedDesired['keyLists']
    if (!keepsUnsent) core.unsentSince = null
    if (importing) {
      const restored = desired.restore(imported)
      savedKeyLists = imported.keyLists ?? []
      core.unsentSince = new Date(now()).toISOString()
      const total = imported.values.length + imported.records.length
      logInfo('(INFO, BRIDGE)', `Imported ${String(restored.length)} of ${String(total)} project value(s) for surface "${String(name)}"; they are not sent to Unity until a resend to every target is requested.`)
    } else if (definition !== null && name !== undefined && (!holdsValues || replace)) {
      // 置き換えでは、ファイルに無い一覧も空にする(引き継いだ一覧は送っていない値の一覧なので残さない)
      if (replace) savedKeyLists = []
      const loaded = deps.desiredValuesStore?.load(name)
      // ID を持つ前の保存(version 2)は、一覧の行に ID を振って行の値のキーを付け替えてから戻す(D-087)
      const saved = loaded == null ? loaded : migrateLegacyRowKeys(loaded, definition, core.newRowId)
      if (saved != null) {
        savedKeyLists = saved.keyLists ?? (replace ? [] : undefined)
        // 取り込んだまま送っていない値(D-090)は、ブリッジを再起動しても送らないまま始める
        if (saved.unsentSince !== undefined) core.unsentSince = saved.unsentSince
        // レコードの行は採用の時点では無い(reset に入らない)ので、戻した行も採用時の再送に加える
        const restored = desired.restore(saved)
        for (const id of restored) resend.add(id)
        const total = saved.values.length + saved.records.length
        logInfo('(INFO, BRIDGE)', `Restored ${String(restored.length)} of ${String(total)} saved desired value(s) for surface "${name}".`)
      }
    }
    core.activeName = definition === null ? undefined : name
    core.definedRecords = definition?.records ?? []
    core.definedParameters = new Map((definition?.parameters ?? []).map(parameter => [parameter.id, parameter]))
    core.parameterIdsByAddress = new Map((definition?.parameters ?? []).map(parameter => [parameter.address, parameter.id]))
    core.recordIdsByAddress = new Map((definition?.records ?? []).map(record => [record.address, record.id]))
    core.parametersByAddress = new Map((definition?.parameters ?? []).map(parameter => [parameter.address, parameter]))
    core.recordsByAddress = new Map((definition?.records ?? []).map(record => [record.address, record]))
    core.recordsById = new Map((definition?.records ?? []).map(record => [record.id, record]))
    const listBindings = source?.bindings?.osc?.lists ?? []
    core.listIdsByAddress = new Map(listBindings.map(binding => [binding.address, binding.id]))
    core.listsById = new Map(listBindings.map(binding => [binding.id, { address: binding.address, request: binding.request }]))
    const newRequests = runtimeOptions.setDefinition(definition)
    // UI で管理するキーの一覧(D-075)は一覧の登録(setDefinition)の後でしか戻せない。戻したら一覧に無い行を落とす
    if (savedKeyLists !== undefined) {
      const rowsOf = (list: NonNullable<PersistedDesired['keyLists']>[number]) =>
        list.rows.flatMap(row => row.id === undefined ? [] : [{ id: row.id, name: row.name }])
      // 置き換えでは、プロジェクト・ファイルに無い一覧も空にする(restoreUiKeys は渡した一覧のアドレスしか置き換えない)
      const lists = replace
        ? runtimeOptions.uiKeyLists().map(current => {
            const saved = savedKeyLists?.find(list => list.address === current.address)
            return { address: current.address, rows: saved === undefined ? [] : rowsOf(saved) }
          })
        : savedKeyLists.map(list => ({ address: list.address, rows: rowsOf(list) }))
      runtimeOptions.restoreUiKeys(lists)
    }
    core.retainUiRows()
    // 引き継いだ一覧に、新しく採用したレコードの行がまだ無いキーがあれば作る(復元した行が先に勝つ)
    const created = desired.addKeys(runtimeOptions.recordKeys())
    for (const value of created) resend.add(desired.entryId(value.address, value.args))
    core.persistDesired()
    core.hasDefinition = definition !== null
    core.warnedEchoMismatch.clear()
    core.warnedRuntimeOptions.clear()
    core.lastOperatedAt.clear()
    core.publishDesiredFull()
    // 一覧が変わらなくても surface・desired と同じく毎回配る(UI が定義と一緒に選択肢を揃え直せるように)
    core.publishRuntimeOptions()
    // 引き継がれた値は Unity にも入っているはずなので、値が決まり直したものだけ送る
    // (レイアウトだけの保存で、Unity 側の手動変更まで巻き戻さないため)
    // 未送信の印(D-090)は採用のたびに配る(取り込み・印のあるファイルからの復元で立ち、別の定義へ切り替えると消える)
    core.publishDesiredStatus()
    if (core.hasDefinition) {
      const reachable = core.targets.filter(core.isTargetReachable)
      core.autoResendDesired('definition adopted', resend, reachable)
      core.requestRuntimeOptions('definition adopted', newRequests, reachable)
    }
  }

  return { setDefinition }
}
