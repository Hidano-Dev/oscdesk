// プロジェクトファイル(D-090・D-172。版 3)の読み込みの受け口とダウンロード用の整形(D-150)。
// UI を持たない純粋関数。
//
// 正典は packages/shared の project-file.ts(zod)で、取り込めるかの判定と確認のダイアログに出す要約はブリッジが作る
// (上り projectInspect・下り projectInspection。D-122)。ここで見るのは、選んだファイルを JSON のオブジェクトとして
// 読めるかだけ(読めなければブリッジへ問い合わせようがない)。形・パッドの検査・版 1・版 2 からの移し替えの写しは持たない

import { PROJECT_FILE, type ProjectFile } from '@oscdesk/shared'

/**
 * 受け口の上限(ファイルそのもののバイト数)。巨大なファイルを WebSocket へ流さないための粗い歯止めで、ブリッジの
 * 上限(区切りの空白なしの JSON で 12 MiB)より十分大きくする。上限の判定そのものはブリッジだけが行う(JSON の
 * 数値の書き方で境界の判定が割れるので、UI は 12 MiB で断らない)
 */
export const PROJECT_UPLOAD_MAX_BYTES = 2 * PROJECT_FILE.MAX_SERIALIZED_BYTES

export type ReadResult = { ok: true; project: Record<string, unknown> } | { ok: false; message: string }

const encoder = new TextEncoder()

/** 選んだファイルのバイト列を JSON のオブジェクトとして読む。読めなければ理由(画面にそのまま出す)。 */
export function readProjectBytes(bytes: Uint8Array): ReadResult {
  if (bytes.length > PROJECT_UPLOAD_MAX_BYTES) return { ok: false, message: `ファイルが大きすぎます(${bytes.length.toLocaleString('en-US')} バイト)` }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return { ok: false, message: 'UTF-8 のテキストとして読めません' }
  }
  // メモ帳などで保存し直したファイルの先頭の BOM(TextDecoder は既定で外すが、二重に付いたものは残る)
  if (text.startsWith('﻿')) text = text.slice(1)
  let project: unknown
  try {
    project = JSON.parse(text, (_key, value: unknown) => {
      // 1e400 は JSON.parse で Infinity になり、上りの JSON.stringify で null に化けて別の値として届く。
      // ブリッジ(JSON.parse)も有限の数しか持てないので、その場で理由を出して断る
      if (typeof value === 'number' && !Number.isFinite(value)) throw new NonFiniteError()
      return value
    })
  } catch (error) {
    if (error instanceof NonFiniteError) return { ok: false, message: '有限の数として読めない数値があります' }
    return { ok: false, message: `JSON として読めません: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (project === null || typeof project !== 'object' || Array.isArray(project)) {
    return { ok: false, message: 'プロジェクトファイルではありません(JSON のオブジェクトではありません)' }
  }
  return { ok: true, project: project as Record<string, unknown> }
}

class NonFiniteError extends Error {}

/** 検査・取り込みで断られた理由(ブリッジの detail)を通知の文言にする。判定はブリッジが済ませていて、ここは言い換えだけ。 */
export function describeRejection(detail: string): string {
  if (detail.startsWith('surface-file:')) return 'これはサーフェス定義のファイルです。サーフェス定義は撤去したので読み込めません(パッドを作り直してください)'
  if (detail.startsWith('surface-only:')) return 'このプロジェクトにはパッドが無く、撤去したサーフェス定義しか入っていないため読み込めません'
  if (detail.startsWith('unsupported-version:')) return `この版のプロジェクトファイルは読めません: ${detail.slice('unsupported-version:'.length).trim()}`
  if (detail.startsWith('too-large:')) return `プロジェクトが大きすぎるため読み込めません: ${detail.slice('too-large:'.length).trim()}`
  return `プロジェクトを読み込めません: ${detail === '' ? '理由は届きませんでした' : detail}`
}

/**
 * ダウンロードするファイルの中身。人が開いて見られるよう字下げするが、字下げで膨らんで受け口の上限を超えるときは
 * 字下げしない(ブリッジが書き出せた 12 MiB 以下のプロジェクトは、字下げしなければ必ず受け口に収まる)。
 * 孤立サロゲートは JSON.stringify が \uXXXX にするので、UTF-8 にしても壊れない
 */
export function projectDownloadText(project: ProjectFile): string {
  const indented = `${JSON.stringify(project, null, 2)}\n`
  if (encoder.encode(indented).length <= PROJECT_UPLOAD_MAX_BYTES) return indented
  return `${JSON.stringify(project)}\n`
}

const pad2 = (value: number) => String(value).padStart(2, '0')

/** ダウンロードのファイル名。パッド名と書き出した時刻(この端末の時計)を入れる。 */
export function projectDownloadName(project: ProjectFile, now: Date): string {
  const safe = project.osc.pad.name.replace(/[^A-Za-z0-9_-]/g, '_')
  const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
  return `${safe}-${stamp}.oscdesk-project.json`
}
