// SPA のバンドルの設定(D-138)。build.mjs と、バンドルが古いブラウザで読めるかを確かめるテスト(src/bundle-compat.test.ts)が同じものを使う
import path from 'node:path'

/** 対応するブラウザ。iOS 15 の Safari まで(会場の古い iPhone・iPad で開けるように)。 */
export const BROWSER_TARGETS = ['es2020', 'safari15']

export function bundleOptions(root) {
  return {
    entryPoints: [path.join(root, 'src/main.tsx')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: BROWSER_TARGETS,
    jsx: 'automatic',
    jsxImportSource: 'preact',
    minify: true,
    logLevel: 'warning',
  }
}
