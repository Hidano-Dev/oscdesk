import { z } from 'zod'

// 保存する文書(OSC パッド)のファイル名(拡張子なし)。名前はサーフェス定義の名前の規則を引き継いだ(定義は撤去した。D-175)。
// ブリッジはこれをそのままファイル名に使うため、パス区切り・先頭ドット(隠しフォルダの .backups を含む)・Windows の予約デバイス名を
// 境界で拒否する。これを緩めると UI からの保存要求で保管フォルダの外へ書ける。
// wire とプロジェクトファイル(D-090)の両方が使うので、循環 import を避けて独立させている
export const SURFACE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
export function isValidSurfaceName(name: string): boolean {
  return SURFACE_NAME_PATTERN.test(name) && !WINDOWS_RESERVED_NAME.test(name)
}
export const SurfaceNameSchema = z.string().refine(isValidSurfaceName, { message: 'invalid surface name' })
