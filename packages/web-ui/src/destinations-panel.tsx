// 宛先パネルの画面(D-138。HID-461 の試作から)。状態は destinations-store の signal を読むだけで、規則は destinations-logic に置く。
// 一覧は signal が変わった部品だけが描き直されるので、検索欄の入力・フォーカス・スクロールは一覧の更新で切れない

import { useEffect, useRef } from 'preact/hooks'

import { DESTINATIONS, type DestinationsFrame } from '@oscdesk/shared'

import {
  allDevicesLabel,
  allDevicesTooltip,
  deviceCaption,
  deviceName,
  groupDevices,
  isChecked,
  matchDevices,
  mismatchSummary,
  networkLabel,
  scanStatus,
  sourceLabel,
  targetsSummary,
  type Broadcast,
  type Device,
  type Selection,
} from './destinations-logic'
import { FADE_MS, type DestinationsStore, type Light } from './destinations-store'
import { Check, Modal } from './widgets'

const COLORS: Record<Light['result'], string> = { ok: '76,175,80', ignored: '255,193,7', failed: '244,67,54' }

export function DestinationsPanel({ store }: { store: DestinationsStore }) {
  const frame = store.frame.value
  const connected = store.connected.value
  return (
    <section class="panel" aria-label="送信先">
      <header class="panel-head">
        <h2>送信先</h2>
        <span class="caption">{frame === null ? '' : scanStatus(frame)}</span>
        <button
          type="button"
          class="flat"
          disabled={!connected || frame === null || frame.scanning}
          aria-busy={frame?.scanning ?? false}
          onClick={() => store.scan()}
        >
          {frame?.scanning === true ? '走査中…' : '更新'}
        </button>
      </header>
      {frame !== null && <p class="caption break">{targetsSummary(frame)}</p>}
      <MismatchSummary store={store} />
      <SearchBox store={store} />
      {frame === null
        ? <p class="muted">ブリッジから宛先の情報を待っています。</p>
        : <DeviceList store={store} frame={frame} connected={connected} />}
      {frame !== null && (
        <footer class="panel-foot">
          <span class="caption">{sourceLabel(frame)}</span>
          <button type="button" class="flat" disabled={!connected || frame.selection.source === 'config'} onClick={() => store.resetToConfig()}>
            設定ファイルの宛先に戻す
          </button>
        </footer>
      )}
      <Modal><AliasDialog store={store} /></Modal>
    </section>
  )
}

function MismatchSummary({ store }: { store: DestinationsStore }) {
  const text = mismatchSummary(store.mismatched.value.size)
  return text === '' ? null : <p class="caption negative">{text}</p>
}

function SearchBox({ store }: { store: DestinationsStore }) {
  const query = store.query.value
  const frame = store.frame.value
  const fallback = matchDevices(frame?.devices ?? [], query).fallback
  return (
    <div class="search">
      <input
        type="search"
        placeholder="名前・IP で絞り込む(正規表現)"
        value={query}
        onInput={(event) => store.setQuery(event.currentTarget.value)}
      />
      {fallback === 'invalid' && <p class="caption">正規表現として読めないため、文字どおりに探しています</p>}
    </div>
  )
}

function DeviceList({ store, frame, connected }: { store: DestinationsStore; frame: DestinationsFrame; connected: boolean }) {
  const selection = store.selection.value as Selection
  const query = store.query.value
  const filtering = query.trim() !== ''
  const scanned = frame.broadcasts.map((broadcast) => broadcast.network)
  const groups = groupDevices(frame)
  const ordered = groups.flatMap((group) => group.devices)
  const matched = matchDevices(ordered, query).matched
  let index = 0
  const visibleGroups = groups.map((group) => ({ group, devices: group.devices.filter(() => matched[index++]) }))
  const visible = visibleGroups.flatMap((entry) => entry.devices)

  return (
    <div class="list">
      {filtering
        ? (
          <Check
            label={allDevicesLabel(frame, true)}
            checked={visible.length > 0 && visible.every((device) => isChecked(device, selection, scanned))}
            disabled={!connected || visible.length === 0}
            onChange={(checked) => store.toggleVisible(visible.map((device) => device.host), checked)}
          />
        )
        : (
          <Check
            label={allDevicesLabel(frame)}
            title={frame.broadcasts.length > 0 ? allDevicesTooltip(frame) : undefined}
            checked={selection.allDevices}
            // ネットワークが無いときは選べないが、既に選んでいれば外せるようにしておく
            disabled={!connected || (frame.broadcasts.length === 0 && !selection.allDevices)}
            onChange={(checked) => store.toggleAllDevices(checked)}
          />
        )}
      {frame.devices.length === 0 && <p class="muted">端末が見つかっていません。「更新」で走査します。</p>}
      {filtering && frame.devices.length > 0 && visible.length === 0 && <p class="muted">検索に一致する端末がありません。</p>}
      {visibleGroups.map(({ group, devices }) => (filtering && devices.length === 0 ? null : (
        <div class="group" key={group.broadcast?.network ?? '(other)'}>
          {group.broadcast === null
            ? <p class="group-title">その他の宛先</p>
            : <NetworkHeader store={store} broadcast={group.broadcast} devices={devices} selection={selection} scanned={scanned} filtering={filtering} connected={connected} />}
          {devices.map((device) => (
            <DeviceRow key={device.host} store={store} device={device} checked={isChecked(device, selection, scanned)} connected={connected} />
          ))}
        </div>
      )))}
    </div>
  )
}

function NetworkHeader(props: {
  store: DestinationsStore; broadcast: Broadcast; devices: Device[]; selection: Selection; scanned: string[]; filtering: boolean; connected: boolean
}) {
  const { store, broadcast, devices, selection, scanned, filtering, connected } = props
  return (
    <>
      <p class="group-title">{broadcast.network}({broadcast.interface})</p>
      {filtering
        ? (
          <Check
            label={networkLabel(true)}
            checked={devices.length > 0 && devices.every((device) => isChecked(device, selection, scanned))}
            disabled={!connected}
            onChange={(checked) => store.toggleVisible(devices.map((device) => device.host), checked)}
          />
        )
        : (
          <Check
            label={networkLabel()}
            title={`送り先: ${broadcast.address}`}
            // 全てのデバイスの間はネットワークにもチェックを付けて見せる(D-089)
            checked={selection.allDevices || selection.networks.includes(broadcast.network)}
            disabled={!connected}
            onChange={(checked) => store.toggleNetwork(broadcast.network, checked)}
          />
        )}
    </>
  )
}

function DeviceRow({ store, device, checked, connected }: { store: DestinationsStore; device: Device; checked: boolean; connected: boolean }) {
  const light = store.lights.value.get(device.host)
  const marked = store.mismatched.value.has(device.host)
  const row = useRef<HTMLDivElement>(null)
  // 到達の点灯(D-116)。退色は CSS の transition に任せ、点灯の開始だけを書く。描き直しても続きから光る
  useEffect(() => {
    const element = row.current
    if (element === null || light === undefined) return
    const remaining = Math.max(0, 1 - (Date.now() - light.at) / FADE_MS)
    if (remaining === 0) return
    element.style.transition = 'none'
    element.style.backgroundColor = `rgba(${COLORS[light.result]},${remaining.toFixed(3)})`
    void element.offsetWidth
    element.style.transition = `background-color ${((remaining * FADE_MS) / 1000).toFixed(2)}s linear`
    element.style.backgroundColor = `rgba(${COLORS[light.result]},0)`
  }, [light?.seq])
  const caption = deviceCaption(device)
  return (
    <div ref={row} class={marked ? 'device mismatch' : 'device'} data-host={device.host} title={device.mac === null ? undefined : `MAC ${device.mac}`}>
      <Check label={deviceName(device)} checked={checked} disabled={!connected} onChange={(next) => store.toggleDevice(device.host, next)} />
      {caption !== '' && <span class="caption">{caption}</span>}
      <span class={marked ? 'marker' : 'marker invisible'} title="設計図がこの PC の送ったものと一致していません">!</span>
      <button type="button" class="icon" title="名前を付ける" aria-label={`${deviceName(device)} に名前を付ける`} disabled={!connected} onClick={() => store.openAlias(device)}>
        ✎
      </button>
    </div>
  )
}

function AliasDialog({ store }: { store: DestinationsStore }) {
  const editor = store.aliasEditor.value
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
  }, [editor?.host])
  if (editor === null) return null
  const save = () => store.saveAlias(input.current?.value ?? '')
  return (
    <div class="backdrop" onClick={(event) => event.target === event.currentTarget && store.cancelAlias()}>
      <div class="dialog" role="dialog" aria-label={editor.title}>
        <h3>{editor.title}</h3>
        <input
          key={editor.host}
          ref={input}
          type="text"
          defaultValue={editor.initial}
          placeholder="例: ステージ左 iPad"
          maxLength={DESTINATIONS.MAX_ALIAS_CHARS}
          onKeyDown={(event) => {
            // IME の変換を確定する Enter では決定しない(Safari は keyCode 229 で見分ける)
            if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) save()
          }}
        />
        <p class="caption">{editor.hint}</p>
        <div class="dialog-actions">
          {editor.canClear && <button type="button" class="flat negative" onClick={() => store.saveAlias(null)}>名前を消す</button>}
          <button type="button" class="flat" onClick={() => store.cancelAlias()}>キャンセル</button>
          <button type="button" class="primary" disabled={editor.sending} onClick={save}>{editor.sending ? '送信中…' : '決定'}</button>
        </div>
      </div>
    </div>
  )
}
