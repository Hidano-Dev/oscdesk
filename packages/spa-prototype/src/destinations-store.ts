// 宛先パネルの状態(HID-461 の試作)。ブラウザがブリッジの WebSocket(7080)に直接つなぎ、届いたフレームを
// shared の zod スキーマで検証してから signal に入れる。画面は signal を読むだけで、変わったところだけが描き直される
// (NiceGUI 版の「20Hz のタイマーで revision を比べて .clear() から組み直す」をしない)。
//
// 規則の正はブリッジのまま(選択・別名・走査はブリッジが決めて destinations の全量で配り直す)。ここが持つのは
// NiceGUI 版の destinations_panel.py / state/ と同じ表示キャッシュと、応答待ちの選択・別名だけ

import { batch, computed, signal } from '@preact/signals'

import {
  DownstreamFrameSchema,
  UpstreamFrameSchema,
  WIRE_PROTOCOL_VERSION,
  type DestinationsFrame,
  type DownstreamFrame,
  type UpstreamFrame,
} from '@oscdesk/shared'

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

/**
 * ブラウザの WebSocket のうち使う部分。テストでは偽物を渡す。ハンドラの引数を never にしているのは、ブラウザの
 * WebSocket(引数が Event / MessageEvent)も偽物もそのまま代入できるようにするため(store は自分で型を付けて受ける)
 */
export interface SocketLike {
  send(data: string): void
  close(): void
  onopen: ((event: never) => void) | null
  onmessage: ((event: never) => void) | null
  onclose: ((event: never) => void) | null
  onerror: ((event: never) => void) | null
}

export type DeliveryResult = 'ok' | 'ignored' | 'failed'
export interface Light { result: DeliveryResult; at: number; seq: number }
export interface Notice { id: number; level: 'info' | 'warn' | 'error'; text: string }
export interface AliasEditor { host: string; title: string; hint: string; initial: string; canClear: boolean; sending: boolean }

/** 未確定の選択を持つ上限(NiceGUI 版の PENDING_TIMEOUT_S と同じ)。 */
export const PENDING_TIMEOUT_MS = 3_000
/** 点灯してから元の色に戻るまで(D-116)。 */
export const FADE_MS = 10_000
const RECONNECT_MS = 1_000
const NOTICE_LIMIT = 5
const RANK: Record<DeliveryResult, number> = { ok: 1, ignored: 2, failed: 3 }

export interface StoreDeps {
  url: string
  createSocket: (url: string) => SocketLike
  now?: () => number
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  logWarn?: (...args: unknown[]) => void
}

export type DestinationsStore = ReturnType<typeof createDestinationsStore>

type CatalogFrame = Extract<DownstreamFrame, { type: 'catalog' }>
type NoticeFrame = Extract<DownstreamFrame, { type: 'notice' }>

export function createDestinationsStore(deps: StoreDeps) {
  const now = deps.now ?? Date.now
  const setTimer = deps.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms))
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const logWarn = deps.logWarn ?? console.warn

  const connected = signal(false)
  const frame = signal<DestinationsFrame | null>(null)
  // 送ったがまだ反映を見ていない選択。続けて押されたチェックはここから作る(届いた frame から作ると、応答の前に
  // 2 台を続けて変えたとき後の送信が先の変更を消す。D-078)
  const pending = signal<{ selection: Selection; at: number } | null>(null)
  const query = signal('')
  const aliasEditor = signal<AliasEditor | null>(null)
  const aliasSent = signal<{ host: string; alias: string | null } | null>(null)
  const lights = signal<ReadonlyMap<string, Light>>(new Map())
  const catalogVerified = signal<ReadonlyMap<string, boolean | null>>(new Map())
  const notices = signal<readonly Notice[]>([])

  // チェックの見た目は応答待ちの選択があればそれで描く。断られた・時間切れ・切断で pending を捨てれば、
  // ブリッジの選択に戻る(断られた選択が画面に残らない)
  const selection = computed<Selection | null>(() => {
    const current = frame.value
    if (current === null) return null
    return pending.value?.selection ?? selectionOf(current)
  })
  const mismatched = computed(() => new Set([...catalogVerified.value].filter(([, verified]) => verified === false).map(([host]) => host)))

  let socket: SocketLike | null = null
  let closed = false
  let autoScanRequested = false
  let pendingTimer: unknown = null
  let noticeSeq = 0
  let lightSeq = 0

  const notify = (level: Notice['level'], text: string) => {
    noticeSeq += 1
    notices.value = [...notices.value, { id: noticeSeq, level, text }].slice(-NOTICE_LIMIT)
  }

  const dismissNotice = (id: number) => {
    notices.value = notices.value.filter((notice) => notice.id !== id)
  }

  /** 上りのフレームも shared のスキーマで確かめてから送る(ブリッジが断るものを送らない)。 */
  const send = (candidate: UpstreamFrame): boolean => {
    if (socket === null || !connected.value) return false
    const checked = UpstreamFrameSchema.safeParse(candidate)
    if (!checked.success) {
      logWarn('(WARN, SPA)', 'Refused to send an invalid frame', candidate.type, checked.error.issues)
      return false
    }
    socket.send(JSON.stringify(checked.data))
    return true
  }

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

  const onNotice = (notice: NoticeFrame) => {
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
        // 宛先パネルに関係しない notice は、この試作では出さない
        break
    }
  }

  const onCatalog = (catalog: CatalogFrame) => {
    // PC ごとの差分(D-131)。hosts に無い PC は捨て、届いた PC は丸ごと置き換える
    const next = new Map<string, boolean | null>()
    for (const host of catalog.hosts) {
      const pc = catalog.pcs.find((item) => item.host === host)
      next.set(host, pc !== undefined ? pc.verified : catalogVerified.value.get(host) ?? null)
    }
    catalogVerified.value = next
  }

  const onDelivery = (events: Extract<DownstreamFrame, { type: 'delivery' }>['events']) => {
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

  const onFrame = (raw: unknown) => {
    let json: unknown
    try {
      json = JSON.parse(typeof raw === 'string' ? raw : String(raw))
    } catch {
      logWarn('(WARN, SPA)', 'Dropped a frame that is not JSON')
      return
    }
    // 下りのフレームも境界で検証する。不正なフレームはそれだけを捨てて接続は保つ(開発標準)
    const parsed = DownstreamFrameSchema.safeParse(json)
    if (!parsed.success) {
      logWarn('(WARN, SPA)', 'Dropped an invalid frame', parsed.error.issues.slice(0, 3))
      return
    }
    const downstream = parsed.data
    switch (downstream.type) {
      case 'heartbeat':
        send({ v: WIRE_PROTOCOL_VERSION, type: 'heartbeatAck', t: downstream.t })
        break
      case 'destinations':
        onDestinations(downstream)
        break
      case 'notice':
        onNotice(downstream)
        break
      case 'catalog':
        onCatalog(downstream)
        break
      case 'delivery':
        onDelivery(downstream.events)
        break
      default:
        break
    }
  }

  const connect = () => {
    if (closed) return
    const next = deps.createSocket(deps.url)
    socket = next
    next.onopen = () => {
      connected.value = true
    }
    next.onmessage = (event: { data: unknown }) => onFrame(event.data)
    next.onerror = () => undefined
    next.onclose = () => {
      if (socket !== next) return
      socket = null
      batch(() => {
        connected.value = false
        clearPending()
        autoScanRequested = false
        catalogVerified.value = new Map()
        aliasSent.value = null
        if (aliasEditor.value !== null) aliasEditor.value = { ...aliasEditor.value, sending: false }
      })
      if (!closed) setTimer(connect, RECONNECT_MS)
    }
  }

  return {
    // 読むだけの状態(画面はこれを購読する)
    connected,
    frame,
    selection,
    query,
    aliasEditor,
    lights,
    mismatched,
    notices,

    start: connect,
    close() {
      closed = true
      socket?.close()
    },
    dismissNotice,
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
