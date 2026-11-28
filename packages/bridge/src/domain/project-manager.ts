import {
  PROJECT_FILE,
  PROJECT_FILE_FORMAT,
  PROJECT_FILE_VERSION,
  ProjectFileSchema,
  projectSerializedBytes,
  readProjectFile,
  type DownstreamFrame,
  type PadDocument,
  type ProjectDestination,
  type ProjectFile,
  type ProjectReadResult,
  type UpstreamFrame,
} from '@oscdesk/shared'

import type { PadValueEntries } from './pad-values'

type ClientId = string
type LogFn = (message?: unknown, ...optionalParams: unknown[]) => void
type CheckResult = Extract<ProjectReadResult, { ok: true }> | { ok: false; detail: string }

export interface ProjectManager {
  /** プロジェクトの上りフレーム(projectExport / projectInspect / projectImport)なら処理して true を返す。 */
  handleUiFrame(frame: UpstreamFrame, clientId: ClientId): boolean
}

/**
 * プロジェクトファイル(D-090・D-175。版 3)の書き出しと取り込み。採用中のパッド・保持値・送り先をまとめるだけで、保管と採用は
 * パッド(pad-manager)の経路に任せる。取り込みはパッドを保存して採用し、保持値をファイルの値で置き換えるが、送り先へは送らない
 * (送るのは同期。D-175 で未送信の印は持たないと決めた)。送り先はファイルに残すだけで、宛先は変えない。
 * プロジェクトは最大 12 MiB なので、直列化と検証はそれぞれ 1 回だけにする(大きさ 1 回・readProjectFile 1 回。保存では検証し直さない)。
 * 書き出しも取り込みと同じ ProjectFileSchema を 1 回通し、取り込めないファイルは渡さない
 */
export function createProjectManager(deps: {
  pads: {
    exportProject(): { name: string; pad: PadDocument; values: PadValueEntries } | null
    importProject(name: string, pad: PadDocument, values: PadValueEntries): { ok: true; dropped: number } | { ok: false; detail: string }
  }
  /** 今送っている宛先(ブロードキャストでないもの)。書き出しに載せる */
  destinations?: () => readonly ProjectDestination[]
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
    const pad = deps.pads.exportProject()
    if (pad === null) return reject(clientId, 'project-export-rejected', 'empty: no pad is adopted')
    const project: ProjectFile = {
      format: PROJECT_FILE_FORMAT,
      version: PROJECT_FILE_VERSION,
      exportedAt: new Date(now()).toISOString(),
      osc: { pad: { name: pad.name, pad: pad.pad }, values: { widgets: pad.values.widgets, rows: pad.values.rows } },
      destinations: (deps.destinations?.() ?? []).slice(0, PROJECT_FILE.MAX_DESTINATIONS).map(destination => ({ ...destination })),
    }
    const bytes = projectSerializedBytes(project)
    if (bytes > PROJECT_FILE.MAX_SERIALIZED_BYTES) return reject(clientId, 'project-export-rejected', tooLarge(bytes))
    // 取り込みと同じ検査を通す。通らないファイルを渡すと、利用者は復元できないバックアップを成功として受け取ってしまう
    // (PR #80 のレビュー指摘)。大きさを先に見て、巨大なものは検証しない
    const checked = ProjectFileSchema.safeParse(project)
    if (!checked.success) {
      const detail = checked.error.issues.slice(0, 5).map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ')
      return reject(clientId, 'project-export-rejected', `invalid: ${detail}`)
    }
    deps.publish({ v: 1, type: 'project', requestId, project }, clientId)
    logInfo('(INFO, BRIDGE)', `Project exported (pad "${pad.name}", ${String(pad.values.widgets.length + pad.values.rows.length)} value(s)).`)
  }

  /**
   * 取り込みの可否の判定(取り込みと検査だけの問い合わせで共通)。判定の正は shared の readProjectFile だけで、UI は写しを持たない(D-122)。
   * 何も書き換えない。大きさを先に見る(検証の前に巨大なファイルを舐めない。書き出しと同じ上限)
   */
  const check = (raw: Record<string, unknown>): CheckResult => {
    const bytes = projectSerializedBytes(raw)
    if (bytes > PROJECT_FILE.MAX_SERIALIZED_BYTES) return { ok: false, detail: tooLarge(bytes) }
    return readProjectFile(raw)
  }

  const inspectProject = (requestId: string, raw: Record<string, unknown>, clientId: ClientId) => {
    const checked = check(raw)
    if (!checked.ok) {
      logInfo('(INFO, BRIDGE)', `Project inspection failed: ${checked.detail}`)
      deps.publish({ v: 1, type: 'projectInspection', requestId, result: { ok: false, detail: checked.detail } }, clientId)
      return
    }
    const { osc, destinations } = checked.project
    deps.publish({
      v: 1,
      type: 'projectInspection',
      requestId,
      result: {
        ok: true,
        summary: {
          exportedAt: checked.project.exportedAt,
          sourceVersion: checked.sourceVersion,
          pad: { name: osc.pad.name, widgets: osc.pad.pad.widgets.length },
          values: { widgets: osc.values.widgets.length, rows: osc.values.rows.length },
          destinations: destinations.length,
          droppedSurface: checked.dropped.surface,
        },
      },
    }, clientId)
  }

  const importProject = (raw: Record<string, unknown>, clientId: ClientId) => {
    const checked = check(raw)
    if (!checked.ok) return reject(clientId, 'project-import-rejected', checked.detail)
    const { osc } = checked.project
    const result = deps.pads.importProject(osc.pad.name, osc.pad.pad, osc.values)
    // 検証は済んでいるので、ここで断られるのは書き込みの失敗だけ(何も採用していない)
    if (!result.ok) return reject(clientId, 'project-import-rejected', `pad: ${result.detail}`)
    const surface = checked.dropped.surface
    const parts = [
      `pad "${osc.pad.name}"`,
      `${String(osc.values.widgets.length + osc.values.rows.length - result.dropped)} value(s)`,
      ...(result.dropped > 0 ? [`${String(result.dropped)} value(s) that do not fit the pad were dropped`] : []),
      // 版 1・版 2 のファイルのサーフェス定義は取り込まない。黙って落とさず、何を落としたかを返す(D-175)
      ...(surface === null ? [] : [`surface definition${surface.name === null ? '' : ` "${surface.name}"`} was not imported`]),
    ]
    logInfo('(INFO, BRIDGE)', `Project imported (${parts.join(', ')}). Nothing was sent to the targets.`)
    deps.publish({ v: 1, type: 'notice', level: 'info', code: 'project-imported', detail: parts.join(', ') }, clientId)
  }

  return {
    handleUiFrame(frame, clientId) {
      if (frame.type === 'projectExport') {
        exportProject(frame.requestId, clientId)
        return true
      }
      if (frame.type === 'projectInspect') {
        inspectProject(frame.requestId, frame.project, clientId)
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
