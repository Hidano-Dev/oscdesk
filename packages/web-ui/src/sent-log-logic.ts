// 送信ログ(D-067)と通知の履歴の表示の規則。
// 送信の記録の正はブリッジが持ち、UI は直近の窓を表示するだけ。証跡は NDJSON 診断ログ(D-031)にある
import { SENT_LOG, type SentLogRecord, type WireArg } from '@oscdesk/shared'

import type { NoticeLevel, NoticeRecord } from './notices'

/** ブリッジの保持件数と同じ。多く持っても再接続の既存分でブリッジの件数に揃うので、ここで増やす意味は無い。 */
export const SENT_LOG_CAPACITY: number = SENT_LOG.CAPACITY

export const ORIGIN_LABELS: Record<SentLogRecord['origin'], string> = {
  ui: '操作',
  action: 'まとめ送り',
  resend: '再送',
  row: '行の生成',
  request: '一覧の要求',
  relay: 'OSC 中継',
  pad: 'OSC パッド',
}

export const LEVEL_LABELS: Record<NoticeLevel, string> = { info: '情報', warn: '警告', error: 'エラー' }

/**
 * 届いた osc.sentLog を手元の記録へ当てる。full なら置き換え(ブリッジの再起動で seq が 1 に戻るので古い記録は必ず捨てる)、
 * そうでなければ seq で追加・置き換え(間引きで更新された記録は同じ seq で届き直す)。上限を超えたら古い seq から捨てる
 */
export function applySentLog(
  current: ReadonlyMap<number, SentLogRecord>,
  full: boolean,
  records: readonly SentLogRecord[],
  capacity: number = SENT_LOG_CAPACITY,
): Map<number, SentLogRecord> {
  const next = full ? new Map<number, SentLogRecord>() : new Map(current)
  for (const record of records) next.set(record.seq, record)
  if (next.size > capacity) {
    const drop = [...next.keys()].sort((a, b) => a - b).slice(0, next.size - capacity)
    for (const seq of drop) next.delete(seq)
  }
  return next
}

/** 新しい順。 */
export function newestFirst(records: ReadonlyMap<number, SentLogRecord>): SentLogRecord[] {
  return [...records.values()].sort((a, b) => b.seq - a.seq)
}

/** 引数の見せ方(f は %g 相当、s は引用符つき)。 */
export function formatArgs(args: readonly WireArg[], clipped = false): string {
  const text = args.map((arg) => {
    if (arg.type === 's') return `s:"${String(arg.value)}"`
    if (arg.type === 'f' && typeof arg.value === 'number') return `f:${formatG(arg.value)}`
    return `${arg.type}:${String(arg.value)}`
  }).join(' ')
  return clipped ? `${text} …` : text
}

/** Python の `:g`(有効 6 桁、末尾の 0 を落とす)に合わせる。 */
export function formatG(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  if (value === 0) return '0'
  const exponent = Math.floor(Math.log10(Math.abs(value)))
  if (exponent < -4 || exponent >= 6) {
    const [mantissa, power] = value.toExponential(5).split('e')
    const sign = power.startsWith('-') ? '-' : '+'
    const digits = power.replace(/^[+-]/, '').padStart(2, '0')
    return `${trimZeros(mantissa)}e${sign}${digits}`
  }
  return trimZeros(value.toFixed(Math.max(0, 5 - exponent)))
}

function trimZeros(text: string): string {
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text
}

const pad2 = (value: number) => String(value).padStart(2, '0')

/** ISO 8601 の時刻を、このブラウザのローカル時刻(ミリ秒まで)にする。読めなければそのまま。 */
export function formatLocalTime(iso: string): string {
  const moment = new Date(iso)
  if (Number.isNaN(moment.getTime())) return iso
  return `${clockOf(moment)}.${String(moment.getMilliseconds()).padStart(3, '0')}`
}

function clockOf(moment: Date): string {
  return `${pad2(moment.getHours())}:${pad2(moment.getMinutes())}:${pad2(moment.getSeconds())}`
}

export interface SentLogRow { seq: number; time: string; origin: string; targets: string; address: string; args: string; count: string; batch: string }

export function sentLogRow(record: SentLogRecord): SentLogRow {
  return {
    seq: record.seq,
    time: formatLocalTime(record.at),
    origin: ORIGIN_LABELS[record.origin] ?? record.origin,
    targets: record.targets.join(', '),
    address: record.address,
    args: formatArgs(record.args, record.clipped),
    count: record.count === 1 ? '' : `×${String(record.count)}`,
    batch: record.batch === null ? '' : `#${String(record.batch.id)} ${String(record.batch.index + 1)}/${String(record.batch.size)}`,
  }
}

export interface NoticeRow { seq: number; time: string; level: string; text: string }

export function noticeRow(record: NoticeRecord): NoticeRow {
  return { seq: record.seq, time: clockOf(new Date(record.at)), level: LEVEL_LABELS[record.level], text: record.text }
}

/** 1 ページの行数。 */
export const ROWS_PER_PAGE = 50

/** page 番目(0 始まり)の行と、ページの数。page が範囲の外なら最後のページに丸める。 */
export function pageOf<T>(rows: readonly T[], page: number, size: number = ROWS_PER_PAGE): { rows: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(rows.length / size))
  const clamped = Math.min(Math.max(0, page), pages - 1)
  return { rows: rows.slice(clamped * size, (clamped + 1) * size), page: clamped, pages }
}
