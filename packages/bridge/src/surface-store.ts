import fs from 'node:fs'
import path from 'node:path'

import {
  isValidSurfaceName,
  SurfaceDefinitionSchema,
  type SurfaceDefinition,
} from '@oscdesk/shared'

// 上書きで失わないための履歴。無制限に溜めるとディスクを食うので名前ごとに直近だけ残す。
const BACKUP_DIR_NAME = '.backups'
const BACKUPS_PER_NAME = 20
const FILE_EXTENSION = '.json'

export type SurfaceStoreError =
  | { kind: 'invalid-name'; name: string }
  | { kind: 'not-found'; name: string }
  | { kind: 'read-failed'; name: string; detail: string }
  | { kind: 'invalid-json'; name: string; detail: string }
  | { kind: 'invalid-definition'; name: string; issues: readonly string[] }
  | { kind: 'write-failed'; name: string; detail: string }

export type StoreResult<T> = { ok: true; value: T } | { ok: false; error: SurfaceStoreError }

export interface SurfaceStore {
  list(): string[]
  read(name: string): StoreResult<SurfaceDefinition>
  /** 検証済みの定義を保存する。既存ファイルがあれば直前の内容を .backups へ退避してから置き換える。 */
  save(name: string, input: unknown): StoreResult<SurfaceDefinition>
  /** 保存せずに検証だけ行う(アップロード本文の検査用)。 */
  validate(name: string, input: unknown): StoreResult<SurfaceDefinition>
  readRaw(name: string): StoreResult<string>
}

export function formatSurfaceStoreError(error: SurfaceStoreError): string {
  switch (error.kind) {
    case 'invalid-name': return `invalid surface name "${error.name}"`
    case 'not-found': return `surface "${error.name}" not found`
    case 'read-failed': return `failed to read surface "${error.name}": ${error.detail}`
    case 'invalid-json': return `surface "${error.name}" is not valid JSON: ${error.detail}`
    case 'invalid-definition': return `surface "${error.name}" is invalid: ${error.issues.join('; ')}`
    case 'write-failed': return `failed to write surface "${error.name}": ${error.detail}`
  }
}

export function createSurfaceStore(options: { dir: string; now?: () => number }): SurfaceStore {
  const dir = path.resolve(options.dir)
  const backupDir = path.join(dir, BACKUP_DIR_NAME)
  const now = options.now ?? Date.now

  const filePath = (name: string) => path.join(dir, `${name}${FILE_EXTENSION}`)

  const validate = (name: string, input: unknown): StoreResult<SurfaceDefinition> => {
    const parsed = SurfaceDefinitionSchema.safeParse(input)
    if (parsed.success) return { ok: true, value: parsed.data }
    return {
      ok: false,
      error: {
        kind: 'invalid-definition',
        name,
        issues: parsed.error.issues.slice(0, 5).map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`),
      },
    }
  }

  const readRaw = (name: string): StoreResult<string> => {
    if (!isValidSurfaceName(name)) return { ok: false, error: { kind: 'invalid-name', name } }
    try {
      return { ok: true, value: fs.readFileSync(filePath(name), 'utf8') }
    } catch (error) {
      if (isErrorCode(error, 'ENOENT')) return { ok: false, error: { kind: 'not-found', name } }
      return { ok: false, error: { kind: 'read-failed', name, detail: describe(error) } }
    }
  }

  return {
    list() {
      let entries: string[]
      try {
        entries = fs.readdirSync(dir)
      } catch {
        return []
      }
      return entries
        .filter(entry => entry.endsWith(FILE_EXTENSION))
        .map(entry => entry.slice(0, -FILE_EXTENSION.length))
        .filter(isValidSurfaceName)
        .sort()
    },
    readRaw,
    validate,
    read(name) {
      const raw = readRaw(name)
      if (!raw.ok) return raw
      let json: unknown
      try {
        // BOM 付き UTF-8(Windows のエディタが付ける)も受け付ける
        json = JSON.parse(raw.value.replace(/^﻿/, ''))
      } catch (error) {
        return { ok: false, error: { kind: 'invalid-json', name, detail: describe(error) } }
      }
      return validate(name, json)
    },
    save(name, input) {
      if (!isValidSurfaceName(name)) return { ok: false, error: { kind: 'invalid-name', name } }
      const checked = validate(name, input)
      if (!checked.ok) return checked
      const target = filePath(name)
      const temp = `${target}.${String(process.pid)}.tmp`
      try {
        fs.mkdirSync(dir, { recursive: true })
        if (fs.existsSync(target)) {
          fs.mkdirSync(backupDir, { recursive: true })
          fs.copyFileSync(target, path.join(backupDir, `${name}.${backupStamp(now())}${FILE_EXTENSION}`))
          pruneBackups(backupDir, name)
        }
        // 書き込み途中の電源断・クラッシュで定義が半端に残らないよう、一時ファイル経由で置き換える
        fs.writeFileSync(temp, `${JSON.stringify(checked.value, null, 2)}\n`, 'utf8')
        fs.renameSync(temp, target)
      } catch (error) {
        fs.rmSync(temp, { force: true })
        return { ok: false, error: { kind: 'write-failed', name, detail: describe(error) } }
      }
      return checked
    },
  }
}

function backupStamp(timestamp: number): string {
  // 同一ミリ秒の連続保存でも衝突しないよう、ミリ秒まで入れる
  return new Date(timestamp).toISOString().replace(/[-:]/g, '').replace('.', '')
}

function pruneBackups(backupDir: string, name: string): void {
  const prefix = `${name}.`
  const stampPattern = /^\d{8}T\d{9}Z\.json$/
  const mine = fs.readdirSync(backupDir)
    .filter(file => file.startsWith(prefix) && stampPattern.test(file.slice(prefix.length)))
    .sort()
  for (const file of mine.slice(0, Math.max(0, mine.length - BACKUPS_PER_NAME))) {
    fs.rmSync(path.join(backupDir, file), { force: true })
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code
}
