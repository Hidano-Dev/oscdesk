import {
  recordFieldArgs,
  recordHasRowIds,
  recordHeadLength,
  recordInitialValues,
  recordKeyOf,
  type OscArg,
  type OscSurfaceDefinition,
  type OscSurfaceParameter,
  type OscSurfaceRecord,
  type OscSurfaceRecordField,
  type WireArg,
} from '@oscdesk/shared'

// 値の「正」を OscDesk が持つための保持値(D-045)。Unity のエコーでは書き換えない。
// state のレコードはキーごとに 1 行を保持する(D-062)。
// 純粋ロジックに留め、送信・配信は呼び出し側(surface-core)が行う。

export interface DesiredValue {
  address: string
  args: readonly OscArg[]
}

/** ファイルへ保存する形(D-058)。照合に使う id・型をアドレスと一緒に持つ。 */
export interface PersistedDesiredValue {
  id: string
  address: string
  type: OscSurfaceParameter['type']
  args: readonly OscArg[]
}

/**
 * レコードの 1 行の保存形(D-062)。フィールドは id・型と 1 個の引数で持ち、定義の並べ替えに耐える。
 * key は行のキーで、UI で管理する一覧のレコード(D-087)では行の ID
 */
export interface PersistedRecordRow {
  id: string
  address: string
  key: string
  fields: readonly PersistedRecordField[]
}

export interface PersistedRecordField {
  id: string
  type: OscSurfaceRecordField['type']
  arg: OscArg
}

/** 保存の全量。 */
export interface PersistedDesired {
  values: readonly PersistedDesiredValue[]
  records: readonly PersistedRecordRow[]
  /** UI で管理するキーの一覧(D-075)。保持値の側では持たず、保存のときに呼び出し側(surface-core)が足す */
  keyLists?: readonly PersistedKeyList[] | undefined
  /**
   * 取り込んだプロジェクトの値をまだ Unity へ送っていなければ、取り込んだ時刻(D-090)。保持値の側では持たず、
   * 保存と復元のときに呼び出し側(surface-core)が足し・読む
   */
  unsentSince?: string | undefined
  /**
   * 生成の記録(HID-385・D-115)。保持値の側では持たず、保存・書き出しのときに呼び出し側(surface-core)が足し、
   * 復元・取り込みのときに読む
   */
  spawns?: readonly PersistedSpawn[] | undefined
}

/** 生成の記録の 1 件(送り先の PC ごと)。形はプロジェクトファイルの HeldSpawnSchema と同じ */
export interface PersistedSpawn {
  param: string
  address: string
  name: string
  host: string
  removedElsewhere?: true | undefined
}

/**
 * UI で管理するキーの一覧の保存形(D-087)。id の無い行は ID を持つ前(version 2)のファイルから読んだもので、
 * name がそのまま行のキーだった。採用時に migrateLegacyRowKeys で ID を振る
 */
export interface PersistedKeyList {
  address: string
  rows: readonly { id?: string | undefined; name: string }[]
}

export interface RecordKeyList {
  record: string
  keys: readonly string[]
}

/** ID を持つレコード(D-087)の行の Name を引く。一覧に無い行は undefined。 */
export type RowNameLookup = (record: OscSurfaceRecord, key: string) => string | undefined

export interface DesiredValues {
  /**
   * 定義の採用。同じ id・アドレス・型で値域にも収まるパラメータは保持値を引き継ぎ、それ以外は既定値で初期化する。
   * 同じ id・アドレスの state レコードは、行ごとにフィールド単位で同じ規則で引き継ぐ。
   * 戻り値は引き継がれず(新規・値域外などで)値が決まり直したエントリの識別子(entryId)。採用直後の再送対象になる。
   */
  setDefinition(definition: OscSurfaceDefinition | null): string[]
  /**
   * UI の操作を取り込む。保持対象(state)のアドレスで、引数の個数と型がパラメータに合うときだけ更新して true。
   * レコードのアドレスでは、正しい 1 行(recordKeyOf が通る)のときだけそのキーの行を置き換える。
   */
  record(address: string, args: readonly OscArg[]): boolean
  /** Unity のエコーが保持値と食い違うか。保持対象外・値なし・保持していないキーは false。 */
  differsFromEcho(address: string, args: readonly OscArg[]): boolean
  /** パラメータはアドレス、レコードの行は「アドレス + キー」でエントリを識別する(警告の重複抑止・再送の絞り込みに使う)。 */
  entryId(address: string, args: readonly OscArg[]): string
  /** 全エントリ(パラメータを定義順 → レコードを定義順・行を作られた順)。 */
  snapshot(): DesiredValue[]
  /** 保存用の全量(値なしは含めない)。 */
  persistable(): PersistedDesired
  /**
   * 保存しておいた値を採用中の定義へ戻す(D-058)。定義の再採用の引き継ぎと同じく、
   * id・アドレス・型が一致し値域にも収まるものだけを採る。レコードの行は id・アドレスが合えばキーごとに戻し、
   * 合わないフィールドは default にする(キーの一覧に無いキーも戻す)。戻り値は値を戻したエントリの識別子。
   */
  restore(saved: PersistedDesired): string[]
  /** キーの一覧に現れた、まだ行を持たないキーの行を default で作る。戻り値は作った行(D-062)。 */
  addKeys(lists: readonly RecordKeyList[]): DesiredValue[]
  /**
   * 同じ keysFrom.address を持つ全レコードから、そのキーの行を消す(D-075)。行は同じキーの集合を共有するので、
   * 1 つのレコードだけ消すと表の行が残ったり別のレコードの値だけ残ったりする。戻り値は消した行があったか。
   */
  removeKey(keysAddress: string, key: string): boolean
  /** 同じ keysFrom.address を持つ全レコードから、keys に無いキーの行を消す(UI で管理するキーの一覧と行を揃える。D-075)。 */
  retainKeys(keysAddress: string, keys: readonly string[]): boolean
  /** 同じ keysFrom.address を持つ全レコードの、そのキーの行(改名した行を Unity と UI へ送り直すため。D-087)。 */
  rowsOf(keysAddress: string, key: string): DesiredValue[]
}

interface RecordEntry {
  record: OscSurfaceRecord
  // キー → フィールドの引数(キー・Name を除く、宣言順)。Map の挿入順が行の順になる
  rows: Map<string, readonly OscArg[]>
}

/**
 * @param rowName ID を持つレコード(D-087)の行の Name。Name は UI で管理する一覧(runtime-options)が正で、
 * ここでは持たない(行ごとに持つと改名のたびに全レコードの行を付け替えることになる)。外へ出す形にだけ差し込む
 */
export function createDesiredValues(rowName: RowNameLookup = () => undefined): DesiredValues {
  // address → 保持値。trigger は入れない(再送すると勝手に押下が再現されるため)
  const tracked = new Map<string, { param: OscSurfaceParameter; args: readonly OscArg[] | null }>()
  // address → state レコードの行。trigger のレコードも同じ理由で入れない
  const records = new Map<string, RecordEntry>()

  // Name の引けない ID の行は外へ出さない(Unity が Name の無い行を受けると、名前で扱う側が壊れるため)。
  // 一覧に無い行は retainKeys で消えるので、ここで落ちるのは採用の途中の一時的な状態だけ
  const rowValue = (record: OscSurfaceRecord, key: string, fields: readonly OscArg[]): DesiredValue | undefined => {
    if (!recordHasRowIds(record)) return { address: record.address, args: [{ type: 's', value: key }, ...fields] }
    const name = rowName(record, key)
    return name === undefined
      ? undefined
      : { address: record.address, args: [{ type: 's', value: key }, { type: 's', value: name }, ...fields] }
  }

  return {
    setDefinition(definition) {
      const previous = new Map(tracked)
      const previousRecords = new Map(records)
      const reset: string[] = []
      tracked.clear()
      records.clear()
      for (const param of definition?.parameters ?? []) {
        // standalone:false は複数メッセージ列の一部としてしか送れない(HID-166)ため単独では保持・再送しない
        if (param.kind !== 'state' || param.standalone === false) continue
        const before = previous.get(param.address)
        const carried = before?.args != null && carries(param, before.param.id, before.param.type, before.args)
          ? before.args
          : null
        if (carried === null) reset.push(param.address)
        tracked.set(param.address, { param, args: carried ?? defaultArgs(param) })
      }
      for (const record of definition?.records ?? []) {
        if (record.kind !== 'state') continue
        const entry: RecordEntry = { record, rows: new Map() }
        records.set(record.address, entry)
        const before = previousRecords.get(record.address)
        if (before === undefined || before.record.id !== record.id) continue
        for (const [key, fields] of before.rows) {
          const next = carryFields(record, persistedFields(before.record, fields))
          // 並び・型が変わった行と、default に戻ったフィールドを含む行だけを送り直す
          if (!sameExactArgs(next, fields)) reset.push(rowId(record.address, key))
          entry.rows.set(key, next)
        }
      }
      return reset
    },
    record(address, args) {
      const entry = tracked.get(address)
      if (entry !== undefined) {
        if (!acceptsArgs(entry.param, args)) return false
        entry.args = args
        return true
      }
      const recordEntry = records.get(address)
      if (recordEntry === undefined) return false
      const key = keyOf(recordEntry.record, args)
      if (key === undefined) return false
      // Name は持たない(一覧が正。D-087)ので、ID を持つレコードでは ID と Name の後ろからがフィールド
      recordEntry.rows.set(key, args.slice(recordHeadLength(recordEntry.record)))
      return true
    },
    differsFromEcho(address, args) {
      const entry = tracked.get(address)
      if (entry !== undefined) return entry.args !== null && !sameArgs(entry.args, args)
      const recordEntry = records.get(address)
      const head = args[0]
      if (recordEntry === undefined || head?.type !== 's') return false
      const row = recordEntry.rows.get(head.value)
      return row !== undefined && !sameArgs(row, args.slice(recordHeadLength(recordEntry.record)))
    },
    entryId(address, args) {
      const head = args[0]
      return records.has(address) && head?.type === 's' ? rowId(address, head.value) : address
    },
    snapshot() {
      const values: DesiredValue[] = []
      for (const [address, entry] of tracked) {
        if (entry.args !== null) values.push({ address, args: entry.args })
      }
      for (const entry of records.values()) {
        for (const [key, fields] of entry.rows) {
          const value = rowValue(entry.record, key, fields)
          if (value !== undefined) values.push(value)
        }
      }
      return values
    },
    persistable() {
      const values: PersistedDesiredValue[] = []
      for (const [address, entry] of tracked) {
        if (entry.args !== null) values.push({ id: entry.param.id, address, type: entry.param.type, args: entry.args })
      }
      const rows: PersistedRecordRow[] = []
      for (const [address, entry] of records) {
        for (const [key, fields] of entry.rows) {
          rows.push({ id: entry.record.id, address, key, fields: persistedFields(entry.record, fields) })
        }
      }
      return { values, records: rows }
    },
    restore(saved) {
      const restored: string[] = []
      for (const value of saved.values) {
        const entry = tracked.get(value.address)
        if (entry === undefined || !carries(entry.param, value.id, value.type, value.args)) continue
        entry.args = value.args
        restored.push(value.address)
      }
      for (const row of saved.records) {
        const entry = records.get(row.address)
        if (entry === undefined || entry.record.id !== row.id || row.key === '') continue
        entry.rows.set(row.key, carryFields(entry.record, row.fields))
        restored.push(rowId(row.address, row.key))
      }
      return restored
    },
    addKeys(lists) {
      const created: DesiredValue[] = []
      for (const list of lists) {
        const entry = [...records.values()].find(candidate => candidate.record.id === list.record)
        if (entry === undefined) continue
        for (const key of list.keys) {
          if (key === '' || entry.rows.has(key)) continue
          const fields = initialFields(entry.record)
          entry.rows.set(key, fields)
          const value = rowValue(entry.record, key, fields)
          if (value !== undefined) created.push(value)
        }
      }
      return created
    },
    removeKey(keysAddress, key) {
      let removed = false
      for (const entry of records.values()) {
        if (entry.record.keysFrom.address === keysAddress && entry.rows.delete(key)) removed = true
      }
      return removed
    },
    retainKeys(keysAddress, keys) {
      const keep = new Set(keys)
      let removed = false
      for (const entry of records.values()) {
        if (entry.record.keysFrom.address !== keysAddress) continue
        for (const key of [...entry.rows.keys()]) {
          if (!keep.has(key)) {
            entry.rows.delete(key)
            removed = true
          }
        }
      }
      return removed
    },
    rowsOf(keysAddress, key) {
      const values: DesiredValue[] = []
      for (const entry of records.values()) {
        if (entry.record.keysFrom.address !== keysAddress) continue
        const fields = entry.rows.get(key)
        const value = fields === undefined ? undefined : rowValue(entry.record, key, fields)
        if (value !== undefined) values.push(value)
      }
      return values
    },
  }
}

/**
 * ID を持つ前(version 2)の保存から読んだ UI で管理する一覧に ID を振り、その一覧を共有する state レコードの行の
 * キー(Name)を ID へ付け替える(D-087)。付け替えないと、Name をキーにした行が一覧に無いキーとして落とされ値を失う。
 * 定義に無いアドレスの一覧は振らずに残す(restoreUiKeys が採用中の定義の 'ui' のアドレスだけを戻すため)
 */
export function migrateLegacyRowKeys(saved: PersistedDesired, definition: OscSurfaceDefinition, newRowId: () => string): PersistedDesired {
  const lists = saved.keyLists ?? []
  if (lists.every(list => list.rows.every(row => row.id !== undefined))) return saved
  // keysFrom.address → (Name → 振った ID)
  const assigned = new Map<string, Map<string, string>>()
  const keyLists = lists.map(list => {
    if (list.rows.every(row => row.id !== undefined)) return list
    const ids = new Map<string, string>()
    assigned.set(list.address, ids)
    return {
      address: list.address,
      rows: list.rows.map(row => {
        if (row.id !== undefined) return row
        const id = ids.get(row.name) ?? newRowId()
        ids.set(row.name, id)
        return { id, name: row.name }
      }),
    }
  })
  const keysAddressOf = new Map<string, string>()
  for (const record of definition.records ?? []) {
    if (recordHasRowIds(record)) keysAddressOf.set(`${record.id}\u0000${record.address}`, record.keysFrom.address)
  }
  const records = saved.records.map(row => {
    const keysAddress = keysAddressOf.get(`${row.id}\u0000${row.address}`)
    const id = keysAddress === undefined ? undefined : assigned.get(keysAddress)?.get(row.key)
    return id === undefined ? row : { ...row, key: id }
  })
  return { ...saved, records, keyLists }
}

function rowId(address: string, key: string): string {
  // NUL はアドレスにも OSC の文字列にも現れないので、アドレスとキーの境目が曖昧にならない
  return `${address}\u0000${key}`
}

// 定義の再採用(D-045)とファイルからの復元(D-058)で共通の引き継ぎ規則。
// アドレスは呼び出し側の引き当てで一致している前提。
function carries(param: OscSurfaceParameter, id: string, type: OscSurfaceParameter['type'], args: readonly OscArg[]): boolean {
  return param.id === id && param.type === type && acceptsArgs(param, args)
}

// レコードの行のフィールド単位の引き継ぎ(D-062)。id と型が一致し値域に収まるフィールドだけを採り、残りは default
function carryFields(record: OscSurfaceRecord, previous: readonly PersistedRecordField[]): OscArg[] {
  const defaults = initialFields(record)
  return record.fields.map((field, index) => {
    const before = previous.find(candidate => candidate.id === field.id)
    return before !== undefined && before.type === field.type && acceptsArgs(field, [before.arg])
      ? before.arg
      : defaults[index]!
  })
}

function persistedFields(record: OscSurfaceRecord, fields: readonly OscArg[]): PersistedRecordField[] {
  return record.fields.flatMap((field, index) => {
    const arg = fields[index]
    return arg === undefined ? [] : [{ id: field.id, type: field.type, arg }]
  })
}

function initialFields(record: OscSurfaceRecord): OscArg[] {
  return recordFieldArgs(record, recordInitialValues(record)).map(toOscArg)
}

// 正しい 1 行のときだけキーを返す(判定は shared の recordKeyOf に揃える)。blob はレコードに現れないので先に弾く。
// 空のキーは一覧からも行を作らないので保持もしない
export function keyOf(record: OscSurfaceRecord, args: readonly OscArg[]): string | undefined {
  if (args.some(arg => arg.type === 'b')) return undefined
  const key = recordKeyOf(record, args as readonly WireArg[])
  return key === '' ? undefined : key
}

function toOscArg(arg: WireArg): OscArg {
  // recordFieldArgs は i / f / s しか作らない(bool は i の 0/1)
  if (arg.type === 'b') throw new Error('record fields never carry blobs')
  return arg
}

// 引数 1 個・型が合う・値域(range / options)内。壊れた値を保持すると再接続のたびに Unity へ再送されてしまう。
// optionsFrom を持つ s は Unity の一覧の名前も選べるので、静的な options への所属を問わない(D-053)
function acceptsArgs(spec: OscSurfaceParameter | OscSurfaceRecordField, args: readonly OscArg[]): boolean {
  if (args.length !== 1) return false
  const arg = args[0]!
  if (spec.type === 's') {
    return arg.type === 's' && (spec.options === undefined || spec.optionsFrom !== undefined || spec.options.includes(arg.value))
  }
  // NaN / ±Infinity は desired の JSON で null になり、UI がフレームごと捨てる。range の無い数値でも保持しない
  if ((arg.type !== 'i' && arg.type !== 'f') || !Number.isFinite(arg.value)) return false
  if (spec.type === 'bool') return arg.value === 0 || arg.value === 1
  return spec.range === undefined || (arg.value >= spec.range[0] && arg.value <= spec.range[1])
}

function defaultArgs(param: OscSurfaceParameter): readonly OscArg[] | null {
  if (param.default === undefined) return null
  switch (param.type) {
    case 'i': return [{ type: 'i', value: param.default }]
    case 'f': return [{ type: 'f', value: param.default }]
    case 's': return [{ type: 's', value: param.default }]
    case 'bool': return [{ type: 'i', value: param.default ? 1 : 0 }]
  }
}

// 数値は i と f の違いと float32 往復の誤差を許す(Unity は単精度で返すため完全一致は求めない)。
function sameArgs(a: readonly OscArg[], b: readonly OscArg[]): boolean {
  if (a.length !== b.length) return false
  return a.every((left, index) => {
    const right = b[index]!
    if (left.type === 's' || right.type === 's') return left.type === right.type && left.value === right.value
    if (left.type === 'b' || right.type === 'b') return false
    return Math.abs(left.value - right.value) <= 1e-4 * Math.max(1, Math.abs(left.value))
  })
}

// 再採用で行が変わったかの判定。型タグまで一致しないなら Unity へ届く形が変わるので送り直す
function sameExactArgs(a: readonly OscArg[], b: readonly OscArg[]): boolean {
  return a.length === b.length && a.every((left, index) => {
    const right = b[index]!
    return left.type === right.type && left.value === right.value
  })
}
