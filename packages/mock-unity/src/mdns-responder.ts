import multicastDns from 'multicast-dns'

// mDNS の応答側(D-168)。`_oscjson._tcp.local` の PTR の問い合わせに、インスタンスの PTR・SRV・TXT(txtvers=1 だけ)・A で答える。
// 起動時に告知し、止めるときは TTL 0 で削除を告知する。受け口(oscdesk-unity。HID-490)と同じ取り決め

const SERVICE = '_oscjson._tcp.local'

export interface MockMdnsResponder {
  close(): Promise<void>
}

export function startMockMdnsResponder(options: {
  /** サービスのインスタンス名(同じ PC の複数のターゲットはこれで区別する。製品名とポートを入れる) */
  instance: string
  /** OSCQuery の HTTP のポート */
  httpPort: number
  /** 答えに載せる A レコードのアドレス(参加する NIC でもある) */
  address: string
  /** mDNS のポート(既定 5353。E2E は帯の中のポート) */
  mdnsPort?: number
  ttl?: number
}): Promise<MockMdnsResponder> {
  const fullName = `${options.instance}.${SERVICE}`
  const hostName = `${options.instance.replace(/[^A-Za-z0-9-]/g, '-')}.local`
  const ttl = options.ttl ?? 120
  const socket = multicastDns({
    port: options.mdnsPort ?? 5353,
    interface: options.address,
    bind: '0.0.0.0',
    reuseAddr: true,
    loopback: true,
  })
  const records = (recordTtl: number) => ({
    answers: [{ name: SERVICE, type: 'PTR', ttl: recordTtl, data: fullName }],
    additionals: [
      { name: fullName, type: 'SRV', ttl: recordTtl, data: { port: options.httpPort, target: hostName, priority: 0, weight: 0 } },
      { name: fullName, type: 'TXT', ttl: recordTtl, data: ['txtvers=1'] },
      { name: hostName, type: 'A', ttl: recordTtl, data: options.address },
    ],
  })
  socket.on('query', packet => {
    const asked = (packet.questions ?? []).some(question => typeof question.name === 'string' && (
      (question.name.toLowerCase() === SERVICE && (question.type === 'PTR' || question.type === 'ANY'))
      || question.name.toLowerCase() === fullName.toLowerCase()))
    if (asked) socket.respond(records(ttl))
  })
  socket.on('warning', () => undefined)
  return new Promise((resolve, reject) => {
    socket.once('error', reject)
    socket.on('ready', () => {
      socket.off('error', reject)
      socket.on('error', () => undefined)
      // 起動の告知(ブリッジが早く気づくきっかけ。D-164)
      socket.respond(records(ttl))
      resolve({
        close: () => new Promise<void>(done => {
          socket.respond(records(0), () => socket.destroy(() => done()))
        }),
      })
    })
  })
}
