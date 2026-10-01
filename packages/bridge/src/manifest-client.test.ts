import { describe, expect, it } from 'vitest'

import type { Manifest } from '@oscdesk/shared'

import { ManifestClient } from './manifest-client'

const VALID_MANIFEST: Manifest = {
  version: 1,
  projectId: 'oscdesk-demo',
  entries: [
    {
      address: '/avatar/blend/smile',
      label: 'Smile',
      type: 'f',
      widget: 'fader',
      range: [0, 1],
      default: 0.25,
      group: 'Face',
    },
  ],
}

describe('ManifestClient', () => {
  it('accepts a manifest when the project identifier matches the expected identifier', () => {
    const client = new ManifestClient({ expectedProjectId: 'oscdesk-demo' })

    expect(client.onManifestPayload(JSON.stringify(VALID_MANIFEST))).toEqual({
      accepted: true,
      duplicate: false,
      manifest: VALID_MANIFEST,
      origin: null,
      bootChanged: false,
    })
  })

  it('rejects a mismatched project identifier without changing the settled manifest or retry state', () => {
    const client = new ManifestClient({ expectedProjectId: 'oscdesk-demo' })

    client.onManifestPayload(JSON.stringify(VALID_MANIFEST))
    const wrongManifest = { ...VALID_MANIFEST, projectId: 'other-project' }

    const rejected = client.onManifestPayload(JSON.stringify(wrongManifest))

    expect(rejected).toEqual({
      accepted: false,
      reason: 'project-mismatch',
      expectedProjectId: 'oscdesk-demo',
      receivedProjectId: 'other-project',
      detail: 'expected projectId "oscdesk-demo", received "other-project"',
      isRepeat: false,
    })
    expect(client.current()).toEqual(VALID_MANIFEST)
    expect(client.shouldRequest(0)).toBe(false)
  })

  it('keeps requesting after a mismatched project identifier while requesting', () => {
    const client = new ManifestClient({ expectedProjectId: 'oscdesk-demo' })
    const wrongManifest = { ...VALID_MANIFEST, projectId: 'other-project' }

    const rejected = client.onManifestPayload(JSON.stringify(wrongManifest))

    expect(rejected.accepted).toBe(false)
    expect(client.shouldRequest(0)).toBe(true)
  })

  it('includes expected and received identifiers in the repeat suppression key', () => {
    const client = new ManifestClient({ expectedProjectId: 'oscdesk-demo' })

    const first = client.onManifestPayload(
      JSON.stringify({ ...VALID_MANIFEST, projectId: 'other-project' }),
    )
    const second = client.onManifestPayload(
      JSON.stringify({ ...VALID_MANIFEST, projectId: 'other-project' }),
    )
    const differentSource = client.onManifestPayload(
      JSON.stringify({ ...VALID_MANIFEST, projectId: 'third-project' }),
    )

    expect(first).toMatchObject({ reason: 'project-mismatch', isRepeat: false })
    expect(second).toMatchObject({ reason: 'project-mismatch', isRepeat: true })
    expect(differentSource).toMatchObject({ reason: 'project-mismatch', isRepeat: false })
  })

  it('skips identifier matching when no expected identifier is configured', () => {
    const client = new ManifestClient()

    expect(client.onManifestPayload(JSON.stringify(VALID_MANIFEST))).toEqual({
      accepted: true,
      duplicate: false,
      manifest: VALID_MANIFEST,
      origin: null,
      bootChanged: false,
    })
  })

  it('requests immediately and keeps retrying at the configured interval until a manifest is accepted', () => {
    const client = new ManifestClient({ requestIntervalMs: 2000 })

    expect(client.shouldRequest(0)).toBe(true)

    client.onRequestSent(0)

    expect(client.shouldRequest(1999)).toBe(false)
    expect(client.shouldRequest(2000)).toBe(true)

    const accepted = client.onManifestPayload(JSON.stringify(VALID_MANIFEST))

    expect(accepted).toEqual({
      accepted: true,
      duplicate: false,
      manifest: VALID_MANIFEST,
      origin: null,
      bootChanged: false,
    })
    expect(client.current()).toEqual(VALID_MANIFEST)
    expect(client.shouldRequest(4000)).toBe(false)
  })

  it('rejects invalid JSON, keeps the last accepted manifest unchanged, and suppresses repeated logs', () => {
    const client = new ManifestClient()

    const first = client.onManifestPayload('{')
    const second = client.onManifestPayload('{')

    expect(first.accepted).toBe(false)
    if (first.accepted) {
      throw new Error('expected manifest JSON to be rejected')
    }

    expect(first.reason).toBe('json-parse-error')
    expect(first.isRepeat).toBe(false)
    expect(second).toMatchObject({
      accepted: false,
      reason: 'json-parse-error',
      isRepeat: true,
    })
    expect(client.current()).toBeNull()
    expect(client.shouldRequest(0)).toBe(true)
  })

  it('rejects schema-invalid manifests and keeps requesting until a valid payload arrives', () => {
    const client = new ManifestClient()

    const invalidPayload = JSON.stringify({
      version: 1,
      entries: [
        {
          address: '/avatar/blend/smile',
          label: 'Smile',
          type: 'invalid',
          widget: 'fader',
        },
      ],
    })

    const rejected = client.onManifestPayload(invalidPayload)

    expect(rejected).toEqual({
      accepted: false,
      reason: 'schema-error',
      detail: expect.stringContaining('entries.0.type'),
      isRepeat: false,
    })
    expect(client.current()).toBeNull()
    expect(client.shouldRequest(0)).toBe(true)
  })

  it('restarts requesting immediately when reachability recovers after a settled manifest', () => {
    const client = new ManifestClient({ requestIntervalMs: 2000 })

    client.onManifestPayload(JSON.stringify(VALID_MANIFEST))
    expect(client.shouldRequest(5000)).toBe(false)

    client.onReachabilityRecovered()

    expect(client.current()).toEqual(VALID_MANIFEST)
    expect(client.shouldRequest(5000)).toBe(true)

    client.onRequestSent(5000)
    expect(client.shouldRequest(6999)).toBe(false)
    expect(client.shouldRequest(7000)).toBe(true)
  })

  it('accepts the same manifest again after recovery without re-entering a rejection state', () => {
    const client = new ManifestClient()

    client.onManifestPayload(JSON.stringify(VALID_MANIFEST))
    client.onReachabilityRecovered()

    const accepted = client.onManifestPayload(JSON.stringify(VALID_MANIFEST))

    expect(accepted).toEqual({
      accepted: true,
      duplicate: false,
      manifest: VALID_MANIFEST,
      origin: null,
      bootChanged: false,
    })
    expect(client.current()).toEqual(VALID_MANIFEST)
    expect(client.shouldRequest(0)).toBe(false)
  })
})

const ORIGIN_A2 = { bootId: 'boot-a', structureGeneration: 2 }
const withOrigin = (origin: { bootId: string; structureGeneration: number }): string =>
  JSON.stringify({ ...VALID_MANIFEST, ...origin })
const statsJson = (origin?: { bootId: string; structureGeneration: number }): string =>
  JSON.stringify({ received: 1, parseErrors: 0, lastReceivedAt: '2026-07-23T12:34:56.000Z', ...origin })

describe('ManifestClient origin adoption (1.2)', () => {
  it('adopts the first manifest with origin and reports it', () => {
    const client = new ManifestClient()
    const result = client.onManifestPayload(withOrigin(ORIGIN_A2))
    expect(result).toMatchObject({ accepted: true, duplicate: false, origin: ORIGIN_A2, bootChanged: false })
    expect(client.shouldRequest(0)).toBe(false)
  })

  it('returns duplicate for the same origin', () => {
    const client = new ManifestClient()
    client.onManifestPayload(withOrigin(ORIGIN_A2))
    expect(client.onManifestPayload(withOrigin(ORIGIN_A2))).toEqual({ accepted: true, duplicate: true, origin: ORIGIN_A2 })
  })

  it('adopts a different origin even with a smaller generation, and flags bootId change', () => {
    const client = new ManifestClient()
    client.onManifestPayload(withOrigin(ORIGIN_A2))
    expect(client.onManifestPayload(withOrigin({ bootId: 'boot-a', structureGeneration: 1 }))).toMatchObject({
      accepted: true, duplicate: false, bootChanged: false,
    })
    expect(client.onManifestPayload(withOrigin({ bootId: 'boot-b', structureGeneration: 1 }))).toMatchObject({
      accepted: true, duplicate: false, bootChanged: true,
    })
  })

  it('adopts every payload from a source without origin', () => {
    const client = new ManifestClient()
    expect(client.onManifestPayload(JSON.stringify(VALID_MANIFEST))).toMatchObject({ duplicate: false })
    expect(client.onManifestPayload(JSON.stringify(VALID_MANIFEST))).toMatchObject({ duplicate: false })
  })

  it('adopts an origin manifest after an originless one and vice versa', () => {
    const client = new ManifestClient()
    client.onManifestPayload(JSON.stringify(VALID_MANIFEST))
    expect(client.onManifestPayload(withOrigin(ORIGIN_A2))).toMatchObject({ duplicate: false, bootChanged: false })
    expect(client.onManifestPayload(JSON.stringify(VALID_MANIFEST))).toMatchObject({ duplicate: false, origin: null })
  })

  it('adopts the next payload regardless after reachability recovery, then dedups again', () => {
    const client = new ManifestClient()
    client.onManifestPayload(withOrigin(ORIGIN_A2))
    client.onReachabilityRecovered()
    expect(client.shouldRequest(0)).toBe(true)
    expect(client.onManifestPayload(withOrigin(ORIGIN_A2))).toMatchObject({ accepted: true, duplicate: false })
    expect(client.shouldRequest(10_000)).toBe(false)
    expect(client.onManifestPayload(withOrigin(ORIGIN_A2))).toMatchObject({ duplicate: true })
  })

  it('keeps project mismatch and schema rejection behavior (back to requesting)', () => {
    const client = new ManifestClient({ expectedProjectId: 'oscdesk-demo' })
    client.onManifestPayload(withOrigin(ORIGIN_A2))
    const half = JSON.stringify({ ...VALID_MANIFEST, bootId: 'x' })
    expect(client.onManifestPayload(half)).toMatchObject({ accepted: false, reason: 'schema-error' })
    expect(client.shouldRequest(0)).toBe(true)
    expect(client.onManifestPayload(JSON.stringify({ ...VALID_MANIFEST, projectId: 'zzz', ...ORIGIN_A2 }))).toMatchObject({
      accepted: false, reason: 'project-mismatch',
    })
  })
})

describe('ManifestClient stats reconciliation (1.3)', () => {
  it('does not request stats without an accepted origin', () => {
    const client = new ManifestClient()
    expect(client.shouldRequestStats(100_000)).toBe(false)
    client.onManifestPayload(JSON.stringify(VALID_MANIFEST))
    expect(client.shouldRequestStats(100_000)).toBe(false)
  })

  it('requests stats on a 4 s (injectable) interval while origin accepted', () => {
    const client = new ManifestClient()
    client.onManifestPayload(withOrigin(ORIGIN_A2))
    expect(client.shouldRequestStats(0)).toBe(true)
    client.onStatsRequestSent(0)
    expect(client.shouldRequestStats(3999)).toBe(false)
    expect(client.shouldRequestStats(4000)).toBe(true)
    const fast = new ManifestClient({ statsIntervalMs: 100 })
    fast.onManifestPayload(withOrigin(ORIGIN_A2))
    fast.onStatsRequestSent(0)
    expect(fast.shouldRequestStats(100)).toBe(true)
  })

  it('classifies stats: match, not-applicable, invalid (with repeat suppression)', () => {
    const client = new ManifestClient()
    expect(client.onStatsPayload(statsJson(ORIGIN_A2))).toEqual({ kind: 'not-applicable' })
    client.onManifestPayload(withOrigin(ORIGIN_A2))
    expect(client.onStatsPayload(statsJson(ORIGIN_A2))).toEqual({ kind: 'match' })
    expect(client.onStatsPayload(statsJson())).toEqual({ kind: 'not-applicable' })
    const first = client.onStatsPayload('{oops')
    expect(first).toMatchObject({ kind: 'invalid', isRepeat: false })
    expect(client.onStatsPayload('{oops')).toMatchObject({ kind: 'invalid', isRepeat: true })
    expect(client.onStatsPayload(JSON.stringify({ received: 1 }))).toMatchObject({ kind: 'invalid' })
  })

  it('not-applicable when accepted manifest has no origin', () => {
    const client = new ManifestClient()
    client.onManifestPayload(JSON.stringify(VALID_MANIFEST))
    expect(client.onStatsPayload(statsJson(ORIGIN_A2))).toEqual({ kind: 'not-applicable' })
  })

  it('mismatch -> immediate manifest request -> persists until target accepted', () => {
    const client = new ManifestClient()
    client.onManifestPayload(withOrigin(ORIGIN_A2))
    client.onRequestSent(0)
    const target = { bootId: 'boot-a', structureGeneration: 3 }
    expect(client.onStatsPayload(statsJson(target))).toEqual({ kind: 'mismatch', reported: target })
    expect(client.shouldRequest(1)).toBe(true)
    client.onRequestSent(1)
    expect(client.shouldRequest(1)).toBe(false)
    expect(client.shouldRequest(2001)).toBe(true)
    // another origin arrives (not the target): adopted but still requesting
    expect(client.onManifestPayload(withOrigin({ bootId: 'boot-a', structureGeneration: 4 }))).toMatchObject({
      accepted: true, duplicate: false,
    })
    expect(client.shouldRequest(4001)).toBe(true)
    expect(client.onManifestPayload(withOrigin(target))).toMatchObject({ accepted: true, duplicate: false })
    expect(client.shouldRequest(100_000)).toBe(false)
  })

  it('match clears the target and settles unless a forced adoption is pending', () => {
    const client = new ManifestClient()
    client.onManifestPayload(withOrigin(ORIGIN_A2))
    client.onStatsPayload(statsJson({ bootId: 'boot-a', structureGeneration: 3 }))
    client.onReachabilityRecovered()
    expect(client.onStatsPayload(statsJson(ORIGIN_A2))).toEqual({ kind: 'match' })
    expect(client.shouldRequest(0)).toBe(true) // forced flag keeps requesting
    client.onManifestPayload(withOrigin(ORIGIN_A2))
    expect(client.shouldRequest(10_000)).toBe(false)
  })

  it('match after a mismatch target settles', () => {
    const client = new ManifestClient()
    client.onManifestPayload(withOrigin(ORIGIN_A2))
    client.onStatsPayload(statsJson({ bootId: 'boot-a', structureGeneration: 3 }))
    expect(client.shouldRequest(0)).toBe(true)
    expect(client.onStatsPayload(statsJson(ORIGIN_A2))).toEqual({ kind: 'match' })
    expect(client.shouldRequest(0)).toBe(false)
  })
})
