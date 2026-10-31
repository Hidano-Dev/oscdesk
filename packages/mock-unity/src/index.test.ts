import { afterEach, describe, expect, it, vi } from 'vitest'

import { main, parseCliArgs } from './index'

const { startMockUnityServerMock } = vi.hoisted(() => ({
  startMockUnityServerMock: vi.fn(),
}))

vi.mock('./server', () => ({
  startMockUnityServer: startMockUnityServerMock,
}))

describe('parseCliArgs', () => {
  it('parses the required listen port and optional reply target', () => {
    expect(
      parseCliArgs(['--listen-port', '9000', '--reply-host', '127.0.0.1', '--reply-port', '9001']),
    ).toEqual({
      listenPort: 9000,
      replyHost: '127.0.0.1',
      replyPort: 9001,
      faultMode: { kind: 'none' },
      optionReplies: [],
      catalog: null,
    })
  })

  it('parses --fault with parameterized modes', () => {
    expect(parseCliArgs(['--listen-port', '9000', '--fault', 'delay:150'])).toEqual({
      listenPort: 9000,
      replyHost: undefined,
      replyPort: undefined,
      faultMode: { kind: 'delay', ms: 150 },
      optionReplies: [],
      catalog: null,
    })

    expect(parseCliArgs(['--listen-port', '9000', '--fault', 'random-loss:0.5'])).toEqual({
      listenPort: 9000,
      replyHost: undefined,
      replyPort: undefined,
      faultMode: { kind: 'random-loss', rate: 0.5 },
      optionReplies: [],
      catalog: null,
    })
  })

  it('collects repeated --options-reply flags', () => {
    const reply = (address: string) => `${address}/get|${address}|A`
    expect(parseCliArgs(['--listen-port', '9000', '--options-reply', reply('/a'), '--options-reply', reply('/b')]).optionReplies).toEqual([
      { request: '/a/get', address: '/a', options: ['A'] },
      { request: '/b/get', address: '/b', options: ['A'] },
    ])
  })

  it('rejects missing listen port', () => {
    expect(() => parseCliArgs([])).toThrow('Missing required argument: --listen-port')
  })

  it('rejects half-specified reply targets', () => {
    expect(() => parseCliArgs(['--listen-port', '9000', '--reply-host', '127.0.0.1'])).toThrow(
      '--reply-host and --reply-port must be provided together',
    )
  })

  it('rejects the retired scenario flags', () => {
    for (const flag of ['--scenario', '--character-name', '--project-id']) {
      expect(() => parseCliArgs(['--listen-port', '9000', flag, 'x'])).toThrow(`Unknown argument: ${flag}`)
    }
    expect(() => parseCliArgs(['--listen-port', '9000', '--legacy-origin'])).toThrow('Unknown argument: --legacy-origin')
  })

  it('rejects invalid fault mode syntax', () => {
    expect(() => parseCliArgs(['--listen-port', '9000', '--fault', 'delay:-1'])).toThrow(
      'Invalid fault mode for --fault: delay:-1',
    )
  })
})

describe('main', () => {
  const stdoutWrite = vi.spyOn(process.stdout, 'write')

  afterEach(() => {
    stdoutWrite.mockReset()
    startMockUnityServerMock.mockReset()
  })

  it('starts the server with an echoing responder, injects the fault mode, and prints READY metadata', async () => {
    startMockUnityServerMock.mockResolvedValue({ listenPort: 9020, close: vi.fn(async () => undefined) })
    stdoutWrite.mockReturnValue(true)

    await main(['--listen-port', '9000', '--reply-host', '127.0.0.1', '--reply-port', '9001', '--fault', 'drop-pong'])

    const options = startMockUnityServerMock.mock.calls[0]?.[0]
    expect(options).toMatchObject({ listenPort: 9000, replyTarget: { host: '127.0.0.1', port: 9001 } })
    expect(options).not.toHaveProperty('startupReplies')
    expect(options.responder.handlePacket({ address: '/sys/ping', args: [{ type: 'i', value: 1 }] })).toEqual([])
    expect(options.responder.handlePacket({ address: '/avatar/name', args: [] })).toEqual([
      { kind: 'message', packet: { address: '/avatar/name', args: [] } },
    ])
    expect(stdoutWrite).toHaveBeenCalledWith(
      `MOCK_UNITY_READY ${JSON.stringify({ listenPort: 9020, fault: { kind: 'drop-pong' } })}\n`,
    )
  })
})

describe('parseCliArgs --catalog-json', () => {
  it('parses a catalog for the Sync responder (D-104)', () => {
    const options = parseCliArgs(['--listen-port', '9000', '--catalog-json', '{"name":"PC1","items":[],"corruptDigest":true}'])
    expect(options.catalog).toEqual({ name: 'PC1', items: [], corruptDigest: true })
    expect(() => parseCliArgs(['--listen-port', '9000', '--catalog-json', '{}'])).toThrow()
  })
})
