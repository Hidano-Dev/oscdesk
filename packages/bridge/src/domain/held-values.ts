import type { HeldArg, HeldValues, OscArg } from '@oscdesk/shared'

import type { PersistedDesired } from './desired-values'

// 保持値の全量(PersistedDesired)と、保持値のファイル・プロジェクトファイル(D-090)に書く形(HeldValues)の写像。
// ファイルの読み書きは adapters/desired-values-file、プロジェクトの取り込みは project-manager が使う(D-134)。

type PersistedArg = HeldArg

/**
 * 保持値の全量をファイル・プロジェクトファイル(D-090)の形にする(両方の写像をここ 1 か所に置く)。
 * UI で管理するキーを使わない定義では keyLists を書かない(従来のファイルと同じ形を保つ)。
 * ID の無い行(version 2 から読んだまま)は採用時に ID を振るので、ここへは来ない。来ても書かない
 * (ID の無い行を書くと、次の読み込みで別の ID が振られて行の値と結び付かなくなる)
 */
export function toHeldValues(values: PersistedDesired): HeldValues {
  return {
    values: values.values.map(value => ({ id: value.id, address: value.address, type: value.type, args: value.args.map(toPersistedArg), ...(value.fields === undefined ? {} : { fields: value.fields.map(field => ({ ...field })) }) })),
    records: values.records.map(row => ({
      id: row.id,
      address: row.address,
      key: row.key,
      fields: row.fields.map(field => ({ id: field.id, type: field.type, arg: toPersistedArg(field.arg) })),
    })),
    ...(values.keyLists !== undefined && values.keyLists.length > 0
      ? {
          keyLists: values.keyLists.map(list => ({
            address: list.address,
            rows: list.rows.flatMap(row => row.id === undefined ? [] : [{ id: row.id, name: row.name }]),
          })),
        }
      : {}),
    // 記録が無ければ書かない(生成担当を使わない定義のファイル・プロジェクトを従来と同じ形に保つ)
    ...(values.spawns !== undefined && values.spawns.length > 0 ? { spawns: values.spawns.map(spawn => ({ ...spawn })) } : {}),
  }
}

/** toHeldValues の逆(プロジェクトファイルの取り込み。D-090)。keyLists は無ければ空の一覧として返す */
export function fromHeldValues(values: HeldValues): PersistedDesired {
  return {
    values: values.values.map(value => ({ ...value, args: value.args.map(arg => ({ ...arg }) as OscArg) })),
    records: values.records.map(row => ({ ...row, fields: row.fields.map(field => ({ ...field, arg: { ...field.arg } as OscArg })) })),
    keyLists: (values.keyLists ?? []).map(list => ({ address: list.address, rows: list.rows.map(row => ({ ...row })) })),
    // 取り込みは今の記録を捨てて置き換える(HID-385)。無ければ空の記録
    spawns: (values.spawns ?? []).map(spawn => ({ ...spawn })),
  }
}

function toPersistedArg(arg: OscArg): PersistedArg {
  if (arg.type === 'b') throw new Error('blob arguments are never held as desired values')
  return { type: arg.type, value: arg.value } as PersistedArg
}
