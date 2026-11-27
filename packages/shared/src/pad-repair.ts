import { collectPadDocumentIssues, PadDocumentStoredSchema, PadDocumentStructureSchema, type PadDocument, type PadIssue, type PadWidget } from './pad-document'
import { upgradePadDocument } from './pad-migration'

// 保存済みのパッドの直し(D-174)。パッドの検証に規則を足すと、前の版で保存したパッドが新しい規則に合わなくなる
// (HID-501 の keysAddress の重なり、D-169 の表のマスの重なりなど)。そのままでは採用も編集もできず、JSON を手で直すしか
// なかった(HID-504)。読み込むときに限り、規則に合わない箇所を部品ごとに外して読めるようにする。
// 保存(osc.padSave)・プロジェクトの取り込みには使わない(利用者が今送ったパッドを黙って削らない)。

export interface PadRepair {
  pad: PadDocument
  /** 外したもの(利用者に見せる。部品の id と、合わなかった規則) */
  repairs: string[]
}

type Fix = { kind: 'widget'; index: number } | { kind: 'keysAddress'; index: number }

/** 規則の違反 1 つを、外すもの 1 つにする。部品の外に掛かる違反(格子の大きさ・画像の合計など)は直せない */
function fixOf(issue: PadIssue): Fix | null {
  const [head, index, ...rest] = issue.path
  if (head !== 'widgets' || typeof index !== 'number') return null
  // 行の一覧の送り先(keysAddress)は省ける欄なので、表ごと外さずに欄だけ外す(行と欄の保持値を残す)
  if (rest.length === 2 && rest[0] === 'rows' && rest[1] === 'keysAddress') return { kind: 'keysAddress', index }
  return { kind: 'widget', index }
}

function describeFix(widget: PadWidget, fix: Fix, issue: PadIssue): string {
  return fix.kind === 'keysAddress'
    ? `removed keysAddress of table "${widget.id}" (${issue.message})`
    : `removed widget "${widget.id}" (${issue.message})`
}

/**
 * 保存済みのパッドが形(PadDocumentStructureSchema)には合うのに意味の規則に合わないとき、合わない部品(または表の
 * keysAddress)を外して、保存と同じ検証に通るパッドにする。重なりの違反は後ろの部品に付くので、先に置いた部品が残る。
 * 直す必要が無い・形が合わない・部品の外の違反が残るときは null(今までどおり読み込みを断る)
 */
export function repairPadDocument(value: unknown): PadRepair | null {
  const structure = PadDocumentStructureSchema.safeParse(upgradePadDocument(value))
  if (!structure.success) return null
  let pad = structure.data
  if (PadDocumentStoredSchema.safeParse(pad).success) return null
  const repairs: string[] = []
  // 外すたびに部品は 1 つ以上減るので、部品の数 + 1 回で必ず止まる
  for (let round = 0; round <= structure.data.widgets.length; round += 1) {
    const issues = collectPadDocumentIssues(pad)
    if (issues.length === 0) break
    const fixes = issues.map(issue => ({ issue, fix: fixOf(issue) }))
    if (fixes.some(({ fix }) => fix === null || pad.widgets[fix.index] === undefined)) return null
    // 部品ごと外すものを先に決める(同じ表の keysAddress だけを外す記録を重ねない)
    const removed = new Set<number>()
    const keysAddress = new Set<number>()
    for (const kind of ['widget', 'keysAddress'] as const) {
      for (const { issue, fix } of fixes) {
        if (fix === null || fix.kind !== kind || removed.has(fix.index) || keysAddress.has(fix.index)) continue
        ;(kind === 'widget' ? removed : keysAddress).add(fix.index)
        repairs.push(describeFix(pad.widgets[fix.index]!, fix, issue))
      }
    }
    pad = {
      ...pad,
      widgets: pad.widgets.flatMap((widget, index): PadWidget[] => {
        if (removed.has(index)) return []
        if (!keysAddress.has(index) || widget.kind !== 'table' || widget.rows.source !== 'ui') return [widget]
        const rows = { ...widget.rows }
        delete rows.keysAddress
        return [{ ...widget, rows }]
      }),
    }
  }
  const checked = PadDocumentStoredSchema.safeParse(pad)
  return checked.success ? { pad: checked.data, repairs } : null
}
