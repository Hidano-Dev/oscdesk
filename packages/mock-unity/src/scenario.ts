import { randomUUID } from 'node:crypto'
import fs from 'node:fs'

import { z } from 'zod'

import {
  MANIFEST_SIZE,
  ManifestSchema,
  type Manifest,
  type ManifestEntry,
} from '@oscdesk/shared'

import {
  RuntimeSectionSchema,
  ScenarioEntrySchema,
  StagingSectionSchema,
  findAddressReuse,
  findCarryOverSource,
  isTriggerValue,
  effectiveId,
  toStagingDeclaration,
  type RuntimeVariant,
  type ScenarioEntry,
  type StagingSection,
  type SwitchRejectReason,
  type SwitchResult,
} from './runtime-switch'

import {
  StagingEngine,
  compileStagingPlan,
  type StagingDeclaration,
  type StagingReaction,
  type StagingValue,
  type StagingWrite,
} from './staging'

const CHARACTER_NAME_TOKEN = '{characterName}'

const ScenarioCharacterNameSchema = z.object({
  candidates: z.array(z.string().min(1)).min(1),
  randomSuffix: z.boolean().optional(),
})

export const ScenarioSchema = z.object({
  projectId: z.string().min(1),
  characterName: ScenarioCharacterNameSchema.optional(),
  entries: z.array(ScenarioEntrySchema),
  optionLists: z.record(z.string(), z.array(z.string())).optional(),
  rawManifestOverride: z.string().optional(),
  staging: StagingSectionSchema.optional(),
  runtime: RuntimeSectionSchema.optional(),
})

export type ScenarioDefinition = z.infer<typeof ScenarioSchema>
export type { ScenarioEntry }

export interface AppliedRecord {
  readonly sequence: number
  readonly triggerAddress: string
  readonly values: readonly StagingWrite[]
}

export interface StagingSnapshot {
  readonly applyLog: readonly AppliedRecord[]
  readonly appliedValues: ReadonlyMap<string, StagingValue>
}

export interface ScenarioRuntimeOptions {
  characterName?: string
  projectId?: string
  random?: () => number
  /** テスト用。省略時は randomUUID からハイフンを除いた 32 桁。 */
  bootId?: string
  /** 起動の識別子と構造の世代を持たない従来の送信元として振る舞う。 */
  legacyOrigin?: boolean
}

interface ManifestState {
  readonly projectId: string
  readonly entries: readonly ScenarioEntry[]
  readonly optionLists: Record<string, string[]> | undefined
  readonly staging: StagingSection | undefined
  readonly engine: StagingEngine
}

export class ScenarioRuntime {
  readonly characterName: string | null
  readonly projectId: string

  readonly #definition: ScenarioDefinition
  readonly #random: () => number
  readonly #bootId: string
  readonly #legacyOrigin: boolean
  // 起動中に一度結び付いたアドレスと識別子の対。エントリが消えても覚えておく。
  readonly #bindings = new Map<string, string>()
  readonly #applyLog: AppliedRecord[] = []
  readonly #appliedValues = new Map<string, StagingValue>()
  #entries: readonly ScenarioEntry[]
  #entriesByAddress: Map<string, ScenarioEntry>
  #optionLists: Record<string, string[]> | undefined
  #stagingSection: StagingSection | undefined
  #staging: StagingEngine
  #structureGeneration = 1

  constructor(definition: ScenarioDefinition, options: ScenarioRuntimeOptions = {}) {
    this.#definition = ScenarioSchema.parse(definition)
    this.#random = options.random ?? Math.random
    this.#bootId = options.bootId ?? randomUUID().replaceAll('-', '')
    this.#legacyOrigin = options.legacyOrigin ?? false
    this.characterName = resolveCharacterName(this.#definition, options, this.#random)
    this.projectId = options.projectId ?? this.#definition.projectId
    this.#entries = this.#definition.entries
    this.#entriesByAddress = new Map(this.#entries.map((entry) => [entry.address, entry]))
    this.#optionLists = this.#definition.optionLists
    this.#stagingSection = this.#definition.staging

    const compiled = compileStagingPlan(toStagingDeclaration(this.#entries, this.#stagingSection))
    if (!compiled.ok) {
      throw new Error(`Invalid staging declaration: ${compiled.errors.map((item) => item.code).join(', ')}`)
    }
    this.#staging = new StagingEngine(compiled.plan)
    this.#seedEngine(this.#staging, this.#entries)
    for (const entry of this.#entries) {
      this.#bindings.set(entry.address, effectiveId(entry))
    }

    if (this.#definition.rawManifestOverride === undefined) {
      ManifestSchema.parse(this.#buildManifest(this.#currentState(), this.#structureGeneration))
    }
  }

  /** 起動の識別子と構造の世代の組。従来形式の模倣中は null。 */
  originFields(): { bootId: string; structureGeneration: number } | null {
    return this.#legacyOrigin
      ? null
      : { bootId: this.#bootId, structureGeneration: this.#structureGeneration }
  }

  recordValue(address: string, value: number | string | boolean): StagingReaction | null {
    if (address.startsWith('/sys/')) {
      return null
    }

    const entry = this.#entriesByAddress.get(address)
    if (!entry || !matchesEntryType(entry, value)) {
      return null
    }

    const reaction = this.#staging.handle(address, toStagingValue(entry, value)!)
    if (reaction.applyTriggered) {
      const values = reaction.applyPayload.map((write) => ({
        address: write.address,
        value: write.value,
      }))
      this.#applyLog.push({
        sequence: this.#applyLog.length + 1,
        triggerAddress: address,
        values,
      })
      for (const write of values) {
        this.#appliedValues.set(write.address, write.value)
      }
    }
    return reaction
  }

  /**
   * トリガのアドレスに非ゼロの値を受けたら、切り替えを試みる。検査の順序は Unity と同じ
   * (スキーマ → projectId → アドレスの再利用 → コンパイル → 引き継ぎとシード → サイズ)。
   * 落ちたら状態を一切変えない。
   */
  trySwitch(address: string, value: number | string | boolean): SwitchResult {
    const runtime = this.#definition.runtime
    const target = runtime?.switches.find((candidate) => candidate.trigger === address)
    const triggerEntry = this.#entriesByAddress.get(address)
    if (
      runtime === undefined ||
      target === undefined ||
      triggerEntry === undefined ||
      !matchesEntryType(triggerEntry, value) ||
      !isTriggerValue(value)
    ) {
      return { kind: 'not-a-trigger' }
    }

    const variantName = target.variant
    const variant = runtime.variants[variantName]!
    const reject = (reason: SwitchRejectReason, detail: string): SwitchResult => ({
      kind: 'rejected',
      variant: variantName,
      reason,
      detail,
    })
    const nextGeneration = this.#structureGeneration + 1
    const candidate = this.#candidateState(variant)

    // 1. スキーマ(世代 +1 の組を載せた形で通るか)
    const schemaResult = ManifestSchema.safeParse(this.#buildManifest(candidate, nextGeneration))
    if (!schemaResult.success) {
      return reject('schema', schemaResult.error.issues.map((issue) => issue.message).join('; '))
    }

    // 2. projectId
    if (variant.projectId !== undefined && variant.projectId !== this.projectId) {
      return reject('project-mismatch', `expected "${this.projectId}" but got "${variant.projectId}"`)
    }

    // 3. アドレスの再利用
    const reused = findAddressReuse(this.#bindings, candidate.entries)
    if (reused !== null) {
      return reject('address-reused', `address ${reused} is already bound to another identity`)
    }

    // 4. staging のコンパイル
    const compiled = compileStagingPlan(toStagingDeclaration(candidate.entries, candidate.staging))
    if (!compiled.ok) {
      return reject('compile', compiled.errors.map((item) => `${item.code} ${item.address}`).join(', '))
    }

    // 5. 引き継ぎとシード
    const engine = new StagingEngine(compiled.plan)
    this.#seedEngine(engine, candidate.entries, this.#entries, this.#staging)

    // 6. サイズ(世代 +1 の組で組み立てた JSON)
    const next: ManifestState = { ...candidate, engine }
    const manifestJson = this.#serialize(this.#buildManifest(next, nextGeneration))
    const bytes = Buffer.byteLength(manifestJson)
    if (bytes > MANIFEST_SIZE.PRACTICAL_LIMIT_BYTES) {
      return reject('too-large', `${bytes} bytes exceeds ${MANIFEST_SIZE.PRACTICAL_LIMIT_BYTES}`)
    }

    // 確定
    this.#entries = next.entries
    this.#entriesByAddress = new Map(next.entries.map((entry) => [entry.address, entry]))
    this.#optionLists = next.optionLists
    this.#stagingSection = next.staging
    this.#staging = engine
    this.#structureGeneration = nextGeneration
    for (const entry of next.entries) {
      this.#bindings.set(entry.address, effectiveId(entry))
    }
    this.#pruneAppliedRecords()

    return { kind: 'switched', variant: variantName, structureGeneration: nextGeneration, manifestJson }
  }

  stagingSnapshot(): StagingSnapshot {
    return {
      applyLog: this.#applyLog.map((record) => ({ ...record, values: [...record.values] })),
      appliedValues: new Map(this.#appliedValues),
    }
  }

  manifestJson(): string {
    if (this.#definition.rawManifestOverride !== undefined) {
      return this.#definition.rawManifestOverride
    }

    return this.#serialize(this.#buildManifest(this.#currentState(), this.#structureGeneration))
  }

  // 切り替えで消えたアドレス(再結び付けは再利用の検査で拒否済み)の適用記録を捨てる。
  #pruneAppliedRecords(): void {
    for (const address of [...this.#appliedValues.keys()]) {
      if (!this.#entriesByAddress.has(address)) {
        this.#appliedValues.delete(address)
      }
    }
    const kept: AppliedRecord[] = []
    for (const record of this.#applyLog) {
      const values = record.values.filter((write) => this.#entriesByAddress.has(write.address))
      if (values.length > 0) {
        kept.push({ ...record, values })
      }
    }
    this.#applyLog.splice(0, this.#applyLog.length, ...kept)
  }

  #currentState(): ManifestState {
    return {
      projectId: this.projectId,
      entries: this.#entries,
      optionLists: this.#optionLists,
      staging: this.#stagingSection,
      engine: this.#staging,
    }
  }

  #candidateState(variant: RuntimeVariant): Omit<ManifestState, 'engine'> & { engine: StagingEngine } {
    return {
      projectId: variant.projectId ?? this.projectId,
      entries: variant.entries,
      optionLists: variant.optionLists,
      staging: variant.staging,
      engine: new StagingEngine(),
    }
  }

  // 前の状態があれば、識別子・アドレス・型がすべて一致するエントリだけ現在値を引き継ぐ。
  // それ以外は default でシードする。
  #seedEngine(
    engine: StagingEngine,
    entries: readonly ScenarioEntry[],
    previousEntries?: readonly ScenarioEntry[],
    previousEngine?: StagingEngine,
  ): void {
    const triggers = new Set((this.#definition.runtime?.switches ?? []).map((item) => item.trigger))
    for (const entry of entries) {
      if (previousEntries !== undefined && previousEngine !== undefined && !triggers.has(entry.address)) {
        const source = findCarryOverSource(previousEntries, entry)
        const current = source === undefined ? undefined : previousEngine.currentValue(entry.address)
        if (current !== undefined && engine.seedInitialValue(entry.address, current)) {
          continue
        }
      }
      if (entry.default !== undefined) {
        const value = toStagingValue(entry, resolveEntryValue(entry.default, this.characterName))
        if (value !== undefined) {
          engine.seedInitialValue(entry.address, value)
        }
      }
    }
  }

  #buildManifest(state: ManifestState, structureGeneration: number): Manifest {
    const manifest: Manifest = {
      version: 1,
      projectId: state.projectId,
      entries: state.entries.map((entry) => buildManifestEntry(
        entry,
        state.engine.snapshot(),
        this.characterName,
        state.staging,
      )),
    }

    if (state.optionLists !== undefined) {
      manifest.optionLists = state.optionLists
    }

    if (!this.#legacyOrigin) {
      manifest.bootId = this.#bootId
      manifest.structureGeneration = structureGeneration
    }

    return manifest
  }

  // bootId と structureGeneration を projectId の直後に出す(Unity の JSON と同じ並び)。
  #serialize(manifest: Manifest): string {
    const { version, projectId, bootId, structureGeneration, ...rest } = ManifestSchema.parse(manifest)
    return JSON.stringify({ version, projectId, bootId, structureGeneration, ...rest })
  }
}

export function loadScenarioDefinition(filePath: string): ScenarioDefinition {
  const rawJson = fs.readFileSync(filePath, 'utf8')
  const parsed = JSON.parse(rawJson) as unknown
  return ScenarioSchema.parse(parsed)
}

function buildManifestEntry(
  entry: ScenarioEntry,
  values: ReadonlyMap<string, StagingValue>,
  characterName: string | null,
  staging: StagingSection | undefined,
): ManifestEntry {
  const { id: _id, ...wireEntry } = entry
  const resolvedEntry: ManifestEntry = {
    ...wireEntry,
    label: replaceCharacterNameToken(entry.label, characterName),
  }

  const current = values.get(entry.address)
  if (current !== undefined) {
    resolvedEntry.default = fromStagingValue(entry, current)
  } else if (entry.default !== undefined) {
    resolvedEntry.default = resolveEntryValue(entry.default, characterName)
  }

  if (staging?.staged.includes(entry.address)) {
    resolvedEntry.staged = true
  }

  const trigger = staging?.triggers.find((candidate) => candidate.address === entry.address)
  if (entry.widget === 'button' && trigger !== undefined) {
    resolvedEntry.appliesTo = trigger.appliesTo
  }

  return resolvedEntry
}

function resolveCharacterName(
  definition: ScenarioDefinition,
  options: ScenarioRuntimeOptions,
  random: () => number,
): string | null {
  if (options.characterName !== undefined) {
    return options.characterName
  }

  if (definition.characterName === undefined) {
    return null
  }

  const candidateIndex = Math.min(
    definition.characterName.candidates.length - 1,
    Math.floor(clampRandom(random()) * definition.characterName.candidates.length),
  )
  const baseName = definition.characterName.candidates[candidateIndex] ?? null

  if (baseName === null) {
    return null
  }

  if (definition.characterName.randomSuffix) {
    return `${baseName}-${String(Math.floor(clampRandom(random()) * 1000)).padStart(3, '0')}`
  }

  return baseName
}

function resolveEntryValue(value: number | string | boolean, characterName: string | null) {
  if (typeof value !== 'string') {
    return value
  }

  return replaceCharacterNameToken(value, characterName)
}

function replaceCharacterNameToken(value: string, characterName: string | null): string {
  return value.replaceAll(CHARACTER_NAME_TOKEN, characterName ?? '')
}

function matchesEntryType(entry: ScenarioEntry, value: number | string | boolean): boolean {
  switch (entry.type) {
    case 'i':
      return typeof value === 'number' && Number.isInteger(value)
    case 'f':
      return typeof value === 'number'
    case 's':
      return typeof value === 'string'
    case 'bool':
      return typeof value === 'boolean' || (typeof value === 'number' && (value === 0 || value === 1))
    case 'b':
      return false
    default:
      return false
  }
}

function toStagingValue(entry: ScenarioEntry, value: number | string | boolean): StagingValue | undefined {
  if (entry.type === 'bool') {
    return typeof value === 'boolean'
      ? { kind: 'i', value: value ? 1 : 0 }
      : typeof value === 'number' && (value === 0 || value === 1)
        ? { kind: 'i', value }
        : undefined
  }
  if (entry.type === 'i') return typeof value === 'number' && Number.isInteger(value) ? { kind: 'i', value } : undefined
  if (entry.type === 'f') return typeof value === 'number' ? { kind: 'f', value } : undefined
  if (entry.type === 's') return typeof value === 'string' ? { kind: 's', value } : undefined
  return undefined
}

function fromStagingValue(entry: ScenarioEntry, value: StagingValue): number | string | boolean {
  // bool の現在値は 0/1 の数値で出す(要件 10.3。C# 側の default 出力形と揃える)
  if (entry.type === 'bool') return value.kind === 'i' && value.value !== 0 ? 1 : 0
  return value.value
}

function clampRandom(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  if (value < 0) {
    return 0
  }

  if (value >= 1) {
    return 0.999999999
  }

  return value
}
