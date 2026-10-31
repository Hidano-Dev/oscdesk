import { SYS, type OscArg, type OscMessagePacket, type TargetAdapterKind } from '@oscdesk/shared'

import type { BundleSendResult, InboundOscMessage } from './surface-core'

// 通信アダプタの境目(HID-373・D-106)。ブリッジはターゲットとのやり取りをこの境目の内側に閉じ込め、
// UI へは共通の語彙(パラメータ ID と JSON の値)で配る。今は OSC のアダプタだけを実装し、
// アダプタを差し込む仕組みや複数のアダプタの同時稼働は作らない(要望書の「先回りしない」)。
//
// 送る側は「値を送る」、受け取る側は「届いた・対象なし・処理失敗・設計図・生存確認」の 5 つに分ける。
// 受け取る側をここで振り分けておけば、送り先ブロックの点灯(HID-376)や Sync(HID-371)が
// OSC のアドレスを知らずに到達の種類だけで扱える

export const SYS_IGNORED = '/sys/ignored'
export const SYS_FAILED = '/sys/failed'
const CATALOG_PREFIX = '/sys/catalog/'

export interface TargetPeer {
  readonly host: string
  readonly port: number
}

export interface TargetAdapterHandlers {
  /** 届いた(エコーなど、生存確認・対象なし・処理失敗・設計図以外の受信)。 */
  delivered(message: InboundOscMessage): void
  /** 届いたが対象がいなかった(`/sys/ignored`。HID-375)。refs は振り分け先が無かった結び付け(OSC ではアドレス)。 */
  unbound(from: TargetPeer, refs: readonly string[]): void
  /** 届いたが処理できなかった(`/sys/failed`。HID-375)。 */
  failed(from: TargetPeer, entries: readonly { readonly ref: string; readonly reason: string }[]): void
  /** 設計図(Sync。D-104)。受け取ったら true(受けなかったものは delivered へ回す)。 */
  blueprint(message: InboundOscMessage): boolean
  /** 生存確認(ping への応答)。 */
  alive(message: InboundOscMessage): void
}

export interface TargetAdapter {
  readonly kind: TargetAdapterKind
  /** 値を 1 件送る。OSC のアダプタでは binding はアドレス、args は型タグ付きの引数。 */
  sendValue(to: TargetPeer, binding: string, args: readonly OscArg[]): void
  /** 複数の値を 1 回で送る(まとめ送り。D-050)。 */
  sendValues(to: TargetPeer, messages: readonly OscMessagePacket[]): BundleSendResult
  /** トランスポートから受けた 1 件を 5 つの受信のどれかへ振り分ける。 */
  receive(message: InboundOscMessage): void
}

export interface OscTransportLike {
  send(host: string, port: number, address: string, args: readonly OscArg[]): void
  sendBundle(host: string, port: number, messages: readonly OscMessagePacket[]): BundleSendResult
}

export function createOscAdapter(options: {
  transport: () => OscTransportLike | undefined
  handlers: () => TargetAdapterHandlers | undefined
}): TargetAdapter {
  return {
    kind: 'osc',
    sendValue(to, binding, args) {
      options.transport()?.send(to.host, to.port, binding, args)
    },
    sendValues(to, messages) {
      return options.transport()?.sendBundle(to.host, to.port, messages) ?? { ok: false, reason: 'transport-unavailable' }
    },
    receive(message) {
      const handlers = options.handlers()
      if (handlers === undefined) return
      if (message.address === SYS.PONG) {
        handlers.alive(message)
        return
      }
      if (message.address === SYS_IGNORED) {
        // 引数は振り分け先の無かったアドレス(s を N 個)。s 以外は読み飛ばす(任意の契約なので壊れた通知で落とさない)
        handlers.unbound(message.from, message.args.flatMap(arg => arg.type === 's' ? [arg.value] : []))
        return
      }
      if (message.address === SYS_FAILED) {
        // 引数はアドレスと理由の組(s, s を N 組)
        const entries: { ref: string; reason: string }[] = []
        for (let index = 0; index + 1 < message.args.length; index += 2) {
          const ref = message.args[index]!
          const reason = message.args[index + 1]!
          if (ref.type === 's' && reason.type === 's') entries.push({ ref: ref.value, reason: reason.value })
        }
        handlers.failed(message.from, entries)
        return
      }
      if (message.address.startsWith(CATALOG_PREFIX) && handlers.blueprint(message)) return
      handlers.delivered(message)
    },
  }
}
