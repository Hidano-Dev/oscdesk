import { ManifestSchema, StatsPayloadSchema, type Manifest, type ManifestOrigin } from '@oscdesk/shared'

const DEFAULT_REQUEST_INTERVAL_MS = 2000
const DEFAULT_STATS_INTERVAL_MS = 4000

export type ManifestRejectReason = 'json-parse-error' | 'schema-error' | 'project-mismatch'

export type ManifestReceiveResult =
  | { accepted: true; duplicate: false; manifest: Manifest; origin: ManifestOrigin | null; bootChanged: boolean }
  | { accepted: true; duplicate: true; origin: ManifestOrigin }
  | { accepted: false; reason: 'json-parse-error' | 'schema-error'; detail: string; isRepeat: boolean }
  | {
      accepted: false
      reason: 'project-mismatch'
      expectedProjectId: string
      receivedProjectId: string
      detail: string
      isRepeat: boolean
    }

export type StatsReceiveResult =
  | { kind: 'match' }
  | { kind: 'mismatch'; reported: ManifestOrigin }
  | { kind: 'not-applicable' }
  | { kind: 'invalid'; detail: string; isRepeat: boolean }

export interface ManifestClientOptions {
  requestIntervalMs?: number
  statsIntervalMs?: number
  expectedProjectId?: string
}

const sameOrigin = (a: ManifestOrigin, b: ManifestOrigin): boolean =>
  a.bootId === b.bootId && a.structureGeneration === b.structureGeneration

const originOf = (value: { bootId?: string | undefined; structureGeneration?: number | undefined }): ManifestOrigin | null =>
  value.bootId !== undefined && value.structureGeneration !== undefined
    ? { bootId: value.bootId, structureGeneration: value.structureGeneration }
    : null

type ManifestClientState = 'requesting' | 'settled'

export class ManifestClient {
  private readonly requestIntervalMs: number
  private readonly expectedProjectId: string | undefined
  private state: ManifestClientState = 'requesting'
  private readonly statsIntervalMs: number
  private lastRequestAtMs: number | null = null
  private lastStatsRequestAtMs: number | null = null
  private lastStatsInvalidKey: string | null = null
  private hasAccepted = false
  private acceptedOrigin: ManifestOrigin | null = null
  private targetOrigin: ManifestOrigin | null = null
  private adoptNextRegardless = false
  private lastRejectKey: string | null = null
  private latestManifest: Manifest | null = null

  constructor(options?: ManifestClientOptions) {
    this.requestIntervalMs = options?.requestIntervalMs ?? DEFAULT_REQUEST_INTERVAL_MS
    this.statsIntervalMs = options?.statsIntervalMs ?? DEFAULT_STATS_INTERVAL_MS
    this.expectedProjectId = options?.expectedProjectId
  }

  shouldRequest(nowMs: number): boolean {
    if (this.state !== 'requesting') {
      return false
    }

    if (this.lastRequestAtMs === null) {
      return true
    }

    return nowMs - this.lastRequestAtMs >= this.requestIntervalMs
  }

  onRequestSent(nowMs: number): void {
    this.lastRequestAtMs = nowMs
  }

  shouldRequestStats(nowMs: number): boolean {
    if (this.acceptedOrigin === null) {
      return false
    }

    return this.lastStatsRequestAtMs === null || nowMs - this.lastStatsRequestAtMs >= this.statsIntervalMs
  }

  onStatsRequestSent(nowMs: number): void {
    this.lastStatsRequestAtMs = nowMs
  }

  onStatsPayload(json: string): StatsReceiveResult {
    let parsedJson: unknown

    try {
      parsedJson = JSON.parse(json)
    } catch (error) {
      return this.invalidStats(formatJsonParseError(error))
    }

    const result = StatsPayloadSchema.safeParse(parsedJson)

    if (!result.success) {
      return this.invalidStats(formatSchemaError(result.error.issues))
    }

    this.lastStatsInvalidKey = null
    const reported = originOf(result.data)

    if (!this.hasAccepted || this.acceptedOrigin === null || reported === null) {
      return { kind: 'not-applicable' }
    }

    if (sameOrigin(reported, this.acceptedOrigin)) {
      this.targetOrigin = null
      if (!this.adoptNextRegardless) {
        this.state = 'settled'
      }
      return { kind: 'match' }
    }

    this.targetOrigin = reported
    this.state = 'requesting'
    this.lastRequestAtMs = null
    return { kind: 'mismatch', reported }
  }

  onManifestPayload(json: string): ManifestReceiveResult {
    let parsedJson: unknown

    try {
      parsedJson = JSON.parse(json)
    } catch (error) {
      return this.reject('json-parse-error', formatJsonParseError(error))
    }

    const result = ManifestSchema.safeParse(parsedJson)

    if (!result.success) {
      return this.reject('schema-error', formatSchemaError(result.error.issues))
    }

    if (this.expectedProjectId !== undefined && result.data.projectId !== this.expectedProjectId) {
      return this.rejectProjectMismatch(this.expectedProjectId, result.data.projectId)
    }

    this.lastRejectKey = null
    const origin = originOf(result.data)

    if (
      !this.adoptNextRegardless &&
      this.hasAccepted &&
      origin !== null &&
      this.acceptedOrigin !== null &&
      sameOrigin(origin, this.acceptedOrigin)
    ) {
      if (this.targetOrigin === null) {
        this.state = 'settled'
      }
      return { accepted: true, duplicate: true, origin }
    }

    const bootChanged =
      origin !== null && this.acceptedOrigin !== null && origin.bootId !== this.acceptedOrigin.bootId

    this.adoptNextRegardless = false
    this.hasAccepted = true
    this.latestManifest = result.data
    this.acceptedOrigin = origin

    if (origin === null || this.targetOrigin === null || sameOrigin(origin, this.targetOrigin)) {
      this.targetOrigin = null
      this.state = 'settled'
    } else {
      this.state = 'requesting'
    }

    return {
      accepted: true,
      duplicate: false,
      manifest: result.data,
      origin,
      bootChanged,
    }
  }

  onReachabilityRecovered(): void {
    this.state = 'requesting'
    this.lastRequestAtMs = null
    this.lastRejectKey = null
    this.adoptNextRegardless = true
  }

  private invalidStats(detail: string): StatsReceiveResult {
    const isRepeat = detail === this.lastStatsInvalidKey
    this.lastStatsInvalidKey = detail
    return { kind: 'invalid', detail, isRepeat }
  }

  current(): Manifest | null {
    return this.latestManifest
  }

  private reject(reason: 'json-parse-error' | 'schema-error', detail: string): ManifestReceiveResult {
    this.state = 'requesting'

    const rejectKey = `${reason}:${detail}`
    const isRepeat = rejectKey === this.lastRejectKey

    this.lastRejectKey = rejectKey

    return {
      accepted: false,
      reason,
      detail,
      isRepeat,
    }
  }

  private rejectProjectMismatch(
    expectedProjectId: string,
    receivedProjectId: string,
  ): ManifestReceiveResult {
    const detail = `expected projectId "${expectedProjectId}", received "${receivedProjectId}"`
    const rejectKey = JSON.stringify(['project-mismatch', expectedProjectId, receivedProjectId])
    const isRepeat = rejectKey === this.lastRejectKey

    this.lastRejectKey = rejectKey

    return {
      accepted: false,
      reason: 'project-mismatch',
      expectedProjectId,
      receivedProjectId,
      detail,
      isRepeat,
    }
  }
}

function formatJsonParseError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message
  }

  return 'Failed to parse manifest JSON.'
}

function formatSchemaError(
  issues: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>,
): string {
  return issues
    .map((issue) => {
      const pathLabel = issue.path.length > 0 ? issue.path.join('.') : '<root>'
      return `${pathLabel}: ${issue.message}`
    })
    .join('; ')
}
