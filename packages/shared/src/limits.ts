// 単一 UDP データグラムと適用セットのサイズ上限を共有する。
export const MANIFEST_SIZE = {
  RECOMMENDED_BYTES: 1400,
  WARNING_BYTES: 56 * 1024,
  PRACTICAL_LIMIT_BYTES: 60 * 1024,
} as const

export const OSC_BATCH = {
  MAX_MESSAGES: 512,
  PRACTICAL_LIMIT_BYTES: 60 * 1024,
} as const
