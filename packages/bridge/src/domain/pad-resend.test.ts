import { describe, expect, it, vi } from 'vitest'

import type { DownstreamFrame } from '@oscdesk/shared'

import { createPadResendSettings, MAX_BOOT_IDS, type PadResendState } from './pad-resend'

function setup(initial: PadResendState | null = null) {
  const saved: PadResendState[] = []
  const publish = vi.fn<(frame: DownstreamFrame, target?: string) => void>()
  const settings = createPadResendSettings({ store: { load: () => initial, save: state => saved.push(state) }, publish, logInfo: vi.fn() })
  return { settings, saved, publish }
}

describe('pad resend settings (D-165・D-169)', () => {
  it('starts with automatic resend off', () => {
    const { settings, publish } = setup()
    expect(settings.isAuto()).toBe(false)
    settings.publish('c1')
    expect(publish).toHaveBeenCalledWith({ v: 1, type: 'osc.padResend', auto: false }, 'c1')
  })

  it('toggles from the UI, saves and tells every UI', () => {
    const { settings, saved, publish } = setup()
    expect(settings.handleUiFrame({ v: 1, type: 'osc.padResendSet', auto: true }, 'c1')).toBe(true)
    expect(settings.isAuto()).toBe(true)
    expect(saved.at(-1)).toEqual({ auto: true, boots: [] })
    expect(publish).toHaveBeenLastCalledWith({ v: 1, type: 'osc.padResend', auto: true })
    expect(settings.handleUiFrame({ v: 1, type: 'osc.padRequest' }, 'c1')).toBe(false)
  })

  it('treats a changed or never seen boot id as a start, and the same one as a recovery', () => {
    const { settings, saved } = setup({ auto: true, boots: [{ target: '10.0.0.1:9000', bootId: 'boot-1' }] })
    // ブリッジの再起動の前に見た起動 ID と同じなら起動ではない(動いていたターゲット)
    expect(settings.observeBoot('10.0.0.1:9000', 'boot-1')).toBe(false)
    expect(saved).toEqual([])
    expect(settings.observeBoot('10.0.0.1:9000', 'boot-2')).toBe(true)
    expect(settings.observeBoot('10.0.0.1:9000', 'boot-2')).toBe(false)
    expect(settings.observeBoot('10.0.0.2:9000', 'boot-9')).toBe(true)
    expect(saved.at(-1)).toEqual({ auto: true, boots: [{ target: '10.0.0.1:9000', bootId: 'boot-2' }, { target: '10.0.0.2:9000', bootId: 'boot-9' }] })
  })

  it('retries an unfinished startup sync once after a bridge restart, and forgets it once a sync ends (HID-499)', () => {
    const { settings, saved } = setup({
      auto: true,
      boots: [{ target: '10.0.0.1:9000', bootId: 'boot-1' }, { target: '10.0.0.2:9000', bootId: 'boot-2' }],
      // 起動 ID を覚えていない送り先の記録は読み捨てる
      unfinished: ['10.0.0.1:9000', '10.0.0.9:9000'],
    })
    expect(settings.observeBoot('10.0.0.2:9000', 'boot-2')).toBe(false)
    expect(settings.observeBoot('10.0.0.9:9000', 'boot-9')).toBe(true)
    expect(saved.at(-1)?.unfinished).toEqual(['10.0.0.1:9000'])
    // 同じ起動 ID のまま答えたが、前の起動で同期を送り終えていない: 一度だけ起動とみなす
    expect(settings.observeBoot('10.0.0.1:9000', 'boot-1')).toBe(true)
    settings.syncStarted('10.0.0.1:9000')
    // 同期の途中に届いた同じ起動 ID の pong では始め直さない
    expect(settings.observeBoot('10.0.0.1:9000', 'boot-1')).toBe(false)
    settings.syncFinished('10.0.0.1:9000')
    expect(saved.at(-1)).toEqual({ auto: true, boots: [{ target: '10.0.0.1:9000', bootId: 'boot-1' }, { target: '10.0.0.2:9000', bootId: 'boot-2' }, { target: '10.0.0.9:9000', bootId: 'boot-9' }] })
  })

  it('records a startup sync until it ends and drops the record when the target starts again', () => {
    const { settings, saved } = setup({ auto: true, boots: [] })
    expect(settings.observeBoot('10.0.0.1:9000', 'boot-1')).toBe(true)
    settings.syncStarted('10.0.0.1:9000')
    expect(saved.at(-1)?.unfinished).toEqual(['10.0.0.1:9000'])
    // 起動 ID を覚えていない送り先(手動の同期のブロードキャストの宛先など)は記録しない
    settings.syncStarted('10.0.0.255:9000')
    expect(saved.at(-1)?.unfinished).toEqual(['10.0.0.1:9000'])
    // 送り終える前にもう一度起動した: 前の起動の記録は外し、新しい同期が始めるときに記録し直す
    expect(settings.observeBoot('10.0.0.1:9000', 'boot-2')).toBe(true)
    expect(saved.at(-1)?.unfinished).toBeUndefined()
  })

  it('does not retry an unfinished startup sync when automatic resend was turned off before the restart', () => {
    const { settings, saved } = setup({ auto: false, boots: [{ target: '10.0.0.1:9000', bootId: 'boot-1' }], unfinished: ['10.0.0.1:9000'] })
    expect(settings.observeBoot('10.0.0.1:9000', 'boot-1')).toBe(false)
    expect(saved.at(-1)).toEqual({ auto: false, boots: [{ target: '10.0.0.1:9000', bootId: 'boot-1' }] })
  })

  it('ignores malformed boot ids and forgets the oldest targets beyond the limit', () => {
    const { settings, saved } = setup()
    expect(settings.observeBoot('h:1', '')).toBe(false)
    expect(settings.observeBoot('h:1', 'with space')).toBe(false)
    expect(settings.observeBoot('h:1', 'x'.repeat(65))).toBe(false)
    for (let index = 0; index <= MAX_BOOT_IDS; index += 1) settings.observeBoot(`h:${String(index)}`, 'b')
    const last = saved.at(-1)!
    expect(last.boots).toHaveLength(MAX_BOOT_IDS)
    expect(last.boots[0]?.target).toBe('h:1')
  })
})
