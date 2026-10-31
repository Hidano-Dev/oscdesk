import {
  CATALOG,
  CATALOG_ADDRESSES,
  catalogDigest,
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
  /** begin から end までの受信中の内容。end で items と置き換える。 */
  staging: { name: string; expected: number; items: Map<string, CatalogItem>; overflow: boolean } | null
}

export function createCatalogManager(deps: CatalogManagerDeps): CatalogManager {
  const now = deps.now ?? Date.now
  const logWarn = deps.logWarn ?? console.warn
  const delay = deps.publishDelayMs ?? 50
  const pcs = new Map<string, PcState>()
  let timer: ReturnType<typeof setTimeout> | null = null

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
  const schedulePublish = () => {
    if (timer !== null) return
    timer = setTimeout(() => {
      timer = null
      publishNow()
    }, delay)
  }

  const pcFor = (host: string): PcState | null => {
    const held = pcs.get(host)
    if (held !== undefined) return held
    if (pcs.size >= CATALOG.MAX_PCS) {
      logWarn('(WARN, BRIDGE)', `Ignored catalog from ${host}: more than ${String(CATALOG.MAX_PCS)} PCs.`)
      return null
    }
    const created: PcState = { host, name: host, receivedAt: now(), verified: null, items: new Map(), staging: null }
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

  return {
    handleOscIn(message) {
      if (!message.address.startsWith('/sys/catalog/')) return false
      const pc = message.address === CATALOG_ADDRESSES.REQUEST ? null : pcFor(message.from.host)
      if (message.address === CATALOG_ADDRESSES.REQUEST) return true // コントローラーからターゲットへの要求。ターゲットが誤って返しても無視する
      if (pc === null) return true
      pc.receivedAt = now()
      const [first, second] = message.args
      switch (message.address) {
        case CATALOG_ADDRESSES.BEGIN: {
          const count = intArg(second)
          if (first?.type !== 's' || count === null) { logWarn('(WARN, BRIDGE)', 'Ignored malformed /sys/catalog/begin.'); break }
          pc.staging = { name: first.value.slice(0, CATALOG.MAX_NAME_CHARS) || pc.host, expected: count, items: new Map(), overflow: false }
          break
        }
        case CATALOG_ADDRESSES.ADD: {
          const parsed = parseCatalogAdd(message.args)
          if (!parsed.ok) { logWarn('(WARN, BRIDGE)', `Ignored malformed /sys/catalog/add from ${pc.host}: ${parsed.reason}`); break }
          const target = pc.staging?.items ?? pc.items
          if (!target.has(parsed.item.address) && target.size >= CATALOG.MAX_ITEMS_PER_PC) {
            if (pc.staging !== null) pc.staging.overflow = true
            logWarn('(WARN, BRIDGE)', `Ignored catalog item from ${pc.host}: more than ${String(CATALOG.MAX_ITEMS_PER_PC)} items.`)
            break
          }
          target.set(parsed.item.address, parsed.item)
          break
        }
        case CATALOG_ADDRESSES.REMOVE: {
          if (first?.type !== 's') break
          // 削除通知は受信中でも保持中の内容から外す(begin の途中の remove は、全量の送り直しでは来ない想定)
          ;(pc.staging?.items ?? pc.items).delete(first.value)
          break
        }
        case CATALOG_ADDRESSES.END: {
          if (pc.staging === null) { logWarn('(WARN, BRIDGE)', `Ignored /sys/catalog/end from ${pc.host} without begin.`); break }
          // 全量の置き換え。食い違っていても受け取れた分は持つ(UI が赤く示し、人が Sync で取り直す)
          pc.name = pc.staging.name
          pc.items = pc.staging.items
          pc.staging = null
          verify(pc, intArg(first), intArg(second), 'end')
          break
        }
        case CATALOG_ADDRESSES.DIGEST: {
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
      deps.requestFromTargets()
      return true
    },

    publish: publishNow,

    close() {
      if (timer !== null) clearTimeout(timer)
      timer = null
    },
  }
}
