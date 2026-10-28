import { z } from 'zod'

import { OscPadSchema } from './osc-pad'
import { SurfaceDefinitionSchema } from './surface-definition'
import { SurfaceNameSchema } from './surface-name'

// プロジェクトファイル(D-090)。採用中のサーフェス定義・その保持値・採用中の OSC パッドを 1 つの JSON にまとめ、
// ブラウザでダウンロード・アップロードして利用者が保管する。取り込みは画面と保持値を置き換えるだけで、
// Unity へは送らない(送るのは利用者の明示の操作)。正典はこの zod で、ブリッジが取り込む前に検証する。

export const PROJECT_FILE_FORMAT = 'oscdesk-project'
export const PROJECT_FILE_VERSION = 1

export const PROJECT_FILE = {
  // プロジェクトの JSON(区切りの空白なし、UTF-8)の上限。書き出しは project フレームで UI へ届き、UI の受信上限は
  // 16 MiB(D-071)なので、パッドの上限 8 MiB(D-080)と定義・保持値を収めつつ余裕を残す値にする
  MAX_SERIALIZED_BYTES: 12 * 1024 * 1024,
  // 書き出しの要求と応答を結ぶ印。UI のプロセスはブラウザのページを複数抱えるので、どのページの要求かを返す
  MAX_REQUEST_ID_CHARS: 64,
} as const

const INT32_MIN = -2147483648
const INT32_MAX = 2147483647

// 保持値に入るのは state の i / f / s(bool は i の 0/1)だけなので、blob は受けない。
// 形は保持値の保存ファイル(D-058 / D-087)と同じで、ブリッジの desired-values-file もこれを使う
export const HeldArgSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('i'), value: z.number().int().min(INT32_MIN).max(INT32_MAX) }).strict(),
  z.object({ type: z.literal('f'), value: z.number().finite() }).strict(),
  z.object({ type: z.literal('s'), value: z.string() }).strict(),
])

export const HeldValueSchema = z.object({
  id: z.string().min(1),
  address: z.string().min(1),
  type: z.enum(['i', 'f', 's', 'bool']),
  args: z.array(HeldArgSchema),
}).strict()

// レコードの 1 行(D-062)。フィールドは位置でなく id で照合するので、定義でフィールドを並べ替えても戻せる。
// key は行のキーで、UI で管理する一覧のレコード(D-087)では行の ID
export const HeldRecordRowSchema = z.object({
  id: z.string().min(1),
  address: z.string().min(1),
  key: z.string(),
  fields: z.array(z.object({
    id: z.string().min(1),
    type: z.enum(['i', 'f', 's', 'bool']),
    arg: HeldArgSchema,
  }).strict()),
}).strict()

// UI で管理する一覧(D-075 / D-087)。行ごとに変わらない ID と変えられる Name を、追加した順に持つ
export const HeldKeyListSchema = z.object({
  address: z.string().min(1),
  rows: z.array(z.object({ id: z.string().min(1), name: z.string() }).strict()),
}).strict()

export const HeldValuesSchema = z.object({
  values: z.array(HeldValueSchema),
  records: z.array(HeldRecordRowSchema),
  keyLists: z.array(HeldKeyListSchema).optional(),
}).strict()

export const ProjectFileSchema = z.object({
  format: z.literal(PROJECT_FILE_FORMAT),
  version: z.literal(PROJECT_FILE_VERSION),
  exportedAt: z.string().datetime({ offset: true }),
  // 保持値は定義ごとに意味が決まる(照合は定義の id・型・値域で行う。D-058)ので、定義の中に置く
  surface: z.object({
    name: SurfaceNameSchema,
    definition: SurfaceDefinitionSchema,
    values: HeldValuesSchema,
  }).strict().nullable(),
  pad: z.object({
    name: SurfaceNameSchema,
    pad: OscPadSchema,
  }).strict().nullable(),
}).strict().refine(project => project.surface !== null || project.pad !== null, {
  message: 'project must contain a surface or a pad',
})

export type HeldArg = z.infer<typeof HeldArgSchema>
export type HeldValues = z.infer<typeof HeldValuesSchema>
export type ProjectFile = z.infer<typeof ProjectFileSchema>

/** プロジェクトの JSON(区切りの空白なし)の UTF-8 のバイト数。取り込み・書き出しの上限(MAX_SERIALIZED_BYTES)と比べる。 */
export function projectSerializedBytes(project: unknown): number {
  return new TextEncoder().encode(JSON.stringify(project)).length
}
