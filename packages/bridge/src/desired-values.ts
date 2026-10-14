import type { OscArg, SurfaceDefinition, SurfaceParameter } from '@oscdesk/shared'

// 値の「正」を OscDesk が持つための保持値(D-045)。Unity のエコーでは書き換えない。
// 純粋ロジックに留め、送信・配信は呼び出し側(surface-core)が行う。

export interface DesiredValue {
  address: string
  args: readonly OscArg[]
}

/** ファイルへ保存する形(D-058)。照合に使う id・型をアドレスと一緒に持つ。 */
export interface PersistedDesiredValue {
  id: string
  address: string
  type: SurfaceParameter['type']
  args: readonly OscArg[]
}

export interface DesiredValues {
  /**
   * 定義の採用。同じ id・アドレス・型で値域にも収まるパラメータは保持値を引き継ぎ、それ以外は既定値で初期化する。
   * 戻り値は引き継がれず(新規・値域外などで)値が決まり直したアドレス。採用直後の再送対象になる。
   */
  setDefinition(definition: SurfaceDefinition | null): string[]
  /** UI の操作を取り込む。保持対象(state)のアドレスで、引数の個数と型がパラメータに合うときだけ更新して true。 */
  record(address: string, args: readonly OscArg[]): boolean
  /** Unity のエコーが保持値と食い違うか。保持対象外・値なしは false。 */
  differsFromEcho(address: string, args: readonly OscArg[]): boolean
  snapshot(): DesiredValue[]
  /** 保存用の全量(値なしは含めない)。 */
  persistable(): PersistedDesiredValue[]
  /**
   * 保存しておいた値を採用中の定義へ戻す(D-058)。定義の再採用の引き継ぎと同じく、
   * id・アドレス・型が一致し値域にも収まるものだけを採る。戻り値は値を戻したアドレス。
   */
  restore(saved: readonly PersistedDesiredValue[]): string[]
}

export function createDesiredValues(): DesiredValues {
  // address → 保持値。trigger は入れない(再送すると勝手に押下が再現されるため)
  const tracked = new Map<string, { param: SurfaceParameter; args: readonly OscArg[] | null }>()

  return {
    setDefinition(definition) {
      const previous = new Map(tracked)
      const reset: string[] = []
      tracked.clear()
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
      return reset
    },
    record(address, args) {
      const entry = tracked.get(address)
      if (entry === undefined || !acceptsArgs(entry.param, args)) return false
      entry.args = args
      return true
    },
    differsFromEcho(address, args) {
      const entry = tracked.get(address)
      if (entry === undefined || entry.args === null) return false
      return !sameArgs(entry.args, args)
    },
    snapshot() {
      const values: DesiredValue[] = []
      for (const [address, entry] of tracked) {
        if (entry.args !== null) values.push({ address, args: entry.args })
      }
      return values
    },
    persistable() {
      const values: PersistedDesiredValue[] = []
      for (const [address, entry] of tracked) {
        if (entry.args !== null) values.push({ id: entry.param.id, address, type: entry.param.type, args: entry.args })
      }
      return values
    },
    restore(saved) {
      const restored: string[] = []
      for (const value of saved) {
        const entry = tracked.get(value.address)
        if (entry === undefined || !carries(entry.param, value.id, value.type, value.args)) continue
        entry.args = value.args
        restored.push(value.address)
      }
      return restored
    },
  }
}

// 定義の再採用(D-045)とファイルからの復元(D-058)で共通の引き継ぎ規則。
// アドレスは呼び出し側の引き当てで一致している前提。
function carries(param: SurfaceParameter, id: string, type: SurfaceParameter['type'], args: readonly OscArg[]): boolean {
  return param.id === id && param.type === type && acceptsArgs(param, args)
}

// 引数 1 個・型が合う・値域(range / options)内。壊れた値を保持すると再接続のたびに Unity へ再送されてしまう。
// optionsFrom を持つ s は Unity の一覧の名前も選べるので、静的な options への所属を問わない(D-053)
function acceptsArgs(param: SurfaceParameter, args: readonly OscArg[]): boolean {
  if (args.length !== 1) return false
  const arg = args[0]
  if (param.type === 's') {
    return arg.type === 's' && (param.options === undefined || param.optionsFrom !== undefined || param.options.includes(arg.value))
  }
  if (arg.type !== 'i' && arg.type !== 'f') return false
  if (param.type === 'bool') return arg.value === 0 || arg.value === 1
  return param.range === undefined || (arg.value >= param.range[0] && arg.value <= param.range[1])
}

function defaultArgs(param: SurfaceParameter): readonly OscArg[] | null {
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
    const right = b[index]
    if (left.type === 's' || right.type === 's') return left.type === right.type && left.value === right.value
    if (left.type === 'b' || right.type === 'b') return false
    return Math.abs(left.value - right.value) <= 1e-4 * Math.max(1, Math.abs(left.value))
  })
}
