// 試作の SPA(HID-461。packages/spa-prototype/dist)を /spa/ に配る。--spa-prototype を渡したときだけ作る(既定の挙動は変えない)。
// 配るのは決まった名前のファイルだけで、パスからファイル名を組み立てない(../ などで dist の外を読ませないため)
import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

export const SPA_PREFIX = '/spa/'

const FILES: Readonly<Record<string, { file: string; type: string }>> = {
  '/spa/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/spa/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/spa/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/spa/app.js.map': { file: 'app.js.map', type: 'application/json; charset=utf-8' },
}

export interface SpaStatic {
  /** /spa の要求なら応答して true。 */
  handle(request: IncomingMessage, response: ServerResponse): boolean
}

export function createSpaStatic(options: { dir: string; readFile?: (filePath: string) => Buffer }): SpaStatic {
  const readFile = options.readFile ?? ((filePath: string) => fs.readFileSync(filePath))
  return {
    handle(request, response) {
      const pathname = (request.url ?? '').split('?')[0]
      if (pathname === '/spa') {
        response.writeHead(301, { Location: SPA_PREFIX })
        response.end()
        return true
      }
      if (!pathname.startsWith(SPA_PREFIX)) return false
      const entry = FILES[pathname]
      if (entry === undefined || (request.method !== 'GET' && request.method !== 'HEAD')) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        response.end('not found')
        return true
      }
      let body: Buffer
      try {
        // 開発中はビルドし直したらブラウザを読み込み直すだけで新しいものが出るよう、毎回読む
        body = readFile(path.join(options.dir, entry.file))
      } catch {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        response.end('spa-prototype is not built (run: corepack pnpm -r run build)')
        return true
      }
      response.writeHead(200, { 'Content-Type': entry.type, 'Content-Length': body.length, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' })
      response.end(request.method === 'HEAD' ? undefined : body)
      return true
    },
  }
}
