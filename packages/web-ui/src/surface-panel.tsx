// 主画面(サーフェスの操作画面。HID-464・D-141)。ブリッジが配る部品の木(surface.view。D-124)を描くだけで、部品の決め方の
// 規則は持たない。状態は surface-store の signal を読み、値の手触りの規則は surface-logic に置く。
//
// NiceGUI 版の layout(配置)・widgets(部品)・record_table(レコード表)に当たる。配置はここだけが決め、部品は与えられた枠に
// 収まるだけにする(部品ごとに幅を持つと、横並びのたびに部品の側を直すことになる)。
// 部品は「1 つの値の出し入れ(FieldBinding)」を受けて描くので、通常の部品・組み合わせの型のフィールド・レコードの欄で同じ部品を使う

import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'

import type { SurfaceView, ViewAction, ViewControl, ViewNode, ViewRecord } from '@oscdesk/shared'

import {
  asBool,
  asNumber,
  clamp,
  colorHex,
  formatValues,
  inputText,
  itemStyle,
  parseColorHex,
  selectView,
  sliderStep,
  toggleState,
  validateInput,
  type Scalar,
  type Values,
} from './surface-logic'
import type { SurfaceStore } from './surface-store'
import { Check } from './widgets'

export const WAITING_TEXT = '定義待ち。ブリッジからの surface フレームを待っています。'
/** ブリッジが採用中の定義を持っていない(既定の定義が無い・読み込めなかった)。待っても届かないので作り方を案内する(D-155)。 */
export const NO_SURFACE_TEXT = '採用中の定義がありません。「編集モード」で定義を作るか保存済みの定義を読み込む、または「設計図」タブで設計図から画面を作ってください。'
export const EMPTY_TEXT = '定義に画面または部品がありません。'
const EMPTY_ROWS_TEXT = '行がありません(Unity のキーの一覧待ち)'
const EMPTY_UI_ROWS_TEXT = '行がありません(下の欄から追加してください)'
const PARTIAL_TEXT = '一部オン'
const INVALID_INPUT_TEXT = '形式不正のため送信しませんでした'

export function SurfacePanel({ store }: { store: SurfaceStore }) {
  const info = store.info.value
  const content = store.content.value
  const connected = store.connected.value
  const names = store.surfaceNames.value
  return (
    <section class="panel surface" aria-label="操作画面">
      <header class="panel-head">
        <h2>{info === null ? '操作画面' : info.label}</h2>
        <span class="caption">
          {info === null ? (store.noSurface.value ? '定義: なし' : '定義: 待機中') : `定義: ${info.name}(${String(info.parameterCount)} 件, rev ${String(info.revision)})`}
          {names.length > 0 ? ` / 保存済み: ${names.join(', ')}` : ''}
        </span>
        <button type="button" class="flat" disabled={!connected} onClick={() => store.requestSurface()}>再取得</button>
      </header>
      {store.hasRuntimeLists.value && (
        <div class="panel-head">
          <button type="button" class="flat" disabled={!connected} onClick={() => store.requestLists()}>一覧を更新</button>
          <span class="caption">Unity が持つ選択肢を取り直します</span>
        </div>
      )}
      {content === null
        ? <p class="muted" data-mark={store.noSurface.value ? 'no-surface' : 'waiting'}>{store.noSurface.value ? NO_SURFACE_TEXT : WAITING_TEXT}</p>
        // 定義が変わったら作り直す(key)。同じ内容の再配信では作り直さないので、操作中の部品は壊れない
        : <Screens key={content.version} view={content.view} store={store} />}
    </section>
  )
}

function Screens({ view, store }: { view: SurfaceView; store: SurfaceStore }) {
  const [active, setActive] = useState(0)
  const screens = view.screens
  if (screens.length === 0 || screens.every((screen) => screen.children.length === 0)) return <p class="muted">{EMPTY_TEXT}</p>
  if (screens.length === 1) return <Nodes nodes={screens[0]!.children} view={view} store={store} inRow={false} />
  return (
    <Tabs labels={screens.map((screen) => screen.label)} active={active} onSelect={setActive}>
      {screens.map((screen, index) => (
        <div key={screen.id} role="tabpanel" hidden={index !== active} class="s-col">
          <Nodes nodes={screen.children} view={view} store={store} inRow={false} />
        </div>
      ))}
    </Tabs>
  )
}

/** タブ。見えないタブの中身も消さずに隠す(打ちかけの入力欄や操作中の部品を、タブの切り替えで壊さない)。 */
function Tabs(props: { labels: string[]; active: number; onSelect: (index: number) => void; children: ComponentChildren }) {
  return (
    <div class="s-tabs">
      <div role="tablist" class="s-tablist">
        {props.labels.map((label, index) => (
          <button
            key={index}
            type="button"
            role="tab"
            aria-selected={index === props.active}
            class={index === props.active ? 's-tab active' : 's-tab'}
            onClick={() => props.onSelect(index)}
          >
            {label}
          </button>
        ))}
      </div>
      {props.children}
    </div>
  )
}

function Nodes({ nodes, view, store, inRow }: { nodes: ViewNode[]; view: SurfaceView; store: SurfaceStore; inRow: boolean }) {
  return (
    <>
      {nodes.map((node, index) => (inRow
        // 行の中では子ごとに幅の指定の枠で包む。それ以外は縦に積むだけ
        ? <div key={index} style={itemStyle(node.width)}><Node node={node} view={view} store={store} /></div>
        : <Node key={index} node={node} view={view} store={store} />))}
    </>
  )
}

function Node({ node, view, store }: { node: ViewNode; view: SurfaceView; store: SurfaceStore }) {
  switch (node.kind) {
    case 'control':
      return <Control spec={view.controls[node.control]!} store={store} />
    case 'action': {
      const action = view.actions.find((item) => item.action === node.action)
      return action === undefined ? null : <ActionButton action={action} label={node.label ?? action.label} store={store} />
    }
    case 'record': {
      const record = view.records.find((item) => item.record === node.record)
      return record === undefined ? null : <RecordTable node={node} record={record} view={view} store={store} />
    }
    case 'row':
      return <div class="s-row"><Nodes nodes={node.children} view={view} store={store} inRow /></div>
    case 'column':
      return <div class="s-col"><Nodes nodes={node.children} view={view} store={store} inRow={false} /></div>
    case 'group':
      return (
        <details class="s-group" open={!node.collapsed}>
          <summary>{node.label}</summary>
          <div class="s-col"><Nodes nodes={node.children} view={view} store={store} inRow={false} /></div>
        </details>
      )
    case 'tabs':
      return <InnerTabs node={node} view={view} store={store} />
  }
}

function InnerTabs({ node, view, store }: { node: Extract<ViewNode, { kind: 'tabs' }>; view: SurfaceView; store: SurfaceStore }) {
  const [active, setActive] = useState(0)
  return (
    <Tabs labels={node.tabs.map((tab) => tab.label)} active={active} onSelect={setActive}>
      {node.tabs.map((tab, index) => (
        <div key={index} role="tabpanel" hidden={index !== active} class="s-col">
          <Nodes nodes={tab.children} view={view} store={store} inRow={false} />
        </div>
      ))}
    </Tabs>
  )
}

// --- 値の出し入れ -------------------------------------------------------------------------

/** 1 つの値の部品が使う出し入れ。false を返した操作は断られた(ほかのブラウザが操作中)ので、部品は表示を戻す。 */
interface FieldBinding {
  value: Scalar | null
  disabled: boolean
  holdBegin(widget: string): boolean
  holdEnd(): void
  setEditing(editing: boolean): void
  setLocal(value: Scalar): boolean
  setDiscrete(value: Scalar): boolean
  setDraft?(raw: string): void
  draft?: string | null
  /** 通知の列へ出す(入力欄の形式不正) */
  warn(text: string): void
}

/**
 * ポインタの主の押下か(マウスの左ボタン・タッチ・ペンの先の接触。どれも button が 0)。主画面で pointerdown を使う部品は、
 * これが真のときだけ送信もホールドも始める。右・中クリック(コンテキストメニューを開こうとしただけ)やペンのボタンで
 * OSC の命令(生成を含む)を送らないため(PR #158)。click は主ボタンでしか起きないので、click で送る部品はこの規則の外
 */
export function isPrimaryPress(event: { button: number }): boolean {
  return event.button === 0
}

function useConnected(store: SurfaceStore): boolean {
  return store.connected.value
}

/** 通常の部品(パラメータ)の出し入れ。 */
function paramBinding(store: SurfaceStore, spec: ViewControl, values: Values | null, disabled: boolean): FieldBinding {
  const channel = store.channelOf(spec.param)
  return {
    value: values?.[0] ?? null,
    disabled,
    holdBegin: () => store.beginHold(spec),
    holdEnd: () => store.endHold(spec),
    setEditing: (editing) => store.setEditing(spec, editing),
    setLocal: (value) => store.setLocal(spec, [value]),
    setDiscrete: (value) => store.setDiscrete(spec, [value]),
    setDraft: (raw) => store.setDraft(spec, raw),
    draft: channel.holding ? channel.draft : null,
    warn: (text) => store.warn(text, 'error'),
  }
}

function LockBadge({ label }: { label: string | null }) {
  return label === null ? null : <span class="caption warn">操作中: {label}</span>
}

function Control({ spec, store }: { spec: ViewControl; store: SurfaceStore }) {
  const values = store.channelOf(spec.param).shown.value
  const locked = store.paramLockLabel(spec.param)
  const absent = store.absent.value.has(spec.param)
  const connected = useConnected(store)
  const disabled = locked !== null || !connected
  let body: ComponentChildren
  if (spec.type === 'composite') {
    body = spec.kind === 'trigger'
      ? <TriggerButton spec={spec} store={store} disabled={disabled} />
      : spec.widget === 'color'
        ? <ColorControl spec={spec} store={store} values={values} disabled={disabled} />
        : <CompositeControl spec={spec} store={store} values={values} disabled={disabled} />
  } else if (spec.widget === 'button' || spec.kind === 'trigger') {
    body = <TriggerButton spec={spec} store={store} disabled={disabled} />
  } else {
    const binding = paramBinding(store, spec, values, disabled)
    const options = spec.widget === 'select' ? store.optionsFor(spec) : undefined
    body = (
      <FieldWidget
        spec={spec}
        binding={binding}
        label={spec.label}
        options={options}
        sync={spec.widget === 'select' && spec.optionsSync !== undefined ? () => store.requestLists(spec.optionsSync) : undefined}
        syncDisabled={!connected}
      />
    )
  }
  return (
    <div class={absent ? 's-card absent' : 's-card'} data-param={spec.param}>
      {body}
      <LockBadge label={locked} />
      {absent && <span class="caption">この PC には無い</span>}
    </div>
  )
}

/** 基本型の値の部品(スライダー・スイッチ・入力欄・選択)。 */
function FieldWidget(props: {
  spec: ViewControl
  binding: FieldBinding
  label: string
  options?: { options: readonly string[]; arrived: boolean }
  sync?: () => void
  syncDisabled?: boolean
}) {
  const { spec, binding, label } = props
  switch (spec.widget) {
    case 'switch':
      return (
        <Check
          label={label}
          checked={asBool(binding.value) === true}
          disabled={binding.disabled}
          onChange={(checked) => {
            binding.setDiscrete(checked)
          }}
        />
      )
    case 'input':
      return <InputField spec={spec} binding={binding} label={label} />
    case 'select':
      return <SelectField spec={spec} binding={binding} label={label} options={props.options ?? { options: spec.options ?? [], arrived: false }} sync={props.sync} syncDisabled={props.syncDisabled ?? false} />
    default:
      return <SliderField spec={spec} binding={binding} label={label} />
  }
}

function SliderField({ spec, binding, label }: { spec: ViewControl; binding: FieldBinding; label: string }) {
  const [low, high] = spec.range ?? [0, 1]
  const number = asNumber(binding.value)
  // 値が無ければつまみは下限に置き、数値の表示は「-」にする
  const position = clamp(spec, number ?? low)
  const end = () => binding.holdEnd()
  return (
    <label class="s-field">
      {label !== '' && (
        <span class="s-field-head">
          <span class="caption">{label}</span>
          <span class="caption">{binding.value === null ? '-' : formatValues([binding.value])}</span>
        </span>
      )}
      <input
        type="range"
        min={low}
        max={high}
        step={sliderStep(spec)}
        value={position}
        disabled={binding.disabled}
        aria-label={label === '' ? undefined : label}
        onPointerDown={(event) => {
          if (!isPrimaryPress(event)) return
          // つまみを掴んでいる間に指が部品の外へ出ても、離すまでを 1 つの操作として受ける
          event.currentTarget.setPointerCapture?.(event.pointerId)
          binding.holdBegin('slider')
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
        onInput={(event) => {
          const raw = Number(event.currentTarget.value)
          const next = spec.type === 'i' ? Math.round(raw) : raw
          // 断られたら(ほかのブラウザが操作中)つまみを表示中の値へ戻す。値は送っていないので描き直しでは戻らない
          if (!binding.setLocal(next)) event.currentTarget.value = String(position)
        }}
      />
    </label>
  )
}

function InputField({ spec, binding, label }: { spec: ViewControl; binding: FieldBinding; label: string }) {
  const shownText = inputText(spec, binding.value)
  // 作り直した部品でも、操作中なら打ちかけの文字(下書き)から始める
  const [text, setText] = useState(binding.draft ?? shownText)
  const [error, setError] = useState<string | null>(null)
  const editing = useRef(false)
  // 表示中の値から利用者が書き換えたか。書き換えずに離れたら同じ値を送り直さない
  const edited = useRef(false)
  // Enter で確定した後に続けて届く blur で、同じ確定を二度送らない
  const confirmedByEnter = useRef(false)

  // フォーカスの外では表示中の値(エコー・保持値)に合わせる。フォーカスの中では打ちかけの文字を書き換えない
  useEffect(() => {
    if (editing.current) return
    setText(shownText)
    setError(null)
    edited.current = false
  }, [shownText])

  const begin = () => {
    if (!binding.holdBegin('input')) return false
    editing.current = true
    binding.setEditing(true)
    return true
  }
  const end = () => {
    editing.current = false
    binding.holdEnd()
  }

  const confirm = (fromBlur: boolean): boolean => {
    const result = validateInput(spec, text)
    if (!result.ok) {
      // Enter では欄に理由を出して直させる。フォーカスを外したときは、断った値は送っていないので、エコーを待たずに
      // 表示中の値へ戻し、理由は通知で知らせる(戻した値に理由が付いたままにしない)
      setError(fromBlur ? null : result.error)
      if (fromBlur) {
        end()
        setText(shownText)
        edited.current = false
        binding.setDraft?.('')
        binding.warn(INVALID_INPUT_TEXT)
      }
      return false
    }
    setError(null)
    edited.current = false
    if (!binding.setDiscrete(result.value)) setText(shownText)
    end()
    return true
  }

  return (
    <label class="s-field">
      {label !== '' && <span class="caption">{label}</span>}
      <input
        type={spec.type === 's' ? 'text' : 'number'}
        step={spec.type === 's' ? undefined : 'any'}
        value={text}
        disabled={binding.disabled}
        aria-label={label === '' ? undefined : label}
        aria-invalid={error !== null}
        onFocus={() => {
          confirmedByEnter.current = false
          // フォーカスした時点から操作中とみなす(最初の 1 文字を打つ前に届いたエコーで、これから打つ欄を書き換えない)
          begin()
        }}
        onInput={(event) => {
          const raw = event.currentTarget.value
          if (!editing.current && !begin()) {
            event.currentTarget.value = text
            return
          }
          confirmedByEnter.current = false
          edited.current = true
          setText(raw)
          binding.setDraft?.(raw)
        }}
        onKeyDown={(event) => {
          // IME の変換を確定する Enter では決定しない(Safari は keyCode 229 で見分ける)
          if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return
          confirmedByEnter.current = confirm(false)
        }}
        onBlur={() => {
          if (confirmedByEnter.current) {
            confirmedByEnter.current = false
            return
          }
          if (!edited.current) {
            // 欄を通り抜けただけ(Tab 移動・クリックして離れた)。同じ値を送り直さず、始めたホールドだけ終える
            setError(null)
            end()
            return
          }
          confirm(true)
        }}
      />
      {error !== null && <span class="caption negative">{error}</span>}
    </label>
  )
}

function SelectField(props: {
  spec: ViewControl
  binding: FieldBinding
  label: string
  options: { options: readonly string[]; arrived: boolean }
  sync?: () => void
  syncDisabled: boolean
}) {
  const { spec, binding, label } = props
  const fromRuntime = spec.optionsFrom !== undefined
  const options = props.options.options
  const value = typeof binding.value === 'string' ? binding.value : null
  const shown = selectView(value, options, fromRuntime && props.options.arrived)
  const selectRef = useRef<HTMLSelectElement>(null)
  const current = shown.selected ?? (shown.display !== null ? '\u0000outside' : '\u0000none')
  // 候補の差し替えと値の配り直しで、DOM の選択を表示中の値に揃える(断られた選択を残さない)
  useEffect(() => {
    if (selectRef.current !== null) selectRef.current.value = current
  })
  const empty = options.length === 0
  return (
    <label class="s-field">
      {label !== '' && <span class="caption">{label}</span>}
      <span class="s-inline">
        <select
          ref={selectRef}
          value={current}
          disabled={binding.disabled || (empty && !fromRuntime)}
          aria-label={label === '' ? undefined : label}
          onPointerDown={(event) => {
            if (isPrimaryPress(event)) binding.holdBegin('select')
          }}
          onBlur={() => binding.holdEnd()}
          onChange={(event) => {
            const next = event.currentTarget.value
            if (next.startsWith('\u0000')) return
            if (!binding.setDiscrete(next)) event.currentTarget.value = current
            binding.holdEnd()
          }}
        >
          {shown.selected === null && shown.display === null && <option value={'\u0000none'} disabled>{'—'}</option>}
          {shown.display !== null && <option value={'\u0000outside'} disabled>{shown.display}</option>}
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
        {props.sync !== undefined && (
          <button type="button" class="flat small" title="この一覧だけを Unity から取り直します" disabled={props.syncDisabled} onClick={props.sync}>Sync</button>
        )}
      </span>
      {empty && <span class="caption">{fromRuntime ? 'Unity の一覧待ち' : '選択肢なし'}</span>}
    </label>
  )
}

function TriggerButton({ spec, store, disabled }: { spec: ViewControl; store: SurfaceStore; disabled: boolean }) {
  return (
    <button
      type="button"
      class="s-trigger"
      // 単独で送らない定義はまとめ送り(HID-166)の部品としてだけ使える
      disabled={disabled || !spec.standalone}
      onPointerDown={(event) => {
        if (isPrimaryPress(event)) store.pressTrigger(spec)
      }}
      // キーボードの決定(detail が 0)でも押せるようにする。ポインタの押下は pointerdown で送り済み
      onClick={(event) => {
        if (event.detail === 0) store.pressTrigger(spec)
      }}
    >
      {spec.label}
    </button>
  )
}

/** 知らない表示ヒントの組み合わせの型(D-121)。フィールドごとに基本の部品を並べ、どれを動かしても全フィールドを 1 つの値で送る。 */
function CompositeControl({ spec, store, values, disabled }: { spec: ViewControl; store: SurfaceStore; values: Values | null; disabled: boolean }) {
  const fields = spec.fields ?? []
  // フィールドの入力欄のどれかがフォーカス中なら、組み合わせの部品の操作を終えない
  const editingFields = useRef(new Set<number>())
  const merged = (index: number, value: Scalar): Values => {
    const base = values ?? fields.map((field) => field.default ?? (field.type === 's' ? '' : field.type === 'bool' ? false : 0))
    return base.map((item, position) => (position === index ? value : item))
  }
  return (
    <div class="s-col">
      <span class="caption">{spec.label}</span>
      {spec.hint !== undefined && <span class="caption">{spec.hint}</span>}
      {fields.map((field, index) => {
        const binding: FieldBinding = {
          value: values?.[index] ?? null,
          disabled,
          holdBegin: () => store.beginHold(spec),
          holdEnd: () => {
            editingFields.current.delete(index)
            if (editingFields.current.size === 0) store.endHold(spec)
          },
          setEditing: (editing) => {
            if (editing) editingFields.current.add(index)
            store.setEditing(spec, editingFields.current.size > 0)
          },
          setLocal: (value) => store.setLocal(spec, merged(index, value)),
          setDiscrete: (value) => store.setDiscrete(spec, merged(index, value)),
          warn: (text) => store.warn(text, 'error'),
        }
        return <FieldWidget key={field.param} spec={field} binding={binding} label={field.label} />
      })}
    </div>
  )
}

/** 表示ヒント color(範囲 0〜1 の f が RGB の 3 つか RGBA の 4 つ)。色の選択と、4 つ目があれば不透明度のスライダー。 */
function ColorControl({ spec, store, values, disabled }: { spec: ViewControl; store: SurfaceStore; values: Values | null; disabled: boolean }) {
  const fields = spec.fields ?? []
  const latest = (values ?? fields.map((field) => field.default ?? 1)).map((value) => Number(value))
  const hasAlpha = fields.length === 4
  const alphaBinding: FieldBinding = {
    value: hasAlpha ? latest[3]! : null,
    disabled,
    holdBegin: () => store.beginHold(spec),
    holdEnd: () => store.endHold(spec),
    setEditing: () => undefined,
    setLocal: (value) => store.setLocal(spec, latest.map((item, index) => (index === 3 ? Number(value) : item))),
    setDiscrete: (value) => store.setDiscrete(spec, latest.map((item, index) => (index === 3 ? Number(value) : item))),
    warn: (text) => store.warn(text, 'error'),
  }
  const hex = colorHex(latest)
  return (
    <div class="s-col">
      <label class="s-field">
        <span class="caption">{spec.label}</span>
        <input
          type="color"
          value={hex}
          disabled={disabled}
          aria-label={spec.label}
          onChange={(event) => {
            const rgb = parseColorHex(event.currentTarget.value)
            if (rgb === null) return
            if (!store.setDiscrete(spec, [...rgb, ...latest.slice(3)])) event.currentTarget.value = hex
          }}
        />
      </label>
      {hasAlpha && <SliderField spec={{ ...fields[3]!, range: [0, 1], step: 0.001 }} binding={alphaBinding} label={fields[3]!.label} />}
    </div>
  )
}

function ActionButton({ action, label, store, rowKey }: { action: ViewAction; label: string; store: SurfaceStore; rowKey?: string }) {
  const connected = useConnected(store)
  // 上限超(truncated)は対象が空でも押せるままにする(押すと送らずに理由を知らせる。D-128)
  const empty = !('scope' in action) && action.targets.length === 0 && action.truncated !== true
  return (
    // pointerdown でなく click: 誤ってなぞっただけで多数のメッセージが飛ぶのを避ける
    <button type="button" class="s-action" disabled={!connected || empty} onClick={() => store.pressAction(action, rowKey)}>
      {label}
    </button>
  )
}

// --- レコード表(D-064) ---------------------------------------------------------------------

// 列の幅(D-076)。キーの列は名前と行の削除を 1 段で収めたいので広めに取る。スイッチの列は部品の幅が決まっているので詰める
const KEY_COLUMN_MIN_PX = 160
const FIELD_COLUMN_MIN_PX = 80
const SWITCH_COLUMN_PX = 64
const ACTIONS_COLUMN_MIN_PX = 64

function RecordTable({ node, record, view, store }: {
  node: Extract<ViewNode, { kind: 'record' }>
  record: ViewRecord
  view: SurfaceView
  store: SurfaceStore
}) {
  const rows = store.rowsOf(record)
  const connected = useConnected(store)
  const actionOf = (id: string) => view.actions.find((action) => action.action === id)
  const columns = node.columns.map((column) => ({ ...column, spec: view.controls[column.control]! }))
  const hasActions = record.kind === 'trigger' || node.rowActions.length > 0
  const template = [
    `minmax(${String(KEY_COLUMN_MIN_PX)}px,2fr)`,
    ...columns.map((column) => (column.spec.widget === 'switch' ? `${String(SWITCH_COLUMN_PX)}px` : `minmax(${String(FIELD_COLUMN_MIN_PX)}px,2fr)`)),
    ...(hasActions ? ['auto'] : []),
  ].join(' ')
  const minWidth = KEY_COLUMN_MIN_PX + columns.reduce((sum, column) => sum + (column.spec.widget === 'switch' ? SWITCH_COLUMN_PX : FIELD_COLUMN_MIN_PX), 0)
    + (hasActions ? ACTIONS_COLUMN_MIN_PX : 0)
  // 狭い画面では表の中だけを横スクロールさせ、ページには横スクロールを出さない
  const gridStyle = `grid-template-columns:${template};min-width:${String(minWidth)}px`
  const tableActions = node.tableActions.map(actionOf).filter((action): action is ViewAction => action !== undefined)
  const bulk = columns.some((column) => column.actions.length > 0 || column.toggle !== undefined)
  // 一括トグルの見せ方は行の値から決める(トグルのある表だけが行の値の変化で描き直される)
  const rowValuesList = columns.some((column) => column.toggle !== undefined) ? rows.map((row) => store.rowChannelOf(record.record, row.key).shown.value) : []

  return (
    <div class="s-card s-record" data-record={record.record}>
      <h3>{node.label ?? record.label}</h3>
      <div class="s-record-body">
        <div class="s-record-scroll">
          <div class="s-grid s-grid-head caption" style={gridStyle}>
            <Header label={record.keyLabel} sync={record.keysSync === undefined ? undefined : () => store.requestLists(record.keysSync)} disabled={!connected} />
            {columns.map((column) => (
              <Header
                key={column.field}
                label={column.spec.label}
                sync={column.spec.widget === 'select' && column.spec.optionsSync !== undefined ? () => store.requestLists(column.spec.optionsSync) : undefined}
                disabled={!connected}
              />
            ))}
            {hasActions && <span />}
          </div>
          {bulk && (
            <div class="s-grid s-grid-row" style={gridStyle}>
              <span />
              {columns.map((column) => (
                <div key={column.field} class="s-col tight">
                  {column.toggle !== undefined && (
                    <ColumnToggle
                      label={column.toggle.label}
                      state={toggleState(rowValuesList, column.field)}
                      disabled={!connected}
                      onChange={(on) => {
                        const target = actionOf(on ? column.toggle!.on : column.toggle!.off)
                        if (target !== undefined) store.pressAction(target)
                      }}
                    />
                  )}
                  {column.actions.length > 0 && (
                    <span class="s-inline">
                      {column.actions.map(actionOf).filter((action): action is ViewAction => action !== undefined).map((action) => (
                        <ActionButton key={action.action} action={action} label={action.label} store={store} />
                      ))}
                    </span>
                  )}
                </div>
              ))}
              {hasActions && <span />}
            </div>
          )}
          {rows.map((row) => (
            <RecordRowView
              key={row.key}
              store={store}
              record={record}
              node={node}
              rowKey={row.key}
              name={row.name}
              marked={row.marked}
              columns={columns}
              rowActions={node.rowActions.map(actionOf).filter((action): action is ViewAction => action !== undefined)}
              hasActions={hasActions}
              gridStyle={gridStyle}
            />
          ))}
          {rows.length === 0 && <p class="caption">{record.keysSource === 'ui' ? EMPTY_UI_ROWS_TEXT : EMPTY_ROWS_TEXT}</p>}
          {node.editRows && <AddRow store={store} record={record} />}
        </div>
        {tableActions.length > 0 && (
          // 表全体のアクション(D-074)は表の右に縦長のボタンで並べる。どの表の全行が対象なのかを位置で示す
          <div class="s-table-actions">
            {tableActions.map((action) => (
              <button key={action.action} type="button" class="s-action tall" disabled={!connected} onClick={() => store.pressAction(action)}>
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Header({ label, sync, disabled }: { label: string; sync?: () => void; disabled: boolean }) {
  return (
    <span class="s-inline">
      <span>{label}</span>
      {/* 一覧の要求を持つ列は、見出しの横にその一覧だけを取り直す Sync を置く(D-077) */}
      {sync !== undefined && <button type="button" class="flat small" title="この一覧だけを Unity から取り直します" disabled={disabled} onClick={sync}>Sync</button>}
    </span>
  )
}

/** 一括トグル(D-073)。全行がオンならオン、それ以外はオフで、混在のときは注記を出す(D-094)。オンで on、オフで off を送る。 */
function ColumnToggle({ label, state, disabled, onChange }: { label: string; state: { on: boolean; mixed: boolean }; disabled: boolean; onChange: (on: boolean) => void }) {
  return (
    <span class="s-col tight">
      <Check label={label} checked={state.on} disabled={disabled} onChange={onChange} />
      {state.mixed && <span class="caption">{PARTIAL_TEXT}</span>}
    </span>
  )
}

function RecordRowView(props: {
  store: SurfaceStore
  record: ViewRecord
  node: Extract<ViewNode, { kind: 'record' }>
  rowKey: string
  name: string
  marked: boolean
  columns: { field: number; spec: ViewControl }[]
  rowActions: ViewAction[]
  hasActions: boolean
  gridStyle: string
}) {
  const { store, record, node, rowKey: key, name } = props
  const values = store.rowChannelOf(record.record, key).shown.value
  const locked = store.rowLockLabel(record.record, key)
  const connected = useConnected(store)
  const disabled = locked !== null || !connected
  const nameEditable = node.editRows && record.keysSource === 'ui'
  return (
    <div class="s-grid s-grid-row" style={props.gridStyle} data-row={key}>
      <div class="s-row-key">
        {node.editRows && <RemoveRow store={store} record={record} rowKey={key} name={name} disabled={!connected} />}
        <div class="s-col tight">
          {nameEditable
            ? <RowName store={store} record={record} rowKey={key} name={name} label={record.keyLabel} disabled={!connected} />
            : <span class="s-row-name">{name}</span>}
          {props.marked && <span class="caption warn">(一覧に無い)</span>}
          <LockBadge label={locked} />
        </div>
      </div>
      {props.columns.map((column) => {
        if (record.kind === 'trigger') {
          // trigger のフィールドは固定の値(定義の value)。表示だけで編集しない
          const field = record.fields[column.field]!
          return <span key={column.field}>{formatValues([field.value ?? ''])}</span>
        }
        const binding: FieldBinding = {
          value: values?.[column.field] ?? null,
          disabled,
          holdBegin: (widget) => store.beginRowHold(record, key, widget),
          holdEnd: () => store.endRowHold(record, key),
          setEditing: (editing) => store.setRowEditing(record, key, editing),
          setLocal: (value) => store.setRowField(record, key, column.field, value, false),
          setDiscrete: (value) => store.setRowField(record, key, column.field, value, true),
          warn: (text) => store.warn(text, 'error'),
        }
        return (
          <div key={column.field} class="s-cell">
            {/* 列の見出しが表示名を持つので、欄ごとの表示名は出さない */}
            <FieldWidget spec={column.spec} binding={binding} label="" options={column.spec.widget === 'select' ? store.fieldOptionsFor(record.record, column.spec) : undefined} />
          </div>
        )
      })}
      {props.hasActions && (
        <span class="s-inline">
          {record.kind === 'trigger' && (
            <button type="button" class="s-action" disabled={disabled} onClick={() => store.pressRowTrigger(record, key)}>送信</button>
          )}
          {props.rowActions.map((action) => (
            <button key={action.action} type="button" class="s-action" disabled={disabled} onClick={() => store.pressAction(action, key)}>{action.label}</button>
          ))}
        </span>
      )}
    </div>
  )
}

/** 行の削除(D-075)。× を押すと確かめる項目を出し、その項目で消す(ブラウザのダイアログは使わない)。 */
function RemoveRow({ store, record, rowKey: key, name, disabled }: { store: SurfaceStore; record: ViewRecord; rowKey: string; name: string; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <span class="s-remove">
      <button type="button" class="icon small" aria-label="この行を削除" aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)}>×</button>
      {open && (
        <span class="s-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            class="flat negative"
            onClick={() => {
              setOpen(false)
              const error = store.removeRow(record, key)
              if (error !== null) store.warn(error)
            }}
          >
            「{name}」を削除
          </button>
          {/* Unity の一覧から行ができる表では、消せるのは保持値だけ。一覧にある間は行が残り既定値に戻る */}
          {record.keysSource !== 'ui' && <span class="caption">Unity の一覧にある名前は、行が残り既定値に戻ります</span>}
        </span>
      )}
    </span>
  )
}

/**
 * UI で管理する行の Name(D-087)。確定(Enter・フォーカスを外す)で送り、欄は一旦いまの Name に戻す。表示はブリッジの
 * runtimeOptions で新しい Name に揃う(戻さないと、ブリッジが断ったときに通らなかった Name が欄に残る)
 */
function RowName({ store, record, rowKey: key, name, label, disabled }: { store: SurfaceStore; record: ViewRecord; rowKey: string; name: string; label: string; disabled: boolean }) {
  const [text, setText] = useState(name)
  useEffect(() => setText(name), [name])
  const commit = () => {
    if (text.trim() !== name) {
      const error = store.renameRow(record, key, text)
      if (error !== null) store.warn(error)
    }
    setText(name)
  }
  return (
    <input
      class="s-row-name"
      type="text"
      value={text}
      aria-label={label}
      disabled={disabled}
      onInput={(event) => setText(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) event.currentTarget.blur()
      }}
      onBlur={commit}
    />
  )
}

/** 表の下の行の追加(D-075)。上限に達した表では閉じる。 */
function AddRow({ store, record }: { store: SurfaceStore; record: ViewRecord }) {
  const [text, setText] = useState('')
  const full = store.rowLimitReached(record)
  const connected = useConnected(store)
  const add = () => {
    if (full) return
    const error = store.addRow(record, text)
    if (error !== null) {
      store.warn(error)
      return
    }
    // 行はブリッジから desired で届いた時点で表に出る。欄は次の名前のために空ける
    setText('')
  }
  return (
    <div class="s-add">
      <input
        type="text"
        placeholder={`追加する${record.keyLabel}`}
        value={text}
        disabled={full || !connected}
        onInput={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) add()
        }}
      />
      <button type="button" class="primary" disabled={full || !connected} onClick={add}>追加</button>
    </div>
  )
}
