import type { SurfaceDefinition } from '@oscdesk/shared'

// 名前付きの JSON 文書の保管のポート(D-134)。ファイルでの実装は adapters/surface-store。

export type SurfaceStoreError =
  | { kind: 'invalid-name'; name: string }
  | { kind: 'not-found'; name: string }
  | { kind: 'read-failed'; name: string; detail: string }
  | { kind: 'invalid-json'; name: string; detail: string }
  | { kind: 'invalid-definition'; name: string; issues: readonly string[] }
  | { kind: 'write-failed'; name: string; detail: string }

export type StoreResult<T> = { ok: true; value: T } | { ok: false; error: SurfaceStoreError }

/** 名前付きの JSON 文書の保管(サーフェス定義と OSC パッド。D-044 / D-080)。 */
export interface NamedJsonStore<T> {
  list(): string[]
  read(name: string): StoreResult<T>
  /** 検証済みの文書を保存する。既存ファイルがあれば直前の内容を .backups へ退避してから置き換える。 */
  save(name: string, input: unknown): StoreResult<T>
  /**
   * 呼び出し側が同じスキーマで検証済みの文書を保存する(検証をやり直さない。プロジェクトの取り込み D-090 で、
   * 最大 12 MiB の検証を重ねないため)。バックアップと置き換えは save と同じ
   */
  saveValidated(name: string, value: T): StoreResult<T>
  /** 保存せずに検証だけ行う(アップロード本文の検査用)。 */
  validate(name: string, input: unknown): StoreResult<T>
  readRaw(name: string): StoreResult<string>
}

export type SurfaceStore = NamedJsonStore<SurfaceDefinition>

/** label は文言の対象名(`surface` / `pad`)。 */
export function formatSurfaceStoreError(error: SurfaceStoreError, label = 'surface'): string {
  switch (error.kind) {
    case 'invalid-name': return `invalid ${label} name "${error.name}"`
    case 'not-found': return `${label} "${error.name}" not found`
    case 'read-failed': return `failed to read ${label} "${error.name}": ${error.detail}`
    case 'invalid-json': return `${label} "${error.name}" is not valid JSON: ${error.detail}`
    case 'invalid-definition': return `${label} "${error.name}" is invalid: ${error.issues.join('; ')}`
    case 'write-failed': return `failed to write ${label} "${error.name}": ${error.detail}`
  }
}
