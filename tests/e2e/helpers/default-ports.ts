// E2E のブリッジが既定のポートを使っていないかの判定(D-133・HID-449)。ファイルや OS に触らない純粋な部分だけを
// ここに置き、ガードテスト(tests/guards/e2e-default-ports.test.ts)から直接確かめる

/**
 * ブリッジが実際に掴む・送るポートの既定値。UI の 8080 は含めない: ブリッジは設定の `ui.port` を READY 行に
 * 写すだけで待ち受けず、E2E は UI を起動しないので、8080 のまま残っても並列のワーカーと取り合わない
 */
export const DEFAULT_BRIDGE_PORTS: ReadonlySet<number> = new Set([7080, 7090, 7091])

export interface ReadyPorts {
  wsPort: number
  oscListenPort: number
  unity?: { sendPort?: number }
}

/**
 * READY 行と、ブリッジが読んだ設定ファイルの中身から、既定のポートを使っている箇所を返す(空なら問題なし)。
 * READY 行は主の宛先しか出さないので、残りの送り先は設定から読む(`findDefaultPortsInConfig`)
 */
export function findDefaultPorts(ready: ReadyPorts, config: unknown): string[] {
  const used: string[] = []
  pushIfDefault(used, 'wsPort', ready.wsPort)
  pushIfDefault(used, 'oscListenPort', ready.oscListenPort)
  pushIfDefault(used, 'unity.sendPort', ready.unity?.sendPort)
  return [...used, ...findDefaultPortsInConfig(config)]
}

/**
 * 設定だけで決まり、起動引数で上書きされない送り先のポート: 副の宛先(`unity.secondary[].sendPort`)と、
 * 名乗りを待たずに配信する OSC UI の固定の宛先(`oscUi.staticPeers[].port`)。ベースの設定を写して足した
 * テストで 7090/7091 を書き換え忘れると、開発機の実 Unity や別のブリッジへ ping やフレームが届く。
 * ブリッジは起動の途中で送り始めるので、startBridge は起動前にもこれで確かめる。
 * 固定の宛先は `oscUi.enabled` が true のときだけ見る(HID-457): ブリッジは起動時に一度だけ enabled を読み、
 * 無効ならルーターを作らず固定の宛先へも送らない(実行中に有効へ切り替える口も無い)。有効にするには設定を
 * 書き換えるので、そのときこの検査が拾う。既定は無効(`OscUiConfigSchema`)なので、enabled が無いのも無効とみなす
 */
export function findDefaultPortsInConfig(config: unknown): string[] {
  const used: string[] = []
  if (!isRecord(config)) return used
  const unity = isRecord(config.unity) ? config.unity : {}
  for (const [index, target] of records(unity.secondary).entries()) {
    const name = typeof target.name === 'string' ? target.name : String(index)
    pushIfDefault(used, `unity.secondary[${name}].sendPort`, target.sendPort)
  }
  const oscUi = isRecord(config.oscUi) ? config.oscUi : {}
  if (oscUi.enabled !== true) return used
  for (const [index, peer] of records(oscUi.staticPeers).entries()) {
    pushIfDefault(used, `oscUi.staticPeers[${index}].port`, peer.port)
  }
  return used
}

function pushIfDefault(used: string[], label: string, port: unknown): void {
  if (typeof port === 'number' && DEFAULT_BRIDGE_PORTS.has(port)) used.push(`${label}=${port}`)
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
