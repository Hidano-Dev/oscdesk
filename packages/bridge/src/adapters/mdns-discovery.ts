import type { RemoteInfo } from 'node:dgram'

import multicastDns from 'multicast-dns'

import { OSCQUERY } from '@oscdesk/shared'

import type { DiscoveredService, MdnsState } from '../domain/oscquery-targets'

// mDNS で `_oscjson._tcp` を探す(D-168)。multicast-dns を、ブリッジが選んだ IPv4 の NIC ごとに 1 つずつ起動する
// (bonjour 系のライブラリは複数の NIC の扱いを隠し、どの NIC で見つけたかを選べないため。HID-484 §2)。
// Windows は Dnscache が 5353 を使っているので reuseAddr で共有する。ネットワークが「パブリック」だとファイアウォールで
// 塞がれ、何も見つからないことがある(docs/VERIFICATION.md)。TXT は txtvers=1 だけで中身に頼らない(HID-484 §6.6)。
// 読みに行くアドレスは応答の送信元(A レコードは使わない)。A レコードは誰でも好きなアドレスを書けるので、LAN の 1 台が
// 127.0.0.1 や範囲の外のアドレスを名乗ると、ブリッジにこの PC のほかのポートや範囲の外へ HTTP を取りに行かせられるため

export interface MdnsDiscovery {
  readonly state: MdnsState
  /** 探す NIC を取り直してから(開けなかった NIC も開き直す)、問い合わせを今すぐ出す */
  query(): void
  /** 探す NIC(IPv4 のアドレス)を `interfaces()` で取り直し、増えた NIC を開いて消えた NIC を閉じる。同じなら何もしない */
  refreshInterfaces(): void
  /**
   * いま見えているサービスを全部、もう一度 onFound で知らせる。読んでよいかの判定(ターゲットがいる範囲)が変わったとき、
   * 前に断ったサービスを拾い直すため(同じ応答は通知を間引くので、問い合わせ直すだけでは知らせ直さない)
   */
  renotify(): void
  close(): void
}

interface Seen {
  service: DiscoveredService
  lastSeen: number
}

const SERVICE: string = OSCQUERY.SERVICE_TYPE
// 問い合わせへの答えとみなす間(mDNS の応答者は 20〜120 ms 待って答える。RFC 6762 §6)
const ANSWER_WINDOW_MS = 1_000
// 開けなかった NIC を query() で作り直すまでの最短の間。osc.queryRefresh は 1 秒に 1 回まで届くので、塞がれた NIC の
// 警告とソケットの作り直しがそのたびに出ないようにする
const RETRY_FAILED_MS = 30_000

export function startMdnsDiscovery(options: {
  /**
   * 探す NIC(IPv4 のアドレス)を今の状態で返す。開始時・定期の問い合わせのたび・query() のたびに引き直す
   * (LAN に未接続で起動してから Ethernet をつないだとき、新しい NIC にソケットを作るため。HID-497)
   */
  interfaces: () => readonly string[]
  /** 既定 5353。テストは帯の中のポートで、ループバックの NIC だけに閉じて動かす(D-133) */
  port?: number
  queryIntervalMs: number
  onFound: (service: DiscoveredService) => void
  onLost: (instance: string) => void
  onStateChanged?: () => void
  now?: () => number
  logWarn?: (...args: unknown[]) => void
  create?: typeof multicastDns
}): MdnsDiscovery {
  const create = options.create ?? multicastDns
  const now = options.now ?? Date.now
  const logWarn = options.logWarn ?? console.warn
  const port = options.port ?? 5353
  const sockets = new Map<string, { instance: multicastDns.Instance; ready: boolean; failed: boolean; failedAt: number }>()
  // NIC が消えた・作り直したことで閉じたソケット。閉じた後に届く問い合わせの結果やエラーで、使っていないソケットの警告を出さない
  const destroyed = new WeakSet<multicastDns.Instance>()
  const seen = new Map<string, Seen>()
  let closed = false
  let state: MdnsState = 'failed'

  const updateState = () => {
    const values = [...sockets.values()]
    const next: MdnsState = values.some(socket => socket.ready) ? 'running' : values.length === 0 || values.every(socket => socket.failed) ? 'failed' : state
    if (next !== state) {
      state = next
      options.onStateChanged?.()
    }
  }

  let lastQueryAt = 0
  const sendQuery = (socket: multicastDns.Instance, name = SERVICE, type = 'PTR') => {
    lastQueryAt = now()
    socket.query({ questions: [{ name, type }] }, error => {
      if (error !== null && error !== undefined && !closed && !destroyed.has(socket)) logWarn('(WARN, BRIDGE)', `mDNS query failed: ${error.message}`)
    })
  }

  const handleResponse = (socket: multicastDns.Instance, packet: multicastDns.Packet, rinfo: RemoteInfo) => {
    const records = [...(packet.answers ?? []), ...(packet.additionals ?? [])].filter(record => typeof record.name === 'string' && typeof record.type === 'string')
    for (const record of records) {
      if (record.type !== 'PTR' || record.name.toLowerCase() !== SERVICE || typeof record.data !== 'string') continue
      const fullName = record.data
      const instance = instanceName(fullName)
      if (instance === null) continue
      if (record.ttl === 0) {
        // 削除の告知(goodbye)
        if (seen.delete(instance)) options.onLost(instance)
        continue
      }
      const srv = records.find(entry => entry.type === 'SRV' && entry.name.toLowerCase() === fullName.toLowerCase())
      const srvData = srv?.data as { port?: unknown; target?: unknown } | undefined
      if (srvData === undefined || typeof srvData.port !== 'number') {
        // SRV を一緒に返さない応答者もいる。インスタンスに SRV を問い合わせ直す
        sendQuery(socket, fullName, 'SRV')
        continue
      }
      found({ instance, host: rinfo.address, port: srvData.port })
    }
    // SRV だけの応答(上の問い合わせ直しへの答え)
    for (const record of records) {
      if (record.type !== 'SRV' || !record.name.toLowerCase().endsWith(`.${SERVICE}`)) continue
      const instance = instanceName(record.name)
      const data = record.data as { port?: unknown; target?: unknown } | undefined
      if (instance === null || typeof data?.port !== 'number' || records.some(entry => entry.type === 'PTR' && entry.data === record.name)) continue
      if (record.ttl === 0) {
        if (seen.delete(instance)) options.onLost(instance)
        continue
      }
      found({ instance, host: rinfo.address, port: data.port })
    }
  }

  // 知らせるのは、新しい・アドレスかポートが変わった・こちらの問い合わせと関係なく届いた(起動の告知)ときだけ。
  // 定期の問い合わせへの答えと、NIC ごとのソケットに同じ応答が重ねて届く分は、居ることの確認(lastSeen)だけにする
  // (知らせるたびに名前空間を取り直すことになるため)
  const found = (service: DiscoveredService) => {
    if (!Number.isInteger(service.port) || service.port < 1 || service.port > 65535) return
    const previous = seen.get(service.instance)
    const at = now()
    seen.set(service.instance, { service, lastSeen: at })
    const changed = previous === undefined || previous.service.host !== service.host || previous.service.port !== service.port
    const unsolicited = at - lastQueryAt > ANSWER_WINDOW_MS && at - (previous?.lastSeen ?? 0) > ANSWER_WINDOW_MS
    if (changed || unsolicited) options.onFound(service)
  }

  const open = (address: string) => {
    // 受けは 0.0.0.0 に bind する(Linux は特定のアドレスに bind するとマルチキャストを受けない)。送りと参加は NIC ごと
    const instance = create({ port, interface: address, bind: '0.0.0.0', reuseAddr: true, multicast: true, loopback: true })
    const entry = { instance, ready: false, failed: false, failedAt: 0 }
    sockets.set(address, entry)
    instance.on('ready', () => {
      entry.ready = true
      updateState()
      sendQuery(instance)
    })
    instance.on('response', (packet, rinfo) => {
      // 応答は LAN の誰でも送れる。形の崩れた応答で例外を出すと、EventEmitter から投げ直されてブリッジが止まるので、ここで止める
      try {
        handleResponse(instance, packet, rinfo)
      } catch (error) {
        logWarn('(WARN, BRIDGE)', `Ignored a malformed mDNS response from ${rinfo.address}: ${error instanceof Error ? error.message : String(error)}`)
      }
    })
    instance.on('error', error => {
      if (destroyed.has(instance)) return
      entry.failed = true
      entry.failedAt = now()
      entry.ready = false
      logWarn('(WARN, BRIDGE)', `mDNS on ${address} could not start: ${error.message} (the firewall may block UDP ${String(port)}).`)
      updateState()
    })
    instance.on('warning', error => {
      if (!destroyed.has(instance)) logWarn('(WARN, BRIDGE)', `mDNS on ${address}: ${error.message}`)
    })
  }

  const closeSocket = (address: string) => {
    const entry = sockets.get(address)
    sockets.delete(address)
    if (entry === undefined) return
    destroyed.add(entry.instance)
    entry.instance.destroy()
  }

  // retryFailed: 開けなかった NIC のソケットを作り直す。利用者の操作(query)のときだけにする。定期の問い合わせで
  // 作り直すと、ファイアウォールで塞がれた NIC の警告が間隔ごとに出続けるため
  const refreshInterfaces = (retryFailed = false) => {
    if (closed) return
    let wanted: Set<string>
    try {
      wanted = new Set(options.interfaces())
    } catch (error) {
      // NIC の一覧(os.networkInterfaces)は OS によって一時的に失敗する。定期の問い合わせのタイマーの中で投げると
      // ブリッジごと止まるので、今のソケットのまま続ける
      logWarn('(WARN, BRIDGE)', `Could not read the network interfaces for mDNS: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    const at = now()
    for (const [address, entry] of [...sockets]) {
      if (!wanted.has(address) || (retryFailed && entry.failed && at - entry.failedAt >= RETRY_FAILED_MS)) closeSocket(address)
    }
    for (const address of wanted) if (!sockets.has(address)) open(address)
    updateState()
  }

  // 問い合わせを間隔ごとに出し、間隔の 3 倍の間に答えなかったターゲットは居なくなったとみなす
  // (TTL は応答者ごとに 120 秒〜75 分とまちまちで、TTL を待つと落ちた Unity が長く残るため)
  const timer = setInterval(() => {
    const cutoff = now() - options.queryIntervalMs * 3
    for (const [instance, entry] of [...seen]) {
      if (entry.lastSeen < cutoff) {
        seen.delete(instance)
        options.onLost(instance)
      }
    }
    // NIC の増減を見てから問い合わせる(新しく開いたソケットは ready で自分から問い合わせる)
    refreshInterfaces()
    for (const entry of sockets.values()) if (entry.ready) sendQuery(entry.instance)
  }, options.queryIntervalMs)
  timer.unref()

  refreshInterfaces()

  return {
    get state() { return state },
    query() {
      refreshInterfaces(true)
      for (const entry of sockets.values()) if (entry.ready) sendQuery(entry.instance)
    },
    refreshInterfaces: () => refreshInterfaces(),
    renotify() {
      for (const entry of [...seen.values()]) options.onFound(entry.service)
    },
    close() {
      closed = true
      clearInterval(timer)
      for (const address of [...sockets.keys()]) closeSocket(address)
    },
  }
}

/** `<インスタンス名>._oscjson._tcp.local` からインスタンス名を取り出す。DNS の \. などのエスケープはそのまま残す */
export function instanceName(fullName: string): string | null {
  const suffix = `.${SERVICE}`
  if (!fullName.toLowerCase().endsWith(suffix)) return null
  const name = fullName.slice(0, fullName.length - suffix.length)
  return name.length === 0 || name.length > 255 ? null : name
}
