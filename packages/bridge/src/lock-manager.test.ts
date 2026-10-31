import { describe, expect, it, vi } from 'vitest'

import type { DownstreamFrame } from '@oscdesk/shared'

import { createLockManager } from './lock-manager'

function makeLocks() {
  let time = 0
  let sweep: (() => void) | undefined
  const publish = vi.fn<(frame: DownstreamFrame, target?: string) => void>()
  const locks = createLockManager({
    publish,
    now: () => time,
    setIntervalFn: callback => { sweep = callback; return 1 },
    clearIntervalFn: () => {},
  })
  return {
    locks,
    publish,
    advance(ms: number) { time += ms; sweep?.() },
    lockFrames: () => publish.mock.calls.flatMap(([frame, target]) => frame.type === 'locks' && target === undefined ? [frame.locks] : []),
    notices: () => publish.mock.calls.flatMap(([frame, target]) => frame.type === 'notice' ? [[frame.code, frame.detail, target]] : []),
  }
}

const lock = (param: string, holder: string, label = holder) => ({ v: 1 as const, type: 'lock' as const, ref: { param }, holder, label })

describe('createLockManager', () => {
  it('grants a free control, renews it for the same holder and rejects others', () => {
    const { locks, lockFrames, notices } = makeLocks()

    expect(locks.handleUiFrame(lock('level', 'page-a', '192.168.1.10'), 'ui-1')).toBe(true)
    expect(lockFrames()).toEqual([[{ ref: { param: 'level' }, clientId: 'ui-1', holder: 'page-a', label: '192.168.1.10' }]])

    // 同じ持ち主の延長は全量を配り直さない
    locks.handleUiFrame(lock('level', 'page-a', '192.168.1.10'), 'ui-1')
    expect(lockFrames()).toHaveLength(1)

    // 同じ接続(UI のプロセス)でも別のページはほかの持ち主
    locks.handleUiFrame(lock('level', 'page-b'), 'ui-1')
    expect(notices()).toEqual([['lock-rejected', 'held: 192.168.1.10', 'ui-1']])
    expect(locks.blockingOwner([{ param: 'level' }], 'ui-1', 'page-b')?.label).toBe('192.168.1.10')
    expect(locks.blockingOwner([{ param: 'level' }], 'ui-1', 'page-a')).toBeNull()
    // holder の無い変更はロック中の部品に通さない
    expect(locks.blockingOwner([{ param: 'level' }], 'ui-1', undefined)).not.toBeNull()
    expect(locks.blockingOwner([{ param: 'other' }], 'ui-2', undefined)).toBeNull()
  })

  it('expires a lease that is not renewed within the lease time, and keeps one that is', () => {
    const { locks, advance, lockFrames } = makeLocks()
    locks.handleUiFrame(lock('level', 'page-a'), 'ui-1')

    advance(1_500)
    locks.handleUiFrame(lock('level', 'page-a'), 'ui-1')
    advance(1_500)
    expect(locks.blockingOwner([{ param: 'level' }], 'ui-2', 'x')).not.toBeNull()

    advance(600)
    expect(locks.blockingOwner([{ param: 'level' }], 'ui-2', 'x')).toBeNull()
    expect(lockFrames().at(-1)).toEqual([])
  })

  it('releases on unlock by the owner only and on disconnect of the connection', () => {
    const { locks, lockFrames } = makeLocks()
    locks.handleUiFrame(lock('level', 'page-a'), 'ui-1')
    locks.handleUiFrame({ v: 1, type: 'lock', ref: { record: 'member', key: 'row-1' }, holder: 'page-a', label: 'a' }, 'ui-1')

    locks.handleUiFrame({ v: 1, type: 'unlock', ref: { param: 'level' }, holder: 'page-b' }, 'ui-1')
    expect(locks.blockingOwner([{ param: 'level' }], 'ui-2', 'x')).not.toBeNull()
    locks.handleUiFrame({ v: 1, type: 'unlock', ref: { param: 'level' }, holder: 'page-a' }, 'ui-1')
    expect(locks.blockingOwner([{ param: 'level' }], 'ui-2', 'x')).toBeNull()

    // Record は行が単位(ほかの行は空いている)
    expect(locks.blockingOwner([{ record: 'member', key: 'row-2' }], 'ui-2', 'x')).toBeNull()
    expect(locks.blockingOwner([{ record: 'member', key: 'row-1' }], 'ui-2', 'x')).not.toBeNull()
    locks.releaseConnection('ui-1')
    expect(locks.blockingOwner([{ record: 'member', key: 'row-1' }], 'ui-2', 'x')).toBeNull()
    expect(lockFrames().at(-1)).toEqual([])
  })

  it('sends the current locks to a newly connected UI and ignores other frames', () => {
    const { locks, publish } = makeLocks()
    locks.handleUiFrame(lock('level', 'page-a'), 'ui-1')
    publish.mockClear()

    locks.publish('ui-2')
    expect(publish).toHaveBeenCalledWith({ v: 1, type: 'locks', locks: [expect.objectContaining({ ref: { param: 'level' } })] }, 'ui-2')
    expect(locks.handleUiFrame({ v: 1, type: 'surfaceRequest' }, 'ui-2')).toBe(false)
  })
})
