import { z } from 'zod'

import { OSC_PAD_FORMAT, OSC_PAD_VERSION, OscPadSchema, type OscPad } from './osc-pad'
import { PAD_DOCUMENT_VERSION, PadDocumentStoredSchema, type PadDocument, type PadWidget } from './pad-document'

// 版 1 のパッド(D-080。ボタンだけの格子)を版 2(D-167)へ直す。保存済みのパッド・プロジェクトファイルの中のパッドを
// 読み込むときに通し、書くときは版 2 で書く(サーフェス定義の版 1 → 版 2 の移行 surface-migration.ts と同じ考え)。
// 版 1 のボタンは版 2 のボタンの部品にそのまま移る(id・位置・ラベル・色・画像・アドレス・引数)。

/** 版 1 のパッドを版 2 にする。中身は変えず、ボタンを部品(kind 'button')に移すだけ */
export function migrateOscPadV1(pad: OscPad): PadDocument {
  return {
    format: OSC_PAD_FORMAT,
    version: PAD_DOCUMENT_VERSION,
    rows: pad.rows,
    columns: pad.columns,
    widgets: pad.buttons.map((button): PadWidget => ({
      id: button.id,
      kind: 'button',
      row: button.row,
      column: button.column,
      label: button.label,
      ...(button.color === undefined ? {} : { color: button.color }),
      ...(button.image === undefined ? {} : { image: button.image }),
      address: button.address,
      args: button.args.map(arg => ({ ...arg })),
    })),
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * 読み込んだ JSON が版 1 のパッドとして正しければ版 2 に直し、そうでなければそのまま返す(版 2 の検証が理由を出す)。
 * 版 1 として不正なものを途中まで直すと、元の誤りの場所が分からなくなるので直さない
 */
export function upgradePadDocument(value: unknown): unknown {
  if (!isRecord(value) || value.format !== OSC_PAD_FORMAT || value.version !== OSC_PAD_VERSION) return value
  const legacy = OscPadSchema.safeParse(value)
  return legacy.success ? migrateOscPadV1(legacy.data) : value
}

/** 保存済みのパッドを読み込むときの検証。版 1 なら版 2 に直してから、保存と同じ検証(形・意味・JSON の大きさ)に通す */
export const PadDocumentLoadSchema = z.preprocess(upgradePadDocument, PadDocumentStoredSchema)

/** 版 1 か版 2 のパッドを版 2 として読む。読めなければ理由(最初の 3 件)を返す */
export function loadPadDocument(value: unknown): { ok: true; pad: PadDocument; migrated: boolean } | { ok: false; detail: string } {
  const parsed = PadDocumentLoadSchema.safeParse(value)
  if (!parsed.success) {
    return { ok: false, detail: parsed.error.issues.slice(0, 3).map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ') }
  }
  return { ok: true, pad: parsed.data, migrated: isRecord(value) && value.version === OSC_PAD_VERSION }
}
