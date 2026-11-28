import { z } from 'zod'

import { PAD_DOCUMENT, PadDocumentStoredSchema, PadRowKeySchema, PadValueSchema } from './pad-document'
import { upgradePadDocument } from './pad-migration'
import { SurfaceNameSchema } from './surface-name'

// プロジェクトファイル(D-090・D-172)。採用中のパッド(版 2。D-167)・その保持値・送り先を 1 つの JSON にまとめ、ブラウザで
// ダウンロード・アップロードして利用者が保管する。取り込みはパッドと保持値を置き換えるだけで、送り先へは送らない
// (送るのは利用者の同期。自動の再送を入れていれば、ターゲットの起動でも送り直す)。正典はこの zod で、ブリッジが取り込む前に検証する。
//
// 版 3(D-172)。作り直し(D-163)の後のプロジェクトは、パッド・その保持値・送り先だけを持つ。OSC 専用のもの(パッドとその値。
// どちらも OSC のアドレスを持つ)は osc の欄に置く(共通のフレームに OSC の語を混ぜない。tests/guards/osc-vocabulary.test.ts)。
// 版 1・版 2(サーフェス定義と OSC パッドの版 1)のファイルも読み、版 3 へ移す(readProjectFile)。サーフェス定義とその保持値・
// 生成の記録は版 3 に置き場が無いので落とし、落としたことを返す(取り込む画面が利用者に知らせる)

export const PROJECT_FILE_FORMAT = 'oscdesk-project'
export const PROJECT_FILE_VERSION = 3
/** 読み込んで版 3 へ移す前の版 */
export const LEGACY_PROJECT_FILE_VERSIONS = [1, 2] as const
/** サーフェス定義のファイルの format(撤去した。D-172)。取り違えたファイルを見分けて理由を返すためだけに持つ */
export const SURFACE_FILE_FORMAT = 'oscdesk-surface'

export const PROJECT_FILE = {
  // プロジェクトの JSON(区切りの空白なし、UTF-8)の上限。書き出しは project フレームで UI へ届き、UI の受信上限は
  // 16 MiB(D-071)なので、パッドの上限 8 MiB(D-080)と保持値を収めつつ余裕を残す値にする
  MAX_SERIALIZED_BYTES: 12 * 1024 * 1024,
  // 要求と応答を結ぶ印。どのページの要求かを返す
  MAX_REQUEST_ID_CHARS: 64,
  // 保持値の表のマスの上限(パッドの保持値と同じ。D-169)
  MAX_HELD_ROWS: 20_000,
  // 送り先の上限(宛先の選択の上限と同じ桁)
  MAX_DESTINATIONS: 256,
} as const

const IdentifierSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/)

/** パッドの保持値。値を持つ部品は部品の id ごと、表は部品・行のキー・欄の id ごとに 1 つ(D-169。アドレスはパッドから引く) */
export const ProjectPadValuesSchema = z.object({
  widgets: z.array(z.object({ widget: IdentifierSchema, value: PadValueSchema }).strict()).max(PAD_DOCUMENT.MAX_WIDGETS),
  rows: z.array(z.object({ widget: IdentifierSchema, key: PadRowKeySchema, column: IdentifierSchema, value: PadValueSchema }).strict()).max(PROJECT_FILE.MAX_HELD_ROWS),
}).strict()

/** 送り先(書き出したときに送っていた宛先)。取り込みでは宛先を変えない(D-172)。名前は画面に出すだけ */
export const ProjectDestinationSchema = z.object({
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  name: z.string().max(64).optional(),
}).strict()

export const ProjectFileSchema = z.object({
  format: z.literal(PROJECT_FILE_FORMAT),
  version: z.literal(PROJECT_FILE_VERSION),
  exportedAt: z.string().datetime({ offset: true }),
  osc: z.object({
    // 保存と同じ検証(形・意味・JSON の大きさ 8 MiB)。検査で通ったファイルを取り込みで断らないように
    pad: z.object({ name: SurfaceNameSchema, pad: PadDocumentStoredSchema }).strict(),
    values: ProjectPadValuesSchema,
  }).strict(),
  destinations: z.array(ProjectDestinationSchema).max(PROJECT_FILE.MAX_DESTINATIONS),
}).strict()

export type ProjectFile = z.infer<typeof ProjectFileSchema>
export type ProjectPadValues = z.infer<typeof ProjectPadValuesSchema>
export type ProjectDestination = z.infer<typeof ProjectDestinationSchema>

// ---- 版 1・版 2 の読み込み ----
// 中身(サーフェス定義・保持値)の形はもう検証しない(落とすので)。パッドは版 2 へ移してから保存と同じ検証に通す
const LegacyPadSchema = z.object({ name: SurfaceNameSchema, pad: z.unknown() }).strict()
const LegacySurfaceSchema = z.record(z.string(), z.unknown()).nullable()
const LegacyV1Schema = z.object({
  format: z.literal(PROJECT_FILE_FORMAT),
  version: z.literal(1),
  exportedAt: z.string().datetime({ offset: true }),
  surface: LegacySurfaceSchema,
  pad: LegacyPadSchema.nullable(),
}).strict()
const LegacyV2Schema = z.object({
  format: z.literal(PROJECT_FILE_FORMAT),
  version: z.literal(2),
  exportedAt: z.string().datetime({ offset: true }),
  surface: LegacySurfaceSchema,
  osc: z.object({ pad: LegacyPadSchema.nullable() }).strict().optional(),
}).strict()

/** 版 1・版 2 のファイルから落としたサーフェス定義(取り込む画面が利用者に知らせる)。数は書いてあった保持値の数 */
export interface DroppedSurface {
  name: string | null
  values: number
  rows: number
}

export type ProjectReadResult =
  | { ok: true; project: ProjectFile; sourceVersion: 1 | 2 | 3; dropped: { surface: DroppedSurface | null } }
  | { ok: false; detail: string }

const describeIssues = (issues: readonly z.ZodIssue[]) =>
  issues.slice(0, 5).map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ')

const countOf = (value: unknown) => (Array.isArray(value) ? value.length : 0)

function droppedSurface(surface: Record<string, unknown> | null): DroppedSurface | null {
  if (surface === null) return null
  const name = typeof surface.name === 'string' && surface.name.length <= 64 ? surface.name : null
  const values = typeof surface.values === 'object' && surface.values !== null ? surface.values as Record<string, unknown> : {}
  // 版 1 の保持値は values と records、版 2 は values と rows
  return { name, values: countOf(values.values), rows: countOf(values.rows) + countOf(values.records) }
}

/**
 * プロジェクトファイルを読む(取り込みと検査で共通。判定の正はここだけで、UI は写しを持たない。D-122)。版 3 はそのまま検証し、
 * 版 1・版 2 は版 3 へ移す。パッドを持たないファイル(サーフェス定義だけのもの)は、取り込めるものが無いので理由を返して断る
 * (黙って空のプロジェクトとして通さない)。大きさの上限(MAX_SERIALIZED_BYTES)は呼び出し側が先に見る
 */
export function readProjectFile(value: unknown): ProjectReadResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false, detail: 'invalid: <root>: not a JSON object' }
  const raw = value as Record<string, unknown>
  // 定義のファイルを取り違えたときは、形の違いの列挙より先にそう伝える(利用者が次にすることが分かるように)
  if (raw.format === SURFACE_FILE_FORMAT) return { ok: false, detail: 'surface-file: this is a surface definition file, which this version no longer reads' }
  if (raw.version === PROJECT_FILE_VERSION || raw.format !== PROJECT_FILE_FORMAT) {
    const parsed = ProjectFileSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, detail: `invalid: ${describeIssues(parsed.error.issues)}` }
    return { ok: true, project: parsed.data, sourceVersion: 3, dropped: { surface: null } }
  }
  let source: { exportedAt: string; surface: Record<string, unknown> | null; pad: { name: string; pad?: unknown } | null; version: 1 | 2 }
  if (raw.version === 1) {
    const parsed = LegacyV1Schema.safeParse(raw)
    if (!parsed.success) return { ok: false, detail: `invalid: ${describeIssues(parsed.error.issues)}` }
    source = { exportedAt: parsed.data.exportedAt, surface: parsed.data.surface, pad: parsed.data.pad, version: 1 }
  } else if (raw.version === 2) {
    const parsed = LegacyV2Schema.safeParse(raw)
    if (!parsed.success) return { ok: false, detail: `invalid: ${describeIssues(parsed.error.issues)}` }
    source = { exportedAt: parsed.data.exportedAt, surface: parsed.data.surface, pad: parsed.data.osc?.pad ?? null, version: 2 }
  } else {
    return { ok: false, detail: `unsupported-version: ${String(raw.version).slice(0, 32)} (this bridge reads versions 1 to ${String(PROJECT_FILE_VERSION)})` }
  }
  const dropped = droppedSurface(source.surface)
  if (source.pad === null) {
    const named = dropped?.name ?? null
    return { ok: false, detail: `surface-only: the file holds no pad${named === null ? '' : `, only the surface definition "${named}"`}, and this version no longer reads surface definitions` }
  }
  const pad = PadDocumentStoredSchema.safeParse(upgradePadDocument(source.pad.pad))
  if (!pad.success) return { ok: false, detail: `invalid: pad.pad: ${describeIssues(pad.error.issues)}` }
  return {
    ok: true,
    sourceVersion: source.version,
    project: {
      format: PROJECT_FILE_FORMAT,
      version: PROJECT_FILE_VERSION,
      exportedAt: source.exportedAt,
      // 版 1・版 2 のファイルにパッドの保持値と送り先は無い(版 1 のパッドはボタンだけで値を持たない)
      osc: { pad: { name: source.pad.name, pad: pad.data }, values: { widgets: [], rows: [] } },
      destinations: [],
    },
    dropped: { surface: dropped },
  }
}

/** プロジェクトの JSON(区切りの空白なし)の UTF-8 のバイト数。取り込み・書き出しの上限(MAX_SERIALIZED_BYTES)と比べる。 */
export function projectSerializedBytes(project: unknown): number {
  return new TextEncoder().encode(JSON.stringify(project)).length
}
