import { exitCodeFor, main } from './app/main'

export * from './app/bridge-server'
export * from './app/cli'
export * from './app/main'

if (require.main === module) {
  void main().catch(error => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`OSCDESK_BRIDGE_ERROR ${JSON.stringify({ message })}\n`)
    process.exit(exitCodeFor(error))
  })
}
