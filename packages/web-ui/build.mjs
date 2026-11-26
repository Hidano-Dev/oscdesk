// SPA(D-137・D-138)を dist/ に書き出す。バンドラはブリッジ・mock-unity と同じ esbuild を使い、Vite などの開発サーバーは足さない
// (ブリッジが dist/ をそのまま配るので、開発中も `pnpm -r run build` の後に読み込み直すだけでよい)。
// 書き出すファイルの名前はブリッジの adapters/web-ui-static.ts の WEB_UI_FILES と揃える(ブリッジは決まった名前だけを配る)
import { copyFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const root = path.dirname(fileURLToPath(import.meta.url))
const outdir = path.join(root, 'dist')
mkdirSync(outdir, { recursive: true })

const result = await build({
  entryPoints: [path.join(root, 'src/main.tsx')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020', 'safari15'],
  jsx: 'automatic',
  jsxImportSource: 'preact',
  minify: true,
  sourcemap: true,
  metafile: true,
  outfile: path.join(outdir, 'app.js'),
  logLevel: 'warning',
})
copyFileSync(path.join(root, 'src/index.html'), path.join(outdir, 'index.html'))
copyFileSync(path.join(root, 'src/app.css'), path.join(outdir, 'app.css'))

const bytes = Object.values(result.metafile.outputs).find((output) => output.entryPoint !== undefined)?.bytes ?? 0
process.stdout.write(`web-ui: dist/app.js ${(bytes / 1024).toFixed(1)} KiB (minified)\n`)
