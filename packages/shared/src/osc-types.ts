export type OscTypeTag = 'i' | 'f' | 's' | 'b'

export type OscArg =
  | { type: 'i'; value: number }
  | { type: 'f'; value: number }
  | { type: 's'; value: string }
  | { type: 'b'; value: Uint8Array }

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
