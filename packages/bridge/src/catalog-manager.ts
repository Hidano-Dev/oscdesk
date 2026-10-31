import {
  CATALOG,
  CATALOG_ADDRESSES,
  catalogDigest,
  catalogItemBytes,
  parseCatalogAdd,
  type CatalogItem,
  type CatalogPc,
  type DownstreamFrame,
  type OscArg,
  type UpstreamFrame,
} from '@oscdesk/shared'

import type { InboundOscMessage } from './surface-core'

// 設計図(Catalog。D-104)の受信と保持。ターゲットが /sys/catalog/* で送る内容を送信元ホストごとに持ち、
// 全量を `catalog` フレームで UI へ配る。ターゲットとの紐づけは持たない(どの PC の設計図でも任意の送り先へ送れる)。
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
}

export interface CatalogManager {
  /** /sys/catalog/* を処理したら true(それ以外は false で、呼び出し側が続きを処理する)。 */
  handleOscIn(message: InboundOscMessage): boolean
  handleUiFrame(frame: UpstreamFrame, clientId: ClientId): boolean
  publish(clientId?: ClientId): void
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
  const stagingTimers = new Map<string, ReturnType<typeof setTimeout>>()

  const snapshot = (): DownstreamFrame => ({
    v: 1,
    type: 'catalog',
    pcs: [...pcs.values()].map((pc): CatalogPc => ({
      host: pc.host,
      name: pc.name,
      receivedAt: new Date(pc.receivedAt).toISOString(),
      verified: pc.verified,
      items: [...pc.items.values()],
    })),
  })

  const publishNow = (clientId?: ClientId) => deps.publish(snapshot(), clientId)
  // 受信が続く間は後ろへ延ばし(末尾デバウンス)、止まるか MAX_PUBLISH_WAIT_MS 経ったら 1 回だけ配る
  const schedulePublish = () => {
    if (closed) return
    if (timer !== null) {
      if (now() - firstScheduledAt >= MAX_PUBLISH_WAIT_MS) return
      clearTimeout(timer)
    } else {
      firstScheduledAt = now()
    }
    timer = setTimeout(() => {
      timer = null
      publishNow()
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
      logWarn('(WARN, BRIDGE)', `Dropped the catalog of ${oldest.name} ${oldest.host}: more than ${String(CATALOG.MAX_PCS)} PCs.`)
    }
    const created: PcState = { host, name: host, receivedAt: now(), verified: null, items: new Map(), bytes: 0, staging: null }
    pcs.set(host, created)
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

  // 合計の大きさ(受信中の分を含む)
  // 全量の受信中は、置き換わる旧内容を数えない(end で入れ替わるので、数えると同じ設計図を取り直しただけで項目が欠ける)
  const totalBytes = (): number => [...pcs.values()].reduce((sum, pc) => sum + (pc.staging === null ? pc.bytes : pc.staging.bytes), 0)

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
      schedulePublish()
    }, STAGING_TIMEOUT_MS))
  }

  const commitStaging = (pc: PcState, count: number | null, crc: number | null, where: string) => {
    if (pc.staging === null) return
    // 配信するのは確定済みの内容だけなので、確定の時点で全 PC の合計が上限に収まることを保証する
    // (受信中の検査は他の PC の確定を待つ間の見積もりで、重なった受信では合計を超え得る)
    const others = [...pcs.values()].reduce((sum, other) => sum + (other === pc ? 0 : other.bytes), 0)
    if (others + pc.staging.bytes > CATALOG.MAX_TOTAL_BYTES) {
      logWarn('(WARN, BRIDGE)', `Discarded the catalog received from ${pc.name} ${pc.host}: the catalogs would exceed ${String(CATALOG.MAX_TOTAL_BYTES)} bytes in total.`)
      pc.staging = null
      clearStagingTimer(pc.host)
      pc.verified = false
      deps.publish({ v: 1, type: 'notice', level: 'warn', code: 'catalog-too-large', detail: `${pc.name} (${pc.host}): the catalogs are too large to hold. The previous content is kept.` })
      return
    }
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
          // 全 PC の合計の大きさにも上限を置く(1 フレームで全量を UI へ送るため。16 MiB を超えると UI の接続が切れる)
          const size = itemBytes(parsed.item)
          const delta = size - (previous === undefined ? 0 : itemBytes(previous))
          if (delta > 0 && totalBytes() + delta > CATALOG.MAX_TOTAL_BYTES) {
            logWarn('(WARN, BRIDGE)', `Ignored catalog item from ${host}: the catalogs would exceed ${String(CATALOG.MAX_TOTAL_BYTES)} bytes in total.`)
            return true
          }
          target.set(parsed.item.address, parsed.item)
          if (staging !== null) staging.bytes += delta
          else pc.bytes += delta
          // 差分を受けたら、次の digest で確かめるまで照合済みとは言えない
          if (pc.staging === null) pc.verified = null
          break
        }
        case CATALOG_ADDRESSES.REMOVE: {
          const pc = held
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
      schedulePublish()
      return true
    },

    handleUiFrame(frame) {
      if (frame.type !== 'catalogRequest') return false
      if (now() - lastRequestAt >= REQUEST_MIN_INTERVAL_MS) {
        lastRequestAt = now()
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
