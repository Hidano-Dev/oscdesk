import type { IncomingMessage, ServerResponse } from 'node:http'

import {
  buildSurfaceView,
  isValidSurfaceName,
  splitSurfaceBindings,
  surfaceViewSizeIssue,
  type DownstreamFrame,
  type SurfaceDefinition,
  type SurfaceView,
  type UpstreamFrame,
} from '@oscdesk/shared'

import type { PersistedDesired } from './desired-values'
import { applySurfaceEdit } from './surface-editor'
import { formatSurfaceStoreError, type SurfaceStore } from './surface-store'

type ClientId = string
type LogFn = (message?: unknown, ...optionalParams: unknown[]) => void

// 定義は数百パラメータでも数百 KiB に収まる。無制限に読むと LAN 内の誤送信でメモリを食うため上限を置く。
const MAX_UPLOAD_BYTES = 1024 * 1024
const SURFACE_PATH = /^\/surfaces\/([^/]+)\.json$/

export interface SurfaceManager {
  /** 起動時に既定の定義を読み込む。失敗しても起動は続け、採用なしのまま警告する。 */
  start(defaultName: string | undefined): void
  /** 定義関連の上りフレームなら処理して true を返す。 */
  handleUiFrame(frame: UpstreamFrame, clientId: ClientId): boolean
  /** ダウンロード・アップロード用の HTTP 受け口。対象外のパスなら false。 */
  handleHttp(request: IncomingMessage, response: ServerResponse): boolean
  /** 採用中の定義(プロジェクトの書き出し。D-090)。 */
  active(): { name: string; definition: SurfaceDefinition } | null
  /** 採用中の定義の版(surface フレームの revision)。採用が無ければ null。 */
  activeRevision(): number | null
  /**
   * プロジェクトの取り込み(D-090)。定義を保存して(直前の内容は .backups へ退避)採用し、保持値を imported で置き換えさせる。
   * 検証・書き込みに失敗したら採用せずに理由を返す
   */
  importDefinition(name: string, definition: SurfaceDefinition, imported: PersistedDesired): { ok: true } | { ok: false; detail: string }
  /**
   * 設計図から作った既定の画面(HID-386)を採用する。同じ名前で保存した画面があればそれを優先して採用し(並べ替えた結果を
   * 生成し直しで上書きしない)、無ければ generated を保存して採用する
   */
  adoptBlueprint(name: string, generated: SurfaceDefinition): { ok: true; saved: boolean } | { ok: false; detail: string }
}

export function createSurfaceManager(deps: {
  store: SurfaceStore
  publish: (frame: DownstreamFrame, target?: ClientId) => void
  /**
   * 定義を採用し、surface / surfaceList を配り終えた後に呼ぶ(保持値の初期化と、保管名ごとの保存・復元に使う)。
   * imported はプロジェクトの取り込み(D-090)のときだけ渡る、置き換える保持値
   */
  onAdopt?: (definition: SurfaceDefinition, name: string, imported?: PersistedDesired) => void
  now?: () => number
  logInfo?: LogFn
  logWarn?: LogFn
}): SurfaceManager {
  const now = deps.now ?? Date.now
  const logInfo = deps.logInfo ?? console.info
  const logWarn = deps.logWarn ?? console.warn
  // view は採用のときに 1 回だけ組み立てる(接続のたびに配り直すので、配るたびに組むと大きな定義で無駄が多い)
  let active: { name: string; revision: number; at: string; definition: SurfaceDefinition; view: SurfaceView } | null = null
  let revision = 0

  const listFrame = (): DownstreamFrame => ({
    v: 1, type: 'surfaceList', names: deps.store.list(), active: active?.name ?? null,
  })

  // 本体と結び付けを分けて配る(D-117)。UI は本体だけで画面を作り、OSC のアダプタがあるときだけ結び付けを編集に使う。
  // 表示する部品の木(view)はブリッジが組み立てて添え、UI はそれを描くだけにする(D-124)。definition と bindings は編集モードの作業コピーに使う
  const surfaceFrame = (): DownstreamFrame | null => {
    if (active === null) return null
    const { definition, bindings } = splitSurfaceBindings(active.definition)
    return {
      v: 1, type: 'surface', name: active.name, revision: active.revision, at: active.at,
      definition, bindings: bindings ?? {}, view: active.view,
    }
  }

  const reject = (clientId: ClientId, code: string, detail: string) => {
    logWarn('(WARN, BRIDGE)', `Surface request rejected (${code}): ${detail}`)
    deps.publish({ v: 1, type: 'notice', level: 'error', code, detail }, clientId)
  }

  // 不正な定義は active を書き換えない。直前の定義を維持したまま理由だけ返す
  // (採用してから検証すると、全 UI の画面が壊れた定義で上書きされる)。
  const adopt = (name: string, definition: SurfaceDefinition, imported?: PersistedDesired) => {
    revision += 1
    active = { name, revision, at: new Date(now()).toISOString(), definition, view: buildSurfaceView(definition) }
    const frame = surfaceFrame()
    if (frame !== null) deps.publish(frame)
    deps.publish(listFrame())
    logInfo('(INFO, BRIDGE)', `Surface "${name}" adopted (revision ${String(revision)}).`)
    deps.onAdopt?.(definition, name, imported)
  }

  return {
    active: () => active === null ? null : { name: active.name, definition: active.definition },
    adoptBlueprint(name, generated) {
      const existing = deps.store.read(name)
      if (existing.ok) {
        adopt(name, existing.value)
        return { ok: true, saved: true }
      }
      // 読めない保存済みの画面(壊れた JSON・不正な定義・読み取りの失敗)を作り直しで黙って上書きしない。無いときだけ作る
      if (existing.error.kind !== 'not-found') return { ok: false, detail: formatSurfaceStoreError(existing.error) }
      // saveValidated はストアの判定を通らないので、部品の木の大きさだけここで確かめる(HID-405)
      const tooLarge = surfaceViewSizeIssue(generated)
      if (tooLarge !== undefined) return { ok: false, detail: `surface "${name}" is invalid: ${tooLarge}` }
      const saved = deps.store.saveValidated(name, generated)
      if (!saved.ok) return { ok: false, detail: formatSurfaceStoreError(saved.error) }
      adopt(name, saved.value)
      return { ok: true, saved: false }
    },
    activeRevision: () => active?.revision ?? null,
    importDefinition(name, definition, imported) {
      // プロジェクトの検証(ProjectFileSchema)で同じ SurfaceDefinitionSchema を通っているので、検証し直さない。
      // 部品の木の大きさはストアの判定にしか無いので、ここで確かめる(HID-405)
      const tooLarge = surfaceViewSizeIssue(definition)
      if (tooLarge !== undefined) return { ok: false, detail: `surface "${name}" is invalid: ${tooLarge}` }
      const saved = deps.store.saveValidated(name, definition)
      if (!saved.ok) return { ok: false, detail: formatSurfaceStoreError(saved.error) }
      adopt(name, saved.value, imported)
      return { ok: true }
    },
    start(defaultName) {
      if (defaultName === undefined) return
      const loaded = deps.store.read(defaultName)
      if (!loaded.ok) {
        logWarn('(WARN, BRIDGE)', `Default surface not adopted: ${formatSurfaceStoreError(loaded.error)}`)
        return
      }
      adopt(defaultName, loaded.value)
    },
    handleUiFrame(frame, clientId) {
      switch (frame.type) {
        case 'surfaceRequest': {
          deps.publish(listFrame(), clientId)
          const current = surfaceFrame()
          if (current !== null) deps.publish(current, clientId)
          return true
        }
        case 'surfaceLoad': {
          const loaded = deps.store.read(frame.name)
          if (!loaded.ok) {
            reject(clientId, 'surface-rejected', formatSurfaceStoreError(loaded.error))
            return true
          }
          adopt(frame.name, loaded.value)
          return true
        }
        case 'surfaceSave': {
          // 本体と結び付けを 1 つの定義にして検証・保存する(D-117)。bindings を省いた本体だけの保存は、OSC の結び付けが
          // 無いので断られる(版 1 の定義はパラメータの address から結び付けを作るので通る)
          const input = frame.bindings === undefined ? frame.definition : { ...frame.definition, bindings: frame.bindings }
          const saved = deps.store.save(frame.name, input)
          if (!saved.ok) {
            reject(clientId, 'surface-rejected', formatSurfaceStoreError(saved.error))
            return true
          }
          if (frame.activate === false) deps.publish(listFrame())
          else adopt(frame.name, saved.value)
          return true
        }
        case 'surfaceEdit': {
          // 編集の規則を作業コピーに当てて検証し、結果を要求元だけへ返す(D-123)。何も保存・採用しない(保存は surfaceSave)
          let result: ReturnType<typeof applySurfaceEdit>
          try {
            result = applySurfaceEdit(frame.draft, frame.edit)
          } catch (error) {
            // 認証の無い LAN から届く命令で、想定外の例外(深すぎる木の再帰など)にブリッジごと落ちないように答えて断る
            logWarn('(WARN, BRIDGE)', `Surface edit failed: ${String(error)}`)
            result = { ok: false, detail: `編集できませんでした: ${error instanceof Error ? error.message : String(error)}` }
          }
          deps.publish({ v: 1, type: 'surfaceEdited', requestId: frame.requestId, result }, clientId)
          return true
        }
        default:
          return false
      }
    },
    handleHttp(request, response) {
      let url: URL
      try {
        url = new URL(request.url ?? '/', 'http://localhost')
      } catch {
        // 壊れた request-target で例外を投げるとブリッジごと落ちる
        return respondText(response, 400, 'bad request')
      }
      if (url.pathname === '/surfaces') {
        if (request.method !== 'GET') return respondText(response, 405, 'method not allowed')
        return respondJson(response, 200, { names: deps.store.list(), active: active?.name ?? null })
      }
      const match = SURFACE_PATH.exec(url.pathname)
      if (match === null) return false
      const name = match[1]
      if (!isValidSurfaceName(name)) return respondText(response, 400, 'invalid surface name')

      if (request.method === 'GET') {
        const raw = deps.store.readRaw(name)
        if (!raw.ok) return respondText(response, raw.error.kind === 'not-found' ? 404 : 500, formatSurfaceStoreError(raw.error))
        response.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${name}.json"`,
        })
        response.end(raw.value)
        return true
      }
      if (request.method === 'PUT') {
        readBody(request, MAX_UPLOAD_BYTES).then((body) => {
          if (body === null) return void respondText(response, 413, 'payload too large')
          let json: unknown
          try {
            json = JSON.parse(body.replace(/^﻿/, ''))
          } catch (error) {
            return void respondText(response, 400, `invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
          }
          const saved = deps.store.save(name, json)
          if (!saved.ok) {
            return void respondText(response, saved.error.kind === 'write-failed' ? 500 : 422, formatSurfaceStoreError(saved.error))
          }
          // 既定は保存と同時に採用する(UI の surfaceSave と同じ)。?activate=0 で保存だけにできる。
          if (url.searchParams.get('activate') === '0') deps.publish(listFrame())
          else adopt(name, saved.value)
          respondJson(response, 200, { name, active: active?.name ?? null })
        }).catch(() => respondText(response, 500, 'upload failed'))
        return true
      }
      return respondText(response, 405, 'method not allowed')
    },
  }
}

function respondText(response: ServerResponse, status: number, text: string): true {
  if (!response.headersSent) response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
  response.end(text)
  return true
}

function respondJson(response: ServerResponse, status: number, body: unknown): true {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
  return true
}

function readBody(request: IncomingMessage, limit: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let exceeded = false
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        exceeded = true
        chunks.length = 0
        return
      }
      if (!exceeded) chunks.push(chunk)
    })
    request.on('end', () => resolve(exceeded ? null : Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}
