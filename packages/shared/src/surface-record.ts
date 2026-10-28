import { OSC_BATCH } from './limits'
import type { SurfaceAction, SurfaceRecord, SurfaceRecordField } from './surface-definition'
import type { WireArg } from './wire'

// レコード型パラメータ(D-059 / D-061)の純粋な補助関数。ブリッジ(保持値・行の生成)と
// TS 側の検査が同じ形を使うためにここへ置く。UI(Python)は同じ規則を自前で持つ。
// メッセージの形は 1 行 = 1 メッセージで、address = レコードの address、args = [s:キー, フィールドを宣言順に]。
// keysFrom.source 'ui' のレコード(D-087)だけは [s:行の ID, s:Name, フィールドを宣言順に]。

export type RecordFieldValue = number | string | boolean

/**
 * 行の ID と Name を別に持つレコードか(keysFrom.source 'ui'。D-087)。UI で追加した行は Name を後から変えられるので、
 * 行を指す状態(保持値・保存・表示・アクション)は Name でなく変わらない ID で指す。Unity の一覧から行ができる
 * レコードは Name を決めるのが Unity なので、従来どおりキー(= Name)が識別子
 */
export function recordHasRowIds(record: SurfaceRecord): boolean {
  return record.keysFrom.source === 'ui'
}

/** 引数のうちフィールドより前(キー、または ID と Name)の個数。 */
export function recordHeadLength(record: SurfaceRecord): number {
  return recordHasRowIds(record) ? 2 : 1
}

/**
 * 行を新しく作るときのフィールド値(宣言順)。state はフィールドの default、trigger は value。
 * 検証済みの定義だけを渡す(未検証で欠けていれば例外)。
 */
export function recordInitialValues(record: SurfaceRecord): RecordFieldValue[] {
  return record.fields.map((field) => {
    const value = record.kind === 'state' ? field.default : field.value
    if (value === undefined) throw new Error(`record ${record.id} field ${field.id} has no ${record.kind === 'state' ? 'default' : 'value'}`)
    return value
  })
}

function fieldArg(field: SurfaceRecordField, value: RecordFieldValue): WireArg {
  switch (field.type) {
    case 'i':
      return { type: 'i', value: Number(value) }
    case 'f':
      return { type: 'f', value: Number(value) }
    case 's':
      return { type: 's', value: String(value) }
    case 'bool':
      // bool は送信前に int 0/1 へ正規化する(D-017。パラメータと同じ)
      return { type: 'i', value: value === true || value === 1 ? 1 : 0 }
  }
}

/** フィールドの OSC 引数(宣言順)。values はフィールドと同じ数・順で渡す。 */
export function recordFieldArgs(record: SurfaceRecord, values: readonly RecordFieldValue[]): WireArg[] {
  if (values.length !== record.fields.length) {
    throw new Error(`record ${record.id} expects ${record.fields.length} field values, got ${values.length}`)
  }
  return record.fields.map((field, index) => fieldArg(field, values[index]!))
}

/**
 * 1 行分の OSC 引数 `[s:key, フィールドを宣言順に]`(ID を持つレコードは `[s:key(ID), s:name, ...]`。D-087)。
 * ID を持つレコードで name を省くと例外(Unity が行を名前で扱えなくなるため、黙って空にしない)
 */
export function recordArgs(record: SurfaceRecord, key: string, values: readonly RecordFieldValue[], name?: string): WireArg[] {
  const fields = recordFieldArgs(record, values)
  if (!recordHasRowIds(record)) return [{ type: 's', value: key }, ...fields]
  if (name === undefined) throw new Error(`record ${record.id} needs a row name`)
  return [{ type: 's', value: key }, { type: 's', value: name }, ...fields]
}

// 型が合う・値域(range / options)内。保持値の判定(desired-values の acceptsArgs)と同じ寛容さで、
// 数値は i と f のどちらでも受け、bool は 0 / 1 を受ける。optionsFrom を持つ s は所属を問わない(D-053)。
// acceptsArgs と違い、有限でない数値は拒否する
function fieldAccepts(field: SurfaceRecordField, arg: WireArg): boolean {
  if (field.type === 's') {
    return arg.type === 's' && (field.options === undefined || field.optionsFrom !== undefined || field.options.includes(arg.value))
  }
  if (arg.type !== 'i' && arg.type !== 'f') return false
  // Unity から届く float32 は NaN / ±Infinity を運べる。保持すると desired の JSON で null になり、
  // UI がフレームごと捨てる(full なら全保持値を失う)ため、range が無くても受けない
  if (!Number.isFinite(arg.value)) return false
  if (field.type === 'bool') return arg.value === 0 || arg.value === 1
  return field.range === undefined || (arg.value >= field.range[0] && arg.value <= field.range[1])
}

/**
 * 受けた引数がこのレコードの 1 行として正しい形ならキーを返し、そうでなければ undefined。
 * 正しい形 = 先頭が s のキー(ID を持つレコードは s の ID と s の Name)、続くフィールドの数と型が宣言どおり、
 * 値が range / options に収まる。ID を持つレコードで返すのは ID。
 * ブリッジの保持値の置き換え(合わないものは保持しない)とエコーの振り分けに使う。
 */
export function recordKeyOf(record: SurfaceRecord, args: readonly WireArg[]): string | undefined {
  const offset = recordHeadLength(record)
  if (args.length !== record.fields.length + offset) return undefined
  const head = args[0]!
  if (head.type !== 's' || args[offset - 1]!.type !== 's') return undefined
  return record.fields.every((field, index) => fieldAccepts(field, args[index + offset]!)) ? head.value : undefined
}

export interface ResolvedRecordStep {
  record: SurfaceRecord
  key: string
  /** step の value(フィールド id → 固定値)。state はこれ以外のフィールドに行の現在値を使う。trigger では常に undefined。 */
  fixedValues?: Readonly<Record<string, RecordFieldValue>> | undefined
}

/**
 * scope を持つアクションを、行のキーごとの送信対象へ展開する(D-061)。
 * scope 'row' は押した行のキー 1 つ、'all' は表示中の全行のキーを表示順に渡す。
 * 並びは行ごとに steps を定義順(行1の全 step → 行2の全 step …)。未知のレコードと record 以外の step は無視する
 * (意味検証が別に報告する)。1 bundle の上限(512 件)を超えた時点で打ち切るので、
 * 結果が上限を超えていたら呼び出し側は送らずに通知する。
 */
export function resolveRecordActionSteps(
  action: SurfaceAction,
  records: readonly SurfaceRecord[],
  keys: readonly string[],
): ResolvedRecordStep[] {
  const byId = new Map<string, SurfaceRecord>()
  for (const record of records) if (!byId.has(record.id)) byId.set(record.id, record)
  const resolved: ResolvedRecordStep[] = []
  for (const key of keys) {
    for (const step of action.steps) {
      if (!('record' in step)) continue
      const record = byId.get(step.record)
      if (record === undefined) continue
      resolved.push({ record, key, fixedValues: record.kind === 'state' ? step.value : undefined })
      if (resolved.length > OSC_BATCH.MAX_MESSAGES) return resolved
    }
  }
  return resolved
}
