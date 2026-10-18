import {
  DEFAULT_FAULT_MODE,
  MockUnityResponder,
  type FaultMode,
  type OptionListReply,
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
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const options = parseCliArgs(argv)
  const responder = new MockUnityResponder(options.faultMode, options.optionReplies)

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
