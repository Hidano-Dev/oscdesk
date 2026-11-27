import {
  hasLoneSurrogate,
  imageDataUrlBytes,
  PAD_DOCUMENT,
  PAD_RELATIVE_ADDRESS_PATTERN,
  PAD_ROW_KEY_PATTERN,
  PadDocumentStoredSchema,
  padWidgetFromNode,
  widgetCells,
  type PadArg,
  type PadDocument,
  type PadDocumentEdit,
  type PadDocumentEditPart,
  type PadField,
  type PadOption,
  type PadTableAction,
  type PadTableColumn,
  type PadTableWidget,
  type PadValueWidget,
  type PadWidget,
  type PadWidgetKind,
} from '@oscdesk/shared'

import { addressProblem, imageDataUrlOf, PadEditError, parseArgValue } from './pad-editor'

/**
 * パッドの文書の版 2(D-167)の編集の規則。版 1 の pad-editor.ts(D-126)と同じ形の純粋関数で、作業コピーを複製して
 * 変えた新しいパッドを返す。失敗しても元のパッドは壊れず、applyPadDocumentEdit は保存と同じ検証(PadDocumentStoredSchema)に
 * 通ったものだけを返す。理由の文言は画面にそのまま出す日本語。
 * 数・文字は入力欄の文字列のまま受け、型どおりの読み取り(i は int32、f は float32 に収まる有限の数)はここで行う
 */

export type PadDocumentEditResult = { ok: true; pad: PadDocument } | { ok: false; detail: string }

type ValueType = 'i' | 'f' | 's' | 'T' | 'r' | 'ffff'
/** 値を持つ操作(値を持つ部品・組み合わせの引数・表の欄)。種類ごとの欄の組を 1 つの形で扱う */
type Control = PadValueWidget | PadField | PadTableColumn
type FieldControl = PadField | PadTableColumn

const RELATIVE_ADDRESS = new RegExp(PAD_RELATIVE_ADDRESS_PATTERN)
const DEFAULT_ARG_VALUES = { i: 0, f: 0, s: '' } as const
// 部品の種類ごとに使える値の型
const VALUE_TYPES: Record<Control['kind'], readonly ValueType[]> = {
  toggle: ['T', 'i'],
  slider: ['i', 'f'],
  select: ['i', 'f', 's'],
  number: ['i', 'f'],
  text: ['s'],
  color: ['r', 'ffff'],
}
const KIND_NAMES: Record<PadWidgetKind, string> = {
  button: 'ボタン', toggle: 'トグル', slider: 'スライダー', select: '選択', number: '数値の入力', text: '文字の入力', color: '色', composite: '組み合わせ', table: '表',
}

function validate(candidate: unknown): PadDocumentEditResult {
  const parsed = PadDocumentStoredSchema.safeParse(candidate)
  if (!parsed.success) {
    return { ok: false, detail: `パッドとして不正です: ${parsed.error.issues.slice(0, 3).map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ')}` }
  }
  return { ok: true, pad: parsed.data }
}

/** 作業コピーに編集を 1 つ当てて検証する。作業コピーそのものが検証に通らなければ編集しない */
export function applyPadDocumentEdit(draft: unknown, edit: PadDocumentEdit): PadDocumentEditResult {
  const base = PadDocumentStoredSchema.safeParse(draft)
  if (!base.success) return { ok: false, detail: `作業中のパッドが不正です: ${base.error.issues[0]?.message ?? 'invalid'}` }
  let candidate: PadDocument
  try {
    candidate = applyEdit(base.data, edit)
  } catch (error) {
    if (error instanceof PadEditError) return { ok: false, detail: error.message }
    throw error
  }
  return validate(candidate)
}

function applyEdit(pad: PadDocument, edit: PadDocumentEdit): PadDocument {
  switch (edit.op) {
    case 'addWidget': return place(pad, edit.row, edit.column, defaultWidget(edit.kind, nextId(pad.widgets.map(widget => widget.id), 'w')))
    case 'addWidgetFromNode': {
      const result = padWidgetFromNode(edit.node, { ...(edit.kind === undefined ? {} : { kind: edit.kind }), ...(edit.resend === undefined ? {} : { resend: edit.resend }) })
      if (!result.ok) throw new PadEditError(result.detail)
      return place(pad, edit.row, edit.column, { ...result.widget, id: nextId(pad.widgets.map(widget => widget.id), 'w'), row: 0, column: 0 } as PadWidget)
    }
    case 'removeWidget': return replaceWidget(pad, requireWidget(pad, edit.widget).id, null)
    case 'moveWidget': return moveWidget(pad, edit.widget, edit.row, edit.column)
    case 'spanWidget': return spanWidget(pad, edit.widget, edit.rowSpan, edit.columnSpan)
    case 'setKind': return edit.part === undefined ? setWidgetKind(pad, edit.widget, edit.kind) : setFieldKind(pad, edit.widget, edit.part, edit.kind)
    case 'pasteSettings': return pasteSettings(pad, edit.widget, edit.settings)
    case 'setLabel': return setLabel(pad, edit.widget, edit.part, edit.label)
    case 'setColor': return setColor(pad, edit.widget, edit.color)
    case 'setAddress': return setAddress(pad, edit.widget, edit.part, edit.address)
    case 'setImage': return setImage(pad, edit.widget, edit.data)
    case 'addArg': return withArgs(pad, edit.widget, edit.part, args => {
      if (args.length >= PAD_DOCUMENT.MAX_ARGS) throw new PadEditError(`引数は ${String(PAD_DOCUMENT.MAX_ARGS)} 個までです`)
      args.push(defaultArg(edit.type))
    })
    case 'removeArg': return withArgs(pad, edit.widget, edit.part, args => { requireIndex(args, edit.index, 'その引数はありません'); args.splice(edit.index, 1) })
    case 'moveArg': return withArgs(pad, edit.widget, edit.part, args => { swap(args, edit.index, edit.delta) })
    case 'setArgType': return withArgs(pad, edit.widget, edit.part, args => { args[edit.index] = convertArg(requireIndex(args, edit.index, 'その引数はありません'), edit.type) })
    case 'setArgValue': return withArgs(pad, edit.widget, edit.part, args => {
      const arg = requireIndex(args, edit.index, 'その引数はありません')
      if (arg.type === 'T' || arg.type === 'F') throw new PadEditError('T / F の引数は値を持ちません(型で真偽を決めます)')
      args[edit.index] = { type: arg.type, value: parseArgValue(arg.type, edit.raw) } as PadArg
    })
    case 'setValueType': return withControl(pad, edit.widget, edit.part, control => setValueType(control, edit.type))
    case 'setRange': return withControl(pad, edit.widget, edit.part, control => setRange(control, edit.min, edit.max))
    case 'setStep': return withControl(pad, edit.widget, edit.part, control => setStep(control, edit.step))
    case 'addOption': return withOptions(pad, edit.widget, edit.part, (options, type) => {
      if (options.length >= PAD_DOCUMENT.MAX_OPTIONS) throw new PadEditError(`候補は ${String(PAD_DOCUMENT.MAX_OPTIONS)} 個までです`)
      options.push(optionOf(type, edit.raw, edit.label, options))
    })
    case 'removeOption': return withOptions(pad, edit.widget, edit.part, options => {
      requireIndex(options, edit.index, 'その候補はありません')
      if (options.length === 1) throw new PadEditError('候補は 1 つ以上要ります')
      options.splice(edit.index, 1)
    })
    case 'moveOption': return withOptions(pad, edit.widget, edit.part, options => { swap(options, edit.index, edit.delta) })
    case 'setOption': return withOptions(pad, edit.widget, edit.part, (options, type) => {
      requireIndex(options, edit.index, 'その候補はありません')
      options[edit.index] = optionOf(type, edit.raw, edit.label, options.filter((_, index) => index !== edit.index))
    })
    case 'setResend': return setResend(pad, edit.widget, edit.part, edit.resend)
    case 'setReadOnly': return setReadOnly(pad, edit.widget, edit.readOnly)
    case 'addField': return withComposite(pad, edit.widget, fields => {
      if (fields.length >= PAD_DOCUMENT.MAX_FIELDS) throw new PadEditError(`引数は ${String(PAD_DOCUMENT.MAX_FIELDS)} 個までです`)
      const id = nextId(fields.map(field => field.id), 'a')
      fields.push({ id, label: id, ...defaultControl(edit.kind) } as PadField)
    })
    case 'removeField': return withComposite(pad, edit.widget, fields => {
      requireIndex(fields, edit.index, 'その引数はありません')
      if (fields.length === 1) throw new PadEditError('組み合わせの型には引数が 1 つ以上要ります')
      fields.splice(edit.index, 1)
    })
    case 'moveField': return withComposite(pad, edit.widget, fields => { swap(fields, edit.index, edit.delta) })
    case 'setRowSource': return withTable(pad, edit.widget, table => setRowSource(table, edit.source))
    case 'addRow': return withUiRows(pad, edit.widget, (keys, max) => {
      if (keys.length >= (max ?? PAD_DOCUMENT.MAX_TABLE_ROWS)) throw new PadEditError(`行は ${String(max ?? PAD_DOCUMENT.MAX_TABLE_ROWS)} 行までです`)
      const key = edit.key.trim()
      if (!PAD_ROW_KEY_PATTERN.test(key)) throw new PadEditError(`行の ID は英数字と _ - の ${String(PAD_DOCUMENT.MAX_ROW_KEY_CHARS)} 文字までです(行ごとのアドレスの 1 段になるため。表示名は名前の欄に書きます)`)
      if (keys.some(row => row.key === key)) throw new PadEditError(`行 ${key} は既にあります`)
      keys.push({ key, label: requireLabel(edit.label) })
    })
    case 'removeRow': return withUiRows(pad, edit.widget, keys => { keys.splice(requireRow(keys, edit.key), 1) })
    case 'setRowLabel': return withUiRows(pad, edit.widget, keys => { keys[requireRow(keys, edit.key)]!.label = requireLabel(edit.label) })
    case 'moveRow': return withUiRows(pad, edit.widget, keys => { swap(keys, requireRow(keys, edit.key), edit.delta) })
    case 'addColumn': return withTable(pad, edit.widget, table => {
      if (table.columns.length >= PAD_DOCUMENT.MAX_TABLE_COLUMNS) throw new PadEditError(`欄は ${String(PAD_DOCUMENT.MAX_TABLE_COLUMNS)} 個までです`)
      const id = nextId([...table.columns.map(column => column.id), ...usedRelativeAddresses(table)], 'c')
      table.columns.push({ id, label: id, address: id, resend: true, ...defaultControl(edit.kind) } as PadTableColumn)
    })
    case 'removeColumn': return withTable(pad, edit.widget, table => {
      const index = requireColumnIndex(table, edit.column)
      if (table.columns.length === 1) throw new PadEditError('表には欄が 1 つ以上要ります')
      table.columns.splice(index, 1)
    })
    case 'moveColumn': return withTable(pad, edit.widget, table => { swap(table.columns, requireColumnIndex(table, edit.column), edit.delta) })
    case 'setColumnBulk': return withTable(pad, edit.widget, table => {
      const column = table.columns[requireColumnIndex(table, edit.column)]!
      if (edit.bulk && column.kind !== 'toggle') throw new PadEditError('一括トグルはトグルの欄だけに付けられます')
      if (edit.bulk) column.bulk = true
      else delete column.bulk
    })
    case 'addAction': return withTable(pad, edit.widget, table => {
      const actions = table.actions ?? []
      if (actions.length >= PAD_DOCUMENT.MAX_TABLE_ACTIONS) throw new PadEditError(`アクションは ${String(PAD_DOCUMENT.MAX_TABLE_ACTIONS)} 個までです`)
      const id = nextId([...actions.map(action => action.id), ...usedRelativeAddresses(table)], 'act')
      table.actions = [...actions, { id, label: id, scope: edit.scope, address: id, args: [] }]
    })
    case 'removeAction': return withTable(pad, edit.widget, table => {
      const index = requireActionIndex(table, edit.action)
      table.actions!.splice(index, 1)
      if (table.actions!.length === 0) delete table.actions
    })
    case 'setActionScope': return withTable(pad, edit.widget, table => { table.actions![requireActionIndex(table, edit.action)]!.scope = edit.scope })
    case 'resize': return resize(pad, edit.rows, edit.columns)
  }
}

// --- 共通の道具 -----------------------------------------------------------------

function nextId(existing: readonly string[], prefix: string): string {
  const used = new Set(existing)
  let number = 1
  while (used.has(`${prefix}${String(number)}`)) number += 1
  return `${prefix}${String(number)}`
}

function requireIndex<T>(items: readonly T[], index: number, message: string): T {
  const item = items[index]
  if (item === undefined) throw new PadEditError(message)
  return item
}

function swap<T>(items: T[], index: number, delta: -1 | 1): void {
  const target = index + delta
  const [first, second] = [items[index], items[target]]
  if (first === undefined || second === undefined) throw new PadEditError('これ以上動かせません')
  items[index] = second
  items[target] = first
}

function requireLabel(label: string): string {
  if (label.length > PAD_DOCUMENT.MAX_LABEL_CHARS) throw new PadEditError(`ラベルは ${String(PAD_DOCUMENT.MAX_LABEL_CHARS)} 文字までです`)
  return label
}

function requireWidget(pad: PadDocument, widgetId: string): PadWidget {
  const widget = pad.widgets.find(candidate => candidate.id === widgetId)
  if (widget === undefined) throw new PadEditError(`部品 ${widgetId} がありません`)
  return widget
}

/** widgetId の部品を widget に置き換える(null なら外す)。並びは保つ */
function replaceWidget(pad: PadDocument, widgetId: string, widget: PadWidget | null): PadDocument {
  const result = structuredClone(pad)
  result.widgets = result.widgets.flatMap(current => current.id !== widgetId ? [current] : widget === null ? [] : [structuredClone(widget)])
  return result
}

/** 部品の写しを change で変えて置き換える */
function updateWidget(pad: PadDocument, widgetId: string, change: (widget: PadWidget) => PadWidget | void): PadDocument {
  const copy = structuredClone(requireWidget(pad, widgetId))
  const changed = change(copy) ?? copy
  return replaceWidget(pad, widgetId, changed)
}

/** 部品が置ける場所か(格子の中で、ほかの部品と重ならない。except はいま動かしている部品) */
function requireRoom(pad: PadDocument, area: Pick<PadWidget, 'row' | 'column' | 'rowSpan' | 'columnSpan'>, except?: string): void {
  const cells = widgetCells(area)
  if (cells.rowEnd > pad.rows || cells.columnEnd > pad.columns) throw new PadEditError('格子の外には置けません')
  const overlapping = pad.widgets.find((widget) => {
    if (widget.id === except) return false
    const other = widgetCells(widget)
    return other.row < cells.rowEnd && cells.row < other.rowEnd && other.column < cells.columnEnd && cells.column < other.columnEnd
  })
  if (overlapping !== undefined) throw new PadEditError(`${overlapping.label || overlapping.id} と重なります`)
}

/** 空きマスに部品を置く。広がりは 1 マスから始める */
function place(pad: PadDocument, row: number, column: number, widget: PadWidget): PadDocument {
  const placed = { ...widget, row, column }
  delete placed.rowSpan
  delete placed.columnSpan
  requireRoom(pad, placed)
  const result = structuredClone(pad)
  result.widgets.push(placed)
  return result
}

function moveWidget(pad: PadDocument, widgetId: string, row: number, column: number): PadDocument {
  const widget = requireWidget(pad, widgetId)
  requireRoom(pad, { ...widget, row, column }, widgetId)
  return replaceWidget(pad, widgetId, { ...widget, row, column })
}

function spanWidget(pad: PadDocument, widgetId: string, rowSpan: number, columnSpan: number): PadDocument {
  const widget = { ...requireWidget(pad, widgetId) }
  if (rowSpan < 1 || columnSpan < 1) throw new PadEditError('広がりは 1 マス以上です')
  requireRoom(pad, { ...widget, rowSpan, columnSpan }, widgetId)
  // 1 マスは省略で表す(版 1 から移したパッドと同じ形に保つ)
  if (rowSpan === 1) delete widget.rowSpan
  else widget.rowSpan = rowSpan
  if (columnSpan === 1) delete widget.columnSpan
  else widget.columnSpan = columnSpan
  return replaceWidget(pad, widgetId, widget)
}

function resize(pad: PadDocument, rows: number, columns: number): PadDocument {
  if (!(rows >= 1 && rows <= PAD_DOCUMENT.MAX_ROWS && columns >= 1 && columns <= PAD_DOCUMENT.MAX_COLUMNS)) {
    throw new PadEditError(`行数は 1〜${String(PAD_DOCUMENT.MAX_ROWS)}、列数は 1〜${String(PAD_DOCUMENT.MAX_COLUMNS)} です`)
  }
  // はみ出す部品があれば、黙って消さずに断る(先に消すか、動かしてもらう)
  const outside = pad.widgets.filter((widget) => {
    const cells = widgetCells(widget)
    return cells.rowEnd > rows || cells.columnEnd > columns
  })
  if (outside.length > 0) throw new PadEditError(`格子の外に出る部品があります: ${outside.map(widget => widget.label || widget.id).join(', ')}`)
  return { ...structuredClone(pad), rows, columns }
}

// --- 部品の種類 -----------------------------------------------------------------

/** 値を持つ操作の、種類ごとの欄の既定値 */
function defaultControl(kind: Control['kind']): Pick<Control, 'kind' | 'type'> & Record<string, unknown> {
  switch (kind) {
    case 'toggle': return { kind, type: 'T' }
    case 'slider': return { kind, type: 'f', min: 0, max: 1 }
    case 'select': return { kind, type: 's', options: [{ value: 'a' }] }
    case 'number': return { kind, type: 'f' }
    case 'text': return { kind, type: 's' }
    case 'color': return { kind, type: 'r' }
  }
}

/** 種類の既定の部品。アドレスは仮の正しい値(/pad/<id>)で始め、Inspector で書き換えてもらう */
function defaultWidget(kind: PadWidgetKind, id: string): PadWidget {
  const common = { id, row: 0, column: 0, label: id, address: `/pad/${id}` }
  switch (kind) {
    case 'button': return { ...common, kind, args: [] }
    case 'composite': return { ...common, kind, fields: [{ id: 'a1', label: '1', kind: 'number', type: 'f' }], resend: true }
    case 'table': return { ...common, kind, rows: { source: 'ui', keys: [] }, columns: [{ id: 'c1', label: 'c1', address: 'c1', kind: 'toggle', type: 'T', resend: true }] }
    default: return { ...common, ...defaultControl(kind), resend: true } as PadWidget
  }
}

/** 部品の種類を変える。id・位置・広がり・ラベル・色・アドレスは引き継ぎ、種類ごとの欄は既定値から始める */
function setWidgetKind(pad: PadDocument, widgetId: string, kind: PadWidgetKind): PadDocument {
  const widget = requireWidget(pad, widgetId)
  if (widget.kind === kind) return pad
  const fresh = defaultWidget(kind, widget.id)
  const kept = {
    row: widget.row,
    column: widget.column,
    ...(widget.rowSpan === undefined ? {} : { rowSpan: widget.rowSpan }),
    ...(widget.columnSpan === undefined ? {} : { columnSpan: widget.columnSpan }),
    label: widget.label,
    ...(widget.color === undefined ? {} : { color: widget.color }),
    address: widget.address,
  }
  // 送り直すかは値を持つ部品どうしなら引き継ぐ(利用者が外した設定を種類の変更で戻さない)
  const resend = 'resend' in widget && 'resend' in fresh ? { resend: widget.resend } : {}
  // 表示だけ(読むだけのアドレス)も引き継ぐ。見た目を変えただけで、読むだけのアドレスへ送る部品にならないように
  // (PR #172 のレビュー)。表示だけにできない種類(ボタン・表)へ変えるときは外れる
  const readOnly = 'readOnly' in widget && widget.readOnly === true && fresh.kind !== 'button' && fresh.kind !== 'table' ? { readOnly: true } : {}
  return replaceWidget(pad, widgetId, { ...fresh, ...kept, ...resend, ...readOnly } as PadWidget)
}

/** 組み合わせの型の引数・表の欄の操作の種類を変える(id・ラベル・欄のアドレスと送り直すかは引き継ぐ) */
function setFieldKind(pad: PadDocument, widgetId: string, part: PadDocumentEditPart, kind: PadWidgetKind): PadDocument {
  if (!(kind === 'toggle' || kind === 'slider' || kind === 'select' || kind === 'number' || kind === 'text')) {
    throw new PadEditError(`${KIND_NAMES[kind]} は組み合わせの型の引数・表の欄に置けません`)
  }
  return withControl(pad, widgetId, part, (control) => {
    if (control.kind === kind) return control
    const kept: Record<string, unknown> = { id: (control as FieldControl).id, label: control.label }
    if ('address' in control) kept.address = control.address
    if ('resend' in control) kept.resend = control.resend
    return { ...kept, ...defaultControl(kind) } as Control
  })
}

function pasteSettings(pad: PadDocument, widgetId: string, settings: Record<string, unknown>): PadDocument {
  const widget = requireWidget(pad, widgetId)
  // 形の正否は当てた後のパッド全体の検証で見る。位置と広がりは貼り付け先のものを保つ
  const { id: _id, row: _row, column: _column, rowSpan: _rowSpan, columnSpan: _columnSpan, ...rest } = settings
  const pasted = {
    ...structuredClone(rest),
    id: widget.id,
    row: widget.row,
    column: widget.column,
    ...(widget.rowSpan === undefined ? {} : { rowSpan: widget.rowSpan }),
    ...(widget.columnSpan === undefined ? {} : { columnSpan: widget.columnSpan }),
  } as PadWidget
  requireRoom(pad, pasted, widgetId)
  const result = replaceWidget(pad, widgetId, pasted)
  if (totalImageBytes(result) > PAD_DOCUMENT.MAX_TOTAL_IMAGE_BYTES) {
    throw new PadEditError(`パッド全体の画像が ${String(PAD_DOCUMENT.MAX_TOTAL_IMAGE_BYTES / (1024 * 1024))} MiB を超えます`)
  }
  return result
}

// --- ラベル・色・アドレス・画像 -------------------------------------------------------

function setLabel(pad: PadDocument, widgetId: string, part: PadDocumentEditPart | undefined, label: string): PadDocument {
  requireLabel(label)
  if (part === undefined) return updateWidget(pad, widgetId, (widget) => { widget.label = label })
  if ('action' in part) return withTable(pad, widgetId, (table) => { table.actions![requireActionIndex(table, part.action)]!.label = label })
  return withControl(pad, widgetId, part, control => ({ ...control, label }))
}

function setColor(pad: PadDocument, widgetId: string, color: string | null): PadDocument {
  return updateWidget(pad, widgetId, (widget) => {
    if (color === null || color === '') {
      delete widget.color
      return
    }
    const normalized = color.trim()
    if (!/^#[0-9A-Fa-f]{6}$/.test(normalized)) throw new PadEditError('色は #rrggbb の形で指定してください')
    widget.color = normalized.toUpperCase()
  })
}

/** 表の欄・アクションのアドレス(行のアドレスの後ろに付ける相対のパス)の入力欄に出す理由(正しければ null) */
export function relativeAddressProblem(address: string): string | null {
  if (address.startsWith('/')) return '行のアドレスの後ろに付けるので / で始めません'
  if (address.length > PAD_DOCUMENT.MAX_ADDRESS_CHARS) return `${String(PAD_DOCUMENT.MAX_ADDRESS_CHARS)} 文字までです`
  if (address.includes('\0')) return 'NUL 文字は使えません'
  if (hasLoneSurrogate(address)) return '孤立サロゲートは使えません'
  if (!RELATIVE_ADDRESS.test(address)) return '空白・* ? [ ] { } , と空のパート・末尾の / は使えません'
  return null
}

function setAddress(pad: PadDocument, widgetId: string, part: PadDocumentEditPart | undefined, address: string): PadDocument {
  if (part === undefined) {
    const problem = addressProblem(address)
    if (problem !== null) throw new PadEditError(problem)
    return updateWidget(pad, widgetId, (widget) => { widget.address = address })
  }
  const problem = relativeAddressProblem(address)
  if (problem !== null) throw new PadEditError(problem)
  if ('field' in part) throw new PadEditError('組み合わせの型の引数はアドレスを持ちません(部品のアドレスへまとめて送ります)')
  return withTable(pad, widgetId, (table) => {
    const target = 'column' in part ? table.columns[requireColumnIndex(table, part.column)]! : table.actions![requireActionIndex(table, part.action)]!
    // 欄どうし・欄とアクションが同じアドレスだと、エコーと保持値がどれのものか決まらない
    const others = [...table.columns, ...(table.actions ?? [])].filter(item => item !== target).map(item => item.address)
    if (others.includes(address)) throw new PadEditError(`${address} はこの表のほかの欄かアクションが使っています`)
    target.address = address
  })
}

function totalImageBytes(pad: PadDocument, except?: string): number {
  return pad.widgets.reduce((sum, widget) => widget.kind !== 'button' || widget.id === except || widget.image === undefined ? sum : sum + (imageDataUrlBytes(widget.image) ?? 0), 0)
}

function setImage(pad: PadDocument, widgetId: string, data: string | null): PadDocument {
  return updateWidget(pad, widgetId, (widget) => {
    if (widget.kind !== 'button') throw new PadEditError('画像はボタンだけに付けられます')
    if (data === null) delete widget.image
    else widget.image = imageDataUrlOf(data, totalImageBytes(pad, widgetId))
  })
}

// --- 決まった値(ボタンとアクションの引数) ---------------------------------------------

function defaultArg(type: PadArg['type']): PadArg {
  return type === 'T' || type === 'F' ? { type } : { type, value: DEFAULT_ARG_VALUES[type] } as PadArg
}

/**
 * 値を別の型の値にする。表せなければ undefined。数は文字列を経由せずに値で見る(i は int32 の整数、f は float32 に
 * 収まる有限の数)。入力欄の書き方(f の 1 は 1.0)を経由すると、f の 1 を i へ直すときに '1.0' を整数として読めず、
 * 表せる値まで落ちる(PR #172 のレビュー)。文字列は入力欄と同じ規則で数として読む
 */
function convertValue(to: 'i' | 'f' | 's', value: number | string): number | string | undefined {
  const text = typeof value === 'number' ? String(value) : value
  if (typeof value === 'number' && to !== 's') {
    const fits = to === 'i'
      ? Number.isInteger(value) && value >= -2147483648 && value <= 2147483647
      : Number.isFinite(value) && Number.isFinite(Math.fround(value))
    return fits ? value : undefined
  }
  try {
    return parseArgValue(to, text)
  } catch (error) {
    if (!(error instanceof PadEditError)) throw error
    return undefined
  }
}

/** 引数の型を変える。いまの値が新しい型で表せれば引き継ぎ、表せなければ既定値にする(T / F は値を持たない) */
function convertArg(arg: PadArg, type: PadArg['type']): PadArg {
  if (type === 'T' || type === 'F' || arg.type === 'T' || arg.type === 'F') return defaultArg(type)
  const value = convertValue(type, arg.value)
  return value === undefined ? defaultArg(type) : { type, value } as PadArg
}

/** ボタンの引数か、part が action ならその表のアクションの引数の写しを change で変える */
function withArgs(pad: PadDocument, widgetId: string, part: PadDocumentEditPart | undefined, change: (args: PadArg[]) => void): PadDocument {
  if (part === undefined) {
    return updateWidget(pad, widgetId, (widget) => {
      if (widget.kind !== 'button') throw new PadEditError('決まった値はボタンと表のアクションだけが持ちます')
      change(widget.args)
    })
  }
  if (!('action' in part)) throw new PadEditError('決まった値はボタンと表のアクションだけが持ちます')
  return withTable(pad, widgetId, (table) => { change(table.actions![requireActionIndex(table, part.action)]!.args) })
}

// --- 値を持つ操作 ---------------------------------------------------------------

/**
 * 値を持つ操作(part が無ければ部品そのもの、field なら組み合わせの型の引数、column なら表の欄)の写しを change で変える。
 * change は新しい操作を返す(種類を変えると欄の組が変わるため)
 */
function withControl(pad: PadDocument, widgetId: string, part: PadDocumentEditPart | undefined, change: (control: Control) => Control): PadDocument {
  return updateWidget(pad, widgetId, (widget) => {
    if (part === undefined) {
      if (widget.kind === 'button' || widget.kind === 'composite' || widget.kind === 'table') {
        throw new PadEditError(`${KIND_NAMES[widget.kind]} は値の型を持ちません${widget.kind === 'button' ? '' : '(引数・欄を選んでください)'}`)
      }
      return change(widget) as PadWidget
    }
    if ('field' in part) {
      if (widget.kind !== 'composite') throw new PadEditError('組み合わせの型ではありません')
      widget.fields[part.field] = change(requireIndex(widget.fields, part.field, 'その引数はありません')) as PadField
      return
    }
    if ('column' in part) {
      if (widget.kind !== 'table') throw new PadEditError('表ではありません')
      const index = requireColumnIndex(widget, part.column)
      widget.columns[index] = change(widget.columns[index]!) as PadTableColumn
      return
    }
    throw new PadEditError('アクションは値の型を持ちません')
  })
}

/** 型どおりの数として読む(i は int32、f は float32 に収まる有限の数) */
function parseNumber(type: 'i' | 'f', raw: string): number {
  return parseArgValue(type, raw) as number
}

/** 値の型を変える。範囲・刻み・候補は新しい型として読めるものだけを引き継ぐ */
function setValueType(control: Control, type: ValueType): Control {
  const allowed = VALUE_TYPES[control.kind]
  if (!allowed.includes(type)) throw new PadEditError(`${KIND_NAMES[control.kind]} の型は ${allowed.join(' / ')} です`)
  if (control.type === type) return control
  const changed = { ...control, type } as Control & Record<string, unknown>
  if (control.kind === 'slider' || control.kind === 'number') {
    const numeric = type as 'i' | 'f'
    // i へ直すときは範囲の内側の整数へ丸める(OSCQuery の RANGE から作るときと同じ。外側へ広げると送れない値を選べる)
    const read = (value: number | undefined, round: (value: number) => number) =>
      value === undefined ? undefined : convertValue(numeric, numeric === 'i' ? round(value) : value) as number | undefined
    const [min, max] = [read(control.min, Math.ceil), read(control.max, Math.floor)]
    for (const [key, value] of [['min', min], ['max', max]] as const) {
      if (value === undefined) delete changed[key]
      else changed[key] = value
    }
    // 刻みは丸めない(丸めると刻みの意味が変わる)。新しい型で表せなければ外す
    if (control.step !== undefined && convertValue(numeric, control.step) === undefined) delete changed.step
    // スライダーは両側が要る。読めない・幅が無くなったら型の既定の範囲に戻す
    if (control.kind === 'slider' && !(min !== undefined && max !== undefined && min < max)) {
      changed.min = 0
      changed.max = numeric === 'i' ? 100 : 1
    }
  }
  if (control.kind === 'select') {
    const target = type as 'i' | 'f' | 's'
    const options: PadOption[] = []
    // 新しい型で表せる候補はラベルごと引き継ぎ、表せない候補と、直した結果が重なる候補だけを落とす
    for (const option of control.options) {
      const value = convertValue(target, option.value)
      if (value !== undefined && !options.some(existing => existing.value === value)) options.push({ ...option, value })
    }
    changed.options = options.length > 0 ? options : [{ value: target === 's' ? 'a' : 0 }]
  }
  return changed
}

function setRange(control: Control, minRaw: string | null, maxRaw: string | null): Control {
  if (control.kind !== 'slider' && control.kind !== 'number') throw new PadEditError('範囲はスライダーと数値の入力だけが持ちます')
  const type = control.type
  const read = (raw: string | null) => raw === null || raw.trim() === '' ? undefined : parseNumber(type, raw)
  const [min, max] = [read(minRaw), read(maxRaw)]
  if (control.kind === 'slider') {
    if (min === undefined || max === undefined) throw new PadEditError('スライダーには最小と最大の両方が要ります')
    if (!(min < max)) throw new PadEditError('最大は最小より大きくしてください')
    return { ...control, min, max }
  }
  if (min !== undefined && max !== undefined && min > max) throw new PadEditError('最大は最小以上にしてください')
  const changed = { ...control }
  if (min === undefined) delete changed.min
  else changed.min = min
  if (max === undefined) delete changed.max
  else changed.max = max
  return changed
}

function setStep(control: Control, raw: string | null): Control {
  if (control.kind !== 'slider' && control.kind !== 'number') throw new PadEditError('刻みはスライダーと数値の入力だけが持ちます')
  const changed = { ...control }
  if (raw === null || raw.trim() === '') {
    delete changed.step
    return changed
  }
  const step = parseNumber(control.type, raw)
  if (!(step > 0)) throw new PadEditError('刻みは 0 より大きい数です')
  changed.step = step
  return changed
}

/** 選択の候補の写しを change で変える */
function withOptions(pad: PadDocument, widgetId: string, part: PadDocumentEditPart | undefined, change: (options: PadOption[], type: 'i' | 'f' | 's') => void): PadDocument {
  return withControl(pad, widgetId, part, (control) => {
    if (control.kind !== 'select') throw new PadEditError('候補は選択だけが持ちます')
    const options = structuredClone(control.options)
    change(options, control.type)
    return { ...control, options }
  })
}

function optionOf(type: 'i' | 'f' | 's', raw: string, label: string | undefined, others: readonly PadOption[]): PadOption {
  const value = parseArgValue(type, raw)
  if (others.some(option => option.value === value)) throw new PadEditError(`候補 ${String(value)} は既にあります`)
  return label === undefined || label === '' ? { value } : { value, label: requireLabel(label) }
}

function setResend(pad: PadDocument, widgetId: string, part: PadDocumentEditPart | undefined, resend: boolean): PadDocument {
  if (part !== undefined) {
    if (!('column' in part)) throw new PadEditError('送り直すかは部品か表の欄ごとに決めます')
    return withTable(pad, widgetId, (table) => { table.columns[requireColumnIndex(table, part.column)]!.resend = resend })
  }
  return updateWidget(pad, widgetId, (widget) => {
    if (widget.kind === 'button') throw new PadEditError('ボタンは決まった値を送るだけで、送り直しません')
    if (widget.kind === 'table') throw new PadEditError('表は欄ごとに送り直すかを決めます')
    widget.resend = resend
  })
}

function setReadOnly(pad: PadDocument, widgetId: string, readOnly: boolean): PadDocument {
  return updateWidget(pad, widgetId, (widget) => {
    if (widget.kind === 'button' || widget.kind === 'table') throw new PadEditError(`${KIND_NAMES[widget.kind]} は表示だけにできません`)
    if (readOnly) {
      widget.readOnly = true
      // 表示だけの部品は送らないので、送り直しもしない
      widget.resend = false
    } else {
      delete widget.readOnly
    }
  })
}

// --- 組み合わせの型と表 -------------------------------------------------------------

function withComposite(pad: PadDocument, widgetId: string, change: (fields: PadField[]) => void): PadDocument {
  return updateWidget(pad, widgetId, (widget) => {
    if (widget.kind !== 'composite') throw new PadEditError('組み合わせの型ではありません')
    change(widget.fields)
  })
}

function withTable(pad: PadDocument, widgetId: string, change: (table: PadTableWidget) => void): PadDocument {
  return updateWidget(pad, widgetId, (widget) => {
    if (widget.kind !== 'table') throw new PadEditError('表ではありません')
    change(widget)
  })
}

function withUiRows(pad: PadDocument, widgetId: string, change: (keys: { key: string; label: string }[], max: number | undefined) => void): PadDocument {
  return withTable(pad, widgetId, (table) => {
    if (table.rows.source !== 'ui') throw new PadEditError('ターゲットが持つ行は編集できません(OSCQuery の名前空間から届きます)')
    change(table.rows.keys, table.rows.max)
  })
}

function setRowSource(table: PadTableWidget, source: 'target' | 'ui'): void {
  if (table.rows.source === source) return
  // UI で管理する行を黙って捨てない(先に消してもらう)
  if (table.rows.source === 'ui' && table.rows.keys.length > 0) throw new PadEditError('UI で管理する行が残っています。先に行を消してください')
  table.rows = source === 'ui' ? { source: 'ui', keys: [] } : { source: 'target' }
}

function requireRow(keys: readonly { key: string }[], key: string): number {
  const index = keys.findIndex(row => row.key === key)
  if (index < 0) throw new PadEditError(`行 ${key} がありません`)
  return index
}

function requireColumnIndex(table: PadTableWidget, columnId: string): number {
  const index = table.columns.findIndex(column => column.id === columnId)
  if (index < 0) throw new PadEditError(`欄 ${columnId} がありません`)
  return index
}

function requireActionIndex(table: PadTableWidget, actionId: string): number {
  const index = (table.actions ?? []).findIndex(action => action.id === actionId)
  if (index < 0) throw new PadEditError(`アクション ${actionId} がありません`)
  return index
}

/** 表の欄とアクションが使っている相対のアドレス(足す欄・アクションの仮のアドレスと重ねない) */
function usedRelativeAddresses(table: PadTableWidget): string[] {
  return [...table.columns.map(column => column.address), ...(table.actions ?? []).map((action: PadTableAction) => action.address)]
}
