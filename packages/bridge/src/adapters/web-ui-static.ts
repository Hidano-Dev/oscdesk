// SPA(packages/web-ui の dist。D-137・D-138)をブリッジの HTTP の / に配る。
// 配るのは決まった名前のファイルだけで、パスからファイル名を組み立てない(../ などで dist の外を読ませないため)。
// 受けてよい接続元・Host かは ui-hub がこの前に確かめる
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import zlib from 'node:zlib'

interface Entry { file: string; type: string }

const HTML = 'text/html; charset=utf-8'
export const WEB_UI_FILES: Readonly<Record<string, Entry>> = {
  '/': { file: 'index.html', type: HTML },
  '/index.html': { file: 'index.html', type: HTML },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/app.js.map': { file: 'app.js.map', type: 'application/json; charset=utf-8' },
  '/app.css': { file: 'app.css', type: 'text/css; charset=utf-8' },
}

export const WEB_UI_PATH = '/'

// これより小さいものは圧縮しても得が無い(gzip のヘッダの分だけ大きくなりうる)
const GZIP_MIN_BYTES = 1024

export interface WebUiStatic {
  /** SPA のファイルの要求なら応答して true。 */
  handle(request: IncomingMessage, response: ServerResponse): boolean
}

interface Prepared { mtimeMs: number; size: number; body: Buffer; gzip: Buffer | null; etag: string }

export interface WebUiStaticFs {
  stat(filePath: string): { mtimeMs: number; size: number }
  read(filePath: string): Buffer
}

const NODE_FS: WebUiStaticFs = {
  stat: (filePath) => fs.statSync(filePath),
  read: (filePath) => fs.readFileSync(filePath),
}

/** Accept-Encoding が gzip を受けるか(q=0 は断りの意味)。 */
export function acceptsGzip(header: string | string[] | undefined): boolean {
  const text = Array.isArray(header) ? header.join(',') : header ?? ''
  return text.split(',').some((part) => {
    const [coding, ...params] = part.trim().toLowerCase().split(';')
    if (coding.trim() !== 'gzip' && coding.trim() !== '*') return false
    const q = params.map((param) => param.trim()).find((param) => param.startsWith('q='))
    return q === undefined || Number(q.slice(2)) > 0
  })
}

export function createWebUiStatic(options: { dir: string; fs?: WebUiStaticFs }): WebUiStatic {
  const files = options.fs ?? NODE_FS
  // 圧縮は 1 ファイルにつき中身が変わったときだけ行う。開発中はビルドし直したら読み込み直すだけで新しいものが出るよう、
  // 要求のたびに更新時刻と大きさを見る(ファイルを見張らない)
  const cache = new Map<string, Prepared>()

  const prepare = (file: string): Prepared => {
    const filePath = path.join(options.dir, file)
    const stat = files.stat(filePath)
    const cached = cache.get(file)
    if (cached !== undefined && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached
    const body = files.read(filePath)
    const prepared: Prepared = {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      body,
      gzip: body.length >= GZIP_MIN_BYTES ? zlib.gzipSync(body, { level: 9 }) : null,
      // 弱い ETag にする(gzip と素のものは同じ中身として同じ値で確かめられる)
      etag: `W/"${createHash('sha1').update(body).digest('base64url')}"`,
    }
    cache.set(file, prepared)
    return prepared
  }

  return {
    handle(request, response) {
      const pathname = (request.url ?? '').split('?')[0]
      const entry = WEB_UI_FILES[pathname]
      if (entry === undefined) return false
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' })
        response.end('method not allowed')
        return true
      }
      let prepared: Prepared
      try {
        prepared = prepare(entry.file)
      } catch {
        response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
        response.end(
          'SPA(packages/web-ui)がビルドされていません。launchers\\setup-oscdesk.bat か corepack pnpm -r run build を実行してください。\n'
          + 'The web UI is not built. Run: corepack pnpm -r run build\n',
        )
        return true
      }
      const headers: Record<string, string | number> = {
        'Content-Type': entry.type,
        // 毎回確かめ直させる(ブリッジを更新したら読み込み直すだけで新しい SPA になる)。中身が同じなら 304 で済む
        'Cache-Control': 'no-cache',
        ETag: prepared.etag,
        Vary: 'Accept-Encoding',
        'X-Content-Type-Options': 'nosniff',
        // 認証が無いので、第三者のページに枠で埋め込ませて押させる(クリックジャッキング)ことを断る
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "frame-ancestors 'none'",
        'Referrer-Policy': 'no-referrer',
      }
      if (request.headers['if-none-match'] === prepared.etag) {
        response.writeHead(304, headers)
        response.end()
        return true
      }
      const gzip = prepared.gzip !== null && acceptsGzip(request.headers['accept-encoding'])
      const body = gzip && prepared.gzip !== null ? prepared.gzip : prepared.body
      if (gzip) headers['Content-Encoding'] = 'gzip'
      headers['Content-Length'] = body.length
      response.writeHead(200, headers)
      response.end(request.method === 'HEAD' ? undefined : body)
      return true
    },
  }
}
