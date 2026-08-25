export type StagingValue =
  | { readonly kind: 'i'; readonly value: number }
  | { readonly kind: 'f'; readonly value: number }
  | { readonly kind: 's'; readonly value: string }

export interface StagingWrite {
  readonly address: string
  readonly value: StagingValue
}

export interface StagingReaction {
  readonly recorded: boolean
  readonly expansionWrites: readonly StagingWrite[]
  readonly applyTriggered: boolean
  readonly applyPayload: readonly StagingWrite[]
}

export type StagingEntryType = 'i' | 'f' | 's' | 'b' | 'bool'

export interface StagingEntryDeclaration {
  readonly address: string
  readonly type: StagingEntryType
  readonly isButton: boolean
  readonly staged: boolean
  readonly appliesTo: readonly string[]
  readonly expandsTo: readonly string[]
}

export interface StagingDeclaration {
  readonly entries: readonly StagingEntryDeclaration[]
}

export interface StagingCompileError {
  readonly code: `S${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`
  readonly address: string
  readonly message: string
}

export type StagingCompileResult =
  | { readonly ok: true; readonly plan: StagingPlan }
  | { readonly ok: false; readonly errors: readonly StagingCompileError[] }

interface CompiledEntry {
  readonly declaration: StagingEntryDeclaration
  readonly appliesTo: readonly string[]
  readonly expandsTo: readonly string[]
}

/** A validated, immutable index for a staging declaration. */
export class StagingPlan {
  static readonly empty = new StagingPlan(new Map(), false)

  readonly hasStagingDeclarations: boolean
  readonly #entries: ReadonlyMap<string, CompiledEntry>

  constructor(entries: ReadonlyMap<string, CompiledEntry>, hasStagingDeclarations: boolean) {
    this.#entries = entries
    this.hasStagingDeclarations = hasStagingDeclarations
  }

  /** OSC 1.0's supported subset: `*` matches zero or more characters in one part. */
  static matchesPattern(pattern: string, address: string): boolean {
    // 壊れた形(空 part・`//`・末尾スラッシュ・未採用のワイルドカード文字)はどちらの側でも一致させない。
    // 照合器自身が弾くことで、S3 を通っていない宣言アドレスが展開先・適用範囲に紛れ込まない
    if (!isValidAddressShape(pattern) || !isValidAddressShape(address)) {
      return false
    }

    const patternParts = pattern.split('/')
    const addressParts = address.split('/')
    if (patternParts.length !== addressParts.length) {
      return false
    }

    return patternParts.every((part, index) => partPatternMatches(part, addressParts[index] ?? ''))
  }

  entry(address: string): CompiledEntry | undefined {
    return this.#entries.get(address)
  }

  entries(): readonly CompiledEntry[] {
    return [...this.#entries.values()]
  }
}

/** Executes an immutable staging plan and owns the mutable current-value store. */
export class StagingEngine {
  readonly #plan: StagingPlan
  readonly #currentValues = new Map<string, StagingValue>()

  constructor(plan: StagingPlan = StagingPlan.empty) {
    this.#plan = plan
  }

  seedInitialValue(address: string, value: StagingValue): boolean {
    const normalized = this.#normalize(address, value)
    if (normalized === undefined) {
      return false
    }
    this.#currentValues.set(address, normalized)
    return true
  }

  handle(address: string, value: StagingValue): StagingReaction {
    const normalized = this.#normalize(address, value)
    if (normalized === undefined) {
      return emptyReaction()
    }

    this.#currentValues.set(address, normalized)
    const entry = this.#plan.entry(address)
    const expansionWrites: StagingWrite[] = []
    for (const target of entry?.expandsTo ?? []) {
      const targetValue = this.#normalize(target, normalized)
      if (targetValue !== undefined) {
        this.#currentValues.set(target, targetValue)
        expansionWrites.push({ address: target, value: targetValue })
      }
    }

    const trigger = entry?.appliesTo.length ? entry : undefined
    const applyTriggered = trigger !== undefined && isTruthy(normalized)
    const applyPayload: StagingWrite[] = []
    if (applyTriggered) {
      for (const candidate of this.#plan.entries()) {
        if (!candidate.declaration.staged || !trigger.appliesTo.includes(candidate.declaration.address)) {
          continue
        }
        const current = this.#currentValues.get(candidate.declaration.address)
        if (current !== undefined) {
          applyPayload.push({ address: candidate.declaration.address, value: current })
        }
      }
    }

    return { recorded: true, expansionWrites, applyTriggered, applyPayload }
  }

  currentValue(address: string): StagingValue | undefined {
    return this.#currentValues.get(address)
  }

  snapshot(): ReadonlyMap<string, StagingValue> {
    return new Map(this.#currentValues)
  }

  #normalize(address: string, value: StagingValue): StagingValue | undefined {
    const entry = this.#plan.entry(address)
    if (entry === undefined) {
      return undefined
    }
    switch (entry.declaration.type) {
      case 'i':
        return value.kind === 'i' && Number.isInteger(value.value) ? value : undefined
      case 'f':
        return value.kind === 'f'
          ? value
          : value.kind === 'i' && Number.isInteger(value.value)
            ? { kind: 'f', value: value.value }
            : undefined
      case 's':
        return value.kind === 's' ? value : undefined
      case 'bool':
        return value.kind === 'i' && (value.value === 0 || value.value === 1) ? value : undefined
      case 'b':
        return undefined
    }
  }
}

function emptyReaction(): StagingReaction {
  return { recorded: false, expansionWrites: [], applyTriggered: false, applyPayload: [] }
}

function isTruthy(value: StagingValue): boolean {
  return value.kind === 'i' ? value.value !== 0 : value.kind === 'f' ? value.value !== 0 : value.value.length > 0
}

export function matchesPattern(pattern: string, address: string): boolean {
  return StagingPlan.matchesPattern(pattern, address)
}

export function compileStagingPlan(declaration: StagingDeclaration): StagingCompileResult {
  const entries = declaration.entries
  const errors: StagingCompileError[] = []
  const hasStagingDeclarations = entries.some(
    (entry) => entry.staged || entry.appliesTo.length > 0 || entry.expandsTo.length > 0,
  )
  const byAddress = new Map<string, StagingEntryDeclaration>()

  for (const entry of entries) {
    if (hasStagingDeclarations && byAddress.has(entry.address)) {
      errors.push(error('S9', entry.address, 'duplicate staging entry address'))
    } else if (!byAddress.has(entry.address)) {
      byAddress.set(entry.address, entry)
    }
  }

  for (const entry of entries) {
    if (entry.appliesTo.length > 0 && !entry.isButton) {
      errors.push(error('S1', entry.address, 'appliesTo requires a button entry'))
    }
    if (entry.appliesTo.length > 0 && entry.staged) {
      errors.push(error('S2', entry.address, 'an apply trigger cannot be staged'))
    }
    for (const pattern of [...entry.appliesTo, ...entry.expandsTo]) {
      if (!isValidAddressShape(pattern)) {
        errors.push(error('S3', entry.address, `invalid OSC address pattern: ${pattern}`))
      }
    }
    if (entry.staged && entry.type === 'b') {
      errors.push(error('S8', entry.address, 'blob entries cannot be staged'))
    }
  }

  for (const trigger of entries.filter((entry) => entry.appliesTo.length > 0)) {
    const resolved = entries.filter((entry) =>
      trigger.appliesTo.some((pattern) => matchesPattern(pattern, entry.address)),
    )
    if (!resolved.some((entry) => entry.staged)) {
      errors.push(error('S4', trigger.address, 'appliesTo resolves to no staged entry'))
    }
  }

  for (const source of entries.filter((entry) => entry.expandsTo.length > 0)) {
    const resolved = entries.filter((entry) =>
      source.expandsTo.some((pattern) => matchesPattern(pattern, entry.address)),
    )
    if (resolved.length === 0) {
      errors.push(error('S5', source.address, 'expandsTo resolves to no declared address'))
      continue
    }
    for (const target of resolved) {
      if (target.type !== source.type) {
        errors.push(error('S6', source.address, `expansion target has incompatible type: ${target.address}`))
      }
    }
    if (!resolved.some((target) => target.address !== source.address)) {
      errors.push(error('S7', source.address, 'expandsTo has no address other than the source'))
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  const compiled = new Map<string, CompiledEntry>()
  for (const entry of entries) {
    if (!compiled.has(entry.address)) {
      compiled.set(entry.address, {
        declaration: entry,
        appliesTo: resolvePatterns(entry.appliesTo, entries),
        // 展開先から展開元自身を除く。含めると展開元へ verbatim エコーと展開エコーが二重に出る
        expandsTo: resolvePatterns(entry.expandsTo, entries).filter((target) => target !== entry.address),
      })
    }
  }
  return { ok: true, plan: new StagingPlan(compiled, hasStagingDeclarations) }
}

export function toJsonLiteral(value: StagingValue): string {
  switch (value.kind) {
    case 'i':
      return String(value.value)
    case 'f':
      return formatNumber(value.value)
    case 's':
      return JSON.stringify(value.value)
  }
}

function resolvePatterns(
  patterns: readonly string[],
  entries: readonly StagingEntryDeclaration[],
): readonly string[] {
  return entries
    .filter((entry) => patterns.some((pattern) => matchesPattern(pattern, entry.address)))
    .map((entry) => entry.address)
}

/** S3 の形検証。パターンとアドレスの双方に同じ規則を適用する(C# の TrySplitAddress と同一) */
function isValidAddressShape(pattern: string): boolean {
  return (
    pattern.startsWith('/') &&
    pattern.length > 1 &&
    !pattern.endsWith('/') &&
    !pattern.includes('//') &&
    !pattern.split('/').slice(1).some((part) => part.length === 0) &&
    ![...pattern].some((character) => '?[]{},'.includes(character))
  )
}

function partPatternMatches(pattern: string, value: string): boolean {
  const expression = [...pattern].map((character) => (character === '*' ? '.*' : escapeRegExp(character))).join('')
  return new RegExp(`^${expression}$`, 'u').test(value)
}

function escapeRegExp(character: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(character) ? `\\${character}` : character
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return 'null'
  }
  return String(value)
}

function error(
  code: StagingCompileError['code'],
  address: string,
  message: string,
): StagingCompileError {
  return { code, address, message }
}
