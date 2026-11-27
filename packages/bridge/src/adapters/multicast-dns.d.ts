// multicast-dns 7.2.5 の、このリポジトリで使う部分だけの型(D-168)。@types を足さずに最小で持つ
// (mock-unity の tsconfig もこのファイルを読む)
declare module 'multicast-dns' {
  import type { EventEmitter } from 'node:events'
  import type { RemoteInfo } from 'node:dgram'

  namespace multicastDns {
    interface Options {
      port?: number
      type?: 'udp4' | 'udp6'
      ip?: string
      interface?: string
      bind?: string | false
      multicast?: boolean
      ttl?: number
      loopback?: boolean
      reuseAddr?: boolean
    }

    interface Question {
      name: string
      type: string
      class?: string
    }

    interface Answer {
      name: string
      type: string
      ttl?: number
      class?: string
      flush?: boolean
      data?: unknown
    }

    interface Packet {
      type: 'query' | 'response'
      id?: number
      flags?: number
      questions?: Question[]
      answers?: Answer[]
      authorities?: Answer[]
      additionals?: Answer[]
    }

    interface Instance extends EventEmitter {
      query(packet: { questions: Question[] } | Question[], callback?: (error: Error | null) => void): void
      respond(packet: { answers: Answer[]; additionals?: Answer[] } | Answer[], callback?: (error: Error | null) => void): void
      destroy(callback?: () => void): void
      on(event: 'response' | 'query', listener: (packet: Packet, rinfo: RemoteInfo) => void): this
      on(event: 'ready' | 'networkInterface', listener: () => void): this
      on(event: 'error' | 'warning', listener: (error: Error) => void): this
    }
  }

  function multicastDns(options?: multicastDns.Options): multicastDns.Instance
  export = multicastDns
}
