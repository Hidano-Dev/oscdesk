import { SENT_LOG, type DownstreamFrame, type OscArg, type SentLogOrigin, type SentLogRecord, type WireArg } from '@oscdesk/shared'

type TimerHandle = ReturnType<typeof setTimeout> | number

/** surface-core が Unity へ実際に送った 1 回分(宛先をまとめた単位)。 */
export interface SentEvent {
  readonly origin: SentLogOrigin
  readonly targets: readonly string[]
  readonly messages: readonly { address: string; args: readonly OscArg[] }[]
  /** true なら messages は 1 つの OSC bundle(まとめ送り)で送ったもの */
  readonly batch?: boolean
}

export interface SentLog {
  record(event: SentEvent): void
  /** 保持している記録の全量を、その UI だけへ送る(先頭のフレームが full: true)。 */
  publishBacklog(clientId: string): void
  snapshot(): readonly SentLogRecord[]
  close(): void
}

export interface SentLogOptions {
  publish: (frame: DownstreamFrame, target?: string) => void
  now?: () => number
  setTimeoutFn?: (cb: () => void, ms: number) => TimerHandle
  clearTimeoutFn?: (handle: TimerHandle) => void
  capacity?: number
}

// 連続操作(スライダーのドラッグ等)で間引いてまとめる契機。UI の 1 回の操作か OSC ネイティブ UI の中継だけで、
// 再送・行の生成・要求・まとめ送りは 1 件ずつ残す(何をいつ送り直したかを追えるように)
const COALESCED_ORIGINS: ReadonlySet<SentLogOrigin> = new Set(['ui', 'relay'])

interface Entry {
  record: SentLogRecord
  firstAtMs: number
  identity: string
}

/**
 * Unity へ送った OSC の直近の記録(D-067)。件数の上限つきで持ち、UI へは間引いて配る。
 *
 * 送信のたびにフレームを送ると、スライダーの連続送信がそのまま WebSocket の流量になる。
 * そこで (1) 同じアドレス(レコードは同じキー)への連続送信は COALESCE_WINDOW_MS の間 1 件にまとめて count を増やし、
 * (2) 変わった記録を FLUSH_INTERVAL_MS ごとに 1 フレームで配る。証跡としての完全さは NDJSON 診断ログ(D-031)が担い、
 * こちらは揮発する表示用の窓である。
 */
export function createSentLog(options: SentLogOptions): SentLog {
  const now = options.now ?? Date.now
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout
  const capacity = options.capacity ?? SENT_LOG.CAPACITY
  const entries: Entry[] = []
  const pending = new Set<number>()
  let nextSeq = 1
  let nextBatchId = 1
  let timer: TimerHandle | null = null
  let closed = false

  const push = (entry: Entry) => {
    entries.push(entry)
    if (entries.length > capacity) {
      const evicted = entries.splice(0, entries.length - capacity)
      for (const old of evicted) pending.delete(old.record.seq)
    }
    pending.add(entry.record.seq)
  }

  const flush = () => {
    timer = null
    if (pending.size === 0) return
    const records = entries.filter(entry => pending.has(entry.record.seq)).map(entry => entry.record)
    pending.clear()
    for (const chunk of chunks(records)) options.publish({ v: 1, type: 'osc.sentLog', full: false, records: chunk })
  }

  const scheduleFlush = () => {
    if (timer !== null || closed) return
    timer = setTimeoutFn(flush, SENT_LOG.FLUSH_INTERVAL_MS)
  }

  return {
    record(event) {
      if (closed || event.targets.length === 0 || event.messages.length === 0) return
      const timestamp = now()
      const at = new Date(timestamp).toISOString()
      const targets = [...event.targets]
      const batchId = event.batch === true ? nextBatchId++ : null
      event.messages.forEach((message, index) => {
        const { args, clipped } = clipArgs(message.args)
        const identity = `${event.origin}\n${targets.join('\n')}\n${message.address}\n${keyOf(message.args)}`
        const last = entries.at(-1)
        if (
          batchId === null
          && COALESCED_ORIGINS.has(event.origin)
          && last !== undefined
          && last.identity === identity
          && last.record.batch === null
          && timestamp - last.firstAtMs < SENT_LOG.COALESCE_WINDOW_MS
        ) {
          last.record = { ...last.record, at, args, clipped, count: last.record.count + 1 }
          pending.add(last.record.seq)
          return
        }
        push({
          firstAtMs: timestamp,
          identity,
          record: {
            seq: nextSeq++,
            at,
            origin: event.origin,
            targets,
            address: message.address,
            args,
            count: 1,
            batch: batchId === null ? null : { id: batchId, index, size: event.messages.length },
            clipped,
          },
        })
      })
      scheduleFlush()
    },
    publishBacklog(clientId) {
      const records = entries.map(entry => entry.record)
      const frames = chunks(records)
      // 空でも full: true を 1 つ送る。ブリッジが再起動すると seq が 1 に戻るため、UI の古い記録を必ず捨てさせる
      if (frames.length === 0) frames.push([])
      frames.forEach((chunk, index) => options.publish({ v: 1, type: 'osc.sentLog', full: index === 0, records: chunk }, clientId))
    },
    snapshot() {
      return entries.map(entry => entry.record)
    },
    close() {
      closed = true
      if (timer !== null) clearTimeoutFn(timer)
      timer = null
      pending.clear()
    },
  }
}

function chunks(records: readonly SentLogRecord[]): SentLogRecord[][] {
  const result: SentLogRecord[][] = []
  for (let index = 0; index < records.length; index += SENT_LOG.MAX_RECORDS_PER_FRAME) {
    result.push(records.slice(index, index + SENT_LOG.MAX_RECORDS_PER_FRAME))
  }
  return result
}

// レコード(先頭が s のキー)は行ごとに別の記録にする。まとめると別の行への送信が 1 件に見えてしまう
function keyOf(args: readonly OscArg[]): string {
  const head = args[0]
  return head?.type === 's' ? head.value : ''
}

/**
 * 表示用に引数を切り詰める。長い文字列や blob を丸ごと載せると、記録 1 件で UI の受信上限(1 MiB)に近づくため。
 * 有限でない f は JSON で表せない(null になり UI が捨てる)ので、文字列にして切り詰めたものとして扱う
 */
export function clipArgs(args: readonly OscArg[]): { args: WireArg[]; clipped: boolean } {
  let clipped = args.length > SENT_LOG.MAX_ARGS
  const result = args.slice(0, SENT_LOG.MAX_ARGS).map((arg): WireArg => {
    if (arg.type === 's') {
      if (arg.value.length <= SENT_LOG.MAX_STRING_CHARS) return arg
      clipped = true
      return { type: 's', value: arg.value.slice(0, SENT_LOG.MAX_STRING_CHARS) }
    }
    if (arg.type === 'b') {
      const bytes = arg.value.length > SENT_LOG.MAX_BLOB_BYTES ? arg.value.subarray(0, SENT_LOG.MAX_BLOB_BYTES) : arg.value
      if (bytes !== arg.value) clipped = true
      return { type: 'b', value: Buffer.from(bytes).toString('base64') }
    }
    if (!Number.isFinite(arg.value)) {
      clipped = true
      return { type: 's', value: String(arg.value) }
    }
    return arg
  })
  return { args: result, clipped }
}
