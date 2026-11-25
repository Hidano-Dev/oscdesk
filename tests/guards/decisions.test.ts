import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

// DESIGN.md は判断を時系列に積んだ記録で、いま有効な判断は docs/DECISIONS.md に並べる(HID-441)。
// 覆された項目の見出しには印を付ける:
//   全体を覆した: `### D-020: … (→ D-030 で覆した)`
//   一部を改めた: `### D-029: … (一部 → D-113)`
// 印の番号の打ち間違いと、どちらの文書からも辿れない項目(DECISIONS.md の書き漏れ)をここで止める。

const repositoryRoot = resolve(__dirname, '../..')
const design = readFileSync(resolve(repositoryRoot, 'DESIGN.md'), 'utf8')
const decisions = readFileSync(resolve(repositoryRoot, 'docs/DECISIONS.md'), 'utf8')

// HID-386 や FD-036 の中の `D-386` / `D-036` を拾わない
const ID = /(?<![A-Z])D-\d{3}/g
const HEADING = /^### (D-\d{3}):(.*)$/
const FULL_MARK = /\(→ ((?:D-\d{3})(?:・D-\d{3})*) で覆した\)$/
const PARTIAL_MARK = /\(一部 → ((?:D-\d{3})(?:・D-\d{3})*)\)$/

type Entry = { id: string; title: string; full: string[]; partial: string[] }

const entries: Entry[] = design.split(/\r?\n/).flatMap((line) => {
  const heading = HEADING.exec(line)
  if (!heading) return []
  const title = heading[2]
  return [{
    id: heading[1],
    title,
    full: FULL_MARK.exec(title)?.[1].split('・') ?? [],
    partial: PARTIAL_MARK.exec(title)?.[1].split('・') ?? [],
  }]
})
const defined = new Set(entries.map((entry) => entry.id))
const number = (id: string): number => Number(id.slice(2))

describe('DESIGN.md と docs/DECISIONS.md の対応', () => {
  it('DESIGN.md の見出しから D 番号を読める', () => {
    expect(entries.length).toBeGreaterThan(100)
  })

  it('DESIGN.md の見出しの D 番号は重ならない', () => {
    // 同じ番号が 2 つあると、印と参照がどちらを指すのか決まらない
    const duplicates = entries.map((entry) => entry.id).filter((id, index, ids) => ids.indexOf(id) !== index)
    expect(duplicates).toEqual([])
  })

  it('見出しの矢印は決まった形の印だけ', () => {
    // 形を崩した印は上の正規表現に当たらず、検査をすり抜けるため
    const malformed = entries
      .filter((entry) => entry.title.includes('→') && entry.full.length === 0 && entry.partial.length === 0)
      .map((entry) => `${entry.id}:${entry.title}`)
    expect(malformed).toEqual([])
  })

  it('印が指す D 番号は DESIGN.md にあり、印を付けた項目より後の判断である', () => {
    const problems = entries.flatMap((entry) => [...entry.full, ...entry.partial]
      .filter((target) => !defined.has(target) || number(target) <= number(entry.id))
      .map((target) => `${entry.id} → ${target}`))
    expect(problems).toEqual([])
  })

  it('docs/DECISIONS.md が参照する D 番号は DESIGN.md にある', () => {
    const unknown = [...new Set(decisions.match(ID) ?? [])].filter((id) => !defined.has(id))
    expect(unknown).toEqual([])
  })

  it('DESIGN.md のどの項目も docs/DECISIONS.md から参照されるか、全体を覆した印を持つ', () => {
    // 新しい判断を DESIGN.md に足したら DECISIONS.md にも載せる。全体を覆されたなら見出しに印を付ける
    // 「覆した: …」の中だけに出る番号は、いま有効な判断としての参照に数えない
    // (見出しの印を外された覆された項目が、この一覧の記載ですり抜けないように)
    const referenced = new Set(decisions.replace(/覆した: [^)]*/g, '').match(ID) ?? [])
    const orphans = entries
      .filter((entry) => entry.full.length === 0 && !referenced.has(entry.id))
      .map((entry) => entry.id)
    expect(orphans).toEqual([])
  })
})
