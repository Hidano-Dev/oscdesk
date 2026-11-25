import dgram from 'node:dgram'
import net from 'node:net'

import { PORT_BLOCK_SIZE, portBlockStart } from './port-blocks'

// E2E はファイルを並列のワーカーで動かす(D-133)。OS に空きポートを選ばせる(bind 0)と、どのワーカーも同じ
// エフェメラル範囲から取るので、確保して手放してから子プロセスが bind するまでの間に別のワーカーが同じ番号を
// 引き得る。stack の restartMock は mock を止めて 5 秒待ってから同じポートで起動し直すので、その間に他のワーカーが
// 拾うとテストが他人の mock と話してしまう。そこで、ワーカーごとに重ならない帯(port-blocks.ts)を割り当て、
// その中から順に払い出す。
//
// 同じ PC で別の E2E の実行(別のワークツリー)が同時に走ると VITEST_POOL_ID は 1 から重なり、帯も重なるのが
// ふつうである。実行ごとに変わるずらし(ワーカーの親 = vitest 本体の PID)で帯の割り当てを回すのは重なりを
// 減らす程度で、別の実行に対する守りは下の bind の確かめだけ(確かめてから子が bind するまでの間は守れない)。
// 実行をまたぐ予約の仕組みは作らない(D-133)
const poolId = Number.parseInt(process.env.VITEST_POOL_ID ?? '1', 10)
const runSalt = process.ppid

// 同じワーカーで続けて動くファイルは、モジュールが読み直されて払い出しの位置が戻る。前のファイルの番号を
// すぐに使い回さないよう、開始位置を帯の中で乱数にする
let cursor = Math.floor(Math.random() * PORT_BLOCK_SIZE)

/** このワーカーの帯から、UDP で使える番号を 1 つ払い出す。 */
export async function reserveUdpPort(): Promise<number> {
  return nextFreePort(canBindUdp)
}

/** このワーカーの帯から、TCP で待ち受けられる番号を 1 つ払い出す。 */
export async function reserveTcpPort(): Promise<number> {
  return nextFreePort(canBindTcp)
}

async function nextFreePort(canBind: (port: number) => Promise<boolean>): Promise<number> {
  // 帯の数を超えるワーカーはここで落とす(帯が剰余で重なり、同じ実行の中で番号を取り合うため)。
  // 読み込んだ時点で落とすと、ポートを使わないテストまで巻き込む
  const blockStart = portBlockStart(poolId, runSalt)
  for (let attempt = 0; attempt < PORT_BLOCK_SIZE; attempt += 1) {
    const port = blockStart + (cursor % PORT_BLOCK_SIZE)
    cursor += 1
    // Windows は Hyper-V などが帯の一部を予約していることがあり、そこは bind が EACCES で失敗する。
    // 使用中・予約済みの番号は飛ばして次を見る
    if (await canBind(port)) return port
  }
  throw new Error(`No free port in the e2e block ${blockStart}-${blockStart + PORT_BLOCK_SIZE - 1} (VITEST_POOL_ID=${poolId}).`)
}

// ブリッジの UDP は全アドレス(0.0.0.0)で、mock-unity は 127.0.0.1〜127.0.0.3 で待ち受ける(stack と宛先の E2E)。
// OS によっては 127.0.0.2 に bind 済みの番号でも 0.0.0.0 の bind が通るので、使う形をすべて確かめ、
// どれか 1 つでも失敗したら使用中とみなす
const UDP_PROBE_HOSTS = ['0.0.0.0', '127.0.0.1', '127.0.0.2', '127.0.0.3']

async function canBindUdp(port: number): Promise<boolean> {
  for (const host of UDP_PROBE_HOSTS) {
    if (!(await canBindUdpOn(port, host))) return false
  }
  return true
}

function canBindUdpOn(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4')
    socket.once('error', () => {
      try {
        socket.close()
      } catch {
        // bind に失敗したソケットは閉じる前に止まっていることがある
      }
      resolve(false)
    })
    socket.bind(port, host, () => {
      socket.close(() => resolve(true))
    })
  })
}

// ブリッジの WebSocket は全アドレスで待ち受ける
function canBindTcp(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '0.0.0.0', () => {
      server.close(() => resolve(true))
    })
  })
}
