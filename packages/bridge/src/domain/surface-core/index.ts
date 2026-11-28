import { resolveUnityTargets } from '@oscdesk/shared'

import { createDeliveryTracker } from '../delivery-tracker'
import { OscUiRouter } from '../osc-ui-router'
import { PING_INTERVAL_MS, type Core, type CoreEnv, type CoreState } from './context'
import { inboundPart } from './inbound'
import { locksPart } from './locks'
import { outboundPart } from './outbound'
import { newRuntimeTarget, targetsPart } from './targets'
import { uiFramesPart } from './ui-frames'
import type { SurfaceCore, SurfaceCoreDeps, UnityRuntimeTarget } from './types'

// ターゲットとのやり取りの中心(D-045・D-046・D-078)。宛先・死活監視・送受信をまとめる。
// パッドの保持値と同期(D-169)は pad-manager が持ち、ここは送り先と送信・起動 ID とエコーの受け渡しだけを受け持つ。
// サーフェス定義と、その保持値・再送・一覧・設計図は撤去した(D-172)。
// 責務ごとのファイルに分けてあり(D-134)、ここは文脈を組み立てて公開の SurfaceCore を返すだけ。

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
  })
  const uiRouter = deps.config.oscUi.enabled
    ? new OscUiRouter({
        unity: { host: deps.config.unity.host, port: deps.config.unity.sendPort },
        unityAddresses: deps.unityAddresses,
        config: deps.config.oscUi,
      })
    : null
  const env: CoreEnv = {
    deps,
    now,
    setIntervalFn: deps.setIntervalFn ?? setInterval,
    clearIntervalFn: deps.clearIntervalFn ?? clearInterval,
    setTimeoutFn: deps.setTimeoutFn ?? setTimeout,
    logInfo: deps.logInfo ?? console.info,
    logWarn: deps.logWarn ?? console.warn,
    logError: deps.logError ?? console.error,
    delivery,
    uiRouter,
    warnedInternalAddresses: new Set<string>(),
    warnedNonUnitySources: new Set<string>(),
    warnedNoBootId: new Set<string>(),
  }
  const state: CoreState = {
    targets,
    pingSeq: 1,
    timer: null,
    stopped: false,
    lastLinkPublishedAt: -Infinity,
    diagnostics: null,
  }
  Object.assign(core, env, state)
  Object.assign(core, targetsPart(core))
  Object.assign(core, outboundPart(core))
  Object.assign(core, locksPart(core))
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
    setTargets: core.setTargets,
    currentTargets: core.currentTargets,
    primaryHosts: core.primaryHosts,
    firePad: core.firePad,
    syncTargets: core.syncTargets,
    answeringSyncTarget: core.answeringSyncTarget,
    sendSync: core.sendSync,
    lockRefsOf: core.lockRefsOf,
  }
}
