import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { imageDataUrlBytes, OSC_PAD, OscPadSchema } from './osc-pad'

const samples = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../protocol/osc-pad-samples.json'), 'utf8'),
) as { cases: Array<{ name: string; valid: boolean; pad: unknown }> }

// 中身の無い base64(A の並び)で、指定バイト数ちょうどの画像の data URL を作る
function imageOf(bytes: number): string {
  const groups = Math.floor(bytes / 3)
  const rest = bytes % 3
  const tail = rest === 0 ? '' : rest === 1 ? 'AA==' : 'AAA='
  return `data:image/png;base64,${'AAAA'.repeat(groups)}${tail}`
}

const padWithImages = (...sizes: number[]) => ({
  format: 'oscdesk-pad',
  version: 1,
  rows: 12,
  columns: 12,
  buttons: sizes.map((size, index) => ({
    id: `b${String(index)}`, row: Math.floor(index / 12), column: index % 12, label: '', image: imageOf(size), address: '/x', args: [],
  })),
})

describe('OscPadSchema', () => {
  it('judges every shared sample the same way as the Python side', () => {
    expect(samples.cases.length).toBeGreaterThan(0)
    for (const sample of samples.cases) {
      expect(OscPadSchema.safeParse(sample.pad).success, sample.name).toBe(sample.valid)
    }
  })

  it('counts the decoded bytes of an image data URL', () => {
    expect(imageDataUrlBytes(imageOf(0))).toBe(0)
    expect(imageDataUrlBytes(imageOf(1))).toBe(1)
    expect(imageDataUrlBytes(imageOf(2))).toBe(2)
    expect(imageDataUrlBytes(imageOf(300))).toBe(300)
    expect(imageDataUrlBytes('data:image/svg+xml;base64,AAAA')).toBeNull()
  })

  it('limits each image and the images in total', () => {
    expect(OscPadSchema.safeParse(padWithImages(OSC_PAD.MAX_IMAGE_BYTES)).success).toBe(true)
    const tooLarge = OscPadSchema.safeParse(padWithImages(OSC_PAD.MAX_IMAGE_BYTES + 1))
    expect(tooLarge.success).toBe(false)
    expect(tooLarge.error?.issues.map(issue => issue.message)).toContain(`image of "b0" exceeds ${String(OSC_PAD.MAX_IMAGE_BYTES)} bytes`)

    const count = OSC_PAD.MAX_TOTAL_IMAGE_BYTES / OSC_PAD.MAX_IMAGE_BYTES
    expect(OscPadSchema.safeParse(padWithImages(...Array.from({ length: count }, () => OSC_PAD.MAX_IMAGE_BYTES))).success).toBe(true)
    const total = OscPadSchema.safeParse(padWithImages(...Array.from({ length: count + 1 }, () => OSC_PAD.MAX_IMAGE_BYTES)))
    expect(total.error?.issues.map(issue => issue.message)).toContain(`images exceed ${String(OSC_PAD.MAX_TOTAL_IMAGE_BYTES)} bytes in total`)
  })
})
