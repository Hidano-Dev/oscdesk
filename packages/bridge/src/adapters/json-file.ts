import path from 'node:path'

// 宛先パネルの小さな JSON ファイル(選択 D-078・端末の別名 D-092)の読み書きの共通部品。
// 書き込みは一時ファイル + rename で置き換え、途中で落ちても前の内容か新しい内容のどちらかが残るようにする。

export interface JsonFileFs {
  readFileSync(file: string, encoding: 'utf8'): string
  writeFileSync(file: string, data: string, encoding: 'utf8'): void
  renameSync(from: string, to: string): void
  mkdirSync(dir: string, options: { recursive: true }): unknown
  rmSync(file: string, options: { force: true }): void
}

export type JsonReadResult =
  | { kind: 'missing' }
  | { kind: 'failed'; reason: string }
  | { kind: 'ok'; json: unknown }

/** 読んで JSON として解釈する。無ければ missing、読めない・JSON でなければ failed(理由つき)。先頭の BOM は外す。 */
export function readJsonFile(fs: JsonFileFs, file: string): JsonReadResult {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (error) {
    if (isErrorCode(error, 'ENOENT')) return { kind: 'missing' }
    return { kind: 'failed', reason: `failed to read "${file}": ${describeError(error)}` }
  }
  try {
    return { kind: 'ok', json: JSON.parse(text.replace(/^﻿/, '')) as unknown }
  } catch (error) {
    return { kind: 'failed', reason: `"${file}" is not valid JSON: ${describeError(error)}` }
  }
}

/** 一時ファイル(`<file>.<pid>.tmp`)へ書いて rename で置き換える。失敗したら一時ファイルを消して投げ直す。 */
export function writeJsonFileAtomically(fs: JsonFileFs, file: string, body: unknown, pid: number): void {
  const temp = `${file}.${String(pid)}.tmp`
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(temp, `${JSON.stringify(body, null, 2)}\n`, 'utf8')
    fs.renameSync(temp, file)
  } catch (error) {
    try { fs.rmSync(temp, { force: true }) } catch { /* 後始末の失敗は元のエラーを優先して報告する */ }
    throw error
  }
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code
}
