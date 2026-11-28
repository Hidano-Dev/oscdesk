import type { LockRef, OscArg } from '@oscdesk/shared'

import { describeLockRef } from '../lock-manager'
import type { Core } from './context'
import type { ClientId } from './types'

// ロックの単位(HID-378)への引き方。ロックの単位はパッドの部品と表の行(D-169)だけで、アドレスで届く送信
// (osc.message・osc.batch)もパッドが持つアドレスならそのロックに当てる(生の OSC からパッドのロックを素通りさせない)。

export interface LocksPart {
  lockRefsOf(address: string, args: readonly OscArg[]): LockRef[]
  lockRejection(refs: readonly LockRef[], clientId: ClientId, holder: string | undefined): string | null
}

export function locksPart(core: Core): LocksPart {
  const { deps } = core

  const lockRefsOf = (address: string, _args: readonly OscArg[]): LockRef[] => [...(deps.padLockRefs?.(address) ?? [])]

  // ほかの持ち主がロックしていれば、断る理由(locked: <単位> by <持ち主>)
  const lockRejection = (refs: readonly LockRef[], clientId: ClientId, holder: string | undefined): string | null => {
    if (deps.lockedBy === undefined || refs.length === 0) return null
    for (const ref of refs) {
      const owner = deps.lockedBy([ref], clientId, holder)
      if (owner !== null) return `locked: ${describeLockRef(ref)} by ${owner}`
    }
    return null
  }

  return { lockRefsOf, lockRejection }
}
