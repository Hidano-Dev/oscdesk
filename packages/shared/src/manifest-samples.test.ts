import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { ManifestSchema } from './schemas'

type ManifestSample = {
  name: string
  valid: boolean
  manifest: unknown
  note: string
}

const manifestSamples = JSON.parse(
  readFileSync(new URL('../../../protocol/manifest-samples.json', import.meta.url), 'utf8'),
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
