import { describe, expect, it } from 'vitest'

import {
  ASIDE_KEY_STEP,
  ASIDE_MIN,
  ASIDE_WIDTH_KEY,
  HANDLE_WIDTH,
  MAIN_MIN,
  clampAsideWidth,
  readSavedWidth,
  saveWidth,
  widthFromKey,
  widthFromPointer,
  type WidthStorage,
} from './aside-width-logic'

function memory(initial: Record<string, string> = {}): WidthStorage & { data: Record<string, string> } {
  const data = { ...initial }
  return { data, getItem: (key) => data[key] ?? null, setItem: (key, value) => { data[key] = value } }
}

const broken: WidthStorage = {
  getItem: () => { throw new Error('denied') },
  setItem: () => { throw new Error('denied') },
}

describe('aside width', () => {
  it('keeps the width between the minimum and what leaves the main column its minimum', () => {
    const frame = 1280
    const max = frame - MAIN_MIN - HANDLE_WIDTH
    expect(clampAsideWidth(100, frame)).toBe(ASIDE_MIN)
    expect(clampAsideWidth(500.4, frame)).toBe(500)
    expect(clampAsideWidth(5000, frame)).toBe(max)
    // 枠が狭くて上限が下限を割るときは下限
    expect(clampAsideWidth(400, 500)).toBe(ASIDE_MIN)
  })

  it('measures the width from the right edge of the frame to the pointer', () => {
    expect(widthFromPointer(1300, 900, 1280)).toBe(400)
    expect(widthFromPointer(1300, 1290, 1280)).toBe(ASIDE_MIN)
    expect(widthFromPointer(1300, 0, 1280)).toBe(1280 - MAIN_MIN - HANDLE_WIDTH)
  })

  it('reads only a saved width at or above the minimum', () => {
    expect(readSavedWidth(memory({ [ASIDE_WIDTH_KEY]: '420' }))).toBe(420)
    expect(readSavedWidth(memory({ [ASIDE_WIDTH_KEY]: '100' }))).toBeNull()
    expect(readSavedWidth(memory({ [ASIDE_WIDTH_KEY]: 'wide' }))).toBeNull()
    expect(readSavedWidth(memory())).toBeNull()
    expect(readSavedWidth(null)).toBeNull()
    // 保存領域が使えないブラウザでも落ちない(覚えないだけ)
    expect(readSavedWidth(broken)).toBeNull()
  })

  it('saves a rounded width and ignores a storage that refuses', () => {
    const storage = memory()
    saveWidth(storage, 433.6)
    expect(storage.data[ASIDE_WIDTH_KEY]).toBe('434')
    expect(() => saveWidth(broken, 300)).not.toThrow()
    expect(() => saveWidth(null, 300)).not.toThrow()
  })

  it('moves the handle with the arrow keys within the limits', () => {
    expect(widthFromKey('ArrowLeft', 380, 1280)).toBe(380 + ASIDE_KEY_STEP)
    expect(widthFromKey('ArrowRight', 380, 1280)).toBe(380 - ASIDE_KEY_STEP)
    expect(widthFromKey('ArrowRight', ASIDE_MIN, 1280)).toBe(ASIDE_MIN)
    expect(widthFromKey('Home', 380, 1280)).toBe(ASIDE_MIN)
    expect(widthFromKey('End', 380, 1280)).toBe(1280 - MAIN_MIN - HANDLE_WIDTH)
    expect(widthFromKey('a', 380, 1280)).toBeNull()
  })
})
