import {
  compositeArgs,
  compositeInitialValue,
  isOscdeskAddress,
  type OscArg,
  type OscSurfaceParameter,
  type ParamValue,
} from '@oscdesk/shared'

import { ipv4ToInt } from '../ipv4'
import type { BroadcastNetwork } from './types'

// 値と OSC 引数の変換、アドレスとネットワークの小さな判定(surface-core の中の純粋関数。D-134)。

/**
 * set フレーム(HID-373)の JSON の値を、パラメータの型どおりの OSC 引数に直す。直せなければ理由を返す。
 * UI は型タグを知らずに値だけを送るので、型と値域の検査はここで行う(UI の表示だけに頼らない)
 */
export function parameterArgs(parameter: OscSurfaceParameter, value: ParamValue | undefined): { ok: true; args: OscArg[] } | { ok: false; reason: string } {
  if (parameter.type === 'composite') {
    // 組み合わせの型(D-121)。フィールドを宣言順に並べた引数で送る。trigger で値を省けばフィールドの value
    const chosenValue = parameter.kind === 'trigger' && value === undefined ? compositeInitialValue('trigger', parameter.fields) : value
    if (chosenValue === undefined) return { ok: false, reason: `missing-value: ${parameter.id}` }
    const converted = compositeArgs(parameter.fields, chosenValue)
    if (!converted.ok) return { ok: false, reason: `type-mismatch: ${parameter.id} ${converted.reason}` }
    return { ok: true, args: converted.args }
  }
  if (value !== undefined && typeof value === 'object') return { ok: false, reason: `type-mismatch: ${parameter.id} expects a single value` }
  const chosen = parameter.kind === 'trigger' && value === undefined ? parameter.value : value
  if (chosen === undefined) return { ok: false, reason: `missing-value: ${parameter.id}` }
  const inRange = (number: number) => parameter.type !== 'i' && parameter.type !== 'f'
    || parameter.range === undefined
    || (number >= Math.min(...parameter.range) && number <= Math.max(...parameter.range))
  switch (parameter.type) {
    case 'i':
      if (typeof chosen !== 'number' || !Number.isInteger(chosen) || chosen < -2_147_483_648 || chosen > 2_147_483_647) {
        return { ok: false, reason: `type-mismatch: ${parameter.id} expects an int32` }
      }
      if (!inRange(chosen)) return { ok: false, reason: `out-of-range: ${parameter.id}` }
      return { ok: true, args: [{ type: 'i', value: chosen }] }
    case 'f':
      if (typeof chosen !== 'number' || !Number.isFinite(chosen)) return { ok: false, reason: `type-mismatch: ${parameter.id} expects a number` }
      if (!inRange(chosen)) return { ok: false, reason: `out-of-range: ${parameter.id}` }
      return { ok: true, args: [{ type: 'f', value: chosen }] }
    case 's':
      if (typeof chosen !== 'string') return { ok: false, reason: `type-mismatch: ${parameter.id} expects a string` }
      return { ok: true, args: [{ type: 's', value: chosen }] }
    case 'bool':
      // bool は 0/1 の i で送る(D-017)
      if (typeof chosen !== 'boolean') return { ok: false, reason: `type-mismatch: ${parameter.id} expects a boolean` }
      return { ok: true, args: [{ type: 'i', value: chosen ? 1 : 0 }] }
  }
}

export function toWireArgs(args: readonly OscArg[]) {
  return args.map((arg) => arg.type === 'b'
    ? { type: 'b' as const, value: Buffer.from(arg.value).toString('base64') }
    : arg)
}

export function toOscArgs(args: readonly { type?: 'i' | 'f' | 's' | 'b'; value?: unknown }[]): OscArg[] {
  return args.map((arg) => {
    if (arg.type === 'i' || arg.type === 'f') return { type: arg.type, value: Number(arg.value) } as OscArg
    if (arg.type === 's') return { type: 's', value: String(arg.value) }
    return { type: 'b', value: Buffer.from(String(arg.value ?? ''), 'base64') }
  })
}

// ログではレコードの行をキーつきで示す(どの行が食い違ったか分かるように)
export function describeEntry(address: string, args: readonly OscArg[], entryId: string): string {
  const head = args[0]
  return entryId !== address && head?.type === 's' ? `${address}" key "${head.value}` : address
}

export function isBridgeInternalAddress(address: string): boolean {
  return isOscdeskAddress(address)
}

export const LOOPBACK_NETWORK: BroadcastNetwork = { networkInt: 0x7f000000, maskInt: 0xff000000 }

export function isInNetwork(host: string, network: BroadcastNetwork): boolean {
  const value = ipv4ToInt(host)
  return value !== null && ((value & network.maskInt) >>> 0) === network.networkInt
}
