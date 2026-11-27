import { describe, expect, it } from 'vitest'

import { NETWORK_SETTINGS } from '@oscdesk/shared'

import { buildSettings, describeRejection, inputsOf, interfaceOptions, splitEntries, withBrowser, type NetworkSettingsFrame } from './network-logic'
import { wireSample } from './test-support'

const sample = wireSample('downstream-network-settings') as NetworkSettingsFrame

describe('network logic (D-153)', () => {
  it('turns the bridge settings into the input fields and back', () => {
    const inputs = inputsOf(sample)
    expect(inputs).toEqual({ targetInterface: '192.168.1.10', targetRanges: '192.168.1.0/24', allowedBrowsers: '192.168.1.0/24\n10.0.0.5/32' })
    expect(buildSettings(inputs)).toEqual({ ok: true, targetInterface: '192.168.1.10', targetRanges: ['192.168.1.0/24'], allowedBrowsers: ['192.168.1.0/24', '10.0.0.5/32'] })
    expect(buildSettings({ ...inputs, targetInterface: '' })).toMatchObject({ ok: true, targetInterface: null })
  })

  it('splits entries on newlines, commas and spaces, dropping blanks and repeats', () => {
    expect(splitEntries(' 10.0.0.0/8,10.0.0.0/8\n\n 192.168.1.30  ::1 ')).toEqual(['10.0.0.0/8', '192.168.1.30', '::1'])
    expect(withBrowser('10.0.0.0/8', '192.168.1.30')).toBe('10.0.0.0/8\n192.168.1.30')
    expect(withBrowser('192.168.1.30', '192.168.1.30')).toBe('192.168.1.30')
  })

  it('refuses more entries than the protocol allows before sending (the bridge checks the CIDR itself)', () => {
    const many = Array.from({ length: NETWORK_SETTINGS.MAX_ALLOWED_BROWSERS + 1 }, (_, index) => `10.0.0.${String(index)}`).join('\n')
    expect(buildSettings({ targetInterface: '', targetRanges: '', allowedBrowsers: many })).toMatchObject({ ok: false })
    expect(buildSettings({ targetInterface: '', targetRanges: 'x'.repeat(NETWORK_SETTINGS.MAX_CIDR_CHARS + 1), allowedBrowsers: '' })).toMatchObject({ ok: false })
    // 読めない CIDR はブリッジに断らせる(写しの判定を持たない)
    expect(buildSettings({ targetInterface: '', targetRanges: 'nope', allowedBrowsers: '' })).toMatchObject({ ok: true, targetRanges: ['nope'] })
  })

  it('keeps the current and typed interfaces selectable even when the NIC is gone', () => {
    const options = interfaceOptions({ ...sample, interfaces: [{ address: '127.0.0.1', name: 'localhost' }] }, { ...inputsOf(sample), targetInterface: '172.16.0.9' })
    expect(options.map((option) => option.value)).toEqual(['', '127.0.0.1', '192.168.1.10', '172.16.0.9'])
  })

  it('describes the reasons the bridge gives for a refusal', () => {
    expect(describeRejection('would-lock-out: 192.168.1.30')).toContain('192.168.1.30')
    expect(describeRejection('stale-revision: 0 (current 1)')).toContain('ほかのブラウザが先に')
    expect(describeRejection('something-new')).toBe('something-new')
  })
})
