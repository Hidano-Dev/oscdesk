import { z } from 'zod'

import { ManifestEntrySchema, type ManifestEntry } from '@oscdesk/shared'

import type { StagingDeclaration } from './staging'

export const StagingSectionSchema = z.object({
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

/** シナリオのエントリ。`id` は同一性の判定にだけ使い、ワイヤには出さない。 */
export const ScenarioEntrySchema = ManifestEntrySchema.and(z.object({
  id: z.string().min(1).optional(),
  staged: z.never().optional(),
  appliesTo: z.never().optional(),
}))

export type StagingSection = z.infer<typeof StagingSectionSchema>
export type ScenarioEntry = ManifestEntry & { id?: string | undefined }

export const RuntimeVariantSchema = z.object({
  entries: z.array(ScenarioEntrySchema),
  optionLists: z.record(z.string(), z.array(z.string())).optional(),
  staging: StagingSectionSchema.optional(),
  /** 切り替え時の projectId 検査用。省略時は現在の projectId と同じ扱い。 */
  projectId: z.string().min(1).optional(),
})

export const RuntimeSectionSchema = z
  .object({
    variants: z.record(z.string(), RuntimeVariantSchema),
    switches: z.array(z.object({
      trigger: z.string().startsWith('/').refine((value) => !value.startsWith('/sys/'), {
        message: 'trigger must not be under /sys/',
      }),
      variant: z.string().min(1),
    })),
  })
  .superRefine((section, context) => {
    section.switches.forEach((entry, index) => {
      if (section.variants[entry.variant] === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['switches', index, 'variant'],
          message: `unknown variant "${entry.variant}"`,
        })
      }
    })
  })

export type RuntimeVariant = z.infer<typeof RuntimeVariantSchema>
export type RuntimeSection = z.infer<typeof RuntimeSectionSchema>

export type SwitchRejectReason = 'schema' | 'project-mismatch' | 'address-reused' | 'compile' | 'too-large'
export type SwitchResult =
  | { kind: 'not-a-trigger' }
  | { kind: 'switched'; variant: string; structureGeneration: number; manifestJson: string }
  | { kind: 'rejected'; variant: string; reason: SwitchRejectReason; detail: string }

/** `id` が無ければアドレスを識別子とする(Unity の EffectiveId と同じ)。 */
export function effectiveId(entry: { address: string; id?: string | undefined }): string {
  return entry.id ?? entry.address
}

/** 1 つのアドレスには 1 つの識別子だけが結び付く。違反したアドレスを返す。 */
export function findAddressReuse(
  bindings: ReadonlyMap<string, string>,
  entries: readonly ScenarioEntry[],
): string | null {
  const seen = new Map<string, string>()
  for (const entry of entries) {
    const id = effectiveId(entry)
    const bound = bindings.get(entry.address) ?? seen.get(entry.address)
    if (bound !== undefined && bound !== id) {
      return entry.address
    }
    seen.set(entry.address, id)
  }
  return null
}

export function toStagingDeclaration(
  entries: readonly ScenarioEntry[],
  staging: StagingSection | undefined,
): StagingDeclaration {
  const staged = new Set(staging?.staged ?? [])
  const triggers = new Map((staging?.triggers ?? []).map((trigger) => [trigger.address, trigger.appliesTo]))
  const expansions = new Map((staging?.expansions ?? []).map((expansion) => [expansion.source, expansion.targets]))

  return {
    entries: entries.map((entry) => ({
      address: entry.address,
      type: entry.type,
      isButton: entry.widget === 'button',
      staged: staged.has(entry.address),
      appliesTo: triggers.get(entry.address) ?? [],
      expandsTo: expansions.get(entry.address) ?? [],
    })),
  }
}

/** 識別子・アドレス・型がすべて一致する旧エントリを探す(引き継ぎの条件)。 */
export function findCarryOverSource(
  previous: readonly ScenarioEntry[],
  entry: ScenarioEntry,
): ScenarioEntry | undefined {
  const id = effectiveId(entry)
  return previous.find(
    (candidate) =>
      effectiveId(candidate) === id && candidate.address === entry.address && candidate.type === entry.type,
  )
}

/** 0 以外の数値と真だけをトリガの値とみなす。 */
export function isTriggerValue(value: number | string | boolean): boolean {
  return value === true || (typeof value === 'number' && Number.isFinite(value) && value !== 0)
}
