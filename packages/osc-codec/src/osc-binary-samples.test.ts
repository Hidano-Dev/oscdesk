import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import type { OscArg, OscPacket } from '@oscdesk/shared'

import { decodeOscPacket, encodeOscPacket } from './osc-codec'

// protocol/osc-binary-samples.json は Unity の受け口(OscSurface の EditMode テスト)も読む言語間の契約(D-095)。
// ブリッジが送るバイト列と受け口が読むバイト列が同じ見本に縛られていないと、片側だけの変更で黙って食い違う
type SampleArg = { type: 'i' | 'f' | 's' | 'b'; value: number | string }
type SampleMessage = { address: string; args: SampleArg[] }
type SampleBundle = { timeTag: { seconds: number; fractions: number }; packets: SamplePacket[] }
type SamplePacket = SampleMessage | SampleBundle

interface Sample {
  name: string
  hex: string
  packet: SamplePacket
}

interface SampleFile {
  messages: Sample[]
  bundles: Sample[]
  receiverDecode: Array<{ name: string; hex: string; error?: boolean; messages?: unknown[] }>
}

const samples = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../protocol/osc-binary-samples.json'), 'utf8'),
) as SampleFile

function toPacket(sample: SamplePacket): OscPacket {
  if ('packets' in sample) {
    return { timeTag: { ...sample.timeTag }, packets: sample.packets.map(toPacket) }
  }

  return { address: sample.address, args: sample.args.map(toArg) }
}

function toArg(arg: SampleArg): OscArg {
  switch (arg.type) {
    case 'i':
      return { type: 'i', value: arg.value as number }
    case 'f':
      return { type: 'f', value: arg.value as number }
    case 's':
      return { type: 's', value: arg.value as string }
    case 'b':
      return { type: 'b', value: Uint8Array.from(Buffer.from(arg.value as string, 'hex')) }
  }
}

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex')
}

describe('protocol/osc-binary-samples.json', () => {
  it('has samples in every section', () => {
    expect(samples.messages.length).toBeGreaterThan(0)
    expect(samples.bundles.length).toBeGreaterThan(0)
    expect(samples.receiverDecode.length).toBeGreaterThan(0)
  })

  for (const sample of [...samples.messages, ...samples.bundles]) {
    it(`encodes "${sample.name}" to the sample bytes`, () => {
      expect(toHex(encodeOscPacket(toPacket(sample.packet)))).toBe(sample.hex)
    })

    it(`decodes the bytes of "${sample.name}" to the sample packet`, () => {
      expect(decodeOscPacket(Buffer.from(sample.hex, 'hex'))).toEqual(toPacket(sample.packet))
    })
  }

  it('keeps every datagram 4-byte aligned except the misaligned rejection sample', () => {
    for (const sample of [...samples.messages, ...samples.bundles]) {
      expect(sample.hex.length % 8, sample.name).toBe(0)
    }

    const misaligned = samples.receiverDecode.filter((sample) => sample.hex.length % 8 !== 0)
    expect(misaligned.map((sample) => sample.error)).toEqual([true])
  })
})
