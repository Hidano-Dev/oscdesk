import { isInternalAddress, type UpstreamFrame } from '@oscdesk/shared'

import type { Core } from './context'
import { toOscArgs } from './osc-args'
import type { ClientId } from './types'

// UI からの上りの生の OSC(osc.message・osc.batch。D-050・HID-378)。パッドの操作は pad-manager が受ける。
// サーフェス定義の set・setRow・batch・一覧の要求と反映・行の増減・resend は撤去した(D-175)。

export interface UiFramesPart {
  handleUiFrame(frame: UpstreamFrame, clientId: ClientId): void
}

export function uiFramesPart(core: Core): UiFramesPart {
  const { deps, logWarn } = core

  const handleUiFrame = (frame: UpstreamFrame, clientId: ClientId) => {
    if (frame.type === 'osc.batch') {
      // /sys/* も /oscdesk/* も UI からは送らせない(内部予約アドレス。ブリッジ自身の /sys/* の送信は sendMessage を通る)
      const internalAddress = frame.messages.find(message => isInternalAddress(message.address))?.address
      if (internalAddress !== undefined) {
        core.rejectBatch(clientId, `internal-address: ${internalAddress}`)
        return
      }
      core.sendBatch(frame.messages.map(message => ({ address: message.address, args: toOscArgs(message.args) })), clientId, frame.holder)
      return
    }
    if (frame.type !== 'osc.message') return
    if (isInternalAddress(frame.address)) {
      if (!core.warnedInternalAddresses.has(frame.address)) {
        core.warnedInternalAddresses.add(frame.address)
        logWarn('(WARN, BRIDGE)', `Blocked UI frame to internal address "${frame.address}".`)
      }
      return
    }
    const args = toOscArgs(frame.args)
    // パッドの部品・行と同じアドレスへの送信もロックを見る(HID-378・D-169)
    const locked = core.lockRejection(core.lockRefsOf(frame.address, args), clientId, frame.holder)
    if (locked !== null) {
      deps.publish({ v: 1, type: 'notice', level: 'error', code: 'locked', detail: locked }, clientId)
      return
    }
    core.sendToAllTargets('ui', frame.address, ...args)
  }

  return { handleUiFrame }
}
