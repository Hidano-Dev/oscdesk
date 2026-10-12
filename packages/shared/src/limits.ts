// 単一 UDP データグラムに収める OSC バッチのサイズ上限を共有する。
export const OSC_BATCH = {
  MAX_MESSAGES: 512,
  PRACTICAL_LIMIT_BYTES: 60 * 1024,
} as const
