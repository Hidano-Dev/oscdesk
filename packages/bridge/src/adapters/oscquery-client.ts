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
      let socket: WebSocket
      try {
        socket = new WebSocket(`ws://${formatHost(host)}:${String(port)}/`, {
          maxPayload: MAX_WS_MESSAGE_BYTES,
          handshakeTimeout: options.wsHandshakeTimeoutMs ?? 5_000,
          followRedirects: false,
          perMessageDeflate: false,
        })
      } catch (error) {
        // URL にできないホスト(設定の書き間違い)でも例外を投げない。読み込みは成功のまま、監視だけが失敗する
        setImmediate(() => finish(error instanceof Error ? error.message : String(error)))
        return { close() { closed = true } }
      }
      socket.on('open', () => {
        if (!closed) handlers.onOpen?.()
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
    // 応答の途中で切れる・中断される・大きさを超えるのどれでも、必ず 1 回だけ決着させる。決着しないと読み込みが
    // 失敗にも読み直しにも進まず、そのターゲットが止まったままになる(204・400 の本文の途中切断も同じ)
    let settled = false
    const finish = (outcome: { ok: true; value: OscQueryFetchResult } | { ok: false; error: Error }) => {
      if (settled) return
      settled = true
      input.signal.removeEventListener('abort', onAbort)
      if (outcome.ok) resolve(outcome.value)
      else {
        request.destroy()
        reject(outcome.error)
      }
    }
    const fail = (error: unknown) => finish({ ok: false, error: error instanceof Error ? error : new Error(String(error)) })
    const request = http.get({
      host: input.host,
      port: input.port,
      path: input.query === null ? '/' : `/?${input.query}`,
      headers: { accept: 'application/json' },
      // 同じターゲットを何度も取りに行くが、取り終えたら接続を残さない(終了時にソケットが Node を生かし続けないため)
      agent: false,
    })
    const onAbort = () => fail(abortReason(input.signal))
    input.signal.addEventListener('abort', onAbort, { once: true })
    request.on('error', fail)
    request.on('response', response => {
      const status = response.statusCode ?? 0
      let ended = false
      response.on('error', fail)
      response.on('aborted', () => fail(new Error('the connection closed before the response ended')))
      response.on('close', () => {
        if (!ended) fail(new Error('the connection closed before the response ended'))
      })
      if (status === 204 || status === 400) {
        // 本文は読まずに捨てる(終わりまで届いてから未対応として決着させる)
        response.resume()
        response.on('end', () => {
          ended = true
          finish({ ok: true, value: { kind: 'unsupported', status } })
        })
        return
      }
      if (status !== 200) {
        fail(new Error(`HTTP ${String(status)}`))
        return
      }
      const declared = Number(response.headers['content-length'])
      if (Number.isFinite(declared) && declared > input.maxBytes) {
        fail(new Error(`the response is larger than ${String(input.maxBytes)} bytes`))
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer) => {
        if (settled) return
        size += chunk.length
        if (size > input.maxBytes) {
          fail(new Error(`the response is larger than ${String(input.maxBytes)} bytes`))
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => {
        ended = true
        if (settled) return
        try {
          finish({ ok: true, value: { kind: 'json', value: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown } })
        } catch (error) {
          fail(new Error(`invalid JSON: ${error instanceof Error ? error.message : String(error)}`))
        }
      })
    })
  })
}
function abortReason(signal: AbortSignal): Error {
  const reason = signal.reason as unknown
  return reason instanceof Error ? reason : new Error('aborted')
}
