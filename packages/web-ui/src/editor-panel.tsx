// 編集モードの画面(D-144)。状態は editor-store の signal を読むだけで、編集の規則は
// ブリッジ(D-123)。配置の変更は編集モードを開いたときだけ出す(認証が無いので鍵ではなく誤操作防止の切り替え)
import { useRef } from 'preact/hooks'

import type { SurfaceDefinition } from '@oscdesk/shared'

import {
  EDITOR_ROWS_STEP,
  WIDTH_OPTIONS,
  WRAP_KINDS,
  budgeted,
  nodeText,
  parameterSummary,
  recordSummary,
  treeRows,
  unplacedParameterIds,
  widthText,
  type EditorSection,
  type ParameterFields,
  type TreeRow,
} from './editor-logic'
import { CONFLICT_MESSAGE, type EditorStore } from './editor-store'
import { Check } from './widgets'

/**
 * 入り切りは画面上部の「編集モード」スイッチ(edit-mode.ts。ページ全体で 1 つ。D-156)だけが行い、このパネルは独自の
 * 切り替えを持たない。編集モードの間だけ中身を描く(確認のダイアログは閉じる途中にも出すので常に置く)
 */
export function EditorPanel({ store }: { store: EditorStore }) {
  const editing = store.editing.value
  return (
    <>
      {editing && (
        <section class="panel editor" aria-label="定義の編集">
          <header class="panel-head">
            <h2>定義の編集</h2>
          </header>
          <EditorBody store={store} />
        </section>
      )}
      <ConfirmDialog store={store} />
      <ParameterDialogView store={store} />
    </>
  )
}

function EditorBody({ store }: { store: EditorStore }) {
  const draft = store.draft.value
  if (draft === null) return null
  return (
    <>
      {store.conflicted.value && <p class="caption negative" role="alert">{CONFLICT_MESSAGE}</p>}
      <FileRow store={store} />
      <p class="caption">
        {store.busy.value ? 'ブリッジの答えを待っています…' : store.dirty.value ? '保存していない変更があります' : '採用中の定義と同じです'}
      </p>
      <Tree store={store} definition={draft} />
      <Unplaced store={store} definition={draft} />
      <Parameters store={store} definition={draft} />
      <Records store={store} definition={draft} />
      <details class="editor-json">
        <summary>作業コピーの JSON</summary>
        <pre>{JSON.stringify(draft, null, 2)}</pre>
      </details>
    </>
  )
}

function FileRow({ store }: { store: EditorStore }) {
  const connected = store.connected.value
  const upload = useRef<HTMLInputElement>(null)
  const download = () => {
    const file = store.download()
    if (file === null) return
    const url = URL.createObjectURL(new Blob([file.text], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = file.filename
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
  return (
    <div class="editor-files">
      <div class="editor-line">
        <select aria-label="保存済み" value={store.loadName.value} onChange={(event) => store.setLoadName(event.currentTarget.value)}>
          <option value="">保存済みの定義…</option>
          {store.names.value.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <button type="button" class="flat" disabled={!connected} onClick={() => store.load()}>読み込み</button>
      </div>
      <div class="editor-line">
        <input
          type="text"
          aria-label="保存名"
          placeholder="保存名"
          value={store.saveName.value}
          onInput={(event) => store.setSaveName(event.currentTarget.value)}
        />
        <button type="button" class="primary" disabled={!connected} onClick={() => store.save()}>保存</button>
      </div>
      <div class="editor-line">
        <button type="button" class="flat" onClick={download}>ダウンロード</button>
        <button type="button" class="flat" disabled={!connected} onClick={() => upload.current?.click()}>アップロード</button>
        <input
          ref={upload}
          type="file"
          accept=".json,application/json"
          hidden
          aria-label="定義のファイル"
          onChange={async (event) => {
            const input = event.currentTarget
            const file = input.files?.[0]
            input.value = '' // 同じファイルを選び直しても届くように
            if (file !== undefined) store.upload(await file.text())
          }}
        />
        <button type="button" class="flat" onClick={() => store.requestClose()}>編集を終える</button>
      </div>
    </div>
  )
}

function More({ store, section, hidden }: { store: EditorStore; section: EditorSection; hidden: number }) {
  if (hidden <= 0) return null
  return (
    <p class="caption editor-more">
      ほかに {hidden} 件あります(画面が重くならないよう表示を省いています)
      <button type="button" class="flat" onClick={() => store.showMore(section)}>さらに {Math.min(hidden, EDITOR_ROWS_STEP)} 件を表示</button>
    </p>
  )
}

function Tree({ store, definition }: { store: EditorStore; definition: SurfaceDefinition }) {
  const { rows, hidden } = treeRows(definition, store.rowLimits.value.nodes)
  return (
    // 断られた操作で動いた選択(幅)を作業コピーの値へ戻すため、epoch が変わったら行を作り直す
    <div class="list editor-tree" key={store.epoch.value}>
      {rows.map((row) => <TreeLine key={row.key} store={store} row={row} />)}
      <More store={store} section="nodes" hidden={hidden} />
    </div>
  )
}

function TreeLine({ store, row }: { store: EditorStore; row: TreeRow }) {
  if (row.type === 'screen') return <p class="group-title">画面: {row.label}</p>
  if (row.type === 'tab') return <p class="caption" style={{ paddingLeft: `${row.depth * 16}px` }}>タブ: {row.label}</p>
  const { node, ref } = row
  const connected = store.connected.value
  const text = nodeText(node)
  return (
    <div class="editor-node" style={{ marginLeft: `${row.depth * 16}px` }} data-node={row.key}>
      <span class="editor-node-text">{text}</span>
      <div class="editor-node-actions">
        <button type="button" class="icon" title="上へ" aria-label={`${text} を上へ`} disabled={!connected} onClick={() => store.moveNode(ref, -1)}>↑</button>
        <button type="button" class="icon" title="下へ" aria-label={`${text} を下へ`} disabled={!connected} onClick={() => store.moveNode(ref, 1)}>↓</button>
        <select
          aria-label={`${text} の幅`}
          value={widthText(node.width)}
          disabled={!connected}
          onChange={(event) => store.setWidth(ref, event.currentTarget.value)}
        >
          {WIDTH_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <button type="button" class="flat" disabled={!connected} onClick={() => store.mergeWithNext(ref)}>横並び</button>
        {node.kind === 'group' && (
          <Check label="閉じて開始" checked={node.collapsed ?? false} disabled={!connected} onChange={(checked) => store.setCollapsed(ref, checked)} />
        )}
        {WRAP_KINDS.includes(node.kind)
          ? <button type="button" class="flat" disabled={!connected} onClick={() => store.unwrapNode(ref)}>解く</button>
          : <button type="button" class="flat" disabled={!connected} onClick={() => store.wrapNode(ref)}>グループ化</button>}
        <button type="button" class="icon negative" title="削除" aria-label={`${text} を削除`} disabled={!connected} onClick={() => store.removeNode(ref)}>×</button>
      </div>
    </div>
  )
}

function Unplaced({ store, definition }: { store: EditorStore; definition: SurfaceDefinition }) {
  const unplaced = unplacedParameterIds(definition)
  if (unplaced.length === 0) return null
  const { shown, hidden } = budgeted(unplaced, store.rowLimits.value.unplaced)
  const connected = store.connected.value
  return (
    <div class="editor-section">
      <p class="group-title">未配置のパラメータ</p>
      <div class="editor-line wrap">
        {shown.map((param) => <button key={param} type="button" class="flat" disabled={!connected} onClick={() => store.addControl(param)}>{param} を置く</button>)}
      </div>
      <More store={store} section="unplaced" hidden={hidden} />
    </div>
  )
}

function Parameters({ store, definition }: { store: EditorStore; definition: SurfaceDefinition }) {
  const { shown, hidden } = budgeted(definition.parameters, store.rowLimits.value.parameters)
  const hasOsc = store.hasOsc.value
  const connected = store.connected.value
  return (
    <div class="editor-section">
      <p class="group-title">パラメータ</p>
      {shown.map((parameter) => (
        <div key={parameter.id} class="editor-node" data-param={parameter.id}>
          <span class="editor-node-text break">{parameterSummary(definition, parameter, hasOsc)}</span>
          <div class="editor-node-actions">
            <button type="button" class="flat" disabled={!connected} onClick={() => store.openParameter(parameter)}>編集</button>
            <button type="button" class="icon negative" title="削除" aria-label={`${parameter.id} を削除`} disabled={!connected} onClick={() => store.removeParameter(parameter.id)}>×</button>
          </div>
        </div>
      ))}
      <More store={store} section="parameters" hidden={hidden} />
      <button type="button" class="flat" disabled={!connected} onClick={() => store.openParameter(null)}>パラメータを追加</button>
    </div>
  )
}

/** レコード(D-061)は一覧の表示だけ。編集フォームは持たず、JSON のアップロード/ダウンロードで扱う(D-064)。 */
function Records({ store, definition }: { store: EditorStore; definition: SurfaceDefinition }) {
  const records = definition.records ?? []
  if (records.length === 0) return null
  const { shown, hidden } = budgeted(records, store.rowLimits.value.records)
  const hasOsc = store.hasOsc.value
  return (
    <div class="editor-section">
      <p class="group-title">レコード(編集は JSON で行います)</p>
      {shown.map((record) => <p key={record.id} class="break">{recordSummary(definition, record, hasOsc)}</p>)}
      <More store={store} section="records" hidden={hidden} />
    </div>
  )
}

function ConfirmDialog({ store }: { store: EditorStore }) {
  const confirm = store.confirm.value
  if (confirm === null) return null
  const discard = confirm === 'discard'
  return (
    <div class="backdrop" onClick={(event) => event.target === event.currentTarget && store.cancelConfirm()}>
      <div class="dialog" role="dialog" aria-label="確認">
        <p>{discard ? '保存していない変更があります。破棄して編集モードを閉じますか?' : '別の端末などが先に定義を保存しています。上書きして保存しますか?'}</p>
        <div class="dialog-actions">
          <button type="button" class="flat" onClick={() => store.cancelConfirm()}>{discard ? '編集を続ける' : 'やめる'}</button>
          {discard
            ? <button type="button" class="primary danger" onClick={() => store.discard()}>破棄する</button>
            : <button type="button" class="primary danger" onClick={() => store.confirmOverwrite()}>上書き保存</button>}
        </div>
      </div>
    </div>
  )
}

const TEXT_FIELDS: readonly { key: keyof ParameterFields; label: string; osc?: boolean; noOsc?: boolean }[] = [
  { key: 'id', label: 'id' },
  { key: 'address', label: 'アドレス', osc: true },
  { key: 'label', label: '表示名' },
]
const RANGE_FIELDS: readonly { key: keyof ParameterFields; label: string; osc?: boolean; noOsc?: boolean }[] = [
  { key: 'min', label: '最小' },
  { key: 'max', label: '最大' },
  { key: 'step', label: '刻み' },
  { key: 'options', label: '候補(カンマ区切り)' },
  { key: 'optionsFromAddress', label: 'Unity の一覧のアドレス(s の state)', osc: true },
  { key: 'optionsFromRequest', label: '一覧の要求アドレス(省略可)', osc: true },
  { key: 'optionsFromList', label: '実行時の一覧の id(s の state)', noOsc: true },
  { key: 'default', label: '既定値(bool は true/false)' },
  { key: 'value', label: '送信値(trigger)' },
]

function ParameterDialogView({ store }: { store: EditorStore }) {
  const dialog = store.parameterDialog.value
  if (dialog === null) return null
  const hasOsc = store.hasOsc.value
  const { fields } = dialog
  const text = (item: { key: keyof ParameterFields; label: string; osc?: boolean; noOsc?: boolean }) => {
    if ((item.osc === true && !hasOsc) || (item.noOsc === true && hasOsc)) return null
    return (
      <label key={item.key} class="field">
        <span class="caption">{item.label}</span>
        <input type="text" value={String(fields[item.key])} onInput={(event) => store.setParameterField(item.key, event.currentTarget.value)} />
      </label>
    )
  }
  const choice = (key: 'kind' | 'type' | 'widget', label: string, options: readonly string[]) => (
    <label class="field">
      <span class="caption">{label}</span>
      <select value={fields[key]} onChange={(event) => store.setParameterField(key, event.currentTarget.value)}>
        {options.map((option) => <option key={option} value={option}>{option === '' ? '(自動)' : option}</option>)}
      </select>
    </label>
  )
  return (
    <div class="backdrop" onClick={(event) => event.target === event.currentTarget && store.cancelParameter()}>
      <div class="dialog wide" role="dialog" aria-label="パラメータ">
        <h3>パラメータ</h3>
        {TEXT_FIELDS.map(text)}
        {choice('kind', 'kind', ['state', 'trigger'])}
        {choice('type', '型', ['i', 'f', 's', 'bool'])}
        <Check label="単独で送る" checked={fields.standalone} disabled={false} onChange={(checked) => store.setParameterField('standalone', checked)} />
        {/* 表示ヒント(D-103)。空は「型と制約から決める」 */}
        {choice('widget', '表示ヒント(空で自動)', ['', 'slider', 'switch', 'button', 'input', 'select'])}
        {RANGE_FIELDS.map(text)}
        <div class="dialog-actions">
          <button type="button" class="flat" onClick={() => store.cancelParameter()}>キャンセル</button>
          <button type="button" class="primary" disabled={store.busy.value} onClick={() => store.commitParameter()}>OK</button>
        </div>
      </div>
    </div>
  )
}
