import { CATALOG_ADDRESSES, CatalogItemSchema, SYS, catalogAddArgs, catalogDigest } from '@oscdesk/shared'
import type { CatalogItem, OscMessagePacket, OscPacket } from '@oscdesk/shared'

export type FaultMode =
  | { kind: 'none' }
  | { kind: 'drop-pong' }
  | { kind: 'silent' }
  | { kind: 'random-loss'; rate: number }
  | { kind: 'delay'; ms: number }
  | { kind: 'corrupt' }

export type MockUnityReply =
  | {
      kind: 'message'
      packet: OscMessagePacket
      delayMs?: number
    }
  | {
      kind: 'raw'
      payload: Uint8Array
      delayMs?: number
    }

/**
 * 一覧の要求に応える設定(D-053 の E2E 用)。`request` を受けたら、そのエコーに続けて
 * `address` へ `options` を s 引数で並べた 1 メッセージを返す。実機の受け口と同じく要求もエコーする。
 * 同じ `request` と `address` の組を複数書くと、要求のたびに書いた順に返す(最後のものを繰り返す)。
 */
export interface OptionListReply {
  request: string
  address: string
  options: readonly string[]
}

/**
 * 設計図(Catalog。D-104)の送信側の見本。`/sys/catalog/request` を受けたら、begin / add / end を順に返す。
 * corruptDigest を立てると end の CRC32 をわざと外し、受け側の食い違い検出(赤の点灯)を確かめられる。
 */
export interface MockCatalog {
  name: string
  items: readonly CatalogItem[]
  corruptDigest?: boolean
}

export function parseMockCatalog(raw: string): MockCatalog {
  const value = JSON.parse(raw) as Partial<MockCatalog>
  if (typeof value.name !== 'string' || !Array.isArray(value.items)) {
    throw new Error('--catalog-json must be {"name": string, "items": CatalogItem[], "corruptDigest"?: boolean}')
  }
  // 本物の受け口と同じ検査を通す(1 データグラムに収まらない項目は送れず、送信側の mock が落ちるため)
  const items = value.items.map(item => CatalogItemSchema.parse(item))
  return { name: value.name, items, corruptDigest: value.corruptDigest === true }
}

/**
 * 実機の受け口の /sys/ignored・/sys/failed(D-105)の E2E 用の再現。mock は対応表を持たないので、設定で与える。
 * `known` を与えると、そこに無いアドレスの受信を「行が無い」として /sys/ignored で報告する。
 * `failing` のアドレス(アドレス → 理由)の受信は /sys/failed で報告する。どちらもエコーの後に、bundle 1 個につき各 1 メッセージ。
 * 未指定なら報告しない(古い受け口と同じ)。
 */
export interface OutcomeConfig {
  known?: readonly string[]
  failing?: Readonly<Record<string, string>>
}

/**
 * 受け口の生成担当(OscSpawner。HID-382)の E2E 用の再現(HID-385)。spawners は生成担当のアドレスの末尾の命令を除いたもの
 * (例 /effect/spawner)。`<spawner>/spawn ,s 名前` で `/パッケージ名/<名前>/stop` を設計図に足して /sys/catalog/add を返し、
 * `<spawner>/destroy ,s 名前` で外して /sys/catalog/remove を返す。生成済みの名前の spawn・無い名前の destroy は
 * /sys/failed(name in use / not found)。log には生成・削除のたびに 1 行を渡す(E2E が標準出力で確かめる)
 */
export interface SpawnConfig {
  spawners: readonly string[]
  log?: (line: string) => void
}

export const DEFAULT_FAULT_MODE: FaultMode = { kind: 'none' }
const CORRUPT_PAYLOAD = Uint8Array.from([0xde, 0xad, 0xbe, 0xef])

export class MockUnityResponder {
  private pongReplyCount = 0
  // request と address の組ごとに、これまでに応えた回数
  private readonly optionReplyCounts = new Map<string, number>()

  constructor(
    private readonly faultMode: FaultMode = DEFAULT_FAULT_MODE,
    private readonly optionReplies: readonly OptionListReply[] = [],
    private readonly catalog: MockCatalog | null = null,
    private readonly outcomes: OutcomeConfig = {},
    private readonly spawn: SpawnConfig = { spawners: [] },
  ) {}

  // 生成したもの(名前 → 設計図の項目)。設計図の全量(begin … end)にも載せる
  private readonly spawned = new Map<string, CatalogItem>()

  /** 起動の合図として送る設計図の全量(HID-385。--announce-catalog)。設計図を持たなければ名前 mock の空の設計図 */
  catalogAnnouncement(): OscMessagePacket[] {
    const replies: MockUnityReply[] = []
    this.pushCatalog(replies, this.catalog ?? { name: 'mock', items: [] })
    return replies.flatMap(reply => reply.kind === 'message' ? [reply.packet] : [])
  }

  private handleSpawner(packet: OscMessagePacket, replies: MockUnityReply[], report: OutcomeReport): boolean {
    const at = packet.address.lastIndexOf('/')
    const spawner = packet.address.slice(0, at)
    const command = packet.address.slice(at + 1)
    if (!this.spawn.spawners.includes(spawner) || (command !== 'spawn' && command !== 'destroy')) return false
    const head = packet.args[0]
    const name = head?.type === 's' ? head.value : ''
    const packageName = spawner.split('/')[1] ?? ''
    const fail = (reason: string) => {
      if (report.failed.length < OUTCOME_MAX_FAILED * 2) report.failed.push(clipText(packet.address), reason)
      this.spawn.log?.(`MOCK_UNITY_SPAWN_FAILED ${command} ${name} ${reason}`)
    }
    if (command === 'spawn') {
      if (name === '' || this.spawned.has(name)) {
        fail(name === '' ? 'invalid name' : 'name in use')
        return true
      }
      const item: CatalogItem = { address: `/${packageName}/${name}/stop`, kind: 'trigger', type: 'i', props: [] }
      this.spawned.set(name, item)
      this.spawn.log?.(`MOCK_UNITY_SPAWNED ${name}`)
      this.pushReply(replies, { address: CATALOG_ADDRESSES.ADD, args: catalogAddArgs(item) })
      return true
    }
    const item = this.spawned.get(name)
    if (item === undefined) {
      fail('not found')
      return true
    }
    this.spawned.delete(name)
    this.spawn.log?.(`MOCK_UNITY_DESTROYED ${name}`)
    this.pushReply(replies, { address: CATALOG_ADDRESSES.REMOVE, args: [{ type: 's', value: item.address }] })
    return true
  }

  handlePacket(packet: OscPacket): MockUnityReply[] {
    const replies: MockUnityReply[] = []
    const report: OutcomeReport = { ignored: [], failed: [] }
    this.visitPacket(packet, replies, report)
    this.flushReport(replies, report)
    return replies
  }

  // 実機と同じく、エコーの後にデータグラムごとにまとめて各 1 メッセージ
  private flushReport(replies: MockUnityReply[], report: OutcomeReport): void {
    if (report.ignored.length > 0) {
      this.pushReply(replies, { address: SYS.IGNORED, args: report.ignored.map(value => ({ type: 's', value })) })
    }
    if (report.failed.length > 0) {
      this.pushReply(replies, { address: SYS.FAILED, args: report.failed.map(value => ({ type: 's', value })) })
    }
  }

  // 実機(OscDeliveryReport)と同じ上限。無いと大きな bundle から送れない大きさの報告ができ、mock が落ちる
  private observe(address: string, report: OutcomeReport): void {
    const reason = this.outcomes.failing?.[address]
    if (reason !== undefined) {
      if (report.failed.length < OUTCOME_MAX_FAILED * 2) report.failed.push(clipText(address), clipText(reason))
    } else if (this.outcomes.known !== undefined && !this.outcomes.known.includes(address)) {
      const text = clipText(address)
      if (report.ignored.length < OUTCOME_MAX_IGNORED && !report.ignored.includes(text)) report.ignored.push(text)
    }
  }

  private visitPacket(packet: OscPacket, replies: MockUnityReply[], report: OutcomeReport): void {
    if (isBundlePacket(packet)) {
      for (const nestedPacket of packet.packets) {
        this.visitPacket(nestedPacket, replies, report)
      }
      return
    }

    if (packet.address === SYS.PING) {
      this.pushReply(replies, { address: SYS.PONG, args: packet.args })
      return
    }

    if (packet.address === CATALOG_ADDRESSES.REQUEST) {
      if (this.catalog !== null || this.spawn.spawners.length > 0) this.pushCatalog(replies, this.catalog ?? { name: 'mock', items: [] })
      return
    }

    // 未知の /sys/* には応えない(Unity 側の実装が増えても mock が勝手に応答しないため)
    if (packet.address.startsWith('/sys/')) {
      return
    }

    // 値の確定は Unity のエコーだけ(CLAUDE.md の原則)。mock は受けた値をそのまま返す
    this.pushReply(replies, { address: packet.address, args: packet.args })
    if (this.handleSpawner(packet, replies, report)) return
    this.observe(packet.address, report)

    // 同じ request と address の組が複数あれば、要求のたびに順に 1 つ返し、尽きたら最後のものを返し続ける。
    // 「起動時は MB と未接続で空、あとで取り直すと埋まる」ような、一覧が後から変わる様子を再現するため(D-077 の E2E)
    const byAddress = new Map<string, OptionListReply[]>()
    for (const reply of this.optionReplies) {
      if (reply.request !== packet.address) continue
      byAddress.set(reply.address, [...(byAddress.get(reply.address) ?? []), reply])
    }
    for (const [address, candidates] of byAddress) {
      const key = `${packet.address}\u0000${address}`
      const count = this.optionReplyCounts.get(key) ?? 0
      this.optionReplyCounts.set(key, count + 1)
      const reply = candidates[Math.min(count, candidates.length - 1)]!
      this.pushReply(replies, { address, args: reply.options.map(value => ({ type: 's', value })) })
    }
  }

  private pushCatalog(replies: MockUnityReply[], catalog: MockCatalog): void {
    const items = [...catalog.items, ...this.spawned.values()]
    const digest = catalogDigest(items)
    this.pushReply(replies, { address: CATALOG_ADDRESSES.BEGIN, args: [{ type: 's', value: catalog.name }, { type: 'i', value: digest.count }] })
    for (const item of items) this.pushReply(replies, { address: CATALOG_ADDRESSES.ADD, args: catalogAddArgs(item) })
    const crc = catalog.corruptDigest === true ? (digest.crc ^ 1) | 0 : digest.crc
    this.pushReply(replies, { address: CATALOG_ADDRESSES.END, args: [{ type: 'i', value: digest.count }, { type: 'i', value: crc }] })
  }

  private pushReply(replies: MockUnityReply[], packet: OscMessagePacket): void {
    const filteredReply = this.applyFault(packet)

    if (filteredReply !== null) {
      replies.push(filteredReply)
    }
  }

  private applyFault(packet: OscMessagePacket): MockUnityReply | null {
    switch (this.faultMode.kind) {
      case 'none':
        return {
          kind: 'message',
          packet,
        }
      case 'silent':
        return null
      case 'drop-pong':
        return packet.address === SYS.PONG ? null : { kind: 'message', packet }
      case 'random-loss':
        if (packet.address !== SYS.PONG) {
          return {
            kind: 'message',
            packet,
          }
        }

        this.pongReplyCount += 1

        return shouldDropPong(this.pongReplyCount, this.faultMode.rate)
          ? null
          : {
              kind: 'message',
              packet,
            }
      case 'delay':
        return packet.address === SYS.PONG
          ? {
              kind: 'message',
              packet,
              delayMs: this.faultMode.ms,
            }
          : {
              kind: 'message',
              packet,
            }
      case 'corrupt':
        return {
          kind: 'raw',
          payload: CORRUPT_PAYLOAD.slice(),
        }
      default:
        return assertNever(this.faultMode)
    }
  }
}

const OUTCOME_MAX_IGNORED = 32
const OUTCOME_MAX_FAILED = 16
const OUTCOME_MAX_TEXT = 128

function clipText(text: string): string {
  if (text.length <= OUTCOME_MAX_TEXT) return text
  const code = text.charCodeAt(OUTCOME_MAX_TEXT - 1)
  // サロゲートペアを割らない
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? OUTCOME_MAX_TEXT - 1 : OUTCOME_MAX_TEXT)
}

interface OutcomeReport {
  ignored: string[]
  failed: string[]
}

function isBundlePacket(packet: OscPacket): packet is Extract<OscPacket, { packets: OscPacket[] }> {
  return 'timeTag' in packet && 'packets' in packet
}

function shouldDropPong(sequence: number, rate: number): boolean {
  return Math.floor(sequence * rate) > Math.floor((sequence - 1) * rate)
}

export function parseFaultMode(raw: string): FaultMode {
  switch (raw) {
    case 'drop-pong':
      return { kind: 'drop-pong' }
    case 'silent':
      return { kind: 'silent' }
    case 'corrupt':
      return { kind: 'corrupt' }
  }

  if (raw.startsWith('random-loss:')) {
    const rate = Number(raw.slice('random-loss:'.length))

    if (!Number.isFinite(rate) || rate <= 0 || rate >= 1) {
      throw new Error(`Invalid fault mode for --fault: ${raw}`)
    }

    return { kind: 'random-loss', rate }
  }

  if (raw.startsWith('delay:')) {
    const ms = Number(raw.slice('delay:'.length))

    if (!Number.isInteger(ms) || ms < 0) {
      throw new Error(`Invalid fault mode for --fault: ${raw}`)
    }

    return { kind: 'delay', ms }
  }

  throw new Error(`Invalid fault mode for --fault: ${raw}`)
}

// `<request>|<address>|<名前>|...` の形。PowerShell 5.1 はネイティブコマンドへの引数から `"` を
// 落とすので、手動検証で打てるよう JSON にしない(名前に `|` は使えない。名前 0 個は空の一覧)。
// 空の名前は末尾や連続の `|` の打ち間違いとみなして拒否する(空の候補が出てブリッジや UI の不具合に見えるため)
export function parseOptionListReply(raw: string): OptionListReply {
  const [request, address, ...options] = raw.split('|')
  if (
    request === undefined || address === undefined || !request.startsWith('/') || !address.startsWith('/')
    || options.some(name => name === '')
  ) {
    throw new Error(`Invalid value for --options-reply (expected <request>|<address>|<name>...): ${raw}`)
  }
  return { request, address, options }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported fault mode: ${JSON.stringify(value)}`)
}
