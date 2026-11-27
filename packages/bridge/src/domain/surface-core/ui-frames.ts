import { isInternalAddress, type OscArg, type UpstreamFrame } from '@oscdesk/shared'

import type { Core } from './context'
import { parameterArgs, toOscArgs } from './osc-args'
import type { ClientId } from './types'

// UI からの上りのフレーム(D-050・D-053・D-075・D-090・HID-373・HID-378・HID-385・HID-389)。

export interface UiFramesPart {
  handleUiFrame(frame: UpstreamFrame, clientId: ClientId): void
}

export function uiFramesPart(core: Core): UiFramesPart {
  const { deps, logInfo, logWarn, desired, runtimeOptions } = core

  const handleUiFrame = (frame: UpstreamFrame, clientId: ClientId) => {
    if (frame.type === 'heartbeatAck') return
    if (frame.type === 'runtimeOptionsRefresh') {
      // 取り込んだプロジェクトの値をまだ送っていない間(D-090)は、利用者の「一覧を更新」でも要求を送らない
      // (要求のアドレスは取り込んだ定義が決めたもので、利用者はそれが何を撃つかを確かめていない)
      if (core.unsentSince !== null) {
        deps.publish(
          { v: 1, type: 'notice', level: 'error', code: 'runtime-options-refresh-rejected', detail: 'unsent-project' },
          clientId,
        )
        return
      }
      // 到達不能の台にも送る(UDP なので害はなく、戻った台は回復時の要求でも追いつく)
      if (frame.list === undefined) {
        core.requestRuntimeOptions('requested by UI', runtimeOptions.requestAddresses(), core.targets)
        return
      }
      // 一覧の近くの Sync(D-077)。定義が宣言した一覧の要求だけを送る。任意のアドレスへ引数なしの OSC を撒く口にしない。
      // 一覧は id で届き、どこへ要求を送るかは結び付けが決める(HID-389)
      const request = core.listsById.get(frame.list)?.request
      if (request === undefined || !runtimeOptions.isRequestAddress(request)) {
        deps.publish(
          { v: 1, type: 'notice', level: 'error', code: 'runtime-options-refresh-rejected', detail: `unknown-request: ${frame.list}` },
          clientId,
        )
        return
      }
      core.requestRuntimeOptions(`sync requested by UI: ${request}`, [request], core.targets)
      return
    }
    if (frame.type === 'runtimeOptionsApply') {
      const address = frame.list === undefined ? undefined : core.listsById.get(frame.list)?.address
      const result = frame.list !== undefined && address === undefined ? 'unknown' : runtimeOptions.apply(address)
      if (result === 'unknown') {
        deps.publish(
          { v: 1, type: 'notice', level: 'error', code: 'runtime-options-apply-rejected', detail: `unknown-list: ${String(frame.list)}` },
          clientId,
        )
        return
      }
      if (result === 'applied') {
        logInfo('(INFO, BRIDGE)', `Applied held option list(s)${frame.list === undefined ? '' : ` "${frame.list}"`} by UI request.`)
        // 新しいキーの行は反映したときに作って送る(D-062 の「現れたら作る」を「反映したら作る」に変える。D-088)
        core.publishRuntimeOptions()
        core.addRecordRows(desired.addKeys(runtimeOptions.recordKeys()))
      }
      return
    }
    if (frame.type === 'recordKeyAdd') {
      core.addRecordKey(frame.record, frame.key, clientId)
      return
    }
    if (frame.type === 'recordKeyRemove') {
      core.removeRecordKey(frame.record, frame.key, clientId)
      return
    }
    if (frame.type === 'recordKeyRename') {
      core.renameRecordKey(frame.record, frame.key, frame.name, clientId)
      return
    }
    if (frame.type === 'resend') {
      const only = frame.target === undefined ? core.targets : core.targets.filter(target => target.name === frame.target)
      if (only.length === 0) {
        deps.publish({ v: 1, type: 'notice', level: 'error', code: 'resend-rejected', detail: `unknown-target: ${String(frame.target)}` }, clientId)
        return
      }
      core.resendDesired('requested by UI', undefined, only)
      // 全宛先への再送で、取り込んだプロジェクトの値(D-090)が全台へ届いたことになる。宛先を絞った再送では
      // 他の台にはまだ届いていないので、印は残す
      if (frame.target === undefined && core.unsentSince !== null) {
        logInfo('(INFO, BRIDGE)', 'Imported project values were sent to every Unity target; automatic resends are enabled again.')
        core.unsentSince = null
        core.persistDesired()
        core.publishDesiredStatus()
        // 止めていた一覧の要求も、送ると決めたこの時点で全宛先へ送る(以後は従来どおりの契機で送る)
        core.requestRuntimeOptions('imported project sent', runtimeOptions.requestAddresses(), core.targets)
      }
      return
    }
    // /sys/* も /oscdesk/* も UI からは送らせない(内部予約アドレス。/sys/* の
    // ブリッジ自身の送信は sendMessage を通るため、ここでだけ広く弾く)
    if (frame.type === 'set') {
      // パラメータ ID と JSON の値(HID-373)。アドレスと型への直し方はここで定義から決める
      const parameter = core.definedParameters.get(frame.param)
      const reject = (detail: string) => deps.publish({ v: 1, type: 'notice', level: 'error', code: 'set-rejected', detail }, clientId)
      if (parameter === undefined) {
        reject(`unknown-param: ${frame.param}`)
        return
      }
      // 単独で送らないパラメータ(HID-166)は、まとめ送りの一部としてだけ送る
      if (parameter.standalone === false) {
        reject(`not-standalone: ${frame.param}`)
        return
      }
      const converted = parameterArgs(parameter, frame.value)
      if (!converted.ok) {
        reject(converted.reason)
        return
      }
      // ほかのブラウザが操作中の部品は、持ち主以外からの変更を通さない(HID-378。UI の表示だけに頼らない)
      const locked = core.lockRejection([{ param: parameter.id }, ...(deps.padLockRefs?.(parameter.address) ?? [])], clientId, frame.holder)
      if (locked !== null) {
        reject(locked)
        return
      }
      core.sendToAllTargets('ui', parameter.address, ...converted.args)
      core.recordDesired([{ address: parameter.address, args: converted.args }])
      return
    }
    if (frame.type === 'osc.batch') {
      const internalAddress = frame.messages.find(message => isInternalAddress(message.address))?.address
      if (internalAddress !== undefined) {
        core.rejectBatch(clientId, `internal-address: ${internalAddress}`)
        return
      }
      const listAddress = frame.messages.find(message => runtimeOptions.isListAddress(message.address))?.address
      if (listAddress !== undefined) {
        core.rejectBatch(clientId, `option-list-address: ${listAddress}`)
        return
      }
      core.sendBatch(frame.messages.map(message => ({
        address: message.address,
        args: core.withCurrentRowName(message.address, core.definitionArgs(message.address, toOscArgs(message.args))),
      })), clientId, frame.holder)
      return
    }
    if (frame.type === 'batch') {
      // まとめ送り(D-050)の共通のフレーム(HID-389)。UI が展開した中身をパラメータ id・行で受け、OSC に直して 1 つの
      // bundle で送る。1 件でも直せなければまとめごと断る(一部だけ送ると Unity が半端な組み合わせを受ける)
      const messages: { address: string; args: OscArg[] }[] = []
      for (const item of frame.items) {
        if ('param' in item) {
          const parameter = core.definedParameters.get(item.param)
          if (parameter === undefined) return core.rejectBatch(clientId, `unknown-param: ${item.param}`, frame.requestId)
          const converted = parameterArgs(parameter, item.value)
          if (!converted.ok) return core.rejectBatch(clientId, converted.reason, frame.requestId)
          messages.push({ address: parameter.address, args: converted.args })
        } else {
          const row = core.rowMessage(item.record, item.key, item.values)
          if (!row.ok) return core.rejectBatch(clientId, row.reason, frame.requestId)
          messages.push(row.message)
        }
      }
      core.sendBatch(messages, clientId, frame.holder, frame.requestId)
      return
    }
    if (frame.type === 'setRow') {
      // Record の 1 行の値の変更(HID-389)。行のキー・フィールド id と JSON の値で受け、アドレスと型・Name は定義と一覧から決める
      const row = core.rowMessage(frame.record, frame.key, frame.values)
      if (!row.ok) {
        deps.publish({ v: 1, type: 'notice', level: 'error', code: 'row-rejected', detail: row.reason }, clientId)
        return
      }
      const { address, args } = row.message
      const lockedRow = core.lockRejection(core.lockRefsOf(address, args), clientId, frame.holder)
      if (lockedRow !== null) {
        deps.publish({ v: 1, type: 'notice', level: 'error', code: 'locked', detail: lockedRow }, clientId)
        return
      }
      core.sendToAllTargets('ui', address, ...args)
      core.recordDesired([{ address, args }])
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
    // 一覧のアドレスは Unity → OscDesk の向きだけ。UI から送るとそのエコーが全台の一覧を上書きする(D-055)
    if (runtimeOptions.isListAddress(frame.address)) {
      core.warnRuntimeOptionsOnce(`ui:${frame.address}`, `Blocked UI frame to option list address "${frame.address}".`)
      return
    }
    const args = core.withCurrentRowName(frame.address, core.definitionArgs(frame.address, toOscArgs(frame.args)))
    // Record の行(と、アドレスで直接送られた部品)もロックを見る(HID-378)
    const lockedRow = core.lockRejection(core.lockRefsOf(frame.address, args), clientId, frame.holder)
    if (lockedRow !== null) {
      deps.publish({ v: 1, type: 'notice', level: 'error', code: 'locked', detail: lockedRow }, clientId)
      return
    }
    core.sendToAllTargets('ui', frame.address, ...args)
    core.recordDesired([{ address: frame.address, args }])
  }

  return { handleUiFrame }
}
