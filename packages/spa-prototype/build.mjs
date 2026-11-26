// 試作の SPA(HID-461)を dist/ に書き出す。バンドラはブリッジ・mock-unity と同じ esbuild を使い、Vite などの開発サーバーは足さない
// (ブリッジが dist/ をそのまま配るので、開発中も `pnpm -r run build` の後に読み込み直すだけでよい)
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

const bytes = Object.values(result.metafile.outputs).find((output) => output.entryPoint !== undefined)?.bytes ?? 0
process.stdout.write(`spa-prototype: dist/app.js ${(bytes / 1024).toFixed(1)} KiB (minified)\n`)
