import { describe, expect, it } from 'vitest'

import { PORT_BLOCK_COUNT, PORT_BLOCK_SIZE, PORT_RANGE_START, portBlockStart } from '../e2e/helpers/port-blocks'

// 並列の E2E のワーカーが同じ番号を払い出さないことの守り(D-133)。帯が重なると、ポートの取り合いは
// 起動の失敗でなく「別のテストの mock と黙って話す」形で現れ、原因が分かりにくい flake になる
describe('e2e port blocks (D-133)', () => {
  const ids = Array.from({ length: PORT_BLOCK_COUNT }, (_, index) => index + 1)

  it.each([0, 1, 5, 11, 12, 4242, 123456])('gives every worker of one run its own block (run salt %i)', (salt) => {
    const starts = ids.map(id => portBlockStart(id, salt))
    expect(new Set(starts).size).toBe(PORT_BLOCK_COUNT)
    for (const start of starts) {
      expect(start).toBeGreaterThanOrEqual(PORT_RANGE_START)
      expect((start - PORT_RANGE_START) % PORT_BLOCK_SIZE).toBe(0)
      // OS が外向きの通信に割り当てる番号(Linux 32768〜・Windows 49152〜)の下に収まる
      expect(start + PORT_BLOCK_SIZE - 1).toBeLessThan(32_768)
    }
  })

  it('stays clear of the default ports', () => {
    for (const port of [7080, 7090, 7091, 8080]) {
      expect(port < PORT_RANGE_START || port >= PORT_RANGE_START + PORT_BLOCK_COUNT * PORT_BLOCK_SIZE).toBe(true)
    }
  })

  // 剰余で回すと帯を共有してしまうので、帯の数を超えるワーカーは断る
  it.each([0, PORT_BLOCK_COUNT + 1, 24, Number.NaN, 1.5])('refuses worker %s', (id) => {
    expect(() => portBlockStart(id, 0)).toThrow(/at most 12 e2e workers/)
  })
})
