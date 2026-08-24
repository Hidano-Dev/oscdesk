export type StagingValue =
  | { readonly kind: 'i'; readonly value: number }
  | { readonly kind: 'f'; readonly value: number }
  | { readonly kind: 's'; readonly value: string }

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
      if (!isValidPattern(pattern)) {
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
        expandsTo: resolvePatterns(entry.expandsTo, entries),
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

function isValidPattern(pattern: string): boolean {
  return (
    pattern.startsWith('/') &&
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
