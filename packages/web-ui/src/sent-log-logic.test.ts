// 送信ログと通知の履歴の表示の規則(D-067・D-147)
import { describe, expect, it } from 'vitest'

import type { SentLogRecord } from '@oscdesk/shared'

import { createNotices, NOTICE_HISTORY_LIMIT, NOTICE_LIMIT } from './notices'
import { applySentLog, formatArgs, formatG, formatLocalTime, newestFirst, noticeRow, pageOf, sentLogRow } from './sent-log-logic'
import { wireSample } from './test-support'

const record = (seq: number, patch: Partial<SentLogRecord> = {}): SentLogRecord => ({
  seq, at: '2026-10-14T10:00:00.250Z', origin: 'ui', targets: ['unity'], address: `/a/${String(seq)}`, args: [], count: 1, batch: null, clipped: false, ...patch,
})

describe('sent log', () => {
  it('adds and replaces records by seq, and replaces everything on a full frame', () => {
    let records = applySentLog(new Map(), false, [record(1), record(2)])
    records = applySentLog(records, false, [record(2, { count: 5 })])
    expect(newestFirst(records).map((item) => [item.seq, item.count])).toEqual([[2, 5], [1, 1]])
    // ブリッジの再起動で seq が 1 に戻る。full は手元の記録を必ず捨てる
    records = applySentLog(records, true, [record(1, { address: '/new' })])
    expect(newestFirst(records).map((item) => item.address)).toEqual(['/new'])
  })

  it('drops the oldest seq beyond the capacity', () => {
    const records = applySentLog(new Map(), false, [record(3), record(1), record(2)], 2)
    expect(newestFirst(records).map((item) => item.seq)).toEqual([3, 2])
  })

  it('formats sent-log records into table rows', () => {
    const frame = wireSample('downstream-sent-log')
    if (frame.type !== 'osc.sentLog') throw new Error('not a sent log')
    const rows = frame.records.map(sentLogRow)
    expect(rows[0]).toMatchObject({ origin: '操作', targets: 'unity, backup', address: '/mix/master', args: 'f:0.75', count: '×12', batch: '' })
    expect(rows[1]).toMatchObject({ origin: 'まとめ送り', batch: '#3 1/2', count: '' })
    expect(rows[3]).toMatchObject({ origin: '再送', args: 's:"メンバーA" b:AAECAw== …' })
    expect(rows[0].time).toMatch(/^\d\d:\d\d:\d\d\.250$/)
  })

  it('prints floats like Python %g and keeps unreadable times as they are', () => {
    expect(formatArgs([{ type: 'f', value: 1 }, { type: 'f', value: 0.1 + 0.2 }, { type: 'i', value: -3 }])).toBe('f:1 f:0.3 i:-3')
    expect([formatG(1e-5), formatG(1234567), formatG(123456.7), formatG(-2.5)]).toEqual(['1e-05', '1.23457e+06', '123457', '-2.5'])
    expect(formatLocalTime('not a time')).toBe('not a time')
  })

  it('pages rows and clamps a page past the end', () => {
    const rows = Array.from({ length: 120 }, (_, index) => index)
    expect(pageOf(rows, 0)).toMatchObject({ page: 0, pages: 3 })
    expect(pageOf(rows, 9).rows).toEqual(rows.slice(100))
    expect(pageOf([], 0)).toEqual({ rows: [], page: 0, pages: 1 })
  })
})

describe('notice history (notices.ts)', () => {
  it('keeps every notice in the history, even after it leaves the screen, and clears only the history', () => {
    let clock = Date.UTC(2026, 10, 1, 1, 2, 3)
    const notices = createNotices({ now: () => clock })
    for (let index = 0; index < NOTICE_LIMIT + 2; index += 1) {
      clock += 1000
      notices.notify(index === 0 ? 'error' : 'info', `n${String(index)}`)
    }
    expect(notices.items.value).toHaveLength(NOTICE_LIMIT)
    expect(notices.history.value.map((item) => item.text)).toEqual(Array.from({ length: NOTICE_LIMIT + 2 }, (_, index) => `n${String(index)}`))
    expect(noticeRow(notices.history.value[0])).toMatchObject({ level: 'エラー', text: 'n0' })
    expect(noticeRow(notices.history.value[0]).time).toMatch(/^\d\d:\d\d:\d\d$/)

    notices.clearHistory()
    expect(notices.history.value).toEqual([])
    expect(notices.items.value).toHaveLength(NOTICE_LIMIT)
  })

  it('keeps at most NOTICE_HISTORY_LIMIT records', () => {
    const notices = createNotices()
    for (let index = 0; index < NOTICE_HISTORY_LIMIT + 10; index += 1) notices.notify('info', `n${String(index)}`)
    expect(notices.history.value).toHaveLength(NOTICE_HISTORY_LIMIT)
    expect(notices.history.value[0].text).toBe('n10')
  })
})
