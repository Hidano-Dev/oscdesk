import { randomUUID } from 'node:crypto'

import { resolveUnityTargets } from '@oscdesk/shared'

import { createDeliveryTracker } from '../delivery-tracker'
import { createDesiredValues } from '../desired-values'
import { OscUiRouter } from '../osc-ui-router'
import { createRuntimeOptions } from '../runtime-options'
import { adoptionPart } from './adoption'
import { PING_INTERVAL_MS, type Core, type CoreEnv, type CoreState } from './context'
import { desiredPart } from './desired'
import { inboundPart } from './inbound'
import { outboundPart } from './outbound'
import { recordsPart } from './records'
import { newRuntimeTarget, targetsPart } from './targets'
import { uiFramesPart } from './ui-frames'
import type { SurfaceCore, SurfaceCoreDeps, UnityRuntimeTarget } from './types'
import { vocabularyPart } from './vocabulary'

// 定義と保持値の正(D-043〜D-046)。宛先・死活監視・送受信・保持値と再送・一覧をまとめる。
// パッドの保持値と同期(D-169)は pad-manager が持ち、ここは送り先と送信・起動 ID とエコーの受け渡しだけを受け持つ。
// 責務ごとのファイルに分けてあり(D-134)、ここは文脈を組み立てて公開の SurfaceCore を返すだけ。

export { parameterArgs } from './osc-args'
export type {
  BridgeConfig,
  BroadcastNetwork,
  BundleSendResult,
  ClientId,
  InboundOscMessage,
  RuntimeTargetSpec,
  SurfaceCore,
  SurfaceCoreDeps,
  SyncTarget,
} from './types'

export function createSurfaceCore(deps: SurfaceCoreDeps): SurfaceCore {
  const now = deps.now ?? Date.now
  const targets: UnityRuntimeTarget[] = resolveUnityTargets(deps.config.unity).map(target => newRuntimeTarget({
    ...target,
    addresses: (target.primary ? deps.unityAddresses : deps.secondaryAddresses?.[target.name]) ?? [],
  }))
  // 部品は文脈より先に作る。文脈の欄は部品の関数が呼ばれた時点で引く(組み立ての順序に縛られない)
  const core = {} as Core
  const delivery = createDeliveryTracker({
    publish: frame => deps.publish(frame),
    now: () => now(),
    paramOf: address => core.parameterIdsByAddress.get(address) ?? null,
  })
  const uiRouter = deps.config.oscUi.enabled
    ? new OscUiRouter({
        unity: { host: deps.config.unity.host, port: deps.config.unity.sendPort },
        unityAddresses: deps.unityAddresses,
        config: deps.config.oscUi,
      })
    : null
  const newRowId = deps.newRowId ?? randomUUID
  const desired = createDesiredValues((record, key) => runtimeOptions.uiRowName(record.keysFrom.address, key))
  const targetNames: string[] = targets.map(target => target.name)
  const runtimeOptions = createRuntimeOptions(targetNames, newRowId)
  const env: CoreEnv = {
    deps,
    now,
    setIntervalFn: deps.setIntervalFn ?? setInterval,
    clearIntervalFn: deps.clearIntervalFn ?? clearInterval,
    setTimeoutFn: deps.setTimeoutFn ?? setTimeout,
    logInfo: deps.logInfo ?? console.info,
    logWarn: deps.logWarn ?? console.warn,
    logError: deps.logError ?? console.error,
    newRowId,
    delivery,
    uiRouter,
    desired,
    targetNames,
    runtimeOptions,
    warnedInternalAddresses: new Set<string>(),
    warnedNonUnitySources: new Set<string>(),
    warnedEchoMismatch: new Set<string>(),
    warnedRuntimeOptions: new Set<string>(),
    lastOperatedAt: new Map<string, number>(),
    warnedNoBootId: new Set<string>(),
  }
  const state: CoreState = {
    targets,
    pingSeq: 1,
    timer: null,
    stopped: false,
    hasDefinition: false,
    activeName: undefined,
    definedRecords: [],
    definedParameters: new Map(),
    parameterIdsByAddress: new Map(),
    recordIdsByAddress: new Map(),
    parametersByAddress: new Map(),
    recordsByAddress: new Map(),
    recordsById: new Map(),
    listIdsByAddress: new Map(),
    listsById: new Map(),
    lastLinkPublishedAt: -Infinity,
    unsentSince: null,
    diagnostics: null,
  }
  Object.assign(core, env, state)
  Object.assign(core, targetsPart(core))
  Object.assign(core, outboundPart(core))
  Object.assign(core, vocabularyPart(core))
  Object.assign(core, desiredPart(core))
  Object.assign(core, recordsPart(core))
  Object.assign(core, adoptionPart(core))
  Object.assign(core, inboundPart(core))
  Object.assign(core, uiFramesPart(core))
  const { setIntervalFn, clearIntervalFn } = env

  return {
    start() {
      if (core.timer !== null) return
      core.diagnostics = deps.config.debug
        ? deps.createDiagnosticsEngine?.({ config: deps.config, getStatus: () => core.unityStatus(), now }) ?? null
        : null
      core.stopped = false
      core.timer = setIntervalFn(core.tick, PING_INTERVAL_MS)
    },
    stop() {
      if (core.timer === null) {
        core.stopped = true
        return
      }
      clearIntervalFn(core.timer)
      core.timer = null
      core.diagnostics?.dispose()
      core.diagnostics = null
      core.stopped = true
    },
    handleUndelivered: core.handleUndelivered,
    handleOscIn: core.handleOscIn,
    handleUiFrame: core.handleUiFrame,
    onUiConnected(clientId, peer) {
      deps.publish(core.buildHelloFrame(clientId, peer), clientId)
      core.publishLink(clientId, true)
    },
    onUiDisconnected(_clientId) {},
    linkSnapshot: core.linkSnapshot,
    helloFrame: core.buildHelloFrame,
    setDefinition: core.setDefinition,
    exportDesired: core.heldValues,
    publishDesiredStatus: clientId => core.publishDesiredStatus(clientId),
    publishDesired: core.publishDesiredFull,
    publishRuntimeOptions: clientId => core.publishRuntimeOptions(clientId),
    setTargets: core.setTargets,
    currentTargets: core.currentTargets,
    primaryHosts: core.primaryHosts,
    requestCatalog: core.requestCatalog,
    onTargetStarted: core.onTargetStarted,
    upSinceOfSource: core.upSinceOfSource,
    isLockableRef: core.isLockableRef,
    firePad: core.firePad,
    syncTargets: core.syncTargets,
    sendSync: core.sendSync,
  }
}
