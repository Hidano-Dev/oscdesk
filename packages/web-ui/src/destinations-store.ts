// 宛先パネルの状態(D-138。HID-461 の試作から)。共有の接続(bridge-link)が検証済みのフレームを渡し、ここは
// 宛先パネルに関わるものだけを signal に入れる。画面は signal を読むだけで、変わったところだけが描き直される
// (NiceGUI 版の「20Hz のタイマーで revision を比べて .clear() から組み直す」をしない)。
//
// 規則の正はブリッジのまま(選択・別名・走査はブリッジが決めて destinations の全量で配り直す)。ここが持つのは
// NiceGUI 版の destinations_panel.py / state/ と同じ表示キャッシュと、応答待ちの選択・別名だけ。
// 押したチェックは応答を待たずに手元で先に付け、断られた・時間切れ・切断のどれかで取り消す(D-140)

import { batch, computed, signal } from '@preact/signals'

import { WIRE_PROTOCOL_VERSION, type DestinationsFrame } from '@oscdesk/shared'

import type { BridgeLink, FrameOf } from './bridge-link'
import {
  aliasFromInput,
  aliasKeyHint,
  isEmpty,
  sameSelection,
  selectionOf,
  selectionWith,
  selectionWithout,
  toggledNetworks,
  type Device,
  type Selection,
} from './destinations-logic'
import type { Notices } from './notices'

export type DeliveryResult = 'ok' | 'ignored' | 'failed'
export interface Light { result: DeliveryResult; at: number; seq: number }
export interface AliasEditor { host: string; title: string; hint: string; initial: string; canClear: boolean; sending: boolean }

/** 未確定の選択を持つ上限(NiceGUI 版の PENDING_TIMEOUT_S と同じ)。 */
export const PENDING_TIMEOUT_MS = 3_000
/** 点灯してから元の色に戻るまで(D-116)。 */
export const FADE_MS = 10_000
const RANK: Record<DeliveryResult, number> = { ok: 1, ignored: 2, failed: 3 }

export interface StoreDeps {
  link: BridgeLink
  notices: Notices
  now?: () => number
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export type DestinationsStore = ReturnType<typeof createDestinationsStore>
export function createDestinationsStore(deps: StoreDeps) {
  const now = deps.now ?? Date.now
  const setTimer = deps.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms))
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const { link } = deps
  const send = link.send

  const frame = signal<DestinationsFrame | null>(null)
  // 送ったがまだ反映を見ていない選択。続けて押されたチェックはここから作る(届いた frame から作ると、応答の前に
  // 2 台を続けて変えたとき後の送信が先の変更を消す。D-078)
  const pending = signal<{ selection: Selection; at: number } | null>(null)
  const query = signal('')
  const aliasEditor = signal<AliasEditor | null>(null)
  const aliasSent = signal<{ host: string; alias: string | null } | null>(null)
  const lights = signal<ReadonlyMap<string, Light>>(new Map())
  const catalogVerified = signal<ReadonlyMap<string, boolean | null>>(new Map())

  // チェックの見た目は応答待ちの選択があればそれで描く。断られた・時間切れ・切断で pending を捨てれば、
  // ブリッジの選択に戻る(断られた選択が画面に残らない)
  const selection = computed<Selection | null>(() => {
    const current = frame.value
    if (current === null) return null
    return pending.value?.selection ?? selectionOf(current)
  })
  const mismatched = computed(() => new Set([...catalogVerified.value].filter(([, verified]) => verified === false).map(([host]) => host)))

  let autoScanRequested = false
  let pendingTimer: unknown = null
  let lightSeq = 0

  const notify = deps.notices.notify

  const clearPending = () => {
    if (pendingTimer !== null) clearTimer(pendingTimer)
    pendingTimer = null
    pending.value = null
  }

  const sendSelection = (next: Selection): boolean => {
    if (!send({ v: WIRE_PROTOCOL_VERSION, type: 'destinationsSelect', allDevices: next.allDevices, networks: [...next.networks], hosts: [...next.hosts] })) {
      return false
    }
    if (pendingTimer !== null) clearTimer(pendingTimer)
    pending.value = { selection: next, at: now() }
    // 上限を過ぎても反映されないのは、他の画面の変更が後から勝ったかブリッジ側で選択が変わったとき。届いた選択に従い直す
    pendingTimer = setTimer(() => {
      pendingTimer = null
      pending.value = null
    }, PENDING_TIMEOUT_MS)
    return true
  }

  const base = (): Selection | null => {
    const current = frame.value
    if (current === null) return null
    return pending.value?.selection ?? selectionOf(current)
  }

  const disconnectedWarning = (what: string) => notify('warn', `ブリッジに接続していないため${what}できませんでした`)

  const reset = (): boolean => {
    // 設定ファイルの宛先へ戻すので、それより前に送った未確定の選択は土台にしない
    clearPending()
    return send({ v: WIRE_PROTOCOL_VERSION, type: 'destinationsReset' })
  }

  const sendOrReset = (next: Selection) => {
    // 何も残らない選択はブリッジが断る。戻す先が無いときは設定ファイルの宛先へ戻す
    const sent = isEmpty(next) ? reset() : sendSelection(next)
    if (!sent) disconnectedWarning('変更')
  }

  const onDestinations = (next: DestinationsFrame) => {
    batch(() => {
      frame.value = next
      const waiting = pending.value
      if (waiting !== null && sameSelection(waiting.selection, selectionOf(next))) clearPending()
      const sent = aliasSent.value
      if (sent !== null && next.devices.some((device) => device.host === sent.host && device.alias === sent.alias)) {
        // 送った名前が一覧に出たら閉じる(送った時点で閉じると、断られたときに入力が消える)
        aliasSent.value = null
        aliasEditor.value = null
      }
    })
    // ブリッジは起動時に走査しない。未走査のまま開いたら 1 回だけ頼む(切断と走査済みの受信で印を戻す)
    if (next.scannedAt !== null) autoScanRequested = false
    if (next.scannedAt === null && !next.scanning && !autoScanRequested) {
      autoScanRequested = send({ v: WIRE_PROTOCOL_VERSION, type: 'destinationsScan' })
    }
  }

  const onNotice = (notice: FrameOf<'notice'>) => {
    switch (notice.code) {
      case 'destinations-rejected':
        clearPending()
        notify('error', `宛先を変更できません: ${notice.detail}`)
        break
      case 'destination-alias-rejected':
        // 入力はそのまま残し、直して送り直せるようにする
        aliasSent.value = null
        if (aliasEditor.value !== null) aliasEditor.value = { ...aliasEditor.value, sending: false }
        notify('error', `端末の名前を変更できません: ${notice.detail}`)
        break
      case 'destinations-scan-failed':
        notify('warn', `ネットワークの走査に失敗しました: ${notice.detail}`)
        break
      case 'destinations-save-failed':
        notify('error', `宛先の選択を保存できませんでした: ${notice.detail}`)
        break
      case 'destination-aliases-save-failed':
        notify('error', `端末の名前を保存できませんでした: ${notice.detail}`)
        break
      default:
        // 宛先パネルに関係しない notice は、それぞれのパネルが受ける
        break
    }
  }

  const onCatalog = (catalog: FrameOf<'catalog'>) => {
    // PC ごとの差分(D-131)。hosts に無い PC は捨て、届いた PC は丸ごと置き換える
    const next = new Map<string, boolean | null>()
    for (const host of catalog.hosts) {
      const pc = catalog.pcs.find((item) => item.host === host)
      next.set(host, pc !== undefined ? pc.verified : catalogVerified.value.get(host) ?? null)
    }
    catalogVerified.value = next
  }

  const onDelivery = (events: FrameOf<'delivery'>['events']) => {
    // 点灯中の赤・黄を後から来た緑で上書きしない(HID-376)。同じか強い結果は点灯し直す
    const at = now()
    const next = new Map(lights.value)
    let changed = false
    for (const event of events) {
      const current = next.get(event.host)
      if (current !== undefined && at - current.at < FADE_MS && RANK[event.result] < RANK[current.result]) continue
      lightSeq += 1
      next.set(event.host, { result: event.result, at, seq: lightSeq })
      changed = true
    }
    if (changed) lights.value = next
  }

  const unsubscribe = [
    link.on('destinations', onDestinations),
    link.on('notice', onNotice),
    link.on('catalog', onCatalog),
    link.on('delivery', (delivery) => onDelivery(delivery.events)),
    link.onConnectionChange((connected) => {
      if (connected) return
      // 切れたら応答待ちを捨てる(届かない応答を待ち続けて、押した見た目が残らないように)。宛先の一覧そのものは
      // 最後に届いたものを見せ続け、つなぎ直しで届く destinations で置き換える
      batch(() => {
        clearPending()
        autoScanRequested = false
        catalogVerified.value = new Map()
        aliasSent.value = null
        if (aliasEditor.value !== null) aliasEditor.value = { ...aliasEditor.value, sending: false }
      })
    }),
  ]

  return {
    // 読むだけの状態(画面はこれを購読する)
    connected: link.connected,
    frame,
    selection,
    query,
    aliasEditor,
    lights,
    mismatched,

    /** 受けるのをやめる(テストと、パネルを外すとき)。 */
    dispose() {
      clearPending()
      for (const stop of unsubscribe) stop()
    },
    setQuery(value: string) {
      query.value = value
    },

    toggleDevice(host: string, checked: boolean) {
      const current = frame.value
      const from = base()
      if (current === null || from === null) return
      const next = checked ? selectionWith(current, from, [host]) : selectionWithout(current, from, [host])
      if (isEmpty(next)) {
        notify('warn', '送信先を 1 台以上選んでください')
        return
      }
      if (!sendSelection(next)) disconnectedWarning('変更')
    },
    toggleNetwork(network: string, checked: boolean) {
      const current = frame.value
      const from = base()
      if (current === null || from === null) return
      if ((from.allDevices || from.networks.includes(network)) === checked) return
      if (checked) {
        const order = current.broadcasts.map((broadcast) => broadcast.network)
        sendOrReset({ ...from, networks: toggledNetworks(from.networks, network, true, order) })
        return
      }
      sendOrReset(selectionWithout(current, from, [], network))
    },
    /** 絞り込んでいる間の「表示中の全てのデバイス」。表示中の端末だけを個別の選択として付け外しする。 */
    toggleVisible(hosts: readonly string[], checked: boolean) {
      const current = frame.value
      const from = base()
      if (current === null || from === null || hosts.length === 0) return
      sendOrReset(checked ? selectionWith(current, from, hosts) : selectionWithout(current, from, hosts))
    },
    toggleAllDevices(checked: boolean) {
      const from = base()
      if (from === null || from.allDevices === checked) return
      sendOrReset({ ...from, allDevices: checked })
    },
    scan() {
      if (!send({ v: WIRE_PROTOCOL_VERSION, type: 'destinationsScan' })) disconnectedWarning('走査')
    },
    resetToConfig() {
      if (!reset()) disconnectedWarning('戻せ')
    },

    openAlias(device: Device) {
      aliasSent.value = null
      aliasEditor.value = {
        host: device.host,
        title: `${device.hostname ?? device.host} の名前`,
        hint: aliasKeyHint(device),
        initial: device.alias ?? '',
        canClear: device.alias !== null,
        sending: false,
      }
    },
    /** 名前を送る。表示は変えず、ブリッジが配り直す destinations で描き直す(別名の正はブリッジ。D-092)。 */
    saveAlias(text: string | null): boolean {
      const editor = aliasEditor.value
      if (editor === null) return false
      const checked = aliasFromInput(text)
      if (!checked.ok) {
        notify('warn', checked.message)
        return false
      }
      if (!send({ v: WIRE_PROTOCOL_VERSION, type: 'destinationsAlias', host: editor.host, alias: checked.alias })) {
        disconnectedWarning('名前を変更')
        return false
      }
      aliasSent.value = { host: editor.host, alias: checked.alias }
      aliasEditor.value = { ...editor, sending: true }
      return true
    },
    cancelAlias() {
      aliasSent.value = null
      aliasEditor.value = null
    },
  }
}
