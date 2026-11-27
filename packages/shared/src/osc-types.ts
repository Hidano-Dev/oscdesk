// T / F は OSC 1.0 の真偽の型タグで、引数のバイトを持たない(HID-492。パッドのトグルの type 'T'。D-167)
export type OscTypeTag = 'i' | 'f' | 's' | 'b' | 'T' | 'F'

export type OscArg =
  | { type: 'i'; value: number }
  | { type: 'f'; value: number }
  | { type: 's'; value: string }
  | { type: 'b'; value: Uint8Array }
  | { type: 'T' }
  | { type: 'F' }

export interface OscMessagePacket {
  address: string
  args: OscArg[]
}

export interface OscTimeTag {
  seconds: number
  fractions: number
  native?: number
}

export const OSC_IMMEDIATE_TIME_TAG = {
  seconds: 0,
  fractions: 1,
} as const

export interface OscBundlePacket {
  timeTag: OscTimeTag
  packets: OscPacket[]
}

export type OscPacket = OscMessagePacket | OscBundlePacket
