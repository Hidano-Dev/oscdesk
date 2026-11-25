import {
  CATALOG,
  CATALOG_ADDRESSES,
  catalogDigest,
  catalogItemBytes,
  parseCatalogAdd,
  type CatalogItem,
  type DownstreamFrame,
  type OscArg,
  type UpstreamFrame,
} from '@oscdesk/shared'

import { catalogFrameItems } from './blueprint-surface'
import type { InboundOscMessage } from './surface-core'

// 設計図(Catalog。D-104)の受信と保持。ターゲットが /sys/catalog/* で送る内容を送信元ホストごとに持ち、
// 変わった PC の全量を 1 PC ずつ `catalog` フレームで UI へ配る(D-131。全 PC を 1 フレームにすると、
// 大きさの上限が PC をまたいだ境界条件の塊になる)。ターゲットとの紐づけは持たない(どの PC の設計図でも任意の送り先へ送れる)。
// 食い違いの検出は件数と全体の CRC32 だけで、1 通ごとの検査は UDP に任せる。

type ClientId = string

export interface CatalogManagerDeps {
  publish: (frame: DownstreamFrame, target?: ClientId) => void
  /** 全宛先へ /sys/catalog/request を送る(Sync)。 */
  requestFromTargets: () => void
  now?: () => number
  /** 配信の間引き(ms)。add / remove が続く間は最後にまとめて 1 回だけ配る。 */
  publishDelayMs?: number
  logInfo?: (...args: unknown[]) => void
  logWarn?: (...args: unknown[]) => void
  /**
   * その PC が起動した合図(HID-385)。Sync の要求(/sys/catalog/request)に答えたのでない begin を受けたとき。
   * ターゲットは起動時に設計図を全体で送るので、ping の間隔より速い再起動でも分かる
   */
  onTargetStarted?: (host: string) => void
  /**
   * 送信元の PC が今 ping に答えているなら、PC の識別と答え始めた時刻(答えていなければ null)。
   * Sync の要求を送った時点から答え続けている PC の begin だけを要求への答えとみなすのに使う(HID-396)。
   * 無ければどの begin も起動の合図として扱う
   */
  upSinceOfSource?: (host: string) => { pc: string; since: number } | null
  /** その PC から設計図の削除通知が来た(生成の記録を外す。HID-385) */
  onItemRemoved?: (host: string, address: string) => void
  /** その PC の設計図に項目が載った(HID-385) */
  onItemAdded?: (host: string, address: string) => void
}

export interface CatalogManager {
  /** /sys/catalog/* を処理したら true(それ以外は false で、呼び出し側が続きを処理する)。 */
  handleOscIn(message: InboundOscMessage): boolean
  handleUiFrame(frame: UpstreamFrame, clientId: ClientId): boolean
  publish(clientId?: ClientId): void
  /** 確定済みの設計図(HID-386 の既定の画面の生成と「この PC には無い」の判定に使う)。 */
  pcs(): readonly { host: string; name: string; items: readonly CatalogItem[] }[]
  close(): void
}

interface PcState {
  host: string
  name: string
  receivedAt: number
  verified: boolean | null
  items: Map<string, CatalogItem>
  bytes: number
  /** begin から end までの受信中の内容。end で items と置き換える。 */
  staging: { name: string; items: Map<string, CatalogItem>; bytes: number; lastAt: number } | null
}

// begin から end が来ないまま、この時間が空いたら end が失われたとみなす(UDP の欠落)
const STAGING_TIMEOUT_MS = 2_000
// 続く受信の間は配信を後ろへ延ばすが、この時間は超えない(長い Sync でも UI が途中経過を受け取れるように)
const MAX_PUBLISH_WAIT_MS = 500
// Sync の要求を全宛先へ流す最短間隔。UI から連打されても、ターゲットに全量を送り続けさせない
const REQUEST_MIN_INTERVAL_MS = 1_000
// Sync の要求を送ってからこの間に届いた begin は、要求への答えになり得る(起動の合図にしない。HID-385)。
// 起動の合図と取り違えると、動いている PC へ生成し直して名前がぶつかる(/sys/failed の name in use)。
// ただし答えとみなすのは、要求を送った時点から ping に答え続けている PC の begin を、要求 1 回につき 1 通だけ(HID-396・D-115)。
// 要求の時刻だけで判定すると、要求を送り続けられる間や「設計図を取り直す」の直後に再起動した PC の begin まで答えに数え、
// 生成の復元が一度も走らない(begin は起動時に 1 回しか来ないので、欠けたまま残る)
export const REQUEST_ANSWER_WINDOW_MS = 5_000
// 同じ PC の起動の合図はこの間に 1 回だけ扱う(begin を連打されても、生成し直しと値の再送を撒き続けない。HID-385)
export const START_MIN_INTERVAL_MS = 5_000

const itemBytes = (item: CatalogItem): number => catalogItemBytes(item)

export function createCatalogManager(deps: CatalogManagerDeps): CatalogManager {
  const now = deps.now ?? Date.now
  const logWarn = deps.logWarn ?? console.warn
  const delay = deps.publishDelayMs ?? 50
  const pcs = new Map<string, PcState>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let firstScheduledAt = 0
  let lastRequestAt = Number.NEGATIVE_INFINITY
  let closed = false
  // 次の配信で送る PC(変わった PC)と、PC の顔ぶれ・並びが変わったか(押し出しなど。PC が無くなっても UI に知らせるため)
  const dirty = new Set<string>()
  let hostsChanged = false
  const stagingTimers = new Map<string, ReturnType<typeof setTimeout>>()
  // 送信元ホスト → 最後に起動の合図として扱った時刻(間引き用)
  const startedAt = new Map<string, number>()
  // 答えの窓の中にある Sync の要求を送った時刻(要求の最短間隔があるので数件に収まる)と、
  // PC → その PC の begin を答えとして数えた要求の時刻(要求 1 回につき 1 通だけ答えとみなす。HID-396)
  let requestTimes: number[] = []
  const answeredRequests = new Map<string, number[]>()

  const pruneRequests = () => {
    const live = (at: number) => now() - at < REQUEST_ANSWER_WINDOW_MS
    requestTimes = requestTimes.filter(live)
    for (const [pc, times] of answeredRequests) {
      const kept = times.filter(live)
      if (kept.length === 0) answeredRequests.delete(pc)
      else answeredRequests.set(pc, kept)
    }
  }

  // この begin が Sync の要求への答えか。要求を送った時点から ping に答え続けている PC の begin を、
  // まだ答えていない要求(古い順)1 回に結びつける。それ以外(新しく現れた・止まってから戻った PC、
  // 答え済みの PC がもう一度送ってきた begin)は起動の合図にする
  const consumeAnswer = (host: string): boolean => {
    pruneRequests()
    if (requestTimes.length === 0) return false
    const up = deps.upSinceOfSource?.(host) ?? null
    if (up === null) return false
    const used = answeredRequests.get(up.pc) ?? []
    const request = requestTimes.find(at => at >= up.since && !used.includes(at))
    if (request === undefined) return false
    answeredRequests.set(up.pc, [...used, request])
    return true
  }

  // 1 フレームは 1 PC(以下)。hosts は今持っている PC の全部で、UI はこれで消えた PC を捨て、並びを揃える
  const frameOf = (targets: readonly PcState[]): DownstreamFrame => ({
    v: 1,
    type: 'catalog',
    hosts: [...pcs.keys()],
    // 項目はパラメータの語彙(param と JSON の値)に直して配る(HID-389)。アドレスは UI へ出さない
    pcs: targets.map(pc => ({
      host: pc.host,
      name: pc.name,
      receivedAt: new Date(pc.receivedAt).toISOString(),
      verified: pc.verified,
      items: catalogFrameItems([...pc.items.values()]),
    })),
  })

  // 接続した UI には全 PC を 1 PC ずつ送る。PC が無くても、空の hosts を 1 回送って古い表示を消させる
  const publishAll = (clientId: ClientId) => {
    const all = [...pcs.values()]
    if (all.length === 0) deps.publish(frameOf([]), clientId)
    for (const pc of all) deps.publish(frameOf([pc]), clientId)
  }
  const flush = () => {
    const targets = [...dirty].map(host => pcs.get(host)).filter((pc): pc is PcState => pc !== undefined)
    const changed = hostsChanged
    dirty.clear()
    hostsChanged = false
    if (targets.length === 0 && changed) deps.publish(frameOf([]))
    for (const pc of targets) deps.publish(frameOf([pc]))
  }
  const publishNow = (clientId?: ClientId) => {
    if (clientId !== undefined) publishAll(clientId)
    else flush()
  }
  // 受信が続く間は後ろへ延ばし(末尾デバウンス)、止まるか MAX_PUBLISH_WAIT_MS 経ったら 1 回だけ配る
  const schedulePublish = (host?: string) => {
    if (closed) return
    if (host !== undefined) dirty.add(host)
    if (timer !== null) {
      if (now() - firstScheduledAt >= MAX_PUBLISH_WAIT_MS) return
      clearTimeout(timer)
    } else {
      firstScheduledAt = now()
    }
    timer = setTimeout(() => {
      timer = null
      flush()
    }, delay)
  }

  // PC は読めたメッセージ(begin / 有効な add / digest)でだけ作る。満杯なら最後の受信が最も古い PC を押し出す
  // (DHCP で入れ替わる端末で、本物の新しい PC の Sync が恒久的に捨てられないように)
  const pcFor = (host: string): PcState => {
    const held = pcs.get(host)
    if (held !== undefined) return held
    if (pcs.size >= CATALOG.MAX_PCS) {
      const oldest = [...pcs.values()].sort((a, b) => a.receivedAt - b.receivedAt)[0]!
      clearStagingTimer(oldest.host)
      pcs.delete(oldest.host)
      dirty.delete(oldest.host)
      hostsChanged = true
      logWarn('(WARN, BRIDGE)', `Dropped the catalog of ${oldest.name} ${oldest.host}: more than ${String(CATALOG.MAX_PCS)} PCs.`)
    }
    const created: PcState = { host, name: host, receivedAt: now(), verified: null, items: new Map(), bytes: 0, staging: null }
    pcs.set(host, created)
    hostsChanged = true
    // この後のメッセージが上限などで捨てられても、PC の顔ぶれの変化(押し出しを含む)は UI へ知らせる
    schedulePublish(host)
    return created
  }

  const intArg = (arg: OscArg | undefined): number | null => arg?.type === 'i' ? arg.value : null

  const verify = (pc: PcState, count: number | null, crc: number | null, where: string) => {
    const mine = catalogDigest([...pc.items.values()])
    const ok = count === mine.count && crc === mine.crc
    pc.verified = ok
    if (!ok) {
      logWarn('(WARN, BRIDGE)', `Catalog digest mismatch (${where}) from ${pc.name} ${pc.host}: received ${String(mine.count)} items crc ${String(mine.crc)}, sender said ${String(count)} items crc ${String(crc)}.`)
      deps.publish({
        v: 1, type: 'notice', level: 'warn', code: 'catalog-mismatch',
        detail: `${pc.name} (${pc.host}): received ${String(mine.count)} items, expected ${String(count)}. Press Sync to fetch again.`,
      })
    }
  }

  // 全 PC が持つ大きさの合計(受信中の PC は、置き換わる旧内容でなく受信中の分を数える。確定時には検査しない)
  const heldBytes = (): number => [...pcs.values()].reduce((sum, pc) => sum + (pc.staging === null ? pc.bytes : pc.staging.bytes), 0)

  const clearStagingTimer = (host: string) => {
    const timer = stagingTimers.get(host)
    if (timer !== undefined) clearTimeout(timer)
    stagingTimers.delete(host)
  }

  // end が失われたまま受信が途絶えても、受け取れた分を全量として確定して示す(受信を待たず、タイマーで)
  const armStagingTimer = (pc: PcState) => {
    clearStagingTimer(pc.host)
    stagingTimers.set(pc.host, setTimeout(() => {
      stagingTimers.delete(pc.host)
      if (closed || pc.staging === null) return
      commitStaging(pc, null, null, 'end missing')
      schedulePublish(pc.host)
    }, STAGING_TIMEOUT_MS))
  }

  const commitStaging = (pc: PcState, count: number | null, crc: number | null, where: string) => {
    if (pc.staging === null) return
    pc.name = pc.staging.name
    pc.items = pc.staging.items
    pc.bytes = pc.staging.bytes
    pc.staging = null
    clearStagingTimer(pc.host)
    verify(pc, count, crc, where)
  }

  return {
    handleOscIn(message) {
      if (!message.address.startsWith('/sys/catalog/')) return false
      if (closed) return true
      const host = message.from.host
      // 要求はコントローラーからターゲットへ向かうもの。ターゲットが誤って返しても無視する
      if (message.address === CATALOG_ADDRESSES.REQUEST) return true
      const held = pcs.get(host)
      const [first, second] = message.args
      switch (message.address) {
        case CATALOG_ADDRESSES.BEGIN: {
          if (first?.type !== 's' || intArg(second) === null) { logWarn('(WARN, BRIDGE)', 'Ignored malformed /sys/catalog/begin.'); return true }
          const pc = pcFor(host)
          pc.receivedAt = now()
          pc.staging = { name: first.value.slice(0, CATALOG.MAX_NAME_CHARS) || host, items: new Map(), bytes: 0, lastAt: now() }
          armStagingTimer(pc)
          if (!consumeAnswer(host) && now() - (startedAt.get(host) ?? Number.NEGATIVE_INFINITY) >= START_MIN_INTERVAL_MS) {
            startedAt.delete(host)
            startedAt.set(host, now())
            // 古い記録は捨て、件数も PC の上限の数までにする(送信元を変えて送られても表が膨らまない)
            for (const [known, at] of startedAt) if (now() - at >= START_MIN_INTERVAL_MS) startedAt.delete(known)
            while (startedAt.size > CATALOG.MAX_PCS) startedAt.delete(startedAt.keys().next().value!)
            deps.onTargetStarted?.(host)
          }
          break
        }
        case CATALOG_ADDRESSES.ADD: {
          const parsed = parseCatalogAdd(message.args)
          if (!parsed.ok) { logWarn('(WARN, BRIDGE)', `Ignored malformed /sys/catalog/add from ${host}: ${parsed.reason}`); return true }
          const pc = pcFor(host)
          pc.receivedAt = now()
          const staging = pc.staging
          const target = staging?.items ?? pc.items
          if (staging !== null) { staging.lastAt = now(); armStagingTimer(pc) }
          const previous = target.get(parsed.item.address)
          if (previous === undefined && target.size >= CATALOG.MAX_ITEMS_PER_PC) {
            logWarn('(WARN, BRIDGE)', `Ignored catalog item from ${host}: more than ${String(CATALOG.MAX_ITEMS_PER_PC)} items.`)
            return true
          }
          // 1 PC の大きさにも上限を置く(1 PC を 1 フレームで UI へ送るため。16 MiB を超えると UI の接続が切れる)。
          // 全量の受信中は置き換わる旧内容を数えない(end で入れ替わるので、数えると同じ設計図を取り直しただけで項目が欠ける)。
          // 捨てた分は件数と要約値が合わなくなり、end / digest の照合で verified: false になる
          const size = itemBytes(parsed.item)
          const delta = size - (previous === undefined ? 0 : itemBytes(previous))
          if (delta > 0 && (staging?.bytes ?? pc.bytes) + delta > CATALOG.MAX_PC_BYTES) {
            logWarn('(WARN, BRIDGE)', `Ignored catalog item from ${host}: the catalog of the PC would exceed ${String(CATALOG.MAX_PC_BYTES)} bytes.`)
            return true
          }
          if (delta > 0 && heldBytes() + delta > CATALOG.MAX_HELD_BYTES) {
            logWarn('(WARN, BRIDGE)', `Ignored catalog item from ${host}: the catalogs would exceed ${String(CATALOG.MAX_HELD_BYTES)} bytes in total.`)
            return true
          }
          target.set(parsed.item.address, parsed.item)
          if (staging !== null) staging.bytes += delta
          else pc.bytes += delta
          deps.onItemAdded?.(host, parsed.item.address)
          // 差分を受けたら、次の digest で確かめるまで照合済みとは言えない
          if (pc.staging === null) pc.verified = null
          break
        }
        case CATALOG_ADDRESSES.REMOVE: {
          const pc = held
          // 生成の記録(HID-385)は設計図を持っていない PC の通知でも外す(ブリッジの再起動で設計図は消えるが、記録は残るため)
          if (first?.type === 's') deps.onItemRemoved?.(host, first.value)
          if (first?.type !== 's' || pc === undefined) return true
          pc.receivedAt = now()
          if (pc.staging !== null) { pc.staging.lastAt = now(); armStagingTimer(pc) }
          const removing = (pc.staging?.items ?? pc.items).get(first.value)
          if (removing !== undefined) {
            if (pc.staging !== null) pc.staging.bytes -= itemBytes(removing)
            else pc.bytes -= itemBytes(removing)
          }
          ;(pc.staging?.items ?? pc.items).delete(first.value)
          if (pc.staging === null) pc.verified = null
          break
        }
        case CATALOG_ADDRESSES.END: {
          const pc = held
          if (pc?.staging == null) { logWarn('(WARN, BRIDGE)', `Ignored /sys/catalog/end from ${host} without begin.`); return true }
          pc.receivedAt = now()
          // 全量の置き換え。食い違っていても受け取れた分は持つ(UI が赤く示し、人が Sync で取り直す)
          commitStaging(pc, intArg(first), intArg(second), 'end')
          break
        }
        case CATALOG_ADDRESSES.DIGEST: {
          const pc = held
          // 全量の受信中の digest は、確定前の内容とは比べられない(end が照合する)
          if (pc === undefined || pc.staging !== null) return true
          pc.receivedAt = now()
          verify(pc, intArg(first), intArg(second), 'digest')
          break
        }
        default:
          return true // 知らない /sys/catalog/* は読み捨てる(後から足せるように)
      }
      schedulePublish(host)
      return true
    },

    pcs: () => [...pcs.values()].map(pc => ({ host: pc.host, name: pc.name, items: [...pc.items.values()] })),
    handleUiFrame(frame) {
      if (frame.type !== 'catalogRequest') return false
      if (now() - lastRequestAt >= REQUEST_MIN_INTERVAL_MS) {
        lastRequestAt = now()
        pruneRequests()
        requestTimes.push(lastRequestAt)
        deps.requestFromTargets()
      }
      return true
    },

    publish: publishNow,

    close() {
      closed = true
      for (const host of [...stagingTimers.keys()]) clearStagingTimer(host)
      if (timer !== null) clearTimeout(timer)
      timer = null
    },
  }
}
