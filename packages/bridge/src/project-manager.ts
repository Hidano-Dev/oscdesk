import {
  OSC_PAD,
  oscPadSerializedBytes,
  PROJECT_FILE,
  PROJECT_FILE_FORMAT,
  PROJECT_FILE_VERSION,
  ProjectFileSchema,
  projectSerializedBytes,
  type DownstreamFrame,
  type OscPad,
  type ProjectFile,
  type SurfaceDefinition,
  type UpstreamFrame,
} from '@oscdesk/shared'

import type { PersistedDesired } from './desired-values'
import { fromHeldValues, toHeldValues } from './desired-values-file'

type ClientId = string
type LogFn = (message?: unknown, ...optionalParams: unknown[]) => void
type ImportResult = { ok: true } | { ok: false; detail: string }

export interface ProjectManager {
  /** プロジェクトの上りフレーム(projectExport / projectImport)なら処理して true を返す。 */
  handleUiFrame(frame: UpstreamFrame, clientId: ClientId): boolean
}

/**
 * プロジェクトファイル(D-090)の書き出しと取り込み。採用中の定義・保持値・パッドをまとめるだけで、保管と採用は
 * 定義(surface-manager)・パッド(pad-manager)・保持値(surface-core)の既存の経路に任せる。
 * 取り込みは定義とパッドを保存して採用し、保持値を置き換えるが、Unity へは送らない(送るのは上り resend)。
 * プロジェクトは最大 12 MiB なので、直列化と検証はそれぞれ 1 回だけにする(大きさ 1 回・ProjectFileSchema 1 回。
 * 保存では検証し直さない)
 */
export function createProjectManager(deps: {
  surfaces: {
    active(): { name: string; definition: SurfaceDefinition } | null
    importDefinition(name: string, definition: SurfaceDefinition, imported: PersistedDesired): ImportResult
  }
  pads: {
    active(): { name: string; pad: OscPad } | null
    importPad(name: string, pad: OscPad): ImportResult
  }
  /** 採用中の定義の保持値の全量(UI で管理する一覧を含む) */
  heldValues(): PersistedDesired
  publish: (frame: DownstreamFrame, target?: ClientId) => void
  now?: () => number
  logInfo?: LogFn
  logWarn?: LogFn
}): ProjectManager {
  const now = deps.now ?? Date.now
  const logInfo = deps.logInfo ?? console.info
  const logWarn = deps.logWarn ?? console.warn

  const reject = (clientId: ClientId, code: string, detail: string) => {
    logWarn('(WARN, BRIDGE)', `Project request rejected (${code}): ${detail}`)
    deps.publish({ v: 1, type: 'notice', level: 'error', code, detail }, clientId)
  }

  const tooLarge = (bytes: number) => `too-large: ${String(bytes)} bytes (limit ${String(PROJECT_FILE.MAX_SERIALIZED_BYTES)})`

  const exportProject = (requestId: string, clientId: ClientId) => {
    const surface = deps.surfaces.active()
    const pad = deps.pads.active()
    if (surface === null && pad === null) return reject(clientId, 'project-export-rejected', 'empty: no surface or pad is adopted')
    // 定義とパッドは採用のときに、保持値は保持する時点で検証済みなので、ここでは検証し直さない
    // (形は toHeldValues が保存ファイルと同じ写像で作る)
    const project: ProjectFile = {
      format: PROJECT_FILE_FORMAT,
      version: PROJECT_FILE_VERSION,
      exportedAt: new Date(now()).toISOString(),
      surface: surface === null ? null : { name: surface.name, definition: surface.definition, values: toHeldValues(deps.heldValues()) },
      pad: pad === null ? null : { name: pad.name, pad: pad.pad },
    }
    const bytes = projectSerializedBytes(project)
    if (bytes > PROJECT_FILE.MAX_SERIALIZED_BYTES) return reject(clientId, 'project-export-rejected', tooLarge(bytes))
    deps.publish({ v: 1, type: 'project', requestId, project }, clientId)
    logInfo('(INFO, BRIDGE)', `Project exported (surface ${surface === null ? 'none' : `"${surface.name}"`}, pad ${pad === null ? 'none' : `"${pad.name}"`}).`)
  }

  const importProject = (raw: Record<string, unknown>, clientId: ClientId) => {
    // 大きさを先に見る(検証の前に巨大な定義を舐めない。書き出しと同じ上限)
    const bytes = projectSerializedBytes(raw)
    if (bytes > PROJECT_FILE.MAX_SERIALIZED_BYTES) return reject(clientId, 'project-import-rejected', tooLarge(bytes))
    const parsed = ProjectFileSchema.safeParse(raw)
    if (!parsed.success) return reject(clientId, 'project-import-rejected', `invalid: ${describeIssues(parsed.error.issues)}`)
    const project = parsed.data
    // パッドの保管の上限(8 MiB。D-080)はフレームの形式では見ないので、何も書き換えないうちにここで確かめる
    // (定義だけ採用してからパッドで断ると、半分だけ取り込んだ状態になる)。形と意味は ProjectFileSchema で済んでいる
    if (project.pad !== null) {
      const padBytes = oscPadSerializedBytes(project.pad.pad)
      if (padBytes > OSC_PAD.MAX_SERIALIZED_BYTES) {
        return reject(clientId, 'project-import-rejected', `invalid: pad.pad: pad is ${String(padBytes)} bytes as JSON (limit ${String(OSC_PAD.MAX_SERIALIZED_BYTES)})`)
      }
    }
    if (project.surface !== null) {
      const result = deps.surfaces.importDefinition(project.surface.name, project.surface.definition, fromHeldValues(project.surface.values))
      if (!result.ok) return reject(clientId, 'project-import-rejected', `surface: ${result.detail}`)
    }
    if (project.pad !== null) {
      const result = deps.pads.importPad(project.pad.name, project.pad.pad)
      // 検証は済んでいるので、ここで断られるのは書き込みの失敗だけ。定義はもう取り込んだので、その旨を添える
      if (!result.ok) {
        return reject(clientId, 'project-import-rejected', `pad: ${result.detail}${project.surface === null ? '' : ' (the surface and its values were imported)'}`)
      }
    }
    const parts = [
      project.surface === null ? null : `surface "${project.surface.name}"`,
      project.pad === null ? null : `pad "${project.pad.name}"`,
    ].filter((part): part is string => part !== null)
    logInfo('(INFO, BRIDGE)', `Project imported (${parts.join(', ')}).`)
    deps.publish({ v: 1, type: 'notice', level: 'info', code: 'project-imported', detail: parts.join(', ') }, clientId)
  }

  return {
    handleUiFrame(frame, clientId) {
      if (frame.type === 'projectExport') {
        exportProject(frame.requestId, clientId)
        return true
      }
      if (frame.type === 'projectImport') {
        importProject(frame.project, clientId)
        return true
      }
      return false
    },
  }
}

function describeIssues(issues: readonly { path: (string | number)[]; message: string }[]): string {
  return issues.slice(0, 5).map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ')
}
