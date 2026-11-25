import { execFile } from 'node:child_process'
import dgram from 'node:dgram'
import fs from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'

import { parseArpTable, selectNeighbors, type LanProber } from '../domain/lan-subnets'

// 宛先タブの LAN 走査(D-078)の、実ネットワークに触る部分(UDP の送信・arp コマンド)。
// サブネットの計算と ARP 表の読み取りは domain/lan-subnets の純粋関数(D-134)。

/** UDP の宛先に使う discard ポート。受け手が何も返さない前提のポートで、届いても害が無い。 */
const DISCARD_PORT = 9
// 送ってから ARP の応答と OS の近隣状態の更新を待つ長さ。Windows は古いエントリの再確認に 1 秒前後かかる
const DEFAULT_SETTLE_MS = 2_500
const DEFAULT_ARP_TIMEOUT_MS = 4_000

/**
 * OS の機能だけで端末を探す走査器。走査範囲の全アドレスへ空の UDP データグラムを 1 個ずつ送り、
 * 送信のために OS が行う ARP 解決で ARP 表を埋めてから、`arp -a`(無ければ /proc/net/arp)を読む。
 * ICMP の ping は使わない: 生ソケットに権限が要り、Windows の既定の防火壁は ping に応答しない
 * (Unity を動かす Windows PC が見つからない)が、ARP には防火壁の設定にかかわらず応答するため
 */
export function createSystemLanProber(options: {
  settleMs?: number
  arpTimeoutMs?: number
  sendProbes?: (hosts: readonly string[], signal: AbortSignal) => Promise<void>
  readArpTable?: (signal: AbortSignal) => Promise<string>
} = {}): LanProber {
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS
  const send = options.sendProbes ?? sendUdpProbes
  const readArpTable = options.readArpTable ?? (signal => readSystemArpTable(options.arpTimeoutMs ?? DEFAULT_ARP_TIMEOUT_MS, signal))
  return {
    async probe(subnets, signal) {
      signal.throwIfAborted()
      await send(subnets.flatMap(subnet => subnet.hosts), signal)
      await delay(settleMs, undefined, { signal })
      const table = await readArpTable(signal)
      signal.throwIfAborted()
      return selectNeighbors(parseArpTable(table), subnets)
    },
  }
}

async function sendUdpProbes(hosts: readonly string[], signal: AbortSignal): Promise<void> {
  if (hosts.length === 0) return
  // 中断されたらソケットを閉じる(送信待ちのコールバックはエラーで返り、下の Promise.all が終わる)
  const socket = dgram.createSocket({ type: 'udp4', signal })
  // 届かない宛先の送信エラー(EHOSTUNREACH 等)は走査の結果に関係ないので握りつぶす
  socket.on('error', () => undefined)
  const empty = Buffer.alloc(0)
  try {
    await Promise.all(hosts.map(host => new Promise<void>(resolve => {
      socket.send(empty, DISCARD_PORT, host, () => resolve())
    })))
  } finally {
    // signal で閉じ済みなら close は投げるので握りつぶす
    try { socket.close() } catch { /* 既に閉じている */ }
  }
  signal.throwIfAborted()
}

function readSystemArpTable(timeoutMs: number, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    // Windows の arp はコードページ依存の文字で見出しを出す。数字と英字だけ拾うので latin1 で読めば足りる。
    // signal で中断されると子プロセスを kill して AbortError で返る
    execFile('arp', ['-a'], { timeout: timeoutMs, windowsHide: true, encoding: 'latin1', signal }, (error, stdout) => {
      if (error === null) {
        resolve(stdout)
        return
      }
      if (signal.aborted) {
        reject(error)
        return
      }
      // arp コマンドの無い Linux(net-tools 未導入)はカーネルの表を直接読む
      fs.readFile('/proc/net/arp', { encoding: 'utf8', signal }, (fileError, text) => {
        if (fileError === null) resolve(text)
        else reject(error)
      })
    })
  })
}
