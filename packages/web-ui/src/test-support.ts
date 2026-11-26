// テスト用の部品(D-138)。どのパネルのテストも、偽の WebSocket にフレームを流して送ったフレームと signal・DOM を確かめる。
// 本体(main.tsx から辿れるもの)からは import しない(node:fs を使うのでバンドルに入れられない)
import fs from 'node:fs'
import path from 'node:path'

import { DownstreamFrameSchema, type DestinationsFrame, type DownstreamFrame } from '@oscdesk/shared'

import { createBridgeLink, type BridgeLink, type SocketLike } from './bridge-link'
import { createNotices, type Notices } from './notices'

export class FakeSocket implements SocketLike {
  sent: Record<string, unknown>[] = []
  closed = false
  onopen: ((event: unknown) => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: ((event: { code?: number }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  send(data: string) { this.sent.push(JSON.parse(data) as Record<string, unknown>) }
  /** ページ側から閉じる(ブラウザの close() は 1005 で onclose を呼ぶ)。 */
  close() { this.drop(1005) }
  /** ブリッジ側から閉じられた(code はブリッジが選ぶ。1008 は許可の外)。 */
  drop(code = 1006) {
    if (this.closed) return
    this.closed = true
    this.onclose?.({ code })
  }
  open() { this.onopen?.({}) }
  receive(frame: unknown) { this.onmessage?.({ data: JSON.stringify(frame) }) }
  ofType(type: string) { return this.sent.filter((frame) => frame.type === type) }
}

export interface FakeTimers {
  now(): number
  setTimer(callback: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
  advance(ms: number): void
}

export function createFakeTimers(start = 1_000): FakeTimers {
  const timers: { at: number; callback: () => void; done: boolean }[] = []
  let clock = start
  return {
    now: () => clock,
    setTimer(callback, ms) {
      const timer = { at: clock + ms, callback, done: false }
      timers.push(timer)
      return timer
    },
    clearTimer(handle) { (handle as { done: boolean }).done = true },
    advance(ms) {
      clock += ms
      for (const timer of [...timers]) {
        if (!timer.done && timer.at <= clock) {
          timer.done = true
          timer.callback()
        }
      }
    },
  }
}

export interface TestLink {
  link: BridgeLink
  notices: Notices
  timers: FakeTimers
  sockets: FakeSocket[]
  /** 今の(最後に作られた)偽の WebSocket。 */
  socket(): FakeSocket
  warnings: unknown[][]
}

/** 偽の WebSocket につないだ接続。open: true なら開いた状態で返す。 */
export function createTestLink(options: { open?: boolean } = {}): TestLink {
  const sockets: FakeSocket[] = []
  const timers = createFakeTimers()
  const warnings: unknown[][] = []
  const link = createBridgeLink({
    url: 'ws://127.0.0.1:7080/',
    createSocket: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
    setTimer: timers.setTimer,
    logWarn: (...args) => warnings.push(args),
  })
  link.start()
  if (options.open !== false) sockets[0].open()
  return { link, notices: createNotices(), timers, sockets, socket: () => sockets[sockets.length - 1], warnings }
}

const SAMPLES_PATH = path.resolve(__dirname, '../../../protocol/wire-samples.json')

interface Case { name: string; frame: unknown }

/** protocol/wire-samples.json の見本を、shared のスキーマで読んだ型付きの値として返す。 */
export function wireSample(name: string): DownstreamFrame {
  const cases = (JSON.parse(fs.readFileSync(SAMPLES_PATH, 'utf8')) as { cases: Case[] }).cases
  const found = cases.find((item) => item.name === name)
  if (found === undefined) throw new Error(`no sample ${name}`)
  return DownstreamFrameSchema.parse(found.frame)
}

export function destinationsSample(name: string): DestinationsFrame {
  const parsed = wireSample(name)
  if (parsed.type !== 'destinations') throw new Error(`${name} is not a destinations frame`)
  return parsed
}
