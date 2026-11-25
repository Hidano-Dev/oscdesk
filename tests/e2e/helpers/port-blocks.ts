// E2E のワーカーごとのポートの帯の割り当て(D-133)。vitest.config.ts もワーカー数の上限を決めるのに読むので、
// ソケットや環境変数に触れない純粋な定義だけを置く(読み込んだだけで何かが動くと設定の読み込みが重くなる)

// 帯は 20000〜31999。Windows の動的ポート(49152〜)と Linux のエフェメラル(32768〜)の下に置き、OS が外向きの
// 通信に自動で割り当てる番号と重ならないようにする。既定のポート(7080・7090・7091・8080)もこの帯の外にある
export const PORT_RANGE_START = 20_000
export const PORT_BLOCK_SIZE = 1_000
/** 帯の数。同時に動かせる E2E のワーカーの数の上限でもある */
export const PORT_BLOCK_COUNT = 12

/**
 * ワーカーの番号(VITEST_POOL_ID、1 から)と実行ごとのずらしから、そのワーカーの帯の先頭の番号を返す。
 * 1〜PORT_BLOCK_COUNT の番号は、ずらしが何であっても互いに別の帯になる(ずらしは帯を回すだけ)。
 * それを超える番号は剰余で既存の帯と重なり、同じ実行の 2 つのワーカーが同じ番号を払い出すので断る
 */
export function portBlockStart(poolId: number, runSalt: number): number {
  if (!Number.isInteger(poolId) || poolId < 1 || poolId > PORT_BLOCK_COUNT) {
    throw new Error(
      `E2E worker ${poolId} has no port block: at most ${PORT_BLOCK_COUNT} e2e workers can run at once. ` +
      `Lower --maxWorkers / VITEST_MAX_FORKS to ${PORT_BLOCK_COUNT} or less (D-133).`,
    )
  }
  const shift = ((runSalt % PORT_BLOCK_COUNT) + PORT_BLOCK_COUNT) % PORT_BLOCK_COUNT
  return PORT_RANGE_START + ((poolId - 1 + shift) % PORT_BLOCK_COUNT) * PORT_BLOCK_SIZE
}
