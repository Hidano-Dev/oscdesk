// パッドの部品の Inspector(D-170)。編集中に選んだ部品の設定を、編集命令(PadDocumentEdit)として pad-edit-store へ渡す。
// 規則(何を書けるか・値の読み取り・既定値)はブリッジの pad-document-editor が持ち、ここは欄を並べて命令を作るだけ。
// 入力欄は打った文字を欄に残し(断られた理由は欄の下)、構造の命令の答えで作業コピーから作り直す(D-147・D-161 と同じ)
import type { ComponentChildren } from 'preact'
import { useState } from 'preact/hooks'

import {
  PAD_DOCUMENT,
  type PadArg,
  type PadControl,
  type PadDocumentEditPart,
  type PadTableWidget,
  type PadWidget,
  type PadWidgetKind,
} from '@oscdesk/shared'

import type { PadEditStore } from './pad-edit-store'
import { ARG_TYPES, DEFAULT_WIDGET_COLOR, FIELD_KINDS, KIND_LABELS, VALUE_TYPES, editText, fieldKeyOf, formatArg, numberText, partKeyOf } from './pad-logic'
import { Check } from './widgets'

const WIDGET_KINDS = Object.keys(KIND_LABELS) as PadWidgetKind[]
const VALUE_KINDS = new Set<string>(['toggle', 'slider', 'select', 'number', 'text', 'color'])

export function PadInspector({ edit }: { edit: PadEditStore }) {
  const picked = edit.selection.value
  const widget = edit.selectedWidget.value
  if (edit.session.value === null || picked === null) return null
  // 作業コピーから欄を作り直すとき(構造の命令・断られた・選び直し)だけ key が変わる。入力欄の命令では変わらない
  const revision = String(edit.formRevision.value)
  if ('cell' in picked) {
    return (
      <div class="inspector" aria-label="部品を足す" key={`${revision}-cell`}>
        <Head edit={edit} title={`${String(picked.cell.row + 1)} 行 ${String(picked.cell.column + 1)} 列`} />
        <AddWidgetForm edit={edit} cell={picked.cell} />
      </div>
    )
  }
  if (widget === undefined) return null
  return (
    <div class="inspector" aria-label="パッドの部品" key={`${revision}-${widget.id}`}>
      <Head edit={edit} title={`${KIND_LABELS[widget.kind]} (${widget.id})`} />
      <Fold title="部品">
        <Row name="種類">
          <select aria-label="部品の種類" value={widget.kind} onChange={(event) => edit.edit({ op: 'setKind', widget: widget.id, kind: pickAndRevert(event.currentTarget, widget.kind) as PadWidgetKind })}>
            {WIDGET_KINDS.map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}
          </select>
        </Row>
        <Row name="ラベル">
          <TextField edit={edit} errorKey={fieldKeyOf('setLabel', widget.id)} initial={widget.label} label="ラベル" maxLength={PAD_DOCUMENT.MAX_LABEL_CHARS} onInput={(text) => edit.editField({ op: 'setLabel', widget: widget.id, label: text })} />
        </Row>
        <Placement edit={edit} widget={widget} />
        <Row name="背景色">
          <span class="pad-field">
            <input type="color" aria-label="背景色" disabled={edit.formLocked.value} defaultValue={(widget.color ?? DEFAULT_WIDGET_COLOR).toLowerCase()} onInput={(event) => edit.setColor(widget.id, event.currentTarget.value)} />
            <span class="caption">{widget.color ?? '既定'}</span>
            <button type="button" disabled={widget.color === undefined} onClick={() => edit.setColor(widget.id, null)}>既定に戻す</button>
          </span>
        </Row>
        {widget.kind === 'button' && <ImageRow edit={edit} widget={widget} />}
      </Fold>
      <Fold title="OSC">
        <Row name={widget.kind === 'table' ? '行の根' : 'アドレス'}>
          <TextField edit={edit} errorKey={fieldKeyOf('setAddress', widget.id)} initial={widget.address} label="アドレス" onInput={(text) => edit.editField({ op: 'setAddress', widget: widget.id, address: text })} />
        </Row>
        {widget.kind === 'button' && <ArgsEditor edit={edit} widget={widget.id} args={widget.args} />}
        {VALUE_KINDS.has(widget.kind) && 'type' in widget && <ControlSettings edit={edit} widget={widget.id} control={widget as PadControl} />}
        {(VALUE_KINDS.has(widget.kind) || widget.kind === 'composite') && 'resend' in widget && (
          <>
            <Row name="送り直す">
              <Check label="自動の再送と手動の同期で送る" checked={widget.resend} disabled={edit.formLocked.value} onChange={(resend) => edit.edit({ op: 'setResend', widget: widget.id, resend })} />
            </Row>
            <Row name="表示だけ">
              <Check label="送らずに値を見せるだけ" checked={widget.readOnly === true} disabled={edit.formLocked.value} onChange={(readOnly) => edit.edit({ op: 'setReadOnly', widget: widget.id, readOnly })} />
            </Row>
          </>
        )}
      </Fold>
      {widget.kind === 'composite' && (
        <Fold title={`引数 (${String(widget.fields.length)})`}>
          {widget.fields.map((field, index) => (
            <div class="fold child" key={field.id}>
              <Row name={`引数 ${String(index + 1)}`}>
                <span class="arg-row">
                  <select aria-label={`引数 ${String(index + 1)} の種類`} value={field.kind} onChange={(event) => edit.edit({ op: 'setKind', widget: widget.id, part: { field: index }, kind: pickAndRevert(event.currentTarget, field.kind) as PadWidgetKind })}>
                    {FIELD_KINDS.map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}
                  </select>
                  <MoveRemove label={`引数 ${String(index + 1)}`} first={index === 0} last={index === widget.fields.length - 1}
                    onMove={(delta) => edit.edit({ op: 'moveField', widget: widget.id, index, delta })}
                    onRemove={() => edit.edit({ op: 'removeField', widget: widget.id, index })} />
                </span>
              </Row>
              <Row name="名前">
                <TextField edit={edit} errorKey={fieldKeyOf('setLabel', widget.id, partKeyOf({ field: index }))} initial={field.label} label={`引数 ${String(index + 1)} の名前`} onInput={(text) => edit.editField({ op: 'setLabel', widget: widget.id, part: { field: index }, label: text })} />
              </Row>
              <ControlSettings edit={edit} widget={widget.id} part={{ field: index }} control={field} />
            </div>
          ))}
          <AddKind label="引数を足す" kinds={FIELD_KINDS} disabled={widget.fields.length >= PAD_DOCUMENT.MAX_FIELDS} onAdd={(kind) => edit.edit({ op: 'addField', widget: widget.id, kind: kind as typeof FIELD_KINDS[number] })} />
        </Fold>
      )}
      {widget.kind === 'table' && <TableSettings edit={edit} table={widget} />}
      <div class="inspector-actions">
        <button type="button" title="この部品の設定をコピーします。別の部品を選んで「貼り付け」で置き換えます" onClick={() => edit.copy(widget.id)}>コピー</button>
        <button type="button" title="コピーした設定でこの部品を置き換えます" disabled={edit.clipboard.value === null} onClick={() => edit.paste(widget.id)}>貼り付け</button>
        <button type="button" class="negative" onClick={() => edit.remove(widget.id)}>削除</button>
      </div>
    </div>
  )
}

function Head({ edit, title }: { edit: PadEditStore; title: string }) {
  return (
    <div class="inspector-head">
      <strong>{title}</strong>
      <button type="button" class="icon" aria-label="閉じる" onClick={() => edit.select(null)}>×</button>
    </div>
  )
}

function Fold({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <details class="fold" open>
      <summary>{title}</summary>
      {children}
    </details>
  )
}

function Row({ name, children }: { name: string; children: ComponentChildren }) {
  return (
    <div class="inspector-row">
      <span class="name">{name}</span>
      <div class="value">{children}</div>
    </div>
  )
}

/**
 * 打った文字は欄に残す(defaultValue)。断られた理由はブリッジの答えを欄の下に出す。打った文字は store にも覚え、Inspector が
 * 作り直されたとき(右の列と格子の下の移動など)は作業コピーの値でなくその文字で欄を出す(D-161)
 */
function TextField(props: { edit: PadEditStore; errorKey: string; initial: string; label: string; maxLength?: number; placeholder?: string; onInput: (text: string) => void }) {
  const error = props.edit.fieldErrors.value.get(props.errorKey)
  const typed = props.edit.fieldTexts.peek().get(props.errorKey)
  return (
    <span class="field">
      <input
        type="text"
        aria-label={props.label}
        aria-invalid={error !== undefined}
        defaultValue={typed ?? props.initial}
        maxLength={props.maxLength}
        placeholder={props.placeholder}
        // 構造の命令の答えを待つ間・画像の読み込み中は打たせない(預かった入力が添字のずれた別の欄に当たらないように)
        readOnly={props.edit.formLocked.value}
        onInput={(event) => {
          props.edit.setFieldText(props.errorKey, event.currentTarget.value)
          props.onInput(event.currentTarget.value)
        }}
      />
      {error !== undefined && <span class="caption negative field-error">{error}</span>}
    </span>
  )
}

function MoveRemove({ label, first, last, onMove, onRemove }: { label: string; first: boolean; last: boolean; onMove: (delta: -1 | 1) => void; onRemove: () => void }) {
  return (
    <>
      <button type="button" class="small" aria-label={`${label} を上へ`} title="上へ" disabled={first} onClick={() => onMove(-1)}>↑</button>
      <button type="button" class="small" aria-label={`${label} を下へ`} title="下へ" disabled={last} onClick={() => onMove(1)}>↓</button>
      <button type="button" class="small negative" aria-label={`${label} を削除`} title="削除" onClick={onRemove}>✕</button>
    </>
  )
}

function AddKind({ label, kinds, disabled, onAdd }: { label: string; kinds: readonly string[]; disabled: boolean; onAdd: (kind: string) => void }) {
  const [kind, setKind] = useState(kinds[0]!)
  return (
    <div class="inspector-actions">
      <select aria-label={`${label}の種類`} value={kind} onChange={(event) => setKind(event.currentTarget.value)}>
        {kinds.map((item) => <option key={item} value={item}>{KIND_LABELS[item as PadWidgetKind] ?? item}</option>)}
      </select>
      <button type="button" disabled={disabled} onClick={() => onAdd(kind)}>{label}</button>
    </div>
  )
}

/** 位置と広がり。格子の外・重なりはブリッジが断る */
function Placement({ edit, widget }: { edit: PadEditStore; widget: PadWidget }) {
  const pad = edit.draft.value
  if (pad === null) return null
  const range = (count: number, from = 0) => Array.from({ length: count }, (_, index) => index + from)
  const rowSpan = widget.rowSpan ?? 1
  const columnSpan = widget.columnSpan ?? 1
  return (
    <>
      <Row name="位置">
        <span class="pad-field">
          <select aria-label="行" value={String(widget.row)} onChange={(event) => edit.edit({ op: 'moveWidget', widget: widget.id, row: Number(pickAndRevert(event.currentTarget, String(widget.row))), column: widget.column })}>
            {range(pad.rows).map((n) => <option key={n} value={String(n)}>{n + 1} 行</option>)}
          </select>
          <select aria-label="列" value={String(widget.column)} onChange={(event) => edit.edit({ op: 'moveWidget', widget: widget.id, row: widget.row, column: Number(pickAndRevert(event.currentTarget, String(widget.column))) })}>
            {range(pad.columns).map((n) => <option key={n} value={String(n)}>{n + 1} 列</option>)}
          </select>
        </span>
      </Row>
      <Row name="広がり">
        <span class="pad-field">
          <select aria-label="縦の広がり" value={String(rowSpan)} onChange={(event) => edit.edit({ op: 'spanWidget', widget: widget.id, rowSpan: Number(pickAndRevert(event.currentTarget, String(rowSpan))), columnSpan })}>
            {range(pad.rows, 1).map((n) => <option key={n} value={String(n)}>縦 {n}</option>)}
          </select>
          <select aria-label="横の広がり" value={String(columnSpan)} onChange={(event) => edit.edit({ op: 'spanWidget', widget: widget.id, rowSpan, columnSpan: Number(pickAndRevert(event.currentTarget, String(columnSpan))) })}>
            {range(pad.columns, 1).map((n) => <option key={n} value={String(n)}>横 {n}</option>)}
          </select>
        </span>
      </Row>
    </>
  )
}

function ImageRow({ edit, widget }: { edit: PadEditStore; widget: Extract<PadWidget, { kind: 'button' }> }) {
  return (
    <Row name="画像">
      <span class="pad-field">
        {widget.image !== undefined && (
          <>
            <img src={widget.image} alt="" class="pad-thumb" />
            <button type="button" onClick={() => void edit.setImage(widget.id, null)}>削除</button>
          </>
        )}
        <label class="pad-field">
          <span class="caption">画像を選ぶ ({PAD_DOCUMENT.MAX_IMAGE_BYTES / 1024} KiB まで)</span>
          <input
            type="file"
            aria-label="画像のファイル"
            accept="image/png,image/jpeg,image/gif,image/webp"
            onChange={(event) => {
              const picked = event.currentTarget.files?.[0] ?? null
              event.currentTarget.value = ''
              if (picked !== null) void edit.setImage(widget.id, picked)
            }}
          />
        </label>
      </span>
    </Row>
  )
}

/** 決まった値(ボタンの引数、part が action なら表のアクションの引数) */
function ArgsEditor({ edit, widget, args, part }: { edit: PadEditStore; widget: string; args: readonly PadArg[]; part?: PadDocumentEditPart }) {
  const withPart = part === undefined ? {} : { part }
  return (
    <>
      {args.map((arg, index) => {
        const name = `引数 ${String(index + 1)}`
        return (
          <Row key={index} name={name}>
            <span class="arg-row">
              <select aria-label={`${name} の型`} value={arg.type} onChange={(event) => edit.edit({ op: 'setArgType', widget, ...withPart, index, type: pickAndRevert(event.currentTarget, arg.type) as PadArg['type'] })}>
                {ARG_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
              {arg.type === 'T' || arg.type === 'F'
                ? <span class="caption">{arg.type === 'T' ? '真(T)' : '偽(F)'}</span>
                : <TextField edit={edit} errorKey={fieldKeyOf('setArgValue', widget, partKeyOf(part), index)} initial={formatArg(arg)} label={`${name} の値`} onInput={(text) => edit.editField({ op: 'setArgValue', widget, ...withPart, index, raw: text })} />}
              <MoveRemove label={name} first={index === 0} last={index === args.length - 1}
                onMove={(delta) => edit.edit({ op: 'moveArg', widget, ...withPart, index, delta })}
                onRemove={() => edit.edit({ op: 'removeArg', widget, ...withPart, index })} />
            </span>
          </Row>
        )
      })}
      <div class="inspector-actions">
        <span class="caption">{args.length} / {PAD_DOCUMENT.MAX_ARGS} 個</span>
        <button type="button" disabled={args.length >= PAD_DOCUMENT.MAX_ARGS} onClick={() => edit.edit({ op: 'addArg', widget, ...withPart, type: 'i' })}>引数を追加</button>
      </div>
    </>
  )
}

/** 値を持つ操作の型・範囲・刻み・候補(部品、part が field / column ならその引数・欄) */
function ControlSettings({ edit, widget, control, part }: { edit: PadEditStore; widget: string; control: PadControl; part?: PadDocumentEditPart }) {
  const withPart = part === undefined ? {} : { part }
  const partKey = partKeyOf(part)
  const types = VALUE_TYPES[control.kind] ?? []
  const rangeKey = fieldKeyOf('setRange', widget, partKey)
  // 範囲の命令は両側を一度に送る。打っている側の文字と、もう片側の打った文字(無ければ作業コピーの値)を組にする
  const rangeText = (side: 'min' | 'max') => edit.fieldTexts.peek().get(`${rangeKey}|${side}`) ?? numberText(control[side])
  const setRange = (side: 'min' | 'max', text: string) => {
    edit.setFieldText(`${rangeKey}|${side}`, text)
    const min = side === 'min' ? text : rangeText('min')
    const max = side === 'max' ? text : rangeText('max')
    edit.editField({ op: 'setRange', widget, ...withPart, min: min === '' ? null : min, max: max === '' ? null : max })
  }
  return (
    <>
      {types.length > 1 && (
        <Row name="型">
          <select aria-label="値の型" value={control.type} onChange={(event) => edit.edit({ op: 'setValueType', widget, ...withPart, type: pickAndRevert(event.currentTarget, control.type) as 'i' })}>
            {types.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </Row>
      )}
      {(control.kind === 'slider' || control.kind === 'number') && (
        <>
          <Row name="範囲">
            <span class="arg-row">
              <RangeField edit={edit} errorKey={rangeKey} side="min" initial={rangeText('min')} onInput={(text) => setRange('min', text)} />
              <span>〜</span>
              <RangeField edit={edit} errorKey={rangeKey} side="max" initial={rangeText('max')} onInput={(text) => setRange('max', text)} />
            </span>
          </Row>
          <Row name="刻み">
            <TextField edit={edit} errorKey={fieldKeyOf('setStep', widget, partKey)} initial={numberText(control.step)} label="刻み" placeholder="自動" onInput={(text) => edit.editField({ op: 'setStep', widget, ...withPart, step: text === '' ? null : text })} />
          </Row>
        </>
      )}
      {control.kind === 'select' && <OptionsEditor edit={edit} widget={widget} control={control} part={part} />}
    </>
  )
}

function RangeField({ edit, errorKey, side, initial, onInput }: { edit: PadEditStore; errorKey: string; side: 'min' | 'max'; initial: string; onInput: (text: string) => void }) {
  const error = side === 'max' ? edit.fieldErrors.value.get(errorKey) : undefined
  return (
    <span class="field">
      <input type="text" aria-label={side === 'min' ? '下限' : '上限'} placeholder={side === 'min' ? '下限' : '上限'} defaultValue={initial} readOnly={edit.formLocked.value} aria-invalid={error !== undefined} onInput={(event) => onInput(event.currentTarget.value)} />
      {error !== undefined && <span class="caption negative field-error">{error}</span>}
    </span>
  )
}

function OptionsEditor({ edit, widget, control, part }: { edit: PadEditStore; widget: string; control: PadControl; part?: PadDocumentEditPart }) {
  const withPart = part === undefined ? {} : { part }
  const options = control.options ?? []
  const [raw, setRaw] = useState('')
  const partKey = partKeyOf(part)
  return (
    <>
      {options.map((option, index) => {
        const key = fieldKeyOf('setOption', widget, partKey, index)
        const valueText = () => edit.fieldTexts.peek().get(`${key}|value`) ?? editText(option.value)
        const labelText = () => edit.fieldTexts.peek().get(`${key}|label`) ?? option.label ?? ''
        const send = (which: 'value' | 'label', text: string) => {
          edit.setFieldText(`${key}|${which}`, text)
          const value = which === 'value' ? text : valueText()
          const shown = which === 'label' ? text : labelText()
          edit.editField({ op: 'setOption', widget, ...withPart, index, raw: value, ...(shown === '' ? {} : { label: shown }) })
        }
        const error = edit.fieldErrors.value.get(key)
        return (
          <Row key={index} name={`候補 ${String(index + 1)}`}>
            <span class="arg-row">
              <span class="field">
                <input type="text" aria-label={`候補 ${String(index + 1)} の値`} defaultValue={valueText()} readOnly={edit.formLocked.value} aria-invalid={error !== undefined} onInput={(event) => send('value', event.currentTarget.value)} />
                {error !== undefined && <span class="caption negative field-error">{error}</span>}
              </span>
              <span class="field">
                <input type="text" aria-label={`候補 ${String(index + 1)} の表示名`} placeholder="表示名" defaultValue={labelText()} readOnly={edit.formLocked.value} onInput={(event) => send('label', event.currentTarget.value)} />
              </span>
              <MoveRemove label={`候補 ${String(index + 1)}`} first={index === 0} last={index === options.length - 1}
                onMove={(delta) => edit.edit({ op: 'moveOption', widget, ...withPart, index, delta })}
                onRemove={() => edit.edit({ op: 'removeOption', widget, ...withPart, index })} />
            </span>
          </Row>
        )
      })}
      <div class="inspector-actions">
        <input type="text" aria-label="足す候補の値" placeholder="候補の値" value={raw} onInput={(event) => setRaw(event.currentTarget.value)} />
        <button type="button" disabled={options.length >= PAD_DOCUMENT.MAX_OPTIONS} onClick={() => {
          edit.edit({ op: 'addOption', widget, ...withPart, raw })
          setRaw('')
        }}>候補を足す</button>
      </div>
    </>
  )
}

// --- 表 -------------------------------------------------------------------------------

function TableSettings({ edit, table }: { edit: PadEditStore; table: PadTableWidget }) {
  const [rowKey, setRowKey] = useState('')
  const [rowLabel, setRowLabel] = useState('')
  const rows = table.rows.source === 'ui' ? table.rows.keys : []
  return (
    <>
      <Fold title="行">
        <Row name="出どころ">
          <select aria-label="行の出どころ" value={table.rows.source} onChange={(event) => edit.edit({ op: 'setRowSource', widget: table.id, source: pickAndRevert(event.currentTarget, table.rows.source) as 'ui' | 'target' })}>
            <option value="ui">UI で管理する行</option>
            <option value="target">ターゲットが持つ行(OSCQuery)</option>
          </select>
        </Row>
        {table.rows.source === 'target' && <p class="caption">行はターゲットの名前空間で {table.address}/&lt;行の ID&gt;/… にあるノードから出ます</p>}
        {rows.map((row, index) => (
          <Row key={row.key} name={row.key}>
            <span class="arg-row">
              <TextField edit={edit} errorKey={fieldKeyOf('setRowLabel', table.id, '', undefined, row.key)} initial={row.label} label={`行 ${row.key} の名前`} onInput={(text) => edit.editField({ op: 'setRowLabel', widget: table.id, key: row.key, label: text })} />
              <MoveRemove label={`行 ${row.key}`} first={index === 0} last={index === rows.length - 1}
                onMove={(delta) => edit.edit({ op: 'moveRow', widget: table.id, key: row.key, delta })}
                onRemove={() => edit.edit({ op: 'removeRow', widget: table.id, key: row.key })} />
            </span>
          </Row>
        ))}
        {table.rows.source === 'ui' && (
          <div class="inspector-actions">
            <input type="text" aria-label="足す行の ID" placeholder="行の ID" value={rowKey} onInput={(event) => setRowKey(event.currentTarget.value)} />
            <input type="text" aria-label="足す行の名前" placeholder="名前" value={rowLabel} onInput={(event) => setRowLabel(event.currentTarget.value)} />
            <button type="button" onClick={() => {
              edit.edit({ op: 'addRow', widget: table.id, key: rowKey, label: rowLabel === '' ? rowKey : rowLabel }, () => {
                setRowKey('')
                setRowLabel('')
              })
            }}>行を足す</button>
          </div>
        )}
      </Fold>
      <Fold title={`欄 (${String(table.columns.length)})`}>
        {table.columns.map((column, index) => {
          const part = { column: column.id }
          return (
            <div class="fold child" key={column.id}>
              <Row name={`欄 ${column.id}`}>
                <span class="arg-row">
                  <select aria-label={`欄 ${column.id} の種類`} value={column.kind} onChange={(event) => edit.edit({ op: 'setKind', widget: table.id, part, kind: pickAndRevert(event.currentTarget, column.kind) as PadWidgetKind })}>
                    {FIELD_KINDS.map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}
                  </select>
                  <MoveRemove label={`欄 ${column.id}`} first={index === 0} last={index === table.columns.length - 1}
                    onMove={(delta) => edit.edit({ op: 'moveColumn', widget: table.id, column: column.id, delta })}
                    onRemove={() => edit.edit({ op: 'removeColumn', widget: table.id, column: column.id })} />
                </span>
              </Row>
              <Row name="名前">
                <TextField edit={edit} errorKey={fieldKeyOf('setLabel', table.id, partKeyOf(part))} initial={column.label} label={`欄 ${column.id} の名前`} onInput={(text) => edit.editField({ op: 'setLabel', widget: table.id, part, label: text })} />
              </Row>
              <Row name="アドレス">
                <TextField edit={edit} errorKey={fieldKeyOf('setAddress', table.id, partKeyOf(part))} initial={column.address} label={`欄 ${column.id} のアドレス`} onInput={(text) => edit.editField({ op: 'setAddress', widget: table.id, part, address: text })} />
              </Row>
              <ControlSettings edit={edit} widget={table.id} part={part} control={column} />
              <Row name="送り直す">
                <Check label="自動の再送と手動の同期で送る" checked={column.resend} disabled={edit.formLocked.value} onChange={(resend) => edit.edit({ op: 'setResend', widget: table.id, part, resend })} />
              </Row>
              {column.kind === 'toggle' && (
                <Row name="一括">
                  <Check label="全行の一括トグルを出す" checked={column.bulk === true} disabled={edit.formLocked.value} onChange={(bulk) => edit.edit({ op: 'setColumnBulk', widget: table.id, column: column.id, bulk })} />
                </Row>
              )}
            </div>
          )
        })}
        <AddKind label="欄を足す" kinds={FIELD_KINDS} disabled={table.columns.length >= PAD_DOCUMENT.MAX_TABLE_COLUMNS} onAdd={(kind) => edit.edit({ op: 'addColumn', widget: table.id, kind: kind as typeof FIELD_KINDS[number] })} />
      </Fold>
      <Fold title={`アクション (${String((table.actions ?? []).length)})`}>
        {(table.actions ?? []).map((action) => {
          const part = { action: action.id }
          return (
            <div class="fold child" key={action.id}>
              <Row name={`アクション ${action.id}`}>
                <span class="arg-row">
                  <select aria-label={`アクション ${action.id} の対象`} value={action.scope} onChange={(event) => edit.edit({ op: 'setActionScope', widget: table.id, action: action.id, scope: pickAndRevert(event.currentTarget, action.scope) as 'row' | 'all' })}>
                    <option value="row">行ごと</option>
                    <option value="all">全行</option>
                  </select>
                  <button type="button" class="small negative" aria-label={`アクション ${action.id} を削除`} onClick={() => edit.edit({ op: 'removeAction', widget: table.id, action: action.id })}>✕</button>
                </span>
              </Row>
              <Row name="名前">
                <TextField edit={edit} errorKey={fieldKeyOf('setLabel', table.id, partKeyOf(part))} initial={action.label} label={`アクション ${action.id} の名前`} onInput={(text) => edit.editField({ op: 'setLabel', widget: table.id, part, label: text })} />
              </Row>
              <Row name="アドレス">
                <TextField edit={edit} errorKey={fieldKeyOf('setAddress', table.id, partKeyOf(part))} initial={action.address} label={`アクション ${action.id} のアドレス`} onInput={(text) => edit.editField({ op: 'setAddress', widget: table.id, part, address: text })} />
              </Row>
              <ArgsEditor edit={edit} widget={table.id} part={part} args={action.args} />
            </div>
          )
        })}
        <div class="inspector-actions">
          <button type="button" disabled={(table.actions ?? []).length >= PAD_DOCUMENT.MAX_TABLE_ACTIONS} onClick={() => edit.edit({ op: 'addAction', widget: table.id, scope: 'row' })}>行のアクションを足す</button>
          <button type="button" disabled={(table.actions ?? []).length >= PAD_DOCUMENT.MAX_TABLE_ACTIONS} onClick={() => edit.edit({ op: 'addAction', widget: table.id, scope: 'all' })}>全行のアクションを足す</button>
        </div>
      </Fold>
    </>
  )
}


/** 選択欄で選んだ値を返し、DOM の値は描いた値へ一旦戻す(断られた・応答待ちで受けなかったときに選んだ値を欄に残さない) */
export function pickAndRevert(select: HTMLSelectElement, drawn: string): string {
  const picked = select.value
  select.value = drawn
  return picked
}


/** 空きマスに足す部品の種類を選ぶ(Inspector の場所に出す) */
export function AddWidgetForm({ edit, cell }: { edit: PadEditStore; cell: { row: number; column: number } }) {
  const [kind, setKind] = useState<PadWidgetKind>('button')
  return (
    <div class="inspector-row">
      <span class="name">種類</span>
      <div class="value">
        <span class="pad-field">
          <select aria-label="足す部品の種類" value={kind} onChange={(event) => setKind(event.currentTarget.value as PadWidgetKind)}>
            {(Object.keys(KIND_LABELS) as PadWidgetKind[]).map((item) => <option key={item} value={item}>{KIND_LABELS[item]}</option>)}
          </select>
          <button type="button" class="primary" onClick={() => edit.add(kind, cell.row, cell.column)}>部品を足す</button>
        </span>
        <span class="caption">下のパレットの「置く」で、OSCQuery のアドレスから作った部品をこのマスに置けます</span>
      </div>
    </div>
  )
}

