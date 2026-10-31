import type { CatalogItem, DownstreamFrame, SurfaceDefinition, UpstreamFrame } from '@oscdesk/shared'

import { absentParameters, blueprintSurfaceName, buildBlueprintSurface } from './blueprint-surface'
import type { ClientId } from './surface-core'

// 設計図と画面の橋渡し(HID-386・D-112)。設計図(PC ごと)から既定の画面を作って採用し、採用中の画面がその PC の
// 設計図に無いパラメータを持てば UI へ知らせる。設計図は catalog-manager、画面の保存と採用は surface-manager が持つ

export interface BlueprintManagerDeps {
  pcs: () => readonly { host: string; name: string; items: readonly CatalogItem[] }[]
  active: () => { name: string; definition: SurfaceDefinition } | null
  adoptBlueprint: (name: string, generated: SurfaceDefinition) => { ok: true; saved: boolean } | { ok: false; detail: string }
  publish: (frame: DownstreamFrame, target?: ClientId) => void
  logInfo?: (...args: unknown[]) => void
}

export interface BlueprintManager {
  handleUiFrame(frame: UpstreamFrame, clientId: ClientId): boolean
  /** 設計図か採用中の画面が変わったら呼ぶ。突き合わせの結果が変わったときだけ全 UI へ配る。 */
  refresh(): void
  publish(clientId: ClientId): void
}

export function createBlueprintManager(deps: BlueprintManagerDeps): BlueprintManager {
  const logInfo = deps.logInfo ?? console.info
  let last = ''

  const status = (): DownstreamFrame => {
    const active = deps.active()
    // 画面の名前から PC を引く(作った画面を保存して並べ替えた後も、同じ名前のまま突き合わせ続けるため)
    const pc = active === null ? undefined : deps.pcs().find(candidate => blueprintSurfaceName(candidate.name) === active.name)
    if (active === null || pc === undefined) return { v: 1, type: 'blueprintStatus', pc: null, absent: [] }
    return { v: 1, type: 'blueprintStatus', pc: { host: pc.host, name: pc.name }, absent: absentParameters(active.definition, pc.items) }
  }

  return {
    handleUiFrame(frame, clientId) {
      if (frame.type !== 'catalogAdopt') return false
      const pc = deps.pcs().find(candidate => candidate.host === frame.host)
      if (pc === undefined) {
        deps.publish({ v: 1, type: 'notice', level: 'error', code: 'catalog-adopt-rejected', detail: `unknown-pc: ${frame.host}` }, clientId)
        return true
      }
      const name = blueprintSurfaceName(pc.name)
      const result = deps.adoptBlueprint(name, buildBlueprintSurface(pc.name, pc.items))
      if (!result.ok) {
        deps.publish({ v: 1, type: 'notice', level: 'error', code: 'catalog-adopt-rejected', detail: result.detail }, clientId)
        return true
      }
      logInfo('(INFO, BRIDGE)', `Adopted ${result.saved ? 'the saved' : 'a new'} screen "${name}" for the blueprint of "${pc.name}" (${pc.host}).`)
      deps.publish({ v: 1, type: 'notice', level: 'info', code: 'catalog-adopted', detail: name }, clientId)
      return true
    },
    refresh() {
      const frame = status()
      const key = JSON.stringify(frame)
      if (key === last) return
      last = key
      deps.publish(frame)
    },
    publish(clientId) {
      deps.publish(status(), clientId)
    },
  }
}
