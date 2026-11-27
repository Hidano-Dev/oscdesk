import {
  compositeValueOf,
  heldArgsToParameterValue,
  recordHasRowIds,
  recordHeadLength,
  valueToHeldArg,
  type LockRef,
  type OscArg,
  type ParamValue,
  type ScalarValue,
} from '@oscdesk/shared'

import { keyOf as rowKeyOf } from '../desired-values'
import { describeLockRef } from '../lock-manager'
import type { Core } from './context'
import type { ClientId } from './types'

// パラメータ id の語彙(HID-389)と OSC のアドレス・引数の相互の直し方と、ロックの単位(HID-378)への引き方。

export interface VocabularyPart {
  listIdOf(address: string): string
  toIdEntries(messages: readonly { address: string; args: readonly OscArg[] }[]): {
    values: { param: string; value?: ParamValue }[]
    rows: { record: string; key: string; values: Record<string, ScalarValue> }[]
  }
  rowMessage(
    recordId: string, key: string, values: Readonly<Record<string, ScalarValue>>,
  ): { ok: true; message: { address: string; args: OscArg[] } } | { ok: false; reason: string }
  lockRefsOf(address: string, args: readonly OscArg[]): LockRef[]
  lockRejection(refs: readonly LockRef[], clientId: ClientId, holder: string | undefined): string | null
}

export function vocabularyPart(core: Core): VocabularyPart {
  const { deps } = core

  const listIdOf = (address: string) => core.listIdsByAddress.get(address) ?? address

  /**
   * OSC のアドレスと引数を、パラメータ id と JSON の値・Record の行(record・key・フィールド id ごとの値)に直す(HID-389)。
   * 採用中の定義に無いアドレス、定義どおりの形でない行は落とす。パラメータの値は型どおりに読めたときだけ付ける
   * (trigger のエコーの到着の確認は値を問わないので、値の読めないパラメータも残す)
   */
  const toIdEntries = (messages: readonly { address: string; args: readonly OscArg[] }[]) => {
    const values: { param: string; value?: ParamValue }[] = []
    const rows: { record: string; key: string; values: Record<string, ScalarValue> }[] = []
    for (const message of messages) {
      const parameter = core.parametersByAddress.get(message.address)
      if (parameter !== undefined) {
        const value = heldArgsToParameterValue(parameter, message.args)
        values.push(value === undefined ? { param: parameter.id } : { param: parameter.id, value })
        continue
      }
      const record = core.recordsByAddress.get(message.address)
      if (record === undefined) continue
      const key = rowKeyOf(record, message.args)
      if (key === undefined) continue
      const offset = recordHeadLength(record)
      // 行の値は組み合わせの型と同じ規則で読む(型・値域・options。f は float32 の丸めで端を越えた値を受けて端に寄せる)。
      // UI は届いた行を検査し直さないので(D-124)、範囲外・候補外の行(ターゲットのエコー)はここで落とす。
      // 実行時の一覧(optionsFrom)を持つ s は、固定の候補への所属を問わない
      const fields = compositeValueOf(
        record.fields.map(field => (field.type === 's' && field.optionsFrom !== undefined ? { ...field, options: undefined } : field)),
        message.args.slice(offset),
      )
      if (fields === undefined) continue
      rows.push({ record: record.id, key, values: fields })
    }
    return { values, rows }
  }

  /**
   * 上りの行(setRow・batch の行。HID-389)を OSC のメッセージにする。フィールドはすべて揃え、型・値域・options は
   * 行の受理(recordKeyOf)と同じ規則で確かめる。ID を持つ行(D-087)は一覧の今の Name を付ける(一覧に無い行は断る)
   */
  const rowMessage = (
    recordId: string, key: string, values: Readonly<Record<string, ScalarValue>>,
  ): { ok: true; message: { address: string; args: OscArg[] } } | { ok: false; reason: string } => {
    const record = core.recordsById.get(recordId)
    if (record === undefined) return { ok: false, reason: `unknown-record: ${recordId}` }
    const unknownField = Object.keys(values).find(field => !record.fields.some(candidate => candidate.id === field))
    if (unknownField !== undefined) return { ok: false, reason: `unknown-field: ${record.id}.${unknownField}` }
    const fieldArgs: OscArg[] = []
    for (const field of record.fields) {
      if (!Object.prototype.hasOwnProperty.call(values, field.id)) return { ok: false, reason: `missing-field: ${record.id}.${field.id}` }
      const arg = valueToHeldArg(field.type, values[field.id]!)
      if (arg === undefined) return { ok: false, reason: `type-mismatch: ${record.id}.${field.id}` }
      fieldArgs.push(arg)
    }
    const head: OscArg[] = [{ type: 's', value: key }]
    if (recordHasRowIds(record)) {
      const name = core.runtimeOptions.uiRowName(record.keysFrom.address, key)
      if (name === undefined) return { ok: false, reason: `unknown-row: ${record.id}[${key}]` }
      head.push({ type: 's', value: name })
    }
    const args = [...head, ...fieldArgs]
    if (rowKeyOf(record, args) === undefined) return { ok: false, reason: `out-of-range: ${record.id}[${key}]` }
    return { ok: true, message: { address: record.address, args } }
  }
  // 1 件の送信が当たるロックの単位。パラメータはその id、Record は行(先頭の s がキー・ID)。それ以外は無し
  const lockRefsOf = (address: string, args: readonly OscArg[]): LockRef[] => {
    const param = core.parameterIdsByAddress.get(address)
    if (param !== undefined) return [{ param }]
    const record = core.recordIdsByAddress.get(address)
    const key = args[0]
    if (record !== undefined && key?.type === 's' && key.value !== '') return [{ record, key: key.value }]
    return []
  }
  // ほかの持ち主がロックしていれば、断る理由(locked: <単位> by <持ち主>)
  const lockRejection = (refs: readonly LockRef[], clientId: ClientId, holder: string | undefined): string | null => {
    if (deps.lockedBy === undefined || refs.length === 0) return null
    for (const ref of refs) {
      const owner = deps.lockedBy([ref], clientId, holder)
      if (owner !== null) return `locked: ${describeLockRef(ref)} by ${owner}`
    }
    return null
  }

  return { listIdOf, toIdEntries, rowMessage, lockRefsOf, lockRejection }
}
