import { isOscdeskAddress, type OscArg } from '@oscdesk/shared'

import { ipv4ToInt } from '../ipv4'
import type { BroadcastNetwork } from './types'

// OSC 引数の変換、アドレスとネットワークの小さな判定(surface-core の中の純粋関数。D-134)。

export function toWireArgs(args: readonly OscArg[]) {
  return args.map((arg) => arg.type === 'b'
    ? { type: 'b' as const, value: Buffer.from(arg.value).toString('base64') }
    : arg)
}

export function toOscArgs(args: readonly { type?: 'i' | 'f' | 's' | 'b' | 'T' | 'F'; value?: unknown }[]): OscArg[] {
  return args.map((arg) => {
    if (arg.type === 'i' || arg.type === 'f') return { type: arg.type, value: Number(arg.value) } as OscArg
    if (arg.type === 's') return { type: 's', value: String(arg.value) }
    // T / F は値を持たない(HID-492)。型タグのまま OSC へ渡す
    if (arg.type === 'T' || arg.type === 'F') return { type: arg.type }
    return { type: 'b', value: Buffer.from(String(arg.value ?? ''), 'base64') }
  })
}

export function isBridgeInternalAddress(address: string): boolean {
  return isOscdeskAddress(address)
}

export const LOOPBACK_NETWORK: BroadcastNetwork = { networkInt: 0x7f000000, maskInt: 0xff000000 }

export function isInNetwork(host: string, network: BroadcastNetwork): boolean {
  const value = ipv4ToInt(host)
  return value !== null && ((value & network.maskInt) >>> 0) === network.networkInt
}
