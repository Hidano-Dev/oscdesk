import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

// DESIGN.md(時系列の履歴)と docs/DECISIONS.md(いま有効な判断の索引)の食い違いを落とすガード(HID-441)。
// 索引を手で同期すると漏れる(DEVELOPMENT.md の要約がそうだった)ので、次を機械的に確かめる:
// - DESIGN.md の D 番号の見出しは重ならず、それぞれの直前に索引からのリンク先になる錨 `<a id="d-xxx"></a>` がある
// - 覆された判断の見出しの印(〔D-xxx で覆した〕/〔一部を D-xxx で覆した〕)と、索引の「覆された判断」の表が一致する
// - すべての D 番号が索引のどこかに載っている(新しい判断を足して索引を忘れると落ちる)
// - すべて覆された判断は、索引の領域の一覧(表より前)に載らず、一部だけ覆された判断は載る
// - 索引のリンクは実在する D 番号を指す

const root = path.resolve(__dirname, '../..')
const design = fs.readFileSync(path.join(root, 'DESIGN.md'), 'utf8').split(/\r?\n/)
const decisions = fs.readFileSync(path.join(root, 'docs/DECISIONS.md'), 'utf8')

const TABLE_HEADING = '## 覆された判断'
const HEADING = /^### D-(\d{3}):/
const MARK = /〔(一部を )?(D-\d{3}(?:・D-\d{3})*) で覆した〕\s*$/
const LINK = /\]\(\.\.\/DESIGN\.md#d-(\d{3})\)/g

interface Overturn { by: string[]; partial: boolean }

interface Headings {
  all: Map<string, { line: number; overturn?: Overturn }>
  duplicates: string[]
  // 「で覆した〕」を含むのに MARK の形でない見出し(区切りの打ち間違いなど)。黙って「印なし」にしないため
  malformed: string[]
}

function headings(): Headings {
  const found = new Map<string, { line: number; overturn?: Overturn }>()
  const duplicates: string[] = []
  const malformed: string[] = []
  design.forEach((text, index) => {
    const heading = HEADING.exec(text)
    if (!heading) return
    const number = heading[1]
    if (found.has(number)) duplicates.push(`D-${number}`)
    const mark = MARK.exec(text)
    if (!mark && text.includes('で覆した〕')) malformed.push(`DESIGN.md:${String(index + 1)}: ${text}`)
    found.set(number, {
      line: index + 1,
      overturn: mark ? { by: mark[2].split('・').map((id) => id.slice(2)), partial: mark[1] !== undefined } : undefined,
    })
  })
  return { all: found, duplicates, malformed }
}

function linked(text: string): Set<string> {
  return new Set([...text.matchAll(LINK)].map((match) => match[1]))
}

function table(): Map<string, Overturn> {
  const start = decisions.indexOf(TABLE_HEADING)
  expect(start, `docs/DECISIONS.md に「${TABLE_HEADING}」の節が無い`).toBeGreaterThanOrEqual(0)
  const rows = new Map<string, Overturn>()
  for (const line of decisions.slice(start).split(/\r?\n/)) {
    const cells = line.split('|').map((cell) => cell.trim())
    if (cells.length !== 5 || !cells[1].startsWith('[D-')) continue
    const targets = [...linked(cells[1])]
    expect(targets, `表の左の列は ../DESIGN.md#d-xxx へのリンク 1 つにする: ${line}`).toHaveLength(1)
    const [target] = targets
    expect(rows.has(target), `表に D-${target} の行が複数ある`).toBe(false)
    expect(['全部', '一部'], `D-${target} の行の範囲が「全部」「一部」でない`).toContain(cells[3])
    rows.set(target, { by: [...linked(cells[2])], partial: cells[3] === '一部' })
  }
  return rows
}

describe('design decisions index', () => {
  const { all, duplicates, malformed } = headings()
  const body = decisions.slice(0, Math.max(0, decisions.indexOf(TABLE_HEADING)))

  it('has unique D headings with well-formed overturn marks', () => {
    expect(duplicates, 'DESIGN.md に同じ D 番号の見出しが複数ある').toEqual([])
    expect(malformed, '印は見出しの末尾に 〔D-xxx・D-yyy で覆した〕 / 〔一部を D-xxx で覆した〕 の形で書く').toEqual([])
  })

  it('puts an anchor right before every D heading', () => {
    const missing = [...all].filter(([number, { line }]) => {
      const before = design.slice(Math.max(0, line - 3), line - 1).map((text) => text.trim())
      return !before.includes(`<a id="d-${number}"></a>`)
    }).map(([number, { line }]) => `D-${number} (DESIGN.md:${String(line)})`)
    expect(missing, '見出しの直前に <a id="d-xxx"></a> を置く').toEqual([])
  })

  it('links only to existing decisions', () => {
    const unknown = [...linked(decisions)].filter((number) => !all.has(number)).map((number) => `D-${number}`)
    expect(unknown, 'docs/DECISIONS.md が存在しない D 番号を指している').toEqual([])
  })

  it('lists every decision in the index', () => {
    const listed = linked(decisions)
    const missing = [...all.keys()].filter((number) => !listed.has(number)).map((number) => `D-${number}`)
    expect(missing, 'docs/DECISIONS.md の該当する領域に項目を足す(覆された判断なら表に行を足す)').toEqual([])
  })

  it('keeps the heading marks and the overturned table in sync', () => {
    const marks = new Map([...all].flatMap(([number, { overturn }]) => (overturn ? [[number, overturn] as const] : [])))
    const rows = table()
    const summarize = (entries: Map<string, Overturn>): string[] => [...entries]
      .map(([number, { by, partial }]) => `D-${number} ${partial ? '一部' : '全部'} ${by.map((id) => `D-${id}`).join('・')}`)
      .sort()
    expect(summarize(rows), 'DESIGN.md の見出しの印と docs/DECISIONS.md の表が食い違っている').toEqual(summarize(marks))
    const broken = [...marks].flatMap(([number, { by }]) => by
      .filter((id) => id === number || !all.has(id))
      .map((id) => `D-${number} → D-${id}`))
    expect(broken, '覆した判断が存在しないか自分自身を指している').toEqual([])
  })

  it('lists partially overturned decisions but not fully overturned ones', () => {
    const current = linked(body)
    const misplaced = [...all].flatMap(([number, { overturn }]) => {
      if (!overturn) return current.has(number) ? [] : [`D-${number} は有効なので領域の一覧に載せる`]
      if (overturn.partial && !current.has(number)) return [`D-${number} は一部だけ覆されたので領域の一覧に載せる`]
      if (!overturn.partial && current.has(number)) return [`D-${number} はすべて覆されたので領域の一覧から外す`]
      return []
    })
    expect(misplaced).toEqual([])
  })
})
