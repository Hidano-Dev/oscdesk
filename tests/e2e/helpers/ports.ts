import dgram from 'node:dgram'
import net from 'node:net'

// E2E はファイルを並列のワーカーで動かす(D-133)。OS に空きポートを選ばせる(bind 0)と、どのワーカーも同じ
// エフェメラル範囲から取るので、確保して手放してから子プロセスが bind するまでの間に別のワーカーが同じ番号を
// 引き得る。stack の restartMock は mock を止めて 5 秒待ってから同じポートで起動し直すので、その間に他のワーカーが
// 拾うとテストが他人の mock と話してしまう。そこで、ワーカーごとに重ならない帯を割り当て、その中から順に払い出す。
//
// 帯は 20000〜31999。Windows の動的ポート(49152〜)と Linux のエフェメラル(32768〜)の下に置き、OS が外向きの
// 通信に自動で割り当てる番号と重ならないようにする。既定のポート(7080・7090・7091・8080)もこの帯の外にある。
const RANGE_START = 20_000
const BLOCK_SIZE = 1_000
const BLOCK_COUNT = 12

// 同じ PC で別の E2E の実行(別のワークツリー)が同時に走ると VITEST_POOL_ID は 1 から重なる。実行ごとに変わる
// ずらし(ワーカーの親 = vitest 本体の PID)で帯の割り当てを回し、別の実行とは別の帯になりやすくする。
// 帯が重なっても下の bind の確かめで使用中の番号は飛ばす。
const poolId = Math.max(1, Number.parseInt(process.env.VITEST_POOL_ID ?? '1', 10) || 1)
const runSalt = process.ppid % BLOCK_COUNT
const block = (poolId - 1 + runSalt) % BLOCK_COUNT
const blockStart = RANGE_START + block * BLOCK_SIZE

// 同じワーカーで続けて動くファイルは、モジュールが読み直されて払い出しの位置が戻る。前のファイルの番号を
// すぐに使い回さないよう、開始位置を帯の中で乱数にする
let cursor = Math.floor(Math.random() * BLOCK_SIZE)

/** このワーカーの帯から、UDP で使える番号を 1 つ払い出す。 */
export async function reserveUdpPort(): Promise<number> {
  return nextFreePort(canBindUdp)
}

/** このワーカーの帯から、TCP で待ち受けられる番号を 1 つ払い出す。 */
export async function reserveTcpPort(): Promise<number> {
  return nextFreePort(canBindTcp)
}

async function nextFreePort(canBind: (port: number) => Promise<boolean>): Promise<number> {
  for (let attempt = 0; attempt < BLOCK_SIZE; attempt += 1) {
    const port = blockStart + (cursor % BLOCK_SIZE)
    cursor += 1
    // Windows は Hyper-V などが帯の一部を予約していることがあり、そこは bind が EACCES で失敗する。
    // 使用中・予約済みの番号は飛ばして次を見る
    if (await canBind(port)) return port
  }
  throw new Error(`No free port in the e2e block ${blockStart}-${blockStart + BLOCK_SIZE - 1} (VITEST_POOL_ID=${poolId}).`)
}

// ブリッジの WebSocket と UDP は全アドレス(0.0.0.0)で待ち受け、mock-unity は 127.0.0.x で待ち受ける。
// 0.0.0.0 で bind できれば、どちらの形でも使える
function canBindUdp(port: number): Promise<boolean> {
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
    socket.bind(port, '0.0.0.0', () => {
      socket.close(() => resolve(true))
    })
  })
}

function canBindTcp(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '0.0.0.0', () => {
      server.close(() => resolve(true))
    })
  })
}
