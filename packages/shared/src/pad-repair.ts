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

const withoutKeysAddress = (pad: PadDocument, index: number): PadDocument | null => {
  const widget = pad.widgets[index]
  if (widget?.kind !== 'table' || widget.rows.source !== 'ui' || widget.rows.keysAddress === undefined) return null
  const rows = { ...widget.rows }
  delete rows.keysAddress
  return { ...pad, widgets: pad.widgets.map((candidate, at) => (at === index ? { ...widget, rows } : candidate)) }
}

const withoutWidget = (pad: PadDocument, index: number): PadDocument => ({ ...pad, widgets: pad.widgets.filter((_, at) => at !== index) })

const sameIssue = (a: PadIssue, b: PadIssue) => a.message === b.message && a.path.join('.') === b.path.join('.')

/**
 * 違反 1 つを直す手。違反の付いた部品が表で、違反が行の一覧(rows.keysAddress・rows.keys。一覧の重なり・1 データグラムに
 * 収まらない一覧)に付くなら、まず表ごと外さずに keysAddress の欄だけを外して試す(行と欄の保持値を残す)。
 * それでその違反が消えなければ部品を外す。部品の外に掛かる違反(画像の合計など)は直せない
 */
function fixOne(pad: PadDocument, issue: PadIssue): { pad: PadDocument; repair: string } | null {
  const [head, index, ...rest] = issue.path
  if (head !== 'widgets' || typeof index !== 'number') return null
  const widget: PadWidget | undefined = pad.widgets[index]
  if (widget === undefined) return null
  if (rest[0] === 'rows' && (rest[1] === 'keysAddress' || rest[1] === 'keys')) {
    const trimmed = withoutKeysAddress(pad, index)
    if (trimmed !== null && !collectPadDocumentIssues(trimmed).some(left => sameIssue(left, issue))) {
      return { pad: trimmed, repair: `removed keysAddress of table "${widget.id}" (${issue.message})` }
    }
  }
  return { pad: withoutWidget(pad, index), repair: `removed widget "${widget.id}" (${issue.message})` }
}

/**
 * 保存済みのパッドが形(PadDocumentStructureSchema)には合うのに意味の規則に合わないとき、違反の付いた部品(または表の
 * keysAddress)を外して、保存と同じ検証に通るパッドにする。どちらの部品が外れるかは違反の付く側で決まる: 部品・表の重なりと
 * 部品の id の重複は後ろの部品、値の部品と表のマスの重なりは値の部品、行の一覧の重なりは表の keysAddress。
 * 1 回に 1 つだけ直して違反を数え直す(外した部品とだけ重なっていた部品まで巻き添えで外さない)。
 * 直す必要が無い・形が合わない・部品の外の違反が残るときは null(今までどおり読み込みを断る)
 */
export function repairPadDocument(value: unknown): PadRepair | null {
  const structure = PadDocumentStructureSchema.safeParse(upgradePadDocument(value))
  if (!structure.success) return null
  let pad = structure.data
  if (PadDocumentStoredSchema.safeParse(pad).success) return null
  const repairs: string[] = []
  // 1 手で部品を 1 つ外すか表の keysAddress を 1 つ外す(どちらも戻らない)ので、部品の数の 2 倍の手で必ず止まる
  for (let step = 0; step < structure.data.widgets.length * 2; step += 1) {
    const issues = collectPadDocumentIssues(pad)
    const issue = issues[0]
    if (issue === undefined) break
    // 部品の外の違反(画像の合計など)が 1 つでもあれば直さない(部品を 1 つずつ外して合わせると、どれだけ外すか決まらない)
    if (issues.some(each => each.path[0] !== 'widgets' || typeof each.path[1] !== 'number')) return null
    const fixed = fixOne(pad, issue)
    if (fixed === null) return null
    pad = fixed.pad
    repairs.push(fixed.repair)
  }
  const checked = PadDocumentStoredSchema.safeParse(pad)
  return checked.success ? { pad: checked.data, repairs } : null
}
