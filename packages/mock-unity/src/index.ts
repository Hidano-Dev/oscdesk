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
import { startMockUnityServer } from './server'

export * from './responder'
export * from './server'

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
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const options = parseCliArgs(argv)
  const responder = new MockUnityResponder(options.faultMode, options.optionReplies, options.catalog, options.outcomes, {
    spawners: options.spawners,
    log: line => process.stdout.write(`${line}\n`),
  })

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

  let closed = false

  const shutdown = async () => {
    if (closed) {
      return
    }

    closed = true
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

  const readyPayload: { listenPort: number; fault: FaultMode } = {
    listenPort: server.listenPort,
    fault: options.faultMode,
  }

  process.stdout.write(`${READY_PREFIX} ${JSON.stringify(readyPayload)}\n`)
  // 受け口は起動時に設計図を全体で送る(HID-379)。ブリッジはこれを起動の合図として扱う(HID-385)
  if (options.announceCatalog) await server.announce(responder.catalogAnnouncement())
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
