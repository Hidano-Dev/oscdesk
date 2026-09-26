/**
 * Validates and matches the OSC address-pattern subset shared by the
 * manifest schema and the Unity staging implementation.
 */
export function isValidAddressShape(address: string): boolean {
  return (
    address.startsWith('/') &&
    address.length > 1 &&
    !address.endsWith('/') &&
    !address.includes('//') &&
    !address.split('/').slice(1).some((part) => part.length === 0) &&
    ![...address].some((character) => '?[]{},'.includes(character))
  )
}

/** `*` matches zero or more characters within one OSC address part. */
export function matchesPattern(pattern: string, address: string): boolean {
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

/** Returns true when at least one pattern matches the address. */
export function matchesAnyPattern(patterns: readonly string[], address: string): boolean {
  return patterns.some((pattern) => matchesPattern(pattern, address))
}

function partPatternMatches(pattern: string, value: string): boolean {
  const expression = [...pattern].map((character) => (character === '*' ? '.*' : escapeRegExp(character))).join('')
  return new RegExp(`^${expression}$`, 'u').test(value)
}

function escapeRegExp(character: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(character) ? `\\${character}` : character
}
