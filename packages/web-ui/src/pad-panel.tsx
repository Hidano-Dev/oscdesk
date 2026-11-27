// パッドの主画面(D-170)。採用中のパッド(版 2)の部品を格子に描いて操作し、「パッドを編集」で編集する。
// 状態は pad-store(実行)と pad-edit-store(編集)の signal を読むだけで、規則はブリッジ(編集・値の検査・ロック)。
// 編集中は部品を押すと Inspector で設定を変え、空きマスを押すとそこに部品を足す。OSCQuery のパレットの候補を選んだマス
// (無ければ最初の空きマス)に置ける。Inspector は広い画面では右の列に、狭い画面では格子の下に出す(D-091・D-147・D-160)
import type { ComponentChildren } from 'preact'
import { useRef, useState } from 'preact/hooks'

import type { PadCompositeWidget, PadDocument, PadTableWidget, PadValueWidget, PadWidget } from '@oscdesk/shared'

import { ControlView, SliderControl, type Binding } from './pad-controls'
import type { PadEditStore } from './pad-edit-store'
import { PadInspector, pickAndRevert } from './pad-inspector'
import { KIND_LABELS, bulkState, cellName, defaultControlValue, occupancy, widgetCellStyle } from './pad-logic'
import { PalettePanel } from './pad-palette'
import type { PadStore } from './pad-store'
import { colorHex, isPrimaryPress, parseColorHex, type Scalar, type Values } from './value-channel'
import { Modal } from './widgets'

export const NO_PAD_TEXT = 'パッドがありません。「パッドを編集」をオンにして作るか、保存済みのパッドに切り替えてください。'
const WAITING_TEXT = 'パッドを待っています(ブリッジの osc.padDocument)'
const NO_OSC_TEXT = 'このブリッジは OSC のアダプタを持っていないため、パッドを使えません。'

/** Inspector を出すか(編集中に部品か空きマスを選んでいる)。広い画面では右の列を借りる */
export function inspecting(edit: PadEditStore): boolean {
  return edit.session.value !== null && edit.selection.value !== null && (edit.selectedWidget.value !== undefined || 'cell' in edit.selection.value)
}

/** inspectorInAside: Inspector を右の列に出す(App が描く)ので、ここでは格子の下に描かない */
export function PadPanel({ pad, edit, inspectorInAside = false }: { pad: PadStore; edit: PadEditStore; inspectorInAside?: boolean }) {
  if (!pad.oscAvailable.value) return <section class="panel pad" aria-label="パッド"><p class="muted">{NO_OSC_TEXT}</p></section>
  const editing = edit.session.value !== null
  return (
    <section class="panel pad" aria-label="パッド">
      <PadHeader pad={pad} edit={edit} />
      {editing && <Toolbar pad={pad} edit={edit} />}
      {edit.conflicted.value && <p class="caption negative">別の端末などがパッドを保存・切り替えました。保存すると上書きします</p>}
      {editing && <p class="caption">部品を押すと{inspectorInAside ? '右の列' : '格子の下'}(Inspector)で設定を変えます。空きマス(+)を押すとそこに部品を足すか、下のパレットから置けます。</p>}
      {editing ? <EditGrid edit={edit} /> : <RunGrid pad={pad} />}
      {editing && !inspectorInAside && inspecting(edit) && <PadInspector edit={edit} />}
      {editing && <PalettePanel pad={pad} edit={edit} />}
      <Modal><ConfirmDialog edit={edit} /></Modal>
    </section>
  )
}

function PadHeader({ pad, edit }: { pad: PadStore; edit: PadEditStore }) {
  const session = edit.session.value
  const adopted = pad.adopted.value
  const title = session !== null ? `編集中: ${session.baseName ?? '(新規)'}` : adopted !== null ? `パッド: ${adopted.name}` : 'パッド: 未選択'
  return (
    <header class="panel-head">
      <h2>パッド</h2>
      {/* 当たり判定はスイッチ本体だけ(HID-255。文字まで押せると実行中に誤って編集へ入る) */}
      <span class="switch-row">
        <input
          type="checkbox"
          role="switch"
          class="switch"
          aria-label="パッドを編集"
          checked={session !== null}
          onChange={(event) => {
            const next = event.currentTarget.checked
            // 見た目は store の状態で描き直す(破棄の確認をやめたらオンのまま)
            event.currentTarget.checked = session !== null
            edit.setEditing(next)
          }}
        />
        <span class="select-none">パッドを編集</span>
      </span>
      <span class="caption" data-mark="pad-title">{title}</span>
      {edit.unsaved.value && <span class="caption text-warn">未保存の変更があります</span>}
    </header>
  )
}

function Toolbar({ pad, edit }: { pad: PadStore; edit: PadEditStore }) {
  const load = useRef<HTMLSelectElement>(null)
  const connected = pad.connected.value
  const draft = edit.draft.value
  return (
    <div class="pad-toolbar">
      <span class="pad-field">
        <select ref={load} aria-label="保存済み" defaultValue="">
          <option value="">保存済み…</option>
          {pad.names.value.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <button type="button" disabled={!connected} onClick={() => edit.load(load.current?.value ?? '')}>切り替え</button>
      </span>
      <span class="pad-field">
        <input type="text" aria-label="保存名" placeholder="保存名" value={edit.saveName.value} onInput={(event) => edit.setSaveName(event.currentTarget.value)} />
        <button type="button" class="primary" disabled={!connected} onClick={() => edit.save()}>保存</button>
      </span>
      <button type="button" onClick={() => edit.startNew()}>新規</button>
      {draft !== null && <SizeSelect edit={edit} pad={draft} />}
    </div>
  )
}

function SizeSelect({ edit, pad }: { edit: PadEditStore; pad: PadDocument }) {
  const revision = String(edit.formRevision.value)
  const choices = (max: number) => Array.from({ length: max }, (_, index) => index + 1)
  return (
    <label class="pad-size-select">
      <span class="caption">格子</span>
      <select aria-label="行数" value={String(pad.rows)} key={`r${revision}`} onChange={(event) => edit.resize(Number(pickAndRevert(event.currentTarget, String(pad.rows))), pad.columns)}>
        {choices(12).map((n) => <option key={n} value={String(n)}>{n}</option>)}
      </select>
      <span>行 ×</span>
      <select aria-label="列数" value={String(pad.columns)} key={`c${revision}`} onChange={(event) => edit.resize(pad.rows, Number(pickAndRevert(event.currentTarget, String(pad.columns))))}>
        {choices(12).map((n) => <option key={n} value={String(n)}>{n}</option>)}
      </select>
      <span>列</span>
    </label>
  )
}

// --- 格子 -------------------------------------------------------------------------------

function gridStyle(pad: PadDocument): Record<string, string> {
  return { gridTemplateColumns: `repeat(${String(pad.columns)}, minmax(0, 1fr))` }
}

function placeStyle(widget: Pick<PadWidget, 'row' | 'column' | 'rowSpan' | 'columnSpan'>): Record<string, string> {
  return {
    gridRow: `${String(widget.row + 1)} / span ${String(widget.rowSpan ?? 1)}`,
    gridColumn: `${String(widget.column + 1)} / span ${String(widget.columnSpan ?? 1)}`,
  }
}

function RunGrid({ pad }: { pad: PadStore }) {
  const adopted = pad.adopted.value
  if (adopted === null) return <p class="muted" data-mark={pad.noPad.value ? 'no-pad' : 'waiting'}>{pad.noPad.value ? NO_PAD_TEXT : WAITING_TEXT}</p>
  const cells = occupancy(adopted.pad)
  const empties = []
  for (let row = 0; row < adopted.pad.rows; row += 1) {
    for (let column = 0; column < adopted.pad.columns; column += 1) {
      if (!cells.has(cellName(row, column))) empties.push(<div key={`e${cellName(row, column)}`} class="pad-cell empty" style={placeStyle({ row, column })} />)
    }
  }
  // パッドが差し替わったら作り直す(key)。同じ内容の再採用では作り直さないので、操作中の部品は壊れない
  return (
    <div class="pad-grid" key={adopted.generation} style={gridStyle(adopted.pad)}>
      {adopted.pad.widgets.map((widget) => <RunWidget key={widget.id} pad={pad} widget={widget} />)}
      {empties}
    </div>
  )
}

/** role="button" の div をキーボードで押すキー(ネイティブの button と同じ Enter と Space)。 */
function isActivationKey(event: KeyboardEvent): boolean {
  return event.key === 'Enter' || event.key === ' '
}

function LockBadge({ label }: { label: string | null }) {
  return label === null ? null : <span class="caption warn">操作中: {label}</span>
}

function RunWidget({ pad, widget }: { pad: PadStore; widget: PadWidget }) {
  if (widget.kind === 'button') {
    return (
      <div
        role="button"
        tabIndex={0}
        class="pad-cell run"
        style={{ ...widgetCellStyle(widget), ...placeStyle(widget) }}
        aria-label={widget.label || widget.id}
        aria-disabled={!pad.connected.value}
        data-widget={widget.id}
        // 押下は左ボタン(タッチ・ペンの主接触を含む)の pointerdown だけで送る。click は指を離すまで待つので使わない(D-081)
        onPointerDown={(event) => {
          if (isPrimaryPress(event)) pad.press(widget)
        }}
        onKeyDown={(event) => {
          if (!isActivationKey(event)) return
          // 押し続けた Space の繰り返しもスクロールさせない(送るのは最初の 1 回だけ。HID-476)
          event.preventDefault()
          if (!event.repeat) pad.press(widget)
        }}
        onContextMenu={(event) => event.preventDefault()}
      >
        <span class={widget.image === undefined ? 'pad-label' : 'pad-label over-image'}>{widget.label}</span>
      </div>
    )
  }
  const locked = widget.kind === 'table' ? null : pad.widgetLockLabel(widget.id)
  return (
    <div class="pad-widget s-card" style={{ ...placeStyle(widget), ...(widget.color === undefined ? {} : { borderTop: `4px solid ${widget.color}` }) }} data-widget={widget.id} data-kind={widget.kind}>
      {widget.kind === 'table' ? <TableView pad={pad} table={widget} />
        : widget.kind === 'composite' ? <CompositeView pad={pad} widget={widget} />
          : <ValueView pad={pad} widget={widget} />}
      <LockBadge label={locked} />
    </div>
  )
}

function widgetBinding(pad: PadStore, widget: PadWidget, value: Scalar | null, disabled: boolean, merge: (value: Scalar) => Values = (value) => [value]): Binding {
  const channel = pad.channelOf(widget.id)
  return {
    value,
    disabled,
    holdBegin: (kind) => pad.beginHold(widget, kind),
    holdEnd: () => pad.endHold(widget),
    setEditing: (editing) => pad.setEditing(widget, editing),
    setLocal: (next) => pad.setLocal(widget, merge(next)),
    setDiscrete: (next) => pad.setDiscrete(widget, merge(next)),
    setDraft: (raw) => pad.setDraft(widget, raw),
    draft: channel.holding ? channel.draft : null,
    warn: (text) => pad.warn(text, 'error'),
  }
}

function ValueView({ pad, widget }: { pad: PadStore; widget: PadValueWidget }) {
  const values = pad.channelOf(widget.id).shown.value
  const disabled = !pad.connected.value || widget.readOnly === true || pad.widgetLockLabel(widget.id) !== null
  if (widget.kind === 'color') return <ColorView pad={pad} widget={widget} values={values} disabled={disabled} />
  return (
    <>
      <ControlView control={widget} binding={widgetBinding(pad, widget, values?.[0] ?? null, disabled)} label={widget.label} />
      {widget.readOnly === true && <span class="caption">表示だけ(読むだけのアドレス)</span>}
    </>
  )
}

/** 色。ffff は範囲 0〜1 の RGBA で、色の選択と不透明度のスライダー。r(OSC 1.0 の 32 ビット色)はワイヤで運べないので表示だけ */
function ColorView({ pad, widget, values, disabled }: { pad: PadStore; widget: Extract<PadValueWidget, { kind: 'color' }>; values: Values | null; disabled: boolean }) {
  if (widget.type === 'r') {
    return (
      <div class="s-col tight">
        <span class="caption">{widget.label}</span>
        <span class="caption warn">r の色はまだ送れません(型を ffff にしてください)</span>
      </div>
    )
  }
  const latest = (values ?? [1, 1, 1, 1]).map((value) => Number(value))
  const hex = colorHex(latest)
  const alphaBinding = widgetBinding(pad, widget, latest[3] ?? 1, disabled, (alpha) => latest.map((item, index) => (index === 3 ? Number(alpha) : item)))
  return (
    <div class="s-col tight">
      <label class="s-field">
        <span class="caption">{widget.label}</span>
        <input
          type="color"
          value={hex}
          disabled={disabled}
          aria-label={widget.label}
          // 色は決めたとき(change)だけを送る(選んでいる間の input で送ると、色の選択の度に送る。D-143)
          onChange={(event) => {
            const rgb = parseColorHex(event.currentTarget.value)
            if (rgb === null) return
            if (!pad.setDiscrete(widget, [...rgb, latest[3] ?? 1])) event.currentTarget.value = hex
          }}
        />
      </label>
      <SliderControl control={{ kind: 'slider', type: 'f', min: 0, max: 1, step: 0.001 }} binding={alphaBinding} label="不透明度" />
    </div>
  )
}

function CompositeView({ pad, widget }: { pad: PadStore; widget: PadCompositeWidget }) {
  const values = pad.channelOf(widget.id).shown.value
  const disabled = !pad.connected.value || widget.readOnly === true || pad.widgetLockLabel(widget.id) !== null
  // 値がまだ無い引数は既定の値で埋める(組み合わせの型は全引数を 1 つのメッセージで送る)
  const base = (): Scalar[] => widget.fields.map((field, index) => values?.[index] ?? defaultControlValue(field))
  // 引数の入力欄のどれかがフォーカス中なら、組み合わせの部品の操作を終えない
  const editingFields = useRef(new Set<number>())
  return (
    <div class="s-col tight">
      <span class="caption">{widget.label}{widget.hint === undefined ? '' : ` (${widget.hint})`}</span>
      {widget.fields.map((field, index) => {
        const binding = widgetBinding(pad, widget, values?.[index] ?? null, disabled, (value) => base().map((item, position) => (position === index ? value : item)))
        return (
          <ControlView
            key={field.id}
            control={field}
            label={field.label}
            binding={{
              ...binding,
              holdEnd: () => {
                editingFields.current.delete(index)
                if (editingFields.current.size === 0) pad.endHold(widget)
              },
              setEditing: (editing) => {
                if (editing) editingFields.current.add(index)
                pad.setEditing(widget, editingFields.current.size > 0)
              },
              // 引数ごとの下書きは持たない(組み合わせの型の下書きは 1 つで、どの引数のものか分からない)
              draft: null,
              setDraft: undefined,
            }}
          />
        )
      })}
      {widget.readOnly === true && <span class="caption">表示だけ(読むだけのアドレス)</span>}
    </div>
  )
}

// --- 表 -------------------------------------------------------------------------------

function TableView({ pad, table }: { pad: PadStore; table: PadTableWidget }) {
  const rows = pad.rowsOf(table)
  const connected = pad.connected.value
  const rowActions = (table.actions ?? []).filter((action) => action.scope === 'row')
  const allActions = (table.actions ?? []).filter((action) => action.scope === 'all')
  const ui = table.rows.source === 'ui'
  const template = [`minmax(120px,2fr)`, ...table.columns.map((column) => (column.kind === 'toggle' ? '64px' : 'minmax(80px,2fr)')), ...(rowActions.length > 0 || ui ? ['auto'] : [])].join(' ')
  const style = `grid-template-columns:${template}`
  const hasBulk = table.columns.some((column) => column.bulk === true)
  return (
    <div class="s-record" data-table={table.id}>
      <h3>{table.label}</h3>
      <div class="s-record-body">
        <div class="s-record-scroll">
          <div class="s-grid s-grid-head caption" style={style}>
            <span>行</span>
            {table.columns.map((column) => <span key={column.id}>{column.label}</span>)}
            {(rowActions.length > 0 || ui) && <span />}
          </div>
          {hasBulk && (
            <div class="s-grid s-grid-row" style={style} data-mark="bulk">
              <span class="caption">全行</span>
              {table.columns.map((column) => {
                if (column.bulk !== true) return <span key={column.id} />
                const state = bulkState(rows.map((row) => pad.cellChannelOf(table.id, row.key, column.id).shown.value))
                return (
                  <span key={column.id} class="s-col tight">
                    <input type="checkbox" aria-label={`${column.label} を全行`} checked={state.on} disabled={!connected || rows.length === 0} onChange={(event) => {
                      const next = event.currentTarget.checked
                      event.currentTarget.checked = state.on
                      pad.setColumnAll(table, column.id, next)
                    }} />
                    {state.mixed && <span class="caption">一部オン</span>}
                  </span>
                )
              })}
              {(rowActions.length > 0 || ui) && <span />}
            </div>
          )}
          {rows.map((row) => <TableRowView key={row.key} pad={pad} table={table} rowKey={row.key} label={row.label} style={style} />)}
          {rows.length === 0 && <p class="caption">{ui ? '行がありません(下の欄から追加してください)' : '行がありません(ターゲットの名前空間か保持値に行が現れると出ます)'}</p>}
          {ui && <AddRow pad={pad} table={table} />}
        </div>
        {allActions.length > 0 && (
          <div class="s-table-actions">
            {allActions.map((action) => (
              // pointerdown でなく click: 誤ってなぞっただけで全行へ送るのを避ける
              <button key={action.id} type="button" class="s-action tall" disabled={!connected || rows.length === 0} onClick={() => pad.pressAction(table, action.id)}>{action.label}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function TableRowView({ pad, table, rowKey, label, style }: { pad: PadStore; table: PadTableWidget; rowKey: string; label: string; style: string }) {
  const locked = pad.rowLockLabel(table.id, rowKey)
  const disabled = locked !== null || !pad.connected.value
  const rowActions = (table.actions ?? []).filter((action) => action.scope === 'row')
  const ui = table.rows.source === 'ui'
  return (
    <div class="s-grid s-grid-row" style={style} data-row={rowKey}>
      <div class="s-col tight">
        <strong class="pad-row-name">{label}</strong>
        {label !== rowKey && <span class="caption">{rowKey}</span>}
        <LockBadge label={locked} />
      </div>
      {table.columns.map((column) => {
        const value = pad.cellChannelOf(table.id, rowKey, column.id).shown.value?.[0] ?? null
        const binding: Binding = {
          value,
          disabled,
          holdBegin: (kind) => pad.beginCellHold(table, rowKey, column.id, kind),
          holdEnd: () => pad.endCellHold(table, rowKey, column.id),
          setEditing: (editing) => pad.setCellEditing(table, rowKey, column.id, editing),
          setLocal: (next) => pad.setCellLocal(table, rowKey, column.id, next),
          setDiscrete: (next) => pad.setCellDiscrete(table, rowKey, column.id, next),
          warn: (text) => pad.warn(text, 'error'),
        }
        // 欄の見出しが表示名を持つので、マスごとの表示名は出さない
        return <div key={column.id} class="s-cell" data-column={column.id}><ControlView control={column} binding={binding} label="" /></div>
      })}
      {(rowActions.length > 0 || ui) && (
        <span class="s-inline">
          {rowActions.map((action) => (
            <button key={action.id} type="button" class="s-action" disabled={disabled} onClick={() => pad.pressAction(table, action.id, rowKey)}>{action.label}</button>
          ))}
          {ui && <RemoveRow pad={pad} table={table} rowKey={rowKey} label={label} />}
        </span>
      )}
    </div>
  )
}

/** UI で管理する行の削除。× を押すと確かめる項目を出し、その項目で消す(ブラウザのダイアログは使わない) */
function RemoveRow({ pad, table, rowKey, label }: { pad: PadStore; table: PadTableWidget; rowKey: string; label: string }) {
  const [open, setOpen] = useState(false)
  return (
    <span class="s-inline">
      <button type="button" class="icon small" aria-label={`行 ${label} を削除`} aria-expanded={open} disabled={!pad.connected.value} onClick={() => setOpen(!open)}>×</button>
      {open && (
        <button type="button" class="flat negative small" onClick={() => {
          setOpen(false)
          const error = pad.removeRow(table, rowKey)
          if (error !== null) pad.warn(error)
        }}>「{label}」を削除</button>
      )}
    </span>
  )
}

/** 表の下の行の追加(UI で管理する行)。ID は行ごとのアドレスの 1 段になり、名前は表示だけ */
function AddRow({ pad, table }: { pad: PadStore; table: PadTableWidget }) {
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const rows = table.rows.source === 'ui' ? table.rows : null
  const full = rows !== null && rows.keys.length >= (rows.max ?? 1000)
  const connected = pad.connected.value
  const add = () => {
    if (full) return
    const error = pad.addRow(table, key, name.trim() === '' ? key.trim() : name.trim())
    if (error !== null) {
      pad.warn(error)
      return
    }
    // 行はブリッジが保存して採用し直した時点で表に出る。欄は次の行のために空ける
    setKey('')
    setName('')
  }
  const enter = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) add()
  }
  return (
    <div class="s-add">
      <input type="text" aria-label="追加する行の ID" placeholder="行の ID(英数字・_・-)" value={key} disabled={full || !connected} onInput={(event) => setKey(event.currentTarget.value)} onKeyDown={enter} />
      <input type="text" aria-label="追加する行の名前" placeholder="名前(任意)" value={name} disabled={full || !connected} onInput={(event) => setName(event.currentTarget.value)} onKeyDown={enter} />
      <button type="button" class="primary" disabled={full || !connected || key.trim() === ''} onClick={add}>行を追加</button>
    </div>
  )
}

// --- 編集の格子 ---------------------------------------------------------------------------

function EditGrid({ edit }: { edit: PadEditStore }) {
  const draft = edit.draft.value
  if (draft === null) return null
  const cells = occupancy(draft)
  const picked = edit.selection.value
  const items: ComponentChildren[] = []
  for (const widget of draft.widgets) {
    const selected = picked !== null && 'widget' in picked && picked.widget === widget.id
    items.push(
      <div
        key={widget.id}
        role="button"
        tabIndex={0}
        class={selected ? 'pad-cell edit selected' : 'pad-cell edit'}
        style={{ ...widgetCellStyle(widget.kind === 'button' ? widget : { ...(widget.color === undefined ? {} : { color: widget.color }) }), ...placeStyle(widget) }}
        aria-label={widget.label || widget.id}
        aria-pressed={selected}
        data-widget={widget.id}
        onClick={() => edit.select({ widget: widget.id })}
        onKeyDown={(event) => {
          if (!isActivationKey(event)) return
          // div は Space の既定の動作(ページのスクロール)を持つので止める(HID-476)
          event.preventDefault()
          edit.select({ widget: widget.id })
        }}
      >
        <span class="pad-label">{widget.label}</span>
        <span class="pad-caption">{KIND_LABELS[widget.kind]}{'address' in widget ? ` ${widget.address}` : ''}</span>
      </div>,
    )
  }
  for (let row = 0; row < draft.rows; row += 1) {
    for (let column = 0; column < draft.columns; column += 1) {
      if (cells.has(cellName(row, column))) continue
      const selected = picked !== null && 'cell' in picked && picked.cell.row === row && picked.cell.column === column
      items.push(
        <button
          key={`e${cellName(row, column)}`}
          type="button"
          class={selected ? 'pad-cell empty edit selected' : 'pad-cell empty edit'}
          style={placeStyle({ row, column })}
          aria-label={`${String(row + 1)} 行 ${String(column + 1)} 列に部品を足す`}
          aria-pressed={selected}
          data-cell={cellName(row, column)}
          onClick={() => edit.select({ cell: { row, column } })}
        >
          +
        </button>,
      )
    }
  }
  return <div class="pad-grid" style={gridStyle(draft)}>{items}</div>
}

function ConfirmDialog({ edit }: { edit: PadEditStore }) {
  const asked = edit.confirm.value
  if (asked === null) return null
  // 外側を押しても閉じない(スイッチの表示と実際のモードがずれないように)
  return (
    <div class="backdrop">
      <div class="dialog" role="alertdialog" aria-label={asked.message}>
        <p>{asked.message}</p>
        <div class="dialog-actions">
          <button type="button" onClick={() => edit.answerConfirm(false)}>やめる</button>
          <button type="button" class="primary danger" onClick={() => edit.answerConfirm(true)}>{asked.okLabel}</button>
        </div>
      </div>
    </div>
  )
}
