import {
  DEFAULT_FAULT_MODE,
  MockUnityResponder,
  type FaultMode,
  type MockCatalog,
  type OutcomeConfig,
  type OptionListReply,
  parseMockCatalog,
  parseFaultMode,
  parseOptionListReply,
} from './responder'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'

import { startMockMdnsResponder, type MockMdnsResponder } from './mdns-responder'
import { DEFAULT_OSCQUERY_NAMESPACE, startMockOscQueryServer, type MockOscQueryServer, type OscQueryNode } from './oscquery-server'
import { startMockUnityServer } from './server'

export * from './responder'
export * from './server'
export * from './oscquery-server'
export * from './mdns-responder'

export interface MockUnityCliOptions {
  listenPort: number
  /** 待受アドレス(既定 0.0.0.0)。127.0.0.2 等に分けると、同じ PC で「別の IP の Unity」を立てられる(宛先タブの E2E)。 */
  listenHost?: string
  replyHost?: string
  replyPort?: number
  faultMode: FaultMode
  optionReplies: OptionListReply[]
  catalog: MockCatalog | null
  /** /sys/ignored・/sys/failed の再現(D-105)。--known-address / --failing を与えたときだけ。 */
  outcomes?: OutcomeConfig
  /** 生成担当の再現(HID-385)。--spawner を与えたときだけ */
  spawners: string[]
  /** 起動時に設計図の全量(begin … end)を返信先へ送る(起動の合図。HID-385) */
  announceCatalog: boolean
  /** OSCQuery(D-168)。--oscquery-port を与えたときだけ HTTP と WebSocket で名前空間を出す */
  oscQuery?: {
    /** 0 なら OS に選ばせ、READY 行の oscQueryPort で知らせる */
    port: number
    /** 名前空間の JSON のファイル。書き換えると読み直して PATH_CHANGED を送る。省くと見本の名前空間 */
    namespaceFile?: string
    name: string
  }
  /** 起動 ID。省くと起動ごとの GUID(pong の第 2 引数と HOST_INFO の X_OSCDESK_BOOT_ID) */
  bootId?: string
  /** mDNS の応答側(--mdns)。port の既定は 5353、address の既定はこの PC の最初の LAN の IPv4 */
  mdns?: { port: number; address?: string }
}

const READY_PREFIX = 'MOCK_UNITY_READY'

export function parseCliArgs(argv: readonly string[]): MockUnityCliOptions {
  const args = [...argv]
  let listenPort: number | null = null
  let listenHost: string | undefined
  let replyHost: string | undefined
  let replyPort: number | undefined
  let faultMode = DEFAULT_FAULT_MODE
  const optionReplies: OptionListReply[] = []
  let catalog: MockCatalog | null = null
  const known: string[] = []
  const failing: Record<string, string> = {}
  const spawners: string[] = []
  let announceCatalog = false
  let oscQueryPort: number | undefined
  let namespaceFile: string | undefined
  let oscQueryName = 'mock-unity'
  let bootId: string | undefined
  let mdns = false
  let mdnsPort = 5353
  let mdnsAddress: string | undefined

  while (args.length > 0) {
    const flag = args.shift()

    switch (flag) {
      case '--listen-port':
        listenPort = parsePort(readRequiredValue(flag, args), flag)
        break
      case '--listen-host':
        listenHost = readRequiredValue(flag, args)
        break
      case '--reply-host':
        replyHost = readRequiredValue(flag, args)
        break
      case '--reply-port':
        replyPort = parsePort(readRequiredValue(flag, args), flag)
        break
      case '--fault':
        faultMode = parseFaultMode(readRequiredValue(flag, args))
        break
      case '--options-reply':
        optionReplies.push(parseOptionListReply(readRequiredValue(flag, args)))
        break
      case '--catalog-json':
        catalog = parseMockCatalog(readRequiredValue(flag, args))
        break
      case '--spawner':
        spawners.push(readRequiredValue(flag, args))
        break
      case '--announce-catalog':
        announceCatalog = true
        break
      case '--oscquery-port': {
        const raw = readRequiredValue(flag, args)
        oscQueryPort = raw === '0' ? 0 : parsePort(raw, flag)
        break
      }
      case '--oscquery-namespace':
        namespaceFile = readRequiredValue(flag, args)
        break
      case '--oscquery-name':
        oscQueryName = readRequiredValue(flag, args)
        break
      case '--boot-id':
        bootId = readRequiredValue(flag, args)
        break
      case '--mdns':
        mdns = true
        break
      case '--mdns-port':
        mdnsPort = parsePort(readRequiredValue(flag, args), flag)
        break
      case '--mdns-address':
        mdnsAddress = readRequiredValue(flag, args)
        break
      case '--known-address':
        known.push(readRequiredValue(flag, args))
        break
      case '--failing': {
        // 形式: アドレス=理由(例 /count=type mismatch)
        const raw = readRequiredValue(flag, args)
        const at = raw.indexOf('=')
        if (at <= 0) throw new Error(`--failing expects address=reason: ${raw}`)
        failing[raw.slice(0, at)] = raw.slice(at + 1)
        break
      }
      default:
        throw new Error(`Unknown argument: ${flag}`)
    }
  }

  if (listenPort === null) {
    throw new Error('Missing required argument: --listen-port')
  }

  if (mdns && oscQueryPort === undefined) {
    throw new Error('--mdns needs --oscquery-port (the service points to the OSCQuery HTTP port)')
  }

  if ((replyHost === undefined) !== (replyPort === undefined)) {
    throw new Error('--reply-host and --reply-port must be provided together')
  }

  return {
    listenPort,
    listenHost,
    replyHost,
    replyPort,
    faultMode,
    optionReplies,
    catalog,
    outcomes:
      known.length > 0 || Object.keys(failing).length > 0
        ? { ...(known.length > 0 ? { known } : {}), failing }
        : undefined,
    spawners,
    announceCatalog,
    ...(oscQueryPort === undefined ? {} : { oscQuery: { port: oscQueryPort, name: oscQueryName, ...(namespaceFile === undefined ? {} : { namespaceFile }) } }),
    ...(bootId === undefined ? {} : { bootId }),
    ...(mdns ? { mdns: { port: mdnsPort, ...(mdnsAddress === undefined ? {} : { address: mdnsAddress }) } } : {}),
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const options = parseCliArgs(argv)
  const responder = new MockUnityResponder(options.faultMode, options.optionReplies, options.catalog, options.outcomes, {
    spawners: options.spawners,
    log: line => process.stdout.write(`${line}\n`),
  })
  const bootId = options.bootId ?? randomUUID()
  responder.bootId = bootId

  const server = await startMockUnityServer({
    listenPort: options.listenPort,
    host: options.listenHost,
    replyTarget:
      options.replyHost !== undefined && options.replyPort !== undefined
        ? {
            host: options.replyHost,
            port: options.replyPort,
          }
        : undefined,
    responder,
  })

  let oscQuery: MockOscQueryServer | undefined
  let mdnsResponder: MockMdnsResponder | undefined
  let unwatch: (() => void) | undefined
  if (options.oscQuery !== undefined) {
    const query = options.oscQuery
    const readNamespace = (): OscQueryNode => query.namespaceFile === undefined
      ? DEFAULT_OSCQUERY_NAMESPACE
      : JSON.parse(fs.readFileSync(query.namespaceFile, 'utf8')) as OscQueryNode
    oscQuery = await startMockOscQueryServer({
      port: query.port,
      host: options.listenHost,
      namespace: readNamespace(),
      hostInfo: () => ({
        NAME: query.name,
        OSC_PORT: server.listenPort,
        OSC_TRANSPORT: 'UDP',
        WS_PORT: oscQuery?.port ?? query.port,
        EXTENSIONS: {
          ACCESS: true, VALUE: true, RANGE: true, DESCRIPTION: true, TYPE: true, FULL_PATH: true,
          PATH_CHANGED: true, PATH_ADDED: true, PATH_REMOVED: true, PATH_RENAMED: true, LISTEN: false,
        },
        X_OSCDESK_BOOT_ID: bootId,
      }),
    })
    if (query.namespaceFile !== undefined) {
      const file = query.namespaceFile
      // テストがファイルを書き換えたら読み直す(名前空間の変化の再現)。fs.watch は Windows で取りこぼすので見に行く方式
      const onChange = () => {
        try {
          oscQuery?.setNamespace(readNamespace())
          process.stdout.write('MOCK_UNITY_NAMESPACE_CHANGED\n')
        } catch (error) {
          process.stderr.write(`[mock-unity] could not reload ${file}: ${error instanceof Error ? error.message : String(error)}\n`)
        }
      }
      fs.watchFile(file, { interval: 100 }, onChange)
      unwatch = () => fs.unwatchFile(file, onChange)
    }
    if (options.mdns !== undefined) {
      mdnsResponder = await startMockMdnsResponder({
        instance: `${query.name}-${String(oscQuery.port)}`,
        httpPort: oscQuery.port,
        address: options.mdns.address ?? firstLanAddress(),
        mdnsPort: options.mdns.port,
      })
    }
  }

  let closed = false

  const shutdown = async () => {
    if (closed) {
      return
    }

    closed = true
    unwatch?.()
    await mdnsResponder?.close()
    await oscQuery?.close()
    await server.close()
  }

  process.once('SIGINT', () => {
    void shutdown().finally(() => {
      process.exit(0)
    })
  })
  process.once('SIGTERM', () => {
    void shutdown().finally(() => {
      process.exit(0)
    })
  })

  const readyPayload: { listenPort: number; fault: FaultMode; oscQueryPort?: number; bootId?: string } = {
    listenPort: server.listenPort,
    fault: options.faultMode,
    ...(oscQuery === undefined ? {} : { oscQueryPort: oscQuery.port, bootId }),
  }

  process.stdout.write(`${READY_PREFIX} ${JSON.stringify(readyPayload)}\n`)
  // 受け口は起動時に設計図を全体で送る(HID-379)。ブリッジはこれを起動の合図として扱う(HID-385)
  if (options.announceCatalog) await server.announce(responder.catalogAnnouncement())
}

// プライベートのアドレス(192.168/16・10/8・172.16/12)の NIC を先に選ぶ。VPN(Tailscale の 100.64/10 など)が先に並ぶ PC で、
// LAN のブリッジに届かない NIC へ告知しないように
function firstLanAddress(): string {
  const addresses = Object.values(os.networkInterfaces()).flatMap(entries => (entries ?? [])
    .filter(entry => entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.'))
    .map(entry => entry.address))
  const isPrivate = (address: string) => /^(?:192\.168\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(address)
  return addresses.find(isPrivate) ?? addresses[0] ?? '127.0.0.1'
}

function readRequiredValue(flag: string, args: string[]): string {
  const value = args.shift()

  if (value === undefined) {
    throw new Error(`Missing value for ${flag}`)
  }

  return value
}

function parsePort(raw: string, flag: string): number {
  const port = Number(raw)

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port for ${flag}: ${raw}`)
  }

  return port
}

if (require.main === module) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exit(1)
  })
}
