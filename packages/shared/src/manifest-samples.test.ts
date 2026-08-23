import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { ManifestSchema } from './schemas'

type ManifestSample = {
  name: string
  valid: boolean
  manifest: unknown
  note: string
}

const manifestSamples = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../protocol/manifest-samples.json'), 'utf8'),
) as { cases: ManifestSample[] }

describe('ManifestSchema shared acceptance fixtures', () => {
  it('validates every hand-authored acceptance and rejection case', () => {
    expect(manifestSamples.cases).not.toHaveLength(0)

    for (const sample of manifestSamples.cases) {
      const result = ManifestSchema.safeParse(sample.manifest)
      expect(result.success, `${sample.name}: ${sample.note}`).toBe(sample.valid)
    }
  })
})
