// OSC パッドのタブの画面(D-080・D-081・D-084・D-147。NiceGUI 版の osc_pad_panel.py から)。状態は osc-pad-store の signal を
// 読むだけで、規則はブリッジ(D-126)。格子に並べたボタンを押すと、登録したアドレスと引数の OSC を 1 つ送る。
// 「パッドを編集」で編集モードに入り、ボタンを押すとその設定を格子の下の Inspector で編集する(NiceGUI 版は送信先パネルの場所に
// 出していた。SPA は 1 列の画面なので格子の下に置く。D-147)
import type { ComponentChildren } from 'preact'
import { useRef } from 'preact/hooks'

import { OSC_PAD, type OscPadArg, type OscPadButton } from '@oscdesk/shared'

import {
  ARG_TYPES,
  COLUMN_CHOICES,
  DEFAULT_BUTTON_COLOR,
  ROW_CHOICES,
  appearanceCaption,
  buttonAt,
  buttonsOutside,
  cellStyle,
  fieldKeyOf,
  findButton,
  formatArgValue,
} from './osc-pad-logic'
import type { OscPadStore, Section } from './osc-pad-store'

/**
 * 選択欄で選んだ値を返し、DOM の値は描いた値へ一旦戻す(widgets の Check と同じ)。見た目は store の状態(作業コピー・表示の大きさ)で
 * 描き直すので、断られた・応答待ちで受けなかったときに、選んだ値が欄に残らない。欄を作り直さないので、ほかの欄の入力も消えない
 */
function pickAndRevert(select: HTMLSelectElement, drawn: string): string {
  const picked = select.value
  select.value = drawn
  return picked
}

export function OscPadPanel({ store }: { store: OscPadStore }) {
  if (!store.oscAvailable.value) return null
  const editing = store.session.value !== null
  return (
    <section class="panel pad" aria-label="OSC パッド">
      <PadHeader store={store} />
      <SizeRow store={store} />
      {editing && <Toolbar store={store} />}
      {store.conflicted.value && <p class="caption negative">別の端末などがパッドを保存・切り替えました。保存すると上書きします</p>}
      {editing && <Hint store={store} />}
      <Grid store={store} />
      {editing && <Inspector store={store} />}
      <ConfirmDialog store={store} />
    </section>
  )
}

function PadHeader({ store }: { store: OscPadStore }) {
  const session = store.session.value
  const adopted = store.adopted.value
  const title = session !== null ? `編集中: ${session.baseName ?? '(新規)'}` : adopted !== null ? `パッド: ${adopted.name}` : 'パッド: 未選択'
  return (
    <header class="panel-head">
      <h2>OSC パッド</h2>
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
            store.setEditing(next)
          }}
        />
        <span class="select-none">パッドを編集</span>
      </span>
      <span class="caption">{title}</span>
      {session?.dirty === true && <span class="caption text-warn">未保存の変更があります</span>}
    </header>
  )
}

function SizeRow({ store }: { store: OscPadStore }) {
  const pad = store.current.value
  const size = store.gridSize.value
  if (pad === null || size === null) return null
  const editing = store.session.value !== null
  const hidden = editing ? 0 : buttonsOutside(pad, size.rows, size.columns).length
  // 断られたときは formRevision が進み、選択欄を作業コピーの値で作り直す
  const revision = String(store.formRevision.value)
  return (
    <div class="pad-size">
      <label class="pad-size-select">
        <span class="caption">格子</span>
        <select aria-label="行数" value={String(size.rows)} key={`r${revision}`} onChange={(event) => store.resize(Number(pickAndRevert(event.currentTarget, String(size.rows))), null)}>
          {ROW_CHOICES.map((n) => <option key={n} value={String(n)}>{n}</option>)}
        </select>
        <span>行 ×</span>
        <select aria-label="列数" value={String(size.columns)} key={`c${revision}`} onChange={(event) => store.resize(null, Number(pickAndRevert(event.currentTarget, String(size.columns))))}>
          {COLUMN_CHOICES.map((n) => <option key={n} value={String(n)}>{n}</option>)}
        </select>
        <span>列</span>
      </label>
      <span class="caption">{editing ? '(パッドと一緒に保存します)' : '(この画面の表示だけ。保存しません)'}</span>
      {hidden > 0 && <span class="caption text-warn">表示の外に {hidden} 個のボタンがあります</span>}
    </div>
  )
}

function Toolbar({ store }: { store: OscPadStore }) {
  const load = useRef<HTMLSelectElement>(null)
  const connected = store.connected.value
  return (
    <div class="pad-toolbar">
      <span class="pad-field">
        <select ref={load} aria-label="保存済み" defaultValue="">
          <option value="">保存済み…</option>
          {store.names.value.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <button type="button" disabled={!connected} onClick={() => store.load(load.current?.value ?? '')}>切り替え</button>
      </span>
      <span class="pad-field">
        <input
          type="text"
          aria-label="保存名"
          placeholder="保存名"
          value={store.saveName.value}
          onInput={(event) => store.setSaveName(event.currentTarget.value)}
        />
        <button type="button" class="primary" disabled={!connected} onClick={() => store.save()}>保存</button>
      </span>
      <button type="button" onClick={() => store.startNew()}>新規</button>
    </div>
  )
}

function Hint({ store }: { store: OscPadStore }) {
  const clip = store.clipboard.value
  return (
    <p class="caption">
      格子のボタンを押すと、格子の下(Inspector)で編集できます。空きマス(+)を押すとボタンを足します。
      {clip !== null && `「${clip.label}」の設定をコピー済みです(ボタンを選んで「貼り付け」で置き換えます)。`}
    </p>
  )
}

function Grid({ store }: { store: OscPadStore }) {
  const pad = store.current.value
  const size = store.gridSize.value
  if (pad === null || size === null) return <p class="muted">パッドがありません。「パッドを編集」をオンにして作ります。</p>
  const editing = store.session.value !== null
  // 押下に載せる版は、この格子を描いたときの採用の版(描いた後に上書き保存・ブリッジの再起動があればブリッジが断る)
  const version = store.adopted.value?.version ?? ''
  const cells = []
  for (let row = 0; row < size.rows; row += 1) {
    for (let column = 0; column < size.columns; column += 1) {
      const button = buttonAt(pad, row, column)
      cells.push(
        button === undefined
          ? <EmptyCell key={`${String(row)},${String(column)}`} store={store} row={row} column={column} editing={editing} />
          : <ButtonCell key={button.id} store={store} button={button} editing={editing} version={version} />,
      )
    }
  }
  return <div class="pad-grid" style={{ gridTemplateColumns: `repeat(${String(size.columns)}, minmax(0, 1fr))` }}>{cells}</div>
}

function EmptyCell({ store, row, column, editing }: { store: OscPadStore; row: number; column: number; editing: boolean }) {
  if (!editing) return <div class="pad-cell empty" />
  return (
    <button type="button" class="pad-cell empty edit" aria-label={`${String(row + 1)} 行 ${String(column + 1)} 列にボタンを足す`} onClick={() => store.add(row, column)}>
      +
    </button>
  )
}

function ButtonCell({ store, button, editing, version }: { store: OscPadStore; button: OscPadButton; editing: boolean; version: string }) {
  const selected = editing && store.selected.value === button.id
  const label = <span class={button.image === undefined ? 'pad-label' : 'pad-label over-image'}>{button.label}</span>
  if (editing) {
    return (
      <div
        role="button"
        tabIndex={0}
        class={selected ? 'pad-cell edit selected' : 'pad-cell edit'}
        style={cellStyle(button)}
        aria-label={button.label || button.id}
        aria-pressed={selected}
        data-button={button.id}
        onClick={() => store.select(button.id)}
        onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && store.select(button.id)}
      >
        {label}
        <span class="pad-caption">{button.address}</span>
      </div>
    )
  }
  return (
    <div
      role="button"
      tabIndex={0}
      class="pad-cell run"
      style={cellStyle(button)}
      aria-label={button.label || button.id}
      data-button={button.id}
      // 押下は左ボタン(タッチ・ペンの主接触を含む)の pointerdown だけで送る。click は指を離すまで待つので使わない(D-081)
      onPointerDown={(event) => event.button === 0 && store.press(button.id, version)}
      onKeyDown={(event) => !event.repeat && (event.key === 'Enter' || event.key === ' ') && store.press(button.id, version)}
      onContextMenu={(event) => event.preventDefault()}
    >
      {label}
    </div>
  )
}

// --- Inspector ---------------------------------------------------------------

function Inspector({ store }: { store: OscPadStore }) {
  const session = store.session.value
  const id = store.selected.value
  const button = session === null || id === null ? undefined : findButton(session.draft, id)
  if (button === undefined) return null
  // 作業コピーから欄を作り直すとき(構造の命令・断られた・選び直し)だけ key が変わる。入力欄の命令では変わらないので、
  // 打っている欄の文字とカーソルは消えない
  const revision = store.formRevision.value
  return (
    <div class="inspector" aria-label="OSC パッドのボタン" key={`${String(revision)}-${button.id}`}>
      <div class="inspector-head">
        <strong>OSC パッドのボタン</strong>
        <button type="button" class="icon" aria-label="閉じる" onClick={() => store.select(null)}>×</button>
      </div>
      <Fold store={store} section="button" title={`ボタン (${button.id})`}>
        <Row name="ラベル">
          <TextField store={store} errorKey={fieldKeyOf('setLabel', button.id)} initial={button.label} maxLength={OSC_PAD.MAX_LABEL_CHARS} label="ラベル" onInput={(text) => store.setLabel(button.id, text)} />
        </Row>
        <Fold store={store} section="appearance" title="外観(任意)" caption={appearanceCaption(button)} child>
          <Appearance store={store} button={button} />
        </Fold>
        <Fold store={store} section="osc" title="OSC" child>
          <Osc store={store} button={button} />
        </Fold>
        <div class="inspector-actions">
          <button type="button" title="このボタンの設定をコピーします。別のボタンを選んで「貼り付け」で置き換えます" onClick={() => store.copy(button.id)}>コピー</button>
          <button type="button" title="コピーした設定でこのボタンを置き換えます" disabled={store.clipboard.value === null} onClick={() => store.paste(button.id)}>貼り付け</button>
          <button type="button" class="negative" onClick={() => store.remove(button.id)}>削除</button>
        </div>
      </Fold>
    </div>
  )
}

function Fold(props: { store: OscPadStore; section: Section; title: string; caption?: string; child?: boolean; children: ComponentChildren }) {
  const open = props.store.expanded.value[props.section]
  return (
    <details class={props.child === true ? 'fold child' : 'fold'} open={open} onToggle={(event) => props.store.setExpanded(props.section, event.currentTarget.open)}>
      <summary>
        {props.title}
        {props.caption !== undefined && <span class="caption"> {props.caption}</span>}
      </summary>
      {props.children}
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

/** 打った文字は欄に残す(defaultValue)。断られた理由はブリッジの答えを欄の下に出す。 */
function TextField(props: { store: OscPadStore; errorKey: string; initial: string; label: string; maxLength?: number; onInput: (text: string) => void }) {
  const error = props.store.fieldErrors.value.get(props.errorKey)
  return (
    <span class="field">
      <input
        type="text"
        aria-label={props.label}
        aria-invalid={error !== undefined}
        defaultValue={props.initial}
        maxLength={props.maxLength}
        // 構造の命令の答えを待つ間・画像の読み込み中は打たせない(預かった入力が添字のずれた別の欄に当たらないように)
        readOnly={props.store.formLocked.value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
      />
      {error !== undefined && <span class="caption negative field-error">{error}</span>}
    </span>
  )
}

function Appearance({ store, button }: { store: OscPadStore; button: OscPadButton }) {
  const file = useRef<HTMLInputElement>(null)
  return (
    <>
      <Row name="背景色">
        <span class="pad-field">
          <input type="color" aria-label="背景色" disabled={store.formLocked.value} defaultValue={(button.color ?? DEFAULT_BUTTON_COLOR).toLowerCase()} onInput={(event) => store.setColor(button.id, event.currentTarget.value)} />
          <span class="caption">{button.color ?? '既定'}</span>
          <button type="button" title="既定の色に戻す" disabled={button.color === undefined} onClick={() => store.setColor(button.id, null)}>既定に戻す</button>
        </span>
      </Row>
      <Row name="画像">
        <span class="pad-field">
          {button.image !== undefined && (
            <>
              <img src={button.image} alt="" class="pad-thumb" />
              <button type="button" onClick={() => void store.setImage(button.id, null)}>削除</button>
            </>
          )}
          <input
            ref={file}
            type="file"
            class="hidden"
            aria-label="画像のファイル"
            accept="image/png,image/jpeg,image/gif,image/webp"
            onChange={(event) => {
              const picked = event.currentTarget.files?.[0] ?? null
              event.currentTarget.value = ''
              if (picked !== null) void store.setImage(button.id, picked)
            }}
          />
          <button type="button" onClick={() => file.current?.click()}>画像を選ぶ ({OSC_PAD.MAX_IMAGE_BYTES / 1024} KiB まで)</button>
        </span>
      </Row>
    </>
  )
}

function Osc({ store, button }: { store: OscPadStore; button: OscPadButton }) {
  return (
    <>
      <Row name="アドレス">
        <TextField store={store} errorKey={fieldKeyOf('setAddress', button.id)} initial={button.address} label="アドレス" onInput={(text) => store.setAddress(button.id, text)} />
      </Row>
      {button.args.map((arg, index) => <ArgRow key={index} store={store} button={button} arg={arg} index={index} />)}
      <div class="inspector-actions">
        <span class="caption">{button.args.length} / {OSC_PAD.MAX_ARGS} 個</span>
        <button type="button" disabled={button.args.length >= OSC_PAD.MAX_ARGS} onClick={() => store.addArg(button.id)}>引数を追加</button>
      </div>
    </>
  )
}

function ArgRow({ store, button, arg, index }: { store: OscPadStore; button: OscPadButton; arg: OscPadArg; index: number }) {
  const count = button.args.length
  const name = `引数 ${String(index + 1)}`
  return (
    <Row name={name}>
      <span class="arg-row">
        <select aria-label={`${name} の型`} value={arg.type} onChange={(event) => store.setArgType(button.id, index, pickAndRevert(event.currentTarget, arg.type) as OscPadArg['type'])}>
          {ARG_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <TextField store={store} errorKey={fieldKeyOf('setArgValue', button.id, index)} initial={formatArgValue(arg)} label={`${name} の値`} onInput={(text) => store.setArgValue(button.id, index, text)} />
        <button type="button" class="small" aria-label={`${name} を上へ`} title="上へ" disabled={index === 0} onClick={() => store.moveArg(button.id, index, -1)}>↑</button>
        <button type="button" class="small" aria-label={`${name} を下へ`} title="下へ" disabled={index >= count - 1} onClick={() => store.moveArg(button.id, index, 1)}>↓</button>
        <button type="button" class="small negative" aria-label={`${name} を削除`} title="削除" onClick={() => store.removeArg(button.id, index)}>✕</button>
      </span>
    </Row>
  )
}

function ConfirmDialog({ store }: { store: OscPadStore }) {
  const asked = store.confirm.value
  if (asked === null) return null
  // 外側を押しても閉じない(スイッチの表示と実際のモードがずれないように)
  return (
    <div class="backdrop">
      <div class="dialog" role="alertdialog" aria-label={asked.message}>
        <p>{asked.message}</p>
        <div class="dialog-actions">
          <button type="button" onClick={() => store.answerConfirm(false)}>やめる</button>
          <button type="button" class="primary danger" onClick={() => store.answerConfirm(true)}>{asked.okLabel}</button>
        </div>
      </div>
    </div>
  )
}
