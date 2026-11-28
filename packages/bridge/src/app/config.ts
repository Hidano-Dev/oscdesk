import fs from 'node:fs'
import path from 'node:path'

import { BridgeConfigSchema, type BridgeConfig, type Result } from '@oscdesk/shared'
import { ZodError } from 'zod'

export const BRIDGE_CONFIG_ENV_VAR = 'OSCDESK_CONFIG'
/**
 * 既定の設定ファイル(リポジトリ直下の config/oscdesk.config.json)。moduleDir はこのモジュールのディレクトリ(__dirname)。
 * バンドル(packages/bridge/dist/)とソース(packages/bridge/src/app/。D-134)で深さが 1 つ違うので、
 * ソースから読み込まれたときだけ 1 階層多く上がる(片方に合わせると、もう片方はリポジトリの外や packages/config を指す)
 */
export function defaultBridgeConfigPath(moduleDir: string): string {
  const fromSource = path.basename(moduleDir) === 'app' && path.basename(path.dirname(moduleDir)) === 'src'
  return path.resolve(moduleDir, fromSource ? '../../../..' : '../../..', 'config/oscdesk.config.json')
}

export const DEFAULT_BRIDGE_CONFIG_PATH = defaultBridgeConfigPath(__dirname)

/**
 * SPA のビルド出力(packages/web-ui/dist。D-138)のフォルダ。設定の webUi.dir があればそれ(相対パスは作業フォルダから)、
 * 無ければブリッジのバンドルの隣のパッケージから探す。作業フォルダに頼らないのは、E2E とランチャーが作業フォルダを
 * リポジトリ直下以外にすることがあるため(D-133)。moduleDir の深さの違いは defaultBridgeConfigPath と同じ
 */
export function resolveWebUiDir(moduleDir: string, configured: string | undefined, cwd: string = process.cwd()): string {
  if (configured !== undefined) return path.resolve(cwd, configured)
  const fromSource = path.basename(moduleDir) === 'app' && path.basename(path.dirname(moduleDir)) === 'src'
  return path.resolve(moduleDir, fromSource ? '../../..' : '../..', 'web-ui/dist')
}

export type ConfigLoadError =
  | { kind: 'not-found'; path: string }
  | { kind: 'read-failed'; path: string; detail: string }
  | { kind: 'invalid-json'; path: string; detail: string }
  | { kind: 'schema-invalid'; path: string; issues: readonly string[] }

export function formatConfigLoadError(error: ConfigLoadError): string {
  switch (error.kind) {
    case 'not-found':
      return `Config file not found at "${error.path}"`
    case 'read-failed':
      return `Failed to read config at "${error.path}": ${error.detail}`
    case 'invalid-json':
      return `Invalid JSON at "${error.path}": ${error.detail}`
    case 'schema-invalid':
      return `Invalid config at "${error.path}": ${error.issues.join('; ')}`
  }
}

export function resolveBridgeConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const configuredPath = env[BRIDGE_CONFIG_ENV_VAR]

  if (typeof configuredPath === 'string' && configuredPath.trim() !== '') {
    return configuredPath.trim()
  }

  return DEFAULT_BRIDGE_CONFIG_PATH
}

/**
 * 廃止したブロックを外す(D-162)。ui(NiceGUI 版の UI のポート 8080)はフォークの設定ファイルに残っていることがあり、
 * strict なスキーマのままだと起動できなくなる。UI は SPA だけになり、ブリッジの WebSocket と同じポートで配るので、
 * 値は使わずに警告だけを出して読み進める。surfaces.defaultName(起動時に採用するサーフェス定義)と destinations.scanTimeoutMs
 * (LAN の走査の時間上限)も、定義と走査を撤去した(D-175)ので同じく読み捨てる
 */
export function dropRetiredConfigKeys(raw: unknown, onWarning: (message: string) => void = () => undefined): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw
  const rest = { ...(raw as Record<string, unknown>) }
  if ('ui' in rest) {
    delete rest.ui
    onWarning('config "ui" is ignored: the NiceGUI UI was removed and the SPA is served on bridge.wsPort (D-162). Remove the block from the config file.')
  }
  const dropNested = (block: string, key: string, why: string) => {
    const value = rest[block]
    if (typeof value !== 'object' || value === null || Array.isArray(value) || !(key in value)) return
    const { [key]: _retired, ...kept } = value as Record<string, unknown>
    rest[block] = kept
    onWarning(`config "${block}.${key}" is ignored: ${why} (D-175). Remove it from the config file.`)
  }
  dropNested('surfaces', 'defaultName', 'surface definitions were removed; the bridge adopts the last pad')
  dropNested('destinations', 'scanTimeoutMs', 'the LAN scan was removed; OSCQuery finds the targets')
  return rest
}

export function parseBridgeConfig(raw: unknown, onWarning?: (message: string) => void): BridgeConfig {
  const result = BridgeConfigSchema.safeParse(dropRetiredConfigKeys(raw, onWarning))

  if (result.success) {
    return result.data
  }

  throw new Error(formatConfigValidationError(result.error))
}

export function loadBridgeConfig(options: {
  path: string
  readFile?: (filePath: string) => string
  /** 起動は止めないが知らせたいこと(廃止したブロックなど)。省けば黙って読む */
  onWarning?: (message: string) => void
}): Result<BridgeConfig, ConfigLoadError> {
  const readFile = options.readFile ?? ((filePath: string) => fs.readFileSync(filePath, 'utf8'))

  let text: string
  try {
    text = readFile(options.path)
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) {
      return { ok: false, error: { kind: 'not-found', path: options.path } }
    }

    return {
      ok: false,
      error: { kind: 'read-failed', path: options.path, detail: formatUnknownError(error) },
    }
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return {
      ok: false,
      error: { kind: 'invalid-json', path: options.path, detail: formatUnknownError(error) },
    }
  }

  const result = BridgeConfigSchema.safeParse(dropRetiredConfigKeys(raw, options.onWarning))
  if (!result.success) {
    return {
      ok: false,
      error: {
        kind: 'schema-invalid',
        path: options.path,
        issues: formatConfigValidationIssues(result.error),
      },
    }
  }

  return { ok: true, value: result.data }
}

function formatConfigValidationError(error: ZodError): string {
  return formatConfigValidationIssues(error).join('; ')
}

function formatConfigValidationIssues(error: ZodError): readonly string[] {
  return error.issues
    .map((issue) => {
      const pathLabel = issue.path.length > 0 ? issue.path.join('.') : '<root>'

      return `${pathLabel}: ${issue.message}`
    })
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  )
}
