import { z } from 'zod'

import { PadDocumentSchema, PadRowKeySchema, PadValueSchema } from './pad-document'
import { upgradePadDocument } from './pad-migration'
import { LegacyProjectFileSchema, PROJECT_FILE, PROJECT_FILE_FORMAT, ProjectFileSchema } from './project-file'
import { SurfaceNameSchema } from './surface-name'

// プロジェクトファイルの版 3(D-167)。作り直し(D-163)の後のプロジェクトは、パッド・その保持値・送り先だけを持つ
// (サーフェス定義と生成の記録は持たない。D-163・D-166)。
// いまのブリッジ(project-manager)はまだ版 2 を書き出して読み込み、版 3 は使わない。サーフェス定義を撤去する HID-491 と、
// 保持値をパッドの部品ごとにする HID-487 が、ここで決めた形に切り替える。それまでの間に形を変えてよい(まだ誰も書き出さない)

export const PAD_PROJECT_FILE_VERSION = 3

const IdentifierSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/)

/** パッドの保持値。値を持つ部品は部品の id ごと、表は部品・行のキー・欄の id ごとに 1 つ */
export const PadProjectValuesSchema = z.object({
  widgets: z.array(z.object({ widget: IdentifierSchema, value: PadValueSchema }).strict()),
  rows: z.array(z.object({ widget: IdentifierSchema, key: PadRowKeySchema, column: IdentifierSchema, value: PadValueSchema }).strict()).max(PROJECT_FILE.MAX_HELD_ROWS),
}).strict()

/** 送り先(OSCQuery で見つけた、または手で足したターゲット)。名前は画面に出すだけ */
export const PadProjectDestinationSchema = z.object({
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  name: z.string().max(64).optional(),
}).strict()

export const PadProjectFileSchema = z.object({
  format: z.literal(PROJECT_FILE_FORMAT),
  version: z.literal(PAD_PROJECT_FILE_VERSION),
  exportedAt: z.string().datetime({ offset: true }),
  pad: z.object({ name: SurfaceNameSchema, pad: PadDocumentSchema }).strict().nullable(),
  values: PadProjectValuesSchema,
  destinations: z.array(PadProjectDestinationSchema).max(256),
}).strict()

export type PadProjectFile = z.infer<typeof PadProjectFileSchema>
export type PadProjectValues = z.infer<typeof PadProjectValuesSchema>

/**
 * 版 1・版 2 のプロジェクトを版 3 にする。パッドは版 2 の文書に直す。サーフェス定義とその保持値・生成の記録は
 * 版 3 に置き場が無いので落とし、落としたことを dropped で返す(取り込む画面が利用者に知らせる)。送り先は版 2 までの
 * ファイルに無いので空。読めないファイルは理由を返す
 */
export function migrateProjectFileToV3(value: unknown): { ok: true; project: PadProjectFile; dropped: { surface: boolean } } | { ok: false; detail: string } {
  let source: { surface: unknown; pad: { name: string; pad: unknown } | null; exportedAt: string }
  const current = ProjectFileSchema.safeParse(value)
  if (current.success) {
    source = { surface: current.data.surface, pad: current.data.osc?.pad ?? null, exportedAt: current.data.exportedAt }
  } else {
    const legacy = LegacyProjectFileSchema.safeParse(value)
    if (!legacy.success) {
      // 版 1 の印のファイルなら版 1 の理由、それ以外は版 2 の理由を返す
      const issues = (typeof value === 'object' && value !== null && (value as { version?: unknown }).version === 1 ? legacy.error : current.error).issues
      return { ok: false, detail: issues.slice(0, 3).map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ') }
    }
    source = { surface: legacy.data.surface, pad: legacy.data.pad, exportedAt: legacy.data.exportedAt }
  }
  let pad: PadProjectFile['pad'] = null
  if (source.pad !== null) {
    const upgraded = PadDocumentSchema.safeParse(upgradePadDocument(source.pad.pad))
    if (!upgraded.success) return { ok: false, detail: `pad: ${upgraded.error.issues[0]?.message ?? 'invalid'}` }
    pad = { name: source.pad.name, pad: upgraded.data }
  }
  return {
    ok: true,
    project: { format: PROJECT_FILE_FORMAT, version: PAD_PROJECT_FILE_VERSION, exportedAt: source.exportedAt, pad, values: { widgets: [], rows: [] }, destinations: [] },
    dropped: { surface: source.surface !== null },
  }
}
