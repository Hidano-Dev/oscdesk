import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { isValidAddressShape, matchesAnyPattern, matchesPattern } from './address-pattern'

interface AddressPatternCase {
  readonly id: string
  readonly pattern: string
  readonly address: string
  readonly matches: boolean
}

const fixture = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../protocol/address-pattern-cases.json'), 'utf8'),
) as { version: number; cases: AddressPatternCase[] }

describe('address pattern contract cases', () => {
  it('matches every shared case', () => {
    expect(fixture.version).toBe(1)
    for (const testCase of fixture.cases) {
      expect(matchesPattern(testCase.pattern, testCase.address), testCase.id).toBe(testCase.matches)
    }
  })

  it('accepts any matching pattern in a pattern list', () => {
    expect(matchesAnyPattern(['/other/*', '/member/*/*'], '/member/01/name')).toBe(true)
    expect(matchesAnyPattern(['/other/*', '/member/*'], '/member/01/name')).toBe(false)
  })

  it('validates arbitrary strings without throwing', () => {
    expect(isValidAddressShape('')).toBe(false)
    expect(isValidAddressShape('/member/01/name')).toBe(true)
  })
})
