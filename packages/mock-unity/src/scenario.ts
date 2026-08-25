import fs from 'node:fs'

import { z } from 'zod'

import {
  ManifestEntrySchema,
  ManifestSchema,
  type Manifest,
  type ManifestEntry,
} from '@oscdesk/shared'

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

const StagingSectionSchema = z.object({
  staged: z.array(z.string().startsWith('/')).default([]),
  triggers: z.array(z.object({
    address: z.string().startsWith('/'),
    appliesTo: z.array(z.string()).min(1),
  })).default([]),
  expansions: z.array(z.object({
    source: z.string().startsWith('/'),
    targets: z.array(z.string()).min(1),
  })).default([]),
})

export const ScenarioSchema = z.object({
  projectId: z.string().min(1),
  characterName: ScenarioCharacterNameSchema.optional(),
  entries: z.array(ManifestEntrySchema),
  optionLists: z.record(z.string(), z.array(z.string())).optional(),
  rawManifestOverride: z.string().optional(),
  staging: StagingSectionSchema.optional(),
})

export type ScenarioDefinition = z.infer<typeof ScenarioSchema>
export type ScenarioEntry = ManifestEntry

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
}

export class ScenarioRuntime {
  readonly characterName: string | null
  readonly projectId: string

  readonly #definition: ScenarioDefinition
  readonly #random: () => number
  readonly #entriesByAddress: Map<string, ScenarioEntry>
  readonly #staging: StagingEngine
  readonly #applyLog: AppliedRecord[] = []
  readonly #appliedValues = new Map<string, StagingValue>()

  constructor(definition: ScenarioDefinition, options: ScenarioRuntimeOptions = {}) {
    this.#definition = ScenarioSchema.parse(definition)
    this.#random = options.random ?? Math.random
    this.characterName = resolveCharacterName(this.#definition, options, this.#random)
    this.projectId = options.projectId ?? this.#definition.projectId
    this.#entriesByAddress = new Map(this.#definition.entries.map((entry) => [entry.address, entry]))

    const compiled = compileStagingPlan(toStagingDeclaration(this.#definition))
    if (!compiled.ok) {
      throw new Error(`Invalid staging declaration: ${compiled.errors.map((item) => item.code).join(', ')}`)
    }
    this.#staging = new StagingEngine(compiled.plan)

    for (const entry of this.#definition.entries) {
      if (entry.default !== undefined) {
        const value = toStagingValue(entry, resolveEntryValue(entry.default, this.characterName))
        if (value !== undefined) {
          this.#staging.seedInitialValue(entry.address, value)
        }
      }
    }

    if (this.#definition.rawManifestOverride === undefined) {
      ManifestSchema.parse(this.#buildManifest())
    }
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

    return JSON.stringify(ManifestSchema.parse(this.#buildManifest()))
  }

  #buildManifest(): Manifest {
    const manifest: Manifest = {
      version: 1,
      projectId: this.projectId,
    entries: this.#definition.entries.map((entry) => buildManifestEntry(entry, this.#staging.snapshot(), this.characterName)),
    }

    if (this.#definition.optionLists !== undefined) {
      manifest.optionLists = this.#definition.optionLists
    }

    return manifest
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
): ManifestEntry {
  const resolvedEntry: ManifestEntry = {
    ...entry,
    label: replaceCharacterNameToken(entry.label, characterName),
  }

  const current = values.get(entry.address)
  if (current !== undefined) {
    resolvedEntry.default = fromStagingValue(entry, current)
  } else if (entry.default !== undefined) {
    resolvedEntry.default = resolveEntryValue(entry.default, characterName)
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

function toStagingDeclaration(definition: ScenarioDefinition): StagingDeclaration {
  const staging = definition.staging
  const staged = new Set(staging?.staged ?? [])
  const triggers = new Map((staging?.triggers ?? []).map((trigger) => [trigger.address, trigger.appliesTo]))
  const expansions = new Map((staging?.expansions ?? []).map((expansion) => [expansion.source, expansion.targets]))

  return {
    entries: definition.entries.map((entry) => ({
      address: entry.address,
      type: entry.type,
      isButton: entry.widget === 'button',
      staged: staged.has(entry.address),
      appliesTo: triggers.get(entry.address) ?? [],
      expandsTo: expansions.get(entry.address) ?? [],
    })),
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
