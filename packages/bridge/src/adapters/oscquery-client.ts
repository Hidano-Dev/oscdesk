import http from 'node:http'

import { WebSocket } from 'ws'

import { OSCQUERY } from '@oscdesk/shared'

import type { OscQueryClient, OscQueryFetchResult } from '../domain/oscquery-targets'

// OSCQuery の HTTP と WebSocket のクライアント(D-168)。ライブラリに頼らず自前で持つのは、大きさ・時間の上限と
// 未対応の属性への応答(204 と 400)の扱いをここで決めるため(HID-484 §2・§6)。
// リダイレクトは追わない(ターゲットが名前空間を別のホストへ向けられると、LAN の外へ取りに行かされる)

const MAX_WS_MESSAGE_BYTES = 64 * 1024

export function createOscQueryClient(options: { maxBytes?: number; wsHandshakeTimeoutMs?: number } = {}): OscQueryClient {
  const maxBytes = options.maxBytes ?? OSCQUERY.MAX_RESPONSE_BYTES
  return {
    read: (host, port, query, signal) => fetchJson({ host, port, query, signal, maxBytes }),
    watch(host, port, handlers) {
      let closed = false
      const finish = (reason: string) => {
        if (closed) return
        closed = true
        handlers.onClose(reason)
      }
      const socket = new WebSocket(`ws://${formatHost(host)}:${String(port)}/`, {
        maxPayload: MAX_WS_MESSAGE_BYTES,
        handshakeTimeout: options.wsHandshakeTimeoutMs ?? 5_000,
        followRedirects: false,
        perMessageDeflate: false,
      })
      socket.on('message', (data, isBinary) => {
        // バイナリは LISTEN した値の OSC(LISTEN は送らないので来ないはず)。読まない
        if (isBinary) return
        const command = readCommand(data.toString())
        if (command !== null && command.startsWith('PATH_')) handlers.onPathEvent(command)
      })
      socket.on('error', error => finish(error.message))
      socket.on('close', code => finish(`closed with ${String(code)}`))
      return {
        close() {
          closed = true
          socket.removeAllListeners('message')
          socket.on('error', () => undefined)
          socket.terminate()
        },
      }
    },
  }
}

function readCommand(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null
    const command = (parsed as { COMMAND?: unknown }).COMMAND
    return typeof command === 'string' ? command : null
  } catch {
    return null
  }
}

// IPv6 のアドレスは URL で [] に包む(いまは IPv4 だけを扱うが、設定で書かれた場合に壊れた URL を作らない)
function formatHost(host: string): string {
  return host.includes(':') ? `[${host}]` : host
}

function fetchJson(input: {
  host: string
  port: number
  query: 'HOST_INFO' | null
  signal: AbortSignal
  maxBytes: number
}): Promise<OscQueryFetchResult> {
  return new Promise((resolve, reject) => {
    if (input.signal.aborted) {
      reject(abortReason(input.signal))
      return
    }
    const request = http.get({
      host: input.host,
      port: input.port,
      path: input.query === null ? '/' : `/?${input.query}`,
      headers: { accept: 'application/json' },
      // 同じターゲットを何度も取りに行くが、取り終えたら接続を残さない(終了時にソケットが Node を生かし続けないため)
      agent: false,
    })
    const onAbort = () => request.destroy(abortReason(input.signal))
    input.signal.addEventListener('abort', onAbort, { once: true })
    const done = () => input.signal.removeEventListener('abort', onAbort)
    request.on('error', error => {
      done()
      reject(error)
    })
    request.on('response', response => {
      const status = response.statusCode ?? 0
      if (status === 204 || status === 400) {
        response.resume()
        response.on('end', () => {
          done()
          resolve({ kind: 'unsupported', status })
        })
        return
      }
      if (status !== 200) {
        response.resume()
        done()
        request.destroy()
        reject(new Error(`HTTP ${String(status)}`))
        return
      }
      const declared = Number(response.headers['content-length'])
      if (Number.isFinite(declared) && declared > input.maxBytes) {
        done()
        request.destroy()
        reject(new Error(`the response is larger than ${String(input.maxBytes)} bytes`))
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > input.maxBytes) {
          done()
          request.destroy()
          reject(new Error(`the response is larger than ${String(input.maxBytes)} bytes`))
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => {
        done()
        if (size > input.maxBytes) return
        try {
          resolve({ kind: 'json', value: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown })
        } catch (error) {
          reject(new Error(`invalid JSON: ${error instanceof Error ? error.message : String(error)}`))
        }
      })
      response.on('error', error => {
        done()
        reject(error)
      })
    })
  })
}

function abortReason(signal: AbortSignal): Error {
  const reason = signal.reason as unknown
  return reason instanceof Error ? reason : new Error('aborted')
}
